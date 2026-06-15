import { useEffect, useState } from 'react';
import {
  makeStyles,
  tokens,
  Title3,
  Skeleton,
  SkeletonItem,
} from '@fluentui/react-components';
import { useAuth, useIsManagerReader, useIsManagerPM } from '../auth/AuthProvider';
import { planningApi } from '../api/planning';
import { actualsApi } from '../api/actuals';
import { lookupsApi } from '../api/lookups';
import { usePeriod } from '../contexts/PeriodContext';
import { useAppData } from '../contexts/AppDataContext';
import type { DemandLine, SupplyLine } from '../api/planning';
import type { Period } from '../types/index';

import { EmployeeView } from '../components/dashboard/EmployeeView';
import { PMDashboard } from '../components/dashboard/PMDashboard';
import { ManagerDashboard } from '../components/dashboard/ManagerDashboard';
import { ManagerPMDashboard } from '../components/dashboard/ManagerPMDashboard';
import { FinanceDashboard } from '../components/dashboard/FinanceDashboard';
import { ReaderView } from '../components/dashboard/ReaderView';
import { AdminView } from '../components/dashboard/AdminView';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    maxWidth: '1800px',
    margin: '0 auto',
    padding: tokens.spacingHorizontalXXL,
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


export function Dashboard() {
  const styles = useStyles();
  const { user } = useAuth();
  const isManagerReader = useIsManagerReader();
  const isManagerPM = useIsManagerPM();
  const { periods, loading: periodsLoading } = usePeriod();
  const { costCenters, projects, myResource, appDataLoading } = useAppData();

  const [allDemandLines, setAllDemandLines] = useState<DemandLine[]>([]);
  const [allSupplyLines, setAllSupplyLines] = useState<SupplyLine[]>([]);
  const [approvalStatuses, setApprovalStatuses] = useState<Record<string, { status: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userCcId, setUserCcId] = useState<string | null>(null);

  useEffect(() => {
    // Wait for context data to be ready before fetching volatile data
    if (!user || periodsLoading || appDataLoading) return;
    setLoading(true);

    const role = user.role;
    const isEmployee = role === 'Employee';

    // Employees see only their own scoped lines, fetched inside EmployeeView. They have no
    // access to the broad planning endpoints (the matrix data), so skip those calls here —
    // issuing them would only produce a 403 and a spurious dashboard error.
    if (isEmployee) {
      setAllDemandLines([]);
      setAllSupplyLines([]);
      setApprovalStatuses({});
      setLoading(false);
      return;
    }

    const openSorted = (periods as Period[])
      .filter(p => p.status === 'open')
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
    const earliest = openSorted[0];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetches: Promise<any>[] = [
      planningApi.getAllDemandLines(),
      planningApi.getAllSupplyLines(),
    ];
    if (earliest) {
      fetches.push(actualsApi.getApprovalStatuses(earliest.year, earliest.month));
    }

    Promise.all(fetches)
      .then(([demand, supply, statuses]) => {
        setAllDemandLines(demand);
        setAllSupplyLines(supply);
        setApprovalStatuses(statuses ?? {});
      })
      .catch((err) => {
        console.error('[Dashboard] Failed to load data:', err);
        setError('Failed to load dashboard data. Please refresh the page.');
      })
      .finally(() => setLoading(false));
  }, [user?.role, periodsLoading, appDataLoading]);

  // Derive the manager's own cost center from their linked resource record (already cached in context)
  // and the scoped resources list (includes the manager's own resource even with no supply lines).
  useEffect(() => {
    if (!user || user.role !== 'Manager' || !myResource) return;
    const rid = myResource.resource_id;
    if (!rid) { setUserCcId(null); return; }
    lookupsApi.listResourcesScoped()
      .then(resources => {
        const userRes = resources.find((r: { id: string; cost_center_id: string }) => r.id === rid);
        setUserCcId(userRes?.cost_center_id ?? null);
      })
      .catch(() => {});
  }, [user?.object_id, user?.role, myResource]);

  if (!user) return null;

  if (loading || periodsLoading || appDataLoading) {
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

  return (
    <div className={styles.container}>

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

      {isManagerPM && (
        <ManagerPMDashboard
          demandLines={allDemandLines}
          supplyLines={allSupplyLines}
          costCenters={costCenters}
          projects={projects}
          periods={periods}
          approvalStatuses={approvalStatuses}
          user={user}
          userCcId={userCcId}
        />
      )}

      {user.role === 'Manager' && !isManagerReader && !isManagerPM && (
        <ManagerDashboard
          demandLines={allDemandLines}
          supplyLines={allSupplyLines}
          costCenters={costCenters}
          periods={periods}
          approvalStatuses={approvalStatuses}
          user={user}
          userCcId={userCcId}
        />
      )}

      {isManagerReader && (
        <ReaderView
          demandLines={allDemandLines}
          supplyLines={allSupplyLines}
          costCenters={costCenters}
          periods={periods}
          approvalStatuses={approvalStatuses}
          projects={projects}
          user={user}
          userCcId={userCcId}
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
          costCenters={costCenters}
          periods={periods}
        />
      )}
    </div>
  );
}
