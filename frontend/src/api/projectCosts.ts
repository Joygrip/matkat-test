/**
 * Project Costs API — externals and OoP equipment per project/period.
 */
import { apiClient } from './client';

export interface ExternalResource {
  id: string;
  display_name: string;
  initials: string | null;
  employee_id: string;
}

export interface ExternalLine {
  id: string;
  tenant_id: string;
  project_id: string;
  period_id: string;
  resource_id: string | null;
  resource_name: string | null;
  description: string | null; // name / description (shown as OoP Resource when no resource_name)
  notes: string | null;        // additional free-text notes
  hours: number;
  rate: number;       // cents per hour
  total_cost: number; // cents
  created_by: string;
  created_at: string;
  updated_at: string;
  project_name?: string | null;
}

export interface ExternalLineCreate {
  project_id: string;
  period_id: string;
  resource_id?: string;
  description?: string; // name / description when no resource_id
  notes?: string;        // additional free-text notes
  hours: number;
  rate: number; // cents per hour
}

export interface ExternalLineUpdate {
  resource_id?: string;
  description?: string;
  notes?: string;
  hours?: number;
  rate?: number;
}

export interface EquipmentLine {
  id: string;
  tenant_id: string;
  project_id: string;
  period_id: string;
  description: string | null;
  cost: number; // cents
  created_by: string;
  created_at: string;
  updated_at: string;
  project_name?: string | null;
}

export interface EquipmentLineCreate {
  project_id: string;
  period_id: string;
  description?: string;
  cost: number; // cents
}

export interface EquipmentLineUpdate {
  description?: string;
  cost?: number;
}

export interface ProjectCostSummaryItem {
  project_id: string;
  project_name: string;
  externals_total: number;
  equipment_total: number;
  combined_total: number;
}

export interface ProjectCostSummary {
  externals_total: number;
  equipment_total: number;
  combined_total: number;
  per_project: ProjectCostSummaryItem[];
}

function buildQuery(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
}

export const projectCostsApi = {
  async listExternalResources(): Promise<ExternalResource[]> {
    return apiClient.get<ExternalResource[]>('/project-costs/external-resources');
  },

  async listExternals(params: { period_id?: string; project_id?: string } = {}): Promise<ExternalLine[]> {
    return apiClient.get<ExternalLine[]>(`/project-costs/externals${buildQuery(params)}`);
  },

  async createExternal(data: ExternalLineCreate): Promise<ExternalLine> {
    return apiClient.post<ExternalLine>('/project-costs/externals', data);
  },

  async updateExternal(id: string, data: ExternalLineUpdate): Promise<ExternalLine> {
    return apiClient.put<ExternalLine>(`/project-costs/externals/${id}`, data);
  },

  async deleteExternal(id: string): Promise<void> {
    await apiClient.delete(`/project-costs/externals/${id}`);
  },

  async listEquipment(params: { period_id?: string; project_id?: string } = {}): Promise<EquipmentLine[]> {
    return apiClient.get<EquipmentLine[]>(`/project-costs/equipment${buildQuery(params)}`);
  },

  async createEquipment(data: EquipmentLineCreate): Promise<EquipmentLine> {
    return apiClient.post<EquipmentLine>('/project-costs/equipment', data);
  },

  async updateEquipment(id: string, data: EquipmentLineUpdate): Promise<EquipmentLine> {
    return apiClient.put<EquipmentLine>(`/project-costs/equipment/${id}`, data);
  },

  async deleteEquipment(id: string): Promise<void> {
    await apiClient.delete(`/project-costs/equipment/${id}`);
  },

  async getSummary(params: { period_id?: string; project_id?: string } = {}): Promise<ProjectCostSummary> {
    return apiClient.get<ProjectCostSummary>(`/project-costs/summary${buildQuery(params)}`);
  },
};
