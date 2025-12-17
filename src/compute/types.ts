/**
 * Types for compute tools (profitability, utilization, aggregation)
 */

export type ProfitabilityMode = 'time_based' | 'invoice_based' | 'hybrid';
export type GroupBy = 'client' | 'project' | 'user' | 'task' | 'date' | 'month' | 'week';

export interface DateRange {
  from: string;  // YYYY-MM-DD
  to: string;    // YYYY-MM-DD
}

// ============================================
// PROFITABILITY TYPES
// ============================================

export interface ProfitabilityParams {
  mode: ProfitabilityMode;
  date_range: DateRange;
  client_id?: number;
  project_id?: number;
  user_id?: number;
  group_by?: GroupBy[];
  include_non_billable?: boolean;  // Include non-billable time in cost calculations
}

export interface ProfitabilityMetrics {
  hours: number;
  billable_hours: number;
  non_billable_hours: number;
  billable_amount: number;
  cost: number;
  profit: number;
  margin_percent: number;  // profit / billable_amount * 100
  effective_rate: number;  // billable_amount / billable_hours
  cost_rate_avg: number;   // cost / hours
}

export interface ProfitabilityGrouping {
  id: number | string;
  name: string;
  type: GroupBy;
}

export interface ProfitabilityResult {
  grouping?: ProfitabilityGrouping;
  metrics: ProfitabilityMetrics;
  children?: ProfitabilityResult[];  // Nested groupings
}

export interface ProfitabilityResponse {
  mode: ProfitabilityMode;
  date_range: DateRange;
  filters: {
    client_id?: number;
    project_id?: number;
    user_id?: number;
  };
  totals: ProfitabilityMetrics;
  grouped_results?: ProfitabilityResult[];
  warnings: string[];
  _meta: {
    entries_analyzed: number;
    invoices_analyzed: number;
    calculation_details: string;
  };
}

// ============================================
// UTILIZATION TYPES
// ============================================

export interface UtilizationParams {
  date_range: DateRange;
  user_id?: number;
  project_id?: number;
  client_id?: number;
  group_by?: GroupBy[];
  capacity_hours_per_day?: number;  // Default: 8
  exclude_weekends?: boolean;       // Default: true
}

export interface UtilizationMetrics {
  total_hours: number;
  billable_hours: number;
  non_billable_hours: number;
  capacity_hours: number;
  utilization_percent: number;       // total_hours / capacity_hours * 100
  billable_utilization_percent: number;  // billable_hours / capacity_hours * 100
  billable_ratio_percent: number;    // billable_hours / total_hours * 100
  working_days: number;
}

export interface UtilizationGrouping {
  id: number | string;
  name: string;
  type: GroupBy;
}

export interface UtilizationResult {
  grouping?: UtilizationGrouping;
  metrics: UtilizationMetrics;
  children?: UtilizationResult[];
}

export interface UtilizationResponse {
  date_range: DateRange;
  filters: {
    user_id?: number;
    project_id?: number;
    client_id?: number;
  };
  settings: {
    capacity_hours_per_day: number;
    exclude_weekends: boolean;
  };
  totals: UtilizationMetrics;
  grouped_results?: UtilizationResult[];
  _meta: {
    entries_analyzed: number;
    users_included: number;
  };
}

// ============================================
// TIME AGGREGATION TYPES
// ============================================

export interface TimeAggregationParams {
  date_range: DateRange;
  group_by: GroupBy[];
  client_id?: number;
  project_id?: number;
  user_id?: number;
  task_id?: number;
  billable_only?: boolean;
}

export interface TimeAggregationMetrics {
  hours: number;
  rounded_hours: number;
  billable_hours: number;
  non_billable_hours: number;
  entry_count: number;
  billable_amount: number;
}

export interface TimeAggregationGrouping {
  id: number | string;
  name: string;
  type: GroupBy;
}

export interface TimeAggregationResult {
  grouping: TimeAggregationGrouping;
  metrics: TimeAggregationMetrics;
  children?: TimeAggregationResult[];
}

export interface TimeAggregationResponse {
  date_range: DateRange;
  filters: {
    client_id?: number;
    project_id?: number;
    user_id?: number;
    task_id?: number;
    billable_only?: boolean;
  };
  group_by: GroupBy[];
  totals: TimeAggregationMetrics;
  grouped_results: TimeAggregationResult[];
  _meta: {
    entries_analyzed: number;
  };
}
