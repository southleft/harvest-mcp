# Harvest MCP Server - Implementation Tasks

## Overview

This document outlines all tasks needed to build the Harvest MCP server with a focus on:
1. **Remote connectivity** - Claude Desktop must be able to connect
2. **Composable toolkit** - Data access, normalization, and deterministic compute tools
3. **Explicit profitability model** - No guessing; model does the orchestration, tools do deterministic math

## Architecture Philosophy

**Old approach (DEPRECATED):** One MCP tool per business question
- `harvest_analyze_client_profitability` → "Who is my most profitable client?"
- Tightly coupled, inflexible, duplicated logic

**New approach (COMPOSABLE):** Layered toolkit
```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: Compute Tools (deterministic math)                    │
│  harvest_compute_profitability, harvest_compute_utilization     │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: Rates & Resolution                                    │
│  harvest_get_rates, harvest_resolve_entities                    │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: Data Access (Harvest API wrappers)                    │
│  harvest_list_time_entries, harvest_list_clients, etc.          │
└─────────────────────────────────────────────────────────────────┘
```

The LLM orchestrates tool calls; tools return structured data. No tool "guesses" or interprets—all calculations are explicit and deterministic.

---

## Profitability Model Specification

### Revenue Calculation Modes

| Mode | Formula | When to Use |
|------|---------|-------------|
| `time_based` | `billable_hours × billable_rate` | No invoicing, or real-time estimates |
| `invoice_based` | `sum(paid_invoices.amount)` allocated to entity | Accurate historical revenue |
| `hybrid` | Invoice amount if invoiced, else time_based | Best of both worlds |

### Cost Calculation

```
cost = sum(hours × cost_rate)
```

Where `cost_rate` comes from (in priority order):
1. Harvest `user.cost_rate` (if available)
2. Harvest `user_assignment.hourly_rate` marked as cost
3. Local config override: `rates.json` or environment variable
4. Default fallback: `DEFAULT_COST_RATE` env var (default: 0)

### Derived Metrics

| Metric | Formula | Notes |
|--------|---------|-------|
| **Profit** | `revenue - cost` | Can be negative |
| **Margin** | `(profit / revenue) × 100` | Returns `null` if revenue = 0 |
| **Utilization** | `(billable_hours / total_hours) × 100` | Percentage of time that's billable |
| **Realization** | `(actual_revenue / potential_revenue) × 100` | Potential = billable_hours × standard_rate |
| **Effective Rate** | `revenue / billable_hours` | Actual $/hr achieved |

### Rounding & Precision

