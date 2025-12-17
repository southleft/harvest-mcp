# Harvest MCP Server - Product Requirements Document

## 1. Executive Summary

### Product Vision
The Harvest MCP Server is a remote Model Context Protocol (MCP) server that enables AI assistants and LLM-powered applications to interact with the Harvest time tracking and invoicing platform. Users can authenticate via OAuth2 and grant AI systems full access to their Harvest data including clients, projects, time entries, invoices, and expenses.

### Target Audience
- AI application developers integrating time tracking capabilities
- Teams using AI assistants for project management workflows
- Developers building custom AI-powered productivity tools
- Businesses seeking to automate time tracking and invoicing via AI

### Unique Value Proposition
- **First-class MCP Support**: Native implementation of MCP specification 2025-11-25
- **Secure OAuth2 Flow**: Industry-standard authentication without exposing credentials to AI
- **Comprehensive API Coverage**: Full access to Harvest's time tracking, invoicing, and reporting
- **Remote Server Architecture**: Accessible from any MCP-compatible client over HTTPS

## 2. Product Goals & Objectives

### Primary Goals
1. Enable secure, authenticated access to Harvest API via MCP
2. Support all major Harvest operations (CRUD for time, clients, projects, invoices)
3. Maintain high reliability and low latency for AI interactions
4. Follow MCP security best practices

### Success Metrics
| Metric | Target |
|--------|--------|
| Authentication Success Rate | > 99% |
| API Call Latency (server) | < 500ms |
| Token Refresh Success | > 99.9% |
| Tool Coverage | 100% of planned endpoints |
| Uptime | 99.9% |

## 3. Functional Requirements

### 3.1 Authentication

#### FR-AUTH-001: OAuth2 Authorization Code Flow
- Server MUST implement Harvest OAuth2 Authorization Code flow
- Server MUST use URL Mode Elicitation to initiate authentication
- Server MUST securely exchange authorization codes for tokens
- Server MUST store tokens per-session, never exposing to clients

#### FR-AUTH-002: Token Management
- Server MUST automatically refresh tokens before expiry
- Server MUST handle refresh failures by re-initiating authentication
- Server MUST support multiple Harvest accounts per user

#### FR-AUTH-003: Session Management
- Server MUST implement MCP session management via `MCP-Session-Id` header
- Sessions MUST be cryptographically secure (UUID v4)
- Sessions MUST timeout after configurable inactivity period

### 3.2 MCP Tools

#### Account & Company
| Tool | Description | Priority |
|------|-------------|----------|
| `harvest_get_company` | Get company information | P0 |
| `harvest_get_current_user` | Get authenticated user info | P0 |
| `harvest_list_accounts` | List accessible Harvest accounts | P0 |

#### Time Tracking
| Tool | Description | Priority |
|------|-------------|----------|
| `harvest_list_time_entries` | List time entries with filters | P0 |
| `harvest_get_time_entry` | Get specific time entry | P0 |
| `harvest_create_time_entry` | Create new time entry | P0 |
| `harvest_update_time_entry` | Update existing time entry | P0 |
| `harvest_delete_time_entry` | Delete time entry | P1 |
| `harvest_start_timer` | Start timer on time entry | P1 |
| `harvest_stop_timer` | Stop running timer | P1 |

#### Clients
| Tool | Description | Priority |
|------|-------------|----------|
| `harvest_list_clients` | List all clients | P0 |
| `harvest_get_client` | Get specific client | P0 |
| `harvest_create_client` | Create new client | P1 |
| `harvest_update_client` | Update client | P1 |
| `harvest_delete_client` | Delete client | P2 |

#### Projects
| Tool | Description | Priority |
|------|-------------|----------|
| `harvest_list_projects` | List projects | P0 |
| `harvest_get_project` | Get specific project | P0 |
| `harvest_create_project` | Create project | P1 |
| `harvest_update_project` | Update project | P1 |
| `harvest_delete_project` | Delete project | P2 |

#### Invoices
| Tool | Description | Priority |
|------|-------------|----------|
| `harvest_list_invoices` | List invoices | P0 |
| `harvest_get_invoice` | Get specific invoice | P0 |
| `harvest_create_invoice` | Create invoice from time/expenses | P1 |
| `harvest_send_invoice` | Send invoice to client | P2 |

#### Expenses
| Tool | Description | Priority |
|------|-------------|----------|
| `harvest_list_expenses` | List expenses | P1 |
| `harvest_get_expense` | Get specific expense | P1 |
| `harvest_create_expense` | Create expense | P1 |
| `harvest_update_expense` | Update expense | P2 |

