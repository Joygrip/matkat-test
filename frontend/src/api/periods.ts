/**
 * Period API client methods.
 */
import { apiClient } from './client';
import { Period } from '../types';

export type { Period };

export const periodsApi = {
  list: () => apiClient.get<Period[]>('/periods'),
  
  getCurrent: () => apiClient.get<Period>('/periods/current'),
  
  get: (id: string) => apiClient.get<Period>(`/periods/${id}`),
  
  create: (year: number, month: number) =>
    apiClient.post<Period>('/periods', { year, month }),
  
  lock: (id: string) => apiClient.post<Period>(`/periods/${id}/lock`),
  
  unlock: (id: string, reason: string) =>
    apiClient.post<Period>(`/periods/${id}/unlock`, { reason }),
};
