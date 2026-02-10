/**
 * API client with authentication and error handling.
 */
import { config } from '../config';
import { ApiError, DevAuthState, MeResponse, HealthResponse, ProblemDetail } from '../types';

class ApiClient {
  private baseUrl: string;
  private devAuth: DevAuthState | null = null;
  private tokenGetter: (() => Promise<string | null>) | null = null;

  constructor() {
    this.baseUrl = config.apiBaseUrl;
  }

  setDevAuth(auth: DevAuthState | null) {
    this.devAuth = auth;
  }

  setTokenGetter(getter: () => Promise<string | null>) {
    this.tokenGetter = getter;
  }

  private async getHeaders(): Promise<HeadersInit> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (config.devAuthBypass && this.devAuth) {
      // Dev mode headers
      headers['X-Dev-Role'] = this.devAuth.role;
      headers['X-Dev-Tenant'] = this.devAuth.tenantId;
      headers['X-Dev-User-Id'] = this.devAuth.userId;
      headers['X-Dev-Email'] = this.devAuth.email;
      headers['X-Dev-Name'] = this.devAuth.displayName;
    } else if (this.tokenGetter) {
      // Real auth token
      const token = await this.tokenGetter();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      let problem: ProblemDetail;
      
      try {
        problem = await response.json();
      } catch {
        // If response isn't valid JSON, create a generic error
        problem = {
          type: 'about:blank',
          title: `HTTP ${response.status}`,
          status: response.status,
          detail: response.statusText,
          code: 'HTTP_ERROR',
        };
      }

      throw new ApiError(problem);
    }

    return response.json();
  }

  async get<T>(path: string): Promise<T> {
    try {
      const headers = await this.getHeaders();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return this.handleResponse<T>(response);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      // Handle abort (timeout)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiError({
          type: 'about:blank',
          title: 'Request Timeout',
          status: 0,
          detail: 'The request took too long to complete. The server may be slow or overloaded.',
          code: 'TIMEOUT',
        });
      }
      // Network error or fetch failed
      throw new ApiError({
        type: 'about:blank',
        title: 'Network Error',
        status: 0,
        detail: `Cannot reach API at ${this.baseUrl}. Check that the backend is running and CORS is configured correctly.`,
        code: 'NETWORK_ERROR',
      });
    }
  }

  async post<T>(path: string, data?: unknown): Promise<T> {
    try {
      const headers = await this.getHeaders();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout for POST (seed can take time)
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return this.handleResponse<T>(response);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError({
        type: 'about:blank',
        title: 'Network Error',
        status: 0,
        detail: `Cannot reach API at ${this.baseUrl}. Check that the backend is running and CORS is configured correctly.`,
        code: 'NETWORK_ERROR',
      });
    }
  }

  async put<T>(path: string, data: unknown): Promise<T> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(data),
      });
      return this.handleResponse<T>(response);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError({
        type: 'about:blank',
        title: 'Network Error',
        status: 0,
        detail: `Cannot reach API at ${this.baseUrl}. Check that the backend is running and CORS is configured correctly.`,
        code: 'NETWORK_ERROR',
      });
    }
  }

  async patch<T>(path: string, data: unknown): Promise<T> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(data),
      });
      return this.handleResponse<T>(response);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError({
        type: 'about:blank',
        title: 'Network Error',
        status: 0,
        detail: `Cannot reach API at ${this.baseUrl}. Check that the backend is running and CORS is configured correctly.`,
        code: 'NETWORK_ERROR',
      });
    }
  }

  async delete<T>(path: string): Promise<T> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'DELETE',
        headers,
      });
      return this.handleResponse<T>(response);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError({
        type: 'about:blank',
        title: 'Network Error',
        status: 0,
        detail: `Cannot reach API at ${this.baseUrl}. Check that the backend is running and CORS is configured correctly.`,
        code: 'NETWORK_ERROR',
      });
    }
  }

  // Typed API methods
  async getMe(): Promise<MeResponse> {
    return this.get<MeResponse>('/me');
  }

  async getHealth(): Promise<HealthResponse> {
    return this.get<HealthResponse>('/healthz');
  }

  async seedDatabase(): Promise<{ message: string }> {
    return this.post<{ message: string }>('/dev/seed');
  }

  async getResourcesWithUsers(): Promise<Array<{
    resource_id: string;
    display_name: string;
    employee_id: string;
    email: string | null;
    user_object_id: string;
    user_id: string;
  }>> {
    return this.get('/dev/resources-with-users');
  }
}

export const apiClient = new ApiClient();
