/**
 * Role-based Dashboard
 * All roles see KPI stats + breakdown charts.
 * Admin additionally sees System panels at the bottom.
 */
import { useEffect, useState, useMemo } from 'react';
import {
  makeStyles,
  tokens,
  Title3,
  Badge,
  Body1,
  Card,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
  Skeleton,
  SkeletonItem,
  Button,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  mergeClasses,
} from '@fluentui/react-components';
import {
  BuildingRegular,
  ShieldCheckmarkRegular,
  FullScreenMaximizeRegular,
  Info24Regular,
} from '@fluentui/react-icons';
import { useAuth } from '../auth/AuthProvider';
import { apiClient } from '../api/client';
import { HealthResponse } from '../types';
import { planningApi } from '../api/planning';
import { dashboardApi, DemandSupplyByCostCenter, DemandSupplyByProject } from '../api/dashboard';
import { usePeriod } from '../contexts/PeriodContext';
import { BreakdownChart, BreakdownRow } from '../components/BreakdownChart';
import { periodsApi } from '../api/periods';
import { lookupsApi } from '../api/lookups';
import type { Period } from '../types';
import type { CostCenter, Project } from '../api/admin';
import { GroupedBarChart } from '../components/GroupedBarChart';

/* ─── Styles ────────────────────────────────────────────────────── */

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    maxWidth: '1400px',
    margin: '0 auto',
  },
  pageHeader: {
    marginBottom: tokens.spacingVerticalXS,
  },
  pageTitle: {
    fontSize: tokens.fontSizeHero800,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
    margin: 0,
    lineHeight: '1.2',
  },
  pageSubtitle: {
    fontSize: tokens.fontSizeBase400,
    color: tokens.colorNeutralForeground3,
    marginTop: tokens.spacingVerticalXXS,
  },

  /* ── Section separators ── */
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    paddingTop: tokens.spacingVerticalM,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  sectionTitle: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },

  /* ── KPI row (5 columns) ── */
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: tokens.spacingHorizontalM,
  },
  kpiCard: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
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
  kpiMeta: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    marginTop: tokens.spacingVerticalXXS,
  },
  kpiCardClickable: {
    cursor: 'pointer',
    transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
    '&:hover': {
      boxShadow: tokens.shadow8,
    },
    '&:focus-visible': {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '2px',
    },
  },
  kpiCardViewDetails: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalS,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorBrandForeground1,
  },
  kpiDetailTableWrap: {
    maxHeight: '320px',
    overflow: 'auto',
    marginTop: tokens.spacingVerticalM,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  kpiDetailDefinition: {
    marginBottom: tokens.spacingVerticalS,
    color: tokens.colorNeutralForeground2,
  },
  kpiDetailFormula: {
    marginBottom: tokens.spacingVerticalM,
    fontFamily: 'monospace',
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground3,
  },
  kpiDetailPeriod: {
    marginBottom: tokens.spacingVerticalM,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  kpiDetailSummaryRow: {
    fontWeight: tokens.fontWeightSemibold,
    backgroundColor: tokens.colorNeutralBackground3,
  },

  /* ── Charts ── */
  chartCard: {
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow4,
    overflow: 'hidden',
  },
  chartCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  chartCardBody: {
    padding: tokens.spacingHorizontalL,
  },
  chartCardHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    gap: tokens.spacingHorizontalM,
  },
  chartModalSurface: {
    maxWidth: '90vw',
    width: '90vw',
    height: '80vh',
  },
  chartModalBody: {
    overflow: 'auto',
    padding: tokens.spacingHorizontalL,
  },
  chartsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
    gap: tokens.spacingHorizontalL,
  },

  /* ── Admin ── */
  adminSection: {
    marginTop: tokens.spacingVerticalXS,
  },
  adminCard: {
    padding: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalM,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow2,
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

  /* ── Skeletons ── */
  skeletonKpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalL,
  },
  skeletonCard: {
    height: '88px',
    borderRadius: '12px',
  },
  skeletonChart: {
    height: '320px',
    borderRadius: '12px',
    marginBottom: tokens.spacingVerticalL,
  },
});

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/* ─── Component ─────────────────────────────────────────────────── */

