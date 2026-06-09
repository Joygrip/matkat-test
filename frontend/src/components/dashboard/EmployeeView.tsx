import { useEffect, useMemo, useState } from 'react';
import {
  makeStyles,
  tokens,
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
import { actualsApi, ActualLine, ActualApprovalStatus } from '../../api/actuals';
import { planningApi, DemandLine, SupplyLine } from '../../api/planning';
import { useAppData } from '../../contexts/AppDataContext';
import { getNearestCurrentOrFutureOpenPeriod } from '../../utils/periodUtils';
import type { Period, MeResponse } from '../../types/index';
import { MONTH_SHORT } from '../../utils/format';
import { MyActualsMatrix } from '../actuals/MyActualsMatrix';

const DEMAND_COLOR = '#d97706';
const SUPPLY_COLOR = '#0d9488';
const ACTUALS_COLOR = '#1e3a5f';

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
});

interface Props {
  periods: Period[];
  user: MeResponse;
}

function fmtPeriod(p: Period) { return `${MONTH_SHORT[p.month - 1]} ${p.year}`; }

export function EmployeeView({ periods }: Props) {
  const styles = useStyles();
  const { myResource, appDataLoading } = useAppData();

  const myResourceId = myResource?.resource_id ?? null;

  const [myDemandLines, setMyDemandLines] = useState<DemandLine[]>([]);
  const [mySupplyLines, setMySupplyLines] = useState<SupplyLine[]>([]);
  const [myActuals, setMyActuals] = useState<ActualLine[]>([]);
  const [myApprovalStatuses, setMyApprovalStatuses] = useState<Record<string, ActualApprovalStatus>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!periods.length || appDataLoading) { setLoading(appDataLoading); return; }

    const resource_id = myResource?.resource_id ?? null;
    setLoading(true);
    Promise.all([
      resource_id
        ? planningApi.getDemandLines(undefined, { resourceId: resource_id })
        : Promise.resolve([] as DemandLine[]),
      resource_id
        ? planningApi.getSupplyLines(undefined, { resourceId: resource_id })
        : Promise.resolve([] as SupplyLine[]),
      actualsApi.getMyActuals(),
      actualsApi.getMyApprovalStatuses(),
    ])
      .then(([demand, supply, actuals, statuses]) => {
        setMyDemandLines(demand as DemandLine[]);
        setMySupplyLines(supply as SupplyLine[]);
        setMyActuals(actuals as ActualLine[]);
        setMyApprovalStatuses(statuses);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [periods.length, appDataLoading, myResource?.resource_id]);

  const openPeriods = useMemo(
    () => [...periods]
      .filter(p => p.status === 'open')
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month),
    [periods],
  );
  // Use nearest current/future open period so historical open periods don't
  // hijack the KPI strip when past years are present as open.
  const earliestPeriod = useMemo(
    () => getNearestCurrentOrFutureOpenPeriod(periods),
    [periods],
  );
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
    const submitted = [...demandProjectIds].filter(pid =>
      myActuals.some(a => a.project_id === pid && a.period_id === earliestPeriod?.id),
    ).length;
    return { total, submitted };
  }, [myDemandLines, myActuals, earliestPeriod]);

  const approvalStats = useMemo(() => {
    const currentPeriodActualIds = new Set(
      myActuals.filter(a => earliestPeriod && a.period_id === earliestPeriod.id).map(a => a.id)
    );
    const statuses = Object.entries(myApprovalStatuses)
      .filter(([id]) => currentPeriodActualIds.has(id))
      .map(([, s]) => s);
    return {
      approved: statuses.filter(s => s.status === 'approved').length,
      pending:  statuses.filter(s => s.status === 'pending').length,
      rejected: statuses.filter(s => s.status === 'rejected').length,
      total:    statuses.length,
    };
  }, [myApprovalStatuses, myActuals, earliestPeriod]);

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
              {approvalStats.approved} approved · {approvalStats.pending} pending · {approvalStats.rejected} rejected
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

  // ── Chart data ────────────────────────────────────────────────────────────

  const chartData = useMemo(() => {
    return openPeriods.map(p => {
      const demand = Math.round(
        myDemandLines.filter(d => d.period_id === p.id).reduce((s, d) => s + d.fte_percent, 0) * 10,
      ) / 10;
      const supply = Math.round(
        mySupplyLines.filter(s => s.period_id === p.id).reduce((s, ln) => s + ln.fte_percent, 0) * 10,
      ) / 10;
      const periodActuals = myActuals.filter(a => a.period_id === p.id);
      const actualsTotal = periodActuals.length > 0
        ? Math.round(periodActuals.reduce((s, a) => s + a.actual_fte_percent, 0) * 10) / 10
        : undefined;
      const base = Math.min(demand, supply);
      return {
        label: fmtPeriod(p),
        demand,
        supply,
        actuals: actualsTotal,
        base,
        gap_under: demand > supply ? Math.round((demand - supply) * 10) / 10 : 0,
        gap_over:  supply > demand ? Math.round((supply - demand) * 10) / 10 : 0,
      };
    });
  }, [openPeriods, myDemandLines, mySupplyLines, myActuals]);

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
                    const a = payload.find(p => p.dataKey === 'actuals')?.value as number | undefined;
                    const g = (d ?? 0) - (s ?? 0);
                    const gAbs = Math.abs(Math.round(g * 10) / 10);
                    return (
                      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}>
                        <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{label}</p>
                        {d !== undefined && <p style={{ margin: '2px 0', color: DEMAND_COLOR }}>My Demand: {d}%</p>}
                        {s !== undefined && <p style={{ margin: '2px 0', color: SUPPLY_COLOR }}>My Supply: {s}%</p>}
                        {a !== undefined && <p style={{ margin: '2px 0', color: ACTUALS_COLOR }}>My Actuals: {a}%</p>}
                        {gAbs > 0 && (
                          <p style={{ margin: '4px 0 0', color: g > 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
                            {g > 0 ? `Understaffed: ${gAbs}%` : `Overstaffed: ${gAbs}%`}
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                <Legend
                  formatter={v => v === 'demand' ? 'My Demand' : v === 'supply' ? 'My Supply' : 'My Actuals'}
                />
                <ReferenceLine y={100} stroke="#d1d5db" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="base"      stackId="gap" fill="transparent"           stroke="none" legendType="none" tooltipType="none" isAnimationActive={false} />
                <Area type="monotone" dataKey="gap_under" stackId="gap" fill="rgba(217,119,6,0.08)"  stroke="none" legendType="none" isAnimationActive={false} />
                <Area type="monotone" dataKey="gap_over"  stackId="gap" fill="rgba(13,148,136,0.08)" stroke="none" legendType="none" isAnimationActive={false} />
                <Line type="monotone" dataKey="demand"  stroke={DEMAND_COLOR}  strokeWidth={2.5} dot={false} name="demand"  unit="%" />
                <Line type="monotone" dataKey="supply"  stroke={SUPPLY_COLOR}  strokeWidth={2.5} dot={false} name="supply"  unit="%" />
                <Line type="monotone" dataKey="actuals" stroke={ACTUALS_COLOR} strokeWidth={2.5} dot={{ fill: ACTUALS_COLOR, r: 4 }} connectNulls={false} name="actuals" unit="%" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </DashboardSection>

      {/* Personal actuals matrix */}
      <MyActualsMatrix periods={periods} />
    </div>
  );
}
