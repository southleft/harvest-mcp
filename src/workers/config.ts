/**
 * Configuration loader for Cloudflare Workers
 *
 * Loads config from Workers environment bindings instead of process.env
 */

import type { Config } from '../config.js';
import type { Env } from './types.js';

/**
 * Create config from Cloudflare Workers environment
 */
export function loadWorkersConfig(env: Env, request: Request): Config {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  return {
    server: {
      port: 443,
      host: url.host,
      nodeEnv: env.ENVIRONMENT === 'production' ? 'production' : 'development',
    },
    harvest: {
      clientId: env.HARVEST_CLIENT_ID,
      clientSecret: env.HARVEST_CLIENT_SECRET,
      redirectUri: `${baseUrl}/callback`,
      apiBaseUrl: 'https://api.harvestapp.com/v2',
      authBaseUrl: 'https://id.getharvest.com',
    },
    security: {
      allowedOrigins: env.ALLOWED_ORIGINS?.split(',') || ['https://claude.ai', 'https://app.claude.ai'],
      sessionSecret: env.SESSION_SECRET,
      sessionTtlHours: parseInt(env.SESSION_TTL_HOURS || '24', 10),
    },
    rateLimit: {
      windowMs: 900000, // 15 minutes
      maxRequests: 1000,
    },
    storage: {
      type: 'memory', // Not used in Workers - we use KV
    },
    logging: {
      level: (env.LOG_LEVEL as Config['logging']['level']) || 'info',
    },
  };
}
