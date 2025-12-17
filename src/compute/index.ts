/**
 * Compute Module
 *
 * Provides calculation tools for profitability, utilization, and time aggregation.
 */

export { ProfitabilityCalculator } from './profitability.js';
export { UtilizationCalculator } from './utilization.js';
export { TimeAggregationCalculator } from './aggregation.js';
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
} from './types.js';
