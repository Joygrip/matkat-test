import { useMemo } from 'react';
import {
  makeStyles,
  tokens,
  Badge,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
} from '@fluentui/react-components';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { DashboardKPICard } from './DashboardKPICard';
import { DashboardSection } from './DashboardSection';
import type { DemandLine, SupplyLine } from '../../api/planning';
import type { CostCenter, Project } from '../../api/admin';
import type { Period, MeResponse } from '../../types/index';

const useStyles = makeStyles({
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
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
  gapPositive: { color: tokens.colorPaletteGreenForeground2, fontWeight: tokens.fontWeightSemibold },
  gapNegative: { color: tokens.colorPaletteRedForeground2, fontWeight: tokens.fontWeightSemibold },
  chartWrap: {
    width: '100%',
    height: '200px',
  },
});

interface Props {
  demandLines: DemandLine[];
  supplyLines: SupplyLine[];
  costCenters: CostCenter[];
  periods: Period[];
  approvalStatuses: Record<string, { status: string }>;
  projects: Project[];
  user: MeResponse;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function StatusBadge({ gap }: { gap: number }) {
  if (Math.abs(gap) < 0.1) return <Badge color="success" appearance="filled">Balanced</Badge>;
  if (gap < 0) return <Badge color="danger" appearance="filled">Understaffed</Badge>;
  return <Badge color="warning" appearance="filled">Overstaffed</Badge>;
}

export function ReaderView({ demandLines, supplyLines, costCenters, periods, approvalStatuses }: Props) {
  const styles = useStyles();

  const openPeriods = useMemo(
    () => [...periods].filter(p => p.status === 'open').sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month),
    [periods],
  );
  const earliestPeriod = openPeriods[0] ?? null;

  const totalDemand = useMemo(() => {
    if (!earliestPeriod) return 0;
    return demandLines.filter(d => d.period_id === earliestPeriod.id).reduce((s, d) => s + d.fte_percent, 0);
  }, [demandLines, earliestPeriod]);

  const totalSupply = useMemo(() => {
    if (!earliestPeriod) return 0;
    return supplyLines.filter(s => s.period_id === earliestPeriod.id).reduce((s, ln) => s + ln.fte_percent, 0);
  }, [supplyLines, earliestPeriod]);

  const overallBalance = totalSupply - totalDemand;

  const deptRows = useMemo(() => {
    return costCenters.map(cc => {
      const demand = earliestPeriod
        ? demandLines.filter(d => d.cost_center_id === cc.id && d.period_id === earliestPeriod.id).reduce((s, d) => s + d.fte_percent, 0)
        : 0;
      const supply = earliestPeriod
        ? supplyLines.filter(s => s.cost_center_id === cc.id && s.period_id === earliestPeriod.id).reduce((s, ln) => s + ln.fte_percent, 0)
        : 0;
      const gap = supply - demand;
      return { cc, demand, supply, gap };
    }).sort((a, b) => a.gap - b.gap);
  }, [costCenters, demandLines, supplyLines, earliestPeriod]);

  const deptsInConflict = deptRows.filter(r => r.gap < -0.1).length;

  const approvalValues = Object.values(approvalStatuses);
  const totalApprovals = approvalValues.length;
  const approvedCount = approvalValues.filter(s => s.status === 'approved').length;
  const pendingApprovals = approvalValues.filter(s => s.status === 'pending').length;
  const actualsCompletionRate = totalApprovals > 0 ? Math.round((approvedCount / totalApprovals) * 100) : 0;

  // Trend chart data: total demand vs supply across all open periods
  const trendData = useMemo(() => {
    return openPeriods.map(p => {
      const demand = Math.round(demandLines.filter(d => d.period_id === p.id).reduce((s, d) => s + d.fte_percent, 0) * 10) / 10;
      const supply = Math.round(supplyLines.filter(s => s.period_id === p.id).reduce((s, ln) => s + ln.fte_percent, 0) * 10) / 10;
      return {
        label: `${MONTH_NAMES[p.month - 1]} ${p.year}`,
        demand,
        supply,
      };
    });
  }, [openPeriods, demandLines, supplyLines]);

