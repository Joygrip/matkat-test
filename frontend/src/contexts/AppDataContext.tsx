import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { lookupsApi } from '../api/lookups';
import { useAuth } from '../auth/AuthProvider';
import type { CostCenter, Project } from '../api/admin';

interface AppDataContextValue {
  costCenters: CostCenter[];
  projects: Project[];
  appDataLoading: boolean;
  refreshAppData: () => void;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [appDataLoading, setAppDataLoading] = useState(true);

  const load = () => {
    if (!user) return;
    const role = user.role;
    const projectsFetch =
      role === 'PM' || role === 'Finance' || role === 'Admin'
        ? lookupsApi.listProjectsScoped()
        : lookupsApi.listProjects();

    setAppDataLoading(true);
    Promise.all([lookupsApi.listCostCenters(), projectsFetch])
      .then(([ccs, projs]) => {
        setCostCenters(ccs);
        setProjects(projs);
      })
      .catch((err) => console.error('[AppDataContext] Failed to load shared data:', err))
      .finally(() => setAppDataLoading(false));
  };

  useEffect(() => {
    if (user?.role) load();
  }, [user?.role]);

  return (
    <AppDataContext.Provider value={{ costCenters, projects, appDataLoading, refreshAppData: load }}>
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
