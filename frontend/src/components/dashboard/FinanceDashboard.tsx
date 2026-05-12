import { useState, useEffect, useMemo } from 'react';
import { makeStyles, tokens, Badge, Spinner } from '@fluentui/react-components';
import { DashboardSection } from './DashboardSection';
import { FinanceOverview } from '../shared/FinanceOverview';
import { getConsolidatedCosts } from '../../api/finance';
import type { ConsolidatedCostResponse } from '../../api/finance';
import { actualsApi } from '../../api/actuals';
import type { ActualLine } from '../../api/actuals';
import { apiClient } from '../../api/client';
import { usePeriod } from '../../contexts/PeriodContext';
import { useToast } from '../../hooks/useToast';
import type { FinanceActualRow } from '../finance/ActualsTab';
import type { DemandLine, SupplyLine } from '../../api/planning';
import type { CostCenter } from '../../api/admin';
import type { Period, MeResponse } from '../../types/index';

// ─── helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtCost(cents: number): string {
  const v = cents / 100;
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

// ─── severity helpers ─────────────────────────────────────────────────────────

type StaffingSev = 'staffed' | 'attention' | 'understaffed';
type BudgetSev   = 'ontrack' | 'caution' | 'over';
type HealthSev   = 'ontrack' | 'atrisk'  | 'critical';

function getStaffingSev(gap: number): StaffingSev {
  if (gap < -20) return 'understaffed';
  if (gap < -0.1) return 'attention';
  return 'staffed';
}

function getBudgetSev(planned: number, actual: number): BudgetSev {
  if (planned <= 0) return 'ontrack';
  if (actual > planned * 1.10) return 'over';
  if (actual > planned * 1.05) return 'caution';
  return 'ontrack';
}

function getHealthSev(staffing: StaffingSev, budget: BudgetSev): HealthSev {
  const staffingBad = staffing === 'understaffed';
  const budgetBad   = budget === 'over';
  if (staffingBad && budgetBad) return 'critical';
  if (staffingBad || budgetBad) return 'atrisk';
  return 'ontrack';
}

const HEALTH_ORDER: Record<HealthSev, number> = { critical: 0, atrisk: 1, ontrack: 2 };

const SEV_FG = {
  good: tokens.colorPaletteGreenForeground2,
  warn: tokens.colorPaletteMarigoldForeground2,
  bad:  tokens.colorPaletteRedForeground2,
};

const SEV_BAR = {
  good: tokens.colorPaletteGreenBackground2,
  warn: tokens.colorPaletteMarigoldBackground2,
  bad:  tokens.colorPaletteRedBackground2,
};

// ─── badge sub-components ─────────────────────────────────────────────────────

function StaffingBadge({ gap }: { gap: number }) {
  const sev = getStaffingSev(gap);
  if (sev === 'understaffed') return <Badge color="danger"  appearance="filled">Understaffed</Badge>;
  if (sev === 'attention')    return <Badge color="warning" appearance="filled">Attention</Badge>;
  return                             <Badge color="success" appearance="filled">Staffed</Badge>;
}

function BudgetBadge({ planned, actual }: { planned: number; actual: number }) {
  const sev = getBudgetSev(planned, actual);
  if (sev === 'over') {
    const pct = planned > 0 ? Math.round(((actual - planned) / planned) * 100) : 0;
    return <Badge color="danger"  appearance="filled">Over +{pct}%</Badge>;
  }
  if (sev === 'caution') {
    const pct = planned > 0 ? Math.round(((actual - planned) / planned) * 100) : 0;
    return <Badge color="warning" appearance="filled">Caution +{pct}%</Badge>;
  }
  return <Badge color="success" appearance="filled">On track</Badge>;
}

function HealthBadge({ health }: { health: HealthSev }) {
  if (health === 'critical') return <Badge color="danger"  appearance="filled">Critical</Badge>;
  if (health === 'atrisk')   return <Badge color="warning" appearance="filled">At Risk</Badge>;
  return                            <Badge color="success" appearance="filled">On Track</Badge>;
}

