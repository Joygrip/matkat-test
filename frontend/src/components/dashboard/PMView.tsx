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
import type { Project } from '../../api/admin';
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
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
});

interface Props {
  demandLines: DemandLine[];
  supplyLines: SupplyLine[];
  projects: Project[];   // already scoped by backend via listProjectsScoped()
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

export function PMView({ demandLines, supplyLines, projects, periods, approvalStatuses }: Props) {
  const styles = useStyles();

  const openPeriods = useMemo(
    () => [...periods].filter(p => p.status === 'open').sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month),
    [periods],
  );
  const earliestPeriod = openPeriods[0] ?? null;

  // projects prop is already PM-scoped (listProjectsScoped); demandLines/supplyLines are
  // backend-scoped for PM role by getAllDemandLines/getAllSupplyLines
  const myProjects = projects;
  const myProjectIds = useMemo(() => new Set(projects.map(p => p.id)), [projects]);

  // Derive project IDs present in demand lines (handles case where project list is empty
  // but demand data exists — ensures table always has something to show)
  const demandProjectIds = useMemo(
    () => new Set(demandLines.map(d => d.project_id)),
    [demandLines],
  );

  // Build rows for all projects that have demand data OR are in the projects list
  const projectRows = useMemo(() => {
    const allProjectIds = new Set([...myProjectIds, ...demandProjectIds]);
    return Array.from(allProjectIds).map(pid => {
      const project = myProjects.find(p => p.id === pid);
      const name = project?.name ?? demandLines.find(d => d.project_id === pid)?.project_name ?? pid;
      const demand = earliestPeriod
        ? demandLines.filter(d => d.project_id === pid && d.period_id === earliestPeriod.id).reduce((s, d) => s + d.fte_percent, 0)
        : 0;
      const supply = earliestPeriod
        ? supplyLines.filter(s => s.project_id === pid && s.period_id === earliestPeriod.id).reduce((s, ln) => s + ln.fte_percent, 0)
        : 0;
      const gap = supply - demand;
      return { id: pid, name, demand, supply, gap };
    }).sort((a, b) => a.gap - b.gap);
  }, [myProjects, myProjectIds, demandProjectIds, demandLines, supplyLines, earliestPeriod]);

  const demandThisPeriod = useMemo(() => {
    if (!earliestPeriod) return 0;
    return demandLines.filter(d => d.period_id === earliestPeriod.id).reduce((s, d) => s + d.fte_percent, 0);
  }, [demandLines, earliestPeriod]);

  const openConflicts = projectRows.filter(r => r.gap < -0.1).length;

  const actualsRate = useMemo(() => {
    const total = Object.values(approvalStatuses).length;
    if (!total) return 0;
    const approved = Object.values(approvalStatuses).filter(s => s.status === 'approved').length;
    return Math.round((approved / total) * 100);
  }, [approvalStatuses]);

  // Resource-level conflicts
  const resourceConflicts = useMemo(() => {
    if (!earliestPeriod) return [];
    const resourceMap = new Map<string, { name: string; project: string; demand: number; supply: number }>();
    demandLines.filter(d => d.period_id === earliestPeriod.id && d.resource_id).forEach(d => {
      const key = `${d.resource_id}-${d.project_id}`;
      const existing = resourceMap.get(key);
      if (existing) {
        existing.demand += d.fte_percent;
      } else {
        resourceMap.set(key, {
          name: d.resource_name ?? d.resource_id ?? '',
          project: d.project_name ?? d.project_id,
          demand: d.fte_percent,
          supply: 0,
        });
      }
    });
    supplyLines.filter(s => s.period_id === earliestPeriod.id && s.project_id).forEach(s => {
      const key = `${s.resource_id}-${s.project_id}`;
      const existing = resourceMap.get(key);
      if (existing) existing.supply += s.fte_percent;
    });
    return Array.from(resourceMap.values())
      .map(r => ({ ...r, gap: r.supply - r.demand }))
      .filter(r => r.gap < -0.1)
      .sort((a, b) => a.gap - b.gap);
  }, [demandLines, supplyLines, earliestPeriod]);

  const periodLabel = earliestPeriod ? `${MONTH_NAMES[earliestPeriod.month - 1]} ${earliestPeriod.year}` : '—';

  return (
    <div className={styles.sections}>
      <div className={styles.kpiGrid}>
        <DashboardKPICard label="Active Projects" value={projectRows.length} />
        <DashboardKPICard
          label="Total Demand"
          value={`${Math.round(demandThisPeriod)}%`}
          subtitle={periodLabel}
        />
        <DashboardKPICard
          label="Open Conflicts"
          value={openConflicts}
          color={openConflicts > 0 ? 'danger' : 'success'}
        />
        <DashboardKPICard
          label="Actuals Rate"
          value={`${actualsRate}%`}
          color={actualsRate >= 80 ? 'success' : actualsRate >= 50 ? 'warning' : 'danger'}
        />
      </div>

      <DashboardSection title="My Projects">
        {projectRows.length === 0 ? (
          <div className={styles.emptyState}>No projects assigned to you</div>
        ) : (
          <Table className={styles.table}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Project Name</TableHeaderCell>
                <TableHeaderCell>Demand</TableHeaderCell>
                <TableHeaderCell>Supply</TableHeaderCell>
                <TableHeaderCell>Gap</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projectRows.map(({ id, name, demand, supply, gap }) => (
                <TableRow key={id}>
                  <TableCell>{name}</TableCell>
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
        )}
      </DashboardSection>

      {resourceConflicts.length > 0 && (
        <DashboardSection
          title={
            <span className={styles.sectionTitle}>
              Resource Conflicts on My Projects
              <Badge color="danger" appearance="filled">{resourceConflicts.length}</Badge>
            </span>
          }
        >
          <Table className={styles.table}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Resource</TableHeaderCell>
                <TableHeaderCell>Project</TableHeaderCell>
                <TableHeaderCell>Demand</TableHeaderCell>
                <TableHeaderCell>Supply</TableHeaderCell>
                <TableHeaderCell>Gap</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resourceConflicts.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{r.project}</TableCell>
                  <TableCell>{Math.round(r.demand * 10) / 10}%</TableCell>
                  <TableCell>{Math.round(r.supply * 10) / 10}%</TableCell>
                  <TableCell>
                    <span className={styles.gapNegative}>
                      {Math.round(r.gap * 10) / 10}%
                    </span>
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
