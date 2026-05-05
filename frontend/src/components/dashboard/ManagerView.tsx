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
  emptySuccess: {
    textAlign: 'center',
    color: tokens.colorPaletteGreenForeground2,
    padding: `${tokens.spacingVerticalXL} 0`,
    fontSize: tokens.fontSizeBase300,
  },
  gapPositive: { color: tokens.colorPaletteGreenForeground2, fontWeight: tokens.fontWeightSemibold },
  gapNegative: { color: tokens.colorPaletteRedForeground2, fontWeight: tokens.fontWeightSemibold },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
});

interface Props {
  demandLines: DemandLine[];  // already backend-scoped to manager's CC
  supplyLines: SupplyLine[];  // already backend-scoped to manager's CC
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

export function ManagerView({ demandLines, supplyLines, costCenters, periods, approvalStatuses }: Props) {
  const styles = useStyles();

  const openPeriods = useMemo(
    () => [...periods].filter(p => p.status === 'open').sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month),
    [periods],
  );
  const earliestPeriod = openPeriods[0] ?? null;

  // Backend scopes getAllDemandLines/getAllSupplyLines to the manager's CC — derive CC from first line
  const myCcId = useMemo(() => {
    const first = supplyLines[0] || demandLines[0];
    return first?.cost_center_id ?? null;
  }, [supplyLines, demandLines]);

  const myCc = useMemo(
    () => costCenters.find(cc => cc.id === myCcId) ?? null,
    [costCenters, myCcId],
  );

  // Lines are already scoped by backend — use directly
  const myDemand = demandLines;
  const mySupply = supplyLines;

  const totalDemand = useMemo(() => {
    if (!earliestPeriod) return 0;
    return myDemand.filter(d => d.period_id === earliestPeriod.id).reduce((s, d) => s + d.fte_percent, 0);
  }, [myDemand, earliestPeriod]);

  const totalSupply = useMemo(() => {
    if (!earliestPeriod) return 0;
    return mySupply.filter(s => s.period_id === earliestPeriod.id).reduce((s, ln) => s + ln.fte_percent, 0);
  }, [mySupply, earliestPeriod]);

  const balance = totalSupply - totalDemand;

  const pendingApprovals = useMemo(
    () => Object.values(approvalStatuses).filter(s => s.status === 'pending').length,
    [approvalStatuses],
  );

  // Resource allocation table: one row per resource in CC for earliest period
  const allocationRows = useMemo(() => {
    if (!earliestPeriod) return [];
    const resourceMap = new Map<string, { name: string; demand: number; supply: number }>();

    myDemand.filter(d => d.period_id === earliestPeriod.id && d.resource_id).forEach(d => {
      const existing = resourceMap.get(d.resource_id!);
      if (existing) {
        existing.demand += d.fte_percent;
      } else {
        resourceMap.set(d.resource_id!, { name: d.resource_name ?? d.resource_id!, demand: d.fte_percent, supply: 0 });
      }
    });
    mySupply.filter(s => s.period_id === earliestPeriod.id).forEach(s => {
      const existing = resourceMap.get(s.resource_id);
      if (existing) {
        existing.supply += s.fte_percent;
      } else {
        resourceMap.set(s.resource_id, { name: s.resource_name ?? s.resource_id, demand: 0, supply: s.fte_percent });
      }
    });

    return Array.from(resourceMap.entries())
      .map(([id, r]) => ({ id, ...r, gap: r.supply - r.demand }))
      .sort((a, b) => a.gap - b.gap);
  }, [myDemand, mySupply, earliestPeriod]);

  // Missing actuals: resources with demand this period who have no entry in approvalStatuses
  const missingActuals = useMemo(() => {
    if (!earliestPeriod) return [];
    const resourcesWithDemand = new Map<string, string>();
    myDemand
      .filter(d => d.period_id === earliestPeriod.id && d.resource_id)
      .forEach(d => resourcesWithDemand.set(d.resource_id!, d.resource_name ?? d.resource_id!));
    return Array.from(resourcesWithDemand.entries())
      .filter(([id]) => !approvalStatuses[id])
      .map(([, name]) => name);
  }, [myDemand, approvalStatuses, earliestPeriod]);

  const periodLabel = earliestPeriod ? `${MONTH_NAMES[earliestPeriod.month - 1]} ${earliestPeriod.year}` : '—';

  return (
    <div className={styles.sections}>
      <div className={styles.kpiGrid}>
        <DashboardKPICard label="Department" value={myCc?.name ?? '—'} subtitle="Your cost center" />
        <DashboardKPICard
          label={`Total Demand — ${periodLabel}`}
          value={`${Math.round(totalDemand)}%`}
        />
        <DashboardKPICard
          label={`Total Supply — ${periodLabel}`}
          value={`${Math.round(totalSupply)}%`}
        />
        <DashboardKPICard
          label="Balance"
          value={`${balance >= 0 ? '+' : ''}${Math.round(balance * 10) / 10}%`}
          color={balance >= 0 ? 'success' : 'danger'}
        />
      </div>

      {/* Pending Approvals */}
      <DashboardSection
        title={
          <span className={styles.sectionTitle}>
            Pending Approvals
            {pendingApprovals > 0 && <Badge color="danger" appearance="filled">{pendingApprovals}</Badge>}
          </span>
        }
      >
        {pendingApprovals === 0 ? (
          <div className={styles.emptySuccess}>No pending approvals ✓</div>
        ) : (
          <Table className={styles.table}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Resource</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(approvalStatuses)
                .filter(([, s]) => s.status === 'pending')
                .map(([key]) => (
                  <TableRow key={key}>
                    <TableCell>
                      {allocationRows.find(r => r.id === key)?.name ?? key}
                    </TableCell>
                    <TableCell>
                      <Badge color="warning" appearance="filled">Pending</Badge>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
      </DashboardSection>

      {/* Resource Allocation Table */}
      <DashboardSection title={`My Team Allocation — ${periodLabel}`}>
        {allocationRows.length === 0 ? (
          <div className={styles.emptyState}>No allocation data for this period</div>
        ) : (
          <Table className={styles.table}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Resource</TableHeaderCell>
                <TableHeaderCell>Demand</TableHeaderCell>
                <TableHeaderCell>Supply</TableHeaderCell>
                <TableHeaderCell>Gap</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocationRows.map(row => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{Math.round(row.demand * 10) / 10}%</TableCell>
                  <TableCell>{Math.round(row.supply * 10) / 10}%</TableCell>
                  <TableCell>
                    <span className={row.gap >= 0 ? styles.gapPositive : styles.gapNegative}>
                      {row.gap >= 0 ? '+' : ''}{Math.round(row.gap * 10) / 10}%
                    </span>
                  </TableCell>
                  <TableCell><StatusBadge gap={row.gap} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DashboardSection>

      {/* Missing Actuals */}
      <DashboardSection
        title={
          <span className={styles.sectionTitle}>
            Missing Actuals
            {missingActuals.length > 0 && <Badge color="danger" appearance="filled">{missingActuals.length}</Badge>}
          </span>
        }
      >
        {missingActuals.length === 0 ? (
          <div className={styles.emptySuccess}>All actuals submitted ✓</div>
        ) : (
          <Table className={styles.table}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Resource</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {missingActuals.map((name, i) => (
                <TableRow key={i}>
                  <TableCell>{name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DashboardSection>
    </div>
  );
}