- **Monetary values**: Round to 2 decimal places (banker's rounding)
- **Hours**: Round to 2 decimal places
- **Percentages**: Round to 1 decimal place
- **Rates**: Round to 2 decimal places

### Timezone Behavior

- All date filters interpreted in **account timezone** (from `GET /company`)
- Date ranges are inclusive: `from <= date <= to`
- Week starts on company's configured `week_start_day`

---

## Task Dependency Graph (Revised)

```
Phase 1: Infrastructure (unchanged)
├── 1.1 Project Setup
├── 1.2 Configuration
├── 1.3 Session Store
├── 1.4 OAuth2 Client
├── 1.5 HTTP Server (CRITICAL)
└── 1.6 OAuth Callback

Phase 2: Data Access Layer (NEW)
├── 2.1 API Client Base (pagination, rate-limits, caching)
├── 2.2 Data Wrapper Tools
│   ├── harvest_list_time_entries
│   ├── harvest_list_clients
│   ├── harvest_list_projects
│   ├── harvest_list_users
│   └── harvest_list_tasks
└── 2.3 Invoice Support (optional)
    └── harvest_list_invoices

Phase 3: Rates & Resolution Layer (NEW)
├── 3.1 Rates Source of Truth
│   └── harvest_get_rates
├── 3.2 Entity Resolution
│   └── harvest_resolve_entities
└── 3.3 Schema/Definitions
    └── harvest_get_schema

Phase 4: Compute Layer (NEW)
├── 4.1 harvest_compute_profitability
├── 4.2 harvest_compute_utilization
└── 4.3 harvest_aggregate_time

Phase 5: Testing
├── 5.1 Unit Tests (compute logic)
├── 5.2 Integration Tests
└── 5.3 E2E Tests

Phase 6: Deployment
├── 6.1 Production Hardening
├── 6.2 Containerization
└── 6.3 Deployment
```

---

## A) High-Priority Tasks (In Order)

| Priority | Task | Description | Status | Dependencies |
|----------|------|-------------|--------|--------------|
| **P0** | 1.5 Remote HTTP Server | Enable Claude Desktop connection | Skeleton ✅ | 1.2, 1.3 |
| **P0** | 1.4 + 1.6 OAuth2 Flow | User authentication with Harvest | Skeleton ✅ | 1.2 |
| **P0** | 2.1 API Client Base | Pagination, rate-limits, caching | Partial ✅ | 1.4 |
| **P0** | 2.2 Data Wrapper Tools | list_time_entries, list_clients, etc. | Partial ✅ | 2.1 |
| **P1** | 3.1 Rates Source of Truth | harvest_get_rates with fallback | ❌ Not Started | 2.2 |
| **P1** | 3.2 Entity Resolution | harvest_resolve_entities | ❌ Not Started | 2.2 |
| **P1** | 4.1 Compute Profitability | harvest_compute_profitability | ❌ Not Started | 3.1 |
| **P1** | 4.2 Compute Utilization | harvest_compute_utilization | ❌ Not Started | 2.2 |
| **P2** | 2.3 Invoice Support | harvest_list_invoices (for invoice_based revenue) | Partial ✅ | 2.1 |
| **P2** | 4.3 Aggregate Time | harvest_aggregate_time convenience tool | ❌ Not Started | 2.2 |
| **P2** | 3.3 Schema Tool | harvest_get_schema definitions | ❌ Not Started | — |
| **P3** | 5.x Testing | Unit, integration, E2E | ❌ Not Started | Phase 4 |
| **P3** | 6.x Deployment | Docker, production hardening | ❌ Not Started | Phase 5 |

---

## B) Tool Inventory

### Layer 1: Data Access Tools

#### `harvest_list_time_entries`

Fetches time entries from Harvest with robust filtering and automatic pagination.

**Input Schema:**
```typescript
{
  // Filters (all optional)
  user_id?: number;              // Filter by user
  client_id?: number;            // Filter by client
  project_id?: number;           // Filter by project
  task_id?: number;              // Filter by task
  is_billed?: boolean;           // Filter by billed status
  is_running?: boolean;          // Filter by timer status
  from?: string;                 // Start date (YYYY-MM-DD), inclusive
  to?: string;                   // End date (YYYY-MM-DD), inclusive
  updated_since?: string;        // ISO 8601 datetime

  // Pagination
  page?: number;                 // Page number (default: 1)
  per_page?: number;             // Results per page (1-2000, default: 100)
  auto_paginate?: boolean;       // Fetch all pages (default: false, max 10 pages)

  // Output control
  include_project?: boolean;     // Include project details (default: true)
  include_client?: boolean;      // Include client details (default: true)
  include_user?: boolean;        // Include user details (default: true)
}
```

**Output Schema:**
```typescript
{
  time_entries: TimeEntry[];     // Array of time entry objects
  pagination: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
    has_more: boolean;
  };
  _meta: {
    api_calls_made: number;      // For rate limit awareness
    cached: boolean;
    cache_age_seconds?: number;
  };
}
```

**Rate Limit Handling:**
- Respects Harvest's 100 requests/15 seconds limit
- Returns `retry_after_seconds` if rate limited
- `auto_paginate` stops at 10 pages to prevent runaway requests

**Caching:**
- Results cached for 60 seconds by default
- Cache key: hash of all filter parameters
- `force_refresh: true` bypasses cache

---

#### `harvest_list_clients`

**Input Schema:**
```typescript
{
  is_active?: boolean;           // Filter by active status
  updated_since?: string;        // ISO 8601 datetime
  page?: number;
  per_page?: number;
  auto_paginate?: boolean;
}
```

**Output Schema:**
```typescript
{
  clients: Client[];
  pagination: { ... };
  _meta: { ... };
}
```

---

#### `harvest_list_projects`

**Input Schema:**
```typescript
{
  client_id?: number;            // Filter by client
  is_active?: boolean;           // Filter by active status
  updated_since?: string;
  page?: number;
  per_page?: number;
  auto_paginate?: boolean;
}
```

**Output Schema:**
```typescript
{
  projects: Project[];
  pagination: { ... };
  _meta: { ... };
}
```

---

#### `harvest_list_users`

**Input Schema:**
```typescript
{
  is_active?: boolean;           // Filter by active status
  include_cost_rates?: boolean;  // Include cost_rate if available (default: true)
  page?: number;
  per_page?: number;
  auto_paginate?: boolean;
}
```

**Output Schema:**
```typescript
{
  users: User[];                 // Includes cost_rate when available
  pagination: { ... };
  _meta: { ... };
}
```

---

#### `harvest_list_invoices` (Optional - P2)

**Input Schema:**
```typescript
{
  client_id?: number;
  project_id?: number;
  state?: 'draft' | 'open' | 'paid' | 'closed';
  from?: string;                 // Issue date from
  to?: string;                   // Issue date to
  page?: number;
  per_page?: number;
  auto_paginate?: boolean;
}
```

**Output Schema:**
```typescript
{
  invoices: Invoice[];
  pagination: { ... };
  _meta: { ... };
}
```

---

### Layer 2: Rates & Resolution Tools

#### `harvest_get_rates`

Returns authoritative rate information for users, projects, and tasks. Handles the complexity of where rates come from.

**Input Schema:**
```typescript
{
  // Context for rate lookup (provide one or more)
  user_ids?: number[];           // Get rates for specific users
  project_ids?: number[];        // Get project-level rates

  // Options
  include_fallbacks?: boolean;   // Include fallback/default rates (default: true)
  rate_types?: ('cost' | 'billable' | 'both')[];  // Which rates to fetch (default: both)
}
```

**Output Schema:**
```typescript
{
  user_rates: {
    [user_id: number]: {
      cost_rate: number | null;
      cost_rate_source: 'harvest_user' | 'harvest_assignment' | 'config_override' | 'default';
      billable_rate: number | null;
      billable_rate_source: 'harvest_user' | 'harvest_assignment' | 'project_default' | 'config_override';
    };
  };
  project_rates: {
    [project_id: number]: {
      default_billable_rate: number | null;
      budget: number | null;
      budget_by: string;
    };
  };
  defaults: {
    cost_rate: number;           // From DEFAULT_COST_RATE env or 0
    billable_rate: number | null;
  };
  _config: {
    config_file_loaded: boolean; // Whether rates.json was found
    config_file_path?: string;
  };
}
```

**Rate Resolution Logic:**
```
For cost_rate:
  1. Check Harvest user.cost_rate → if set, use it
  2. Check local rates.json for user override → if set, use it
  3. Use DEFAULT_COST_RATE env var → if set, use it
  4. Return 0 (log warning)

For billable_rate:
  1. Check task_assignment.hourly_rate → if set, use it
  2. Check user_assignment.hourly_rate → if set, use it
  3. Check project.hourly_rate → if set, use it
  4. Check user.default_hourly_rate → if set, use it
  5. Return null (cannot calculate time_based revenue without this)
```

---

#### `harvest_resolve_entities`

Fuzzy-matches entity names to IDs. Essential for natural language queries like "profitability for Acme Corp".

**Input Schema:**
```typescript
{
  query: string;                 // Natural language query or name
  entity_types?: ('client' | 'project' | 'user' | 'task')[];  // Limit search scope
  limit?: number;                // Max results per type (default: 5)
  threshold?: number;            // Match confidence 0-1 (default: 0.6)
}
```

**Output Schema:**
```typescript
{
  matches: {
    clients: Array<{ id: number; name: string; confidence: number; is_active: boolean }>;
    projects: Array<{ id: number; name: string; confidence: number; client_name: string }>;
    users: Array<{ id: number; name: string; confidence: number; email: string }>;
    tasks: Array<{ id: number; name: string; confidence: number }>;
  };
  best_match: {
    entity_type: string;
    id: number;
    name: string;
    confidence: number;
  } | null;
  query_normalized: string;      // How the query was interpreted
}
```

---

#### `harvest_get_schema`

Returns definitions and enums for reference. Helps the model understand valid values.

**Input Schema:**
```typescript
{
  include?: ('invoice_states' | 'time_entry_fields' | 'date_formats' | 'metrics' | 'all')[];
}
```

**Output Schema:**
```typescript
{
  invoice_states: ['draft', 'open', 'paid', 'closed'];
  date_formats: {
    example: '2024-01-15',
    format: 'YYYY-MM-DD'
  };
  metrics: {
    profit: { formula: 'revenue - cost', unit: 'currency' },
    margin: { formula: '(profit / revenue) × 100', unit: 'percent', null_when: 'revenue = 0' },
    utilization: { formula: '(billable_hours / total_hours) × 100', unit: 'percent' },
    realization: { formula: '(actual_revenue / potential_revenue) × 100', unit: 'percent' },
    effective_rate: { formula: 'revenue / billable_hours', unit: 'currency_per_hour' }
  };
  revenue_modes: ['time_based', 'invoice_based', 'hybrid'];
  company_timezone: 'America/New_York';  // From Harvest company settings
  week_start_day: 'Monday';              // From Harvest company settings
}
```

---

### Layer 3: Compute Tools

#### `harvest_compute_profitability`

**Deterministic calculation** of profitability metrics. Does NOT fetch data—requires pre-fetched inputs.

**Input Schema:**
```typescript
{
  // REQUIRED: Pre-fetched time entries (from harvest_list_time_entries)
  time_entries: Array<{
    id: number;
    user_id: number;
    client_id: number;
    project_id: number;
    hours: number;
    billable: boolean;
    billable_rate: number | null;
    is_billed: boolean;
  }>;

  // REQUIRED: Rates (from harvest_get_rates)
  rates: {
    user_rates: { [user_id: number]: { cost_rate: number } };
    defaults: { cost_rate: number };
  };

  // OPTIONAL: Invoices (for invoice_based or hybrid mode)
  invoices?: Array<{
    id: number;
    client_id: number;
    project_id?: number;
    amount: number;
    state: string;
  }>;

  // Calculation options
  revenue_mode: 'time_based' | 'invoice_based' | 'hybrid';
  group_by: 'client' | 'project' | 'user' | 'total';

  // Optional filters on the provided data
  include_non_billable?: boolean;  // Include non-billable in cost (default: true)
  invoice_states?: string[];       // Which invoice states count (default: ['paid'])
}
```

**Output Schema:**
```typescript
{
  results: Array<{
    group_key: string;           // e.g., "client:123" or "user:456"
    group_id: number;
    group_name: string;

    // Hours breakdown
    total_hours: number;
    billable_hours: number;
    non_billable_hours: number;

    // Financial metrics
    revenue: number;             // Based on revenue_mode
    revenue_mode_used: string;
    cost: number;
    profit: number;
    margin_percent: number | null;
    effective_rate: number | null;

    // Source tracking
    time_entry_count: number;
    invoice_count?: number;
  }>;

  totals: {
    total_hours: number;
    billable_hours: number;
    revenue: number;
    cost: number;
    profit: number;
    margin_percent: number | null;
  };

  _computation: {
    revenue_mode: string;
    group_by: string;
    entries_processed: number;
    invoices_processed: number;
    cost_rate_sources: { [source: string]: number };  // Count by source
    warnings: string[];          // e.g., "12 entries missing billable_rate"
  };
}
```

---

#### `harvest_compute_utilization`

**Deterministic calculation** of utilization metrics.

**Input Schema:**
```typescript
{
  // REQUIRED: Pre-fetched time entries
  time_entries: Array<{
    user_id: number;
    hours: number;
    billable: boolean;
    spent_date: string;
  }>;

  // Options
  group_by: 'user' | 'project' | 'client' | 'day' | 'week' | 'month';
  capacity_hours_per_week?: number;  // For capacity utilization (default: 40)
}
```

**Output Schema:**
```typescript
{
  results: Array<{
    group_key: string;
    group_id: number | string;
    group_name: string;

    total_hours: number;
    billable_hours: number;
    non_billable_hours: number;

    utilization_percent: number;       // billable / total
    capacity_percent?: number;         // total / capacity (if capacity provided)
  }>;

  totals: {
    total_hours: number;
    billable_hours: number;
    utilization_percent: number;
  };

  _computation: {
    group_by: string;
    entries_processed: number;
    period_start: string;
    period_end: string;
  };
}
```

---

#### `harvest_aggregate_time` (Convenience - P2)

Simple time aggregation without profitability calculations.

**Input Schema:**
```typescript
{
  time_entries: Array<{ user_id: number; client_id: number; project_id: number; hours: number; spent_date: string; billable: boolean }>;
  group_by: 'user' | 'client' | 'project' | 'day' | 'week';
  sort_by?: 'hours_desc' | 'hours_asc' | 'name';
  limit?: number;
}
```

**Output Schema:**
```typescript
{
  results: Array<{
    group_key: string;
    group_name: string;
    total_hours: number;
    billable_hours: number;
    entry_count: number;
  }>;
}
```

---

## C) Deprecated Tools

The following question-specific tools are **REMOVED** in favor of the composable toolkit:

| Deprecated Tool | Replacement Composition |
|-----------------|------------------------|
| `harvest_analyze_client_profitability` | `list_time_entries` → `get_rates` → `compute_profitability(group_by: 'client')` |
| `harvest_analyze_client_losses` | `list_time_entries` → `get_rates` → `compute_profitability` → filter profit < 0 |
| `harvest_analyze_client_tenure` | `list_time_entries(auto_paginate)` → aggregate by client → min(spent_date) |
| `harvest_analyze_client_trends` | `list_time_entries` → `compute_profitability(group_by: 'month')` per client |
| `harvest_analyze_employee_profitability` | `list_time_entries` → `get_rates` → `compute_profitability(group_by: 'user')` |
| `harvest_analyze_employee_hours` | `list_time_entries` → `aggregate_time(group_by: 'user')` |
| `harvest_analyze_employee_efficiency` | `list_time_entries` → `compute_utilization(group_by: 'user')` |
| `harvest_analyze_revenue` | `list_invoices` or `list_time_entries` → `compute_profitability(group_by: 'month')` |
| `harvest_analyze_outstanding` | `list_invoices(state: 'open')` |
| `harvest_analyze_project_profitability` | `list_time_entries` → `get_rates` → `compute_profitability(group_by: 'project')` |

**Rationale for Deprecation:**
1. One-tool-per-question doesn't scale—new questions require new tools
2. Duplicated calculation logic across tools
3. Model can't customize or combine analyses
4. Opaque—user can't see intermediate data

---

## D) Migration Notes

### Example Query Compositions

#### "Who is my most profitable client?"

**Old approach:**
```
harvest_analyze_client_profitability(from: '2024-01-01', to: '2024-12-31')
```

**New approach:**
```
1. harvest_list_time_entries(from: '2024-01-01', to: '2024-12-31', auto_paginate: true)
2. harvest_get_rates(user_ids: [unique user_ids from step 1])
3. harvest_compute_profitability(
     time_entries: [step 1 result],
     rates: [step 2 result],
     revenue_mode: 'time_based',
     group_by: 'client'
   )
4. Sort results by profit descending, return top result
```

---

#### "What client did I lose the most amount on?"

**New approach:**
```
1. harvest_list_time_entries(from: ..., to: ..., auto_paginate: true)
2. harvest_get_rates(user_ids: [...])
3. harvest_compute_profitability(
     time_entries: [...],
     rates: {...},
     revenue_mode: 'time_based',
     group_by: 'client'
   )
4. Filter where profit < 0, sort by profit ascending
```

---

#### "Who is my longest term client?"

**New approach:**
```
1. harvest_list_time_entries(auto_paginate: true)  // Get all historical
2. Group by client_id, find min(spent_date) for each
3. Calculate days since first activity
4. Sort by tenure descending
```

Note: This is pure data manipulation, no compute tool needed.

---

#### "Which employee is most profitable for Client X last quarter?"

**New approach:**
```
1. harvest_resolve_entities(query: 'Client X', entity_types: ['client'])
2. harvest_list_time_entries(
     client_id: [resolved client_id],
     from: '2024-07-01',
     to: '2024-09-30',
     auto_paginate: true
   )
3. harvest_get_rates(user_ids: [unique user_ids from step 2])
4. harvest_compute_profitability(
     time_entries: [step 2],
     rates: [step 3],
     revenue_mode: 'time_based',
     group_by: 'user'
   )
5. Sort by profit descending
```

---

#### "Who worked the most this week?"

**New approach:**
```
1. harvest_get_schema(include: ['date_formats'])  // Get week_start_day
2. harvest_list_time_entries(from: [monday], to: [today])
3. harvest_aggregate_time(
     time_entries: [step 2],
     group_by: 'user',
     sort_by: 'hours_desc',
     limit: 10
   )
```

---

#### "What's my utilization rate for Q3?"

**New approach:**
```
1. harvest_list_time_entries(from: '2024-07-01', to: '2024-09-30', auto_paginate: true)
2. harvest_compute_utilization(
     time_entries: [step 1],
     group_by: 'user',
     capacity_hours_per_week: 40
   )
```

---

#### "Compare profitability: time-based vs invoice-based"

**New approach:**
```
1. harvest_list_time_entries(from: ..., to: ..., auto_paginate: true)
2. harvest_list_invoices(from: ..., to: ..., state: 'paid', auto_paginate: true)
3. harvest_get_rates(user_ids: [...])
4. harvest_compute_profitability(..., revenue_mode: 'time_based', group_by: 'total')
5. harvest_compute_profitability(..., revenue_mode: 'invoice_based', group_by: 'total')
6. Compare results
```

---

## Phase 1: Core Infrastructure

*(Unchanged from original—see sections 1.1-1.6)*

### Task 1.5: Remote HTTP Server (CRITICAL PATH)
**Status:** ✅ Partial (skeleton)
**Priority:** P0 - CRITICAL

- [x] Create Express app
- [x] Set up MCP StreamableHTTPServerTransport
- [x] Implement POST /mcp endpoint
- [x] Implement GET /mcp (SSE) endpoint
- [ ] Add CORS headers for cross-origin requests
- [ ] Add request logging middleware
- [ ] Add rate limiting middleware (server-level, separate from Harvest API limits)
- [ ] Test with actual Claude Desktop connection

---

## Phase 2: Data Access Layer

### Task 2.1: API Client Base
**Status:** ✅ Partial
**Priority:** P0
**Dependencies:** 1.4

**Requirements:**
- [ ] Implement pagination helper (auto-fetch multiple pages)
- [ ] Implement rate limit tracking (100 req/15s for Harvest)
- [ ] Implement request queue with backoff
- [ ] Implement response caching (LRU cache, 60s default TTL)
- [ ] Add `_meta` to all responses (api_calls_made, cached, cache_age)
- [ ] Handle 429 responses gracefully with retry_after

**Caching Strategy:**
```typescript
// Cache key format: tool_name:hash(params)
// Example: list_time_entries:a1b2c3d4
// TTL: 60 seconds for list operations
// Cache invalidation: on any write operation to same entity type
```

**Rate Limit Strategy:**
```typescript
// Track requests in sliding window
// If approaching limit (>80 req in last 15s), delay new requests
// If rate limited, return error with retry_after_seconds
// auto_paginate respects rate limits between pages
```

---

### Task 2.2: Data Wrapper Tools
**Status:** ✅ Partial
**Priority:** P0
**Dependencies:** 2.1

Implement MCP tools with consistent interface:

- [x] `harvest_list_time_entries` (needs pagination, caching)
- [x] `harvest_list_clients` (needs pagination, caching)
- [x] `harvest_list_projects` (needs pagination, caching)
- [ ] `harvest_list_users` (needs include_cost_rates option)
- [x] `harvest_list_tasks`

**All tools must:**
- Accept consistent filter parameters
- Return `pagination` object
- Return `_meta` object with API usage info
- Support `auto_paginate` option (max 10 pages)
- Cache results appropriately

---

### Task 2.3: Invoice Support (Optional)
**Status:** ✅ Partial
**Priority:** P2
**Dependencies:** 2.1

- [x] `harvest_list_invoices` basic implementation
- [ ] Add line_items expansion option
- [ ] Add allocation to client/project when possible

---

## Phase 3: Rates & Resolution Layer

### Task 3.1: Rates Source of Truth
**Status:** ❌ Not Started
**Priority:** P1
**Dependencies:** 2.2

Implement `harvest_get_rates` tool:

- [ ] Fetch user cost_rates from Harvest API
- [ ] Fetch project/task billable rates from Harvest API
- [ ] Implement `rates.json` config file fallback
- [ ] Implement `DEFAULT_COST_RATE` environment variable fallback
- [ ] Return rate source metadata for transparency
- [ ] Log warnings when falling back to defaults

**Config File Format (`rates.json`):**
```json
{
  "user_overrides": {
    "12345": { "cost_rate": 75.00 },
    "67890": { "cost_rate": 50.00 }
  },
  "defaults": {
    "cost_rate": 0,
    "billable_rate": null
  }
}
```

---

### Task 3.2: Entity Resolution
**Status:** ❌ Not Started
**Priority:** P1
**Dependencies:** 2.2

Implement `harvest_resolve_entities` tool:

- [ ] Fuzzy string matching for entity names
- [ ] Search across clients, projects, users, tasks
- [ ] Return confidence scores
- [ ] Cache entity lists for fast resolution
- [ ] Handle common variations (Inc, LLC, Corp, etc.)

---

### Task 3.3: Schema Definitions
**Status:** ❌ Not Started
**Priority:** P2
**Dependencies:** —

Implement `harvest_get_schema` tool:

- [ ] Return enum values (invoice states, etc.)
- [ ] Return metric definitions with formulas
- [ ] Return company timezone and week_start_day
- [ ] Provide example values

---

## Phase 4: Compute Layer

### Task 4.1: Compute Profitability
**Status:** ❌ Not Started
**Priority:** P1
**Dependencies:** 3.1

Implement `harvest_compute_profitability` tool:

- [ ] Accept pre-fetched time_entries and rates
- [ ] Support all three revenue modes (time_based, invoice_based, hybrid)
- [ ] Support group_by: client, project, user, total
- [ ] Calculate all metrics: profit, margin, effective_rate
- [ ] Track cost_rate sources used
- [ ] Return warnings for missing data (e.g., no billable_rate)
- [ ] Handle edge cases (zero revenue, zero hours)

**Test Cases:**
- [ ] All time billable, no invoices → time_based works
- [ ] All time invoiced → invoice_based matches invoice totals
- [ ] Mixed billed/unbilled → hybrid correctly splits
- [ ] Zero revenue → margin returns null, not divide-by-zero
- [ ] Missing cost_rate → uses default, logs warning

---

### Task 4.2: Compute Utilization
**Status:** ❌ Not Started
**Priority:** P1
**Dependencies:** 2.2

Implement `harvest_compute_utilization` tool:

- [ ] Accept pre-fetched time_entries
- [ ] Support group_by: user, project, client, day, week, month
- [ ] Calculate utilization (billable/total)
- [ ] Calculate capacity utilization if capacity provided
- [ ] Handle zero-hour periods

---

### Task 4.3: Aggregate Time
**Status:** ❌ Not Started
**Priority:** P2
**Dependencies:** 2.2

Implement `harvest_aggregate_time` convenience tool:

- [ ] Simple grouping and summing
- [ ] Support sorting and limiting
- [ ] No rate/profitability calculations

---

## Phase 5: Testing

### Task 5.1: Unit Tests
**Priority:** P1
**Dependencies:** Phase 4

- [ ] Test compute_profitability with all revenue modes
- [ ] Test compute_utilization with various groupings
- [ ] Test rate resolution priority order
- [ ] Test entity resolution fuzzy matching
- [ ] Test edge cases (nulls, zeros, missing data)

### Task 5.2: Integration Tests
**Priority:** P1

- [ ] Test full composition: list → rates → compute
- [ ] Test pagination with rate limiting
- [ ] Test caching behavior

### Task 5.3: E2E Tests
**Priority:** P2

- [ ] Test Claude Desktop connection
- [ ] Test multi-step query composition
- [ ] Test with real Harvest sandbox account

---

## Phase 6: Deployment

*(Unchanged from original—see sections 5.1-5.3, now renumbered as 6.1-6.3)*

---

## Quick Reference: Revised Tool Composition

| User Question | Tool Sequence |
|---------------|---------------|
| "Most profitable client?" | `list_time_entries` → `get_rates` → `compute_profitability(group_by: client)` |
| "Biggest loss client?" | Same as above → filter profit < 0 |
| "Longest term client?" | `list_time_entries(all)` → group by client → min(date) |
| "Most profitable employee?" | `list_time_entries` → `get_rates` → `compute_profitability(group_by: user)` |
| "Who worked most this week?" | `list_time_entries(this_week)` → `aggregate_time(group_by: user)` |
| "Utilization by team?" | `list_time_entries` → `compute_utilization(group_by: user)` |
| "Revenue this quarter?" | `list_time_entries` → `get_rates` → `compute_profitability(group_by: total)` |
| "Compare time vs invoice revenue?" | Run `compute_profitability` twice with different `revenue_mode` |
