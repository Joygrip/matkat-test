import { useEffect, useMemo, useState } from 'react';
import {
  makeStyles,
  tokens,
  Badge,
  Skeleton,
  SkeletonItem,
  Link,
} from '@fluentui/react-components';
import { useNavigate } from 'react-router-dom';
import { DashboardKPIStrip } from '../shared/DashboardKPIStrip';
import { DashboardSection } from './DashboardSection';
import { FinanceOverview } from '../shared/FinanceOverview';
import { adminApi, AdminUserDetail, Resource } from '../../api/admin';
import type { CostCenter } from '../../api/admin';
import type { Period } from '../../types/index';

// ─── helpers ────────────────────────────────────────────────────────────────

function relativeTime(isoString: string | null | undefined): string {
  if (!isoString) return 'Never';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function syncSeverity(isoString: string | null | undefined, status: string): 'good' | 'warn' | 'bad' | 'default' {
  if (!isoString || status === 'never') return 'bad';
  if (status === 'failed') return 'bad';
  const mins = Math.floor((Date.now() - new Date(isoString).getTime()) / 60_000);
  if (mins < 30) return 'good';
  if (mins < 60) return 'warn';
  return 'bad';
}

function nextSyncMins(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const msSinceLast = Date.now() - new Date(isoString).getTime();
  const remaining = Math.max(0, 15 * 60_000 - msSinceLast);
  const mins = Math.ceil(remaining / 60_000);
  return mins <= 0 ? 'overdue' : `${mins} min`;
}

// ─── styles ─────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXL,
    padding: '18px 28px 60px',
    maxWidth: '1480px',
    margin: '0 auto',
  },
  sectionLabel: {
    fontSize: '11px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: tokens.spacingVerticalS,
  },
  statusGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: tokens.spacingHorizontalM,
  },
  statusCard: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '10px',
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  statusCardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  statusCardTitle: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    margin: 0,
  },
  statusCardBody: {
    padding: tokens.spacingHorizontalL,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  statusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
  },
  statusRowLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  mono: {
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground1,
  },
  overviewHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    marginBottom: tokens.spacingVerticalM,
  },
  overviewTitle: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  overviewSubtitle: {
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground3,
  },
});

// ─── status badge helper ─────────────────────────────────────────────────────

function StatusBadge({ sev }: { sev: 'good' | 'warn' | 'bad' | 'default' }) {
  const map = {
    good:    { color: 'success' as const,  label: 'Healthy'  },
    warn:    { color: 'warning' as const,  label: 'Warning'  },
    bad:     { color: 'danger'  as const,  label: 'Error'    },
    default: { color: 'subtle'  as const,  label: 'Unknown'  },
  };
  const { color, label } = map[sev];
  return <Badge color={color} appearance="filled" size="small">{label}</Badge>;
}

// ─── props ───────────────────────────────────────────────────────────────────

interface Props {
  costCenters: CostCenter[];
  periods: Period[];
}

// ─── component ───────────────────────────────────────────────────────────────

