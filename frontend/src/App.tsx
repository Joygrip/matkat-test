/**
 * Main App component with routing.
 */
import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spinner, makeStyles } from '@fluentui/react-components';
import { useAuth } from './auth/AuthProvider';
import { ToastProvider } from './hooks/useToast';
import { PeriodProvider } from './contexts/PeriodContext';
import { AppDataProvider } from './contexts/AppDataContext';
import { AppShell } from './components/AppShell';
import { DevLoginPanel } from './components/DevLoginPanel';
import { config } from './config';

// Route-level lazy loading — each page is a separate JS chunk loaded on demand.
// Pages with a default export use the direct form; named-export-only pages use .then().
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const ResourcePlanning = lazy(() => import('./pages/ResourcePlanning'));
const Actuals = lazy(() => import('./pages/Actuals'));
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })));
const Finance = lazy(() => import('./pages/Finance'));
const AuditLogs = lazy(() => import('./pages/AuditLogs'));
const ProjectCosts = lazy(() => import('./pages/ProjectCosts').then((m) => ({ default: m.ProjectCosts })));
const FteInput = lazy(() => import('./pages/FteInput').then((m) => ({ default: m.FteInput })));

// Employees manage actuals via the Dashboard; redirect them if they navigate here directly
function ActualsRoute() {
  const { user } = useAuth();
  if (user?.role === 'Employee') return <Navigate to="/" replace />;
  return <Actuals />;
}

// FTE Input is only for PM and Manager; all other roles redirect to dashboard
function FteInputRoute() {
  const { user } = useAuth();
  if (!user || (user.role !== 'PM' && user.role !== 'Manager')) return <Navigate to="/" replace />;
  return <FteInput />;
}

// Resource Planning is for Admin, Finance, PM, and Manager only. This deliberately
// mirrors the nav visibility rule in AppShell so a hidden menu item can never be
// reached via direct URL. Manager+PM and Manager+Reader have primary role 'Manager'
// and so pass; Employees and primary Readers are redirected to their dashboard.
const RESOURCE_PLANNING_ROLES = ['Admin', 'Finance', 'PM', 'Manager'];
function ResourcePlanningRoute() {
  const { user } = useAuth();
  if (!user || !RESOURCE_PLANNING_ROLES.includes(user.role)) return <Navigate to="/" replace />;
  return <ResourcePlanning />;
}

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
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #e8eef5 0%, #dce4f0 40%, #cdd8e8 100%)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}>
        <div style={{
          background: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)',
          maxWidth: '480px',
          width: '90%',
          overflow: 'hidden',
        }}>
          {/* Top section */}
          <div style={{
            padding: '48px 48px 40px 48px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}>
            <img
              src="/MatKatLog.png"
              alt="MatKat"
              style={{ maxWidth: '280px', marginBottom: '32px' }}
            />
            <p style={{
              color: '#5a6577',
              fontSize: '15px',
              textAlign: 'center',
              marginBottom: '28px',
              margin: '0 0 28px 0',
            }}>
              Sign in with your Microsoft account to continue.
            </p>
            <button
              onClick={() => login()}
              style={{
                background: '#1a3a5c',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '12px 32px',
                fontSize: '15px',
                fontWeight: 500,
                cursor: 'pointer',
                minWidth: '240px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#243f5f'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#1a3a5c'; }}
            >
              <svg width="18" height="18" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
              </svg>
              Sign in with Microsoft
            </button>
          </div>

          {/* Bottom section */}
          <div style={{
            background: '#2c4a6e',
            padding: '24px 48px',
            textAlign: 'center',
          }}>
            <div style={{ color: '#ffffff', fontSize: '22px', fontWeight: 700 }}>Ferrosan</div>
            <div style={{ color: '#ffffff', fontSize: '16px', fontWeight: 400, opacity: 0.9 }}>Medical Devices</div>
            <div style={{
              borderTop: '1px solid rgba(255,255,255,0.2)',
              margin: '12px auto',
              width: '60px',
            }} />
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>
              © 2026 Ferrosan Medical Devices
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <PeriodProvider>
      <AppDataProvider>
      <AppShell>
        <Suspense fallback={<Spinner size="large" label="Loading..." />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/resource-planning" element={<ResourcePlanningRoute />} />
            <Route path="/demand" element={<Navigate to="/resource-planning" replace />} />
            <Route path="/supply" element={<Navigate to="/resource-planning" replace />} />
            <Route path="/actuals" element={<ActualsRoute />} />
            <Route path="/fte-input" element={<FteInputRoute />} />
            <Route path="/finance" element={<Finance />} />
            {/* Redirects for old routes */}
            <Route path="/finance-dashboard" element={<Navigate to="/finance" replace />} />
            <Route path="/consolidation" element={<Navigate to="/finance" replace />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/project-costs" element={<ProjectCosts />} />
            <Route path="/audit-logs" element={<AuditLogs />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AppShell>
      </AppDataProvider>
      </PeriodProvider>
    </ToastProvider>
  );
}

export default App;
