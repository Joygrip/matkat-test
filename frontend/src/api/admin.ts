/**
 * Admin API client methods.
 */
import { apiClient } from './client';
import type { UserRole } from '../types';

// Types
export interface CostCenter {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  ro_user_id: string | null;
  director_user_id: string | null;
  location: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HierarchyMember {
  level: number;
  title: string;
  user_id: string;
  display_name: string;
  email: string;
  job_title: string | null;
}

export interface CostCenterHierarchy {
  chain: HierarchyMember[];
}

export interface Project {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  pm_user_ids: string[];
  cost_center_id: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type ResourceType = 'Employee' | 'External' | 'Student' | 'OOP';

export interface Resource {
  id: string;
  tenant_id: string;
  cost_center_id: string;
  employee_id: string;
  display_name: string;
  initials?: string | null;
  email: string | null;
  user_id: string | null;
  resource_type: ResourceType;
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
  cost_center_id: string;
  cost_center_name: string | null;
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

export interface AdminUser {
  id: string;
  display_name: string;
  email: string;
  role: string;
  cost_center_name?: string | null;
}

export interface AdminUserDetail {
  id: string;
  tenant_id: string;
  object_id: string;
  email: string;
  display_name: string;
  role: UserRole;
  secondary_role: string | null;
  is_active: boolean;
  cost_center_id: string | null;
  cost_center_name: string | null;
  created_at: string;
  updated_at: string;
}

// API methods
export const adminApi = {
  // Cost Centers
  listCostCenters: () => apiClient.get<CostCenter[]>('/admin/cost-centers'),
  createCostCenter: (data: { code: string; name: string; ro_user_id?: string; director_user_id?: string; location?: string }) =>
    apiClient.post<CostCenter>('/admin/cost-centers', data),
  updateCostCenter: (id: string, data: Partial<CostCenter>) =>
    apiClient.patch<CostCenter>(`/admin/cost-centers/${id}`, data),
  deleteCostCenter: (id: string) =>
    apiClient.delete<{ message: string }>(`/admin/cost-centers/${id}`),
  getCostCenterHierarchy: (id: string) =>
    apiClient.get<CostCenterHierarchy>(`/admin/cost-centers/${id}/hierarchy`),

  // Users (for PM assignment dropdowns)
  listUsers: (role?: string) =>
    apiClient.get<AdminUser[]>(`/lookups/users${role ? `?role=${encodeURIComponent(role)}` : ''}`),

  // Projects
  listProjects: () => apiClient.get<Project[]>('/admin/projects'),
  createProject: (data: { code: string; name: string; pm_user_ids?: string[]; cost_center_id?: string }) =>
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
    resource_type?: ResourceType;
    hourly_cost?: number;
  }) => apiClient.post<Resource>('/admin/resources', data),
  updateResource: (id: string, data: Partial<Resource>) =>
    apiClient.patch<Resource>(`/admin/resources/${id}`, data),
  deleteResource: (id: string) =>
    apiClient.delete<{ message: string }>(`/admin/resources/${id}`),

  // Placeholders
  listPlaceholders: () => apiClient.get<Placeholder[]>('/admin/placeholders'),
  createPlaceholder: (data: { cost_center_id: string; name?: string; description?: string; skill_profile?: string; estimated_cost?: number }) =>
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

  // Manager Overrides
  listManagerOverrides: () => apiClient.get<ManagerOverride[]>('/admin/reporting/overrides'),
  createManagerOverride: (data: { employee_object_id: string; manager_object_id: string; note?: string }) =>
    apiClient.post<ManagerOverride>('/admin/reporting/overrides', data),
  patchManagerOverride: (id: string, data: { is_active?: boolean; note?: string }) =>
    apiClient.patch<ManagerOverride>(`/admin/reporting/overrides/${id}`, data),
  deleteManagerOverride: (id: string) =>
    apiClient.delete<void>(`/admin/reporting/overrides/${id}`),
  syncReportingCache: () =>
    apiClient.post<{ rows_written: number; message: string }>('/admin/reporting/sync-cache', {}),

  // User management (role assignment)
  listAdminUsers: () =>
    apiClient.get<AdminUserDetail[]>('/admin/users'),
  updateAdminUser: (id: string, data: { role?: UserRole; is_active?: boolean }) =>
    apiClient.patch<AdminUserDetail>(`/admin/users/${id}`, data),
  updateAdminUserSecondaryRole: (id: string, secondary_role: string | null) =>
    apiClient.patch<AdminUserDetail>(`/admin/users/${id}/secondary-role`, { secondary_role }),

  // Sync status
  getSyncStatus: () =>
    apiClient.get<{ last_sync_at: string | null; status: string; sync_type: string | null }>('/admin/sync/status'),

  // Approval Delegates
  listDelegates: () =>
    apiClient.get<ApprovalDelegate[]>('/admin/delegates'),
  listDelegatesAsDelegate: () =>
    apiClient.get<ApprovalDelegate[]>('/admin/delegates?as_delegate=true'),
  createDelegate: (data: { delegator_id?: string; delegate_id: string; note?: string }) =>
    apiClient.post<ApprovalDelegate>('/admin/delegates', data),
  patchDelegate: (id: string, data: { is_active?: boolean; note?: string }) =>
    apiClient.patch<ApprovalDelegate>(`/admin/delegates/${id}`, data),
  deleteDelegate: (id: string) =>
    apiClient.delete<void>(`/admin/delegates/${id}`),
};

// Types for reporting
export interface ManagerOverride {
  id: string;
  tenant_id: string;
  employee_object_id: string;
  manager_object_id: string;
  is_active: boolean;
  note: string | null;
  created_at: string;
  created_by: string;
}

export interface ApprovalDelegate {
  id: string;
  tenant_id: string;
  delegator_id: string;
  delegate_id: string;
  delegator_name: string | null;
  delegate_name: string | null;
  is_active: boolean;
  note: string | null;
  created_at: string;
  created_by: string;
}