// ─── styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },

  // KPI strip — 6 columns
  kpiStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: tokens.spacingHorizontalM,
  },
  kpiCard: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    boxShadow: tokens.shadow2,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
  },
  kpiLabel: {
    fontSize: '11px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  kpiValue: {
    fontSize: '26px',
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: '1.2',
  },
  kpiSub: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
  },
  barTrack: {
    marginTop: tokens.spacingVerticalXXS,
    height: '4px',
    borderRadius: '2px',
    backgroundColor: tokens.colorNeutralBackground4,
    overflow: 'hidden',
    display: 'flex',
  },
  barFill: {
    height: '100%',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
  },

  // Health matrix table
  matrixTable: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  matrixThead: {
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
  },
  matrixTh: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    textAlign: 'left',
    fontSize: '11px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    whiteSpace: 'nowrap',
  },
  matrixTr: {
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    '&:last-child': { borderBottom: 'none' },
  },
  matrixTd: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    verticalAlign: 'middle',
    fontSize: tokens.fontSizeBase300,
  },
  projectName: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },

  // Approval bottleneck
  bottleneckList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  bottleneckRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(200px, 1.8fr) 80px 110px 130px',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  bottleneckCCName: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1,
  },
  bottleneckManager: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
    marginTop: '2px',
  },
  bottleneckStat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
  },
  bottleneckStatValue: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
  },
  bottleneckStatLabel: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
  },
  emptySuccess: {
    textAlign: 'center',
    color: tokens.colorPaletteGreenForeground2,
    padding: `${tokens.spacingVerticalXL} 0`,
    fontSize: tokens.fontSizeBase300,
  },
  sectionTitleGroup: {
    display: 'flex',
    flexDirection: 'column',
  },
  sectionSubtitle: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
    marginTop: '2px',
  },
  financeSubtitle: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
    marginTop: '2px',
  },
});

// ─── props ────────────────────────────────────────────────────────────────────

interface Props {
  demandLines: DemandLine[];
  supplyLines: SupplyLine[];
  costCenters: CostCenter[];
  periods: Period[];
  approvalStatuses: Record<string, { status: string }>;
  user: MeResponse;
}

// ─── component ────────────────────────────────────────────────────────────────

