/**
 * Finance Page — Shell
 *
 * Orchestrates shared state and data loading for all Finance tabs.
 * Tabs: Overview (merged dashboard + cost centers), Actuals, Snapshots, Cost Report.
 * Accessible to: Admin, Finance, Director
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Title3,
  Body1,
  Body2,
  Button,
  Spinner,
  makeStyles,
  Select,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  MessageBar,
  MessageBarBody,
  Input,
  Textarea,
  Tab,
  TabList,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowDownload24Regular,
  CalendarLtr24Regular,
  ChartMultiple24Regular,
  Dismiss24Regular,
} from '@fluentui/react-icons';
import {
  consolidationApi,
  ConsolidationDashboard,
  Snapshot,
} from '../api/consolidation';
import { usePeriod } from '../contexts/PeriodContext';
import { apiClient } from '../api/client';
import { lookupsApi } from '../api/lookups';
import { PeriodPanel } from '../components/PeriodPanel';
import { PeriodSelector } from '../components/PeriodSelector';
import { useToast } from '../hooks/useToast';
import { useAuth, useHasRole } from '../auth/AuthProvider';

// Tab components
import { OverviewTab } from '../components/finance/OverviewTab';
import { ActualsTab, FinanceActualRow } from '../components/finance/ActualsTab';
import { SnapshotsTab } from '../components/finance/SnapshotsTab';
import { CostReportTab } from '../components/finance/CostReportTab';
import { ConsolidatedCostChart } from '../components/finance/ConsolidatedCostChart';
import { ProjectCostsMatrix } from '../components/project-costs/ProjectCostsMatrix';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LookupProject { id: string; name: string; }

const approvalStatusOptions = [
  { value: '', label: 'All Statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'N/A', label: 'N/A (Unsigned)' },
];

type ActiveTab = 'overview' | 'actuals' | 'snapshots' | 'costreport' | 'costoverview' | 'projectcosts';

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  container: {
    padding: tokens.spacingHorizontalXXL,
    maxWidth: '1600px',
    margin: '0 auto',
    minHeight: 'calc(100vh - 80px)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.spacingVerticalL,
    paddingBottom: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
  },
  headerActions: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    alignItems: 'center',
  },
  toolbar: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
    backgroundColor: tokens.colorNeutralBackground1,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    marginBottom: tokens.spacingVerticalL,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: tokens.spacingVerticalS,
  },
  toolbarRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    flexWrap: 'wrap' as const,
  },
  toolbarFilters: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: tokens.spacingHorizontalL,
    flexWrap: 'wrap' as const,
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: tokens.spacingVerticalXXS,
    minWidth: '140px',
  },
  filterLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  toolbarMeta: {
    marginLeft: 'auto',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  formField: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalM,
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    padding: tokens.spacingVerticalXXL,
  },
});

// ─── Main component ──────────────────────────────────────────────────────────

export const Finance: React.FC = () => {
  const styles = useStyles();
  const { showSuccess, showError, showApiError } = useToast();
  const { user } = useAuth();
  const isManagerReader = user?.role === 'Manager' && user?.secondary_role === 'Reader';
  const canSeeStats = useHasRole('Finance', 'Manager', 'Admin');
  const canSeeCostReport = useHasRole('Finance', 'Admin');
  const canSeeSnapshots = useHasRole('Finance', 'Admin');
  const canSeeProjectCosts = useHasRole('Finance', 'Admin', 'PM');
  const canManagePeriods = user?.role === 'Finance' || user?.role === 'Admin';
  const canPublishSnapshot = user?.role === 'Finance' || user?.role === 'Admin';
  const canDownloadCsv = user?.role === 'Finance' || user?.role === 'Admin';
  const isPM = user?.role === 'PM';

  // ── Period ──
  const {
    periods,
    selectedPeriodId,
    setSelectedPeriodId,
    selectedPeriod: currentPeriod,
    loading: periodsLoading,
  } = usePeriod();

  // ── Tab ──
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');

  // ── Dashboard (shared: OverviewTab + Publish dialog) ──
  const [dashboard, setDashboard] = useState<ConsolidationDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  // ── Actuals (shared: ActualsTab + CostReportTab) ──
  const [actualsData, setActualsData] = useState<FinanceActualRow[]>([]);
  const [actualsLoading, setActualsLoading] = useState(false);
  const [actualsError, setActualsError] = useState<string | null>(null);
  const [actualsProjectId, setActualsProjectId] = useState<string>('');
  const [actualsApprovalStatus, setActualsApprovalStatus] = useState<string>('');

  // ── Overview filters ──
  const [overviewProjectId, setOverviewProjectId] = useState<string>('');

  // ── Snapshots ──
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  // ── Lookups ──
  const [projects, setProjects] = useState<LookupProject[]>([]);

  // ── Publish dialog ──
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  const [publishName, setPublishName] = useState('');
  const [publishDescription, setPublishDescription] = useState('');

  // ── Period modal ──
  const [isPeriodModalOpen, setIsPeriodModalOpen] = useState(false);

  // ── Period/month for charts (passed to ActualsTab) ──
  const periodFromActuals = actualsData.length > 0
    ? { year: actualsData[0].year, month: actualsData[0].month }
    : null;
  const firstOpenPeriod = periods.find(p => p.status === 'open');
  const chartPeriod = currentPeriod ?? firstOpenPeriod ?? periods[0];
  const year = periodFromActuals?.year ?? chartPeriod?.year ?? 0;
  const month = periodFromActuals?.month ?? chartPeriod?.month ?? 0;

  const latestSnapshot = useMemo(() =>
    snapshots.length > 0
      ? [...snapshots].sort((a, b) =>
          new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
        )[0]
      : null,
    [snapshots]
  );

  // ── Initial loads ──
  useEffect(() => {
    const fetch = isPM ? lookupsApi.listProjectsScoped() : lookupsApi.listProjects();
    fetch.then(setProjects);
  }, [isPM]);

  // ── Reload when period changes ──
  useEffect(() => {
    if (selectedPeriodId) {
      loadDashboard(selectedPeriodId);
      if (canSeeSnapshots) loadSnapshots(selectedPeriodId);
      if (!isPM) loadActuals(selectedPeriodId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodId]);

  // ── Reload actuals when filters change ──
  useEffect(() => {
    if (selectedPeriodId && !isPM) loadActuals(selectedPeriodId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualsProjectId, actualsApprovalStatus]);

  // ── Data loaders ──

  const loadDashboard = async (periodId?: string) => {
    const pid = periodId || selectedPeriodId;
    if (!pid) return;
    setDashboardLoading(true);
    try {
      const data = await consolidationApi.getDashboard(pid);
      setDashboard(data);
    } catch (err) {
      showApiError(err as Error, 'Failed to load dashboard');
    } finally {
      setDashboardLoading(false);
    }
  };

  const loadSnapshots = async (periodId?: string) => {
    const pid = periodId || selectedPeriodId;
    try {
      const data = await consolidationApi.getSnapshots(pid);
      setSnapshots(data);
    } catch (err) {
      showApiError(err as Error, 'Failed to load snapshots');
    }
  };

  const loadActuals = async (periodId?: string) => {
    const pid = periodId || selectedPeriodId;
    if (!currentPeriod || !pid) return;
    setActualsLoading(true);
    setActualsError(null);
    try {
      const params = new URLSearchParams();
      params.append('year', String(currentPeriod.year));
      params.append('month', String(currentPeriod.month));
      if (actualsProjectId) params.append('project_id', actualsProjectId);
      if (actualsApprovalStatus) params.append('approval_status', actualsApprovalStatus.toLowerCase());
      const result = await apiClient.get<FinanceActualRow[]>(
        `/finance/actuals-dashboard?${params.toString()}`
      );
      setActualsData(result);
    } catch {
      setActualsError('Failed to load actuals data');
    } finally {
      setActualsLoading(false);
    }
  };

  const handlePublish = async () => {
    if (!publishName.trim()) { showError('Name is required'); return; }
    try {
      await consolidationApi.publishSnapshot(selectedPeriodId, publishName, publishDescription || undefined);
      showSuccess('Snapshot published successfully');
      setIsPublishDialogOpen(false);
      setPublishName('');
      setPublishDescription('');
      loadSnapshots();
    } catch (err) {
      showApiError(err as Error, 'Failed to publish snapshot');
    }
  };

  // ── Loading state ──
  if (periodsLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="large" label="Loading..." />
      </div>
    );
  }

  return (
    <div className={styles.container}>

      {/* ── Action bar ── */}
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <ChartMultiple24Regular style={{ fontSize: 24, color: tokens.colorBrandForeground1 }} />
          <Title3>Finance</Title3>
        </div>
        <div className={styles.headerActions}>
          {canManagePeriods && (
            <Button
              appearance="secondary"
              icon={<CalendarLtr24Regular />}
              onClick={() => setIsPeriodModalOpen(true)}
            >
              Manage Periods
            </Button>
          )}
          {canPublishSnapshot && (
            <Button
              appearance="primary"
              icon={<ArrowDownload24Regular />}
              onClick={() => setIsPublishDialogOpen(true)}
            >
              Publish Snapshot
            </Button>
          )}
        </div>
      </div>

      {/* ── Publish dialog ── */}
      {canPublishSnapshot && (
        <Dialog open={isPublishDialogOpen} onOpenChange={(_: unknown, data: { open: boolean }) => setIsPublishDialogOpen(data.open)}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Publish Snapshot</DialogTitle>
              <DialogContent>
                <MessageBar intent="info" style={{ marginBottom: tokens.spacingVerticalM }}>
                  <MessageBarBody>A snapshot is an immutable copy of planning data at this point in time.</MessageBarBody>
                </MessageBar>
                {currentPeriod && (
                  <div style={{ marginBottom: tokens.spacingVerticalM }}>
                    <Body2 style={{ fontWeight: tokens.fontWeightSemibold }}>Period</Body2>
                    <Body1>
                      {currentPeriod.year}-{String(currentPeriod.month).padStart(2, '0')}
                      {dashboard && ` · ${dashboard.summary.total_cost_centers} cost centers`}
                    </Body1>
                  </div>
                )}
                {dashboard && (dashboard.summary.orphans_count > 0 || dashboard.summary.over_allocations_count > 0) && (
                  <MessageBar intent="warning" style={{ marginBottom: tokens.spacingVerticalM }}>
                    <MessageBarBody>
                      {dashboard.summary.orphans_count > 0 && `${dashboard.summary.orphans_count} orphan demand(s). `}
                      {dashboard.summary.over_allocations_count > 0 && `${dashboard.summary.over_allocations_count} over-allocation(s). `}
                      Consider resolving before publishing.
                    </MessageBarBody>
                  </MessageBar>
                )}
                <div className={styles.formField}>
                  <label>Snapshot Name *</label>
                  <Input
                    value={publishName}
                    onChange={(_, data) => setPublishName(data.value)}
                    placeholder={`${currentPeriod?.year}-${String(currentPeriod?.month ?? 1).padStart(2, '0')} Final`}
                  />
                </div>
                <div className={styles.formField}>
                  <label>Description (optional)</label>
                  <Textarea
                    value={publishDescription}
                    onChange={(_, data) => setPublishDescription(data.value)}
                    placeholder="Optional description..."
                  />
                </div>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setIsPublishDialogOpen(false)}>Cancel</Button>
                <Button appearance="primary" onClick={handlePublish}>Publish</Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}

      {/* ── Period management modal ── */}
      {canManagePeriods && (
        <Dialog
          open={isPeriodModalOpen}
          onOpenChange={(_: unknown, data: { open: boolean }) => setIsPeriodModalOpen(data.open)}
        >
          <DialogSurface style={{ width: '860px', maxWidth: '92vw' }}>
            <DialogBody style={{ display: 'flex', flexDirection: 'column', maxHeight: '88vh' }}>
              <DialogTitle
                action={
                  <Button
                    appearance="subtle"
                    aria-label="Close"
                    icon={<Dismiss24Regular />}
                    onClick={() => setIsPeriodModalOpen(false)}
                  />
                }
              >
                Period Management
              </DialogTitle>
              <DialogContent style={{ overflowY: 'auto', flex: 1 }}>
                <PeriodPanel variant="embedded" />
              </DialogContent>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}

      {/* ── Sticky toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarRow}>
          <TabList
            selectedValue={activeTab}
            onTabSelect={(_, data) => setActiveTab(data.value as ActiveTab)}
          >
            <Tab value="overview">Overview</Tab>
            {isPM ? null : <Tab value="actuals">Actuals</Tab>}
            {canSeeSnapshots && <Tab value="snapshots">Snapshots</Tab>}
            {!isPM && canSeeCostReport && <Tab value="costreport">Cost Report</Tab>}
            <Tab value="costoverview">Cost Overview</Tab>
            {canSeeProjectCosts && <Tab value="projectcosts">OoP + Equipment</Tab>}
          </TabList>
          <span className={styles.toolbarMeta}>
            {latestSnapshot
              ? `Last snapshot: ${new Date(latestSnapshot.published_at).toLocaleDateString()}`
              : 'No snapshots yet'}
          </span>
        </div>

        <div className={styles.toolbarFilters}>
          {/* Period — always visible */}
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Period</span>
            <PeriodSelector
              periods={periods}
              selectedId={selectedPeriodId}
              onSelect={setSelectedPeriodId}
            />
          </div>

          {/* Overview-only filters */}
          {activeTab === 'overview' && (
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>Project</span>
              <Select
                value={overviewProjectId}
                onChange={(_, data) => setOverviewProjectId(data.value ?? '')}
                style={{ minWidth: 140 }}
              >
                <option value="">All projects</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </div>
          )}

          {/* Actuals-only filters */}
          {activeTab === 'actuals' && (
            <>
              <div className={styles.filterGroup}>
                <span className={styles.filterLabel}>Project</span>
                <Select
                  value={actualsProjectId}
                  onChange={(_, data) => setActualsProjectId(data.value ?? '')}
                  style={{ minWidth: 140 }}
                >
                  <option value="">All projects</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </div>
              <div className={styles.filterGroup}>
                <span className={styles.filterLabel}>Approval</span>
                <Select
                  value={actualsApprovalStatus}
                  onChange={(_, data) => setActualsApprovalStatus(data.value ?? '')}
                  style={{ minWidth: 130 }}
                >
                  {approvalStatusOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </Select>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Tab content ── */}

      {activeTab === 'overview' && (
        <>
          <MessageBar intent="info" style={{ marginBottom: 12 }}>
            <MessageBarBody>Cost figures reflect fully approved actuals only. Pending or rejected actuals are excluded.</MessageBarBody>
          </MessageBar>
          <OverviewTab dashboard={dashboard} loading={dashboardLoading} projectId={overviewProjectId} onDashboardChanged={() => selectedPeriodId && loadDashboard(selectedPeriodId)} />
        </>
      )}
      {!isPM && activeTab === 'actuals' && (
        <ActualsTab
          actualsData={actualsData}
          actualsLoading={actualsLoading}
          actualsError={actualsError}
          projects={projects}
          actualsProjectId={actualsProjectId}
          actualsApprovalStatus={actualsApprovalStatus}
          year={year}
          month={month}
          canSeeStats={canSeeStats}
          onActualsReload={() => loadActuals(selectedPeriodId)}
        />
      )}
      {canSeeSnapshots && activeTab === 'snapshots' && (
        <SnapshotsTab
          snapshots={snapshots}
          canDownloadCsv={canDownloadCsv}
          showApiError={showApiError}
        />
      )}
      {!isPM && activeTab === 'costreport' && canSeeCostReport && (
        <CostReportTab
          actualsData={actualsData}
          actualsLoading={actualsLoading}
          selectedPeriodId={selectedPeriodId}
          onLoadActuals={() => loadActuals(selectedPeriodId)}
          showSuccess={showSuccess}
          showError={showError}
          showApiError={showApiError}
        />
      )}
      {activeTab === 'projectcosts' && canSeeProjectCosts && (
        <ProjectCostsMatrix />
      )}
      {activeTab === 'costoverview' && (canSeeStats || isPM) && (
        <>
          <MessageBar intent="info" style={{ marginBottom: 12 }}>
            <MessageBarBody>Cost figures reflect fully approved actuals only. Pending or rejected actuals are excluded.</MessageBarBody>
          </MessageBar>
          <ConsolidatedCostChart />
        </>
      )}
    </div>
  );
};

export default Finance;
