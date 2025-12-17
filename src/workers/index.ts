/**
 * Harvest MCP Server - Cloudflare Workers Entry Point
 *
 * A remote MCP server running on Cloudflare Workers that provides
 * access to the Harvest time tracking API via OAuth2 authentication.
 *
 * Uses stateless MCP mode since Workers can't maintain persistent connections.
 * OAuth sessions are managed separately via KV storage.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import type { Env } from './types.js';
import { KVSessionStore } from './kv-session-store.js';
import { loadWorkersConfig } from './config.js';
import { HarvestOAuth } from '../auth/oauth.js';
import { registerTools } from '../tools/index.js';
import type { Session } from '../session/types.js';

// Create Hono app with environment type
const app = new Hono<{ Bindings: Env }>();

/**
 * CORS middleware - allows Claude Desktop and other MCP clients
 */
app.use('*', cors({
  origin: (origin, c) => {
    const allowedOrigins = c.env.ALLOWED_ORIGINS?.split(',') || ['https://claude.ai', 'https://app.claude.ai'];
    // Allow requests with no origin (like curl or same-origin)
    if (!origin) return '*';
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return origin;
    }
    return null;
  },
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'mcp-session-id', 'x-harvest-session', 'Authorization', 'Last-Event-ID', 'mcp-protocol-version'],
  exposeHeaders: ['mcp-session-id', 'x-harvest-session', 'mcp-protocol-version'],
  credentials: true,
  maxAge: 86400,
}));

