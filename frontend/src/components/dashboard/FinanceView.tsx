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
import { DashboardKPICard } from './DashboardKPICard';
import { DashboardSection } from './DashboardSection';
import type { DemandLine, SupplyLine } from '../../api/planning';
import type { CostCenter } from '../../api/admin';
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
  progressBar: {
    height: '6px',
    borderRadius: '3px',
    backgroundColor: tokens.colorNeutralStroke2,
    overflow: 'hidden',
    marginTop: '4px',
  },
  progressFill: {
    height: '100%',
    borderRadius: '3px',
    transition: 'width 0.3s ease',
  },
  progressRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalXS,
  },
  progressLabel: {
    minWidth: '160px',
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
  },
  progressPct: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    minWidth: '40px',
    textAlign: 'right',
  },
  progressWrap: {
    flex: 1,
  },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
});

interface Props {
  demandLines: DemandLine[];
  supplyLines: SupplyLine[];
  costCenters: CostCenter[];
  periods: Period[];
  approvalStatuses: Record<string, { status: string }>;
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

export function FinanceView({ demandLines, supplyLines, costCenters, periods, approvalStatuses }: Props) {
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

  const approvalValues = Object.values(approvalStatuses);
  const totalApprovals = approvalValues.length;
  const approvedCount = approvalValues.filter(s => s.status === 'approved').length;
  const actualsCompletionRate = totalApprovals > 0 ? Math.round((approvedCount / totalApprovals) * 100) : 0;

  // Department rows sorted by gap
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

  // Actuals submission per CC (resources with demand who have submitted vs total)
  const ccActualsStats = useMemo(() => {
    return costCenters.map(cc => {
      const resourcesWithDemand = new Set(
        demandLines
          .filter(d => d.cost_center_id === cc.id && d.period_id === earliestPeriod?.id && d.resource_id)
          .map(d => d.resource_id!),
      );
      const total = resourcesWithDemand.size;
      const submitted = Array.from(resourcesWithDemand).filter(id => approvalStatuses[id]).length;
      const pct = total > 0 ? Math.round((submitted / total) * 100) : 100;
      return { cc, submitted, total, pct };
    }).filter(r => r.total > 0).sort((a, b) => a.pct - b.pct);
  }, [costCenters, demandLines, approvalStatuses, earliestPeriod]);

  // Pending approvals breakdown by CC
  const ccApprovalBreakdown = useMemo(() => {
    return costCenters.map(cc => {
      const ccResourceIds = new Set(
        [...demandLines, ...supplyLines]
          .filter((l: any) => l.cost_center_id === cc.id && l.resource_id)
          .map((l: any) => l.resource_id as string),
      );
      const relevant = Object.entries(approvalStatuses).filter(([id]) => ccResourceIds.has(id));
      const pending = relevant.filter(([, v]) => v.status === 'pending').length;
      const approved = relevant.filter(([, v]) => v.status === 'approved').length;
      const total = relevant.length;
      return { cc, pending, approved, total };
    }).filter(r => r.total > 0);
  }, [costCenters, demandLines, supplyLines, approvalStatuses]);

  const totalPending = approvalValues.filter(s => s.status === 'pending').length;
  const periodLabel = earliestPeriod ? `${MONTH_NAMES[earliestPeriod.month - 1]} ${earliestPeriod.year}` : '—';

  return (
    <div className={styles.sections}>
      <div className={styles.kpiGrid}>
        <DashboardKPICard
          label="Total Planned Labor FTE%"
          value={`${Math.round(totalDemand)}%`}
          subtitle={periodLabel}
        />
        <DashboardKPICard
          label="Total Supply FTE%"
          value={`${Math.round(totalSupply)}%`}
          subtitle={periodLabel}
        />
        <DashboardKPICard
          label="Overall Balance"
          value={`${overallBalance >= 0 ? '+' : ''}${Math.round(overallBalance * 10) / 10}%`}
          color={overallBalance >= 0 ? 'success' : 'danger'}
        />
        <DashboardKPICard
          label="Actuals Completion"
          value={`${actualsCompletionRate}%`}
          color={actualsCompletionRate >= 80 ? 'success' : actualsCompletionRate >= 50 ? 'warning' : 'danger'}
        />
      </div>

      {/* Department Allocation Overview */}
      <DashboardSection title="Department Allocation Overview">
        <Table className={styles.table}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Department</TableHeaderCell>
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

      {/* Actuals Submission Status */}
      <DashboardSection title="Actuals Submission Status">
        {ccActualsStats.length === 0 ? (
          <div className={styles.emptyState}>No actuals data available</div>
        ) : (
          <div>
            {ccActualsStats.map(({ cc, submitted, total, pct }) => (
              <div key={cc.id} className={styles.progressRow}>
                <span className={styles.progressLabel}>{cc.name}</span>
                <div className={styles.progressWrap}>
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{
                        width: `${pct}%`,
                        backgroundColor: pct < 50
                          ? tokens.colorPaletteRedBackground3
                          : pct < 80
                            ? tokens.colorPaletteMarigoldBackground3
                            : tokens.colorPaletteGreenBackground3,
                      }}
                    />
                  </div>
                </div>
                <span className={styles.progressPct} style={{ color: pct < 50 ? tokens.colorPaletteRedForeground2 : tokens.colorNeutralForeground3 }}>
                  {submitted}/{total} ({pct}%)
                </span>
              </div>
            ))}
          </div>
        )}
      </DashboardSection>

      {/* Pending Approvals Summary */}
      <DashboardSection
        title={
          <span className={styles.sectionTitle}>
            Approvals Overview
            {totalPending > 0 && <Badge color="warning" appearance="filled">{totalPending} pending</Badge>}
          </span>
        }
      >
        {ccApprovalBreakdown.length === 0 ? (
          <div className={styles.emptyState}>No approval data available</div>
        ) : (
          <Table className={styles.table}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Department</TableHeaderCell>
                <TableHeaderCell>Pending</TableHeaderCell>
                <TableHeaderCell>Approved</TableHeaderCell>
                <TableHeaderCell>Total</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ccApprovalBreakdown.map(({ cc, pending, approved, total }) => (
                <TableRow key={cc.id}>
                  <TableCell>{cc.name}</TableCell>
                  <TableCell>
                    {pending > 0
                      ? <Badge color="warning" appearance="filled">{pending}</Badge>
                      : <span style={{ color: tokens.colorNeutralForeground3 }}>0</span>}
                  </TableCell>
                  <TableCell>
                    <span style={{ color: tokens.colorPaletteGreenForeground2 }}>{approved}</span>
                  </TableCell>
                  <TableCell>{total}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DashboardSection>
    </div>
  );
}
