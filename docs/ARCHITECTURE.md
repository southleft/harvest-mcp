# Harvest MCP Server - Technical Architecture

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           MCP Clients                                    │
│  (Claude Desktop, AI Assistants, Custom Applications)                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS (Streamable HTTP)
                                    │ MCP-Session-Id Header
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Harvest MCP Server                                │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐               │
│  │   Express.js  │  │  MCP Server   │  │   Session     │               │
│  │   HTTP Layer  │──│   (SDK)       │──│   Manager     │               │
│  └───────────────┘  └───────────────┘  └───────────────┘               │
│         │                   │                   │                       │
│         │           ┌───────┴───────┐           │                       │
│         │           │  Tool Router  │           │                       │
│         │           └───────┬───────┘           │                       │
│         │                   │                   │                       │
│  ┌──────┴──────┐    ┌───────┴───────┐   ┌──────┴──────┐                │
│  │   OAuth     │    │   Harvest     │   │   Storage   │                │
│  │   Handler   │    │   API Client  │   │   (Redis)   │                │
│  └─────────────┘    └───────────────┘   └─────────────┘                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Harvest Services                                │
│  ┌─────────────────────┐        ┌─────────────────────┐                 │
│  │   Harvest API v2    │        │   Harvest OAuth     │                 │
│  │ api.harvestapp.com  │        │  id.getharvest.com  │                 │
│  └─────────────────────┘        └─────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────────┘
```

## 2. Component Architecture

### 2.1 Express HTTP Layer

The HTTP layer handles all incoming requests and implements MCP Streamable HTTP transport.

```typescript
// Endpoint: POST /mcp
// Handles: JSON-RPC requests, notifications, responses

// Endpoint: GET /mcp
// Handles: SSE stream for server-initiated messages

// Endpoint: DELETE /mcp
// Handles: Session termination

// Endpoint: GET /callback
// Handles: OAuth callback from Harvest
```

**Responsibilities:**
- Parse incoming HTTP requests
- Validate Origin headers (security)
- Route to appropriate handlers
- Manage SSE connections
- Handle OAuth callbacks

### 2.2 MCP Server (SDK Integration)

Utilizes `@modelcontextprotocol/sdk` for protocol handling.

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const server = new McpServer({
  name: 'harvest-mcp',
  version: '1.0.0',
  capabilities: {
    tools: { listChanged: true },
    elicitation: { url: true }
  }
});
```

**Responsibilities:**
- Register and expose MCP tools
- Handle tool invocations
- Manage capability negotiation
- Send elicitation requests for OAuth

### 2.3 Session Manager

Manages user sessions and associated Harvest credentials.

```typescript
interface Session {
  id: string;
  harvestAccessToken: string;
  harvestRefreshToken: string;
  harvestAccountId: string;
  tokenExpiresAt: Date;
  userId: number;
  createdAt: Date;
  lastAccessedAt: Date;
}

interface SessionStore {
  get(sessionId: string): Promise<Session | null>;
  set(sessionId: string, session: Session): Promise<void>;
  delete(sessionId: string): Promise<void>;
  touch(sessionId: string): Promise<void>;
}
```

**Implementations:**
- `MemorySessionStore` - Development/testing
- `RedisSessionStore` - Production deployment

### 2.4 OAuth Handler

Implements Harvest OAuth2 Authorization Code flow.

```typescript
class HarvestOAuth {
  // Generate authorization URL with state
  getAuthorizationUrl(sessionId: string): string;

  // Exchange code for tokens
  async exchangeCode(code: string): Promise<TokenResponse>;

  // Refresh access token
  async refreshToken(refreshToken: string): Promise<TokenResponse>;

  // Validate and decode state parameter
  validateState(state: string): string | null;
}
```

**OAuth Flow:**
```
1. Client connects → Server creates session
2. Server sends elicitation (URL mode) → Authorization URL
3. User authorizes in browser → Harvest redirects with code
4. Server exchanges code → Receives tokens
5. Server stores tokens in session → Sends elicitation complete
6. Client can now call tools
```

### 2.5 Harvest API Client

Type-safe wrapper for Harvest API v2.

