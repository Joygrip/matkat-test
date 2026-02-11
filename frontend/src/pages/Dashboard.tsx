/**
 * Role-based Dashboard
 * Non-admin: Action-focused cards
 * Admin: Action cards + System panels
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  makeStyles,
  tokens,
  Title3,
  Body1,
  Badge,
  Button,
  Card,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
  Select,
  Skeleton,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';
import {
  ClipboardTaskRegular,
  CheckmarkCircleRegular,
  CalendarRegular,
  ChartMultipleRegular,
  BuildingRegular,
  ShieldCheckmarkRegular,
  ArrowSyncRegular,
  SettingsRegular,
} from '@fluentui/react-icons';
import { useAuth } from '../auth/AuthProvider';
import { apiClient } from '../api/client';
import { useToast } from '../hooks/useToast';
import { HealthResponse } from '../types';
import { config } from '../config';
import { ActionCard } from '../components/ActionCard';
import { LoadingState } from '../components/LoadingState';
import { approvalsApi } from '../api/approvals';
import { periodsApi, Period } from '../api/periods';
import { actualsApi } from '../api/actuals';
import { planningApi } from '../api/planning';
import { SupplyDemandChart } from '../components/SupplyDemandChart';
import { lookupsApi, Project, Resource } from '../api/lookups';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXL,
    maxWidth: '1400px',
    margin: '0 auto',
  },
  welcome: {
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    color: 'white',
    padding: tokens.spacingHorizontalXL,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow8,
  },
  welcomeTitle: {
    color: 'white',
    marginBottom: tokens.spacingVerticalS,
  },
  welcomeSubtitle: {
    color: 'rgba(255, 255, 255, 0.8)',
  },
  actionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: tokens.spacingVerticalL,
  },
  adminSection: {
    marginTop: tokens.spacingVerticalXL,
  },
  adminCard: {
    padding: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalL,
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalS} 0`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    '&:last-child': {
      borderBottom: 'none',
    },
  },
  label: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  value: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  permissionList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalS,
  },
  devBanner: {
    marginTop: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalM,
    background: 'rgba(255, 185, 0, 0.1)',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid rgba(255, 185, 0, 0.3)`,
  },
});

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function Dashboard() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showSuccess, showApiError } = useToast();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [unsignedActuals, setUnsignedActuals] = useState(0);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [demandLines, setDemandLines] = useState<any[]>([]);
  const [supplyLines, setSupplyLines] = useState<any[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [selectedPeriodForChart, setSelectedPeriodForChart] = useState<string>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [selectedResource, setSelectedResource] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.role === 'Admin';
  const isEmployee = user?.role === 'Employee';
  const isRO = user?.role === 'RO';
  const isDirector = user?.role === 'Director';
  const isFinance = user?.role === 'Finance';
  const isPM = user?.role === 'PM';

  useEffect(() => {
    loadDashboardData();
    // Load projects and resources for filters
    lookupsApi.listProjects().then(setProjects);
    lookupsApi.listResources().then(setResources);
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [healthData, periodsData] = await Promise.all([
        apiClient.getHealth().catch(() => null),
        periodsApi.list().catch(() => []),
      ]);

      setHealth(healthData);
      setPeriods(periodsData);

      // Load role-specific data
      if (isRO || isDirector) {
        try {
          const approvals = await approvalsApi.getInbox();
          setPendingApprovals(approvals.length);
        } catch (error) {
          console.error('Failed to load approvals:', error);
        }
      }

      if (isEmployee) {
        try {
          const now = new Date();
          const actuals = await actualsApi.getMyActuals(now.getFullYear(), now.getMonth() + 1);
          const unsigned = actuals.filter((a) => !a.employee_signed_at).length;
          setUnsignedActuals(unsigned);
        } catch (error) {
          console.error('Failed to load actuals:', error);
        }
      }

      // Load supply/demand data for chart (PM, RO, Director, Finance)
      if (isPM || isRO || isDirector || isFinance) {
        const openPeriod = periodsData.find((p: Period) => p.status === 'open') || periodsData[0];
        if (openPeriod) {
          setSelectedPeriodForChart(openPeriod.id);
          loadChartData(openPeriod.id);
        }
      }
    } catch (error) {
      setError('Failed to load dashboard data.');
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const result = await apiClient.seedDatabase();
      showSuccess('Database Seeded', result.message);
    } catch (error) {
      showApiError(error as Error, 'Failed to seed database');
    } finally {
      setSeeding(false);
    }
  };

  const loadChartData = async (periodId: string, projectId?: string, resourceId?: string) => {
    if (!periodId) return;
    try {
      setChartLoading(true);
      let demandUrl = `/demand-lines?period_id=${periodId}`;
      let supplyUrl = `/supply-lines?period_id=${periodId}`;
      if (projectId) demandUrl += `&project_id=${projectId}`;
      if (resourceId) {
        demandUrl += `&resource_id=${resourceId}`;
        supplyUrl += `&resource_id=${resourceId}`;
      }
      const [demands, supplies] = await Promise.all([
        apiClient.get(demandUrl).catch((err) => { console.error('[Dashboard] Failed to load demand lines:', err); return []; }),
        apiClient.get(supplyUrl).catch((err) => { console.error('[Dashboard] Failed to load supply lines:', err); return []; }),
      ]);
      setDemandLines(demands || []);
      setSupplyLines(supplies || []);
    } catch (error) {
      console.error('[Dashboard] Failed to load chart data:', error);
    } finally {
      setChartLoading(false);
    }
  };

  const handlePeriodChange = (periodId: string) => {
    setSelectedPeriodForChart(periodId);
    loadChartData(periodId);
  };

  const handleFilterChange = (projectId: string, resourceId: string) => {
    setSelectedProject(projectId);
    setSelectedResource(resourceId);
    loadChartData(selectedPeriodForChart, projectId, resourceId);
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <Skeleton style={{ height: 120, marginBottom: 32 }} />
        <div className={styles.actionsGrid}>
          {[1,2,3,4].map(i => (
            <Skeleton key={i} style={{ height: 180, borderRadius: 12 }} />
          ))}
        </div>
      </div>
    );
  }

  const currentPeriod = periods.find((p) => p.status === 'open') || periods[0];
  const currentPeriodLabel = currentPeriod
    ? `${monthNames[currentPeriod.month - 1]} ${currentPeriod.year}`
    : 'No period available';

  return (
    <div className={styles.container}>
      {/* Prominent Dev/Test Banner for all roles */}
      {config.devAuthBypass && (
        <MessageBar intent="warning" style={{ marginBottom: tokens.spacingVerticalL }}>
          <MessageBarBody>
            <strong>Development Mode:</strong> This environment is for development/testing only.
          </MessageBarBody>
        </MessageBar>
      )}
      {/* Error Bar */}
      {error && (
        <MessageBar intent="error" style={{ marginBottom: tokens.spacingVerticalL }}>
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {/* Welcome Banner */}
      <div className={styles.welcome}>
        <Title3 className={styles.welcomeTitle}>
          Welcome back, {user?.display_name}!
        </Title3>
        <Body1 className={styles.welcomeSubtitle}>
          You are logged in as <strong>{user?.role}</strong> for tenant{' '}
          <strong>{user?.tenant_id}</strong>
        </Body1>
      </div>

      {/* Supply/Demand Chart for PM, RO, Director, Finance */}
      {(isPM || isRO || isDirector || isFinance) && periods.length > 0 && (
        <div style={{ marginBottom: tokens.spacingVerticalXL }}>
          {/* Filter Controls */}
          <div style={{ display: 'flex', gap: tokens.spacingHorizontalL, marginBottom: tokens.spacingVerticalM, flexWrap: 'wrap', alignItems: 'end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS }}>
              <Body1 style={{ fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>Period</Body1>
              <Select
                value={selectedPeriodForChart || ''}
                onChange={(_, data) => handlePeriodChange(data.value)}
                style={{ minWidth: '200px' }}
              >
                {periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {monthNames[period.month - 1]} {period.year}
                  </option>
                ))}
              </Select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS }}>
              <Body1 style={{ fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>Project</Body1>
              <Select
                value={selectedProject}
                onChange={(_, data) => handleFilterChange(data.value, selectedResource)}
                style={{ minWidth: '180px' }}
              >
                <option value="">All Projects</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS }}>
              <Body1 style={{ fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>Resource</Body1>
              <Select
                value={selectedResource}
                onChange={(_, data) => handleFilterChange(selectedProject, data.value)}
                style={{ minWidth: '180px' }}
              >
                <option value="">All Resources</option>
                {resources.map((r) => <option key={r.id} value={r.id}>{r.display_name}</option>)}
              </Select>
            </div>
          </div>
          {selectedPeriodForChart && (
            <SupplyDemandChart
              demandLines={demandLines}
              supplyLines={supplyLines}
              loading={chartLoading}
              periodLabel={
                selectedPeriodForChart
                  ? (() => {
                      const period = periods.find((p) => p.id === selectedPeriodForChart);
                      return period ? `${monthNames[period.month - 1]} ${period.year}` : undefined;
                    })()
                  : undefined
              }
            />
          )}
        </div>
      )}

      {/* Action Cards: explicit role logic, improved spacing */}
      <div className={styles.actionsGrid} style={{ marginTop: tokens.spacingVerticalXL }}>
        {isEmployee && unsignedActuals > 0 && (
          <ActionCard
            icon={<ClipboardTaskRegular />}
            title="Sign Actuals"
            value={unsignedActuals}
            subtitle={`${unsignedActuals} unsigned actual line${unsignedActuals !== 1 ? 's' : ''}`}
            onClick={() => navigate('/actuals')}
          />
        )}

        {(isRO || isDirector) && pendingApprovals > 0 && (
          <ActionCard
            icon={<CheckmarkCircleRegular />}
            title="Pending Approvals"
            value={pendingApprovals}
            subtitle={`${pendingApprovals} approval${pendingApprovals !== 1 ? 's' : ''} awaiting your action`}
            onClick={() => navigate('/approvals')}
          />
        )}

        {isFinance && (
          <ActionCard
            icon={<ChartMultipleRegular />}
            title="Consolidation"
            subtitle="View and publish consolidation snapshots"
            onClick={() => navigate('/consolidation')}
          />
        )}

        {(isRO || isFinance) && (
          <ActionCard
            icon={<CalendarRegular />}
            title="Supply Planning"
            subtitle="Manage supply lines"
            onClick={() => navigate('/supply')}
          />
        )}

        {(isPM || isFinance) && (
          <ActionCard
            icon={<CalendarRegular />}
            title="Demand Planning"
            subtitle="View and manage demand lines"
            onClick={() => navigate('/demand')}
          />
        )}

        {isAdmin && (
          <ActionCard
            icon={<SettingsRegular />}
            title="Admin Panel"
            subtitle="Manage master data and settings"
            onClick={() => navigate('/admin')}
          />
        )}
      </div>

      {/* Admin-Only System Panels */}
      {isAdmin && (
        <div className={styles.adminSection}>
          <Card className={styles.adminCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, marginBottom: tokens.spacingVerticalM }}>
              <ShieldCheckmarkRegular style={{ fontSize: 24, color: tokens.colorBrandForeground1 }} />
              <Title3>System Status</Title3>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>API Status</span>
              <Badge appearance="filled" color={health?.status === 'healthy' ? 'success' : 'danger'}>
                {health?.status || 'Unknown'}
              </Badge>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>Version</span>
              <span className={styles.value}>{health?.version || 'N/A'}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>Environment</span>
              <Badge appearance="outline">{health?.environment || 'N/A'}</Badge>
            </div>
          </Card>

          <Card className={styles.adminCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, marginBottom: tokens.spacingVerticalM }}>
              <BuildingRegular style={{ fontSize: 24, color: tokens.colorBrandForeground1 }} />
              <Title3>Tenant Information</Title3>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>Tenant ID</span>
              <span className={styles.value} style={{ fontSize: tokens.fontSizeBase200 }}>
                {user?.tenant_id}
              </span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>User Email</span>
              <span className={styles.value}>{user?.email}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>Object ID</span>
              <span className={styles.value} style={{ fontSize: tokens.fontSizeBase200 }}>
                {user?.object_id}
              </span>
            </div>
          </Card>

          <Card className={styles.adminCard}>
            <Accordion collapsible>
              <AccordionItem value="permissions">
                <AccordionHeader>
                  <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM }}>
                    <ShieldCheckmarkRegular style={{ fontSize: 20 }} />
                    <Title3>Your Permissions</Title3>
                  </div>
                </AccordionHeader>
                <AccordionPanel>
                  <div className={styles.permissionList}>
                    {user?.permissions.map((perm) => (
                      <Badge key={perm} appearance="outline" size="small">
                        {perm}
                      </Badge>
                    ))}
                  </div>
                </AccordionPanel>
              </AccordionItem>
            </Accordion>
          </Card>
        </div>
      )}
    </div>
  );
}
