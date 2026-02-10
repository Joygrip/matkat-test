/**
 * Approvals API calls
 */
import { apiClient } from './client';

export interface ApprovalStep {
  id: string;
  step_order: number;
  step_name: string;
  approver_id?: string;
  status: string;
  actioned_at?: string;
  actioned_by?: string;
  comment?: string;
}

export interface ApprovalInstance {
  id: string;
  tenant_id: string;
  subject_type: string;
  subject_id: string;
  status: string;
  steps: ApprovalStep[];
  created_by: string;
  created_at: string;
  // Enriched fields for actuals
  resource_name?: string | null;
  resource_id?: string | null;
  project_name?: string | null;
  project_id?: string | null;
  period_label?: string | null;
}

export const approvalsApi = {
  async getInbox(): Promise<ApprovalInstance[]> {
    return apiClient.get<ApprovalInstance[]>('/approvals/inbox');
  },
  
  async getApproval(instanceId: string): Promise<ApprovalInstance> {
    return apiClient.get<ApprovalInstance>(`/approvals/${instanceId}`);
  },
  
  async approveStep(instanceId: string, stepId: string, comment?: string): Promise<ApprovalInstance> {
    return apiClient.post<ApprovalInstance>(
      `/approvals/${instanceId}/steps/${stepId}/approve`,
      { comment }
    );
  },
  
  async rejectStep(instanceId: string, stepId: string, comment?: string): Promise<ApprovalInstance> {
    return apiClient.post<ApprovalInstance>(
      `/approvals/${instanceId}/steps/${stepId}/reject`,
      { comment }
    );
  },
  
  async proxyApproveDirectorStep(instanceId: string, stepId: string, comment: string): Promise<ApprovalInstance> {
    return apiClient.post<ApprovalInstance>(
      `/approvals/${instanceId}/steps/${stepId}/proxy-approve`,
      { comment }
    );
  },
};
