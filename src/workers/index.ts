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
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Harvest MCP Server - AI-Powered Time Tracking</title>
        <link rel="icon" type="image/png" href="/icon.png">
        <link rel="shortcut icon" href="/favicon.ico">
        <link rel="apple-touch-icon" href="/icon.png">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            color: #1a1a1a;
            line-height: 1.6;
            background: #fff;
          }
          .header {
            background: #fff;
            border-bottom: 1px solid #eee;
            padding: 16px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .logo {
            display: flex;
            align-items: center;
            gap: 12px;
            text-decoration: none;
            color: #1a1a1a;
          }
          .logo img { width: 32px; height: 32px; }
          .logo-text {
            font-size: 20px;
            font-weight: 600;
            color: #fa5d00;
          }
          .logo-text span { color: #666; font-weight: 400; }
          .github-link {
            color: #666;
            text-decoration: none;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .github-link:hover { color: #fa5d00; }
          .hero {
            background: linear-gradient(135deg, #fff9f5 0%, #fff 100%);
            padding: 80px 24px;
            text-align: center;
          }
          .hero h1 {
            font-size: 48px;
            font-weight: 700;
            color: #1a1a1a;
            margin-bottom: 16px;
          }
          .hero h1 span { color: #fa5d00; }
          .hero p {
            font-size: 20px;
            color: #666;
            max-width: 600px;
            margin: 0 auto 32px;
          }
          .cta-button {
            display: inline-block;
            background: #fa5d00;
            color: #fff;
            padding: 14px 32px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 600;
            font-size: 16px;
            transition: background 0.2s;
          }
          .cta-button:hover { background: #e55400; }
          .connect-url {
            margin-top: 24px;
            font-size: 14px;
            color: #666;
          }
          .connect-url code {
            background: #f5f5f5;
            padding: 8px 16px;
            border-radius: 6px;
            font-family: 'SF Mono', Monaco, monospace;
            color: #1a1a1a;
            display: inline-block;
            margin-top: 8px;
          }
          .features {
            padding: 80px 24px;
            max-width: 1100px;
            margin: 0 auto;
          }
          .features h2 {
            text-align: center;
            font-size: 32px;
            margin-bottom: 48px;
            color: #1a1a1a;
          }
          .feature-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 32px;
          }
          .feature-card {
            background: #fff;
            border: 1px solid #eee;
            border-radius: 12px;
            padding: 32px;
            transition: box-shadow 0.2s;
          }
          .feature-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
          .feature-icon {
            width: 48px;
            height: 48px;
            background: #fff5f0;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 16px;
            font-size: 24px;
          }
          .feature-card h3 { font-size: 18px; margin-bottom: 8px; color: #1a1a1a; }
          .feature-card p { color: #666; font-size: 15px; }
          .tools-section {
            background: #fafafa;
            padding: 80px 24px;
          }
          .tools-section h2 {
            text-align: center;
            font-size: 32px;
            margin-bottom: 16px;
          }
          .tools-section > p {
            text-align: center;
            color: #666;
            margin-bottom: 48px;
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
          }
          .tools-grid {
            max-width: 900px;
            margin: 0 auto;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 16px;
          }
          .tool-item {
            background: #fff;
            padding: 16px 20px;
            border-radius: 8px;
            border: 1px solid #eee;
            font-size: 14px;
          }
          .tool-item strong {
            color: #fa5d00;
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 13px;
          }
          .tool-item span { color: #666; display: block; margin-top: 4px; }
          .setup-section {
            padding: 80px 24px;
            max-width: 800px;
            margin: 0 auto;
          }
          .setup-section h2 {
            text-align: center;
            font-size: 32px;
            margin-bottom: 48px;
          }
          .setup-steps { display: flex; flex-direction: column; gap: 24px; }
          .setup-step { display: flex; gap: 20px; align-items: flex-start; }
          .step-number {
            width: 36px;
            height: 36px;
            background: #fa5d00;
            color: #fff;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            flex-shrink: 0;
          }
          .step-content h3 { font-size: 18px; margin-bottom: 4px; }
          .step-content p { color: #666; font-size: 15px; }
          .step-content code {
            background: #f5f5f5;
            padding: 2px 8px;
            border-radius: 4px;
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 13px;
          }
          .footer {
            background: #1a1a1a;
            color: #999;
            padding: 40px 24px;
            text-align: center;
            font-size: 14px;
          }
          .footer a { color: #fa5d00; text-decoration: none; }
          .footer a:hover { text-decoration: underline; }
          .footer-links {
            margin-top: 16px;
            display: flex;
            justify-content: center;
            gap: 24px;
            flex-wrap: wrap;
          }
          @media (max-width: 600px) {
            .hero h1 { font-size: 32px; }
            .hero p { font-size: 16px; }
            .features h2, .tools-section h2, .setup-section h2 { font-size: 24px; }
          }
        </style>
      </head>
      <body>
        <header class="header">
          <a href="/" class="logo">
            <img src="/icon.png" alt="Harvest">
            <div class="logo-text">harvest <span>MCP</span></div>
          </a>
          <a href="https://github.com/southleft/harvest-mcp" class="github-link" target="_blank">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            GitHub
          </a>
        </header>

        <section class="hero">
          <h1>Turn <span>hours</span> into insights</h1>
          <p>Connect your AI assistant to Harvest and let it help you track time, analyze profitability, and manage projects with natural language.</p>
          <a href="https://github.com/southleft/harvest-mcp#quick-start" class="cta-button">Get Started</a>
          <div class="connect-url">
            Connect with Claude Desktop using:
            <br>
            <code>https://harvest-mcp.southleft.com/mcp</code>
          </div>
        </section>

        <section class="features">
          <h2>What you can do</h2>
          <div class="feature-grid">
            <div class="feature-card">
              <div class="feature-icon">&#9201;</div>
              <h3>Track Time Naturally</h3>
              <p>Create, view, and manage time entries using conversational commands. Start timers, log hours, and keep your timesheets up to date.</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon">&#128200;</div>
              <h3>Gain Powerful Insights</h3>
              <p>Calculate profitability, utilization rates, and aggregate time data across clients, projects, and team members.</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon">&#128269;</div>
              <h3>Smart Entity Search</h3>
              <p>Find clients, projects, users, and tasks with fuzzy search. No need to remember exact names or IDs.</p>
            </div>
          </div>
        </section>

        <section class="tools-section">
          <h2>19 tools at your fingertips</h2>
          <p>Everything you need to interact with Harvest through your AI assistant.</p>
          <div class="tools-grid">
            <div class="tool-item">
              <strong>harvest_list_time_entries</strong>
              <span>Filter time by user, client, project, dates</span>
            </div>
            <div class="tool-item">
              <strong>harvest_create_time_entry</strong>
              <span>Log time with optional running timer</span>
            </div>
            <div class="tool-item">
              <strong>harvest_compute_profitability</strong>
              <span>Calculate margins &amp; profitability</span>
            </div>
            <div class="tool-item">
              <strong>harvest_compute_utilization</strong>
              <span>Track capacity &amp; utilization rates</span>
            </div>
            <div class="tool-item">
              <strong>harvest_aggregate_time</strong>
              <span>Group time by client, project, week</span>
            </div>
            <div class="tool-item">
              <strong>harvest_resolve_entities</strong>
              <span>Fuzzy search for any Harvest entity</span>
            </div>
            <div class="tool-item">
              <strong>harvest_list_projects</strong>
              <span>View all projects with filters</span>
            </div>
            <div class="tool-item">
              <strong>harvest_list_invoices</strong>
              <span>Access invoice data &amp; status</span>
            </div>
          </div>
        </section>

        <section class="setup-section">
          <h2>Get started in minutes</h2>
          <div class="setup-steps">
            <div class="setup-step">
              <div class="step-number">1</div>
              <div class="step-content">
                <h3>Add the connector</h3>
                <p>In Claude Desktop, go to Settings &#8594; Connectors &#8594; Add Connector and enter <code>https://harvest-mcp.southleft.com/mcp</code></p>
              </div>
            </div>
            <div class="setup-step">
              <div class="step-number">2</div>
              <div class="step-content">
                <h3>Connect your Harvest account</h3>
                <p>Click Connect and authorize access to your Harvest account via OAuth.</p>
              </div>
            </div>
            <div class="setup-step">
              <div class="step-number">3</div>
              <div class="step-content">
                <h3>Start asking questions</h3>
                <p>Ask Claude things like "What did I work on last week?" or "How profitable is Project X?"</p>
              </div>
            </div>
          </div>
        </section>

        <footer class="footer">
          <p>Harvest MCP Server v0.1.0 &middot; Built by <a href="https://southleft.com" target="_blank">Southleft</a></p>
          <div class="footer-links">
            <a href="https://github.com/southleft/harvest-mcp">Documentation</a>
            <a href="https://github.com/southleft/harvest-mcp/issues">Report an Issue</a>
            <a href="https://www.getharvest.com" target="_blank">Harvest</a>
          </div>
        </footer>
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
 * Harvest logo icon - served from same origin for MCP icon requirements
 * Base64-encoded PNG of Harvest's apple-touch-icon (180x180)
 */
const HARVEST_ICON_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAMAAABlApw1AAAAPFBMVEX6XQD/+PH/7uL/5dP+28T+28P+0bX+x6b9vpb9tYf9tIj9qnj8oGn8l1r7l1r8jkv8hDz7ei37cB77Zw+k35VPAAABoUlEQVR42u3cTW4CMQxAYXtChxRnmJDc/65dRPy0REhIiYTV95Ze2PouYCEiIiIiIiIiIiIiIiIi+tiyxVaSezWdYivLu9XYehydr+s2Gdwe9Np6v3fSW+9fLNqSW7botShjM9VnQAk6FBBVZwE27QGiDgWYzgOEHmDXoYCi8wC79gDHsQCbCLAu4DAWsE4ExC5AAQAAAAAAAAAAAAAAAAAAAAAA/AFqOh48A9KiLacAU3UN2NQ5IDgHXNQ5YPcOOAMAAAAAgNeAkrtVH4Bqi/bLLgAlqHoGlKC+AVF9A6o6B+zeAck7wAAAAAAAAAAAAAAAAACg0yLOAdE5IBTfgFDENWAt4gkQ7HfnKuIKsMrfAAAAAADAS8DuHVCcA1ZxDrg4B5i4BiybOAZ8xVTFM6CICAAAAAAAAAAAAAAAAAAAAADgHwIW74BDF2ATAWksIHYBeSKgjAWUHiDIPIDJUMC39AD7PECUoYC19gAmswBLkpGAxUSeASHL4LbYOp3rI6tV5bG9DU1elLvrUmxZ5j0wEREREREREREREREREX1sP/+vQJawQ0UbAAAAAElFTkSuQmCC';

/**
 * Icon endpoint - serves Harvest logo PNG from same origin
 */
app.get('/icon.png', (c) => {
  const iconBuffer = Uint8Array.from(atob(HARVEST_ICON_PNG_BASE64), c => c.charCodeAt(0));
  return new Response(iconBuffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

/**
 * Favicon endpoint - serves Harvest logo as favicon
 */
app.get('/favicon.ico', (c) => {
  const iconBuffer = Uint8Array.from(atob(HARVEST_ICON_PNG_BASE64), c => c.charCodeAt(0));
  return new Response(iconBuffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
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
  // Icons must be from same origin per MCP security requirements
  const server = new McpServer({
    name: 'Harvest',
    version: '0.1.0',
    description: 'Time tracking and project management via Harvest API',
    icons: [
      {
        src: `${baseUrl}/icon.png`,
        mimeType: 'image/png',
        sizes: ['180x180'],
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
