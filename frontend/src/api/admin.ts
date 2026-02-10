/**
 * Admin API client methods.
 */
import { apiClient } from './client';

// Types
export interface Department {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CostCenter {
  id: string;
  tenant_id: string;
  department_id: string;
  code: string;
  name: string;
  ro_user_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  pm_user_id: string | null;
  cost_center_id: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Resource {
  id: string;
  tenant_id: string;
  cost_center_id: string;
  employee_id: string;
  display_name: string;
  email: string | null;
  user_id: string | null;
  is_external: boolean;
  is_student: boolean;
  is_operator: boolean;
  is_equipment: boolean;
  hourly_cost: number | null;
  is_active: boolean;
  is_oop: boolean;
  created_at: string;
  updated_at: string;
}

export interface Placeholder {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  skill_profile: string | null;
  estimated_cost: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Holiday {
  id: string;
  tenant_id: string;
  date: string;
  name: string;
  is_company_wide: boolean;
  created_at: string;
}

export interface Setting {
  id: string;
  tenant_id: string;
  key: string;
  value: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

// API methods
export const adminApi = {
  // Departments
  listDepartments: () => apiClient.get<Department[]>('/admin/departments'),
  createDepartment: (data: { code: string; name: string }) =>
    apiClient.post<Department>('/admin/departments', data),
  updateDepartment: (id: string, data: Partial<Department>) =>
    apiClient.patch<Department>(`/admin/departments/${id}`, data),
  deleteDepartment: (id: string) =>
    apiClient.delete<{ message: string }>(`/admin/departments/${id}`),

  // Cost Centers
  listCostCenters: () => apiClient.get<CostCenter[]>('/admin/cost-centers'),
  createCostCenter: (data: { department_id: string; code: string; name: string; ro_user_id?: string }) =>
    apiClient.post<CostCenter>('/admin/cost-centers', data),
  updateCostCenter: (id: string, data: Partial<CostCenter>) =>
    apiClient.patch<CostCenter>(`/admin/cost-centers/${id}`, data),
  deleteCostCenter: (id: string) =>
    apiClient.delete<{ message: string }>(`/admin/cost-centers/${id}`),

  // Projects
  listProjects: () => apiClient.get<Project[]>('/admin/projects'),
  createProject: (data: { code: string; name: string; pm_user_id?: string; cost_center_id?: string }) =>
    apiClient.post<Project>('/admin/projects', data),
  updateProject: (id: string, data: Partial<Project>) =>
    apiClient.patch<Project>(`/admin/projects/${id}`, data),
  deleteProject: (id: string) =>
    apiClient.delete<{ message: string }>(`/admin/projects/${id}`),

  // Resources
  listResources: () => apiClient.get<Resource[]>('/admin/resources'),
  createResource: (data: {
    cost_center_id: string;
    employee_id: string;
    display_name: string;
    email?: string;
    is_external?: boolean;
    is_student?: boolean;
    is_operator?: boolean;
    is_equipment?: boolean;
    hourly_cost?: number;
  }) => apiClient.post<Resource>('/admin/resources', data),
  updateResource: (id: string, data: Partial<Resource>) =>
    apiClient.patch<Resource>(`/admin/resources/${id}`, data),
  deleteResource: (id: string) =>
    apiClient.delete<{ message: string }>(`/admin/resources/${id}`),

  // Placeholders
  listPlaceholders: () => apiClient.get<Placeholder[]>('/admin/placeholders'),
  createPlaceholder: (data: { name: string; description?: string; skill_profile?: string; estimated_cost?: number }) =>
    apiClient.post<Placeholder>('/admin/placeholders', data),
  updatePlaceholder: (id: string, data: Partial<Placeholder>) =>
    apiClient.patch<Placeholder>(`/admin/placeholders/${id}`, data),
  deletePlaceholder: (id: string) =>
    apiClient.delete<{ message: string }>(`/admin/placeholders/${id}`),

  // Holidays
  listHolidays: () => apiClient.get<Holiday[]>('/admin/holidays'),
  createHoliday: (data: { date: string; name: string; is_company_wide?: boolean }) =>
    apiClient.post<Holiday>('/admin/holidays', data),
  deleteHoliday: (id: string) =>
    apiClient.delete<{ message: string }>(`/admin/holidays/${id}`),

  // Settings
  listSettings: () => apiClient.get<Setting[]>('/admin/settings'),
  createSetting: (data: { key: string; value: string; description?: string }) =>
    apiClient.post<Setting>('/admin/settings', data),
  updateSetting: (key: string, data: { value?: string; description?: string }) =>
    apiClient.patch<Setting>(`/admin/settings/${key}`, data),
  deleteSetting: (key: string) =>
    apiClient.delete<{ message: string }>(`/admin/settings/${key}`),
};
