/**
 * Unified Finance Page
 *
 * Merges the old Consolidation page and FinanceDashboard into one view.
 * Tabs: Dashboard (dept gaps), Actuals (employee actuals), Snapshots.
 * Accessible to: Admin, Finance, Director
 */
import React, { useState, useEffect } from 'react';
import {
  Title3,
  Body1,
  Body2,
  Card,
  CardHeader,
  Button,
  Spinner,
  Badge,
  tokens,
  makeStyles,
  Select,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  MessageBar,
  MessageBarBody,
  Input,
  Textarea,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Tab,
  TabList,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
} from '@fluentui/react-components';
import {
  ArrowDownload24Regular,
  DocumentBulletList24Regular,
  Warning24Regular,
  BuildingRegular,
  PeopleRegular,
  MoneyRegular,
} from '@fluentui/react-icons';
import {
  consolidationApi,
  ConsolidationDashboard,
  DashboardCostCenter,
  Snapshot,
} from '../api/consolidation';
import { usePeriod } from '../contexts/PeriodContext';
import { apiClient } from '../api/client';
import { lookupsApi } from '../api/lookups';
import { PeriodPanel } from '../components/PeriodPanel';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { useToast } from '../hooks/useToast';
import { useAuth, useHasRole } from '../auth/AuthProvider';
import { useCostCenterStats } from '../hooks/useCostCenterStats';
import { BreakdownChart } from '../components/BreakdownChart';
import type { CostCenterStats } from '../api/finance';

// ─── Example data for Actuals vs Plan chart (when API returns empty) ─────────

const EXAMPLE_COST_CENTER_STATS: CostCenterStats[] = [
  { cost_center_id: 'ex-cc-1', cost_center_name: 'Software Development', demand_fte: 320, supply_fte: 300, actuals_fte: 285 },
  { cost_center_id: 'ex-cc-2', cost_center_name: 'Quality Assurance', demand_fte: 175, supply_fte: 150, actuals_fte: 148 },
  { cost_center_id: 'ex-cc-3', cost_center_name: 'Infrastructure', demand_fte: 100, supply_fte: 100, actuals_fte: 95 },
  { cost_center_id: 'ex-cc-4', cost_center_name: 'DevOps', demand_fte: 80, supply_fte: 75, actuals_fte: 72 },
  { cost_center_id: 'ex-cc-5', cost_center_name: 'Marketing', demand_fte: 50, supply_fte: 50, actuals_fte: 48 },
  { cost_center_id: 'ex-cc-6', cost_center_name: 'Support', demand_fte: 75, supply_fte: 100, actuals_fte: 70 },
];

// ─── Actuals types ──────────────────────────────────────────────────────────

interface FinanceActualRow {
  actual_id: string;
  employee_name: string;
  employee_email: string;
  project_id: string;
  project_name: string;
  cost_center_id: string;
  cost_center_name: string;
  year: number;
  month: number;
  fte_percent: number;
  approval_status: string;
  current_approval_step?: string;
  current_approver_name?: string;
}

interface LookupProject { id: string; name: string; }

