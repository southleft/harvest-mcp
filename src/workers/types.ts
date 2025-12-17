/**
 * Cloudflare Workers Environment Types
 */

export interface Env {
  // KV Namespaces
  SESSIONS: KVNamespace;
  RATES_CONFIG: KVNamespace;

  // Environment variables
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  SESSION_TTL_HOURS: string;
  ALLOWED_ORIGINS: string;

  // Secrets (set via wrangler secret put)
  HARVEST_CLIENT_ID: string;
  HARVEST_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}

/**
 * Session data stored in KV (JSON serializable)
 * Note: MCP initialization state is stored separately for reliability
 */
export interface KVSessionData {
  id: string;
  harvestAccessToken: string;
  harvestRefreshToken: string;
  harvestAccountId: string;
  tokenExpiresAt: string; // ISO date string
  userId: number;
  userEmail: string;
  createdAt: string; // ISO date string
  lastAccessedAt: string; // ISO date string
  pendingOAuthState?: string;
}

/**
 * OAuth state mapping stored in KV
 */
export interface KVOAuthStateMapping {
  sessionId: string;
  createdAt: string;
}
