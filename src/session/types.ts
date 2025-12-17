/**
 * Session types for Harvest MCP Server
 */

export interface Session {
  /** Unique session identifier (UUID v4) */
  id: string;
  /** Harvest OAuth access token */
  harvestAccessToken: string;
  /** Harvest OAuth refresh token */
  harvestRefreshToken: string;
  /** Selected Harvest account ID */
  harvestAccountId: string;
  /** Token expiration timestamp */
  tokenExpiresAt: Date;
  /** Harvest user ID */
  userId: number;
  /** User email for logging/debugging */
  userEmail: string;
  /** Session creation timestamp */
  createdAt: Date;
  /** Last activity timestamp */
  lastAccessedAt: Date;
  /** OAuth state for pending authorization */
  pendingOAuthState?: string;
}

export interface SessionStore {
  /** Get session by ID */
  get(sessionId: string): Promise<Session | null>;
  /** Create or update session */
  set(sessionId: string, session: Session): Promise<void>;
  /** Delete session */
  delete(sessionId: string): Promise<void>;
  /** Update last accessed timestamp */
  touch(sessionId: string): Promise<void>;
  /** Set pending OAuth state before authorization */
  setPendingAuth(sessionId: string, state: string): Promise<void>;
  /** Get session by pending OAuth state */
  getByOAuthState(state: string): Promise<Session | null>;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
}

export interface HarvestAccount {
  id: number;
  name: string;
  product: 'harvest' | 'forecast';
}

export interface HarvestAccountsResponse {
  user: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
  };
  accounts: HarvestAccount[];
}
