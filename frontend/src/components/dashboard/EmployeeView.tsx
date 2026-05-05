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
import type { DemandLine, SupplyLine } from '../../api/planning';
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
    height: '220px',
  },
});

interface Props {
  demandLines: DemandLine[];
  supplyLines: SupplyLine[];
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

export function EmployeeView({ demandLines, supplyLines, periods }: Props) {
  const styles = useStyles();

  const [myResourceId, setMyResourceId] = useState<string | null>(null);
  const [myActuals, setMyActuals] = useState<ActualLine[]>([]);
  const [myApprovalStatuses, setMyApprovalStatuses] = useState<Record<string, { status: string }>>({});
  const [loading, setLoading] = useState(true);

  const openPeriods = useMemo(
    () => [...periods].filter(p => p.status === 'open').sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month),
    [periods],
  );

  const earliestPeriod = openPeriods[0] ?? null;

  useEffect(() => {
    if (!earliestPeriod) { setLoading(false); return; }
    Promise.all([
      actualsApi.getMyResource(),
      actualsApi.getMyActuals(earliestPeriod.year, earliestPeriod.month),
      actualsApi.getMyApprovalStatuses(earliestPeriod.year, earliestPeriod.month),
    ])
      .then(([res, actuals, statuses]) => {
        setMyResourceId(res.resource_id);
        setMyActuals(actuals);
        setMyApprovalStatuses(statuses);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [earliestPeriod?.id]);

  const myDemandThisPeriod = useMemo(() => {
    if (!earliestPeriod || !myResourceId) return 0;
    return demandLines
      .filter(d => d.period_id === earliestPeriod.id && d.resource_id === myResourceId)
      .reduce((sum, d) => sum + (d.fte_percent ?? 0), 0);
  }, [demandLines, earliestPeriod, myResourceId]);

  const actualsSubmitted = useMemo(() => myActuals.some(a => a.employee_signed_at), [myActuals]);

  const approvalStatus = useMemo(() => {
    const statuses = Object.values(myApprovalStatuses);
    if (!statuses.length) return 'Not submitted';
    if (statuses.every(s => s.status === 'approved')) return 'Approved';
    if (statuses.some(s => s.status === 'rejected')) return 'Rejected';
    return 'Pending';
  }, [myApprovalStatuses]);

  const myAssignments = useMemo(() => {
    if (!myResourceId) return [];
    const openPeriodIds = new Set(openPeriods.map(p => p.id));
    return demandLines.filter(d => d.resource_id === myResourceId && openPeriodIds.has(d.period_id));
  }, [demandLines, myResourceId, openPeriods]);

  // Line chart: my demand vs supply across all open periods
  const chartData = useMemo(() => {
    if (!myResourceId) return [];
    return openPeriods.map(p => {
      const demand = Math.round(
        demandLines
          .filter(d => d.resource_id === myResourceId && d.period_id === p.id)
          .reduce((s, d) => s + d.fte_percent, 0) * 10,
      ) / 10;
      const supply = Math.round(
        supplyLines
          .filter(s => s.resource_id === myResourceId && s.period_id === p.id)
          .reduce((s, ln) => s + ln.fte_percent, 0) * 10,
      ) / 10;
      const base = Math.min(demand, supply);
      return {
        label: fmtPeriod(p),
        demand,
        supply,
        base,
        gap_under: demand > supply ? Math.round((demand - supply) * 10) / 10 : 0,
        gap_over: supply > demand ? Math.round((supply - demand) * 10) / 10 : 0,
      };
    });
  }, [openPeriods, demandLines, supplyLines, myResourceId]);

  const periodName = earliestPeriod ? fmtPeriod(earliestPeriod) : '—';

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL }}>
        <Skeleton style={{ height: 88 }}><SkeletonItem /></Skeleton>
        <Skeleton style={{ height: 260 }}><SkeletonItem /></Skeleton>
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
            approvalStatus === 'Rejected' ? 'danger' :
            approvalStatus === 'Pending' ? 'warning' :
            'default'
          }
        />
      </div>

      {/* Demand & Supply line chart */}
      <DashboardSection title="My Resource Planning Overview">
        {chartData.length === 0 ? (
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
                    const demand = payload.find(p => p.dataKey === 'demand')?.value;
                    const supply = payload.find(p => p.dataKey === 'supply')?.value;
                    const gap = ((demand as number) ?? 0) - ((supply as number) ?? 0);
                    const gapAbs = Math.abs(Math.round(gap * 10) / 10);
                    const isUnder = gap > 0;
                    return (
                      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}>
                        <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{label}</p>
                        {demand !== undefined && <p style={{ margin: '2px 0', color: '#1e3a5f' }}>My Demand: {demand}%</p>}
                        {supply !== undefined && <p style={{ margin: '2px 0', color: '#16a34a' }}>My Supply: {supply}%</p>}
                        {gapAbs > 0 && (
                          <p style={{ margin: '4px 0 0', color: isUnder ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
                            {isUnder ? `Understaffed: ${gapAbs}%` : `Overstaffed: ${gapAbs}%`}
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                <Legend formatter={v => v === 'demand' ? 'My Demand' : 'My Supply'} />
                <ReferenceLine y={100} stroke="#e5e7eb" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="base" stackId="gap" fill="transparent" stroke="none" legendType="none" tooltipType="none" isAnimationActive={false} />
                <Area type="monotone" dataKey="gap_under" stackId="gap" fill="#fee2e2" fillOpacity={0.5} stroke="none" legendType="none" name="Understaffed gap" isAnimationActive={false} />
                <Area type="monotone" dataKey="gap_over" stackId="gap" fill="#dcfce7" fillOpacity={0.5} stroke="none" legendType="none" name="Overstaffed gap" isAnimationActive={false} />
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
                const periodLabel = period ? fmtPeriod(period) : d.period_id;
                return (
                  <TableRow key={d.id}>
                    <TableCell>{d.project_name ?? d.project_id}</TableCell>
                    <TableCell>{periodLabel}</TableCell>
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
