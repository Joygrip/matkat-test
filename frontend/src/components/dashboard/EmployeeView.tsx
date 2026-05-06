import { useEffect, useMemo, useState } from 'react';
import {
  makeStyles,
  tokens,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
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
import { DashboardKPICard } from './DashboardKPICard';
import { DashboardSection } from './DashboardSection';
import { actualsApi, ActualLine } from '../../api/actuals';
import { planningApi, DemandLine, SupplyLine } from '../../api/planning';
import type { Period, MeResponse } from '../../types/index';

const useStyles = makeStyles({
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalL,
  },
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  table: { width: '100%' },
  emptyState: {
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
    padding: `${tokens.spacingVerticalXL} 0`,
    fontSize: tokens.fontSizeBase300,
  },
  chartWrap: {
    width: '100%',
  },
});

interface Props {
  periods: Period[];
  user: MeResponse;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function fmtPeriod(p: Period) {
  return `${MONTH_NAMES[p.month - 1]} ${p.year}`;
}

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

  const myDemandThisPeriod = useMemo(() => {
    if (!earliestPeriod) return 0;
    return myDemandLines
      .filter(d => d.period_id === earliestPeriod.id)
      .reduce((sum, d) => sum + (d.fte_percent ?? 0), 0);
  }, [myDemandLines, earliestPeriod]);

  const actualsSubmitted = useMemo(
    () => myActuals.some(a => a.employee_signed_at),
    [myActuals],
  );

  const approvalStatus = useMemo(() => {
    const statuses = Object.values(myApprovalStatuses);
    if (!statuses.length) return 'Not submitted';
    if (statuses.every(s => s.status === 'approved')) return 'Approved';
    if (statuses.some(s => s.status === 'rejected')) return 'Rejected';
    return 'Pending';
  }, [myApprovalStatuses]);

  const myAssignments = useMemo(() => {
    const openPeriodIds = new Set(openPeriods.map(p => p.id));
    return myDemandLines.filter(d => openPeriodIds.has(d.period_id));
  }, [myDemandLines, openPeriods]);

  // Chart: demand vs supply across all open periods
  const chartData = useMemo(() => {
    return openPeriods.map(p => {
      const demand = Math.round(
        myDemandLines
          .filter(d => d.period_id === p.id)
          .reduce((s, d) => s + d.fte_percent, 0) * 10,
      ) / 10;
      const supply = Math.round(
        mySupplyLines
          .filter(s => s.period_id === p.id)
          .reduce((s, ln) => s + ln.fte_percent, 0) * 10,
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

  const periodName = earliestPeriod ? fmtPeriod(earliestPeriod) : '—';

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
      {/* KPI Row */}
      <div className={styles.kpiGrid}>
        <DashboardKPICard
          label="My Demand This Period"
          value={`${Math.round(myDemandThisPeriod)}%`}
          subtitle={periodName}
        />
        <DashboardKPICard
          label="Actuals Submitted"
          value={actualsSubmitted ? 'Yes ✓' : 'Pending ✗'}
          color={actualsSubmitted ? 'success' : 'danger'}
          subtitle={periodName}
        />
        <DashboardKPICard
          label="Approval Status"
          value={approvalStatus}
          color={
            approvalStatus === 'Approved' ? 'success' :
            approvalStatus === 'Rejected' ? 'danger'  :
            approvalStatus === 'Pending'  ? 'warning' :
            'default'
          }
        />
      </div>

      {/* Demand & Supply line chart */}
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
                    const demand = payload.find(p => p.dataKey === 'demand')?.value as number | undefined;
                    const supply = payload.find(p => p.dataKey === 'supply')?.value as number | undefined;
                    const gap = (demand ?? 0) - (supply ?? 0);
                    const gapAbs = Math.abs(Math.round(gap * 10) / 10);
                    return (
                      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}>
                        <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{label}</p>
                        {demand !== undefined && <p style={{ margin: '2px 0', color: '#1e3a5f' }}>My Demand: {demand}%</p>}
                        {supply !== undefined && <p style={{ margin: '2px 0', color: '#16a34a' }}>My Supply: {supply}%</p>}
                        {gapAbs > 0 && (
                          <p style={{ margin: '4px 0 0', color: gap > 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
                            {gap > 0 ? `Understaffed: ${gapAbs}%` : `Overstaffed: ${gapAbs}%`}
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                <Legend formatter={v => v === 'demand' ? 'My Demand' : 'My Supply'} />
                <ReferenceLine y={100} stroke="#d1d5db" strokeDasharray="4 4" />
                {/* Shaded gap areas */}
                <Area type="monotone" dataKey="base"     stackId="gap" fill="transparent" stroke="none" legendType="none" tooltipType="none" isAnimationActive={false} />
                <Area type="monotone" dataKey="gap_under" stackId="gap" fill="#fee2e2" fillOpacity={0.5} stroke="none" legendType="none" isAnimationActive={false} />
                <Area type="monotone" dataKey="gap_over"  stackId="gap" fill="#dcfce7" fillOpacity={0.5} stroke="none" legendType="none" isAnimationActive={false} />
                <Line type="monotone" dataKey="demand" stroke="#1e3a5f" strokeWidth={2.5} dot={false} name="demand" unit="%" />
                <Line type="monotone" dataKey="supply" stroke="#16a34a" strokeWidth={2.5} dot={false} name="supply" unit="%" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </DashboardSection>

      {/* Assignments Table */}
      <DashboardSection title="My Demand Assignments">
        {myAssignments.length === 0 ? (
          <div className={styles.emptyState}>No demand assignments found</div>
        ) : (
          <Table className={styles.table}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Project</TableHeaderCell>
                <TableHeaderCell>Period</TableHeaderCell>
                <TableHeaderCell>FTE%</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {myAssignments.map(d => {
                const period = openPeriods.find(p => p.id === d.period_id);
                return (
                  <TableRow key={d.id}>
                    <TableCell>{d.project_name ?? d.project_id}</TableCell>
                    <TableCell>{period ? fmtPeriod(period) : d.period_id}</TableCell>
                    <TableCell>{d.fte_percent}%</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DashboardSection>
    </div>
  );
}