export function FinanceDashboard({ demandLines, supplyLines, periods }: Props) {
  const styles = useStyles();
  const { selectedPeriodId, selectedPeriod } = usePeriod();
  const { showApiError } = useToast();

  const [costs, setCosts]             = useState<ConsolidatedCostResponse | null>(null);
  const [costsLoading, setCostsLoading] = useState(false);
  const [actualRows, setActualRows]   = useState<FinanceActualRow[]>([]);
  const [actualLines, setActualLines] = useState<ActualLine[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  // Resolve current period: prefer context, fall back to earliest open period from props
  const currentPeriod = useMemo(
    () => selectedPeriod
      ?? [...periods]
          .filter(p => p.status === 'open')
          .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)[0]
      ?? null,
    [selectedPeriod, periods],
  );

  // Fetch consolidated costs (KPI strip + project budget data)
  useEffect(() => {
    setCostsLoading(true);
    getConsolidatedCosts()
      .then(setCosts)
      .catch(err => showApiError(err as Error, 'Failed to load cost data'))
      .finally(() => setCostsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch actuals (approval bottleneck)
  useEffect(() => {
    if (!currentPeriod) return;
    setDataLoading(true);
    const params = new URLSearchParams({
      year:  String(currentPeriod.year),
      month: String(currentPeriod.month),
    });
    Promise.all([
      apiClient.get<FinanceActualRow[]>(`/finance/actuals-dashboard?${params.toString()}`),
      actualsApi.getActualLines(selectedPeriodId || undefined),
    ])
      .then(([rows, lines]) => { setActualRows(rows); setActualLines(lines); })
      .catch(err => showApiError(err as Error, 'Failed to load actuals data'))
      .finally(() => setDataLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPeriod?.id, selectedPeriodId]);

  // ── Section 1: KPI Strip computations ────────────────────────────────────────

  const costRows = costs?.data ?? [];

  // Baseline FY — sum all months
  const totalPlannedLabor = useMemo(() => costRows.reduce((s, r) => s + r.demand_cost, 0), [costRows]);
  const totalActualLabor  = useMemo(() => costRows.reduce((s, r) => s + r.actuals_cost, 0), [costRows]);
  const totalOoP          = useMemo(() => costRows.reduce((s, r) => s + r.externals_cost, 0), [costRows]);
  const totalEquipment    = useMemo(() => costRows.reduce((s, r) => s + r.equipment_cost, 0), [costRows]);
  const variancePct       = totalPlannedLabor > 0
    ? ((totalActualLabor - totalPlannedLabor) / totalPlannedLabor) * 100
    : 0;
  const laborVsPlanPct    = totalPlannedLabor > 0 ? (totalActualLabor / totalPlannedLabor) * 100 : 0;
  const oopVsPlanPct      = totalPlannedLabor > 0 ? (totalOoP / totalPlannedLabor) * 100 : 0;
  const equipVsPlanPct    = totalPlannedLabor > 0 ? (totalEquipment / totalPlannedLabor) * 100 : 0;

  // Total Period — current period only
  const currentPeriodRows = useMemo(
    () => currentPeriod
      ? costRows.filter(r => r.year === currentPeriod.year && r.month === currentPeriod.month)
      : [],
    [costRows, currentPeriod],
  );
  const periodActualLabor  = useMemo(() => currentPeriodRows.reduce((s, r) => s + r.actuals_cost, 0), [currentPeriodRows]);
  const periodOoP          = useMemo(() => currentPeriodRows.reduce((s, r) => s + r.externals_cost, 0), [currentPeriodRows]);
  const periodEquipment    = useMemo(() => currentPeriodRows.reduce((s, r) => s + r.equipment_cost, 0), [currentPeriodRows]);
  const totalPeriod        = periodActualLabor + periodOoP + periodEquipment;

  // ── Section 2: Project Health Matrix ─────────────────────────────────────────

  const pd = useMemo(
    () => currentPeriod ? demandLines.filter(d => d.period_id === currentPeriod.id) : [],
    [demandLines, currentPeriod],
  );
  const ps = useMemo(
    () => currentPeriod ? supplyLines.filter(s => s.period_id === currentPeriod.id) : [],
    [supplyLines, currentPeriod],
  );

  const projectStaffing = useMemo(() => {
    const map = new Map<string, { name: string; demand: number; supply: number }>();
    pd.forEach(d => {
      const ex = map.get(d.project_id);
      if (ex) ex.demand += d.fte_percent;
      else map.set(d.project_id, { name: d.project_name ?? d.project_id, demand: d.fte_percent, supply: 0 });
    });
    ps.forEach(s => {
      if (!s.project_id) return;
      const ex = map.get(s.project_id);
      if (ex) ex.supply += s.fte_percent;
    });
    return map;
  }, [pd, ps]);

  const projectBudget = useMemo(() => {
    const map = new Map<string, { name: string; planned: number; actual: number }>();
    costRows.forEach(r => {
      const ex = map.get(r.project_id);
      if (ex) { ex.planned += r.demand_cost; ex.actual += r.actuals_cost; }
      else map.set(r.project_id, { name: r.project_name, planned: r.demand_cost, actual: r.actuals_cost });
    });
    return map;
  }, [costRows]);

  const projectHealthRows = useMemo(() => {
    const allIds = new Set([...projectStaffing.keys(), ...projectBudget.keys()]);
    return Array.from(allIds).map(pid => {
      const staffing = projectStaffing.get(pid);
      const budget   = projectBudget.get(pid);
      const name     = staffing?.name ?? budget?.name ?? pid;
      const demand   = staffing?.demand ?? 0;
      const supply   = staffing?.supply ?? 0;
      const gap      = supply - demand;
      const planned  = budget?.planned ?? 0;
      const actual   = budget?.actual  ?? 0;
      const variance = planned > 0 ? ((actual - planned) / planned) * 100 : 0;
      const staffingSev = getStaffingSev(gap);
      const budgetSev   = getBudgetSev(planned, actual);
      const health      = getHealthSev(staffingSev, budgetSev);
      return { pid, name, gap, planned, actual, variance, staffingSev, budgetSev, health };
    }).sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health]);
  }, [projectStaffing, projectBudget]);

  // ── Section 3: Approval Bottleneck ───────────────────────────────────────────

  const actualCreatedAt = useMemo(() => {
    const map = new Map<string, string>();
    actualLines.forEach(l => map.set(l.id, l.created_at));
    return map;
  }, [actualLines]);

  const bottleneckRows = useMemo(() => {
    const pending = actualRows.filter(r => r.approval_status === 'pending');
    const ccMap = new Map<string, {
      ccName: string; managerName: string;
      count: number; totalFte: number; oldestDate: string | null;
    }>();
    pending.forEach(r => {
      const createdAt = actualCreatedAt.get(r.actual_id) ?? null;
      const ex = ccMap.get(r.cost_center_id);
      if (ex) {
        ex.count++;
        ex.totalFte += r.fte_percent;
        if (createdAt && (!ex.oldestDate || createdAt < ex.oldestDate)) ex.oldestDate = createdAt;
      } else {
        ccMap.set(r.cost_center_id, {
          ccName:      r.cost_center_name,
          managerName: r.current_approver_name ?? '—',
          count: 1, totalFte: r.fte_percent, oldestDate: createdAt,
        });
      }
    });
    return Array.from(ccMap.entries())
      .map(([ccId, v]) => ({ ccId, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [actualRows, actualCreatedAt]);

  // ── Render ────────────────────────────────────────────────────────────────────

  const periodLabel = currentPeriod
    ? `${MONTH_NAMES[currentPeriod.month - 1]} ${currentPeriod.year}`
    : '—';

  return (
    <div className={styles.sections}>

      {/* ── Section 1: KPI Strip ── */}
      <div className={styles.kpiStrip}>

        {/* Planned Labor */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Planned Labor</div>
          <div className={styles.kpiValue} style={{ color: tokens.colorNeutralForeground1 }}>
            {costsLoading ? '—' : fmtCost(totalPlannedLabor)}
          </div>
          <div className={styles.kpiSub}>Baseline FY</div>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: '100%', backgroundColor: tokens.colorBrandBackground }} />
          </div>
        </div>

        {/* Actual Labor */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Actual Labor</div>
          <div className={styles.kpiValue} style={{
            color: laborVsPlanPct > 110 ? SEV_FG.bad : laborVsPlanPct > 105 ? SEV_FG.warn : SEV_FG.good,
          }}>
            {costsLoading ? '—' : fmtCost(totalActualLabor)}
          </div>
          <div className={styles.kpiSub} style={{
            color: laborVsPlanPct > 110 ? SEV_FG.bad : laborVsPlanPct > 105 ? SEV_FG.warn : SEV_FG.good,
            fontWeight: tokens.fontWeightSemibold,
          }}>
            {costsLoading ? '' : `${Math.round(laborVsPlanPct)}% of plan`}
          </div>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{
              width: `${Math.min(laborVsPlanPct, 100)}%`,
              backgroundColor: laborVsPlanPct > 110 ? SEV_BAR.bad : laborVsPlanPct > 105 ? SEV_BAR.warn : SEV_BAR.good,
            }} />
          </div>
        </div>

        {/* OoP */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>OoP</div>
          <div className={styles.kpiValue} style={{ color: tokens.colorNeutralForeground1 }}>
            {costsLoading ? '—' : fmtCost(totalOoP)}
          </div>
          <div className={styles.kpiSub}>
            {costsLoading ? '' : `${Math.round(oopVsPlanPct * 10) / 10}% of labor plan`}
          </div>
        </div>

        {/* Equipment */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Equipment</div>
          <div className={styles.kpiValue} style={{ color: tokens.colorNeutralForeground1 }}>
            {costsLoading ? '—' : fmtCost(totalEquipment)}
          </div>
          <div className={styles.kpiSub}>
            {costsLoading ? '' : `${Math.round(equipVsPlanPct * 10) / 10}% of labor plan`}
          </div>
        </div>

        {/* Total Period */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Total Period</div>
          <div className={styles.kpiValue} style={{ color: tokens.colorNeutralForeground1 }}>
            {costsLoading ? '—' : fmtCost(totalPeriod)}
          </div>
          <div className={styles.kpiSub}>{periodLabel}</div>
          {!costsLoading && totalPeriod > 0 && (
            <div className={styles.barTrack}>
              {[
                { cost: periodActualLabor, color: SEV_BAR.good },
                { cost: periodOoP,        color: tokens.colorBrandBackground2 },
                { cost: periodEquipment,  color: SEV_BAR.warn },
              ].map((seg, i) => (
                <div key={i} className={styles.barFill} style={{
                  width: `${(seg.cost / totalPeriod) * 100}%`,
                  backgroundColor: seg.color,
                }} />
              ))}
            </div>
          )}
        </div>

        {/* Variance */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Variance</div>
          <div className={styles.kpiValue} style={{
            color: variancePct > 5 ? SEV_FG.bad : variancePct < -5 ? SEV_FG.good : SEV_FG.warn,
          }}>
            {costsLoading ? '—' : `${variancePct >= 0 ? '+' : ''}${Math.round(variancePct * 10) / 10}%`}
          </div>
          <div className={styles.kpiSub}>
            {variancePct > 5 ? 'Over budget' : variancePct < -5 ? 'Under budget' : 'On track'}
          </div>
        </div>

      </div>

      {/* ── Section 2: Project Health Matrix ── */}
      <DashboardSection
        title={
          <div className={styles.sectionTitleGroup}>
            <span>
              Project Health Matrix{' '}
              <span style={{ color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular }}>
                ({projectHealthRows.length})
              </span>
            </span>
            <span className={styles.sectionSubtitle}>Staffing × Budget cross-reference</span>
          </div>
        }
      >
        {costsLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: tokens.spacingVerticalL }}>
            <Spinner size="small" />
          </div>
        ) : projectHealthRows.length === 0 ? (
          <div style={{ textAlign: 'center', color: tokens.colorNeutralForeground3, padding: `${tokens.spacingVerticalXL} 0` }}>
            No project data available
          </div>
        ) : (
          <table className={styles.matrixTable}>
            <thead className={styles.matrixThead}>
              <tr>
                <th className={styles.matrixTh}>Project</th>
                <th className={styles.matrixTh}>Staffing</th>
                <th className={styles.matrixTh}>Budget</th>
                <th className={styles.matrixTh}>Health</th>
                <th className={styles.matrixTh}>Gap (FTE%)</th>
                <th className={styles.matrixTh}>Variance</th>
              </tr>
            </thead>
            <tbody>
              {projectHealthRows.map(row => (
                <tr key={row.pid} className={styles.matrixTr}>
                  <td className={styles.matrixTd}>
                    <span className={styles.projectName}>{row.name}</span>
                  </td>
                  <td className={styles.matrixTd}>
                    <StaffingBadge gap={row.gap} />
                  </td>
                  <td className={styles.matrixTd}>
                    <BudgetBadge planned={row.planned} actual={row.actual} />
                  </td>
                  <td className={styles.matrixTd}>
                    <HealthBadge health={row.health} />
                  </td>
                  <td className={styles.matrixTd} style={{
                    color: row.gap < -0.1 ? SEV_FG.bad : row.gap > 0.1 ? SEV_FG.warn : SEV_FG.good,
                    fontWeight: tokens.fontWeightSemibold,
                  }}>
                    {row.gap >= 0 ? '+' : ''}{Math.round(row.gap * 10) / 10}%
                  </td>
                  <td className={styles.matrixTd} style={{
                    color: row.variance > 5 ? SEV_FG.bad : row.variance < -5 ? SEV_FG.good : tokens.colorNeutralForeground2,
                    fontWeight: tokens.fontWeightSemibold,
                  }}>
                    {row.planned > 0 ? `${row.variance >= 0 ? '+' : ''}${Math.round(row.variance * 10) / 10}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DashboardSection>

      {/* ── Section 3: Approval Bottleneck ── */}
      <DashboardSection
        title={
          <div className={styles.sectionTitleGroup}>
            <span>Approval Bottleneck</span>
            <span className={styles.sectionSubtitle}>Managers with pending approvals</span>
          </div>
        }
      >
        {dataLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: tokens.spacingVerticalL }}>
            <Spinner size="small" />
          </div>
        ) : bottleneckRows.length === 0 ? (
          <div className={styles.emptySuccess}>
            All actuals approved — no bottlenecks ✓
          </div>
        ) : (
          <div className={styles.bottleneckList}>
            {bottleneckRows.map(row => {
              const oldestDays = row.oldestDate ? daysSince(row.oldestDate) : null;
              const isRed    = row.count > 10;
              const isAmber  = !isRed && (row.count > 5 || (oldestDays !== null && oldestDays > 3));
              const highlight = isRed
                ? { background: '#ffebee', borderColor: '#f5c6cb' }
                : isAmber
                  ? { background: '#fff8e1', borderColor: '#ffe082' }
                  : {};
              return (
                <div key={row.ccId} className={styles.bottleneckRow} style={highlight}>
                  <div>
                    <div className={styles.bottleneckCCName}>{row.ccName}</div>
                    <div className={styles.bottleneckManager}>{row.managerName}</div>
                  </div>
                  <div className={styles.bottleneckStat}>
                    <div className={styles.bottleneckStatValue} style={{
                      color: isRed ? SEV_FG.bad : isAmber ? SEV_FG.warn : tokens.colorNeutralForeground1,
                    }}>
                      {row.count}
                    </div>
                    <div className={styles.bottleneckStatLabel}>pending</div>
                  </div>
                  <div className={styles.bottleneckStat}>
                    <div className={styles.bottleneckStatValue}>
                      {Math.round(row.totalFte * 10) / 10}%
                    </div>
                    <div className={styles.bottleneckStatLabel}>total FTE</div>
                  </div>
                  <div className={styles.bottleneckStat}>
                    <div className={styles.bottleneckStatValue} style={{
                      color: oldestDays !== null && oldestDays > 3 ? SEV_FG.warn : tokens.colorNeutralForeground1,
                    }}>
                      {oldestDays !== null ? `${oldestDays}d ago` : periodLabel}
                    </div>
                    <div className={styles.bottleneckStatLabel}>oldest pending</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DashboardSection>

      {/* ── Section 4: Finance Overview ── */}
      <DashboardSection
        title={
          <div>
            <div>Resource Allocation Overview</div>
            <div className={styles.financeSubtitle}>Full staffing and cost center detail</div>
          </div>
        }
      >
        <FinanceOverview scope="finance" />
      </DashboardSection>

    </div>
  );
}
