/**
 * Consolidation API calls
 */
import { apiClient } from './client';

export interface Gap {
  resource_id: string;
  resource_name: string;
  year: number;
  month: number;
  demand_fte: number;
  supply_fte: number;
  gap_fte: number;
  status: string;
}

export interface OrphanDemand {
  demand_line_id: string;
  project_id: string;
  project_name: string;
  placeholder_id: string;
  placeholder_name: string;
  year: number;
  month: number;
  fte_percent: number;
}

export interface OverAllocation {
  resource_id: string;
  resource_name: string;
  year: number;
  month: number;
  total_demand_fte: number;
}

export interface DashboardSummary {
  total_resources: number;
  gaps_count: number;
  orphans_count: number;
  over_allocations_count: number;
}

export interface ConsolidationDashboard {
  period_id: string;
  period: string;
  gaps: Gap[];
  orphan_demands: OrphanDemand[];
  over_allocations: OverAllocation[];
  summary: DashboardSummary;
}

export interface SnapshotLine {
  id: string;
  line_type: string;
  project_id?: string;
  project_name?: string;
  resource_id?: string;
  resource_name?: string;
  placeholder_id?: string;
  placeholder_name?: string;
  year: number;
  month: number;
  fte_percent?: number;
  hours?: number;
  cost?: number;
}

export interface Snapshot {
  id: string;
  tenant_id: string;
  period_id: string;
  name: string;
  description?: string;
  published_by: string;
  published_at: string;
  lines_count: number;
}

export interface SnapshotDetail extends Snapshot {
  lines: SnapshotLine[];
}

export const consolidationApi = {
  async getDashboard(periodId: string): Promise<ConsolidationDashboard> {
    return apiClient.get<ConsolidationDashboard>(`/consolidation/dashboard/${periodId}`);
  },
  
  async publishSnapshot(periodId: string, name: string, description?: string): Promise<Snapshot> {
    return apiClient.post<Snapshot>(`/consolidation/publish/${periodId}`, { name, description });
  },
  
  async getSnapshots(periodId?: string): Promise<Snapshot[]> {
    const params = periodId ? `?period_id=${periodId}` : '';
    return apiClient.get<Snapshot[]>(`/consolidation/snapshots${params}`);
  },
  
  async getSnapshot(snapshotId: string): Promise<SnapshotDetail> {
    return apiClient.get<SnapshotDetail>(`/consolidation/snapshots/${snapshotId}`);
  },
};
