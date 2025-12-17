# Harvest MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides AI assistants with access to the [Harvest](https://www.getharvest.com/) time tracking API.

**Live Server:** https://harvest-mcp.southleft.com

## Features

### Time Tracking
- **harvest_list_time_entries** - List and filter time entries by user, client, project, date range
- **harvest_get_time_entry** - Get a specific time entry by ID
- **harvest_create_time_entry** - Create new time entries with optional timer
- **harvest_stop_timer** - Stop a running timer

### Data Access
- **harvest_get_company** - Get authenticated company/account info
- **harvest_get_current_user** - Get current user info
- **harvest_list_users** - List all users with filters
- **harvest_list_clients** - List all clients
- **harvest_list_projects** - List all projects
- **harvest_list_tasks** - List all tasks
- **harvest_list_invoices** - List invoices with filters
- **harvest_list_expenses** - List expenses with filters

### Analytics & Metrics
- **harvest_compute_profitability** - Calculate profitability (time-based, invoice-based, or hybrid modes)
- **harvest_compute_utilization** - Calculate utilization metrics with capacity tracking
- **harvest_aggregate_time** - Aggregate time entries by client, project, user, date, week, or month

### Utilities
- **harvest_get_rates** - Get cost and billable rates with fallback support
- **harvest_resolve_entities** - Fuzzy search for clients, projects, users, tasks by name
- **harvest_get_schema** - Get schema definitions and enum values (no auth required)

## Quick Start

### Option 1: Claude Desktop Connectors (Recommended)

The easiest way to add this MCP server:

1. Open Claude Desktop
2. Go to **Settings** → **Connectors**
3. Click **Add Connector**
4. Enter the URL: `https://harvest-mcp.southleft.com/mcp`
5. Click **Connect**

### Option 2: Claude Code CLI

```bash
claude mcp add --transport http harvest https://harvest-mcp.southleft.com/mcp
```

### Option 3: Manual Config File

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "harvest": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://harvest-mcp.southleft.com/mcp"]
    }
  }
}
```

Restart Claude Desktop after editing the config file.

### Authentication

On first use, you'll receive an OAuth authorization URL. Click it to connect your Harvest account, then return to Claude.

## Self-Hosting

### Option 1: Cloudflare Workers (Recommended)

1. **Clone and install**
   ```bash
   git clone https://github.com/southleft/harvest-mcp.git
   cd harvest-mcp
   npm install
   ```

2. **Create Harvest OAuth App**
   - Go to [Harvest Developers](https://id.getharvest.com/developers)
   - Create a new OAuth2 application
   - Set redirect URI to `https://your-worker.workers.dev/callback`
   - Note your Client ID and Client Secret

3. **Configure Cloudflare**
   ```bash
   # Update wrangler.toml with your account_id

   # Create KV namespaces
   npx wrangler kv:namespace create SESSIONS
   npx wrangler kv:namespace create RATES_CONFIG

   # Update wrangler.toml with the KV namespace IDs

   # Set secrets
   echo "YOUR_CLIENT_ID" | npx wrangler secret put HARVEST_CLIENT_ID
   echo "YOUR_CLIENT_SECRET" | npx wrangler secret put HARVEST_CLIENT_SECRET
   echo "YOUR_SESSION_SECRET" | npx wrangler secret put SESSION_SECRET
   ```

4. **Deploy**
   ```bash
   npm run deploy
   ```

### Option 2: Node.js Server

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your Harvest credentials

# Development
npm run dev

# Production
npm run build && npm start
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Landing page |
| `/health` | GET | Health check |
| `/mcp` | POST | MCP protocol endpoint |
| `/callback` | GET | OAuth callback |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `HARVEST_CLIENT_ID` | Harvest OAuth Client ID | Yes |
| `HARVEST_CLIENT_SECRET` | Harvest OAuth Client Secret | Yes |
| `SESSION_SECRET` | Secret for session encryption | Yes |
| `SESSION_TTL_HOURS` | Session lifetime in hours | No (default: 24) |
| `ALLOWED_ORIGINS` | CORS allowed origins | No |
| `DEFAULT_COST_RATE` | Fallback cost rate | No |

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Claude/MCP     │────▶│  Cloudflare      │────▶│  Harvest        │
│  Client         │◀────│  Workers         │◀────│  API            │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  Cloudflare KV   │
                        │  (Sessions)      │
                        └──────────────────┘
```

**Stack:**
- [Hono](https://hono.dev/) - Web framework for Cloudflare Workers
- [MCP SDK](https://github.com/modelcontextprotocol/sdk) - Model Context Protocol
- [Cloudflare KV](https://developers.cloudflare.com/kv/) - Session storage
- [Harvest API v2](https://help.getharvest.com/api-v2/) - Time tracking API

## Development

```bash
# Install dependencies
npm install

# Run locally with wrangler
npm run dev:workers

# Run tests
npm test

# Lint & format
npm run lint
npm run format
```

## Project Structure

```
src/
├── workers/              # Cloudflare Workers entry point
│   ├── index.ts          # Hono app with MCP endpoint
│   ├── config.ts         # Workers config loader
│   ├── kv-session-store.ts
│   └── types.ts
├── tools/                # MCP tool implementations
│   ├── time-entries.ts
│   ├── clients.ts
│   ├── projects.ts
│   ├── compute/          # Analytics tools
│   │   ├── profitability.ts
│   │   ├── utilization.ts
│   │   └── aggregation.ts
│   └── ...
├── api/                  # Harvest API client
├── auth/                 # OAuth implementation
└── session/              # Session management
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

Built by [Southleft](https://southleft.com)
