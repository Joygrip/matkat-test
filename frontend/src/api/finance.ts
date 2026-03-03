import { apiClient } from './client';

export interface CostCenterStats {
  cost_center_id: string;
  cost_center_name: string;
  demand_fte: number;
  supply_fte: number;
  actuals_fte: number;
}

export async function getCostCenterStats(year: number, month: number, costCenterId?: string): Promise<CostCenterStats[]> {
  const params = new URLSearchParams({ year: String(year), month: String(month) });
  if (costCenterId) params.append('cost_center_id', costCenterId);
  return apiClient.get<CostCenterStats[]>(`/finance/actuals-vs-plan?${params.toString()}`);
}

export interface EmployeeStats {
  resource_id: string;
  employee_name: string;
  demand_fte: number;
  actuals_fte: number;
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
  return apiClient.get<EmployeeStats[]>(`/finance/actuals-vs-plan-by-employee?${params.toString()}`);
}
