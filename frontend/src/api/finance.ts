import { apiClient } from './client';

export interface CostCenterStats {
  cost_center_id: string;
  cost_center_name: string;
  demand_fte: number;
  supply_fte: number;
  actuals_fte: number;
}

export interface EmployeeStats {
  resource_id: string;
  employee_name: string;
  demand_fte: number;
  actuals_fte: number;
}

export async function getCostCenterStats(year: number, month: number, costCenterId?: string): Promise<CostCenterStats[]> {
  const params = new URLSearchParams({ year: String(year), month: String(month) });
  if (costCenterId) params.append('cost_center_id', costCenterId);
  const res = await apiClient.get<CostCenterStats[]>(`/finance/actuals-vs-plan?${params.toString()}`);
  return res;
}

export async function getEmployeeStats(
  year: number,
  month: number,
  costCenterId?: string,
  projectId?: string
): Promise<EmployeeStats[]> {
  const params = new URLSearchParams({ year: String(year), month: String(month) });
  if (costCenterId) params.append('cost_center_id', costCenterId);
  if (projectId) params.append('project_id', projectId);
  const res = await apiClient.get<EmployeeStats[]>(`/finance/actuals-vs-plan-by-employee?${params.toString()}`);
  return res;
}

export interface FinanceSetting {
  setting_key: string;
  setting_value: string;
  updated_at?: string;
}

export async function getFinanceSetting(key: string): Promise<FinanceSetting> {
  return apiClient.get<FinanceSetting>(`/finance/settings/${key}`);
}

export async function updateFinanceSetting(key: string, value: string): Promise<FinanceSetting> {
  return apiClient.put<FinanceSetting>(`/finance/settings/${key}`, { setting_value: value });
}
