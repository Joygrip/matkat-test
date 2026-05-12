import { useState, useEffect, useMemo } from 'react';
import { makeStyles, tokens, Badge, Spinner } from '@fluentui/react-components';
import { DashboardSection } from './DashboardSection';
import { getConsolidatedCosts } from '../../api/finance';
import type { ConsolidatedCostResponse } from '../../api/finance';
import { consolidationApi } from '../../api/consolidation';
import type { ConsolidationDashboard } from '../../api/consolidation';
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

function avatarColor(name: string): string {
  const COLORS = ['#0078d4', '#107c10', '#d13438', '#ff8c00', '#8764b8', '#00b294', '#ca5010'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0x7fffffff;
  return COLORS[h % COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

const SEV_FG = {
  good: tokens.colorPaletteGreenForeground2,
  warn: tokens.colorPaletteMarigoldForeground2,
  bad:  tokens.colorPaletteRedForeground2,
  over: '#1e5fa0',
};

// ─── allocation histogram bucket definitions ──────────────────────────────────

const DIST_BUCKETS = [
  { key: 'idle',    label: 'Idle (0%)',              barColor: '#d0cece', fgColor: '#605e5c' },
  { key: 'under',   label: 'Under-utilized (1–49%)', barColor: '#f7e4c4', fgColor: '#9a5b00' },
  { key: 'partial', label: 'Partial (50–79%)',        barColor: '#c4dff7', fgColor: '#1e5fa0' },
  { key: 'well',    label: 'Well utilized (80–100%)', barColor: '#c8e6c9', fgColor: '#2a6f4d' },
  { key: 'over',    label: 'Over-allocated (>100%)',  barColor: '#bdd6f8', fgColor: '#1e3a5f' },
] as const;

type BucketKey = typeof DIST_BUCKETS[number]['key'];

// ─── sub-component: gap chip ──────────────────────────────────────────────────

function GapChip({ gap }: { gap: number }) {
  const label = `${gap >= 0 ? '+' : ''}${Math.round(gap * 10) / 10}%`;
  if (gap < -20)  return <Badge color="danger"       appearance="filled">{label}</Badge>;
  if (gap < -0.1) return <Badge color="warning"      appearance="filled">{label}</Badge>;
  if (gap > 15)   return <Badge color="informative"  appearance="filled">{label}</Badge>;
  return                 <Badge color="success"      appearance="filled">{label}</Badge>;
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

  // Allocation distribution histogram
  histoBar: {
    height: '20px',
    borderRadius: '10px',
    overflow: 'hidden',
    display: 'flex',
  },
  histoSegment: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: tokens.fontWeightSemibold,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  },
  histoLegend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    marginTop: tokens.spacingVerticalM,
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: tokens.colorNeutralForeground2,
  },
  legendSwatch: {
    width: '12px',
    height: '12px',
    borderRadius: '3px',
    flexShrink: 0,
  },
  legendCount: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  legendPct: {
    color: tokens.colorNeutralForeground3,
  },

  // CC health table
  ccTable: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  ccThead: {
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
  },
  ccTh: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    textAlign: 'left',
    fontSize: '11px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    whiteSpace: 'nowrap',
  },
  ccTr: {
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    '&:last-child': { borderBottom: 'none' },
  },
  ccTd: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    verticalAlign: 'middle',
    fontSize: tokens.fontSizeBase300,
  },
  ccName: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },

  // Demand conflicts list
  conflictList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  conflictRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 1.6fr) 1fr 90px 90px 110px',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  resourceCell: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
  },
  avatar: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: tokens.fontWeightSemibold,
    color: '#fff',
    flexShrink: 0,
  },
  resourceName: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  resourceSub: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  demandPct: {
    fontSize: '18px',
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: '1.2',
  },
  demandSub: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
  },
  emptySuccess: {
    textAlign: 'center',
    color: tokens.colorPaletteGreenForeground2,
    padding: `${tokens.spacingVerticalXL} 0`,
    fontSize: tokens.fontSizeBase300,
  },
  emptyNeutral: {
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
    padding: `${tokens.spacingVerticalXL} 0`,
    fontSize: tokens.fontSizeBase300,
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

export function ExecutiveDashboard({ demandLines, supplyLines, periods }: Props) {
  const styles = useStyles();
  const { selectedPeriodId, selectedPeriod } = usePeriod();
  const { showApiError } = useToast();

  const [costs, setCosts]               = useState<ConsolidatedCostResponse | null>(null);
  const [costsLoading, setCostsLoading] = useState(false);
  const [dashboard, setDashboard]       = useState<ConsolidationDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [actualRows, setActualRows]     = useState<FinanceActualRow[]>([]);
  const [actualsLoading, setActualsLoading] = useState(false);

  // Resolve current period: prefer context selection, fall back to earliest open period
  const currentPeriod = useMemo(
    () => selectedPeriod
      ?? [...periods]
          .filter(p => p.status === 'open')
          .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)[0]
      ?? null,
    [selectedPeriod, periods],
  );

  // Fetch consolidated costs (Total Cost KPI)
  useEffect(() => {
    setCostsLoading(true);
    getConsolidatedCosts()
      .then(setCosts)
      .catch(err => showApiError(err as Error, 'Failed to load cost data'))
      .finally(() => setCostsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch consolidation dashboard (CC health section)
  useEffect(() => {
    if (!selectedPeriodId) { setDashboard(null); return; }
    setDashboardLoading(true);
    consolidationApi.getDashboard(selectedPeriodId)
      .then(setDashboard)
      .catch(err => showApiError(err as Error, 'Failed to load department data'))
      .finally(() => setDashboardLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodId]);

  // Fetch actuals (Actuals Completion KPI)
  useEffect(() => {
    if (!currentPeriod) return;
    setActualsLoading(true);
    const params = new URLSearchParams({
      year:  String(currentPeriod.year),
      month: String(currentPeriod.month),
    });
    apiClient.get<FinanceActualRow[]>(`/finance/actuals-dashboard?${params.toString()}`)
      .then(setActualRows)
      .catch(err => showApiError(err as Error, 'Failed to load actuals data'))
      .finally(() => setActualsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPeriod?.id]);

  // ── Period-filtered planning lines ────────────────────────────────────────

  const pd = useMemo(
    () => currentPeriod ? demandLines.filter(d => d.period_id === currentPeriod.id) : [],
    [demandLines, currentPeriod],
  );
  const ps = useMemo(
    () => currentPeriod ? supplyLines.filter(s => s.period_id === currentPeriod.id) : [],
    [supplyLines, currentPeriod],
  );

  // ── Core resource maps ────────────────────────────────────────────────────

  // All unique resources appearing in either demand or supply this period
  const allResourceIds = useMemo(() => {
    const ids = new Set<string>();
    pd.filter(d => d.resource_id).forEach(d => ids.add(d.resource_id!));
    ps.forEach(s => ids.add(s.resource_id));
    return ids;
  }, [pd, ps]);

  // Per-resource total supply %
  const resourceSupplyMap = useMemo(() => {
    const map = new Map<string, number>();
    ps.forEach(s => map.set(s.resource_id, (map.get(s.resource_id) ?? 0) + s.fte_percent));
    return map;
  }, [ps]);

  // ── Section 1: KPI computations ───────────────────────────────────────────

  const totalResources = allResourceIds.size;

  const avgUtilization = useMemo(() => {
    if (totalResources === 0) return 0;
    const sum = Array.from(allResourceIds).reduce((s, id) => s + (resourceSupplyMap.get(id) ?? 0), 0);
    return sum / totalResources;
  }, [allResourceIds, resourceSupplyMap, totalResources]);

  const totalDemand = useMemo(() => pd.reduce((s, d) => s + d.fte_percent, 0), [pd]);
  const totalSupply = useMemo(() => ps.reduce((s, l) => s + l.fte_percent, 0), [ps]);
  const netGap      = totalSupply - totalDemand;

  const activeProjectCount = useMemo(
    () => new Set(pd.filter(d => d.fte_percent > 0).map(d => d.project_id)).size,
    [pd],
  );

  const submittedCount = useMemo(
    () => new Set(actualRows.map(r => r.employee_email)).size,
    [actualRows],
  );
  const completionPct = totalResources > 0 ? Math.round((submittedCount / totalResources) * 100) : 0;

  const costRows = costs?.data ?? [];
  const currentPeriodCostRows = useMemo(
    () => currentPeriod
      ? costRows.filter(r => r.year === currentPeriod.year && r.month === currentPeriod.month)
      : [],
    [costRows, currentPeriod],
  );
  const totalPlannedCost = useMemo(
    () => currentPeriodCostRows.reduce((s, r) => s + r.demand_cost, 0),
    [currentPeriodCostRows],
  );

  // ── Section 2: Allocation distribution ───────────────────────────────────

  const distributionBuckets = useMemo((): Record<BucketKey, number> => {
    const b = { idle: 0, under: 0, partial: 0, well: 0, over: 0 };
    allResourceIds.forEach(id => {
      const supply = resourceSupplyMap.get(id) ?? 0;
      if (supply === 0)       b.idle++;
      else if (supply < 50)   b.under++;
      else if (supply < 80)   b.partial++;
      else if (supply <= 100) b.well++;
      else                    b.over++;
    });
    return b;
  }, [allResourceIds, resourceSupplyMap]);

  const distData = DIST_BUCKETS.map(b => ({
    ...b,
    count: distributionBuckets[b.key],
  }));

  // ── Section 3: CC health (from consolidation dashboard) ──────────────────

  const ccHealthRows = useMemo(
    () => dashboard
      ? [...dashboard.cost_centers].sort((a, b) => a.gap_fte - b.gap_fte)
      : [],
    [dashboard],
  );

  // ── Section 4: Demand conflicts ───────────────────────────────────────────

  const demandConflicts = useMemo(() => {
    const map = new Map<string, {
      name: string;
      initials: string | null;
      ccName: string;
      projects: Map<string, number>;
      totalDemand: number;
      totalSupply: number;
    }>();

    pd.filter(d => d.resource_id).forEach(d => {
      const ex = map.get(d.resource_id!);
      if (ex) {
        ex.projects.set(d.project_id, (ex.projects.get(d.project_id) ?? 0) + d.fte_percent);
        ex.totalDemand += d.fte_percent;
      } else {
        const projects = new Map<string, number>([[d.project_id, d.fte_percent]]);
        map.set(d.resource_id!, {
          name:        d.resource_name ?? d.resource_id!,
          initials:    d.resource_initials ?? null,
          ccName:      d.cost_center_name ?? '',
          projects,
          totalDemand: d.fte_percent,
          totalSupply: 0,
        });
      }
    });

    ps.forEach(s => {
      const ex = map.get(s.resource_id);
      if (ex) ex.totalSupply += s.fte_percent;
    });

    return Array.from(map.entries())
      .filter(([, r]) => r.projects.size >= 3 || r.totalDemand > 120)
      .map(([id, r]) => ({ id, ...r, gap: r.totalSupply - r.totalDemand }))
      .sort((a, b) => b.totalDemand - a.totalDemand);
  }, [pd, ps]);

  // ── Derived display values ────────────────────────────────────────────────

  const periodLabel = currentPeriod
    ? `${MONTH_NAMES[currentPeriod.month - 1]} ${currentPeriod.year}`
    : '—';

  const utilSev = avgUtilization >= 80 ? SEV_FG.good : avgUtilization >= 50 ? SEV_FG.warn : SEV_FG.bad;
  const gapSev  = netGap < -0.1 ? SEV_FG.bad : netGap > 0.1 ? SEV_FG.warn : SEV_FG.good;

  const completionBarColor = completionPct >= 80
    ? tokens.colorPaletteGreenBackground2
    : completionPct >= 50
      ? tokens.colorPaletteMarigoldBackground2
      : tokens.colorPaletteRedBackground2;

  const utilBarColor = avgUtilization >= 80
    ? tokens.colorPaletteGreenBackground2
    : avgUtilization >= 50
      ? tokens.colorPaletteMarigoldBackground2
      : tokens.colorPaletteRedBackground2;

  return (
    <div className={styles.sections}>

      {/* ── Section 1: KPI Strip ── */}
      <div className={styles.kpiStrip}>

        {/* Total Resources */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Total Resources</div>
          <div className={styles.kpiValue} style={{ color: tokens.colorNeutralForeground1 }}>
            {totalResources}
          </div>
          <div className={styles.kpiSub}>{periodLabel}</div>
        </div>

        {/* Avg Utilization */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Avg Utilization</div>
          <div className={styles.kpiValue} style={{ color: utilSev }}>
            {`${Math.round(avgUtilization * 10) / 10}%`}
          </div>
          <div className={styles.kpiSub} style={{ color: utilSev, fontWeight: tokens.fontWeightSemibold }}>
            {avgUtilization >= 80 ? 'Well utilized' : avgUtilization >= 50 ? 'Partial' : 'Under-utilized'}
          </div>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{
              width: `${Math.min(avgUtilization, 100)}%`,
              backgroundColor: utilBarColor,
            }} />
          </div>
        </div>

        {/* Net Gap */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Net Gap</div>
          <div className={styles.kpiValue} style={{ color: gapSev }}>
            {`${netGap >= 0 ? '+' : ''}${Math.round(netGap * 10) / 10}%`}
          </div>
          <div className={styles.kpiSub} style={{ color: gapSev, fontWeight: tokens.fontWeightSemibold }}>
            {netGap < -0.1 ? 'Org understaffed' : netGap > 0.1 ? 'Excess supply' : 'Balanced'}
          </div>
        </div>

        {/* Active Projects */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Active Projects</div>
          <div className={styles.kpiValue} style={{ color: tokens.colorNeutralForeground1 }}>
            {activeProjectCount}
          </div>
          <div className={styles.kpiSub}>with demand · {periodLabel}</div>
        </div>

        {/* Actuals Completion */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Actuals Completion</div>
          <div className={styles.kpiValue} style={{ color: tokens.colorNeutralForeground1 }}>
            {actualsLoading ? '—' : `${completionPct}%`}
          </div>
          <div className={styles.kpiSub}>
            {actualsLoading ? '' : `${submittedCount} of ${totalResources} submitted`}
          </div>
          {!actualsLoading && totalResources > 0 && (
            <div className={styles.barTrack}>
              <div className={styles.barFill} style={{
                width: `${completionPct}%`,
                backgroundColor: completionBarColor,
              }} />
            </div>
          )}
        </div>

        {/* Total Cost */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Total Cost</div>
          <div className={styles.kpiValue} style={{ color: tokens.colorNeutralForeground1 }}>
            {costsLoading ? '—' : fmtCost(totalPlannedCost)}
          </div>
          <div className={styles.kpiSub}>Planned labor · {periodLabel}</div>
        </div>

      </div>

      {/* ── Section 2: Allocation Distribution ── */}
      <DashboardSection
        title={
          <div className={styles.sectionTitleGroup}>
            <span>Allocation Distribution</span>
            <span className={styles.sectionSubtitle}>How organizational capacity is utilized this period</span>
          </div>
        }
      >
        {totalResources === 0 ? (
          <div className={styles.emptyNeutral}>No resource data for this period</div>
        ) : (
          <>
            {/* Stacked bar */}
            <div className={styles.histoBar}>
              {distData.filter(b => b.count > 0).map(b => {
                const widthPct = (b.count / totalResources) * 100;
                return (
                  <div
                    key={b.key}
                    className={styles.histoSegment}
                    title={`${b.label}: ${b.count} (${Math.round(widthPct)}%)`}
                    style={{ width: `${widthPct}%`, backgroundColor: b.barColor, color: b.fgColor }}
                  >
                    {widthPct > 6 ? b.count : null}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className={styles.histoLegend}>
              {distData.map(b => {
                const pct = Math.round((b.count / totalResources) * 100);
                return (
                  <div key={b.key} className={styles.legendItem}>
                    <div
                      className={styles.legendSwatch}
                      style={{ backgroundColor: b.barColor, border: `1px solid ${b.fgColor}` }}
                    />
                    <span>{b.label}</span>
                    <span className={styles.legendCount}>{b.count}</span>
                    <span className={styles.legendPct}>({pct}%)</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </DashboardSection>

      {/* ── Section 3: Cost Center Health ── */}
      <DashboardSection
        title={
          <div className={styles.sectionTitleGroup}>
            <span>
              Cost Center Health
              {!dashboardLoading && ccHealthRows.length > 0 && (
                <span style={{
                  color: tokens.colorNeutralForeground3,
                  fontWeight: tokens.fontWeightRegular,
                  marginLeft: '6px',
                }}>
                  ({ccHealthRows.length})
                </span>
              )}
            </span>
            <span className={styles.sectionSubtitle}>Gap status across departments</span>
          </div>
        }
      >
        {dashboardLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: tokens.spacingVerticalL }}>
            <Spinner size="small" />
          </div>
        ) : !dashboard ? (
          <div className={styles.emptyNeutral}>Select a period to view department health</div>
        ) : ccHealthRows.length === 0 ? (
          <div className={styles.emptyNeutral}>No cost center data available</div>
        ) : (
          // TODO: add direction arrow (delta vs previous period) in a future enhancement
          <table className={styles.ccTable}>
            <thead className={styles.ccThead}>
              <tr>
                <th className={styles.ccTh}>Cost Center</th>
                <th className={styles.ccTh} style={{ textAlign: 'right' }}>Resources</th>
                <th className={styles.ccTh} style={{ textAlign: 'right' }}>Demand</th>
                <th className={styles.ccTh} style={{ textAlign: 'right' }}>Supply</th>
                <th className={styles.ccTh}>Gap</th>
              </tr>
            </thead>
            <tbody>
              {ccHealthRows.map(cc => (
                <tr key={cc.cost_center_id ?? '__none__'} className={styles.ccTr}>
                  <td className={styles.ccTd}>
                    <span className={styles.ccName}>{cc.cost_center_name}</span>
                  </td>
                  <td className={styles.ccTd} style={{
                    textAlign: 'right',
                    color: tokens.colorNeutralForeground2,
                  }}>
                    {cc.resources.length}
                  </td>
                  <td className={styles.ccTd} style={{
                    textAlign: 'right',
                    color: tokens.colorNeutralForeground2,
                  }}>
                    {Math.round(cc.total_demand_fte * 10) / 10}%
                  </td>
                  <td className={styles.ccTd} style={{
                    textAlign: 'right',
                    color: tokens.colorNeutralForeground2,
                  }}>
                    {Math.round(cc.total_supply_fte * 10) / 10}%
                  </td>
                  <td className={styles.ccTd}>
                    <GapChip gap={cc.gap_fte} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DashboardSection>

      {/* ── Section 4: Demand Conflicts ── */}
      <DashboardSection
        title={
          <div className={styles.sectionTitleGroup}>
            <span>
              Demand Conflicts
              {demandConflicts.length > 0 && (
                <span style={{
                  color: tokens.colorNeutralForeground3,
                  fontWeight: tokens.fontWeightRegular,
                  marginLeft: '6px',
                }}>
                  ({demandConflicts.length})
                </span>
              )}
            </span>
            <span className={styles.sectionSubtitle}>Resources pulled by multiple projects</span>
          </div>
        }
      >
        {demandConflicts.length < 2 ? (
          <div className={styles.emptySuccess}>
            No critical demand conflicts — resources are well-distributed
          </div>
        ) : (
          <div className={styles.conflictList}>
            {demandConflicts.map(r => (
              <div key={r.id} className={styles.conflictRow}>

                {/* Avatar + name + CC */}
                <div className={styles.resourceCell}>
                  <div className={styles.avatar} style={{ background: avatarColor(r.name) }}>
                    {r.initials || initials(r.name)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className={styles.resourceName}>{r.name}</div>
                    {r.ccName && <div className={styles.resourceSub}>{r.ccName}</div>}
                  </div>
                </div>

                {/* Project pull count */}
                <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
                  Pulled by {r.projects.size} project{r.projects.size !== 1 ? 's' : ''}
                </div>

                {/* Total demand */}
                <div>
                  <div className={styles.demandPct} style={{
                    color: r.totalDemand > 120 ? SEV_FG.bad : SEV_FG.warn,
                  }}>
                    {Math.round(r.totalDemand * 10) / 10}%
                  </div>
                  <div className={styles.demandSub}>demand</div>
                </div>

                {/* Total supply */}
                <div>
                  <div className={styles.demandPct} style={{ color: tokens.colorNeutralForeground1 }}>
                    {Math.round(r.totalSupply * 10) / 10}%
                  </div>
                  <div className={styles.demandSub}>supply</div>
                </div>

                {/* Gap chip */}
                <div>
                  <GapChip gap={r.gap} />
                </div>

              </div>
            ))}
          </div>
        )}
      </DashboardSection>

    </div>
  );
}