```typescript
class HarvestClient {
  constructor(accessToken: string, accountId: string);

  // Company & Users
  async getCompany(): Promise<Company>;
  async getCurrentUser(): Promise<User>;
  async listUsers(params?: ListParams): Promise<PaginatedResponse<User>>;

  // Time Entries
  async listTimeEntries(params?: TimeEntryParams): Promise<PaginatedResponse<TimeEntry>>;
  async getTimeEntry(id: number): Promise<TimeEntry>;
  async createTimeEntry(data: CreateTimeEntry): Promise<TimeEntry>;
  async updateTimeEntry(id: number, data: UpdateTimeEntry): Promise<TimeEntry>;
  async deleteTimeEntry(id: number): Promise<void>;

  // Clients, Projects, Invoices, Expenses...
}
```

**Error Handling:**
```typescript
class HarvestApiError extends Error {
  statusCode: number;
  errorCode: string;
  isRateLimited: boolean;
  retryAfter?: number;
}
```

### 2.6 Tool Router

Routes tool calls to appropriate handlers with session context.

```typescript
type ToolHandler = (
  params: Record<string, unknown>,
  session: Session
) => Promise<ToolResult>;

const toolHandlers: Map<string, ToolHandler> = new Map([
  ['harvest_get_company', handlers.getCompany],
  ['harvest_list_time_entries', handlers.listTimeEntries],
  // ...
]);
```

## 3. Authentication Flow

### 3.1 Sequence Diagram

```
┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Client │     │  MCP Server │     │   Harvest   │     │    User     │
└────┬────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
     │                 │                   │                   │
     │ Initialize      │                   │                   │
     │────────────────>│                   │                   │
     │                 │                   │                   │
     │ InitializeResult│                   │                   │
     │ (with session)  │                   │                   │
     │<────────────────│                   │                   │
     │                 │                   │                   │
     │ Call Tool       │                   │                   │
     │────────────────>│                   │                   │
     │                 │                   │                   │
     │                 │ No token in session                   │
     │                 │──────────┐        │                   │
     │                 │          │        │                   │
     │                 │<─────────┘        │                   │
     │                 │                   │                   │
     │ Elicitation     │                   │                   │
     │ (URL mode)      │                   │                   │
     │<────────────────│                   │                   │
     │                 │                   │                   │
     │                 │                   │  Open Auth URL    │
     │                 │                   │<──────────────────│
     │                 │                   │                   │
     │                 │                   │  Authorize App    │
     │                 │                   │──────────────────>│
     │                 │                   │                   │
     │                 │  Callback (code)  │                   │
     │                 │<──────────────────│                   │
     │                 │                   │                   │
     │                 │  Exchange Code    │                   │
     │                 │──────────────────>│                   │
     │                 │                   │                   │
     │                 │  Tokens           │                   │
     │                 │<──────────────────│                   │
     │                 │                   │                   │
     │ Elicitation     │                   │                   │
     │ Complete        │                   │                   │
     │<────────────────│                   │                   │
     │                 │                   │                   │
     │ Call Tool       │                   │                   │
     │────────────────>│                   │                   │
     │                 │                   │                   │
     │                 │  API Request      │                   │
     │                 │──────────────────>│                   │
     │                 │                   │                   │
     │                 │  API Response     │                   │
     │                 │<──────────────────│                   │
     │                 │                   │                   │
     │ Tool Result     │                   │                   │
     │<────────────────│                   │                   │
     │                 │                   │                   │
```

### 3.2 Token Refresh Flow

```typescript
async function ensureValidToken(session: Session): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(session.tokenExpiresAt);
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  if (now.getTime() + bufferMs < expiresAt.getTime()) {
    return session.harvestAccessToken;
  }

  // Token expired or expiring soon, refresh
  const oauth = new HarvestOAuth();
  const newTokens = await oauth.refreshToken(session.harvestRefreshToken);

  session.harvestAccessToken = newTokens.access_token;
  session.harvestRefreshToken = newTokens.refresh_token;
  session.tokenExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

  await sessionStore.set(session.id, session);

  return session.harvestAccessToken;
}
```

## 4. Data Models

### 4.1 Harvest Types

