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
  placeholder_name?: string;
  department_id?: string;
  department_name?: string;
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
  project_name?: string;
  department_id?: string;
  department_name?: string;
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
  departmentId?: string;
  costCenterId?: string;
}

export const planningApi = {
  // Demand Lines
  async getDemandLines(periodId?: string, filters?: Omit<PlanningFilters, 'periodId'>): Promise<DemandLine[]> {
    const params = new URLSearchParams();
    if (periodId) params.set('period_id', periodId);
    if (filters?.departmentId) params.set('department_id', filters.departmentId);
    if (filters?.costCenterId) params.set('cost_center_id', filters.costCenterId);
    const qs = params.toString();
    const url = `/demand-lines${qs ? `?${qs}` : ''}`;
    console.log('[planningApi] GET', url);
    const result = await apiClient.get<DemandLine[]>(url);
    console.log('[planningApi] Response:', result.length, 'lines');
    return result;
  },
  
  async createDemandLine(data: CreateDemandLine): Promise<DemandLine> {
    return apiClient.post<DemandLine>('/demand-lines', data);
  },
  
  async updateDemandLine(id: string, data: Partial<CreateDemandLine>): Promise<DemandLine> {
    return apiClient.put<DemandLine>(`/demand-lines/${id}`, data);
  },
  
  async deleteDemandLine(id: string): Promise<void> {
    return apiClient.delete(`/demand-lines/${id}`);
  },
  
  async bulkDemandLines(body: any): Promise<any> {
    return apiClient.post('/demand-lines/bulk', body);
  },
  
  // Supply Lines
  async getSupplyLines(periodId?: string, filters?: Omit<PlanningFilters, 'periodId'>): Promise<SupplyLine[]> {
    const params = new URLSearchParams();
    if (periodId) params.set('period_id', periodId);
    if (filters?.departmentId) params.set('department_id', filters.departmentId);
    if (filters?.costCenterId) params.set('cost_center_id', filters.costCenterId);
    const qs = params.toString();
    return apiClient.get<SupplyLine[]>(`/supply-lines${qs ? `?${qs}` : ''}`);
  },
  
  async createSupplyLine(data: CreateSupplyLine): Promise<SupplyLine> {
    return apiClient.post<SupplyLine>('/supply-lines', data);
  },
  
  async updateSupplyLine(id: string, data: Partial<CreateSupplyLine>): Promise<SupplyLine> {
    return apiClient.put<SupplyLine>(`/supply-lines/${id}`, data);
  },
  
  async deleteSupplyLine(id: string): Promise<void> {
    return apiClient.delete(`/supply-lines/${id}`);
  },
  
  async bulkSupplyLines(body: any): Promise<any> {
    return apiClient.post('/supply-lines/bulk', body);
  },
  
};
