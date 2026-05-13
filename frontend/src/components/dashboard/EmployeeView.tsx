import { useEffect, useMemo, useState } from 'react';
import {
  makeStyles,
  tokens,
  Badge,
  Skeleton,
  SkeletonItem,
} from '@fluentui/react-components';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { DashboardKPIStrip, KPIStripItem } from '../shared/DashboardKPIStrip';
import { DashboardSection } from './DashboardSection';
import { actualsApi, ActualLine } from '../../api/actuals';
import { planningApi, DemandLine, SupplyLine } from '../../api/planning';
import type { Period, MeResponse } from '../../types/index';

const DEMAND_COLOR = '#d97706';
const SUPPLY_COLOR = '#0d9488';

const useStyles = makeStyles({
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  emptyState: {
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
    padding: `${tokens.spacingVerticalXL} 0`,
    fontSize: tokens.fontSizeBase300,
  },
  chartWrap: { width: '100%' },
  matrixScroll: { overflowX: 'auto' },
  matrixTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  matrixTh: {
    padding: '8px 12px',
    textAlign: 'right',
    fontWeight: tokens.fontWeightSemibold,
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    whiteSpace: 'nowrap',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  matrixThProject: {
    textAlign: 'left',
    position: 'sticky',
    left: '0',
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: '1',
  },
  matrixThCurrent: {
    backgroundColor: 'rgba(13, 148, 136, 0.06)',
  },
  matrixTd: {
    padding: '4px 12px',
    textAlign: 'right',
    fontFamily: 'monospace',
    verticalAlign: 'middle',
    height: '34px',
    borderBottom: `1px solid ${tokens.colorNeutralBackground4}`,
  },
  matrixTdProject: {
    padding: '0 12px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    whiteSpace: 'nowrap',
    position: 'sticky',
    left: '0',
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: '1',
    height: '34px',
    verticalAlign: 'middle',
    borderBottom: `1px solid ${tokens.colorNeutralBackground4}`,
  },
  matrixTdCurrent: {
    backgroundColor: 'rgba(13, 148, 136, 0.06)',
  },
  matrixTotalRow: {
    borderTop: `2px solid ${tokens.colorNeutralStroke1}`,
  },
  matrixTotalTdProject: {
    padding: '8px 12px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    fontSize: '11px',
    letterSpacing: '0.5px',
    position: 'sticky',
    left: '0',
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: '1',
  },
  matrixTotalTd: {
    padding: '8px 12px',
    textAlign: 'right',
    fontFamily: 'monospace',
    fontWeight: tokens.fontWeightSemibold,
    verticalAlign: 'middle',
  },
  demandVal: { color: DEMAND_COLOR, fontWeight: tokens.fontWeightSemibold },
  supplyVal: { color: SUPPLY_COLOR, fontSize: '11px', display: 'block' },
  emptyCell: { color: tokens.colorNeutralForeground4 },
});

interface Props {
  periods: Period[];
  user: MeResponse;
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtPeriod(p: Period) { return `${MONTH_NAMES[p.month - 1]} ${p.year}`; }

export function EmployeeView({ periods }: Props) {
  const styles = useStyles();

  const [myResourceId, setMyResourceId] = useState<string | null>(null);
  const [myDemandLines, setMyDemandLines] = useState<DemandLine[]>([]);
  const [mySupplyLines, setMySupplyLines] = useState<SupplyLine[]>([]);
  const [myActuals, setMyActuals] = useState<ActualLine[]>([]);
  const [myApprovalStatuses, setMyApprovalStatuses] = useState<Record<string, { status: string }>>({});
  const [loading, setLoading] = useState(true);

  const openPeriods = useMemo(
    () => [...periods]
      .filter(p => p.status === 'open')
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month),
    [periods],
  );
  const earliestPeriod = openPeriods[0] ?? null;

  useEffect(() => {
    if (!earliestPeriod) { setLoading(false); return; }

    actualsApi.getMyResource()
      .then(({ resource_id }) => {
        setMyResourceId(resource_id);
        return Promise.all([
          resource_id
            ? planningApi.getDemandLines(undefined, { resourceId: resource_id })
            : Promise.resolve([] as DemandLine[]),
          resource_id
            ? planningApi.getSupplyLines(undefined, { resourceId: resource_id })
            : Promise.resolve([] as SupplyLine[]),
          actualsApi.getMyActuals(earliestPeriod.year, earliestPeriod.month),
          actualsApi.getMyApprovalStatuses(earliestPeriod.year, earliestPeriod.month),
        ]);
      })
      .then(([demand, supply, actuals, statuses]) => {
        setMyDemandLines(demand);
        setMySupplyLines(supply);
        setMyActuals(actuals);
        setMyApprovalStatuses(statuses);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [earliestPeriod?.id]);

  const periodName = earliestPeriod ? fmtPeriod(earliestPeriod) : '—';

  // ── KPI computations ──────────────────────────────────────────────────────

  const myDemandThisPeriod = useMemo(() => {
    if (!earliestPeriod) return 0;
    return Math.round(
      myDemandLines.filter(d => d.period_id === earliestPeriod.id).reduce((s, d) => s + d.fte_percent, 0) * 10,
    ) / 10;
  }, [myDemandLines, earliestPeriod]);

  const mySupplyThisPeriod = useMemo(() => {
    if (!earliestPeriod) return 0;
    return Math.round(
      mySupplyLines.filter(s => s.period_id === earliestPeriod.id).reduce((s, ln) => s + ln.fte_percent, 0) * 10,
    ) / 10;
  }, [mySupplyLines, earliestPeriod]);

  const demandProjectCount = useMemo(() => {
    if (!earliestPeriod) return 0;
    return new Set(myDemandLines.filter(d => d.period_id === earliestPeriod.id).map(d => d.project_id)).size;
  }, [myDemandLines, earliestPeriod]);

  const actualsStats = useMemo(() => {
    const demandProjectIds = new Set(
      myDemandLines.filter(d => d.period_id === earliestPeriod?.id).map(d => d.project_id),
    );
    const total = demandProjectIds.size;
    const submitted = myActuals.filter(a => demandProjectIds.has(a.project_id)).length;
    return { total, submitted };
  }, [myDemandLines, myActuals, earliestPeriod]);

  const approvalStats = useMemo(() => {
    const statuses = Object.values(myApprovalStatuses);
    return {
      approved: statuses.filter(s => s.status === 'approved').length,
      pending:  statuses.filter(s => s.status === 'pending').length,
      rejected: statuses.filter(s => s.status === 'rejected').length,
      total:    statuses.length,
    };
  }, [myApprovalStatuses]);

  const gap = Math.round((myDemandThisPeriod - mySupplyThisPeriod) * 10) / 10;

  const kpiItems: KPIStripItem[] = useMemo(() => {
    const coverPct = myDemandThisPeriod > 0
      ? Math.round((mySupplyThisPeriod / myDemandThisPeriod) * 100)
      : 100;

    const actualsAllSubmitted = actualsStats.total > 0 && actualsStats.submitted === actualsStats.total;
    const actualsSev = actualsAllSubmitted ? 'good' : actualsStats.submitted === 0 ? 'bad' : 'warn';

    const approvalSev = approvalStats.rejected > 0 ? 'bad'
      : approvalStats.pending > 0 ? 'pending'
      : approvalStats.approved > 0 ? 'good'
      : 'default';

    const gapSev = Math.abs(gap) < 1 ? 'good' : gap > 0 ? 'bad' : 'warn';
    const gapSubtitle = Math.abs(gap) < 1 ? 'Balanced' : gap > 0 ? 'Understaffed' : 'Over-allocated';

    return [
      {
        label: 'My Demand',
        value: `${myDemandThisPeriod}%`,
        subtitle: `across ${demandProjectCount} project${demandProjectCount !== 1 ? 's' : ''}`,
      },
      {
        label: 'My Supply',
        value: `${mySupplyThisPeriod}%`,
        subtitle: `${coverPct}% of demand covered`,
      },
      {
        label: 'Actuals Submitted',
        value: `${actualsStats.submitted} / ${actualsStats.total} lines`,
        subtitle: periodName,
        severity: actualsSev,
        bar: actualsStats.total > 0 ? {
          fill: (actualsStats.submitted / actualsStats.total) * 100,
          fillSev: actualsSev,
        } : undefined,
      },
      {
        label: 'Approval Status',
        value: approvalStats.total > 0
          ? <span style={{ fontSize: '17px', letterSpacing: '-0.3px' }}>
              {approvalStats.approved} apr · {approvalStats.pending} pend · {approvalStats.rejected} rej
            </span>
          : 'None',
        subtitle: approvalStats.total > 0
          ? approvalStats.rejected > 0 ? 'Has rejections'
          : approvalStats.pending > 0 ? 'Awaiting approval'
          : 'All approved'
          : 'No lines submitted',
        severity: approvalSev,
      },
      {
        label: 'My Gap',
        value: gap === 0 ? '0%' : `${gap > 0 ? '+' : ''}${gap}%`,
        subtitle: gapSubtitle,
        severity: gapSev,
      },
    ] satisfies KPIStripItem[];
  }, [myDemandThisPeriod, mySupplyThisPeriod, demandProjectCount, actualsStats, approvalStats, gap, periodName]);

  // ── Demand matrix ─────────────────────────────────────────────────────────

  const matrixProjects = useMemo(() => {
    const map = new Map<string, string>();
    myDemandLines.forEach(d => {
      if (!map.has(d.project_id)) map.set(d.project_id, d.project_name ?? d.project_id);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [myDemandLines]);

  const matrixPeriods = useMemo(() => {
    const idsWithDemand = new Set(myDemandLines.map(d => d.period_id));
    return openPeriods.filter(p => idsWithDemand.has(p.id));
  }, [openPeriods, myDemandLines]);

  const demandLookup = useMemo(() => {
    const lookup = new Map<string, Map<string, number>>();
    myDemandLines.forEach(d => {
      if (!lookup.has(d.project_id)) lookup.set(d.project_id, new Map());
      lookup.get(d.project_id)!.set(d.period_id, (lookup.get(d.project_id)!.get(d.period_id) ?? 0) + d.fte_percent);
    });
    return lookup;
  }, [myDemandLines]);

  const supplyLookup = useMemo(() => {
    const lookup = new Map<string, Map<string, number>>();
    mySupplyLines.forEach(s => {
      const key = s.project_id ?? '__total__';
      if (!lookup.has(key)) lookup.set(key, new Map());
      lookup.get(key)!.set(s.period_id, (lookup.get(key)!.get(s.period_id) ?? 0) + s.fte_percent);
    });
    return lookup;
  }, [mySupplyLines]);

  const hasProjectSupply = useMemo(() => mySupplyLines.some(s => !!s.project_id), [mySupplyLines]);

  // ── Chart data ────────────────────────────────────────────────────────────

  const chartData = useMemo(() => {
    return openPeriods.map(p => {
      const demand = Math.round(
        myDemandLines.filter(d => d.period_id === p.id).reduce((s, d) => s + d.fte_percent, 0) * 10,
      ) / 10;
      const supply = Math.round(
        mySupplyLines.filter(s => s.period_id === p.id).reduce((s, ln) => s + ln.fte_percent, 0) * 10,
      ) / 10;
      const base = Math.min(demand, supply);
      return {
        label: fmtPeriod(p),
        demand,
        supply,
        base,
        gap_under: demand > supply ? Math.round((demand - supply) * 10) / 10 : 0,
        gap_over:  supply > demand ? Math.round((supply - demand) * 10) / 10 : 0,
      };
    });
  }, [openPeriods, myDemandLines, mySupplyLines]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL }}>
        <Skeleton style={{ height: 88 }}><SkeletonItem /></Skeleton>
        <Skeleton style={{ height: 260 }}><SkeletonItem /></Skeleton>
        <Skeleton style={{ height: 200 }}><SkeletonItem /></Skeleton>
      </div>
    );
  }

  return (
    <div className={styles.sections}>
      {/* 5-card KPI row */}
      <DashboardKPIStrip items={kpiItems} />

      {/* Resource planning chart */}
      <DashboardSection title="My Resource Planning Overview">
        {chartData.length === 0 || !myResourceId ? (
          <div className={styles.emptyState}>No planning data available</div>
        ) : (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} unit="%" />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload.find(p => p.dataKey === 'demand')?.value as number | undefined;
                    const s = payload.find(p => p.dataKey === 'supply')?.value as number | undefined;
                    const g = (d ?? 0) - (s ?? 0);
                    const gAbs = Math.abs(Math.round(g * 10) / 10);
                    return (
                      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}>
                        <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{label}</p>
                        {d !== undefined && <p style={{ margin: '2px 0', color: DEMAND_COLOR }}>My Demand: {d}%</p>}
                        {s !== undefined && <p style={{ margin: '2px 0', color: SUPPLY_COLOR }}>My Supply: {s}%</p>}
                        {gAbs > 0 && (
                          <p style={{ margin: '4px 0 0', color: g > 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
                            {g > 0 ? `Understaffed: ${gAbs}%` : `Overstaffed: ${gAbs}%`}
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                <Legend formatter={v => v === 'demand' ? 'My Demand' : 'My Supply'} />
                <ReferenceLine y={100} stroke="#d1d5db" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="base"      stackId="gap" fill="transparent"                    stroke="none" legendType="none" tooltipType="none" isAnimationActive={false} />
                <Area type="monotone" dataKey="gap_under" stackId="gap" fill="rgba(217,119,6,0.08)"           stroke="none" legendType="none" isAnimationActive={false} />
                <Area type="monotone" dataKey="gap_over"  stackId="gap" fill="rgba(13,148,136,0.08)"          stroke="none" legendType="none" isAnimationActive={false} />
                <Line type="monotone" dataKey="demand" stroke={DEMAND_COLOR} strokeWidth={2.5} dot={false} name="demand" unit="%" />
                <Line type="monotone" dataKey="supply" stroke={SUPPLY_COLOR} strokeWidth={2.5} dot={false} name="supply" unit="%" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </DashboardSection>

      {/* Demand assignments matrix */}
      <DashboardSection
        title="My Demand Assignments"
        action={matrixProjects.length > 0 ? (
          <Badge appearance="filled" color="brand" shape="rounded">
            {matrixProjects.length} project{matrixProjects.length !== 1 ? 's' : ''}
          </Badge>
        ) : undefined}
      >
        {matrixProjects.length === 0 ? (
          <div className={styles.emptyState}>No demand assignments found</div>
        ) : (
          <div className={styles.matrixScroll}>
            <table className={styles.matrixTable}>
              <thead>
                <tr>
                  <th className={`${styles.matrixTh} ${styles.matrixThProject}`}>Project</th>
                  {matrixPeriods.map(p => (
                    <th
                      key={p.id}
                      className={`${styles.matrixTh}${p.id === earliestPeriod?.id ? ` ${styles.matrixThCurrent}` : ''}`}
                    >
                      {fmtPeriod(p)}
                    </th>
                  ))}
                  <th className={styles.matrixTh}>Total</th>
                </tr>
              </thead>
              <tbody>
                {matrixProjects.map(proj => {
                  const total = matrixPeriods.reduce(
                    (sum, p) => sum + (demandLookup.get(proj.id)?.get(p.id) ?? 0), 0,
                  );
                  return (
                    <tr key={proj.id}>
                      <td className={styles.matrixTdProject}>{proj.name}</td>
                      {matrixPeriods.map(p => {
                        const dVal = demandLookup.get(proj.id)?.get(p.id);
                        const sVal = hasProjectSupply ? supplyLookup.get(proj.id)?.get(p.id) : undefined;
                        const isCurrent = p.id === earliestPeriod?.id;
                        return (
                          <td key={p.id} className={`${styles.matrixTd}${isCurrent ? ` ${styles.matrixTdCurrent}` : ''}`}>
                            {dVal !== undefined ? (
                              <>
                                <span className={styles.demandVal}>{Math.round(dVal)}%</span>
                                {sVal !== undefined && (
                                  <span className={styles.supplyVal}>S: {Math.round(sVal)}%</span>
                                )}
                              </>
                            ) : (
                              <span className={styles.emptyCell}>—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className={styles.matrixTd} style={{ fontWeight: 600 }}>
                        <span className={styles.demandVal}>{Math.round(total)}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className={styles.matrixTotalRow}>
                  <td className={styles.matrixTotalTdProject}>Total</td>
                  {matrixPeriods.map(p => {
                    const pTotal = matrixProjects.reduce(
                      (sum, proj) => sum + (demandLookup.get(proj.id)?.get(p.id) ?? 0), 0,
                    );
                    const isCurrent = p.id === earliestPeriod?.id;
                    return (
                      <td key={p.id} className={`${styles.matrixTotalTd}${isCurrent ? ` ${styles.matrixTdCurrent}` : ''}`}>
                        {pTotal > 0
                          ? <span style={{ color: DEMAND_COLOR }}>{Math.round(pTotal)}%</span>
                          : <span className={styles.emptyCell}>—</span>}
                      </td>
                    );
                  })}
                  <td className={styles.matrixTotalTd}>
                    <span style={{ color: DEMAND_COLOR }}>
                      {Math.round(
                        matrixProjects.reduce(
                          (sum, proj) => sum + matrixPeriods.reduce(
                            (s, p) => s + (demandLookup.get(proj.id)?.get(p.id) ?? 0), 0,
                          ), 0,
                        ),
                      )}%
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </DashboardSection>
    </div>
  );
}
