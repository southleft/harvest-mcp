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
    // Allow any origin for OAuth discovery (needed for Claude Desktop connectors)
    return origin;
  },
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'mcp-session-id', 'x-harvest-session', 'Authorization', 'Last-Event-ID', 'mcp-protocol-version'],
  exposeHeaders: ['mcp-session-id', 'x-harvest-session', 'mcp-protocol-version', 'WWW-Authenticate'],
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
 * Helper to get base URL from request
 */
function getBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * OAuth Protected Resource Metadata (RFC 9728)
 * Claude Desktop fetches this to discover the authorization server
 */
app.get('/.well-known/oauth-protected-resource', (c) => {
  const baseUrl = getBaseUrl(c.req.raw);

  return c.json({
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://github.com/southleft/harvest-mcp',
  });
});

/**
 * OAuth Authorization Server Metadata (RFC 8414)
 * Claude Desktop fetches this to get OAuth endpoints
 */
app.get('/.well-known/oauth-authorization-server', (c) => {
  const baseUrl = getBaseUrl(c.req.raw);

  return c.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    service_documentation: 'https://github.com/southleft/harvest-mcp',
  });
});

/**
 * Dynamic Client Registration (RFC 7591)
 * For clients that need to register dynamically
 */
app.post('/register', async (c) => {
  // For simplicity, we accept any registration and return a client_id
  // In production, you might want to validate and store these
  const body = await c.req.json().catch(() => ({}));
  const clientId = `mcp-client-${crypto.randomUUID()}`;

  return c.json({
    client_id: clientId,
    client_name: body.client_name || 'MCP Client',
    redirect_uris: body.redirect_uris || [],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }, 201);
});

/**
 * OAuth Authorization Endpoint
 * Redirects to Harvest OAuth, storing the client's callback for later
 */
app.get('/authorize', async (c) => {
  const env = c.env;
  const config = loadWorkersConfig(env, c.req.raw);
  const sessionStore = new KVSessionStore(env.SESSIONS, config.security.sessionTtlHours);

  const {
    client_id,
    redirect_uri,
    response_type,
    state,
    code_challenge,
    code_challenge_method,
  } = c.req.query();

  // Validate required params
  if (response_type !== 'code') {
    return c.json({ error: 'unsupported_response_type' }, 400);
  }

  if (!redirect_uri) {
    return c.json({ error: 'invalid_request', error_description: 'redirect_uri required' }, 400);
  }

  // Create a session to track this OAuth flow
  const sessionId = crypto.randomUUID();
  const authSession: Session = {
    id: sessionId,
    harvestAccessToken: '',
    harvestRefreshToken: '',
    harvestAccountId: '',
    tokenExpiresAt: new Date(0),
    userId: 0,
    userEmail: '',
    createdAt: new Date(),
    lastAccessedAt: new Date(),
    // Store client's OAuth params for the callback
    pendingOAuthState: JSON.stringify({
      clientRedirectUri: redirect_uri,
      clientState: state,
      clientId: client_id,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
    }),
  };

  await sessionStore.set(sessionId, authSession);

  // Generate state for Harvest OAuth that encodes our session
  const harvestState = HarvestOAuth.generateState(sessionId);

  // Redirect to Harvest OAuth
  const oauth = new HarvestOAuth(config.harvest);
  const harvestAuthUrl = oauth.getAuthorizationUrl(harvestState);

  return c.redirect(harvestAuthUrl);
});

/**
 * OAuth Token Endpoint
 * Exchanges authorization codes for access tokens
 */
