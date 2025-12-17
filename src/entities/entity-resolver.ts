/**
 * Entity Resolution Service
 *
 * Provides fuzzy matching for Harvest entities (clients, projects, users, tasks)
 * with caching for performance.
 */

import type { HarvestClient } from '../harvest/client.js';
import type {
  EntityType,
  ResolvedEntity,
  EntityResolutionParams,
  EntityResolutionResponse,
  CachedEntityList,
} from './types.js';

// Common company suffix variations to normalize
const COMPANY_SUFFIXES = [
  /\s+(inc\.?|incorporated)$/i,
  /\s+(llc|l\.l\.c\.)$/i,
  /\s+(ltd\.?|limited)$/i,
  /\s+(corp\.?|corporation)$/i,
  /\s+(co\.?|company)$/i,
  /\s+(plc)$/i,
  /\s+(gmbh)$/i,
  /\s+(ag)$/i,
];

export class EntityResolver {
  private client: HarvestClient;
  private cache: CachedEntityList | null = null;
  private cacheMaxAge: number = 5 * 60 * 1000; // 5 minutes

  constructor(client: HarvestClient, cacheMaxAgeMs?: number) {
    this.client = client;
    if (cacheMaxAgeMs) {
      this.cacheMaxAge = cacheMaxAgeMs;
    }
  }

  /**
   * Normalize text for comparison
   */
  private normalize(text: string): string {
    let normalized = text.toLowerCase().trim();

    // Remove common company suffixes
    for (const suffix of COMPANY_SUFFIXES) {
      normalized = normalized.replace(suffix, '');
    }

    // Remove extra whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();

    // Remove common punctuation
    normalized = normalized.replace(/[.,'"]/g, '');

    return normalized;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Calculate similarity score (0-1) between two strings
   */
  private calculateSimilarity(query: string, target: string): { score: number; matchType: ResolvedEntity['match_type'] } {
    const normalizedQuery = this.normalize(query);
    const normalizedTarget = this.normalize(target);

    // Exact match
    if (query.toLowerCase() === target.toLowerCase()) {
      return { score: 1.0, matchType: 'exact' };
    }

    // Normalized exact match
    if (normalizedQuery === normalizedTarget) {
      return { score: 0.95, matchType: 'normalized' };
    }

    // Check if query is contained in target or vice versa
    if (normalizedTarget.includes(normalizedQuery) || normalizedQuery.includes(normalizedTarget)) {
      const ratio = Math.min(normalizedQuery.length, normalizedTarget.length) /
                    Math.max(normalizedQuery.length, normalizedTarget.length);
      return { score: 0.7 + (ratio * 0.2), matchType: 'partial' };
    }

    // Fuzzy match using Levenshtein distance
    const distance = this.levenshteinDistance(normalizedQuery, normalizedTarget);
    const maxLength = Math.max(normalizedQuery.length, normalizedTarget.length);
    const score = 1 - (distance / maxLength);

    return { score: Math.max(0, score), matchType: 'fuzzy' };
  }

  /**
   * Refresh the entity cache
   */
  private async refreshCache(): Promise<void> {
    const [clientsRes, projectsRes, usersRes, tasksRes] = await Promise.all([
      this.client.listClients({ per_page: 100 }),
      this.client.listProjects({ per_page: 100, is_active: true }),
      this.client.listUsers({ per_page: 100, is_active: true }),
      this.client.listTasks({ per_page: 100, is_active: true }),
    ]);

    this.cache = {
      clients: clientsRes.clients.map(c => ({ id: c.id, name: c.name })),
      projects: projectsRes.projects.map(p => ({
        id: p.id,
        name: p.name,
        client_id: p.client.id,
        client_name: p.client.name,
      })),
      users: usersRes.users.map(u => ({ id: u.id, name: `${u.first_name} ${u.last_name}` })),
      tasks: tasksRes.tasks.map(t => ({ id: t.id, name: t.name })),
      fetched_at: new Date(),
    };
  }

  /**
   * Check if cache is valid
   */
  private isCacheValid(): boolean {
    if (!this.cache) return false;
    const age = Date.now() - this.cache.fetched_at.getTime();
    return age < this.cacheMaxAge;
  }

  /**
   * Ensure cache is populated
   */
  private async ensureCache(): Promise<CachedEntityList> {
    if (!this.isCacheValid()) {
      await this.refreshCache();
    }
    return this.cache!;
  }

  /**
   * Resolve entities matching the query
   */
  async resolve(params: EntityResolutionParams): Promise<EntityResolutionResponse> {
    const {
      query,
      types = ['client', 'project', 'user', 'task'],
      min_confidence = 0.5,
      limit = 5,
    } = params;

    const cache = await this.ensureCache();
    const wasCached = this.isCacheValid();
    const results: ResolvedEntity[] = [];

    // Search clients
    if (types.includes('client')) {
      for (const client of cache.clients) {
        const { score, matchType } = this.calculateSimilarity(query, client.name);
        if (score >= min_confidence) {
          results.push({
            type: 'client',
            id: client.id,
            name: client.name,
            confidence: score,
            match_type: matchType,
          });
        }
      }
    }

    // Search projects
    if (types.includes('project')) {
      for (const project of cache.projects) {
        // Match against project name
        const { score: projectScore, matchType } = this.calculateSimilarity(query, project.name);

        // Also try matching with client name prefix
        const fullName = `${project.client_name} - ${project.name}`;
        const { score: fullScore } = this.calculateSimilarity(query, fullName);

        const score = Math.max(projectScore, fullScore);
        if (score >= min_confidence) {
          results.push({
            type: 'project',
            id: project.id,
            name: project.name,
            confidence: score,
            match_type: matchType,
            parent_id: project.client_id,
            parent_name: project.client_name,
          });
        }
      }
    }

    // Search users
    if (types.includes('user')) {
      for (const user of cache.users) {
        const { score, matchType } = this.calculateSimilarity(query, user.name);
        if (score >= min_confidence) {
          results.push({
            type: 'user',
            id: user.id,
            name: user.name,
            confidence: score,
            match_type: matchType,
          });
        }
      }
    }

    // Search tasks
    if (types.includes('task')) {
      for (const task of cache.tasks) {
        const { score, matchType } = this.calculateSimilarity(query, task.name);
        if (score >= min_confidence) {
          results.push({
            type: 'task',
            id: task.id,
            name: task.name,
            confidence: score,
            match_type: matchType,
          });
        }
      }
    }

    // Sort by confidence descending
    results.sort((a, b) => b.confidence - a.confidence);

    // Limit results per type
    const limitedResults: ResolvedEntity[] = [];
    const typeCounts: Record<EntityType, number> = {
      client: 0,
      project: 0,
      user: 0,
      task: 0,
    };

    for (const result of results) {
      if (typeCounts[result.type] < limit) {
        limitedResults.push(result);
        typeCounts[result.type]++;
      }
    }

    return {
      query,
      results: limitedResults,
      total_matches: results.length,
      cached: wasCached,
      search_types: types,
    };
  }

  /**
   * Clear the entity cache
   */
  clearCache(): void {
    this.cache = null;
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { cached: boolean; fetched_at: Date | null; entities: { clients: number; projects: number; users: number; tasks: number } | null } {
    if (!this.cache) {
      return { cached: false, fetched_at: null, entities: null };
    }
    return {
      cached: true,
      fetched_at: this.cache.fetched_at,
      entities: {
        clients: this.cache.clients.length,
        projects: this.cache.projects.length,
        users: this.cache.users.length,
        tasks: this.cache.tasks.length,
      },
    };
  }
}
