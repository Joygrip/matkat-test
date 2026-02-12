/**
 * Error formatting helpers for API responses.
 */
import { ApiError } from '../types';

const codeMessages: Record<string, string> = {
  FTE_INVALID: 'FTE must be 0 or between 5 and 100 in steps of 5.',
  DEMAND_XOR: 'Demand must include either a resource or a placeholder (not both).',
  ACTUALS_OVER_100: 'Total actuals exceed 100% for this resource.',
  PERIOD_LOCKED: 'This period is locked. Select an open period or ask Finance to unlock.',
  UNAUTHORIZED_ROLE: 'You do not have permission to perform this action.',
  UNAUTHORIZED_RESOURCE: 'No resource linked to your account, or you can only manage your own actuals. Contact your administrator.',
  VALIDATION_ERROR: 'Validation error. Please check your input.',
  CONFLICT: 'An actual line already exists for this resource, project, and month.',
  NETWORK_ERROR: 'Cannot reach the API. Ensure the backend is running and CORS is configured for this origin.',
  TIMEOUT: 'The request took too long. The server may be slow or overloaded.',
};

export function getApiErrorDetail(error: ApiError): string {
  let detail = codeMessages[error.code] || error.detail || error.message;
  if (error.code === 'ACTUALS_OVER_100') {
    const total = error.extras?.total_percent;
    if (typeof total === 'number') {
      detail = `${detail} Total: ${total}%`;
    }
  }
  return detail;
}

export function getApiErrorTitle(error: ApiError): string {
  return `HTTP ${error.status} (${error.code})`;
}

export function formatApiError(error: unknown, context?: string): string {
  if (error instanceof ApiError) {
    const title = getApiErrorTitle(error);
    const detail = getApiErrorDetail(error);
    const message = `${title}: ${detail}`;
    return context ? `${context}: ${message}` : message;
  }
  if (error instanceof Error) {
    return context ? `${context}: ${error.message}` : error.message;
  }
  return context ? `${context}: Unexpected error` : 'Unexpected error';
}
