/**
 * Planning API calls - Demand and Supply
 */
import { apiClient } from './client';

export interface DemandLine {
  id: string;
  tenant_id: string;
  period_id: string;
  project_id: string;
  resource_id?: string;
  placeholder_id?: string;
  year: number;
  month: number;
  fte_percent: number;
  created_by: string;
  created_at: string;
  // Enriched fields
  project_name?: string;
  resource_name?: string;
  resource_initials?: string;
  placeholder_name?: string;
  cost_center_id?: string;
  cost_center_name?: string;
}

export interface SupplyLine {
  id: string;
  tenant_id: string;
  period_id: string;
  resource_id: string;
  project_id?: string;
  year: number;
  month: number;
  fte_percent: number;
  created_by: string;
  created_at: string;
  // Enriched fields
  resource_name?: string;
  resource_initials?: string;
  project_name?: string;
  cost_center_id?: string;
  cost_center_name?: string;
}

export interface CreateDemandLine {
  period_id: string;
  project_id: string;
  resource_id?: string;
  placeholder_id?: string;
  fte_percent: number;
  // year/month are optional and derived from period_id server-side
  year?: number;
  month?: number;
}

export interface CreateSupplyLine {
  period_id: string;
  resource_id: string;
  project_id?: string;
  fte_percent: number;
  // year/month are optional and derived from period_id server-side
  year?: number;
  month?: number;
}

export interface PlanningFilters {
  periodId?: string;
  costCenterId?: string;
  resourceId?: string;
}

export interface BulkAction<TCreate> {
  action: 'create' | 'update' | 'delete';
  data: Partial<TCreate> & { id?: string };
}

export interface BulkRequest<TCreate> {
  actions: BulkAction<TCreate>[];
  all_or_nothing?: boolean;
}

export interface BulkResponse {
  results?: Array<{ status: string; error?: string | null }>;
}

export interface DeleteDemandGroupRequest {
  resource_id?: string;
  placeholder_id?: string;
  project_id: string;
  period_ids: string[];
}

export interface MoveDemandGroupRequest {
  from_resource_id?: string;
  from_placeholder_id?: string;
  to_resource_id?: string;
  to_placeholder_id?: string;
  project_id: string;
  to_project_id: string;
  period_ids: string[];
  confirm_cap?: boolean;
  operation?: 'move' | 'copy';
  period_mappings?: { from_period_id: string; to_period_id: string }[];
  merge_mode?: 'add' | 'replace';
}

export interface DeleteSupplyGroupRequest {
  resource_id: string;
  project_id?: string | null;
  period_ids: string[];
}

export interface MoveSupplyGroupRequest {
  from_resource_id: string;
  to_resource_id: string;
  project_id?: string | null;
  to_project_id: string | null;
  period_ids: string[];
  confirm_cap?: boolean;
  operation?: 'move' | 'copy';
  period_mappings?: { from_period_id: string; to_period_id: string }[];
  merge_mode?: 'add' | 'replace';
}

export interface MoveCapPeriodDetail {
  period_id: string;
  label: string;
  existing_fte: number;
  moved_fte: number;
  raw_total: number;
  capped_total: number;
}

export interface AllLinesFilter {
  projectId?: string;
  costCenterId?: string;
}

export const planningApi = {
  // Demand Lines
  async getAllDemandLines(filters?: AllLinesFilter): Promise<DemandLine[]> {
    const params = new URLSearchParams();
    if (filters?.projectId) params.set('project_id', filters.projectId);
    if (filters?.costCenterId) params.set('cost_center_id', filters.costCenterId);
    const qs = params.toString();
    return apiClient.get<DemandLine[]>(`/demand-lines/all${qs ? `?${qs}` : ''}`);
  },

  async getAllSupplyLines(filters?: AllLinesFilter): Promise<SupplyLine[]> {
    const params = new URLSearchParams();
    if (filters?.projectId) params.set('project_id', filters.projectId);
    if (filters?.costCenterId) params.set('cost_center_id', filters.costCenterId);
    const qs = params.toString();
    return apiClient.get<SupplyLine[]>(`/supply-lines/all${qs ? `?${qs}` : ''}`);
  },

  async getDemandLines(periodId?: string, filters?: Omit<PlanningFilters, 'periodId'>): Promise<DemandLine[]> {
    const params = new URLSearchParams();
    if (periodId) params.set('period_id', periodId);
    if (filters?.costCenterId) params.set('cost_center_id', filters.costCenterId);
    if (filters?.resourceId) params.set('resource_id', filters.resourceId);
    const qs = params.toString();
    return apiClient.get<DemandLine[]>(`/demand-lines${qs ? `?${qs}` : ''}`);
  },
  
  async createDemandLine(data: CreateDemandLine): Promise<DemandLine> {
    return apiClient.post<DemandLine>('/demand-lines', data);
  },
  
  async updateDemandLine(id: string, data: Partial<CreateDemandLine>): Promise<DemandLine> {
    return apiClient.patch<DemandLine>(`/demand-lines/${id}`, data);
  },
  
  async deleteDemandLine(id: string): Promise<void> {
    return apiClient.delete(`/demand-lines/${id}`);
  },
  
  async bulkDemandLines(body: BulkRequest<CreateDemandLine>): Promise<BulkResponse> {
    return apiClient.post<BulkResponse>('/demand-lines/bulk', body);
  },

  async deleteDemandGroup(body: DeleteDemandGroupRequest): Promise<{ deleted: number }> {
    return apiClient.post<{ deleted: number }>('/demand-lines/group/delete', body);
  },

  async moveDemandGroup(body: MoveDemandGroupRequest): Promise<{ moved: number }> {
    return apiClient.post<{ moved: number }>('/demand-lines/group/move', body);
  },
  
  // Supply Lines
  async getSupplyLines(periodId?: string, filters?: Omit<PlanningFilters, 'periodId'>): Promise<SupplyLine[]> {
    const params = new URLSearchParams();
    if (periodId) params.set('period_id', periodId);
    if (filters?.costCenterId) params.set('cost_center_id', filters.costCenterId);
    if (filters?.resourceId) params.set('resource_id', filters.resourceId);
    const qs = params.toString();
    return apiClient.get<SupplyLine[]>(`/supply-lines${qs ? `?${qs}` : ''}`);
  },
  
  async createSupplyLine(data: CreateSupplyLine): Promise<SupplyLine> {
    return apiClient.post<SupplyLine>('/supply-lines', data);
  },
  
  async updateSupplyLine(id: string, data: Partial<CreateSupplyLine>): Promise<SupplyLine> {
    return apiClient.patch<SupplyLine>(`/supply-lines/${id}`, data);
  },
  
  async deleteSupplyLine(id: string): Promise<void> {
    return apiClient.delete(`/supply-lines/${id}`);
  },
  
  async bulkSupplyLines(body: BulkRequest<CreateSupplyLine>): Promise<BulkResponse> {
    return apiClient.post<BulkResponse>('/supply-lines/bulk', body);
  },

  async deleteSupplyGroup(body: DeleteSupplyGroupRequest): Promise<{ deleted: number }> {
    return apiClient.post<{ deleted: number }>('/supply-lines/group/delete', body);
  },

  async moveSupplyGroup(body: MoveSupplyGroupRequest): Promise<{ moved: number }> {
    return apiClient.post<{ moved: number }>('/supply-lines/group/move', body);
  },

};
