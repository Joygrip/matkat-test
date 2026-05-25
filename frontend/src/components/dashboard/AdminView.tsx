import { useEffect, useState } from 'react';
import {
  makeStyles,
  tokens,
  Badge,
  Card,
  Skeleton,
  SkeletonItem,
} from '@fluentui/react-components';
import { DashboardSection } from './DashboardSection';
import { FinanceOverview } from '../shared/FinanceOverview';
import { adminApi, AdminUserDetail, Resource } from '../../api/admin';
import { apiClient } from '../../api/client';
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

// ─── styles ─────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXL,
    padding: '18px 0 60px',
    width: '100%',
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
  cardStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '16px',
    '@media (max-width: 768px)': {
      gridTemplateColumns: '1fr 1fr',
    },
    '@media (max-width: 480px)': {
      gridTemplateColumns: '1fr',
    },
  },
  card: {
    padding: '16px 20px',
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow2,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  cardTitle: {
    fontSize: '10px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    marginBottom: '10px',
  },
  cardBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  line: {
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
    lineHeight: '1.4',
  },
  bold: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  dot: {
    display: 'inline-block',
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    marginRight: '5px',
    verticalAlign: 'middle',
  },
  muted: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    marginTop: '2px',
  },
});

// ─── props ───────────────────────────────────────────────────────────────────

interface Props {
  costCenters: CostCenter[];
  periods: Period[];
}

// ─── component ───────────────────────────────────────────────────────────────

export function AdminView({ costCenters }: Props) {
  const styles = useStyles();

  const [adminUsers, setAdminUsers] = useState<AdminUserDetail[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [syncStatus, setSyncStatus] = useState<{
    last_sync_at: string | null;
    status: string;
    sync_type: string | null;
  } | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      adminApi.listAdminUsers(),
      adminApi.listResources(),
      adminApi.getSyncStatus(),
      apiClient.getHealth().then(() => true).catch(() => false),
    ])
      .then(([users, res, sync, health]) => {
        setAdminUsers(users);
        setResources(res);
        setSyncStatus(sync);
        setHealthOk(health as boolean);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '18px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          {[0, 1, 2, 3].map(i => (
            <Skeleton key={i} style={{ height: 88 }}><SkeletonItem /></Skeleton>
          ))}
        </div>
        <Skeleton style={{ height: 400 }}><SkeletonItem /></Skeleton>
      </div>
    );
  }

  const activeUsers    = adminUsers.filter(u => u.is_active).length;
  const activeResources = resources.filter(r => r.is_active).length;
  const activeCostCenters = costCenters.filter(cc => cc.is_active).length;

  const syncOk = syncStatus !== null
    && syncStatus.last_sync_at !== null
    && syncStatus.status !== 'failed';

  return (
    <div className={styles.root}>
      <div className={styles.cardStrip}>

        {/* Card 1 — System Status */}
        <Card className={styles.card}>
          <div className={styles.cardTitle}>System Status</div>
          <div className={styles.cardBody}>
            <div>
              {healthOk === null
                ? <Badge color="subtle" appearance="filled" size="small">Unknown</Badge>
                : healthOk
                  ? <Badge color="success" appearance="filled" size="small">Healthy</Badge>
                  : <Badge color="danger" appearance="filled" size="small">Error</Badge>
              }
            </div>
            <div className={styles.muted}>API, DB, Auth</div>
          </div>
        </Card>

        {/* Card 2 — Graph Sync */}
        <Card className={styles.card}>
          <div className={styles.cardTitle}>Graph Sync</div>
          <div className={styles.cardBody}>
            <div className={styles.line}>
              Last sync: <span className={styles.bold}>{relativeTime(syncStatus?.last_sync_at)}</span>
            </div>
            <div className={styles.line}>
              Status: <span className={styles.bold} style={{ color: syncOk ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1 }}>
                {syncOk ? 'OK' : 'Error'}
              </span>
            </div>
          </div>
        </Card>

        {/* Card 3 — Notifications */}
        <Card className={styles.card}>
          <div className={styles.cardTitle}>Notifications</div>
          <div className={styles.cardBody}>
            <div className={styles.line}>
              <span
                className={styles.dot}
                style={{ backgroundColor: tokens.colorPaletteGreenBackground3 }}
              />
              <span className={styles.bold}>Scheduler:</span> Running
            </div>
            <div className={styles.line}>Last sent: <span className={styles.bold}>Not available</span></div>
          </div>
        </Card>

        {/* Card 4 — Core Data */}
        <Card className={styles.card}>
          <div className={styles.cardTitle}>Core Data</div>
          <div className={styles.cardBody}>
            <div className={styles.line}>
              <span className={styles.bold}>{activeUsers}</span> Users
              {' · '}
              <span className={styles.bold}>{activeResources}</span> Resources
            </div>
            <div className={styles.line}>
              <span className={styles.bold}>{activeCostCenters}</span> Cost Centers
            </div>
          </div>
        </Card>

      </div>

      {/* ── Resource Allocation Overview ── */}
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
