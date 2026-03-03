/**
 * Lookups API - Read-only master data access for all roles.
 */
import { apiClient } from './client';
import type { CostCenter, Project, Resource, Placeholder } from './admin';

export type { CostCenter, Project, Resource, Placeholder };

export const lookupsApi = {
  listCostCenters: async (): Promise<CostCenter[]> => {
    return apiClient.get<CostCenter[]>('/lookups/cost-centers');
  },

  listProjects: async (): Promise<Project[]> => {
    return apiClient.get<Project[]>('/lookups/projects');
  },

  listResources: async (costCenterId?: string): Promise<Resource[]> => {
    const params = new URLSearchParams();
    if (costCenterId) params.set('cost_center_id', costCenterId);
    const qs = params.toString();
    return apiClient.get<Resource[]>(`/lookups/resources${qs ? `?${qs}` : ''}`);
  },

  listPlaceholders: async (costCenterId?: string): Promise<Placeholder[]> => {
    const params = new URLSearchParams();
    if (costCenterId) params.set('cost_center_id', costCenterId);
    const qs = params.toString();
    return apiClient.get<Placeholder[]>(`/lookups/placeholders${qs ? `?${qs}` : ''}`);
  },
};
