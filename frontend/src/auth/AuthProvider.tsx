/**
 * Authentication provider supporting both MSAL and dev bypass mode.
 */
import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider, useMsal, useIsAuthenticated } from '@azure/msal-react';
import { msalConfig, loginRequest } from './msalConfig';
import { config } from '../config';
import { MeResponse, DevAuthState, UserRole } from '../types';
import { apiClient } from '../api/client';

// Initialize MSAL instance
const msalInstance = new PublicClientApplication(msalConfig);

// Auth context type
interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: MeResponse | null;
  devAuth: DevAuthState | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  setDevAuth: (auth: DevAuthState) => void;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Default dev auth state
const defaultDevAuth: DevAuthState = {
  role: 'Admin',
  tenantId: 'dev-tenant-001',
  userId: 'dev-user-001',
  email: 'dev@example.com',
  displayName: 'Dev User',
};

// Inner auth provider that uses MSAL hooks
function AuthProviderInner({ children }: { children: ReactNode }) {
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [user, setUser] = useState<MeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [devAuth, setDevAuthState] = useState<DevAuthState | null>(
    config.devAuthBypass ? defaultDevAuth : null
  );

  // Get access token
  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (config.devAuthBypass) {
      return null; // Dev mode uses headers instead
    }

    if (accounts.length === 0) return null;

    try {
      const response = await instance.acquireTokenSilent({
        ...loginRequest,
        account: accounts[0],
      });
      return response.accessToken;
    } catch {
      // Token refresh failed, need interactive login
      return null;
    }
  }, [instance, accounts]);

  // Fetch user info
  const fetchUserInfo = useCallback(async () => {
    try {
      const me = await apiClient.getMe();
      setUser(me);
    } catch (error) {
      console.error('Failed to fetch user info:', error);
      setUser(null);
    }
  }, []);

  // Initialize auth state
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);

      if (config.devAuthBypass && devAuth) {
        // Dev mode - fetch user with dev headers
        apiClient.setDevAuth(devAuth);
        await fetchUserInfo();
      } else if (isAuthenticated) {
        // Real auth - fetch user with token
        await fetchUserInfo();
      }

      setIsLoading(false);
    };

    init();
  }, [isAuthenticated, devAuth, fetchUserInfo]);

  // Login
  const login = async () => {
    if (config.devAuthBypass) {
      // In dev mode, login just sets dev auth
      return;
    }

    try {
      await instance.loginPopup(loginRequest);
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  // Logout
  const logout = async () => {
    if (config.devAuthBypass) {
      setDevAuthState(null);
      setUser(null);
      return;
    }

    try {
      await instance.logoutPopup();
      setUser(null);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  // Set dev auth
  const setDevAuth = (auth: DevAuthState) => {
    setDevAuthState(auth);
    apiClient.setDevAuth(auth);
  };

  const effectiveIsAuthenticated = config.devAuthBypass ? !!devAuth : isAuthenticated;

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: effectiveIsAuthenticated,
        isLoading,
        user,
        devAuth,
        login,
        logout,
        setDevAuth,
        getAccessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// Main auth provider with MSAL
export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <MsalProvider instance={msalInstance}>
      <AuthProviderInner>{children}</AuthProviderInner>
    </MsalProvider>
  );
}

// Hook to use auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

// Hook to check role
export function useHasRole(...roles: UserRole[]) {
  const { user } = useAuth();
  return user ? roles.includes(user.role) : false;
}