const approvalStatusOptions = [
  { value: '', label: 'All Statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'N/A', label: 'N/A (Unsigned)' },
];

// ─── Styles ─────────────────────────────────────────────────────────────────

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
    alignItems: 'flex-start',
    marginBottom: tokens.spacingVerticalXXL,
    paddingBottom: tokens.spacingVerticalL,
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
  },
  headerContent: { flex: 1 },
  pageTitle: {
    fontSize: tokens.fontSizeHero800,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
    marginBottom: tokens.spacingVerticalXS,
    lineHeight: '1.2',
  },
  pageSubtitle: {
    fontSize: tokens.fontSizeBase400,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
  },

  /* ── Consolidation dashboard ── */
  card: {
    marginBottom: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  sectionTitle: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    marginBottom: tokens.spacingVerticalM,
  },
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalXL,
  },
  kpiCard: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    textAlign: 'center' as const,
  },
  kpiLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: tokens.spacingVerticalXXS,
  },
  kpiValue: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
    lineHeight: '1.2',
  },
  summaryBar: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalXL,
  },
  summaryItem: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    textAlign: 'center' as const,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
  },
  summaryNumber: { fontSize: tokens.fontSizeHero700, fontWeight: tokens.fontWeightBold, lineHeight: '1.2' },
  summaryLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginTop: tokens.spacingVerticalXS,
  },
  deptCard: {
    marginBottom: tokens.spacingVerticalM,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  deptHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
  },
  deptName: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  deptStats: { display: 'flex', gap: tokens.spacingHorizontalXL, alignItems: 'center' },
  deptStat: { display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '72px' },
  ccSection: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  ccName: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
    marginBottom: tokens.spacingVerticalS,
    paddingLeft: tokens.spacingHorizontalS,
  },
  resourceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    '&:last-child': { borderBottom: 'none' },
  },
  placeholderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorPaletteYellowBackground1,
    '&:last-child': { borderBottom: 'none' },
  },

  /* ── Actuals tab ── */
  filtersCard: {
    marginBottom: tokens.spacingVerticalL,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  filtersRow: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap' as const,
    alignItems: 'flex-end',
  },
  filterField: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    minWidth: '120px',
  },
  filterLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  actualsSummaryRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalL,
  },
  actualsSummaryCard: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    textAlign: 'center' as const,
  },
  actualsSummaryValue: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
    lineHeight: '1.2',
  },
  actualsSummaryLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginTop: tokens.spacingVerticalXXS,
  },
  filtersCardLabel: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    marginBottom: tokens.spacingVerticalS,
  },

  /* ── Shared ── */
  table: { width: '100%' },
  sortableTable: {
    width: '100%',
    '& thead': {
      backgroundColor: tokens.colorNeutralBackground2,
      position: 'sticky' as const,
      top: 0,
      zIndex: 1,
    },
    '& th': {
      fontWeight: tokens.fontWeightSemibold,
      fontSize: tokens.fontSizeBase300,
      color: tokens.colorNeutralForeground2,
      padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
      cursor: 'pointer',
      userSelect: 'none',
      '&:hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
    },
    '& td': {
      padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
      borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    },
    '& tbody tr': {
      transition: 'background-color 0.15s ease',
      '&:hover': { backgroundColor: tokens.colorNeutralBackground1 },
    },
  },
  formField: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalM,
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    padding: tokens.spacingVerticalXXL,
  },
});

// ─── Small sub-components ───────────────────────────────────────────────────

function GapBadge({ gap }: { gap: number }) {
  const color = gap < 0 ? 'danger' : gap > 0 ? 'success' : 'informative';
  return (
    <Badge appearance="filled" color={color}>
      {gap > 0 ? '+' : ''}{gap}%
    </Badge>
  );
}

function GapStatusBadge({ status }: { status: string }) {
  if (status === 'under') return <Badge appearance="outline" color="danger" size="small">Under-staffed</Badge>;
  if (status === 'over') return <Badge appearance="outline" color="warning" size="small">Over-staffed</Badge>;
  return <Badge appearance="outline" color="success" size="small">Balanced</Badge>;
}

function ApprovalBadge({ status }: { status: string }) {
  switch (status?.toUpperCase()) {
    case 'APPROVED':
      return <Badge color="success" appearance="filled">Approved</Badge>;
    case 'PENDING':
      return <Badge color="warning" appearance="filled">Pending</Badge>;
    case 'REJECTED':
      return <Badge color="danger" appearance="filled">Rejected</Badge>;
    default:
      return <Badge color="informative" appearance="outline">Unsigned</Badge>;
  }
}

