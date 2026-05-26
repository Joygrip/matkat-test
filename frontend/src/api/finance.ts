import { apiClient } from './client';

export interface CostCenterStats {
  cost_center_id: string;
  cost_center_name: string;
  demand_fte: number;
  supply_fte: number;
  actuals_fte: number;
}

export interface ProjectBreakdown {
  project_id: string;
  project_name: string;
  demand_fte: number;
  supply_fte?: number;
  actuals_fte: number;
}

export interface EmployeeStats {
  resource_id: string;
  employee_name: string;
  employee_email?: string;
  demand_fte: number;
  supply_fte: number;
  actuals_fte: number;
  projects: ProjectBreakdown[];
  cost_center_id?: string;
  cost_center_name?: string;
  employee_initials?: string;
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

export interface ConsolidatedCostRow {
  project_id: string;
  project_name: string;
  cost_center_id: string | null;
  cost_center_name: string | null;
  cost_center_code: string | null;
  year: number;
  month: number;
  demand_cost: number;    // cents — planned labor
  actuals_cost: number;   // cents — actual labor
  externals_cost: number; // cents — external contractors
  equipment_cost: number; // cents — equipment
}

export interface ConsolidatedCostResponse {
  data: ConsolidatedCostRow[];
  monthly_fte_cost: number; // cents
}

export async function getConsolidatedCosts(params?: {
  project_id?: string;
  cost_center_id?: string;
  year?: number;
  month?: number;
  group_by?: 'id' | 'code';
}): Promise<ConsolidatedCostResponse> {
  const query = new URLSearchParams();
  if (params?.project_id) query.append('project_id', params.project_id);
  if (params?.cost_center_id) query.append('cost_center_id', params.cost_center_id);
  if (params?.year != null) query.append('year', String(params.year));
  if (params?.month != null) query.append('month', String(params.month));
  if (params?.group_by) query.append('group_by', params.group_by);
  const qs = query.toString();
  return apiClient.get<ConsolidatedCostResponse>(`/finance/consolidated-costs${qs ? `?${qs}` : ''}`);
}

export interface DemandLineDetail {
  resource_name: string;
  fte_percent: number;
  cost: number;       // cents
  project_name: string | null;
  cost_center_name: string | null;
}

export interface ActualLineDetail {
  resource_name: string;
  fte_percent: number;
  cost: number;       // cents
  project_name: string | null;
  cost_center_name: string | null;
}

export interface ExternalLineDetail {
  resource_name: string | null;
  description: string | null;
  notes: string | null;
  hours: number;
  rate: number;       // cents/hr
  total_cost: number; // cents
  project_name: string | null;
}

export interface EquipmentLineDetail {
  description: string | null;
  cost: number;       // cents
  project_name: string | null;
}

export interface ConsolidatedCostDetail {
  project_id: string | null;
  project_name: string | null;
  cost_center_id: string | null;
  cost_center_name: string | null;
  year: number;
  month: number;
  monthly_fte_cost: number;
  demand_lines: DemandLineDetail[];
  actual_lines: ActualLineDetail[];
  external_lines: ExternalLineDetail[];
  equipment_lines: EquipmentLineDetail[];
}

export async function getConsolidatedCostDetail(params: {
  year?: number;
  month?: number;
  project_id?: string;
  cost_center_id?: string;
  cost_center_code?: string;
}): Promise<ConsolidatedCostDetail[]> {
  const query = new URLSearchParams();
  if (params.year != null) query.append('year', String(params.year));
  if (params.month != null) query.append('month', String(params.month));
  if (params.project_id) query.append('project_id', params.project_id);
  if (params.cost_center_id) query.append('cost_center_id', params.cost_center_id);
  if (params.cost_center_code) query.append('cost_center_code', params.cost_center_code);
  return apiClient.get<ConsolidatedCostDetail[]>(`/finance/consolidated-costs/detail?${query.toString()}`);
}
