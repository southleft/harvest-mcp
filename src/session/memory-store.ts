/**
 * In-memory session store for development/testing
 */

import type { Session, SessionStore } from './types.js';

export class MemorySessionStore implements SessionStore {
  private sessions: Map<string, Session> = new Map();
  private stateToSessionId: Map<string, string> = new Map();

  async get(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) || null;
  }

  async set(sessionId: string, session: Session): Promise<void> {
    this.sessions.set(sessionId, { ...session });
  }

  async delete(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session?.pendingOAuthState) {
      this.stateToSessionId.delete(session.pendingOAuthState);
    }
    this.sessions.delete(sessionId);
  }

  async touch(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastAccessedAt = new Date();
    }
  }

  async setPendingAuth(sessionId: string, state: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Clear old state mapping if exists
      if (session.pendingOAuthState) {
        this.stateToSessionId.delete(session.pendingOAuthState);
      }
      session.pendingOAuthState = state;
      this.stateToSessionId.set(state, sessionId);
    }
  }

  async getByOAuthState(state: string): Promise<Session | null> {
    const sessionId = this.stateToSessionId.get(state);
    if (!sessionId) return null;
    return this.sessions.get(sessionId) || null;
  }

  /** Clean up expired sessions (call periodically) */
  cleanup(maxAgeMs: number): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions) {
      if (now - session.lastAccessedAt.getTime() > maxAgeMs) {
        this.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }
}