function CostCenterCard({ cc }: { cc: DashboardCostCenter }) {
  const styles = useStyles();
  const totalResources = cc.resources.length;
  const totalPlaceholders = cc.placeholders.length;

  return (
    <Card className={styles.deptCard}>
      <Accordion collapsible>
        <AccordionItem value="cc">
          <AccordionHeader>
            <div className={styles.deptHeader}>
              <div className={styles.deptName}>
                <BuildingRegular style={{ fontSize: 20, color: tokens.colorBrandForeground1 }} />
                <Title3>{cc.cost_center_name}</Title3>
              </div>
              <div className={styles.deptStats}>
                <div className={styles.deptStat}>
                  <Body2 style={{ fontWeight: tokens.fontWeightSemibold }}>Demand</Body2>
                  <Body1>{cc.total_demand_fte}%</Body1>
                </div>
                <div className={styles.deptStat}>
                  <Body2 style={{ fontWeight: tokens.fontWeightSemibold }}>Supply</Body2>
                  <Body1>{cc.total_supply_fte}%</Body1>
                </div>
                <div className={styles.deptStat}>
                  <Body2 style={{ fontWeight: tokens.fontWeightSemibold }}>Gap</Body2>
                  <GapBadge gap={cc.gap_fte} />
                </div>
                <Badge appearance="outline" size="small">
                  {totalResources} resource{totalResources !== 1 ? 's' : ''}
                  {totalPlaceholders > 0 ? `, ${totalPlaceholders} placeholder${totalPlaceholders !== 1 ? 's' : ''}` : ''}
                </Badge>
              </div>
            </div>
          </AccordionHeader>
          <AccordionPanel>
            <div className={styles.ccSection}>
              {cc.resources.map(r => (
                <div key={r.resource_id} className={styles.resourceRow}>
                  <Body1>{r.resource_name}</Body1>
                  <div style={{ display: 'flex', gap: tokens.spacingHorizontalM, alignItems: 'center' }}>
                    <Body2>Demand: {r.demand_fte}%</Body2>
                    <Body2>Supply: {r.supply_fte}%</Body2>
                    <GapBadge gap={r.gap_fte} />
                    <GapStatusBadge status={r.status} />
                  </div>
                </div>
              ))}
              {cc.placeholders.map(ph => (
                <div key={ph.placeholder_id} className={styles.placeholderRow}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS }}>
                    <Badge appearance="outline" color="warning" size="small">TBH</Badge>
                    <Body1>{ph.placeholder_name}</Body1>
                  </div>
                  <div style={{ display: 'flex', gap: tokens.spacingHorizontalM, alignItems: 'center' }}>
                    <Body2>Demand: {ph.demand_fte}%</Body2>
                    <Body2 style={{ color: tokens.colorNeutralForeground3 }}>{ph.project_name}</Body2>
                  </div>
                </div>
              ))}
              {cc.resources.length === 0 && cc.placeholders.length === 0 && (
                <div style={{ padding: tokens.spacingVerticalS, color: tokens.colorNeutralForeground3 }}>
                  <Body2>No resources or placeholders in this cost center.</Body2>
                </div>
              )}
            </div>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export const Finance: React.FC = () => {
  const styles = useStyles();
  const { showSuccess, showError, showApiError } = useToast();
  const { user } = useAuth();
  const canSeeStats = useHasRole('Finance', 'Director');

  // ── Shared state ──
  const { selectedPeriodId, selectedPeriod: currentPeriod, loading: periodsLoading } = usePeriod();
  const [activeTab, setActiveTab] = useState<string>('dashboard');

  // ── Dashboard tab state ──
  const [dashboard, setDashboard] = useState<ConsolidationDashboard | null>(null);

  // ── Actuals tab state ──
  const [actualsData, setActualsData] = useState<FinanceActualRow[]>([]);
  const [actualsLoading, setActualsLoading] = useState(false);
  const [actualsError, setActualsError] = useState<string | null>(null);
  const [actualsProjectId, setActualsProjectId] = useState<string>('');
  const [actualsApprovalStatus, setActualsApprovalStatus] = useState<string>('');
  const [projects, setProjects] = useState<LookupProject[]>([]);
  const [sortKey, setSortKey] = useState<string>('');
  const [sortAsc, setSortAsc] = useState(true);

  // ── Snapshots tab state ──
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  // ── Publish dialog state ──
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  const [publishName, setPublishName] = useState('');
  const [publishDescription, setPublishDescription] = useState('');

  // ── Cost center stats state (Actuals vs Plan chart) ──
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string>('');
  const year = currentPeriod?.year || new Date().getFullYear();
  const month = currentPeriod?.month || new Date().getMonth() + 1;
  const { data: ccStats, loading: ccStatsLoading, error: ccStatsError } = useCostCenterStats(year, month, selectedCostCenterId || undefined);

  // ── Cost center selector options
  const [costCenters, setCostCenters] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    lookupsApi.listCostCenters().then(list => setCostCenters(list.map(cc => ({ id: cc.id, name: cc.name }))));
  }, []);

  // ── Initial load ──
  useEffect(() => {
    lookupsApi.listProjects().then(setProjects);
  }, []);

  // ── Reload data when period changes ──
  useEffect(() => {
    if (selectedPeriodId) {
      loadDashboard(selectedPeriodId);
      loadSnapshots(selectedPeriodId);
      loadActuals(selectedPeriodId);
    }
  }, [selectedPeriodId]);

  // ── Reload actuals when filters change ──
  useEffect(() => {
    if (selectedPeriodId) {
      loadActuals(selectedPeriodId);
    }
  }, [actualsProjectId, actualsApprovalStatus]);

  // ── Data loaders ──

  const loadDashboard = async (periodId?: string) => {
    const pid = periodId || selectedPeriodId;
    try {
      const data = await consolidationApi.getDashboard(pid);
      setDashboard(data);
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to load dashboard');
    }
  };

  const loadSnapshots = async (periodId?: string) => {
    const pid = periodId || selectedPeriodId;
    try {
      const data = await consolidationApi.getSnapshots(pid);
      setSnapshots(data);
    } catch (err: unknown) {
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
    if (!publishName.trim()) {
      showError('Name is required');
      return;
    }
    try {
      await consolidationApi.publishSnapshot(selectedPeriodId, publishName, publishDescription || undefined);
      showSuccess('Snapshot published successfully');
      setIsPublishDialogOpen(false);
      setPublishName('');
      setPublishDescription('');
      loadSnapshots();
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to publish snapshot');
    }
  };

  // ── Actuals sorting ──
  function handleSort(key: string) {
    if (sortKey === key) { setSortAsc(!sortAsc); } else { setSortKey(key); setSortAsc(true); }
  }
  function sortIndicator(key: string) {
    if (sortKey !== key) return '';
    return sortAsc ? ' \u25B2' : ' \u25BC';
  }
  const sortedActuals = [...actualsData].sort((a, b) => {
    if (!sortKey) return 0;
    const aVal = (a as Record<string, unknown>)[sortKey];
    const bVal = (b as Record<string, unknown>)[sortKey];
    if (aVal === bVal) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    return ((aVal as string | number) > (bVal as string | number) ? 1 : -1) * (sortAsc ? 1 : -1);
  });

  const totalActualsLines = actualsData.length;
  const totalActualsFte = actualsData.reduce((s, d) => s + d.fte_percent, 0);
  const pendingCount = actualsData.filter(d => (d.approval_status?.toUpperCase?.() ?? '') === 'PENDING').length;
  const approvedCount = actualsData.filter(d => (d.approval_status?.toUpperCase?.() ?? '') === 'APPROVED').length;

  // ── Render ──

  if (periodsLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="large" label="Loading..." />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.pageTitle}>Finance</h1>
          <p className={styles.pageSubtitle}>Cost center gaps, employee actuals, and snapshot management</p>
        </div>

        <div style={{ display: 'flex', gap: tokens.spacingHorizontalM, alignItems: 'center' }}>
          <Dialog open={isPublishDialogOpen} onOpenChange={(_, data) => setIsPublishDialogOpen(data.open)}>
            <DialogTrigger>
              <Button appearance="primary" icon={<ArrowDownload24Regular />}>Publish Snapshot</Button>
            </DialogTrigger>
            <DialogSurface>
              <DialogBody>
                <DialogTitle>Publish Snapshot</DialogTitle>
                <DialogContent>
                  <MessageBar intent="info" style={{ marginBottom: tokens.spacingVerticalM }}>
                    <MessageBarBody>A snapshot is an immutable copy of planning data at this point in time.</MessageBarBody>
                  </MessageBar>
                  <div className={styles.formField}>
                    <label>Snapshot Name *</label>
                    <Input
                      value={publishName}
                      onChange={(_, data) => setPublishName(data.value)}
                      placeholder={`${currentPeriod?.year}-${String(currentPeriod?.month).padStart(2, '0')} Final`}
                    />
                  </div>
                  <div className={styles.formField}>
                    <label>Description</label>
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
        </div>
      </div>

      {/* Period Panel */}
      <PeriodPanel />

      {/* Tabs */}
      <TabList
        selectedValue={activeTab}
        onTabSelect={(_, data) => {
          setActiveTab(data.value as string);
          if (data.value === 'actuals') loadActuals();
        }}
        style={{ marginBottom: tokens.spacingVerticalL }}
      >
        <Tab value="dashboard" icon={<DocumentBulletList24Regular />}>Dashboard</Tab>
        <Tab value="actuals" icon={<MoneyRegular />}>Actuals</Tab>
        <Tab value="snapshots" icon={<ArrowDownload24Regular />}>Snapshots</Tab>
      </TabList>

      {/* ═══════════════ Dashboard Tab ═══════════════ */}
      {activeTab === 'dashboard' && dashboard && (
        <>
          <div className={styles.sectionTitle}>Overview</div>
          <div className={styles.summaryBar}>
            <div className={styles.summaryItem}>
              <div className={styles.summaryNumber}>{dashboard.summary.total_cost_centers}</div>
              <div className={styles.summaryLabel}>Cost Centers</div>
            </div>
            <div className={styles.summaryItem}>
              <div className={styles.summaryNumber}>{dashboard.summary.total_demand_fte}%</div>
              <div className={styles.summaryLabel}>Total Demand</div>
            </div>
            <div className={styles.summaryItem}>
              <div className={styles.summaryNumber}>{dashboard.summary.total_supply_fte}%</div>
              <div className={styles.summaryLabel}>Total Supply</div>
            </div>
            <div className={styles.summaryItem} style={{
              backgroundColor: dashboard.summary.total_gap_fte < 0
                ? tokens.colorPaletteRedBackground2
                : dashboard.summary.total_gap_fte > 0
                ? tokens.colorPaletteGreenBackground2
                : tokens.colorNeutralBackground1,
            }}>
              <div className={styles.summaryNumber}>
                {dashboard.summary.total_gap_fte > 0 ? '+' : ''}{dashboard.summary.total_gap_fte}%
              </div>
              <div className={styles.summaryLabel}>Total Gap</div>
            </div>
            <div className={styles.summaryItem} style={{
              backgroundColor: dashboard.summary.orphans_count > 0
                ? tokens.colorPaletteDarkOrangeBackground2
                : tokens.colorNeutralBackground1,
            }}>
              <div className={styles.summaryNumber}>{dashboard.summary.orphans_count}</div>
              <div className={styles.summaryLabel}>Orphan Demands</div>
            </div>
            <div className={styles.summaryItem} style={{
              backgroundColor: dashboard.summary.over_allocations_count > 0
                ? tokens.colorPaletteRedBackground2
                : tokens.colorNeutralBackground1,
            }}>
              <div className={styles.summaryNumber}>{dashboard.summary.over_allocations_count}</div>
              <div className={styles.summaryLabel}>Over-allocations</div>
            </div>
          </div>

          <div className={styles.sectionTitle}>Resource overview</div>
          {dashboard.cost_centers.length > 0 ? (
            dashboard.cost_centers.map((cc, i) => (
              <CostCenterCard key={cc.cost_center_id || i} cc={cc} />
            ))
          ) : (
            <Card className={styles.card}>
              <div style={{ padding: tokens.spacingVerticalXL, textAlign: 'center' }}>
                <Body1>No planning data for this period.</Body1>
              </div>
            </Card>
          )}

          {dashboard.over_allocations.length > 0 && (
            <Card className={styles.card}>
              <CardHeader
                header={<Body1><strong>Over-allocations (&gt;100%)</strong></Body1>}
                action={<Warning24Regular color={tokens.colorPaletteRedForeground1} />}
              />
              <Table className={styles.sortableTable}>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Resource</TableHeaderCell>
                    <TableHeaderCell>Cost Center</TableHeaderCell>
                    <TableHeaderCell>Total Demand</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.over_allocations.map((oa, i) => (
                    <TableRow key={i}>
                      <TableCell>{oa.resource_name}</TableCell>
                      <TableCell>{oa.cost_center_name || '-'}</TableCell>
                      <TableCell>
                        <Badge appearance="filled" color="danger">{oa.total_demand_fte}%</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}

      {/* ═══════════════ Actuals Tab ═══════════════ */}
      {activeTab === 'actuals' && (
        <>
          {/* Summary cards */}
          <div className={styles.sectionTitle}>Summary</div>
          <div className={styles.actualsSummaryRow}>
            <div className={styles.actualsSummaryCard}>
              <div className={styles.actualsSummaryValue}>{totalActualsLines}</div>
              <div className={styles.actualsSummaryLabel}>Total Lines</div>
            </div>
            <div className={styles.actualsSummaryCard}>
              <div className={styles.actualsSummaryValue}>{totalActualsFte}%</div>
              <div className={styles.actualsSummaryLabel}>Total FTE</div>
            </div>
            <div className={styles.actualsSummaryCard} style={{ borderColor: tokens.colorPaletteYellowBorder1, backgroundColor: tokens.colorPaletteYellowBackground1 }}>
              <div className={styles.actualsSummaryValue} style={{ color: tokens.colorPaletteYellowForeground1 }}>{pendingCount}</div>
              <div className={styles.actualsSummaryLabel}>Pending Approval</div>
            </div>
            <div className={styles.actualsSummaryCard} style={{ borderColor: tokens.colorPaletteGreenBorder1, backgroundColor: tokens.colorPaletteGreenBackground1 }}>
              <div className={styles.actualsSummaryValue} style={{ color: tokens.colorPaletteGreenForeground1 }}>{approvedCount}</div>
              <div className={styles.actualsSummaryLabel}>Approved</div>
            </div>
          </div>

          {/* Filters */}
          <Card className={styles.filtersCard}>
            <div className={styles.filtersCardLabel}>Filter by</div>
            <div className={styles.filtersRow}>
              <div className={styles.filterField}>
                <span className={styles.filterLabel}>Project</span>
                <Select value={actualsProjectId} onChange={(_, d) => setActualsProjectId(d.value)}>
                  <option value="">All Projects</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </div>
              <div className={styles.filterField}>
                <span className={styles.filterLabel}>Approval</span>
                <Select value={actualsApprovalStatus} onChange={(_, d) => setActualsApprovalStatus(d.value)}>
                  {approvalStatusOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </Select>
              </div>
            </div>
          </Card>

          {actualsError && (
            <MessageBar intent="error" style={{ marginBottom: tokens.spacingVerticalM }}>
              <MessageBarBody>{actualsError}</MessageBarBody>
            </MessageBar>
          )}

          {/* Data table */}
          <Card className={styles.card}>
            <CardHeader header={<Body1><strong>Employee actuals</strong></Body1>} />
            {actualsLoading ? (
              <LoadingState message="Loading actuals..." />
            ) : sortedActuals.length === 0 ? (
              <EmptyState
                icon={<MoneyRegular style={{ fontSize: 48 }} />}
                title="No actuals data"
                message="No actuals found for this period. Adjust the filters or select a different period."
              />
            ) : (
              <Table className={styles.sortableTable}>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell onClick={() => handleSort('employee_name')}>
                      Employee{sortIndicator('employee_name')}
                    </TableHeaderCell>
                    <TableHeaderCell onClick={() => handleSort('project_name')}>
                      Project{sortIndicator('project_name')}
                    </TableHeaderCell>
                    <TableHeaderCell onClick={() => handleSort('cost_center_name')}>
                      Cost Center{sortIndicator('cost_center_name')}
                    </TableHeaderCell>
                    <TableHeaderCell onClick={() => handleSort('year')}>
                      Period{sortIndicator('year')}
                    </TableHeaderCell>
                    <TableHeaderCell onClick={() => handleSort('fte_percent')}>
                      FTE %{sortIndicator('fte_percent')}
                    </TableHeaderCell>
                    <TableHeaderCell onClick={() => handleSort('approval_status')}>
                      Approval{sortIndicator('approval_status')}
                    </TableHeaderCell>
                    <TableHeaderCell onClick={() => handleSort('current_approval_step')}>
                      Current Step{sortIndicator('current_approval_step')}
                    </TableHeaderCell>
                    <TableHeaderCell onClick={() => handleSort('current_approver_name')}>
                      Approver{sortIndicator('current_approver_name')}
                    </TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedActuals.map(row => (
                    <TableRow key={row.actual_id}>
                      <TableCell>
                        <div>
                          <strong>{row.employee_name}</strong>
                          <div style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                            {row.employee_email}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{row.project_name}</TableCell>
                      <TableCell>{row.cost_center_name}</TableCell>
                      <TableCell>{row.year}-{String(row.month).padStart(2, '0')}</TableCell>
                      <TableCell>
                        <Badge appearance="filled" color="informative">{row.fte_percent}%</Badge>
                      </TableCell>
                      <TableCell><ApprovalBadge status={row.approval_status} /></TableCell>
                      <TableCell>{row.current_approval_step || '-'}</TableCell>
                      <TableCell>{row.current_approver_name || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          {/* Actuals vs Demand/Supply by Cost Center */}
          {canSeeStats && (() => {
            const chartRows = ccStats && ccStats.length > 0 ? ccStats : EXAMPLE_COST_CENTER_STATS;
            const usedExampleData = !ccStats || ccStats.length === 0;
            return (
              <Card className={styles.card}>
                <CardHeader header={<Body1><strong>Actuals vs Demand/Supply by Cost Center</strong></Body1>} />
                <div style={{ marginBottom: 16, display: 'flex', gap: 16 }}>
                  <Select value={selectedCostCenterId} onChange={e => setSelectedCostCenterId(e.target.value)}>
                    <option value="">All Cost Centers</option>
                    {costCenters.map(cc => (
                      <option key={cc.id} value={cc.id}>{cc.name}</option>
                    ))}
                  </Select>
                </div>
                {ccStatsLoading ? (
                  <LoadingState message="Loading cost center stats..." />
                ) : ccStatsError ? (
                  <MessageBar intent="error"><MessageBarBody>{ccStatsError}</MessageBarBody></MessageBar>
                ) : (
                  <>
                    {usedExampleData && (
                      <MessageBar intent="info" style={{ marginBottom: tokens.spacingVerticalM }}>
                        <MessageBarBody>Showing example data. Select a period with planning data to see real cost center stats.</MessageBarBody>
                      </MessageBar>
                    )}
                    <div style={{ height: 320 }}>
                      <BreakdownChart
                        rows={chartRows.map(row => ({
                          label: row.cost_center_name,
                          demandFte: row.demand_fte,
                          supplyFte: row.supply_fte,
                          actualsFte: row.actuals_fte,
                        }))}
                      />
                    </div>
                  </>
                )}
              </Card>
            );
          })()}
        </>
      )}

      {/* ═══════════════ Snapshots Tab ═══════════════ */}
      {activeTab === 'snapshots' && (
        <Card className={styles.card}>
          <CardHeader header={<Body1><strong>Published Snapshots</strong></Body1>} />
          {snapshots.length > 0 ? (
            <Table className={styles.table}>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Description</TableHeaderCell>
                  <TableHeaderCell>Lines</TableHeaderCell>
                  <TableHeaderCell>Published At</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map(snapshot => (
                  <TableRow key={snapshot.id}>
                    <TableCell><strong>{snapshot.name}</strong></TableCell>
                    <TableCell>{snapshot.description || '-'}</TableCell>
                    <TableCell>{snapshot.lines_count}</TableCell>
                    <TableCell>{new Date(snapshot.published_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div style={{ padding: tokens.spacingVerticalL, textAlign: 'center' }}>
              <Body1>No snapshots published for this period yet.</Body1>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default Finance;
