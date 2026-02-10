/**
 * Actuals API calls
 */
import { apiClient } from './client';

export interface ActualLine {
  id: string;
  tenant_id: string;
  period_id: string;
  resource_id: string;
  project_id: string;
  year: number;
  month: number;
  planned_fte_percent: number | null;
  actual_fte_percent: number;
  employee_signed_at?: string;
  employee_signed_by?: string;
  is_proxy_signed: boolean;
  proxy_sign_reason?: string;
  ro_approved_at?: string;
  ro_approved_by?: string;
  created_by: string;
  created_at: string;
}

export interface CreateActualLine {
  period_id: string;
  resource_id: string;
  project_id: string;
  year: number;
  month: number;
  planned_fte_percent?: number | null;
  actual_fte_percent: number;
}

export interface ResourceMonthlyTotal {
  resource_id: string;
  year: number;
  month: number;
  total_actual_fte: number;
  remaining: number;
  lines: ActualLine[];
}

export const actualsApi = {
  async getActualLines(periodId?: string, year?: number, month?: number): Promise<ActualLine[]> {
    const params = new URLSearchParams();
    if (periodId) params.append('period_id', periodId);
    if (year) params.append('year', String(year));
    if (month) params.append('month', String(month));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiClient.get<ActualLine[]>(`/actuals${query}`);
  },
  
  async getMyActuals(year?: number, month?: number): Promise<ActualLine[]> {
    const params = new URLSearchParams();
    if (year) params.append('year', String(year));
    if (month) params.append('month', String(month));
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiClient.get<ActualLine[]>(`/actuals/my${query}`);
  },
  
  async getMyResource(): Promise<{ resource_id: string | null }> {
    return apiClient.get<{ resource_id: string | null }>('/actuals/my-resource');
  },
  
  async getResourceMonthlyTotal(resourceId: string, year: number, month: number): Promise<ResourceMonthlyTotal> {
    return apiClient.get<ResourceMonthlyTotal>(`/actuals/resource/${resourceId}/month?year=${year}&month=${month}`);
  },
  
  async createActualLine(data: CreateActualLine): Promise<ActualLine> {
    return apiClient.post<ActualLine>('/actuals', data);
  },
  
  async updateActualLine(id: string, data: Partial<CreateActualLine>): Promise<ActualLine> {
    return apiClient.put<ActualLine>(`/actuals/${id}`, data);
  },
  
  async deleteActualLine(id: string): Promise<void> {
    return apiClient.delete(`/actuals/${id}`);
  },
  
  async signActuals(actualId: string): Promise<ActualLine> {
    return apiClient.post<ActualLine>(`/actuals/${actualId}/sign`, {});
  },
  
  async proxySignActuals(actualId: string, reason: string): Promise<ActualLine> {
    return apiClient.post<ActualLine>(`/actuals/${actualId}/proxy-sign`, { reason });
  },
};
