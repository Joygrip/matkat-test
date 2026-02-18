import { apiClient } from './client';

export interface CostCenterStats {
  cost_center_id: string;
  cost_center_name: string;
  demand_fte: number;
  supply_fte: number;
  actuals_fte: number;
}

export async function getCostCenterStats(year: number, month: number, departmentId?: string): Promise<CostCenterStats[]> {
  const params = new URLSearchParams({ year: String(year), month: String(month) });
  if (departmentId) params.append('department_id', departmentId);
  const res = await apiClient.get(`/finance/actuals-vs-plan?${params.toString()}`);
  return res.data;
}
