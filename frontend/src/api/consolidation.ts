/**
 * Consolidation API calls
 */
import { apiClient } from './client';

// Cost-center dashboard types
export interface ProjectAllocation {
  project_id: string | null;
  project_name: string;
  demand_fte: number;
  supply_fte: number;
}

export interface DashboardResource {
  resource_id: string;
  resource_name: string;
  initials?: string | null;
  demand_fte: number;
  supply_fte: number;
  gap_fte: number;
  status: 'balanced' | 'under' | 'over';
  project_allocations?: ProjectAllocation[];
}

export interface DashboardPlaceholder {
  placeholder_id: string;
  placeholder_name: string;
  demand_fte: number;
  project_id: string;
  project_name: string;
}

export interface DashboardCostCenter {
  cost_center_id: string | null;
  cost_center_name: string;
  total_demand_fte: number;
  total_supply_fte: number;
  gap_fte: number;
  project_ids: string[];
  resources: DashboardResource[];
  placeholders: DashboardPlaceholder[];
}

export interface OverAllocation {
  resource_id: string;
  resource_name: string;
  cost_center_id?: string;
  cost_center_name?: string;
  total_demand_fte: number;
}

export interface DashboardSummary {
  total_cost_centers: number;
  total_demand_fte: number;
  total_supply_fte: number;
  total_gap_fte: number;
  orphans_count: number;
  over_allocations_count: number;
}

export interface ConsolidationDashboard {
  period_id: string;
  period: string;
  summary: DashboardSummary;
  cost_centers: DashboardCostCenter[];
  over_allocations: OverAllocation[];
}

export interface ResourceAssignmentLine {
  project_id: string | null;
  project_name: string | null;
  fte_percent: number;
}

export interface ResourceDetail {
  resource_id: string;
  resource_name: string;
  period_id: string;
  demand_lines: ResourceAssignmentLine[];
  supply_lines: ResourceAssignmentLine[];
  total_demand_fte: number;
  total_supply_fte: number;
  gap_fte: number;
}

export interface SnapshotLine {
  id: string;
  line_type: string;
  source_id?: string;
  project_id?: string;
  project_code?: string;
  project_name?: string;
  resource_id?: string;
  resource_initials?: string;
  resource_name?: string;
  placeholder_id?: string;
  placeholder_name?: string;
  cost_center_id?: string;
  cost_center_code?: string;
  cost_center_name?: string;
  year: number;
  month: number;
  fte_percent?: number;
  planned_fte_percent?: number;
  actual_fte_percent?: number;
  hours?: number;
  monthly_fte_cost_used?: number;
  planned_cost_cents?: number;
  actual_cost_cents?: number;
  cost?: number;
  approval_status?: string;
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
  monthly_fte_cost_used?: number;
  period_status_at_publish?: string;
}

export interface SnapshotDetail extends Snapshot {
  lines: SnapshotLine[];
}

export const consolidationApi = {
  async getDashboard(periodId: string, scope?: 'pm' | 'default'): Promise<ConsolidationDashboard> {
    const params = scope === 'pm' ? '?scope=pm' : '';
    return apiClient.get<ConsolidationDashboard>(`/consolidation/dashboard/${periodId}${params}`);
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

  async getResourceDetail(periodId: string, resourceId: string): Promise<ResourceDetail> {
    return apiClient.get<ResourceDetail>(`/consolidation/resource/${periodId}/${resourceId}`);
  },

  async downloadSnapshotCsv(snapshotId: string): Promise<void> {
    const { blob, filename } = await apiClient.getBlob(`/consolidation/snapshots/${snapshotId}/csv`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