export function AdminView({ costCenters, periods }: Props) {
  const styles = useStyles();
  const navigate = useNavigate();

  const [adminUsers, setAdminUsers] = useState<AdminUserDetail[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [syncStatus, setSyncStatus] = useState<{
    last_sync_at: string | null;
    status: string;
    sync_type: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      adminApi.listAdminUsers(),
      adminApi.listResources(),
      adminApi.getSyncStatus(),
    ])
      .then(([users, res, sync]) => {
        setAdminUsers(users);
        setResources(res);
        setSyncStatus(sync);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openPeriods = useMemo(() => periods.filter(p => p.status === 'open'), [periods]);
  const activeCostCenters = useMemo(() => costCenters.filter(cc => cc.is_active), [costCenters]);

  const activeUsers   = adminUsers.filter(u => u.is_active).length;
  const inactiveUsers = adminUsers.filter(u => !u.is_active).length;
  const activeResources = resources.filter(r => r.is_active).length;

  // Unique cost centers represented by active resources
  const resourceCostCenterCount = useMemo(() => {
    const ids = new Set(resources.filter(r => r.is_active).map(r => r.cost_center_id));
    return ids.size;
  }, [resources]);

  const syncSev = syncSeverity(syncStatus?.last_sync_at, syncStatus?.status ?? 'never');

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL, padding: '18px 28px' }}>
        <Skeleton style={{ height: 88 }}><SkeletonItem /></Skeleton>
        <Skeleton style={{ height: 160 }}><SkeletonItem /></Skeleton>
        <Skeleton style={{ height: 400 }}><SkeletonItem /></Skeleton>
      </div>
    );
  }

  // ─── KPI items (6 cards) ──────────────────────────────────────────────────

  const kpiItems = [
    {
      label: 'Active Users',
      value: activeUsers,
      subtitle: `${adminUsers.length} total in system`,
    },
    {
      label: 'Inactive Users',
      value: inactiveUsers,
      severity: inactiveUsers > 0 ? ('warn' as const) : ('default' as const),
      subtitle: `${inactiveUsers} deactivated`,
    },
    {
      label: 'Last Graph Sync',
      value: relativeTime(syncStatus?.last_sync_at),
      severity: syncSev,
      subtitle: syncStatus?.status === 'running'
        ? 'Sync in progress…'
        : `Next in ~${nextSyncMins(syncStatus?.last_sync_at)}`,
    },
    {
      label: 'Open Periods',
      value: openPeriods.length,
      subtitle: openPeriods.length > 0
        ? openPeriods.map(p => `${p.year}-${String(p.month).padStart(2, '0')}`).join(', ')
        : 'No open periods',
    },
    {
      label: 'Notifications',
      value: '—',
      severity: 'default' as const,
      // TODO: wire up when notification log endpoint is available
      subtitle: 'No tracking endpoint yet',
    },
    {
      label: 'Active Resources',
      value: activeResources,
      subtitle: `across ${resourceCostCenterCount} cost center${resourceCostCenterCount !== 1 ? 's' : ''}`,
    },
  ];

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className={styles.root}>

      {/* ── Section 1: System Health KPI Strip ── */}
      <div>
        <div className={styles.sectionLabel}>System Health</div>
        <DashboardKPIStrip items={kpiItems} columns={6} />
      </div>

      {/* ── Section 2: System Status Cards ── */}
      <div>
        <div className={styles.sectionLabel}>System Status</div>
        <div className={styles.statusGrid}>

          {/* Left: Graph Sync Details */}
          <div className={styles.statusCard}>
            <div className={styles.statusCardHeader}>
              <h2 className={styles.statusCardTitle}>Microsoft Graph Sync</h2>
              <StatusBadge sev={syncSev} />
            </div>
            <div className={styles.statusCardBody}>
              <div className={styles.statusRow}>
                <span className={styles.statusRowLabel}>Last successful sync</span>
                <span className={styles.mono}>
                  {syncStatus?.last_sync_at
                    ? new Date(syncStatus.last_sync_at).toLocaleString()
                    : 'Never'}
                </span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusRowLabel}>Sync interval</span>
                <span>Every 15 minutes</span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusRowLabel}>Last sync type</span>
                <span>{syncStatus?.sync_type ?? '—'}</span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusRowLabel}>Status</span>
                <span>{syncStatus?.status ?? 'unknown'}</span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusRowLabel}>Active cost centers</span>
                <span>{activeCostCenters.length}</span>
              </div>
              <div style={{ marginTop: tokens.spacingVerticalXS }}>
                <Link onClick={() => navigate('/admin?tab=sync')} style={{ fontSize: tokens.fontSizeBase200 }}>
                  Go to Sync controls →
                </Link>
              </div>
            </div>
          </div>

          {/* Right: Notification Status */}
          <div className={styles.statusCard}>
            <div className={styles.statusCardHeader}>
              <h2 className={styles.statusCardTitle}>Email Notifications</h2>
              {/* TODO: derive from notification log when endpoint is available */}
              <StatusBadge sev="default" />
            </div>
            <div className={styles.statusCardBody}>
              <div className={styles.statusRow}>
                <span className={styles.statusRowLabel}>From address</span>
                <span className={styles.mono}>matkat-noreply@ferrosanmd.com</span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusRowLabel}>Config status</span>
                {/* TODO: check NOTIFY_FROM_EMAIL resolution via health endpoint */}
                <span style={{ color: tokens.colorPaletteMarigoldForeground2 }}>
                  ⚠ KV reference — verify in Azure
                </span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusRowLabel}>Emails sent (24h)</span>
                <span>Not available</span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusRowLabel}>Last notification</span>
                <span>Not available</span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusRowLabel}>Scheduler</span>
                <span>Azure Functions (daily 08:00 UTC)</span>
              </div>
              <div style={{ marginTop: tokens.spacingVerticalXS }}>
                <Link onClick={() => navigate('/admin?tab=settings')} style={{ fontSize: tokens.fontSizeBase200 }}>
                  Go to Notification settings →
                </Link>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── Section 3: Resource Allocation Overview ── */}
      <DashboardSection
        title={
          <div className={styles.overviewHeader}>
            <span className={styles.overviewTitle}>Resource Allocation Overview</span>
            <span className={styles.overviewSubtitle}>Full staffing and cost center detail — all cost centers, all resources</span>
          </div>
        }
      >
        <FinanceOverview scope="admin" />
      </DashboardSection>

    </div>
  );
}
