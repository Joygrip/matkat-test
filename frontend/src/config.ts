/**
 * Application configuration from environment variables.
 */
export const config = {
  // Auth
  authClientId: import.meta.env.VITE_AUTH_CLIENT_ID || '',
  authAuthority: import.meta.env.VITE_AUTH_AUTHORITY || 'https://login.microsoftonline.com/common',
  apiScope: import.meta.env.VITE_API_SCOPE || '',
  
  // API
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
  
  // Dev mode
  devAuthBypass: import.meta.env.VITE_DEV_AUTH_BYPASS === 'true',
  
  // Helpers
  get isDevMode(): boolean {
    return this.devAuthBypass || import.meta.env.DEV;
  },
  
  get msalScopes(): string[] {
    return this.apiScope ? [this.apiScope] : [];
  },
};