app.post('/token', async (c) => {
  const env = c.env;
  const config = loadWorkersConfig(env, c.req.raw);
  const sessionStore = new KVSessionStore(env.SESSIONS, config.security.sessionTtlHours);

  // Parse form data
  const contentType = c.req.header('content-type') || '';
  let params: Record<string, string> = {};

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await c.req.text();
    params = Object.fromEntries(new URLSearchParams(text));
  } else if (contentType.includes('application/json')) {
    params = await c.req.json();
  }

  const { grant_type, code, refresh_token, code_verifier } = params;

  if (grant_type === 'authorization_code') {
    if (!code) {
      return c.json({ error: 'invalid_request', error_description: 'code required' }, 400);
    }

    // The code IS the session ID (we set it that way in callback)
    const session = await sessionStore.get(code);
    if (!session || !session.harvestAccessToken) {
      return c.json({ error: 'invalid_grant', error_description: 'Invalid or expired code' }, 400);
    }

    // TODO: Verify code_verifier against stored code_challenge if PKCE was used

    // Generate an access token (the session ID serves as our token)
    const accessToken = session.id;

    // Return tokens
    return c.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: config.security.sessionTtlHours * 3600,
      refresh_token: session.harvestRefreshToken ? session.id : undefined,
    });
  } else if (grant_type === 'refresh_token') {
    if (!refresh_token) {
      return c.json({ error: 'invalid_request', error_description: 'refresh_token required' }, 400);
    }

    // The refresh token IS the session ID
    const session = await sessionStore.get(refresh_token);
    if (!session || !session.harvestRefreshToken) {
      return c.json({ error: 'invalid_grant', error_description: 'Invalid refresh token' }, 400);
    }

    // Refresh the Harvest token
    try {
      const oauth = new HarvestOAuth(config.harvest);
      const tokens = await oauth.refreshToken(session.harvestRefreshToken);

      // Update session
      session.harvestAccessToken = tokens.access_token;
      session.harvestRefreshToken = tokens.refresh_token;
      session.tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      await sessionStore.set(session.id, session);

      return c.json({
        access_token: session.id,
        token_type: 'Bearer',
        expires_in: config.security.sessionTtlHours * 3600,
        refresh_token: session.id,
      });
    } catch (err) {
      console.error('Token refresh error:', err);
      return c.json({ error: 'invalid_grant', error_description: 'Failed to refresh token' }, 400);
    }
  }

  return c.json({ error: 'unsupported_grant_type' }, 400);
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
 * Supports OAuth Bearer token authentication for Claude Desktop Connectors
 */
app.all('/mcp', async (c) => {
  const env = c.env;
  const request = c.req.raw;
  const config = loadWorkersConfig(env, request);
  const sessionStore = new KVSessionStore(env.SESSIONS, config.security.sessionTtlHours);
  const baseUrl = getBaseUrl(request);

  // Check for Authorization: Bearer token (OAuth flow from Claude Desktop)
  const authHeader = c.req.header('Authorization');
  let sessionId: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    sessionId = authHeader.slice(7); // Extract token after "Bearer "
  } else {
    // Fallback to legacy headers
    sessionId = c.req.header('x-harvest-session') || c.req.header('mcp-session-id');
  }

  // If we have a session ID, try to load it
  let session: Session | null = null;
  if (sessionId) {
    session = await sessionStore.get(sessionId);
    if (session) {
      await sessionStore.touch(sessionId);
    }
  }

  // If no valid session with tokens, return 401 with OAuth metadata
  // This tells Claude Desktop to initiate the OAuth flow per MCP Authorization spec
  if (!session || !session.harvestAccessToken) {
    // Return 401 with WWW-Authenticate header pointing to protected resource metadata (RFC 9728)
    // Format: Bearer resource_metadata="<url>"
    const resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Authorization required. Please authenticate with Harvest.',
      },
      id: null,
    }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"`,
        'Access-Control-Expose-Headers': 'WWW-Authenticate',
      },
    });
  }

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
    name: 'Harvest',
    version: '0.1.0',
    description: 'Time tracking and project management via Harvest API',
    icons: [
      {
        src: 'https://www.getharvest.com/hubfs/apple-touch-icon.png',
        mimeType: 'image/png',
        sizes: ['180x180'],
      },
      {
        src: 'https://www.getharvest.com/hubfs/favicon.svg',
        mimeType: 'image/svg+xml',
        sizes: ['any'],
      },
    ],
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
 * If this was initiated via /authorize, redirects back to client's redirect_uri
 * Otherwise shows a success page (for legacy in-chat auth flow)
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

    // Parse the pending OAuth state to see if we need to redirect to client
    const pendingOAuth = session.pendingOAuthState
      ? JSON.parse(session.pendingOAuthState)
      : null;

    // Clear the pending state
    session.pendingOAuthState = undefined;
    await sessionStore.set(session.id, session);

    console.log(`OAuth completed for session ${session.id}, user: ${session.userEmail}`);

    // If this was initiated via /authorize, redirect back to the client
    if (pendingOAuth?.clientRedirectUri) {
      const redirectUrl = new URL(pendingOAuth.clientRedirectUri);
      // Use the session ID as the authorization code
      redirectUrl.searchParams.set('code', session.id);
      if (pendingOAuth.clientState) {
        redirectUrl.searchParams.set('state', pendingOAuth.clientState);
      }

      console.log(`Redirecting to client: ${redirectUrl.toString()}`);
      return c.redirect(redirectUrl.toString());
    }

    // Legacy flow: show success page with session ID for manual copy
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
