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
import { Demand } from './pages/Demand';
import { Supply } from './pages/Supply';
import { Actuals } from './pages/Actuals';
import { Approvals } from './pages/Approvals';
import { Admin } from './pages/Admin';
import { Finance } from './pages/Finance';
import { AuditLogs } from './pages/AuditLogs';
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
          <Route path="/demand" element={<Demand />} />
          <Route path="/supply" element={<Supply />} />
          <Route path="/actuals" element={<Actuals />} />
          <Route path="/finance" element={<Finance />} />
          <Route path="/approvals" element={<Approvals />} />
          {/* Redirects for old routes */}
          <Route path="/finance-dashboard" element={<Navigate to="/finance" replace />} />
          <Route path="/consolidation" element={<Navigate to="/finance" replace />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/audit-logs" element={<AuditLogs />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
      </PeriodProvider>
    </ToastProvider>
  );
}

export default App;
