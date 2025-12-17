/**
 * Harvest MCP Server - Entry Point
 *
 * A remote MCP server that provides access to the Harvest time tracking API.
 * Users authenticate via OAuth2 and the server handles all API interactions.
 */

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { loadConfig } from './config.js';
import { MemorySessionStore } from './session/memory-store.js';
import { HarvestOAuth } from './auth/oauth.js';
import { registerTools } from './tools/index.js';
import type { Session } from './session/types.js';

// Load configuration
const config = loadConfig();

// Initialize session store
const sessionStore = new MemorySessionStore();

// Initialize OAuth client
const oauth = new HarvestOAuth(config.harvest);

// Track active transports by session ID
const transports: Record<string, StreamableHTTPServerTransport> = {};

// Create Express app
const app = express();

// ============================================
// MIDDLEWARE SETUP
// ============================================

// JSON body parsing
app.use(express.json());

// CORS configuration - allows Claude Desktop and other MCP clients
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, or same-origin)
    if (!origin) {
      callback(null, true);
      return;
    }
    // Check if origin is in allowed list
    if (config.security.allowedOrigins.includes(origin) || config.security.allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'mcp-session-id', 'Authorization'],
  exposedHeaders: ['mcp-session-id'],
  credentials: true,
  maxAge: 86400, // Cache preflight for 24 hours
};
app.use(cors(corsOptions));

// Rate limiting - protects the server from abuse
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Too many requests, please try again later' },
    id: null,
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  },
});
app.use(limiter);

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const logLevel = config.logging.level;
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logMessage = `${req.method} ${req.path} ${res.statusCode} ${duration}ms`;
    
    if (logLevel === 'debug') {
      console.log(`[${new Date().toISOString()}] ${logMessage} - ${req.ip}`);
    } else if (res.statusCode >= 400) {
      console.log(`[${new Date().toISOString()}] ${logMessage}`);
    } else if (logLevel !== 'error') {
      console.log(`[${new Date().toISOString()}] ${logMessage}`);
    }
  });
  
  next();
});

/**
 * Create a new MCP server instance for a session
 */
function createMcpServer(session: Session): McpServer {
  const server = new McpServer({
    name: 'harvest-mcp',
    version: '0.1.0',
  });

  // Register all Harvest tools
  registerTools(server, session, sessionStore, config);

  return server;
}

/**
 * MCP Endpoint - POST /mcp
 * Handles JSON-RPC requests, notifications, and responses
 */
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports[sessionId]) {
    // Reuse existing session
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // New session initialization
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: async (id) => {
        transports[id] = transport;

        // Create minimal session (not yet authenticated with Harvest)
        const newSession: Session = {
          id,
          harvestAccessToken: '',
          harvestRefreshToken: '',
          harvestAccountId: '',
          tokenExpiresAt: new Date(0),
          userId: 0,
          userEmail: '',
          createdAt: new Date(),
          lastAccessedAt: new Date(),
        };

        await sessionStore.set(id, newSession);
        console.log(`Session initialized: ${id}`);
      },
      onsessionclosed: async (id) => {
        await sessionStore.delete(id);
        delete transports[id];
        console.log(`Session closed: ${id}`);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        delete transports[transport.sessionId];
      }
    };

    // Get or create session for this transport
    const session: Session = {
      id: transport.sessionId || randomUUID(),
      harvestAccessToken: '',
      harvestRefreshToken: '',
      harvestAccountId: '',
      tokenExpiresAt: new Date(0),
      userId: 0,
      userEmail: '',
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    };

    const server = createMcpServer(session);
    await server.connect(transport);
  } else {
    // Invalid request - no session ID for non-initialize request
    return res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Invalid session or missing MCP-Session-Id header' },
      id: null,
    });
  }

  // Update last accessed time
  if (sessionId) {
    await sessionStore.touch(sessionId);
  }

  await transport.handleRequest(req, res, req.body);
});

/**
 * MCP Endpoint - GET /mcp
 * Opens SSE stream for server-initiated messages
 */
app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  const transport = transports[sessionId];

  if (!transport) {
    return res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Invalid session' },
      id: null,
    });
  }

  await transport.handleRequest(req, res);
});

/**
 * MCP Endpoint - DELETE /mcp
 * Terminates session
 */
app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  const transport = transports[sessionId];

  if (!transport) {
    return res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Invalid session' },
      id: null,
    });
  }

  await transport.handleRequest(req, res);
});

/**
 * OAuth Callback - GET /callback
 * Handles Harvest OAuth redirect with authorization code
 */
app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send(`OAuth error: ${error}`);
  }

  if (!code || !state) {
    return res.status(400).send('Missing code or state parameter');
  }

  // Parse state to get session ID
  const parsedState = HarvestOAuth.parseState(state as string);
  if (!parsedState) {
    return res.status(400).send('Invalid state parameter');
  }

  // Get session
  const session = await sessionStore.get(parsedState.sessionId);
  if (!session) {
    return res.status(400).send('Session not found');
  }

  try {
    // Exchange code for tokens
    const tokens = await oauth.exchangeCode(code as string);

    // Get user accounts
    const accountsResponse = await oauth.getAccounts(tokens.access_token);

    // Find first Harvest account
    const harvestAccount = accountsResponse.accounts.find((a) => a.product === 'harvest');
    if (!harvestAccount) {
      return res.status(400).send('No Harvest account found');
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

    // Show success page
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Harvest MCP - Authorized</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1>Authorization Successful</h1>
          <p>You have successfully connected your Harvest account.</p>
          <p>Account: <strong>${harvestAccount.name}</strong></p>
          <p>You can now close this window and return to your AI assistant.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('Failed to complete authorization');
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '0.1.0',
    activeSessions: Object.keys(transports).length,
  });
});

// Start server
const port = config.server.port;
const host = config.server.host;

app.listen(port, host, () => {
  console.log(`Harvest MCP Server running at http://${host}:${port}`);
  console.log(`MCP endpoint: http://${host}:${port}/mcp`);
  console.log(`OAuth callback: http://${host}:${port}/callback`);
});