/**
 * Root endpoint - landing page
 */
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Harvest MCP Server</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          h1 { color: #fa5d00; }
          code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; }
          .endpoint { margin: 10px 0; }
        </style>
      </head>
      <body>
        <h1>🌾 Harvest MCP Server</h1>
        <p>A Model Context Protocol server for the Harvest time tracking API.</p>

        <h2>Endpoints</h2>
        <div class="endpoint"><code>GET /health</code> - Health check</div>
        <div class="endpoint"><code>POST /mcp</code> - MCP protocol endpoint</div>
        <div class="endpoint"><code>GET /callback</code> - OAuth callback</div>

        <h2>Usage</h2>
        <p>Connect using an MCP client (like Claude Desktop) with:</p>
        <code>https://harvest-mcp.southleft-llc.workers.dev/mcp</code>

        <h2>Tools Available</h2>
        <ul>
          <li>Time entry management</li>
          <li>Project & client listing</li>
          <li>Profitability & utilization metrics</li>
          <li>Entity resolution (fuzzy search)</li>
          <li>Rate management</li>
        </ul>

        <p style="margin-top: 30px; color: #666; font-size: 14px;">
          Version 0.1.0 | Running on Cloudflare Workers
        </p>
      </body>
    </html>
  `);
});

/**
 * Health check endpoint
 */
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    version: '0.1.0',
    runtime: 'cloudflare-workers',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Create a session object - either from KV or a new empty one
 */
async function getOrCreateSession(
  sessionStore: KVSessionStore,
  harvestSessionId: string | undefined
): Promise<Session> {
  // If we have a harvest session ID, try to load it
  if (harvestSessionId) {
    const existingSession = await sessionStore.get(harvestSessionId);
    if (existingSession) {
      await sessionStore.touch(harvestSessionId);
      return existingSession;
    }
  }

  // Create a new session
  const newId = crypto.randomUUID();
  const newSession: Session = {
    id: newId,
    harvestAccessToken: '',
    harvestRefreshToken: '',
    harvestAccountId: '',
    tokenExpiresAt: new Date(0),
    userId: 0,
    userEmail: '',
    createdAt: new Date(),
    lastAccessedAt: new Date(),
  };

  await sessionStore.set(newId, newSession);
  return newSession;
}

/**
 * Helper to create initialize request for pre-warming
 */
function createInitializeRequest(sessionId: string): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'harvest-mcp-prewarm', version: '1.0' },
      },
      id: `prewarm-${sessionId}`,
    }),
  });
}

/**
 * Parse JSON-RPC method from request body
 */
async function parseMethod(request: Request): Promise<{ method: string; body: string } | null> {
  try {
    const body = await request.text();
    const parsed = JSON.parse(body);
    return { method: parsed.method || '', body };
  } catch {
    return null;
  }
}

/**
 * MCP Endpoint - handles all MCP protocol requests
 * Uses stateless mode with auto-initialization for returning sessions
 */
app.all('/mcp', async (c) => {
  const env = c.env;
  const request = c.req.raw;
  const config = loadWorkersConfig(env, request);
  const sessionStore = new KVSessionStore(env.SESSIONS, config.security.sessionTtlHours);

  // Get harvest session ID from custom header (separate from MCP session)
  const harvestSessionId = c.req.header('x-harvest-session') || c.req.header('mcp-session-id');

  // Get or create session for OAuth token management
  const session = await getOrCreateSession(sessionStore, harvestSessionId);

  // Parse the incoming request to determine the method
  const parsed = await parseMethod(request.clone());
  const isInitRequest = parsed?.method === 'initialize';

  // Create stateless transport
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => session.id,
    enableJsonResponse: true,
  });

  // Create MCP server for this request
  const server = new McpServer({
    name: 'harvest-mcp',
    version: '0.1.0',
  });

  // Register all Harvest tools with the current session
  registerTools(server, session, sessionStore, config);

  // Connect server to transport
  await server.connect(transport);

  // If this is NOT an initialize request but the session was previously initialized,
  // pre-warm the server with a synthetic initialize request
  const wasInitialized = await sessionStore.isMcpInitialized(session.id);

  if (!isInitRequest && wasInitialized) {
    const initRequest = createInitializeRequest(session.id);
    await transport.handleRequest(initRequest);
  }

  // Handle the actual request - ensure mcp-session-id header is set
  const actualHeaders = new Headers(request.headers);
  actualHeaders.set('mcp-session-id', session.id);

  const actualRequest = new Request(request.url, {
    method: request.method,
    headers: actualHeaders,
    body: parsed?.body,
  });

  const response = await transport.handleRequest(actualRequest);

  // If this was an initialize request, mark session as initialized
  if (isInitRequest && response.status === 200) {
    await sessionStore.setMcpInitialized(session.id, true);
  }

  // Add harvest session ID to response headers for client to track
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('x-harvest-session', session.id);

  return newResponse;
});

/**
 * OAuth Callback - handles Harvest OAuth redirect
 */
app.get('/callback', async (c) => {
  const env = c.env;
  const config = loadWorkersConfig(env, c.req.raw);
  const sessionStore = new KVSessionStore(env.SESSIONS, config.security.sessionTtlHours);
  const oauth = new HarvestOAuth(config.harvest);

  const { code, state, error } = c.req.query();

  if (error) {
    return c.text(`OAuth error: ${error}`, 400);
  }

  if (!code || !state) {
    return c.text('Missing code or state parameter', 400);
  }

  // Parse state to get session ID
  const parsedState = HarvestOAuth.parseState(state);
  if (!parsedState) {
    return c.text('Invalid state parameter', 400);
  }

  // Get session
  const session = await sessionStore.get(parsedState.sessionId);
  if (!session) {
    return c.text('Session not found', 400);
  }

  try {
    // Exchange code for tokens
    const tokens = await oauth.exchangeCode(code);

    // Get user accounts
    const accountsResponse = await oauth.getAccounts(tokens.access_token);

    // Find first Harvest account
    const harvestAccount = accountsResponse.accounts.find((a) => a.product === 'harvest');
    if (!harvestAccount) {
      return c.text('No Harvest account found', 400);
    }

    // Update session with tokens
    session.harvestAccessToken = tokens.access_token;
    session.harvestRefreshToken = tokens.refresh_token;
    session.harvestAccountId = String(harvestAccount.id);
    session.tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    session.userId = accountsResponse.user.id;
    session.userEmail = accountsResponse.user.email;
    session.pendingOAuthState = undefined;

    await sessionStore.set(session.id, session);

    console.log(`OAuth completed for session ${session.id}, user: ${session.userEmail}`);

    // Show success page with session ID for the user to copy
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>Harvest MCP - Authorized</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1>Authorization Successful</h1>
          <p>You have successfully connected your Harvest account.</p>
          <p>Account: <strong>${harvestAccount.name}</strong></p>
          <p>User: <strong>${accountsResponse.user.email}</strong></p>
          <p style="margin-top: 20px; padding: 10px; background: #f0f0f0; border-radius: 4px;">
            Session ID: <code>${session.id}</code>
          </p>
          <p>You can now close this window and return to your AI assistant.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('OAuth callback error:', err);
    return c.text('Failed to complete authorization', 500);
  }
});

/**
 * Export the fetch handler for Cloudflare Workers
 */
export default {
  fetch: app.fetch,
};
