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

  listCostCenters: async (): Promise<CostCenter[]> => {
    return apiClient.get<CostCenter[]>('/lookups/cost-centers');
  },

  listProjects: async (): Promise<Project[]> => {
    return apiClient.get<Project[]>('/lookups/projects');
  },

  listResources: async (): Promise<Resource[]> => {
    return apiClient.get<Resource[]>('/lookups/resources');
  },

  listPlaceholders: async (): Promise<Placeholder[]> => {
    return apiClient.get<Placeholder[]>('/lookups/placeholders');
  },
};
