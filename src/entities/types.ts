/**
 * Types for entity resolution
 */

export type EntityType = 'client' | 'project' | 'user' | 'task';

export interface ResolvedEntity {
  type: EntityType;
  id: number;
  name: string;
  confidence: number;  // 0-1 score
  match_type: 'exact' | 'normalized' | 'fuzzy' | 'partial';
  parent_id?: number;   // e.g., client_id for projects
  parent_name?: string; // e.g., client name for projects
}

export interface EntityResolutionParams {
  query: string;
  types?: EntityType[];    // Filter to specific entity types
  min_confidence?: number; // Minimum confidence score (default: 0.5)
  limit?: number;          // Max results per type (default: 5)
}

export interface EntityResolutionResponse {
  query: string;
  results: ResolvedEntity[];
  total_matches: number;
  cached: boolean;
  search_types: EntityType[];
}

export interface CachedEntityList {
  clients: { id: number; name: string }[];
  projects: { id: number; name: string; client_id: number; client_name: string }[];
  users: { id: number; name: string }[];
  tasks: { id: number; name: string }[];
  fetched_at: Date;
}
