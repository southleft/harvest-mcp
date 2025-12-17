/**
 * Types for rate resolution
 */

export type RateSource =
  | 'harvest_api'       // Rate from Harvest API
  | 'config_file'       // Rate from rates.json config
  | 'env_default'       // Rate from DEFAULT_COST_RATE env var
  | 'fallback_zero';    // Zero rate when no source available

export interface RateInfo {
  rate: number;
  source: RateSource;
  source_detail?: string;  // e.g., "user.cost_rate" or "project.hourly_rate"
}

export interface UserRate {
  user_id: number;
  user_name: string;
  cost_rate: RateInfo;
  default_hourly_rate: RateInfo | null;
}

export interface ProjectRate {
  project_id: number;
  project_name: string;
  client_id: number;
  client_name: string;
  hourly_rate: RateInfo | null;
  budget: number | null;
  budget_by: string;
  is_billable: boolean;
}

export interface TaskAssignmentRate {
  project_id: number;
  task_id: number;
  task_name: string;
  billable: boolean;
  hourly_rate: RateInfo | null;
}

export interface RatesConfig {
  user_overrides: Record<string, { cost_rate?: number; billable_rate?: number }>;
  project_overrides: Record<string, { hourly_rate?: number }>;
  defaults: {
    cost_rate: number;
    billable_rate: number | null;
  };
}

export interface GetRatesParams {
  user_id?: number;
  project_id?: number;
  include_all_users?: boolean;
  include_all_projects?: boolean;
}

export interface GetRatesResponse {
  users?: UserRate[];
  projects?: ProjectRate[];
  task_assignments?: TaskAssignmentRate[];
  config_loaded: boolean;
  warnings: string[];
}
