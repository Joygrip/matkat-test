/**
 * Main App component with routing.
 */
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spinner, makeStyles } from '@fluentui/react-components';
import { useAuth } from './auth/AuthProvider';
import { ToastProvider } from './hooks/useToast';
import { PeriodProvider } from './contexts/PeriodContext';
import { AppShell } from './components/AppShell';
import { DevLoginPanel } from './components/DevLoginPanel';
import { Dashboard } from './pages/Dashboard';
import { ResourcePlanning } from './pages/ResourcePlanning';
import { Actuals } from './pages/Actuals';
import { Admin } from './pages/Admin';
import { Finance } from './pages/Finance';
import { AuditLogs } from './pages/AuditLogs';
import { ProjectCosts } from './pages/ProjectCosts';
import { config } from './config';

const useStyles = makeStyles({
  loading: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
  },
});

function App() {
  const styles = useStyles();
  const { isAuthenticated, isLoading, login } = useAuth();

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="large" label="Loading..." />
      </div>
    );
  }

  // Show dev login panel if not authenticated and in dev bypass mode
  if (!isAuthenticated && config.devAuthBypass) {
    return <DevLoginPanel />;
  }

  // Show real login screen for non-dev, non-authenticated users
  if (!isAuthenticated) {
    return (
      <div className={styles.loading}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ marginBottom: '1rem', color: 'var(--colorNeutralForeground2)' }}>
            Sign in with your Microsoft account to continue.
          </p>
          <button
            onClick={() => login()}
            style={{
              padding: '0.6rem 1.4rem',
              fontSize: '0.95rem',
              cursor: 'pointer',
              borderRadius: '4px',
              border: 'none',
              background: 'var(--colorBrandBackground)',
              color: 'var(--colorNeutralForegroundOnBrand)',
            }}
          >
            Sign in with Microsoft
          </button>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <PeriodProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/resource-planning" element={<ResourcePlanning />} />
          <Route path="/demand" element={<Navigate to="/resource-planning" replace />} />
          <Route path="/supply" element={<Navigate to="/resource-planning" replace />} />
          <Route path="/actuals" element={<Actuals />} />
          <Route path="/finance" element={<Finance />} />
          {/* Redirects for old routes */}
          <Route path="/finance-dashboard" element={<Navigate to="/finance" replace />} />
          <Route path="/consolidation" element={<Navigate to="/finance" replace />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/project-costs" element={<ProjectCosts />} />
          <Route path="/audit-logs" element={<AuditLogs />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
      </PeriodProvider>
    </ToastProvider>
  );
}

export default App;
