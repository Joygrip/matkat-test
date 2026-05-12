import { useEffect, useState } from 'react';
import {
  makeStyles,
  tokens,
  Title3,
  Skeleton,
  SkeletonItem,
} from '@fluentui/react-components';
import { useAuth, useIsManagerReader } from '../auth/AuthProvider';
import { planningApi } from '../api/planning';
import { lookupsApi } from '../api/lookups';
import { periodsApi } from '../api/periods';
import { actualsApi } from '../api/actuals';
import type { DemandLine, SupplyLine } from '../api/planning';
import type { CostCenter, Project } from '../api/admin';
import type { Period } from '../types/index';

import { EmployeeView } from '../components/dashboard/EmployeeView';
import { PMDashboard } from '../components/dashboard/PMDashboard';
import { ManagerDashboard } from '../components/dashboard/ManagerDashboard';
import { FinanceDashboard } from '../components/dashboard/FinanceDashboard';
import { ExecutiveDashboard } from '../components/dashboard/ExecutiveDashboard';
import { AdminView } from '../components/dashboard/AdminView';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    maxWidth: '1400px',
    margin: '0 auto',
    padding: `0 ${tokens.spacingHorizontalM}`,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  roleLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  skeletonKpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: tokens.spacingHorizontalM,
  },
  skeletonCard: { height: '88px', borderRadius: '12px' },
  skeletonChart: { height: '240px', borderRadius: '12px' },
  errorState: {
    margin: '80px auto',
    textAlign: 'center',
    color: tokens.colorPaletteRedForeground1,
  },
});

const ROLE_LABELS: Record<string, string> = {
  Employee: 'Employee Dashboard',
  PM: 'Project Manager Dashboard',
  Manager: 'Manager Dashboard',
  Finance: 'Finance Dashboard',
  Admin: 'Admin Dashboard',
};

export function Dashboard() {
  const styles = useStyles();
  const { user } = useAuth();
  const isManagerReader = useIsManagerReader();

  const [allDemandLines, setAllDemandLines] = useState<DemandLine[]>([]);
  const [allSupplyLines, setAllSupplyLines] = useState<SupplyLine[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [approvalStatuses, setApprovalStatuses] = useState<Record<string, { status: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);

    const role = user.role;
    const isEmployee = role === 'Employee';

    // PMs only see their projects via scoped endpoint; Manager is not allowed on scoped so uses listProjects
    const projectsFetch = (role === 'PM' || role === 'Finance' || role === 'Admin')
      ? lookupsApi.listProjectsScoped()
      : lookupsApi.listProjects();

    const fetches: Promise<any>[] = [
      planningApi.getAllDemandLines(),
      planningApi.getAllSupplyLines(),
      lookupsApi.listCostCenters(),
      projectsFetch,
      periodsApi.list(),
    ];

    Promise.all(fetches)
      .then(([demand, supply, ccs, projs, allPeriods]) => {
        setAllDemandLines(demand);
        setAllSupplyLines(supply);
        setCostCenters(ccs);
        setProjects(projs);
        setPeriods(allPeriods);

        // Fetch approval statuses for the earliest open period
        const openSorted = (allPeriods as Period[])
          .filter(p => p.status === 'open')
          .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
        const earliest = openSorted[0];
        if (earliest && !isEmployee) {
          return actualsApi.getApprovalStatuses(earliest.year, earliest.month);
        }
        return {};
      })
      .then((statuses) => {
        setApprovalStatuses(statuses ?? {});
      })
      .catch((err) => {
        console.error('[Dashboard] Failed to load data:', err);
        setError('Failed to load dashboard data. Please refresh the page.');
      })
      .finally(() => setLoading(false));
  }, [user?.role]);

  if (!user) return null;

  if (loading) {
    return (
      <div className={styles.container}>
        <Skeleton style={{ height: 40, width: '30%', marginBottom: tokens.spacingVerticalM }}>
          <SkeletonItem />
        </Skeleton>
        <div className={styles.skeletonKpiRow}>
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className={styles.skeletonCard}><SkeletonItem /></Skeleton>
          ))}
        </div>
        <Skeleton className={styles.skeletonChart}><SkeletonItem /></Skeleton>
        <Skeleton className={styles.skeletonChart}><SkeletonItem /></Skeleton>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <Title3>{error}</Title3>
        </div>
      </div>
    );
  }

  const roleLabel = isManagerReader
    ? 'Executive View'
    : (ROLE_LABELS[user.role] ?? 'Dashboard');

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Title3>Dashboard</Title3>
        <span className={styles.roleLabel}>{roleLabel}</span>
      </div>

      {user.role === 'Employee' && (
        <EmployeeView
          periods={periods}
          user={user}
        />
      )}

      {user.role === 'PM' && (
        <PMDashboard
          demandLines={allDemandLines}
          supplyLines={allSupplyLines}
          projects={projects}
          periods={periods}
          approvalStatuses={approvalStatuses}
          user={user}
        />
      )}

      {user.role === 'Manager' && !isManagerReader && (
        <ManagerDashboard
          demandLines={allDemandLines}
          supplyLines={allSupplyLines}
          costCenters={costCenters}
          periods={periods}
          approvalStatuses={approvalStatuses}
          user={user}
        />
      )}

      {isManagerReader && (
        <ExecutiveDashboard
          demandLines={allDemandLines}
          supplyLines={allSupplyLines}
          costCenters={costCenters}
          periods={periods}
          approvalStatuses={approvalStatuses}
          user={user}
        />
      )}

      {user.role === 'Finance' && (
        <FinanceDashboard
          demandLines={allDemandLines}
          supplyLines={allSupplyLines}
          costCenters={costCenters}
          periods={periods}
          approvalStatuses={approvalStatuses}
          user={user}
        />
      )}

      {user.role === 'Admin' && (
        <AdminView
          demandLines={allDemandLines}
          supplyLines={allSupplyLines}
          costCenters={costCenters}
          projects={projects}
          periods={periods}
          approvalStatuses={approvalStatuses}
          user={user}
        />
      )}
    </div>
  );
}
