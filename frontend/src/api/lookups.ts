/**
 * Lookups API - Read-only master data access for all roles.
 */
import { apiClient } from './client';
import type { Department, CostCenter, Project, Resource, Placeholder } from './admin';

export type { Department, CostCenter, Project, Resource, Placeholder };

export const lookupsApi = {
  listDepartments: async (): Promise<Department[]> => {
    return apiClient.get<Department[]>('/lookups/departments');
  },

  listCostCenters: async (departmentId?: string): Promise<CostCenter[]> => {
    const params = new URLSearchParams();
    if (departmentId) params.set('department_id', departmentId);
    const qs = params.toString();
    return apiClient.get<CostCenter[]>(`/lookups/cost-centers${qs ? `?${qs}` : ''}`);
  },

  listProjects: async (): Promise<Project[]> => {
    return apiClient.get<Project[]>('/lookups/projects');
  },

  listResources: async (departmentId?: string, costCenterId?: string): Promise<Resource[]> => {
    const params = new URLSearchParams();
    if (departmentId) params.set('department_id', departmentId);
    if (costCenterId) params.set('cost_center_id', costCenterId);
    const qs = params.toString();
    return apiClient.get<Resource[]>(`/lookups/resources${qs ? `?${qs}` : ''}`);
  },

  listPlaceholders: async (departmentId?: string, costCenterId?: string): Promise<Placeholder[]> => {
    const params = new URLSearchParams();
    if (departmentId) params.set('department_id', departmentId);
    if (costCenterId) params.set('cost_center_id', costCenterId);
    const qs = params.toString();
    return apiClient.get<Placeholder[]>(`/lookups/placeholders${qs ? `?${qs}` : ''}`);
  },
};
