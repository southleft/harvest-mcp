/**
 * KV-based Session Store for Cloudflare Workers
 *
 * Stores sessions in Cloudflare KV with automatic TTL expiration.
 * Uses a secondary index for OAuth state -> session ID lookups.
 */

import type { Session, SessionStore } from '../session/types.js';
import type { KVSessionData, KVOAuthStateMapping } from './types.js';

const SESSION_PREFIX = 'session:';
const OAUTH_STATE_PREFIX = 'oauth_state:';
const MCP_INIT_PREFIX = 'mcp_init:';

export class KVSessionStore implements SessionStore {
  private kv: KVNamespace;
  private ttlSeconds: number;

  constructor(kv: KVNamespace, ttlHours: number = 24) {
    this.kv = kv;
    this.ttlSeconds = ttlHours * 60 * 60;
  }

  /**
   * Get session by ID
   */
  async get(sessionId: string): Promise<Session | null> {
    const key = SESSION_PREFIX + sessionId;
    const data = await this.kv.get<KVSessionData>(key, 'json');

    if (!data) return null;

    return this.deserializeSession(data);
  }

  /**
   * Create or update session
   */
  async set(sessionId: string, session: Session): Promise<void> {
    const key = SESSION_PREFIX + sessionId;
    const data = this.serializeSession(session);

    await this.kv.put(key, JSON.stringify(data), {
      expirationTtl: this.ttlSeconds,
    });

    // If there's an OAuth state, update the state index
    if (session.pendingOAuthState) {
      await this.setOAuthStateMapping(session.pendingOAuthState, sessionId);
    }
  }

  /**
   * Delete session
   */
  async delete(sessionId: string): Promise<void> {
    // First get the session to check for OAuth state
    const session = await this.get(sessionId);

    // Delete OAuth state mapping if exists
    if (session?.pendingOAuthState) {
      await this.kv.delete(OAUTH_STATE_PREFIX + session.pendingOAuthState);
    }

    // Delete the session
    await this.kv.delete(SESSION_PREFIX + sessionId);
  }

  /**
   * Update last accessed timestamp (touch)
   * Re-stores the session to reset TTL
   */
  async touch(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (session) {
      session.lastAccessedAt = new Date();
      await this.set(sessionId, session);
    }
  }

  /**
   * Set pending OAuth state for authorization flow
   */
  async setPendingAuth(sessionId: string, state: string): Promise<void> {
    const session = await this.get(sessionId);
    if (session) {
      // Clear old state mapping if exists
      if (session.pendingOAuthState) {
        await this.kv.delete(OAUTH_STATE_PREFIX + session.pendingOAuthState);
      }

      // Set new state
      session.pendingOAuthState = state;
      await this.set(sessionId, session);
    }
  }

  /**
   * Get session by OAuth state
   */
  async getByOAuthState(state: string): Promise<Session | null> {
    const mapping = await this.kv.get<KVOAuthStateMapping>(
      OAUTH_STATE_PREFIX + state,
      'json'
    );

    if (!mapping) return null;

    return this.get(mapping.sessionId);
  }

  /**
   * Store OAuth state -> session ID mapping
   */
  private async setOAuthStateMapping(state: string, sessionId: string): Promise<void> {
    const mapping: KVOAuthStateMapping = {
      sessionId,
      createdAt: new Date().toISOString(),
    };

    // OAuth state mappings expire after 10 minutes (auth flow timeout)
    await this.kv.put(OAUTH_STATE_PREFIX + state, JSON.stringify(mapping), {
      expirationTtl: 600,
    });
  }

  /**
   * Mark session as MCP initialized (stored as separate key for reliability)
   */
  async setMcpInitialized(sessionId: string, initialized: boolean): Promise<void> {
    const key = MCP_INIT_PREFIX + sessionId;
    if (initialized) {
      await this.kv.put(key, 'true', { expirationTtl: this.ttlSeconds });
    } else {
      await this.kv.delete(key);
    }
  }

  /**
   * Check if session is MCP initialized
   */
  async isMcpInitialized(sessionId: string): Promise<boolean> {
    const key = MCP_INIT_PREFIX + sessionId;
    const value = await this.kv.get(key);
    return value === 'true';
  }

  /**
   * Serialize Session to KV-storable format
   */
  private serializeSession(session: Session): KVSessionData {
    return {
      id: session.id,
      harvestAccessToken: session.harvestAccessToken,
      harvestRefreshToken: session.harvestRefreshToken,
      harvestAccountId: session.harvestAccountId,
      tokenExpiresAt: session.tokenExpiresAt.toISOString(),
      userId: session.userId,
      userEmail: session.userEmail,
      createdAt: session.createdAt.toISOString(),
      lastAccessedAt: session.lastAccessedAt.toISOString(),
      pendingOAuthState: session.pendingOAuthState,
    };
  }

  /**
   * Deserialize KV data to Session
   */
  private deserializeSession(data: KVSessionData): Session {
    return {
      id: data.id,
      harvestAccessToken: data.harvestAccessToken,
      harvestRefreshToken: data.harvestRefreshToken,
      harvestAccountId: data.harvestAccountId,
      tokenExpiresAt: new Date(data.tokenExpiresAt),
      userId: data.userId,
      userEmail: data.userEmail,
      createdAt: new Date(data.createdAt),
      lastAccessedAt: new Date(data.lastAccessedAt),
      pendingOAuthState: data.pendingOAuthState,
    };
  }
}
