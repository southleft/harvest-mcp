/**
 * Configuration management for Harvest MCP Server
 */

import 'dotenv/config';

export interface Config {
  server: {
    port: number;
    host: string;
    nodeEnv: 'development' | 'production' | 'test';
  };
  harvest: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    apiBaseUrl: string;
    authBaseUrl: string;
  };
  security: {
    allowedOrigins: string[];
    sessionSecret: string;
    sessionTtlHours: number;
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  storage: {
    type: 'memory' | 'redis';
    redisUrl?: string;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export function loadConfig(): Config {
  return {
    server: {
      port: parseInt(getEnvOrDefault('PORT', '3000'), 10),
      host: getEnvOrDefault('HOST', 'localhost'),
      nodeEnv: (getEnvOrDefault('NODE_ENV', 'development') as Config['server']['nodeEnv']),
    },
    harvest: {
      clientId: getEnvOrThrow('HARVEST_CLIENT_ID'),
      clientSecret: getEnvOrThrow('HARVEST_CLIENT_SECRET'),
      redirectUri: getEnvOrThrow('HARVEST_REDIRECT_URI'),
      apiBaseUrl: 'https://api.harvestapp.com/v2',
      authBaseUrl: 'https://id.getharvest.com',
    },
    security: {
      allowedOrigins: getEnvOrDefault('ALLOWED_ORIGINS', 'http://localhost:3000').split(','),
      sessionSecret: getEnvOrThrow('SESSION_SECRET'),
      sessionTtlHours: parseInt(getEnvOrDefault('SESSION_TTL_HOURS', '24'), 10),
    },
    rateLimit: {
      windowMs: parseInt(getEnvOrDefault('RATE_LIMIT_WINDOW_MS', '900000'), 10), // 15 minutes
      maxRequests: parseInt(getEnvOrDefault('RATE_LIMIT_MAX', '1000'), 10),
    },
    storage: {
      type: process.env.REDIS_URL ? 'redis' : 'memory',
      redisUrl: process.env.REDIS_URL,
    },
    logging: {
      level: getEnvOrDefault('LOG_LEVEL', 'info') as Config['logging']['level'],
    },
  };
}