#### Reports
| Tool | Description | Priority |
|------|-------------|----------|
| `harvest_uninvoiced_report` | Get uninvoiced hours/expenses | P1 |
| `harvest_time_report_clients` | Time totals by client | P1 |
| `harvest_expense_report_projects` | Expense totals by project | P2 |

### 3.3 Transport & Protocol

#### FR-TRANS-001: Streamable HTTP
- Server MUST implement MCP Streamable HTTP transport
- Server MUST support single `/mcp` endpoint for POST and GET
- Server MUST support SSE for server-initiated messages

#### FR-TRANS-002: Session Headers
- Server MUST generate `MCP-Session-Id` on initialization
- Server MUST validate session ID on all subsequent requests
- Server MUST return 404 for invalid/expired sessions

## 4. Non-Functional Requirements

### 4.1 Security

#### NFR-SEC-001: Origin Validation
- Server MUST validate Origin header on all requests
- Server MUST return 403 Forbidden for invalid origins

#### NFR-SEC-002: Token Security
- Harvest tokens MUST never be sent to clients
- Tokens MUST be encrypted at rest in production
- Tokens MUST be transmitted only over HTTPS

#### NFR-SEC-003: Rate Limiting
- Server MUST respect Harvest API rate limits (100 req/15s)
- Server SHOULD implement request queuing for burst protection

### 4.2 Performance

#### NFR-PERF-001: Latency
- Server-side processing MUST complete within 500ms
- Token refresh MUST complete within 2 seconds

#### NFR-PERF-002: Scalability
- Architecture MUST support horizontal scaling
- Session storage MUST be externalized for multi-instance deployment

### 4.3 Reliability

#### NFR-REL-001: Availability
- Target uptime: 99.9%
- Graceful degradation on Harvest API outages

#### NFR-REL-002: Error Handling
- All errors MUST return proper JSON-RPC error responses
- Authentication failures MUST trigger re-authentication flow

## 5. User Stories

### US-001: Initial Authentication
**As a** user connecting to the Harvest MCP
**I want to** authenticate with my Harvest account
**So that** the AI can access my time tracking data

**Acceptance Criteria:**
- I receive a URL to authorize the application
- After authorizing, I can immediately use Harvest tools
- My tokens are securely stored for future requests

### US-002: Log Time via AI
**As a** user with an authenticated session
**I want to** ask the AI to log time to a project
**So that** I don't have to manually enter time entries

**Acceptance Criteria:**
- AI can list my projects to let me choose
- AI can create time entry with date, hours, notes
- I receive confirmation of the logged time

### US-003: Review Uninvoiced Time
**As a** project manager
**I want to** ask the AI about uninvoiced time
**So that** I can ensure clients are billed promptly

**Acceptance Criteria:**
- AI can run uninvoiced report for date range
- AI presents results organized by client/project
- AI can suggest creating invoices for unbilled time

## 6. Technical Constraints

### Required Dependencies
- Node.js >= 18.0.0
- TypeScript >= 5.0
- @modelcontextprotocol/sdk (latest)
- Express.js >= 4.18

### External Service Dependencies
- Harvest API v2 (https://api.harvestapp.com/v2)
- Harvest OAuth (https://id.getharvest.com)

### Hosting Requirements
- HTTPS with valid SSL certificate
- Publicly accessible URL for OAuth callback
- Persistent storage for sessions (Redis recommended)

## 7. Release Phases

### Phase 1: MVP (P0 Tools)
- OAuth authentication flow
- Core read operations (company, user, accounts)
- Time entry CRUD
- Client and project listing
- Invoice listing

### Phase 2: Extended Operations
- Time entry timer controls
- Client and project CRUD
- Invoice creation
- Expense CRUD

### Phase 3: Reports & Polish
- All report tools
- Production Redis integration
- Docker containerization
- Comprehensive monitoring

## 8. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Harvest API rate limits | High | Medium | Request queuing, caching |
| OAuth token expiry during session | Medium | Low | Proactive refresh, graceful re-auth |
| Session storage loss | High | Low | Redis persistence, backup strategy |
| Harvest API changes | Medium | Low | Version pinning, monitoring |

## 9. Open Questions

1. Should we support Harvest Forecast integration?
2. Do we need offline/queue mode for bulk operations?
3. Should we implement MCP Resources for Harvest data?
4. Multi-tenant hosting vs. self-hosted deployment model?

---

*Document Version: 1.0*
*Last Updated: December 2024*
