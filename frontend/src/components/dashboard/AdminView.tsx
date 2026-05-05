import { useEffect, useMemo, useState } from 'react';
import {
  makeStyles,
  tokens,
  Button,
  Skeleton,
  SkeletonItem,
} from '@fluentui/react-components';
import { useNavigate } from 'react-router-dom';
import { DashboardKPICard } from './DashboardKPICard';
import { DashboardSection } from './DashboardSection';
import { FinanceView } from './FinanceView';
import { adminApi, AdminUserDetail, Resource } from '../../api/admin';
import type { DemandLine, SupplyLine } from '../../api/planning';
import type { CostCenter, Project } from '../../api/admin';
import type { Period, MeResponse } from '../../types/index';

const useStyles = makeStyles({
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalL,
  },
  actionsRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: tokens.spacingHorizontalM,
  },
});

interface Props {
  demandLines: DemandLine[];
  supplyLines: SupplyLine[];
  costCenters: CostCenter[];
  projects: Project[];
  periods: Period[];
  approvalStatuses: Record<string, { status: string }>;
  user: MeResponse;
}

export function AdminView({ demandLines, supplyLines, costCenters, periods, approvalStatuses, user }: Props) {
  const styles = useStyles();
  const navigate = useNavigate();

  const [adminUsers, setAdminUsers] = useState<AdminUserDetail[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([adminApi.listAdminUsers(), adminApi.listResources()])
      .then(([users, res]) => {
        setAdminUsers(users);
        setResources(res);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openPeriods = useMemo(
    () => periods.filter(p => p.status === 'open'),
    [periods],
  );

  const activeUsers = adminUsers.filter(u => u.is_active).length;
  const activeResources = resources.filter(r => r.is_active).length;
  const activeCostCenters = costCenters.filter(cc => cc.is_active).length;

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL }}>
        <Skeleton style={{ height: 88 }}><SkeletonItem /></Skeleton>
        <Skeleton style={{ height: 400 }}><SkeletonItem /></Skeleton>
      </div>
    );
  }

  return (
    <div className={styles.sections}>
      {/* System Health KPIs */}
      <div className={styles.kpiGrid}>
        <DashboardKPICard label="Active Users" value={activeUsers} />
        <DashboardKPICard label="Active Resources" value={activeResources} />
        <DashboardKPICard
          label="Open Periods"
          value={openPeriods.length}
          color={openPeriods.length > 0 ? 'success' : 'warning'}
        />
        <DashboardKPICard label="Cost Centers" value={activeCostCenters} />
      </div>

      {/* Finance sections */}
      <FinanceView
        demandLines={demandLines}
        supplyLines={supplyLines}
        costCenters={costCenters}
        periods={periods}
        approvalStatuses={approvalStatuses}
        user={user}
      />

      {/* Quick Actions */}
      <DashboardSection title="Quick Actions">
        <div className={styles.actionsRow}>
          <Button appearance="primary" onClick={() => navigate('/admin?tab=sync')}>
            Run Sync
          </Button>
          <Button appearance="secondary" onClick={() => navigate('/admin?tab=periods')}>
            Manage Periods
          </Button>
          <Button appearance="secondary" onClick={() => navigate('/audit-logs')}>
            View Audit Log
          </Button>
        </div>
      </DashboardSection>
    </div>
  );
}