```typescript
// Core entities
interface Company {
  base_uri: string;
  full_domain: string;
  name: string;
  is_active: boolean;
  week_start_day: string;
  time_format: string;
  date_format: string;
  currency_code_display: string;
  expense_feature: boolean;
  invoice_feature: boolean;
  estimate_feature: boolean;
}

interface User {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  timezone: string;
  is_contractor: boolean;
  is_active: boolean;
  roles: string[];
  access_roles: string[];
  weekly_capacity: number;
  default_hourly_rate: number;
}

interface TimeEntry {
  id: number;
  spent_date: string;
  hours: number;
  notes: string | null;
  is_locked: boolean;
  is_closed: boolean;
  is_billed: boolean;
  is_running: boolean;
  billable: boolean;
  budgeted: boolean;
  billable_rate: number;
  cost_rate: number;
  user: { id: number; name: string };
  client: { id: number; name: string };
  project: { id: number; name: string; code: string };
  task: { id: number; name: string };
}

interface Client {
  id: number;
  name: string;
  is_active: boolean;
  currency: string;
  address: string | null;
  statement_key: string;
}

interface Project {
  id: number;
  name: string;
  code: string;
  is_active: boolean;
  is_billable: boolean;
  bill_by: string;
  budget: number | null;
  budget_by: string;
  client: { id: number; name: string };
}

interface Invoice {
  id: number;
  number: string;
  amount: number;
  due_amount: number;
  state: 'draft' | 'open' | 'paid' | 'closed';
  issue_date: string;
  due_date: string;
  client: { id: number; name: string };
  line_items: InvoiceLineItem[];
}

interface Expense {
  id: number;
  notes: string | null;
  total_cost: number;
  is_billed: boolean;
  spent_date: string;
  billable: boolean;
  user: { id: number; name: string };
  project: { id: number; name: string; code: string };
  expense_category: { id: number; name: string };
}
```

### 4.2 MCP Tool Schemas

```typescript
// Example: harvest_list_time_entries
const listTimeEntriesSchema = {
  name: 'harvest_list_time_entries',
  description: 'List time entries with optional filters',
  inputSchema: {
    type: 'object',
    properties: {
      user_id: { type: 'number', description: 'Filter by user ID' },
      client_id: { type: 'number', description: 'Filter by client ID' },
      project_id: { type: 'number', description: 'Filter by project ID' },
      is_billed: { type: 'boolean', description: 'Filter by billed status' },
      is_running: { type: 'boolean', description: 'Filter by running timer' },
      from: { type: 'string', format: 'date', description: 'Start date (YYYY-MM-DD)' },
      to: { type: 'string', format: 'date', description: 'End date (YYYY-MM-DD)' },
      page: { type: 'number', description: 'Page number (default: 1)' },
      per_page: { type: 'number', description: 'Results per page (1-2000)' }
    }
  }
};

// Example: harvest_create_time_entry
const createTimeEntrySchema = {
  name: 'harvest_create_time_entry',
  description: 'Create a new time entry',
  inputSchema: {
    type: 'object',
    required: ['project_id', 'task_id', 'spent_date'],
    properties: {
      project_id: { type: 'number', description: 'Project ID' },
      task_id: { type: 'number', description: 'Task ID' },
      spent_date: { type: 'string', format: 'date', description: 'Date (YYYY-MM-DD)' },
      hours: { type: 'number', description: 'Hours to log (omit for timer)' },
      notes: { type: 'string', description: 'Notes/description' },
      started_time: { type: 'string', description: 'Start time (HH:MM)' },
      ended_time: { type: 'string', description: 'End time (HH:MM)' }
    }
  }
};
```

## 5. Directory Structure

```
harvest-mcp/
├── src/
│   ├── index.ts                    # Application entry point
│   ├── server.ts                   # MCP server initialization
│   ├── config.ts                   # Configuration management
│   │
│   ├── http/
│   │   ├── app.ts                  # Express app setup
│   │   ├── routes.ts               # HTTP routes
│   │   └── middleware/
│   │       ├── origin.ts           # Origin validation
│   │       ├── session.ts          # Session middleware
│   │       └── error.ts            # Error handling
│   │
│   ├── auth/
│   │   ├── oauth.ts                # Harvest OAuth client
│   │   ├── callback.ts             # OAuth callback handler
│   │   └── elicitation.ts          # MCP elicitation helpers
│   │
│   ├── session/
│   │   ├── types.ts                # Session interfaces
│   │   ├── store.ts                # SessionStore interface
│   │   ├── memory-store.ts         # In-memory implementation
│   │   └── redis-store.ts          # Redis implementation
│   │
│   ├── harvest/
│   │   ├── client.ts               # Harvest API client
│   │   ├── types.ts                # Harvest type definitions
│   │   └── errors.ts               # API error handling
│   │
│   ├── tools/
│   │   ├── index.ts                # Tool registration
│   │   ├── registry.ts             # Tool schema registry
│   │   ├── account.ts              # Company/user/account tools
│   │   ├── time-entries.ts         # Time entry tools
│   │   ├── clients.ts              # Client tools
│   │   ├── projects.ts             # Project tools
│   │   ├── invoices.ts             # Invoice tools
│   │   ├── expenses.ts             # Expense tools
│   │   └── reports.ts              # Report tools
│   │
│   └── utils/
│       ├── logger.ts               # Logging utility
│       └── rate-limiter.ts         # Rate limiting
│
├── tests/
│   ├── unit/
│   │   ├── harvest-client.test.ts
│   │   ├── session-store.test.ts
│   │   └── tools/*.test.ts
│   └── integration/
│       ├── oauth-flow.test.ts
│       └── tool-execution.test.ts
│
├── docs/
│   ├── PRD.md                      # Product requirements
│   ├── ARCHITECTURE.md             # This document
│   └── API.md                      # Tool API documentation
│
├── .env.example                    # Environment template
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## 6. Configuration

### 6.1 Environment Variables

```env
# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Harvest OAuth
HARVEST_CLIENT_ID=your_client_id
HARVEST_CLIENT_SECRET=your_client_secret
HARVEST_REDIRECT_URI=https://your-domain.com/callback

