/**
 * Dev sample data seeding API client.
 */
import { apiClient } from './client';
import { config } from '../config';

export interface SeedRunRequest {
  scale?: 'small' | 'medium' | 'large';
  tenants?: number;
  include_approvals?: boolean;
  include_actuals?: boolean;
}

export interface SeedRunResponse {
  message: string;
  tenants_created: number;
  scale: string;
  entities_created: {
    departments: number;
    cost_centers: number;
    users: number;
    resources: number;
    projects: number;
    placeholders: number;
    periods: number;
    demand_lines: number;
    supply_lines: number;
    actual_lines: number;
    approvals: number;
    holidays: number;
  };
}

export interface SeedStatusResponse {
  enabled: boolean;
  allow_wipe: boolean;
  seed_runs: Array<{
    tenant_id: string;
    label: string;
    scale: string;
    created_at: string;
    counts: {
      departments: number;
      cost_centers: number;
      users: number;
      resources: number;
      projects: number;
      placeholders: number;
      periods: number;
      demand_lines: number;
      supply_lines: number;
      actual_lines: number;
      approvals: number;
      holidays: number;
    };
  }>;
}

export interface SeedWipeResponse {
  message: string;
  tenants_wiped: number;
  entities_deleted: {
    departments: number;
    cost_centers: number;
    users: number;
    resources: number;
    projects: number;
    placeholders: number;
    periods: number;
    demand_lines: number;
    supply_lines: number;
    actual_lines: number;
    approvals: number;
    holidays: number;
  };
}

export const devSeedApi = {
  async runSeed(request: SeedRunRequest = {}): Promise<SeedRunResponse> {
    if (!config.devSeedEnabled) {
      throw new Error('Dev seeding is not enabled');
    }
    return apiClient.post<SeedRunResponse>('/dev/seed/run', request);
  },

  async getStatus(): Promise<SeedStatusResponse> {
    if (!config.devSeedEnabled) {
      throw new Error('Dev seeding is not enabled');
    }
    return apiClient.get<SeedStatusResponse>('/dev/seed/status');
  },

  async wipeSeed(tenantId?: string): Promise<SeedWipeResponse> {
    if (!config.devSeedEnabled) {
      throw new Error('Dev seeding is not enabled');
    }
    if (!config.devSeedAllowWipe) {
      throw new Error('Wipe is not allowed');
    }
    const params = tenantId ? `?tenant_id=${tenantId}` : '';
    return apiClient.post<SeedWipeResponse>(`/dev/seed/wipe${params}`);
  },
};
