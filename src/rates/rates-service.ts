/**
 * Rate Resolution Service
 *
 * Provides rate lookup with configurable fallback chain:
 * 1. Harvest API (user.cost_rate, project.hourly_rate)
 * 2. rates.json config file
 * 3. DEFAULT_COST_RATE environment variable
 * 4. Zero (with warning)
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HarvestClient } from '../harvest/client.js';
import type {
  RatesConfig,
  RateInfo,
  RateSource,
  UserRate,
  ProjectRate,
  TaskAssignmentRate,
  GetRatesParams,
  GetRatesResponse,
} from './types.js';

const DEFAULT_CONFIG: RatesConfig = {
  user_overrides: {},
  project_overrides: {},
  defaults: {
    cost_rate: 0,
    billable_rate: null,
  },
};

export class RatesService {
  private client: HarvestClient;
  private config: RatesConfig | null = null;
  private configPath: string;
  private defaultCostRate: number;
  private warnings: string[] = [];

  constructor(client: HarvestClient, configDir?: string) {
    this.client = client;
    this.configPath = configDir
      ? join(configDir, 'rates.json')
      : join(process.cwd(), 'rates.json');
    this.defaultCostRate = parseFloat(process.env.DEFAULT_COST_RATE || '0');
  }

  /**
   * Load rates config from file if available
   */
  private async loadConfig(): Promise<boolean> {
    if (this.config !== null) {
      return true;
    }

    if (!existsSync(this.configPath)) {
      this.config = DEFAULT_CONFIG;
      return false;
    }

    try {
      const content = await readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(content) as Partial<RatesConfig>;
      this.config = {
        user_overrides: parsed.user_overrides ?? {},
        project_overrides: parsed.project_overrides ?? {},
        defaults: {
          cost_rate: parsed.defaults?.cost_rate ?? 0,
          billable_rate: parsed.defaults?.billable_rate ?? null,
        },
      };
      return true;
    } catch (error) {
      this.warnings.push(`Failed to load rates.json: ${error}`);
      this.config = DEFAULT_CONFIG;
      return false;
    }
  }

  /**
   * Resolve a rate with fallback chain
   */
  private resolveRate(
    apiValue: number | null | undefined,
    configOverride: number | undefined,
    defaultValue: number | null,
    apiSource: string
  ): RateInfo | null {
    // 1. API value (if non-null)
    if (apiValue !== null && apiValue !== undefined) {
      return {
        rate: apiValue,
        source: 'harvest_api',
        source_detail: apiSource,
      };
    }

    // 2. Config override
    if (configOverride !== undefined) {
      return {
        rate: configOverride,
        source: 'config_file',
        source_detail: this.configPath,
      };
    }

    // 3. Default from config or env
    if (defaultValue !== null) {
      return {
        rate: defaultValue,
        source: this.defaultCostRate > 0 ? 'env_default' : 'fallback_zero',
        source_detail: this.defaultCostRate > 0 ? 'DEFAULT_COST_RATE' : undefined,
      };
    }

    return null;
  }

  /**
   * Get rates for users
   */
  async getUserRates(userId?: number): Promise<UserRate[]> {
    await this.loadConfig();
    const results: UserRate[] = [];

    if (userId) {
      // Get specific user
      const userResponse = await this.client.getUser(userId);
      const user = userResponse;
      results.push(this.mapUserToRate(user));
    } else {
      // Get all users
      const usersResponse = await this.client.listUsers({ is_active: true });
      for (const user of usersResponse.users) {
        results.push(this.mapUserToRate(user));
      }
    }

    return results;
  }

  private mapUserToRate(user: {
    id: number;
    first_name: string;
    last_name: string;
    cost_rate: number | null;
    default_hourly_rate: number | null;
  }): UserRate {
    const configOverride = this.config?.user_overrides[String(user.id)];
    const defaultCost = this.config?.defaults.cost_rate ?? this.defaultCostRate;

    const costRate = this.resolveRate(
      user.cost_rate,
      configOverride?.cost_rate,
      defaultCost,
      'user.cost_rate'
    );

    // Warn if falling back to zero for cost rate
    if (costRate?.source === 'fallback_zero') {
      this.warnings.push(
        `User ${user.first_name} ${user.last_name} (${user.id}) has no cost rate configured`
      );
    }

    return {
      user_id: user.id,
      user_name: `${user.first_name} ${user.last_name}`,
      cost_rate: costRate!,
      default_hourly_rate: user.default_hourly_rate
        ? {
            rate: user.default_hourly_rate,
            source: 'harvest_api',
            source_detail: 'user.default_hourly_rate',
          }
        : null,
    };
  }

  /**
   * Get rates for projects
   */
  async getProjectRates(projectId?: number): Promise<ProjectRate[]> {
    await this.loadConfig();
    const results: ProjectRate[] = [];

    if (projectId) {
      const projectResponse = await this.client.getProject(projectId);
      results.push(await this.mapProjectToRate(projectResponse));
    } else {
      const projectsResponse = await this.client.listProjects({ is_active: true });
      for (const project of projectsResponse.projects) {
        results.push(await this.mapProjectToRate(project));
      }
    }

    return results;
  }

  private async mapProjectToRate(project: {
    id: number;
    name: string;
    client: { id: number; name: string };
    hourly_rate: number | null;
    budget: number | null;
    budget_by: string;
    is_billable: boolean;
  }): Promise<ProjectRate> {
    const configOverride = this.config?.project_overrides[String(project.id)];

    const hourlyRate = project.is_billable
      ? this.resolveRate(
          project.hourly_rate,
          configOverride?.hourly_rate,
          this.config?.defaults.billable_rate ?? null,
          'project.hourly_rate'
        )
      : null;

    return {
      project_id: project.id,
      project_name: project.name,
      client_id: project.client.id,
      client_name: project.client.name,
      hourly_rate: hourlyRate,
      budget: project.budget,
      budget_by: project.budget_by,
      is_billable: project.is_billable,
    };
  }

  /**
   * Get all rates (users and projects)
   */
  async getRates(params: GetRatesParams = {}): Promise<GetRatesResponse> {
    this.warnings = [];
    const configLoaded = await this.loadConfig();

    const response: GetRatesResponse = {
      config_loaded: configLoaded,
      warnings: [],
    };

    // Get user rates
    if (params.user_id || params.include_all_users) {
      response.users = await this.getUserRates(params.user_id);
    }

    // Get project rates
    if (params.project_id || params.include_all_projects) {
      response.projects = await this.getProjectRates(params.project_id);
    }

    // If no specific params, return both users and projects
    if (!params.user_id && !params.project_id &&
        !params.include_all_users && !params.include_all_projects) {
      response.users = await this.getUserRates();
      response.projects = await this.getProjectRates();
    }

    response.warnings = this.warnings;
    return response;
  }

  /**
   * Get the rate source for logging/debugging
   */
  describeRateSource(rateInfo: RateInfo): string {
    switch (rateInfo.source) {
      case 'harvest_api':
        return `From Harvest API (${rateInfo.source_detail})`;
      case 'config_file':
        return `From config file (${rateInfo.source_detail})`;
      case 'env_default':
        return `From environment variable (${rateInfo.source_detail})`;
      case 'fallback_zero':
        return 'No rate configured (using 0)';
    }
  }
}
