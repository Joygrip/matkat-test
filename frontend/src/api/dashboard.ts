// Dashboard analytics API for demand/supply aggregation
import { apiClient } from './client';

export interface DemandSupplyByCostCenter {
  cost_center_id: string;
  cost_center_name?: string;
  year: number;
  month: number;
  demand_fte: number;
  supply_fte: number;
}

export interface DemandSupplyByProject {
  project_id: string;
  project_name?: string;
  year: number;
  month: number;
  demand_fte: number;
  supply_fte: number;
}

export interface DemandSupplyAggregationResponse {
  by_cost_center: DemandSupplyByCostCenter[];
  by_project: DemandSupplyByProject[];
}

export const dashboardApi = {
  async getDemandSupplyAggregation(): Promise<DemandSupplyAggregationResponse> {
    return apiClient.get<DemandSupplyAggregationResponse>(`/dashboard/aggregation`);
  },
};
