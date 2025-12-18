/**
 * Compute Module
 *
 * Provides calculation tools for profitability, utilization, time aggregation,
 * and budget performance analysis.
 */

export { ProfitabilityCalculator } from './profitability.js';
export { UtilizationCalculator } from './utilization.js';
export { TimeAggregationCalculator } from './aggregation.js';
export { BudgetPerformanceCalculator } from './budget-performance.js';
export type {
  ProfitabilityMode,
  GroupBy,
  DateRange,
  ProfitabilityParams,
  ProfitabilityMetrics,
  ProfitabilityResult,
  ProfitabilityResponse,
  UtilizationParams,
  UtilizationMetrics,
  UtilizationResult,
  UtilizationResponse,
  TimeAggregationParams,
  TimeAggregationMetrics,
  TimeAggregationResult,
  TimeAggregationResponse,
  PerformanceRating,
  BudgetPerformanceSortBy,
  SortOrder,
  BudgetPerformanceParams,
  BudgetPerformanceProjectMetrics,
  BudgetPerformanceUserMetrics,
  BudgetPerformanceUserResult,
  BudgetPerformanceTotals,
  BudgetPerformanceResponse,
} from './types.js';
