/**
 * Unified Finance Page
 *
 * Merges the old Consolidation page and FinanceDashboard into one view.
 * Tabs: Dashboard (dept gaps), Actuals (employee actuals), Snapshots.
 * Accessible to: Admin, Finance, Director
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Title3,
  Body1,
  Body2,
  Card,
  CardHeader,
  Button,
  Spinner,
  Skeleton,
  SkeletonItem,
  Badge,
  tokens,
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
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
} from '@fluentui/react-components';
import {
  ArrowDownload24Regular,
  DocumentBulletList24Regular,
  Warning24Regular,
  BuildingRegular,
  MoneyRegular,
  CalendarLtr24Regular,
} from '@fluentui/react-icons';
import {
  consolidationApi,
  ConsolidationDashboard,
  DashboardCostCenter,
  Snapshot,
  SnapshotDetail,
} from '../api/consolidation';
import { usePeriod } from '../contexts/PeriodContext';
import { apiClient } from '../api/client';
import { lookupsApi } from '../api/lookups';
import { PeriodPanel } from '../components/PeriodPanel';
import { PeriodSelector } from '../components/PeriodSelector';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { useToast } from '../hooks/useToast';
import { useAuth, useHasRole } from '../auth/AuthProvider';
import { useEmployeeStats } from '../hooks/useEmployeeStats';
import { DemandVsActualsBarChart } from '../components/DemandVsActualsBarChart';
import { getFinanceSetting, updateFinanceSetting } from '../api/finance';
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

const COST_SETTING_KEY = 'monthly_fte_cost';
const DEFAULT_MONTHLY_FTE_COST = 99000;

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
    alignItems: 'center',
    marginBottom: tokens.spacingVerticalL,
    paddingBottom: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
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
  scoreboardRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalL,
    flexWrap: 'wrap' as const,
  },
  scoreboardItem: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    '&:hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  scoreboardItemActive: {
    borderTopColor: tokens.colorBrandStroke1,
    borderRightColor: tokens.colorBrandStroke1,
    borderBottomColor: tokens.colorBrandStroke1,
    borderLeftColor: tokens.colorBrandStroke1,
    backgroundColor: tokens.colorNeutralBackground1Selected,
  },
  scoreboardValue: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  scoreboardLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
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

  /* ── Sticky toolbar ── */
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
  toolbarLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  toolbarLastSnapshot: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    marginLeft: 'auto',
  },

  /* ── Cost Report tab ── */
  costToolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalL,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    flexWrap: 'wrap' as const,
  },
  subtotalRow: {
    fontWeight: tokens.fontWeightSemibold,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  grandTotalRow: {
    fontWeight: tokens.fontWeightBold,
    backgroundColor: tokens.colorBrandBackground2,
  },

  /* ── Cost Centers work queue ── */
  workQueueLayout: {
    display: 'grid',
    gridTemplateColumns: '35% 1fr',
    gap: tokens.spacingHorizontalL,
    minHeight: 400,
  },
  workQueueLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingRight: tokens.spacingHorizontalL,
  },
  workQueueSearch: {
    minWidth: 0,
  },
  workQueueList: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    overflowY: 'auto' as const,
  },
  workQueueRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    '&:hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  workQueueRowSelected: {
    borderTopColor: tokens.colorBrandStroke1,
    borderRightColor: tokens.colorBrandStroke1,
    borderBottomColor: tokens.colorBrandStroke1,
    borderLeftColor: tokens.colorBrandStroke1,
    backgroundColor: tokens.colorNeutralBackground1Selected,
  },
  workQueueDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
  },
  workQueueDetailsHeader: {
    paddingBottom: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
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
  const canSeeStats = useHasRole('Finance', 'Director', 'Admin');

  // ── Shared state ──
  const { periods, selectedPeriodId, setSelectedPeriodId, selectedPeriod: currentPeriod, loading: periodsLoading } = usePeriod();
  const [activeTab, setActiveTab] = useState<string>('dashboard');

  // ── Dashboard tab state ──
  const [dashboard, setDashboard] = useState<ConsolidationDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [scoreboardFilter, setScoreboardFilter] = useState<'none' | 'orphans' | 'overalloc'>('none');

  // ── Cost Centers work queue state ──
  const [selectedQueueCostCenterId, setSelectedQueueCostCenterId] = useState<string | null>(null);
  const [costCenterSearch, setCostCenterSearch] = useState('');
  const [costCenterSort, setCostCenterSort] = useState<'gap' | 'name' | 'demand' | 'supply'>('gap');
  const [costCenterSortDir, setCostCenterSortDir] = useState<'asc' | 'desc'>('desc');
  const [costCenterDetailTab, setCostCenterDetailTab] = useState<'resources' | 'issues'>('resources');

  // ── Cost Report tab state ──
  const canSeeCostReport = useHasRole('Finance', 'Admin');
  const [monthlyFteCost, setMonthlyFteCost] = useState<number>(DEFAULT_MONTHLY_FTE_COST);
  const [costOverrideInput, setCostOverrideInput] = useState<string>(String(DEFAULT_MONTHLY_FTE_COST));
  const [costOverrideSaving, setCostOverrideSaving] = useState(false);

  // ── Actuals tab state ──
  const [actualsData, setActualsData] = useState<FinanceActualRow[]>([]);
  const [actualsLoading, setActualsLoading] = useState(false);
  const [actualsError, setActualsError] = useState<string | null>(null);
  const [actualsProjectId, setActualsProjectId] = useState<string>('');
  const [actualsApprovalStatus, setActualsApprovalStatus] = useState<string>('');
  const [actualsQueueCostCenterId, setActualsQueueCostCenterId] = useState<string | null>(null);
  const [actualsScoreboardFilter, setActualsScoreboardFilter] = useState<'none' | 'pending' | 'approved'>('none');
  const [actualsCcSearch, setActualsCcSearch] = useState('');
  const [actualsCcSort, setActualsCcSort] = useState<'name' | 'fte' | 'pending'>('fte');
  const [actualsCcSortDir, setActualsCcSortDir] = useState<'asc' | 'desc'>('desc');
  const [projects, setProjects] = useState<LookupProject[]>([]);
  const [sortKey, setSortKey] = useState<string>('');
  const [sortAsc, setSortAsc] = useState(true);

  // ── Snapshots tab state ──
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [viewedSnapshot, setViewedSnapshot] = useState<SnapshotDetail | null>(null);
  const [downloadingSnapshotId, setDownloadingSnapshotId] = useState<string | null>(null);

  // ── Publish dialog state ──
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);

  // ── Period management drawer ──
  const [isPeriodDrawerOpen, setIsPeriodDrawerOpen] = useState(false);
  const canManagePeriods = user?.role === 'Finance' || user?.role === 'Admin';
  const canPublishSnapshot = user?.role === 'Finance' || user?.role === 'Admin';
  const canDownloadCsv = user?.role === 'Finance';
  const [publishName, setPublishName] = useState('');
  const [publishDescription, setPublishDescription] = useState('');

  // ── Cost center stats state (Actuals vs Plan chart) ──
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string>('');
  const firstOpenPeriod = periods.find((p) => p.status === 'open');
  const chartPeriod = currentPeriod ?? firstOpenPeriod ?? periods[0];
  // Use period from actuals data when available (guarantees match with displayed table)
  const periodFromActuals = actualsData.length > 0 ? { year: actualsData[0].year, month: actualsData[0].month } : null;
  const year = periodFromActuals?.year ?? chartPeriod?.year ?? 0;
  const month = periodFromActuals?.month ?? chartPeriod?.month ?? 0;
  const chartCostCenterId = activeTab === 'actuals' ? (actualsQueueCostCenterId ?? undefined) : (selectedCostCenterId || undefined);
  const { data: empStats, loading: empStatsLoading, error: empStatsError } = useEmployeeStats(
    year,
    month,
    chartCostCenterId ?? undefined,
    actualsProjectId || undefined,
    !!(chartPeriod || periodFromActuals)
  );

  // ── Cost center selector options
  const [costCenters, setCostCenters] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    lookupsApi.listCostCenters().then(list => setCostCenters(list.map(cc => ({ id: cc.id, name: cc.name }))));
  }, []);

  const latestSnapshot = useMemo(() =>
    snapshots.length > 0 ? [...snapshots].sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())[0] : null,
    [snapshots]
  );

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

  // ── Load cost setting when switching to Cost Report tab ──
  useEffect(() => {
    if (activeTab === 'costreport' && canSeeCostReport) {
      getFinanceSetting(COST_SETTING_KEY).then(s => {
        const v = parseInt(s.setting_value, 10);
        if (!isNaN(v)) {
          setMonthlyFteCost(v);
          setCostOverrideInput(String(v));
        }
      }).catch(() => { /* keep default */ });
      if (actualsData.length === 0 && selectedPeriodId) {
        loadActuals(selectedPeriodId);
      }
    }
  }, [activeTab, selectedPeriodId]);

  // ── Data loaders ──

  const loadDashboard = async (periodId?: string) => {
    const pid = periodId || selectedPeriodId;
    if (!pid) return;
    setDashboardLoading(true);
    try {
      const data = await consolidationApi.getDashboard(pid);
      setDashboard(data);
    } catch (err: unknown) {
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

  // ── DKK formatter ──
  const formatDKK = (n: number): string =>
    new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 }).format(n);

  // ── Cost Report handlers ──
  const handleCostSave = async () => {
    const v = parseInt(costOverrideInput, 10);
    if (isNaN(v) || v <= 0) {
      showError('Monthly FTE cost must be a positive number');
      return;
    }
    setCostOverrideSaving(true);
    try {
      await updateFinanceSetting(COST_SETTING_KEY, String(v));
      setMonthlyFteCost(v);
      showSuccess('Monthly FTE cost updated');
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to save setting');
    } finally {
      setCostOverrideSaving(false);
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
  const totalActualsLines = actualsData.length;
  const totalActualsFte = actualsData.reduce((s, d) => s + d.fte_percent, 0);
  const pendingCount = actualsData.filter(d => (d.approval_status?.toUpperCase?.() ?? '') === 'PENDING').length;
  const approvedCount = actualsData.filter(d => (d.approval_status?.toUpperCase?.() ?? '') === 'APPROVED').length;

  const actualsCcList = useMemo(() => {
    const byCc = new Map<string, { cost_center_id: string; cost_center_name: string; totalFte: number; lineCount: number; pendingCount: number }>();
    for (const row of actualsData) {
      const id = row.cost_center_id;
      const existing = byCc.get(id);
      const pending = (row.approval_status?.toUpperCase?.() ?? '') === 'PENDING' ? 1 : 0;
      if (existing) {
        existing.totalFte += row.fte_percent;
        existing.lineCount += 1;
        existing.pendingCount += pending;
      } else {
        byCc.set(id, {
          cost_center_id: id,
          cost_center_name: row.cost_center_name,
          totalFte: row.fte_percent,
          lineCount: 1,
          pendingCount: pending,
        });
      }
    }
    return Array.from(byCc.values());
  }, [actualsData]);

  const filteredActuals = useMemo(() => {
    let out = actualsData;
    if (actualsScoreboardFilter === 'pending') {
      out = out.filter(d => (d.approval_status?.toUpperCase?.() ?? '') === 'PENDING');
    } else if (actualsScoreboardFilter === 'approved') {
      out = out.filter(d => (d.approval_status?.toUpperCase?.() ?? '') === 'APPROVED');
    }
    if (actualsQueueCostCenterId) {
      out = out.filter(d => d.cost_center_id === actualsQueueCostCenterId);
    }
    return out;
  }, [actualsData, actualsScoreboardFilter, actualsQueueCostCenterId]);

  const sortedActuals = useMemo(() => {
    return [...filteredActuals].sort((a, b) => {
      if (!sortKey) return 0;
      const aVal = (a as unknown as Record<string, unknown>)[sortKey];
      const bVal = (b as unknown as Record<string, unknown>)[sortKey];
      if (aVal === bVal) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      return ((aVal as string | number) > (bVal as string | number) ? 1 : -1) * (sortAsc ? 1 : -1);
    });
  }, [filteredActuals, sortKey, sortAsc]);

  // ── Cost Report computed data ──
  const costRows = useMemo(() =>
    actualsData.map(r => ({ ...r, cost: Math.round((r.fte_percent / 100) * monthlyFteCost) })),
    [actualsData, monthlyFteCost]);

  const costByProject = useMemo(() => {
    const map = new Map<string, { name: string; rows: typeof costRows; total: number }>();
    for (const r of costRows) {
      const g = map.get(r.project_id) ?? { name: r.project_name, rows: [], total: 0 };
      g.rows.push(r);
      g.total += r.cost;
      map.set(r.project_id, g);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [costRows]);

  const grandTotal = useMemo(() => costRows.reduce((s, r) => s + r.cost, 0), [costRows]);

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
        <div style={{ display: 'flex', gap: tokens.spacingHorizontalM, alignItems: 'center' }}>
          {canManagePeriods && (
            <Button
              appearance="secondary"
              icon={<CalendarLtr24Regular />}
              onClick={() => setIsPeriodDrawerOpen(true)}
            >
              Manage periods
            </Button>
          )}
          {canPublishSnapshot && (
            <>
              <Button
                appearance="primary"
                icon={<ArrowDownload24Regular />}
                onClick={() => setIsPublishDialogOpen(true)}
              >
                Publish Snapshot
              </Button>
              <Dialog open={isPublishDialogOpen} onOpenChange={(_, data) => setIsPublishDialogOpen(data.open)}>
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
                      placeholder={`${currentPeriod?.year}-${String(currentPeriod?.month).padStart(2, '0')} Final`}
                    />
                  </div>
                  <div className={styles.formField}>
                    <label>Description (optional notes)</label>
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
            </>
          )}
        </div>
      </div>

      {/* Period Management Drawer */}
      {canManagePeriods && (
        <Drawer
          type="overlay"
          position="end"
          open={isPeriodDrawerOpen}
          onOpenChange={(_, data) => setIsPeriodDrawerOpen(data.open)}
        >
          <DrawerHeader>
            <DrawerHeaderTitle>Period Management</DrawerHeaderTitle>
          </DrawerHeader>
          <DrawerBody>
            <PeriodPanel variant="embedded" />
          </DrawerBody>
        </Drawer>
      )}

      {/* Sticky toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarRow}>
          <TabList
            selectedValue={activeTab}
            onTabSelect={(_, data) => {
              setActiveTab(data.value as string);
              if (data.value === 'actuals') {
                setActualsQueueCostCenterId(selectedCostCenterId || null);
                loadActuals();
              }
            }}
          >
            <Tab value="dashboard" icon={<DocumentBulletList24Regular />}>Overview</Tab>
            <Tab value="costcenters" icon={<BuildingRegular />}>Cost Centers</Tab>
            <Tab value="actuals" icon={<MoneyRegular />}>Actuals</Tab>
            <Tab value="snapshots" icon={<ArrowDownload24Regular />}>Snapshots</Tab>
            {canSeeCostReport && (
              <Tab value="costreport" icon={<MoneyRegular />}>Cost Report</Tab>
            )}
          </TabList>
          <span className={styles.toolbarLastSnapshot}>
            {latestSnapshot ? `Last snapshot: ${new Date(latestSnapshot.published_at).toLocaleDateString()}` : 'No snapshots yet'}
          </span>
        </div>
        <div className={styles.toolbarFilters}>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Period</span>
            <PeriodSelector
              periods={periods}
              selectedId={selectedPeriodId}
              onSelect={setSelectedPeriodId}
            />
          </div>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Cost center</span>
            <Select
              value={activeTab === 'actuals' ? (actualsQueueCostCenterId ?? '') : selectedCostCenterId}
              onChange={(_, data) => {
                const val = data.value ?? '';
                if (activeTab === 'actuals') {
                  setActualsQueueCostCenterId(val || null);
                } else {
                  setSelectedCostCenterId(val);
                }
              }}
              style={{ minWidth: 160 }}
            >
              <option value="">All cost centers</option>
              {costCenters.map(cc => (
                <option key={cc.id} value={cc.id}>{cc.name}</option>
              ))}
            </Select>
          </div>
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
                  style={{ minWidth: 120 }}
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

      {/* ═══════════════ Cost Centers Tab (work queue + details) ═══════════════ */}
      {activeTab === 'costcenters' && (
        <>
          {dashboardLoading ? (
            <div className={styles.workQueueLayout}>
              <div className={styles.workQueueLeft}>
                <Skeleton style={{ height: 32, marginBottom: 16 }}><SkeletonItem /></Skeleton>
                <Skeleton style={{ height: 300 }}><SkeletonItem /></Skeleton>
              </div>
              <div className={styles.workQueueDetails}>
                <Skeleton style={{ height: 200 }}><SkeletonItem /></Skeleton>
              </div>
            </div>
          ) : dashboard && dashboard.cost_centers.length > 0 ? (
            (() => {
              const filtered = costCenterSearch.trim()
                ? dashboard.cost_centers.filter(cc =>
                    cc.cost_center_name.toLowerCase().includes(costCenterSearch.toLowerCase()))
                : dashboard.cost_centers;
              const sorted = [...filtered].sort((a, b) => {
                const dir = costCenterSortDir === 'asc' ? 1 : -1;
                switch (costCenterSort) {
                  case 'name':
                    return a.cost_center_name.localeCompare(b.cost_center_name) * dir;
                  case 'demand':
                    return (a.total_demand_fte - b.total_demand_fte) * dir;
                  case 'supply':
                    return (a.total_supply_fte - b.total_supply_fte) * dir;
                  case 'gap':
                  default:
                    return (a.gap_fte - b.gap_fte) * dir;
                }
              });
              const selectedCc = selectedQueueCostCenterId
                ? dashboard.cost_centers.find(cc => (cc.cost_center_id || '__none__') === selectedQueueCostCenterId)
                : null;
              const overAllocsForCc = selectedCc
                ? dashboard.over_allocations.filter(oa => (oa.cost_center_id || '__none__') === (selectedCc.cost_center_id || '__none__'))
                : [];

              return (
                <div className={styles.workQueueLayout}>
                  <div className={styles.workQueueLeft}>
                    <Input
                      className={styles.workQueueSearch}
                      placeholder="Search cost centers..."
                      value={costCenterSearch}
                      onChange={(_, d) => setCostCenterSearch(d.value)}
                    />
                    <div style={{ display: 'flex', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' }}>
                      {(['gap', 'name', 'demand', 'supply'] as const).map(key => (
                        <Button
                          key={key}
                          size="small"
                          appearance={costCenterSort === key ? 'primary' : 'subtle'}
                          onClick={() => {
                            setCostCenterSort(key);
                            setCostCenterSortDir(prev => (costCenterSort === key && prev === 'desc' ? 'asc' : 'desc'));
                          }}
                        >
                          {key === 'gap' ? 'Gap' : key === 'name' ? 'Name' : key.charAt(0).toUpperCase() + key.slice(1)}
                        </Button>
                      ))}
                    </div>
                    <div className={styles.workQueueList}>
                      {sorted.map(cc => (
                        <div
                          key={cc.cost_center_id || cc.cost_center_name}
                          className={`${styles.workQueueRow} ${selectedQueueCostCenterId === (cc.cost_center_id || '__none__') ? styles.workQueueRowSelected : ''}`}
                          onClick={() => setSelectedQueueCostCenterId(cc.cost_center_id || '__none__')}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => e.key === 'Enter' && setSelectedQueueCostCenterId(cc.cost_center_id || '__none__')}
                        >
                          <div>
                            <Body1 style={{ fontWeight: tokens.fontWeightSemibold }}>{cc.cost_center_name}</Body1>
                            <div style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                              D: {cc.total_demand_fte}% S: {cc.total_supply_fte}% G: {cc.gap_fte > 0 ? '+' : ''}{cc.gap_fte}%
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: tokens.spacingHorizontalXS }}>
                            {cc.placeholders.length > 0 && (
                              <Badge appearance="outline" color="warning" size="small">{cc.placeholders.length} orphan</Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className={styles.workQueueDetails}>
                    {selectedCc ? (
                      <>
                        <div className={styles.workQueueDetailsHeader}>
                          <Title3>{selectedCc.cost_center_name}</Title3>
                          <div style={{ display: 'flex', gap: tokens.spacingHorizontalL, marginTop: tokens.spacingVerticalXS }}>
                            <Body2>Demand: {selectedCc.total_demand_fte}%</Body2>
                            <Body2>Supply: {selectedCc.total_supply_fte}%</Body2>
                            <GapBadge gap={selectedCc.gap_fte} />
                          </div>
                        </div>
                        <TabList selectedValue={costCenterDetailTab} onTabSelect={(_, d) => setCostCenterDetailTab(d.value as 'resources' | 'issues')}>
                          <Tab value="resources">Resources</Tab>
                          <Tab value="issues">Issues</Tab>
                        </TabList>
                        {costCenterDetailTab === 'resources' && (
                          <Table className={styles.table}>
                            <TableHeader>
                              <TableRow>
                                <TableHeaderCell>Resource</TableHeaderCell>
                                <TableHeaderCell>Demand</TableHeaderCell>
                                <TableHeaderCell>Supply</TableHeaderCell>
                                <TableHeaderCell>Gap</TableHeaderCell>
                                <TableHeaderCell>Status</TableHeaderCell>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {selectedCc.resources.map(r => (
                                <TableRow key={r.resource_id}>
                                  <TableCell>{r.resource_name}</TableCell>
                                  <TableCell>{r.demand_fte}%</TableCell>
                                  <TableCell>{r.supply_fte}%</TableCell>
                                  <TableCell><GapBadge gap={r.gap_fte} /></TableCell>
                                  <TableCell><GapStatusBadge status={r.status} /></TableCell>
                                </TableRow>
                              ))}
                              {selectedCc.placeholders.map(ph => (
                                <TableRow key={ph.placeholder_id}>
                                  <TableCell>
                                    <Badge appearance="outline" color="warning" size="small">TBD</Badge> {ph.placeholder_name}
                                  </TableCell>
                                  <TableCell>{ph.demand_fte}%</TableCell>
                                  <TableCell>—</TableCell>
                                  <TableCell>—</TableCell>
                                  <TableCell>—</TableCell>
                                </TableRow>
                              ))}
                              {selectedCc.resources.length === 0 && selectedCc.placeholders.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={5}>No resources or placeholders.</TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        )}
                        {costCenterDetailTab === 'issues' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM }}>
                            {selectedCc.placeholders.length > 0 && (
                              <Card className={styles.card}>
                                <CardHeader header={<Body1><strong>Orphan demands ({selectedCc.placeholders.length})</strong></Body1>} />
                                <Table className={styles.table}>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHeaderCell>Placeholder</TableHeaderCell>
                                      <TableHeaderCell>Project</TableHeaderCell>
                                      <TableHeaderCell>Demand</TableHeaderCell>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {selectedCc.placeholders.map(ph => (
                                      <TableRow key={ph.placeholder_id}>
                                        <TableCell>{ph.placeholder_name}</TableCell>
                                        <TableCell>{ph.project_name}</TableCell>
                                        <TableCell>{ph.demand_fte}%</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </Card>
                            )}
                            {overAllocsForCc.length > 0 && (
                              <Card className={styles.card}>
                                <CardHeader header={<Body1><strong>Over-allocations ({overAllocsForCc.length})</strong></Body1>} />
                                <Table className={styles.table}>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHeaderCell>Resource</TableHeaderCell>
                                      <TableHeaderCell>Total Demand</TableHeaderCell>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {overAllocsForCc.map((oa, i) => (
                                      <TableRow key={i}>
                                        <TableCell>{oa.resource_name}</TableCell>
                                        <TableCell><Badge appearance="filled" color="danger">{oa.total_demand_fte}%</Badge></TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </Card>
                            )}
                            {selectedCc.placeholders.length === 0 && overAllocsForCc.length === 0 && (
                              <Body1 style={{ color: tokens.colorNeutralForeground3 }}>No issues for this cost center.</Body1>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ padding: tokens.spacingVerticalXXL, textAlign: 'center', color: tokens.colorNeutralForeground3 }}>
                        <Body1>Select a cost center from the list.</Body1>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()
          ) : (
            <Card className={styles.card}>
              <div style={{ padding: tokens.spacingVerticalXL, textAlign: 'center' }}>
                <Body1>No planning data for this period. Select a different period or add demand/supply.</Body1>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ═══════════════ Dashboard Tab ═══════════════ */}
      {activeTab === 'dashboard' && dashboardLoading && (
        <>
          <div className={styles.sectionTitle}>Overview</div>
          <div style={{ display: 'flex', gap: tokens.spacingHorizontalM, marginBottom: tokens.spacingVerticalL }}>
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} style={{ height: 64, flex: 1 }}><SkeletonItem /></Skeleton>
            ))}
          </div>
          <Skeleton style={{ height: 200, marginBottom: tokens.spacingVerticalL }}><SkeletonItem /></Skeleton>
        </>
      )}
      {activeTab === 'dashboard' && !dashboardLoading && !dashboard && (
        <Card className={styles.card}>
          <div style={{ padding: tokens.spacingVerticalXL, textAlign: 'center' }}>
            <Body1>Failed to load dashboard. Select a period and try again.</Body1>
          </div>
        </Card>
      )}
      {activeTab === 'dashboard' && !dashboardLoading && dashboard && (
        <>
          <div className={styles.sectionTitle}>Overview</div>
          <div className={styles.scoreboardRow}>
            <div
              className={`${styles.scoreboardItem}`}
              onClick={() => setScoreboardFilter('none')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setScoreboardFilter('none')}
            >
              <span className={styles.scoreboardValue}>{dashboard.summary.total_demand_fte}%</span>
              <span className={styles.scoreboardLabel}>Demand</span>
            </div>
            <div
              className={`${styles.scoreboardItem}`}
              onClick={() => setScoreboardFilter('none')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setScoreboardFilter('none')}
            >
              <span className={styles.scoreboardValue}>{dashboard.summary.total_supply_fte}%</span>
              <span className={styles.scoreboardLabel}>Supply</span>
            </div>
            <div
              className={`${styles.scoreboardItem} ${scoreboardFilter === 'none' ? '' : ''}`}
              style={{
                backgroundColor: dashboard.summary.total_gap_fte < 0
                  ? tokens.colorPaletteRedBackground2
                  : dashboard.summary.total_gap_fte > 0
                  ? tokens.colorPaletteGreenBackground2
                  : undefined,
              }}
              onClick={() => setScoreboardFilter('none')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setScoreboardFilter('none')}
            >
              <span className={styles.scoreboardValue}>
                {dashboard.summary.total_gap_fte > 0 ? '+' : ''}{dashboard.summary.total_gap_fte}%
              </span>
              <span className={styles.scoreboardLabel}>Gap</span>
            </div>
            <div
              className={`${styles.scoreboardItem} ${scoreboardFilter === 'orphans' ? styles.scoreboardItemActive : ''}`}
              style={dashboard.summary.orphans_count > 0 ? { borderColor: tokens.colorPaletteDarkOrangeBorder1 } : undefined}
              onClick={() => setScoreboardFilter(scoreboardFilter === 'orphans' ? 'none' : 'orphans')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setScoreboardFilter(scoreboardFilter === 'orphans' ? 'none' : 'orphans')}
            >
              <span className={styles.scoreboardValue}>{dashboard.summary.orphans_count}</span>
              <span className={styles.scoreboardLabel}>Orphan Demands</span>
            </div>
            <div
              className={`${styles.scoreboardItem} ${scoreboardFilter === 'overalloc' ? styles.scoreboardItemActive : ''}`}
              style={dashboard.summary.over_allocations_count > 0 ? { borderColor: tokens.colorPaletteRedBorder1 } : undefined}
              onClick={() => setScoreboardFilter(scoreboardFilter === 'overalloc' ? 'none' : 'overalloc')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setScoreboardFilter(scoreboardFilter === 'overalloc' ? 'none' : 'overalloc')}
            >
              <span className={styles.scoreboardValue}>{dashboard.summary.over_allocations_count}</span>
              <span className={styles.scoreboardLabel}>Over-allocations</span>
            </div>
          </div>

          {scoreboardFilter === 'overalloc' && dashboard.over_allocations.length > 0 && (
            <Card className={styles.card} style={{ marginBottom: tokens.spacingVerticalL }}>
              <CardHeader
                header={<Body1><strong>Over-allocations (&gt;100%)</strong></Body1>}
                action={<Warning24Regular style={{ color: tokens.colorPaletteRedForeground1 }} />}
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

          <div className={styles.sectionTitle}>Resource overview</div>
          {dashboard.cost_centers.length > 0 ? (
            (scoreboardFilter === 'orphans'
              ? dashboard.cost_centers.filter(cc => cc.placeholders.length > 0)
              : dashboard.cost_centers
            ).map((cc, i) => (
              <CostCenterCard key={cc.cost_center_id || i} cc={cc} />
            ))
          ) : (
            <Card className={styles.card}>
              <div style={{ padding: tokens.spacingVerticalXL, textAlign: 'center' }}>
                <Body1>No planning data for this period.</Body1>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ═══════════════ Actuals Tab ═══════════════ */}
      {activeTab === 'actuals' && (
        <>
          {actualsError && (
            <MessageBar intent="error" style={{ marginBottom: tokens.spacingVerticalM }}>
              <MessageBarBody>{actualsError}</MessageBarBody>
            </MessageBar>
          )}

          {/* KPI Scoreboard */}
          <div className={styles.sectionTitle}>Summary</div>
          <div className={styles.scoreboardRow}>
            <div className={styles.scoreboardItem}>
              <span className={styles.scoreboardValue}>{totalActualsLines}</span>
              <span className={styles.scoreboardLabel}>Total Lines</span>
            </div>
            <div className={styles.scoreboardItem}>
              <span className={styles.scoreboardValue}>{totalActualsFte}%</span>
              <span className={styles.scoreboardLabel}>Total FTE</span>
            </div>
            <div
              className={`${styles.scoreboardItem} ${actualsScoreboardFilter === 'pending' ? styles.scoreboardItemActive : ''}`}
              style={pendingCount > 0 ? { borderColor: tokens.colorPaletteYellowBorder1 } : undefined}
              onClick={() => setActualsScoreboardFilter(actualsScoreboardFilter === 'pending' ? 'none' : 'pending')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setActualsScoreboardFilter(actualsScoreboardFilter === 'pending' ? 'none' : 'pending')}
            >
              <span className={styles.scoreboardValue}>{pendingCount}</span>
              <span className={styles.scoreboardLabel}>Pending</span>
            </div>
            <div
              className={`${styles.scoreboardItem} ${actualsScoreboardFilter === 'approved' ? styles.scoreboardItemActive : ''}`}
              style={approvedCount > 0 ? { borderColor: tokens.colorPaletteGreenBorder1 } : undefined}
              onClick={() => setActualsScoreboardFilter(actualsScoreboardFilter === 'approved' ? 'none' : 'approved')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setActualsScoreboardFilter(actualsScoreboardFilter === 'approved' ? 'none' : 'approved')}
            >
              <span className={styles.scoreboardValue}>{approvedCount}</span>
              <span className={styles.scoreboardLabel}>Approved</span>
            </div>
          </div>

          {/* Work queue layout */}
          {actualsLoading ? (
            <div className={styles.workQueueLayout}>
              <div className={styles.workQueueLeft}>
                <Skeleton style={{ height: 32, marginBottom: 16 }}><SkeletonItem /></Skeleton>
                <Skeleton style={{ height: 300 }}><SkeletonItem /></Skeleton>
              </div>
              <div className={styles.workQueueDetails}>
                <Skeleton style={{ height: 200 }}><SkeletonItem /></Skeleton>
              </div>
            </div>
          ) : (
            <div className={styles.workQueueLayout}>
              <div className={styles.workQueueLeft}>
                <Input
                  className={styles.workQueueSearch}
                  placeholder="Search cost centers..."
                  value={actualsCcSearch}
                  onChange={(_, d) => setActualsCcSearch(d.value)}
                />
                <div style={{ display: 'flex', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' }}>
                  {(['fte', 'name', 'pending'] as const).map(key => (
                    <Button
                      key={key}
                      size="small"
                      appearance={actualsCcSort === key ? 'primary' : 'subtle'}
                      onClick={() => {
                        setActualsCcSort(key);
                        setActualsCcSortDir(prev => (actualsCcSort === key && prev === 'desc' ? 'asc' : 'desc'));
                      }}
                    >
                      {key === 'fte' ? 'FTE' : key === 'name' ? 'Name' : 'Pending'}
                    </Button>
                  ))}
                </div>
                <div className={styles.workQueueList}>
                  <div
                    className={`${styles.workQueueRow} ${actualsQueueCostCenterId === null ? styles.workQueueRowSelected : ''}`}
                    onClick={() => setActualsQueueCostCenterId(null)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && setActualsQueueCostCenterId(null)}
                  >
                    <Body1 style={{ fontWeight: tokens.fontWeightSemibold }}>All cost centers</Body1>
                    <div style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                      {totalActualsFte}% FTE · {totalActualsLines} lines
                    </div>
                  </div>
                  {(() => {
                    const filtered = actualsCcSearch.trim()
                      ? actualsCcList.filter(cc =>
                          cc.cost_center_name.toLowerCase().includes(actualsCcSearch.toLowerCase()))
                      : actualsCcList;
                    const sorted = [...filtered].sort((a, b) => {
                      const dir = actualsCcSortDir === 'asc' ? 1 : -1;
                      switch (actualsCcSort) {
                        case 'name':
                          return a.cost_center_name.localeCompare(b.cost_center_name) * dir;
                        case 'fte':
                          return (a.totalFte - b.totalFte) * dir;
                        case 'pending':
                          return (a.pendingCount - b.pendingCount) * dir;
                        default:
                          return 0;
                      }
                    });
                    return sorted.map(cc => (
                      <div
                        key={cc.cost_center_id}
                        className={`${styles.workQueueRow} ${actualsQueueCostCenterId === cc.cost_center_id ? styles.workQueueRowSelected : ''}`}
                        onClick={() => setActualsQueueCostCenterId(cc.cost_center_id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => e.key === 'Enter' && setActualsQueueCostCenterId(cc.cost_center_id)}
                      >
                        <div>
                          <Body1 style={{ fontWeight: tokens.fontWeightSemibold }}>{cc.cost_center_name}</Body1>
                          <div style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                            {cc.totalFte}% FTE · {cc.lineCount} lines
                          </div>
                        </div>
                        {cc.pendingCount > 0 && (
                          <Badge appearance="outline" color="warning" size="small">{cc.pendingCount} pending</Badge>
                        )}
                      </div>
                    ));
                  })()}
                </div>
                {actualsCcList.length === 0 && !actualsLoading && (
                  <Body1 style={{ color: tokens.colorNeutralForeground3, padding: tokens.spacingVerticalM }}>
                    No actuals for this period.
                  </Body1>
                )}
              </div>
              <div className={styles.workQueueDetails}>
                <Card className={styles.card}>
                  <CardHeader header={<Body1><strong>Employee actuals</strong></Body1>} />
                  {sortedActuals.length === 0 ? (
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

              </div>
            </div>
          )}

          {/* Full-width chart section below work queue - always visible */}
          {canSeeStats && activeTab === 'actuals' && (() => {
            const chartReady = !!(chartPeriod || periodFromActuals) && !periodsLoading;
            return (
              <Card className={styles.card} style={{ marginTop: tokens.spacingVerticalL, minHeight: 360 }}>
                <CardHeader header={<Body1><strong>Actuals vs Demand by Employee</strong></Body1>} />
                {!chartReady ? (
                  <LoadingState message="Loading period..." />
                ) : empStatsLoading ? (
                  <LoadingState message="Loading employee stats..." />
                ) : empStatsError ? (
                  <MessageBar intent="error"><MessageBarBody>{empStatsError}</MessageBarBody></MessageBar>
                ) : empStats && empStats.length > 0 ? (
                  <div style={{ width: '100%', minHeight: 320 }}>
                    <DemandVsActualsBarChart data={empStats} height={320} />
                  </div>
                ) : (
                  <MessageBar intent="info" style={{ marginTop: tokens.spacingVerticalM }}>
                    <MessageBarBody>No employee demand or actuals for this period. Select a period with planning and actuals data.</MessageBarBody>
                  </MessageBar>
                )}
              </Card>
            );
          })()}
        </>
      )}

      {/* ═══════════════ Snapshots Tab ═══════════════ */}
      {activeTab === 'snapshots' && (
        <>
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
                    <TableHeaderCell>Published By</TableHeaderCell>
                    <TableHeaderCell>Actions</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshots.map(snapshot => (
                    <TableRow key={snapshot.id}>
                      <TableCell><strong>{snapshot.name}</strong></TableCell>
                      <TableCell>{snapshot.description || '-'}</TableCell>
                      <TableCell>{snapshot.lines_count}</TableCell>
                      <TableCell>{new Date(snapshot.published_at).toLocaleString()}</TableCell>
                      <TableCell>{snapshot.published_by}</TableCell>
                      <TableCell>
                        <Button
                          size="small"
                          appearance="subtle"
                          onClick={async () => {
                            try {
                              const detail = await consolidationApi.getSnapshot(snapshot.id);
                              setViewedSnapshot(detail);
                            } catch (err) {
                              showApiError(err as Error, 'Failed to load snapshot');
                            }
                          }}
                        >
                          View
                        </Button>
                        {canDownloadCsv && (
                          <Button
                            size="small"
                            appearance="subtle"
                            disabled={downloadingSnapshotId === snapshot.id}
                            onClick={async () => {
                              setDownloadingSnapshotId(snapshot.id);
                              try {
                                await consolidationApi.downloadSnapshotCsv(snapshot.id);
                              } catch (err) {
                                showApiError(err as Error, 'Failed to download snapshot');
                              } finally {
                                setDownloadingSnapshotId(null);
                              }
                            }}
                          >
                            {downloadingSnapshotId === snapshot.id ? 'Downloading...' : 'Download CSV'}
                          </Button>
                        )}
                      </TableCell>
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

          {/* View Snapshot Dialog */}
          <Dialog open={!!viewedSnapshot} onOpenChange={(_, d) => !d.open && setViewedSnapshot(null)}>
            <DialogSurface style={{ maxWidth: 720 }}>
              <DialogBody>
                <DialogTitle>{viewedSnapshot?.name ?? 'Snapshot'}</DialogTitle>
                <DialogContent>
                  {viewedSnapshot && (
                    <>
                      <Body2 style={{ marginBottom: tokens.spacingVerticalM, color: tokens.colorNeutralForeground3 }}>
                        {viewedSnapshot.description || 'No description'} · {viewedSnapshot.lines_count} lines · {new Date(viewedSnapshot.published_at).toLocaleString()}
                      </Body2>
                      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                        <Table className={styles.table}>
                          <TableHeader>
                            <TableRow>
                              <TableHeaderCell>Type</TableHeaderCell>
                              <TableHeaderCell>Project</TableHeaderCell>
                              <TableHeaderCell>Resource</TableHeaderCell>
                              <TableHeaderCell>Period</TableHeaderCell>
                              <TableHeaderCell>FTE %</TableHeaderCell>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {viewedSnapshot.lines.slice(0, 100).map((line, i) => (
                              <TableRow key={i}>
                                <TableCell>{line.line_type}</TableCell>
                                <TableCell>{line.project_name || '-'}</TableCell>
                                <TableCell>{line.resource_name || line.placeholder_name || '-'}</TableCell>
                                <TableCell>{line.year}-{String(line.month).padStart(2, '0')}</TableCell>
                                <TableCell>{line.fte_percent ?? '-'}%</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {viewedSnapshot.lines.length > 100 && (
                          <Body2 style={{ marginTop: tokens.spacingVerticalS, color: tokens.colorNeutralForeground3 }}>
                            Showing first 100 of {viewedSnapshot.lines.length} lines.
                          </Body2>
                        )}
                      </div>
                    </>
                  )}
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setViewedSnapshot(null)}>Close</Button>
                </DialogActions>
              </DialogBody>
            </DialogSurface>
          </Dialog>
        </>
      )}

      {/* ═══════════════ Cost Report Tab ═══════════════ */}
      {activeTab === 'costreport' && canSeeCostReport && (
        <>
          {/* Cost override toolbar */}
          <div className={styles.costToolbar}>
            <span className={styles.toolbarLabel}>Monthly FTE Cost (DKK)</span>
            <Input
              type="number"
              value={costOverrideInput}
              onChange={(_, d) => setCostOverrideInput(d.value)}
              style={{ width: 140 }}
              disabled={costOverrideSaving}
            />
            <Button
              appearance="primary"
              onClick={handleCostSave}
              disabled={costOverrideSaving}
            >
              {costOverrideSaving ? 'Saving...' : 'Apply'}
            </Button>
            <Body2 style={{ color: tokens.colorNeutralForeground3 }}>
              Current: {formatDKK(monthlyFteCost)}
            </Body2>
          </div>

          {/* Cost table */}
          {actualsLoading ? (
            <div className={styles.loading}><Spinner size="medium" label="Loading actuals..." /></div>
          ) : costRows.length === 0 ? (
            <EmptyState
              icon={<MoneyRegular style={{ fontSize: 48 }} />}
              title="No actuals data"
              message="No actuals found for this period. Select a different period or adjust filters."
            />
          ) : (
            <Card className={styles.card}>
              <Table className={styles.sortableTable}>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Employee</TableHeaderCell>
                    <TableHeaderCell>Project</TableHeaderCell>
                    <TableHeaderCell>Month</TableHeaderCell>
                    <TableHeaderCell>Actual %</TableHeaderCell>
                    <TableHeaderCell>Monthly FTE Cost</TableHeaderCell>
                    <TableHeaderCell>Cost (DKK)</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costByProject.map(g => (
                    <React.Fragment key={g.name}>
                      {g.rows.map(r => (
                        <TableRow key={r.actual_id}>
                          <TableCell>{r.employee_name}</TableCell>
                          <TableCell>{r.project_name}</TableCell>
                          <TableCell>{r.year}-{String(r.month).padStart(2, '0')}</TableCell>
                          <TableCell>
                            <Badge appearance="filled" color="informative">{r.fte_percent}%</Badge>
                          </TableCell>
                          <TableCell>{formatDKK(monthlyFteCost)}</TableCell>
                          <TableCell><strong>{formatDKK(r.cost)}</strong></TableCell>
                        </TableRow>
                      ))}
                      <TableRow className={styles.subtotalRow}>
                        <TableCell>Project total: {g.name}</TableCell>
                        <TableCell />
                        <TableCell />
                        <TableCell />
                        <TableCell />
                        <TableCell>{formatDKK(g.total)}</TableCell>
                      </TableRow>
                    </React.Fragment>
                  ))}
                  <TableRow className={styles.grandTotalRow}>
                    <TableCell>Grand Total</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell>{formatDKK(grandTotal)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default Finance;
