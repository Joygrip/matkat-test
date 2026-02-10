/**
 * Main App component with routing.
 */
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spinner, makeStyles } from '@fluentui/react-components';
import { useAuth } from './auth/AuthProvider';
import { ToastProvider } from './hooks/useToast';
import { AppShell } from './components/AppShell';
import { DevLoginPanel } from './components/DevLoginPanel';
import { Dashboard } from './pages/Dashboard';
import { Demand } from './pages/Demand';
import { Supply } from './pages/Supply';
import { Actuals } from './pages/Actuals';
import { Approvals } from './pages/Approvals';
import { Consolidation } from './pages/Consolidation';
import { Admin } from './pages/Admin';
import { FinanceDashboard } from './pages/FinanceDashboard';
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
  const { isAuthenticated, isLoading } = useAuth();

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

  // Show login prompt for real auth (not implemented yet)
  if (!isAuthenticated) {
    return (
      <div className={styles.loading}>
        <p>Please configure Azure AD authentication or enable DEV_AUTH_BYPASS.</p>
      </div>
    );
  }

  return (
    <ToastProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/demand" element={<Demand />} />
          <Route path="/supply" element={<Supply />} />
          <Route path="/actuals" element={<Actuals />} />
          <Route path="/finance-dashboard" element={<FinanceDashboard />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/consolidation" element={<Consolidation />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </ToastProvider>
  );
}

export default App;
