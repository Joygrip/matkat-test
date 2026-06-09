/**
 * Shared TypeScript types.
 */

// User roles matching backend
export type UserRole = 'Admin' | 'Finance' | 'PM' | 'Manager' | 'Employee' | 'Reader';

// Period status
export type PeriodStatus = 'open' | 'locked';

// Valid secondary roles
export type SecondaryRole = 'Reader' | 'PM';

// Current user info
export interface MeResponse {
  id: string;
  tenant_id: string;
  object_id: string;
  email: string;
  display_name: string;
  role: UserRole;
  secondary_role?: SecondaryRole | string;
  permissions: string[];
  // Computed effective-role flags from backend
  is_manager_reader?: boolean;
  is_manager_pm?: boolean;
  can_pm?: boolean;
  can_manage?: boolean;
}

// Health response
export interface HealthResponse {
  status: string;
  version: string;
  environment: string;
}

// Period
export interface Period {
  id: string;
  tenant_id: string;
  year: number;
  month: number;
  monthly_fte_cost?: number;
  status: PeriodStatus;
  locked_at: string | null;
  locked_by: string | null;
  lock_reason: string | null;
  created_at: string;
  updated_at: string;
}

// Problem Details error response
export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  errors?: Array<{
    field: string;
    message: string;
    type: string;
  }>;
  [key: string]: unknown;
}

// API Error
export class ApiError extends Error {
  title: string;
  status: number;
  code: string;
  detail?: string;
  errors?: ProblemDetail['errors'];
  extras: Record<string, unknown>;

  constructor(problem: ProblemDetail) {
    super(problem.title);
    this.title = problem.title;
    this.status = problem.status;
    this.code = problem.code;
    this.detail = problem.detail;
    this.errors = problem.errors;
    const {
      type,
      title,
      status,
      detail,
      code,
      errors,
      instance,
      ...extras
    } = problem;
    this.extras = extras;
  }
}

// Dev auth state
export interface DevAuthState {
  role: UserRole;
  tenantId: string;
  userId: string;
  email: string;
  displayName: string;
  resourceId?: string; // Optional resource ID for employees
}