  // Top 10 resource conflicts company-wide
  const topConflicts = useMemo(() => {
    if (!earliestPeriod) return [];
    const resourceMap = new Map<string, { name: string; dept: string; demand: number; supply: number }>();
    demandLines.filter(d => d.period_id === earliestPeriod.id && d.resource_id).forEach(d => {
      const existing = resourceMap.get(d.resource_id!);
      if (existing) {
        existing.demand += d.fte_percent;
      } else {
        resourceMap.set(d.resource_id!, {
          name: d.resource_name ?? d.resource_id!,
          dept: d.cost_center_name ?? '',
          demand: d.fte_percent,
          supply: 0,
        });
      }
    });
    supplyLines.filter(s => s.period_id === earliestPeriod.id).forEach(s => {
      const existing = resourceMap.get(s.resource_id);
      if (existing) existing.supply += s.fte_percent;
    });
    return Array.from(resourceMap.values())
      .map(r => ({ ...r, gap: r.supply - r.demand }))
      .filter(r => r.gap < -0.1)
      .sort((a, b) => a.gap - b.gap)
      .slice(0, 10);
  }, [demandLines, supplyLines, earliestPeriod]);

  return (
    <div className={styles.sections}>
      <div className={styles.kpiGrid}>
        <DashboardKPICard
          label="Overall Balance"
          value={`${overallBalance >= 0 ? '+' : ''}${Math.round(overallBalance * 10) / 10}%`}
          color={overallBalance >= 0 ? 'success' : 'danger'}
          subtitle="Supply − Demand"
        />
        <DashboardKPICard
          label="Departments in Conflict"
          value={deptsInConflict}
          color={deptsInConflict > 0 ? 'danger' : 'success'}
        />
        <DashboardKPICard
          label="Actuals Completion"
          value={`${actualsCompletionRate}%`}
          color={actualsCompletionRate >= 80 ? 'success' : actualsCompletionRate >= 50 ? 'warning' : 'danger'}
        />
        <DashboardKPICard
          label="Pending Approvals"
          value={pendingApprovals}
          color={pendingApprovals > 0 ? 'warning' : 'success'}
        />
      </div>

      {/* Department Health Table */}
      <DashboardSection title="Department Overview">
        <Table className={styles.table}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Department</TableHeaderCell>
              <TableHeaderCell>Location</TableHeaderCell>
              <TableHeaderCell>Demand</TableHeaderCell>
              <TableHeaderCell>Supply</TableHeaderCell>
              <TableHeaderCell>Gap</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deptRows.map(({ cc, demand, supply, gap }) => (
              <TableRow key={cc.id}>
                <TableCell>{cc.name}</TableCell>
                <TableCell>{cc.location ?? '—'}</TableCell>
                <TableCell>{Math.round(demand * 10) / 10}%</TableCell>
                <TableCell>{Math.round(supply * 10) / 10}%</TableCell>
                <TableCell>
                  <span className={gap >= 0 ? styles.gapPositive : styles.gapNegative}>
                    {gap >= 0 ? '+' : ''}{Math.round(gap * 10) / 10}%
                  </span>
                </TableCell>
                <TableCell><StatusBadge gap={gap} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DashboardSection>

      {/* 6-Month Outlook Chart */}
      <DashboardSection title="6-Month Outlook">
        <div className={styles.chartWrap}>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={trendData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} unit="%" />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}>
                      <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{label}</p>
                      {payload.map((p, i) => (
                        <p key={i} style={{ margin: '2px 0', color: p.dataKey === 'demand' ? '#1e3a5f' : '#16a34a' }}>
                          {p.dataKey === 'demand' ? 'Total Demand' : 'Total Supply'}: {p.value}%
                        </p>
                      ))}
                    </div>
                  );
                }}
              />
              <Legend formatter={(value) => value === 'demand' ? 'Total Demand' : 'Total Supply'} />
              <Line type="monotone" dataKey="demand" stroke="#1e3a5f" strokeWidth={2.5} dot={false} name="demand" />
              <Line type="monotone" dataKey="supply" stroke="#16a34a" strokeWidth={2.5} dot={false} name="supply" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </DashboardSection>

      {/* Top Resource Conflicts */}
      {topConflicts.length > 0 && (
        <DashboardSection title="Biggest Resource Conflicts">
          <Table className={styles.table}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Resource</TableHeaderCell>
                <TableHeaderCell>Department</TableHeaderCell>
                <TableHeaderCell>Demand</TableHeaderCell>
                <TableHeaderCell>Supply</TableHeaderCell>
                <TableHeaderCell>Gap</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topConflicts.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{r.dept}</TableCell>
                  <TableCell>{Math.round(r.demand * 10) / 10}%</TableCell>
                  <TableCell>{Math.round(r.supply * 10) / 10}%</TableCell>
                  <TableCell>
                    <span className={styles.gapNegative}>{Math.round(r.gap * 10) / 10}%</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DashboardSection>
      )}
    </div>
  );
}
