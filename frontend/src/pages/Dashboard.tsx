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
} from '@fluentui/react-components';
import {
  BuildingRegular,
  ShieldCheckmarkRegular,
  FullScreenMaximizeRegular,
} from '@fluentui/react-icons';
import { useAuth } from '../auth/AuthProvider';
import { apiClient } from '../api/client';
import { HealthResponse } from '../types';
import { planningApi } from '../api/planning';
import { usePeriod } from '../contexts/PeriodContext';
import { BreakdownChart, BreakdownRow } from '../components/BreakdownChart';

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
  const { selectedPeriodId, selectedPeriod: ctxPeriod, loading: periodsLoading } = usePeriod();

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [demandLines, setDemandLines] = useState<any[]>([]);
  const [supplyLines, setSupplyLines] = useState<any[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  type ChartModalKey = 'dept' | 'project' | 'supply' | null;
  const [chartModalOpen, setChartModalOpen] = useState<ChartModalKey>(null);

  const isAdmin = user?.role === 'Admin';

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

  /* ── Load data ── */

  useEffect(() => {
    loadMiscData();
  }, []);

  // Load chart data for ALL roles whenever the period changes
  useEffect(() => {
    if (selectedPeriodId) {
      loadChartData(selectedPeriodId);
    }
  }, [selectedPeriodId]);

  const loadMiscData = async () => {
    try {
      setLoading(true);
      const healthData = await apiClient.getHealth().catch(() => null);
      setHealth(healthData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadChartData = async (periodId: string) => {
    if (!periodId) return;
    try {
      setChartLoading(true);
      const [demands, supplies] = await Promise.all([
        planningApi.getDemandLines(periodId).catch(() => []),
        planningApi.getSupplyLines(periodId).catch(() => []),
      ]);
      setDemandLines(demands || []);
      setSupplyLines(supplies || []);
    } catch (error) {
      console.error('[Dashboard] Failed to load chart data:', error);
    } finally {
      setChartLoading(false);
    }
  };

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
          <Card className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Total Demand</div>
            <div className={styles.kpiValue}>{totalDemand.toFixed(0)}%</div>
            <div className={styles.kpiMeta}>{(demandLines || []).length} lines</div>
          </Card>
          <Card className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Total Supply</div>
            <div className={styles.kpiValue}>{totalSupply.toFixed(0)}%</div>
            <div className={styles.kpiMeta}>{(supplyLines || []).length} lines</div>
          </Card>
          <Card
            className={styles.kpiCard}
            style={{
              borderLeft: `4px solid ${gap < 0 ? tokens.colorPaletteRedBorderActive : gap > 0 ? tokens.colorPaletteGreenBorderActive : tokens.colorNeutralStroke2}`,
            }}
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
          </Card>

          {/* Utilization KPI */}
          <Card
            className={styles.kpiCard}
            style={{
              borderLeft: `4px solid ${utilizationColor}`,
            }}
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
          </Card>
        </div>
      </div>

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