# Security
ALLOWED_ORIGINS=https://claude.ai,https://your-app.com
SESSION_SECRET=your_secure_random_string
SESSION_TTL_HOURS=24

# Storage (Production)
REDIS_URL=redis://localhost:6379

# Logging
LOG_LEVEL=info
```

### 6.2 Configuration Schema

```typescript
interface Config {
  server: {
    port: number;
    host: string;
    nodeEnv: 'development' | 'production' | 'test';
  };
  harvest: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    apiBaseUrl: string;      // https://api.harvestapp.com/v2
    authBaseUrl: string;     // https://id.getharvest.com
  };
  security: {
    allowedOrigins: string[];
    sessionSecret: string;
    sessionTtlHours: number;
  };
  storage: {
    type: 'memory' | 'redis';
    redisUrl?: string;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}
```

## 7. Security Implementation

### 7.1 Origin Validation

```typescript
function validateOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  const allowedOrigins = config.security.allowedOrigins;

  if (origin && !allowedOrigins.includes(origin)) {
    return res.status(403).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Forbidden: Invalid origin'
      },
      id: null
    });
  }

  next();
}
```

### 7.2 Session Security

```typescript
function generateSessionId(): string {
  return crypto.randomUUID();
}

function validateSessionId(sessionId: string): boolean {
  // UUID v4 format validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(sessionId);
}
```

### 7.3 Rate Limiting

```typescript
class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private readonly limit = 100;
  private readonly windowMs = 15000; // 15 seconds (Harvest limit)

  canProceed(sessionId: string): boolean {
    const now = Date.now();
    const timestamps = this.requests.get(sessionId) || [];
    const recentTimestamps = timestamps.filter(t => now - t < this.windowMs);

    if (recentTimestamps.length >= this.limit) {
      return false;
    }

    recentTimestamps.push(now);
    this.requests.set(sessionId, recentTimestamps);
    return true;
  }
}
```

## 8. Error Handling

### 8.1 Error Types

```typescript
enum ErrorCode {
  // MCP Standard Errors
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,

  // Custom Errors
  AUTH_REQUIRED = -32001,
  SESSION_INVALID = -32002,
  HARVEST_API_ERROR = -32003,
  RATE_LIMITED = -32004,
  TOKEN_REFRESH_FAILED = -32005
}
```

### 8.2 Error Response Format

```typescript
interface JsonRpcError {
  jsonrpc: '2.0';
  error: {
    code: number;
    message: string;
    data?: {
      details?: string;
      harvestError?: object;
      retryAfter?: number;
    };
  };
  id: string | number | null;
}
```

## 9. Deployment

### 9.1 Docker Configuration

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### 9.2 Docker Compose (Development)

```yaml
version: '3.8'
services:
  harvest-mcp:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

### 9.3 Production Checklist

- [ ] SSL/TLS certificate configured
- [ ] Environment variables secured (not in code)
- [ ] Redis persistence enabled
- [ ] Logging aggregation configured
- [ ] Health check endpoint implemented
- [ ] Rate limiting verified
- [ ] Origin allowlist finalized
- [ ] Monitoring and alerting configured

---

*Document Version: 1.0*
*Last Updated: December 2024*