export function Dashboard() {
  const styles = useStyles();
  const { user } = useAuth();
  const { selectedPeriodId, selectedPeriod: ctxPeriod, loading: periodsLoading, periods } = usePeriod();

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [demandLines, setDemandLines] = useState<any[]>([]);
  const [supplyLines, setSupplyLines] = useState<any[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [aggLoading, setAggLoading] = useState(false);
  const [aggByCostCenter, setAggByCostCenter] = useState<DemandSupplyByCostCenter[]>([]);
  const [aggByProject, setAggByProject] = useState<DemandSupplyByProject[]>([]);
  type ChartModalKey = 'dept' | 'project' | 'supply' | null;
  const [chartModalOpen, setChartModalOpen] = useState<ChartModalKey>(null);
  type KpiDetailModalKey = 'demand' | 'supply' | 'gap' | 'utilization' | null;
  const [kpiDetailModal, setKpiDetailModal] = useState<KpiDetailModalKey>(null);

  // Filter state
  const [periodOptions, setPeriodOptions] = useState<Period[]>([]);
  const [costCenterOptions, setCostCenterOptions] = useState<CostCenter[]>([]);
  const [projectOptions, setProjectOptions] = useState<Project[]>([]);
  const [selectedPeriodIds, setSelectedPeriodIds] = useState<string[]>([]);
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const isAdmin = user?.role === 'Admin';

  // Load aggregated demand/supply data for grouped bar charts
  useEffect(() => {
    setAggLoading(true);
    dashboardApi.getDemandSupplyAggregation()
      .then(({ by_project, by_cost_center }) => {
        setAggByProject(by_project);
        setAggByCostCenter(by_cost_center);
      })
      .catch(() => {
        setAggByProject([]);
        setAggByCostCenter([]);
      })
      .finally(() => setAggLoading(false));
  }, []); // Add dependencies if you want to reload on filter change

  // Load demand and supply lines for the selected period
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // Use planningApi to fetch demand and supply lines for the selected period
        const [demand, supply] = await Promise.all([
          planningApi.getDemandLines(selectedPeriodId),
          planningApi.getSupplyLines(selectedPeriodId),
        ]);
        setDemandLines(demand);
        setSupplyLines(supply);
      } catch (e) {
        setDemandLines([]);
        setSupplyLines([]);
      } finally {
        setLoading(false);
      }
    }
    if (selectedPeriodId) {
      fetchData();
    }
  }, [selectedPeriodId]);

  // Sync periodOptions with periods from context
  useEffect(() => {
    setPeriodOptions(periods);
  }, [periods]);

  const handleKpiCardKeyDown = (e: React.KeyboardEvent, key: KpiDetailModalKey) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setKpiDetailModal(key);
    }
  };

  /* ── KPI computed values ── */
  const totalDemand = useMemo(
    () => (demandLines || []).reduce((s: number, l: any) => s + (l?.fte_percent || 0), 0),
    [demandLines],
  );
  const totalSupply = useMemo(
    () => (supplyLines || []).reduce((s: number, l: any) => s + (l?.fte_percent || 0), 0),
    [supplyLines],
  );
  const gap = totalSupply - totalDemand;
  const utilization = totalSupply > 0 ? Math.round((totalDemand / totalSupply) * 100) : 0;
  const utilizationColor =
    utilization > 120
      ? tokens.colorPaletteRedForeground1
      : utilization > 100
        ? tokens.colorPaletteYellowForeground2
        : utilization >= 70
          ? tokens.colorPaletteGreenForeground1
          : tokens.colorNeutralForeground3;

  /* ── Breakdown data ── */

  const deptBreakdown: BreakdownRow[] = useMemo(() => {
    const deptMap = new Map<string, { demand: number; supply: number }>();
    for (const d of demandLines || []) {
      const name = d.department_name || 'Unassigned';
      const cur = deptMap.get(name) || { demand: 0, supply: 0 };
      cur.demand += d.fte_percent || 0;
      deptMap.set(name, cur);
    }
    for (const s of supplyLines || []) {
      const name = s.department_name || 'Unassigned';
      const cur = deptMap.get(name) || { demand: 0, supply: 0 };
      cur.supply += s.fte_percent || 0;
      deptMap.set(name, cur);
    }
    return Array.from(deptMap.entries())
      .map(([label, v]) => ({ label, demandFte: v.demand, supplyFte: v.supply }))
      .sort((a, b) => b.demandFte - a.demandFte);
  }, [demandLines, supplyLines]);

  const projectBreakdown: BreakdownRow[] = useMemo(() => {
    const projMap = new Map<string, number>();
    for (const d of demandLines || []) {
      const name = d.project_name || 'Unknown';
      projMap.set(name, (projMap.get(name) || 0) + (d.fte_percent || 0));
    }
    return Array.from(projMap.entries())
      .map(([label, fte]) => ({ label, demandFte: fte, supplyFte: 0 }))
      .sort((a, b) => b.demandFte - a.demandFte);
  }, [demandLines]);

  const supplyByDept: BreakdownRow[] = useMemo(() => {
    const deptMap = new Map<string, number>();
    for (const s of supplyLines || []) {
      const name = s.department_name || 'Unassigned';
      deptMap.set(name, (deptMap.get(name) || 0) + (s.fte_percent || 0));
    }
    return Array.from(deptMap.entries())
      .map(([label, fte]) => ({ label, demandFte: 0, supplyFte: fte }))
      .sort((a, b) => b.supplyFte - a.supplyFte);
  }, [supplyLines]);

  // Build chart data: group by period, columns for each project's demand/supply
  const chartData = useMemo(() => {
    if (!aggByProject.length) return [];
    // Get all unique periods and projects
    const periodMap = new Map<string, { year: number; month: number }>();
    const projectMap = new Map<string, string>();
    aggByProject.forEach(row => {
      periodMap.set(`${row.year}-${row.month}`, { year: row.year, month: row.month });
      projectMap.set(row.project_id, row.project_name || row.project_id);
    });
    // Build a row for each period
    const data: any[] = Array.from(periodMap.entries()).map(([key, { year, month }]) => {
      const row: any = { label: `${monthNames[month - 1]} ${year}` };
      projectMap.forEach((projectName, projectId) => {
        // Find the matching agg row
        const agg = aggByProject.find(r => r.year === year && r.month === month && r.project_id === projectId);
        row[`${projectName}_demand`] = agg ? agg.demand_fte : 0;
        row[`${projectName}_supply`] = agg ? agg.supply_fte : 0;
      });
      return row;
    });
    return data;
  }, [aggByProject, monthNames]);

  // Build keys and legend map for all projects
  const projectNames = useMemo(() => {
    const names = new Set<string>();
    aggByProject.forEach(row => names.add(row.project_name || row.project_id));
    return Array.from(names);
  }, [aggByProject]);

  const demandKeys = useMemo(() => projectNames.map(name => `${name}_demand`), [projectNames]);
  const supplyKeys = useMemo(() => projectNames.map(name => `${name}_supply`), [projectNames]);

  const legendMap: Record<string, string> = {};
  projectNames.forEach((name) => {
    legendMap[`${name}_demand`] = `${name} Demand`;
    legendMap[`${name}_supply`] = `${name} Supply`;
  });

  // Build chart data: group by period, columns for each department's demand/supply
  const deptChartData = useMemo(() => {
    if (!aggByCostCenter.length) return [];
    // Get all unique periods and departments
    const periodMap = new Map<string, { year: number; month: number }>();
    const deptMap = new Map<string, string>();
    aggByCostCenter.forEach(row => {
      periodMap.set(`${row.year}-${row.month}`, { year: row.year, month: row.month });
      deptMap.set(row.cost_center_id, row.cost_center_name || row.cost_center_id);
    });
    // Build a row for each period
    const data: any[] = Array.from(periodMap.entries()).map(([key, { year, month }]) => {
      const row: any = { label: `${monthNames[month - 1]} ${year}` };
      deptMap.forEach((deptName, deptId) => {
        // Find the matching agg row
        const agg = aggByCostCenter.find(r => r.year === year && r.month === month && r.cost_center_id === deptId);
        row[`${deptName}_demand`] = agg ? agg.demand_fte : 0;
        row[`${deptName}_supply`] = agg ? agg.supply_fte : 0;
      });
      return row;
    });
    return data;
  }, [aggByCostCenter, monthNames]);

  // Build keys and legend map for all departments
  const deptNames = useMemo(() => {
    const names = new Set<string>();
    aggByCostCenter.forEach(row => names.add(row.cost_center_name || row.cost_center_id));
    return Array.from(names);
  }, [aggByCostCenter]);

  const deptDemandKeys = useMemo(() => deptNames.map(name => `${name}_demand`), [deptNames]);
  const deptSupplyKeys = useMemo(() => deptNames.map(name => `${name}_supply`), [deptNames]);

  const deptLegendMap: Record<string, string> = {};
  deptNames.forEach((name) => {
    deptLegendMap[`${name}_demand`] = `${name} Demand`;
    deptLegendMap[`${name}_supply`] = `${name} Supply`;
  });

  /* ── Loading skeleton ── */

  if (loading || periodsLoading) {
    return (
      <div className={styles.container}>
        <Skeleton style={{ height: 48, marginBottom: 24, width: '40%' }}>
          <SkeletonItem />
        </Skeleton>
        <div className={styles.skeletonKpiRow}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className={styles.skeletonCard}>
              <SkeletonItem />
            </Skeleton>
          ))}
        </div>
        <Skeleton className={styles.skeletonChart}>
          <SkeletonItem />
        </Skeleton>
      </div>
    );
  }

  if (!loading && !periodsLoading && periodOptions.length === 0) {
    return (
      <div className={styles.container}>
        <div style={{ margin: '80px auto', textAlign: 'center', color: tokens.colorPaletteRedForeground1 }}>
          <Title3>No periods available</Title3>
          <p>There are no open periods configured in the system. Please contact your administrator.</p>
        </div>
      </div>
    );
  }

  const currentPeriodLabel = ctxPeriod
    ? `${monthNames[ctxPeriod.month - 1]} ${ctxPeriod.year}`
    : 'No period';

  /* ── Render ── */

  return (
    <div className={styles.container}>
      {/* ── Page header ── */}
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Welcome, {user?.display_name}</h1>
        <p className={styles.pageSubtitle}>
          {user?.role} &middot; {user?.tenant_id}
        </p>
      </div>

      {/* ── KPI Stats (all roles) ── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Key Metrics</div>
        <div className={styles.kpiRow}>
          <Card className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Active Period</div>
            <div className={styles.kpiValue}>{currentPeriodLabel}</div>
            {ctxPeriod && (
              <div className={styles.kpiMeta}>
                <Badge
                  appearance="filled"
                  color={
                    ctxPeriod.status === 'open'
                      ? 'success'
                      : ctxPeriod.status === 'locked'
                        ? 'danger'
                        : 'informative'
                  }
                  size="small"
                >
                  {ctxPeriod.status}
                </Badge>
              </div>
            )}
          </Card>
          <Card
            className={mergeClasses(styles.kpiCard, styles.kpiCardClickable)}
            role="button"
            tabIndex={0}
            onClick={() => setKpiDetailModal('demand')}
            onKeyDown={(e) => handleKpiCardKeyDown(e, 'demand')}
          >
            <div className={styles.kpiLabel}>Total Demand</div>
            <div className={styles.kpiValue}>{totalDemand.toFixed(0)}%</div>
            <div className={styles.kpiMeta}>{(demandLines || []).length} lines</div>
            <div className={styles.kpiCardViewDetails}>
              <Info24Regular /> View details
            </div>
          </Card>
          <Card
            className={mergeClasses(styles.kpiCard, styles.kpiCardClickable)}
            role="button"
            tabIndex={0}
            onClick={() => setKpiDetailModal('supply')}
            onKeyDown={(e) => handleKpiCardKeyDown(e, 'supply')}
          >
            <div className={styles.kpiLabel}>Total Supply</div>
            <div className={styles.kpiValue}>{totalSupply.toFixed(0)}%</div>
            <div className={styles.kpiMeta}>{(supplyLines || []).length} lines</div>
            <div className={styles.kpiCardViewDetails}>
              <Info24Regular /> View details
            </div>
          </Card>
          <Card
            className={styles.kpiCard}
            style={{
              borderLeft: `4px solid ${gap < 0 ? tokens.colorPaletteRedBorderActive : gap > 0 ? tokens.colorPaletteGreenBorderActive : tokens.colorNeutralStroke2}`,
            }}
            role="button"
            tabIndex={0}
            onClick={() => setKpiDetailModal('gap')}
            onKeyDown={(e) => handleKpiCardKeyDown(e, 'gap')}
          >
            <div className={styles.kpiLabel}>Gap</div>
            <div
              className={styles.kpiValue}
              style={{
                color:
                  gap < 0
                    ? tokens.colorPaletteRedForeground1
                    : gap > 0
                      ? tokens.colorPaletteGreenForeground1
                      : tokens.colorNeutralForeground1,
              }}
            >
              {gap >= 0 ? '+' : ''}
              {gap.toFixed(0)}%
            </div>
            <div className={styles.kpiMeta}>Supply &minus; Demand</div>
            <div className={styles.kpiCardViewDetails}>
              <Info24Regular /> View details
            </div>
          </Card>

          {/* Utilization KPI */}
          <Card
            className={mergeClasses(styles.kpiCard, styles.kpiCardClickable)}
            style={{
              borderLeft: `4px solid ${utilizationColor}`,
            }}
            role="button"
            tabIndex={0}
            onClick={() => setKpiDetailModal('utilization')}
            onKeyDown={(e) => handleKpiCardKeyDown(e, 'utilization')}
          >
            <div className={styles.kpiLabel}>Utilization</div>
            <div className={styles.kpiValue} style={{ color: utilizationColor }}>
              {totalSupply > 0 ? `${utilization}%` : '—'}
            </div>
            <div className={styles.kpiMeta}>
              {utilization > 120
                ? 'Over-committed'
                : utilization > 100
                  ? 'Slightly over'
                  : utilization >= 70
                    ? 'Healthy'
                    : totalSupply > 0
                      ? 'Under-utilized'
                      : 'No supply data'}
            </div>
            <div className={styles.kpiCardViewDetails}>
              <Info24Regular /> View details
            </div>
          </Card>
        </div>
      </div>

      {/* ── KPI Detail Modal ── */}
      <Dialog open={kpiDetailModal !== null} onOpenChange={(_, data) => !data.open && setKpiDetailModal(null)}>
        <DialogSurface style={{ maxWidth: '560px' }}>
          <DialogBody>
            <DialogTitle>
              {kpiDetailModal === 'demand' && 'Total Demand'}
              {kpiDetailModal === 'supply' && 'Total Supply'}
              {kpiDetailModal === 'gap' && 'Gap'}
              {kpiDetailModal === 'utilization' && 'Utilization'}
            </DialogTitle>
            <DialogContent>
              <div className={styles.kpiDetailPeriod}>
                For period: {currentPeriodLabel}
              </div>

              {kpiDetailModal === 'demand' && (
                <>
                  <Body1 className={styles.kpiDetailDefinition}>
                    Total FTE % requested for the selected period across all demand lines (project allocations).
                  </Body1>
                  <div className={styles.kpiDetailFormula}>Formula: Sum of all demand line FTE %.</div>
                  <div className={styles.kpiDetailTableWrap}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHeaderCell>Project</TableHeaderCell>
                          <TableHeaderCell>Resource / Placeholder</TableHeaderCell>
                          <TableHeaderCell>Department</TableHeaderCell>
                          <TableHeaderCell>FTE %</TableHeaderCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(demandLines || []).map((d: any) => (
                          <TableRow key={d.id}>
                            <TableCell>{d.project_name || 'Unknown'}</TableCell>
                            <TableCell>{d.resource_name || d.placeholder_name || '—'}</TableCell>
                            <TableCell>{d.department_name || 'Unassigned'}</TableCell>
                            <TableCell>{d.fte_percent ?? 0}%</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className={styles.kpiDetailSummaryRow}>
                          <TableCell colSpan={3}>Total</TableCell>
                          <TableCell>{totalDemand.toFixed(0)}%</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}

              {kpiDetailModal === 'supply' && (
                <>
                  <Body1 className={styles.kpiDetailDefinition}>
                    Total FTE % available for the selected period across all supply lines (resource capacity).
                  </Body1>
                  <div className={styles.kpiDetailFormula}>Formula: Sum of all supply line FTE %.</div>
                  <div className={styles.kpiDetailTableWrap}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHeaderCell>Resource</TableHeaderCell>
                          <TableHeaderCell>Department</TableHeaderCell>
                          <TableHeaderCell>Project</TableHeaderCell>
                          <TableHeaderCell>FTE %</TableHeaderCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(supplyLines || []).map((s: any) => (
                          <TableRow key={s.id}>
                            <TableCell>{s.resource_name || 'Unknown'}</TableCell>
                            <TableCell>{s.department_name || 'Unassigned'}</TableCell>
                            <TableCell>{s.project_name || '—'}</TableCell>
                            <TableCell>{s.fte_percent ?? 0}%</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className={styles.kpiDetailSummaryRow}>
                          <TableCell colSpan={3}>Total</TableCell>
                          <TableCell>{totalSupply.toFixed(0)}%</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}

              {kpiDetailModal === 'gap' && (
                <>
                  <Body1 className={styles.kpiDetailDefinition}>
                    Difference between available capacity (Supply) and requested allocation (Demand).
                  </Body1>
                  <div className={styles.kpiDetailFormula}>
                    Gap = Total Supply − Total Demand. Positive = surplus capacity; negative = over-committed.
                  </div>
                  <Table>
                    <TableBody>
                      <TableRow>
                        <TableCell>Total Demand</TableCell>
                        <TableCell>{totalDemand.toFixed(0)}%</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Total Supply</TableCell>
                        <TableCell>{totalSupply.toFixed(0)}%</TableCell>
                      </TableRow>
                      <TableRow className={styles.kpiDetailSummaryRow}>
                        <TableCell>Gap (Supply − Demand)</TableCell>
                        <TableCell style={{ color: gap < 0 ? tokens.colorPaletteRedForeground1 : gap > 0 ? tokens.colorPaletteGreenForeground1 : undefined }}>
                          {gap >= 0 ? '+' : ''}{gap.toFixed(0)}%
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </>
              )}

              {kpiDetailModal === 'utilization' && (
                <>
                  <Body1 className={styles.kpiDetailDefinition}>
                    Share of available capacity that is allocated to demand (Demand / Supply).
                  </Body1>
                  <div className={styles.kpiDetailFormula}>
                    Utilization = (Total Demand ÷ Total Supply) × 100%. Over 100% means over-committed.
                  </div>
                  <Table>
                    <TableBody>
                      <TableRow>
                        <TableCell>Total Demand</TableCell>
                        <TableCell>{totalDemand.toFixed(0)}%</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Total Supply</TableCell>
                        <TableCell>{totalSupply.toFixed(0)}%</TableCell>
                      </TableRow>
                      <TableRow className={styles.kpiDetailSummaryRow}>
                        <TableCell>Utilization</TableCell>
                        <TableCell style={{ color: utilizationColor }}>
                          {totalSupply > 0 ? `${utilization}%` : '—'}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  <Body1 className={styles.kpiDetailDefinition} style={{ marginTop: tokens.spacingVerticalM }}>
                    {utilization > 120
                      ? 'Over-committed: demand exceeds supply by more than 20%.'
                      : utilization > 100
                        ? 'Slightly over: demand exceeds supply.'
                        : utilization >= 70
                          ? 'Healthy: most capacity is allocated.'
                          : totalSupply > 0
                            ? 'Under-utilized: significant capacity is not allocated to demand.'
                            : 'No supply data for this period.'}
                  </Body1>
                </>
              )}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setKpiDetailModal(null)}>Close</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* ── Breakdown Charts (all roles) ── */}
      {selectedPeriodId && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Resource Overview</div>
          <div className={styles.chartsGrid}>
            {/* Department breakdown */}
            <Card className={styles.chartCard}>
              <div className={styles.chartCardHeader}>
                <div className={styles.chartCardHeaderRow}>
                  <Title3 style={{ margin: 0 }}>Demand vs Supply by Department</Title3>
                  <Button
                    appearance="subtle"
                    icon={<FullScreenMaximizeRegular />}
                    title="Expand to full view"
                    onClick={() => setChartModalOpen('dept')}
                    disabled={chartLoading}
                  />
                </div>
              </div>
              <div className={styles.chartCardBody}>
                {chartLoading ? (
                  <Skeleton style={{ height: 200 }}>
                    <SkeletonItem />
                  </Skeleton>
                ) : (
                  <BreakdownChart rows={deptBreakdown} maxRows={10} />
                )}
              </div>
            </Card>
            <Dialog open={chartModalOpen === 'dept'} onOpenChange={(_, data) => setChartModalOpen(data.open ? 'dept' : null)}>
              <DialogSurface className={styles.chartModalSurface}>
                <DialogBody>
                  <DialogTitle>Demand vs Supply by Department</DialogTitle>
                  <DialogContent className={styles.chartModalBody}>
                    {!chartLoading && <BreakdownChart rows={deptBreakdown} />}
                  </DialogContent>
                  <DialogActions>
                    <Button appearance="secondary" onClick={() => setChartModalOpen(null)}>Close</Button>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>

            {/* Demand by Project */}
            <Card className={styles.chartCard}>
              <div className={styles.chartCardHeader}>
                <div className={styles.chartCardHeaderRow}>
                  <Title3 style={{ margin: 0 }}>Demand by Project</Title3>
                  <Button
                    appearance="subtle"
                    icon={<FullScreenMaximizeRegular />}
                    title="Expand to full view"
                    onClick={() => setChartModalOpen('project')}
                    disabled={chartLoading}
                  />
                </div>
              </div>
              <div className={styles.chartCardBody}>
                {chartLoading ? (
                  <Skeleton style={{ height: 200 }}>
                    <SkeletonItem />
                  </Skeleton>
                ) : (
                  <BreakdownChart rows={projectBreakdown} demandOnly maxRows={10} />
                )}
              </div>
            </Card>
            <Dialog open={chartModalOpen === 'project'} onOpenChange={(_, data) => setChartModalOpen(data.open ? 'project' : null)}>
              <DialogSurface className={styles.chartModalSurface}>
                <DialogBody>
                  <DialogTitle>Demand by Project</DialogTitle>
                  <DialogContent className={styles.chartModalBody}>
                    {!chartLoading && <BreakdownChart rows={projectBreakdown} demandOnly />}
                  </DialogContent>
                  <DialogActions>
                    <Button appearance="secondary" onClick={() => setChartModalOpen(null)}>Close</Button>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>

            {/* Supply by Department */}
            <Card className={styles.chartCard}>
              <div className={styles.chartCardHeader}>
                <div className={styles.chartCardHeaderRow}>
                  <Title3 style={{ margin: 0 }}>Supply by Department</Title3>
                  <Button
                    appearance="subtle"
                    icon={<FullScreenMaximizeRegular />}
                    title="Expand to full view"
                    onClick={() => setChartModalOpen('supply')}
                    disabled={chartLoading}
                  />
                </div>
              </div>
              <div className={styles.chartCardBody}>
                {chartLoading ? (
                  <Skeleton style={{ height: 200 }}>
                    <SkeletonItem />
                  </Skeleton>
                ) : (
                  <BreakdownChart rows={supplyByDept} supplyOnly maxRows={10} />
                )}
              </div>
            </Card>
            <Dialog open={chartModalOpen === 'supply'} onOpenChange={(_, data) => setChartModalOpen(data.open ? 'supply' : null)}>
              <DialogSurface className={styles.chartModalSurface}>
                <DialogBody>
                  <DialogTitle>Supply by Department</DialogTitle>
                  <DialogContent className={styles.chartModalBody}>
                    {!chartLoading && <BreakdownChart rows={supplyByDept} supplyOnly />}
                  </DialogContent>
                  <DialogActions>
                    <Button appearance="secondary" onClick={() => setChartModalOpen(null)}>Close</Button>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>
          </div>
        </div>
      )}

      {/* ── New Aggregation Charts (all open periods) ── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>All Open Periods: Demand & Supply by Cost Center</div>
        <div className={styles.chartsGrid}>
          <Card className={styles.chartCard}>
            <div className={styles.chartCardHeader}>
              <div className={styles.chartCardHeaderRow}>
                <Title3 style={{ margin: 0 }}>Demand vs Supply by Cost Center (All Open Periods)</Title3>
              </div>
            </div>
            <div className={styles.chartCardBody}>
              {aggLoading ? (
                <Skeleton style={{ height: 200 }}><SkeletonItem /></Skeleton>
              ) : (
                <BreakdownChart
                  rows={aggByCostCenter.map(row => ({
                    label: `${row.cost_center_name || row.cost_center_id} (${monthNames[row.month - 1]} ${row.year})`,
                    demandFte: row.demand_fte,
                    supplyFte: row.supply_fte,
                  }))}
                  maxRows={12}
                />
              )}
            </div>
          </Card>
          <Card className={styles.chartCard}>
            <div className={styles.chartCardHeader}>
              <div className={styles.chartCardHeaderRow}>
                <Title3 style={{ margin: 0 }}>Demand vs Supply by Project (All Open Periods)</Title3>
              </div>
            </div>
            <div className={styles.chartCardBody}>
              {aggLoading ? (
                <Skeleton style={{ height: 200 }}><SkeletonItem /></Skeleton>
              ) : (
                <BreakdownChart
                  rows={aggByProject.map(row => ({
                    label: `${row.project_name || row.project_id} (${monthNames[row.month - 1]} ${row.year})`,
                    demandFte: row.demand_fte,
                    supplyFte: row.supply_fte,
                  }))}
                  maxRows={12}
                />
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ── Grouped Bar Chart ── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Demand & Supply by Project (Filtered)</div>
        <Card className={styles.chartCard}>
          <div className={styles.chartCardHeader}>
            <div className={styles.chartCardHeaderRow}>
              <Title3 style={{ margin: 0 }}>Grouped Bar Chart</Title3>
            </div>
          </div>
          <div className={styles.chartCardBody}>
            {aggLoading ? (
              <Skeleton style={{ height: 320 }}><SkeletonItem /></Skeleton>
            ) : (
              <GroupedBarChart
                data={chartData}
                demandKeys={demandKeys}
                supplyKeys={supplyKeys}
                legendMap={legendMap}
              />
            )}
          </div>
        </Card>
      </div>

      {/* ── Grouped Bar Chart: Departments ── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Demand & Supply by Department (Grouped Bar Chart)</div>
        <Card className={styles.chartCard}>
          <div className={styles.chartCardHeader}>
            <div className={styles.chartCardHeaderRow}>
              <Title3 style={{ margin: 0 }}>Grouped Bar Chart (Departments)</Title3>
            </div>
          </div>
          <div className={styles.chartCardBody}>
            {aggLoading ? (
              <Skeleton style={{ height: 320 }}><SkeletonItem /></Skeleton>
            ) : (
              <GroupedBarChart
                data={deptChartData}
                demandKeys={deptDemandKeys}
                supplyKeys={deptSupplyKeys}
                legendMap={deptLegendMap}
              />
            )}
          </div>
        </Card>
      </div>

      {/* ── Admin-Only System Panels ── */}
      {isAdmin && (
        <div className={styles.adminSection}>
          <Card className={styles.adminCard}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: tokens.spacingHorizontalM,
                marginBottom: tokens.spacingVerticalM,
              }}
            >
              <ShieldCheckmarkRegular style={{ fontSize: 24, color: tokens.colorBrandForeground1 }} />
              <Title3>System Status</Title3>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>API Status</span>
              <Badge
                appearance="filled"
                color={health?.status === 'healthy' ? 'success' : 'danger'}
              >
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
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: tokens.spacingHorizontalM,
                marginBottom: tokens.spacingVerticalM,
              }}
            >
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
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: tokens.spacingHorizontalM,
                    }}
                  >
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
