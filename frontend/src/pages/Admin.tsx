/**
 * Admin page for managing master data.
 */
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Card,
  TabList,
  Tab,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Button,
  Badge,
  Spinner,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
  Input,
  Label,
  Checkbox,
  makeStyles,
  tokens,
  Title3,
  SelectTabEventHandler,
  Select,
  MessageBar,
  MessageBarBody,
  Text,
} from '@fluentui/react-components';
import {
  AddRegular,
  EditRegular,
  DeleteRegular,
  OrganizationRegular,
  FolderRegular,
  PersonRegular,
  PersonQuestionMarkRegular,
  PeopleTeamRegular,
  ChevronRightRegular,
  ArrowSyncRegular,
  AlertRegular,
} from '@fluentui/react-icons';
import {
  adminApi,
  CostCenter,
  Project,
  Resource,
  Placeholder,
  ManagerOverride,
  ApprovalDelegate,
  AdminUser,
  AdminUserDetail,
} from '../api/admin';
import type { UserRole } from '../types';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../auth/AuthProvider';
import { apiClient } from '../api/client';
import { config } from '../config';
import { AdminToolbar } from '../components/admin/AdminToolbar';
import { StatusPill, projectStatus, resourceStatus } from '../components/admin/StatusPill';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  card: {
    padding: tokens.spacingHorizontalL,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.spacingVerticalM,
  },
  tabContent: {
    marginTop: tokens.spacingVerticalL,
  },
  dialogField: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalM,
  },
  checkboxGroup: {
    display: 'flex',
    gap: tokens.spacingHorizontalL,
    flexWrap: 'wrap',
  },
  clickableRow: {
    cursor: 'pointer',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  statusToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
  detailGrid: {
    display: 'grid',
    gap: tokens.spacingVerticalS,
    gridTemplateColumns: '140px 1fr',
  },
  detailLabel: {
    fontWeight: 600,
    color: tokens.colorNeutralForeground2,
  },
  sectionTitle: {
    fontWeight: 600,
    marginBottom: tokens.spacingVerticalS,
    marginTop: tokens.spacingVerticalM,
    color: tokens.colorNeutralForeground1,
  },
  resourceChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    margin: `0 ${tokens.spacingHorizontalXS} ${tokens.spacingVerticalXS} 0`,
    fontSize: tokens.fontSizeBase200,
  },
  emptyHint: {
    color: tokens.colorNeutralForeground3,
    fontStyle: 'italic',
    fontSize: tokens.fontSizeBase200,
  },
  nativeSelect: {
    padding: '8px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    fontSize: tokens.fontSizeBase300,
    width: '100%',
  },
});

type TabValue =
  | 'cost-centers'
  | 'projects'
  | 'resources'
  | 'placeholders'
  | 'manager-overrides'
  | 'delegates'
  | 'users'
  | 'sync'
  | 'notifications';

function DevSeedResetButton() {
  const { showSuccess, showApiError } = useToast();
  const [loading, setLoading] = useState(false);

  const handleReset = async () => {
    if (!window.confirm('This will wipe ALL tenant data and re-seed with example data. Are you sure?')) return;
    setLoading(true);
    try {
      const result = await apiClient.seedReset();
      showSuccess(result.message || 'Seed reset complete. Refresh the page.');
    } catch (err) {
      showApiError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      appearance="outline"
      style={{ borderColor: tokens.colorPaletteRedBorder2, color: tokens.colorPaletteRedForeground1 }}
      onClick={handleReset}
      disabled={loading}
    >
      {loading ? 'Resetting…' : '⚠ Wipe & Re-seed Example Data'}
    </Button>
  );
}

// ── Sync Panel ───────────────────────────────────────────────────────────────

interface StepResult {
  error?: string;
  created?: number;
  skipped?: number;
  errors?: number;
  synced?: number;
  promoted?: number;
  updated?: number;
}

interface FullSyncResult {
  started_at: string;
  finished_at: string;
  duration_seconds: number;
  steps: Record<string, StepResult>;
  total_errors: number;
}

const STEP_LABELS: Record<string, string> = {
  import_users: 'Import Users',
  sync_profiles: 'Sync Profiles & Departments',
  import_departments: 'Import Departments',
  promote_managers: 'Promote Managers',
  create_resources: 'Create Resources',
  assign_cc_managers: 'Assign Cost Center Managers',
};

function getStepStats(key: string, step: StepResult): string {
  if (step.error) return `Error: ${step.error}`;
  switch (key) {
    case 'import_users':      return `created: ${step.created ?? 0}, skipped: ${step.skipped ?? 0}`;
    case 'sync_profiles':     return `synced: ${step.synced ?? 0}, errors: ${step.errors ?? 0}`;
    case 'import_departments':return `created: ${step.created ?? 0}, skipped: ${step.skipped ?? 0}`;
    case 'promote_managers':  return `promoted: ${step.promoted ?? 0}, skipped: ${step.skipped ?? 0}`;
    case 'create_resources':  return `created: ${step.created ?? 0}, skipped: ${step.skipped ?? 0}`;
    case 'assign_cc_managers':return `updated: ${step.updated ?? 0}, skipped: ${step.skipped ?? 0}`;
    default: return JSON.stringify(step);
  }
}

const useSyncPanelStyles = makeStyles({
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    maxWidth: '640px',
  },
  description: {
    color: tokens.colorNeutralForeground2,
  },
  resultCard: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalM,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    marginTop: tokens.spacingVerticalS,
  },
  stepRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: `${tokens.spacingVerticalXS} 0`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  stepStats: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  errorText: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  successText: {
    color: tokens.colorStatusSuccessForeground1,
  },
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    paddingTop: tokens.spacingVerticalS,
  },
});

function SyncPanel() {
  const syncStyles = useSyncPanelStyles();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FullSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleRunSync = async () => {
    setLoading(true);
    setResult(null);
    setSyncError(null);
    try {
      const data = await apiClient.post<FullSyncResult>('/admin/sync/full');
      setResult(data);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={syncStyles.panel}>
      <Text className={syncStyles.description}>
        Synchronize users, departments, managers and resources from Microsoft Entra ID.
        This will import new users, update profiles, promote managers and assign cost centers.
      </Text>
      <MessageBar intent="warning">
        <MessageBarBody>
          Full sync may take 1–2 minutes. Do not close this page while sync is running.
        </MessageBarBody>
      </MessageBar>
      <div>
        <Button
          appearance="primary"
          icon={loading ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
          disabled={loading}
          onClick={handleRunSync}
        >
          {loading ? 'Syncing...' : 'Run Full Sync'}
        </Button>
      </div>
      {syncError && (
        <MessageBar intent="error">
          <MessageBarBody>{syncError}</MessageBarBody>
        </MessageBar>
      )}
      {result && (
        <div className={syncStyles.resultCard}>
          <Text weight="semibold">Sync completed in {result.duration_seconds}s</Text>
          {Object.entries(result.steps).map(([key, step]) => (
            <div key={key} className={syncStyles.stepRow}>
              <Text weight="semibold">{STEP_LABELS[key] ?? key}</Text>
              <Text className={step.error ? syncStyles.errorText : syncStyles.stepStats}>
                {getStepStats(key, step)}
              </Text>
            </div>
          ))}
          <div className={syncStyles.totalRow}>
            <Text weight="semibold">Total errors</Text>
            <Text
              weight="semibold"
              className={result.total_errors > 0 ? syncStyles.errorText : syncStyles.successText}
            >
              {result.total_errors}
            </Text>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Notification Schedules & Logs Panel ──────────────────────────────────────

interface NotificationScheduleItem {
  id: string;
  notification_type: string;
  trigger_type: string;
  trigger_value: number;
  time_of_day: string;
  is_active: boolean;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
}

interface NotificationLogEntry {
  id: string;
  phase: string;
  year: number;
  month: number;
  recipient_email: string | null;
  status: string;
  message: string | null;
  run_id: string;
  resource_id: string | null;
  created_at: string;
  sent_at: string | null;
}

const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  conflict_alerts: 'Conflict Alerts',
  missing_actuals: 'Missing Actuals Reminder',
  planning_reminder: 'Planning Reminder',
  approval_reminder: 'Approval Reminder',
};

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function triggerLabel(type: string, value: number): string {
  switch (type) {
    case 'day_of_month': return `${ordinal(value)} of each month`;
    case 'day_of_week': return `Every ${DAYS_OF_WEEK[value] ?? value}`;
    case 'days_before_period_close': return `${value} day${value !== 1 ? 's' : ''} before period close`;
    default: return String(value);
  }
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

const useNotifPanelStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXL },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.spacingVerticalM,
  },
  dialogField: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalM,
  },
  nativeSelect: {
    padding: '8px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    fontSize: tokens.fontSizeBase300,
    width: '100%',
  },
  statusBadge: { minWidth: '60px', justifyContent: 'center' },
});

function NotificationsPanel() {
  const panelStyles = useNotifPanelStyles();
  const { showSuccess, showApiError } = useToast();

  const [schedules, setSchedules] = useState<NotificationScheduleItem[]>([]);
  const [logs, setLogs] = useState<NotificationLogEntry[]>([]);
  const [schedLoading, setSchedLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editSched, setEditSched] = useState<NotificationScheduleItem | null>(null);
  const [form, setForm] = useState<Partial<NotificationScheduleItem>>({
    notification_type: 'conflict_alerts',
    trigger_type: 'day_of_month',
    trigger_value: 1,
    time_of_day: '07:00',
    is_active: true,
  });

  const loadSchedules = useCallback(async () => {
    setSchedLoading(true);
    try {
      const data = await apiClient.get<NotificationScheduleItem[]>('/notification-schedules');
      setSchedules(data);
    } catch (err) {
      showApiError(err as Error);
    } finally {
      setSchedLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const data = await apiClient.get<NotificationLogEntry[]>('/notifications/logs');
      setLogs(data.slice(0, 50));
    } catch (err) {
      showApiError(err as Error);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSchedules();
    loadLogs();
  }, []);

  const openCreate = () => {
    setEditSched(null);
    setForm({ notification_type: 'conflict_alerts', trigger_type: 'day_of_month', trigger_value: 1, time_of_day: '07:00', is_active: true });
    setDialogOpen(true);
  };

  const openEdit = (s: NotificationScheduleItem) => {
    setEditSched(s);
    setForm({ notification_type: s.notification_type, trigger_type: s.trigger_type, trigger_value: s.trigger_value, time_of_day: s.time_of_day, is_active: s.is_active });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      const payload = {
        notification_type: form.notification_type!,
        trigger_type: form.trigger_type!,
        trigger_value: Number(form.trigger_value),
        time_of_day: form.time_of_day!,
        is_active: form.is_active ?? true,
      };
      if (editSched) {
        await apiClient.put<NotificationScheduleItem>(`/notification-schedules/${editSched.id}`, payload);
        showSuccess('Schedule updated');
      } else {
        await apiClient.post<NotificationScheduleItem>('/notification-schedules', payload);
        showSuccess('Schedule created');
      }
      setDialogOpen(false);
      loadSchedules();
    } catch (err) {
      showApiError(err as Error);
    }
  };

  const handleToggleActive = async (s: NotificationScheduleItem) => {
    try {
      await apiClient.put<NotificationScheduleItem>(`/notification-schedules/${s.id}`, { is_active: !s.is_active });
      setSchedules((prev) => prev.map((x) => (x.id === s.id ? { ...x, is_active: !s.is_active } : x)));
    } catch (err) {
      showApiError(err as Error);
    }
  };

  const handleDelete = async (s: NotificationScheduleItem) => {
    if (!confirm('Delete this schedule?')) return;
    try {
      await apiClient.delete<{ message: string }>(`/notification-schedules/${s.id}`);
      showSuccess('Schedule deleted');
      loadSchedules();
    } catch (err) {
      showApiError(err as Error);
    }
  };

  const handleRunNow = async (s: NotificationScheduleItem) => {
    setRunningId(s.id);
    try {
      await apiClient.post(`/notification-schedules/${s.id}/run`);
      showSuccess('Triggered', `${NOTIFICATION_TYPE_LABELS[s.notification_type] ?? s.notification_type} sent`);
      loadSchedules();
      loadLogs();
    } catch (err) {
      showApiError(err as Error);
    } finally {
      setRunningId(null);
    }
  };

  const handleRetryFailed = async () => {
    setRetrying(true);
    try {
      await apiClient.post('/notifications/retry-failed');
      showSuccess('Retry complete');
      loadLogs();
    } catch (err) {
      showApiError(err as Error);
    } finally {
      setRetrying(false);
    }
  };

  const triggerValueInput = () => {
    const trigType = form.trigger_type;
    if (trigType === 'day_of_week') {
      return (
        <select
          className={panelStyles.nativeSelect}
          value={String(form.trigger_value ?? 0)}
          onChange={(e) => setForm({ ...form, trigger_value: Number(e.target.value) })}
        >
          {DAYS_OF_WEEK.map((day, i) => <option key={i} value={i}>{day}</option>)}
        </select>
      );
    }
    const [min, max] = trigType === 'days_before_period_close' ? [1, 14] : [1, 28];
    return (
      <input
        type="number"
        min={min}
        max={max}
        value={form.trigger_value ?? 1}
        onChange={(e) => setForm({ ...form, trigger_value: Number(e.target.value) })}
        style={{ padding: '8px', borderRadius: tokens.borderRadiusMedium, border: `1px solid ${tokens.colorNeutralStroke1}`, fontSize: tokens.fontSizeBase300, width: '100%' }}
      />
    );
  };

  const logStatusColor = (s: string): 'success' | 'danger' | 'subtle' => {
    if (s === 'sent') return 'success';
    if (s === 'failed') return 'danger';
    return 'subtle';
  };

  return (
    <div className={panelStyles.root}>
      {/* Section A — Schedules */}
      <div>
        <div className={panelStyles.sectionHeader}>
          <Title3>Notification Schedules</Title3>
          <Button appearance="primary" icon={<AddRegular />} onClick={openCreate}>
            Add Schedule
          </Button>
        </div>

        {schedLoading ? (
          <Spinner label="Loading schedules…" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Trigger</TableHeaderCell>
                <TableHeaderCell>Time (UTC)</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Last Run</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Text style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>
                      No schedules configured. Add one to automate notifications.
                    </Text>
                  </TableCell>
                </TableRow>
              )}
              {schedules.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{NOTIFICATION_TYPE_LABELS[s.notification_type] ?? s.notification_type}</TableCell>
                  <TableCell>{triggerLabel(s.trigger_type, s.trigger_value)}</TableCell>
                  <TableCell>{s.time_of_day}</TableCell>
                  <TableCell>
                    <Badge
                      className={panelStyles.statusBadge}
                      appearance="filled"
                      color={s.is_active ? 'success' : 'subtle'}
                    >
                      {s.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>{relativeTime(s.last_run_at)}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      appearance="subtle"
                      title={s.is_active ? 'Deactivate' : 'Activate'}
                      onClick={() => handleToggleActive(s)}
                    >
                      {s.is_active ? 'Disable' : 'Enable'}
                    </Button>
                    <Button size="small" appearance="subtle" icon={<EditRegular />} title="Edit" onClick={() => openEdit(s)} />
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={runningId === s.id ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
                      title="Run now"
                      disabled={runningId === s.id}
                      onClick={() => handleRunNow(s)}
                    />
                    <Button size="small" appearance="subtle" icon={<DeleteRegular />} title="Delete" onClick={() => handleDelete(s)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Section B — Logs */}
      <div>
        <div className={panelStyles.sectionHeader}>
          <Title3>Notification Logs</Title3>
          <Button
            appearance="secondary"
            disabled={retrying}
            icon={retrying ? <Spinner size="tiny" /> : undefined}
            onClick={handleRetryFailed}
          >
            {retrying ? 'Retrying…' : 'Retry Failed'}
          </Button>
        </div>

        {logsLoading ? (
          <Spinner label="Loading logs…" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Period</TableHeaderCell>
                <TableHeaderCell>Recipient</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Sent At</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Text style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>No notification logs.</Text>
                  </TableCell>
                </TableRow>
              )}
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{log.phase}</TableCell>
                  <TableCell>{log.year}/{String(log.month).padStart(2, '0')}</TableCell>
                  <TableCell>{log.recipient_email ?? '—'}</TableCell>
                  <TableCell>
                    <Badge appearance="filled" color={logStatusColor(log.status)}>
                      {log.status.charAt(0).toUpperCase() + log.status.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell>{log.sent_at ? relativeTime(log.sent_at) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(_, d) => setDialogOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{editSched ? 'Edit Schedule' : 'Add Schedule'}</DialogTitle>
            <DialogContent>
              <div className={panelStyles.dialogField}>
                <Label required>Notification Type</Label>
                <select
                  className={panelStyles.nativeSelect}
                  value={form.notification_type ?? 'conflict_alerts'}
                  onChange={(e) => setForm({ ...form, notification_type: e.target.value })}
                >
                  <option value="conflict_alerts">Conflict Alerts</option>
                  <option value="missing_actuals">Missing Actuals Reminder</option>
                  <option value="planning_reminder">Planning Reminder</option>
                  <option value="approval_reminder">Approval Reminder</option>
                </select>
              </div>
              <div className={panelStyles.dialogField}>
                <Label required>Trigger Type</Label>
                <select
                  className={panelStyles.nativeSelect}
                  value={form.trigger_type ?? 'day_of_month'}
                  onChange={(e) => setForm({ ...form, trigger_type: e.target.value, trigger_value: 1 })}
                >
                  <option value="day_of_month">On a specific day of the month</option>
                  <option value="day_of_week">On a specific day of the week</option>
                  <option value="days_before_period_close">X days before period closes</option>
                </select>
              </div>
              <div className={panelStyles.dialogField}>
                <Label required>
                  {form.trigger_type === 'day_of_month' && 'Day of month (1–28)'}
                  {form.trigger_type === 'day_of_week' && 'Day of week'}
                  {form.trigger_type === 'days_before_period_close' && 'Days before period close (1–14)'}
                  {!form.trigger_type && 'Trigger value'}
                </Label>
                {triggerValueInput()}
              </div>
              <div className={panelStyles.dialogField}>
                <Label required>Time (UTC)</Label>
                <input
                  type="time"
                  value={form.time_of_day ?? '07:00'}
                  onChange={(e) => setForm({ ...form, time_of_day: e.target.value })}
                  style={{ padding: '8px', borderRadius: tokens.borderRadiusMedium, border: `1px solid ${tokens.colorNeutralStroke1}`, fontSize: tokens.fontSizeBase300 }}
                />
              </div>
              <Checkbox
                label="Active"
                checked={form.is_active !== false}
                onChange={(_, d) => setForm({ ...form, is_active: d.checked as boolean })}
              />
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button appearance="primary" onClick={handleSave}>Save</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}

export function Admin() {
  const styles = useStyles();
  const { showSuccess, showApiError } = useToast();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [selectedTab, setSelectedTab] = useState<TabValue>(searchParams.get('tab') ?? 'cost-centers');
  const [loading, setLoading] = useState(true);

  const canManageMasterData = user?.role === 'Admin' || user?.role === 'Finance';
  const canManageSettings = user?.role === 'Admin';
  const canManageDelegates = user?.role === 'Admin' || user?.role === 'Finance' || user?.role === 'Manager';

  // Data
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [managerOverrides, setManagerOverrides] = useState<ManagerOverride[]>([]);
  const [delegates, setDelegates] = useState<ApprovalDelegate[]>([]);
  const [pmUsers, setPmUsers] = useState<AdminUser[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUserDetail[]>([]);

  // Filter state
  const [searchText, setSearchText] = useState('');
  const [filterCostCenter, setFilterCostCenter] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<unknown>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  // Detail dialog state (cost center resources, resource/placeholder details)
  const [detailItem, setDetailItem] = useState<CostCenter | Resource | Placeholder | null>(null);
  const [detailType, setDetailType] = useState<'cost-center' | 'resource' | 'placeholder' | null>(null);
  const [detailResources, setDetailResources] = useState<Resource[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      switch (selectedTab) {
        case 'cost-centers': {
          const [ccs, mgrs] = await Promise.all([
            adminApi.listCostCenters(),
            canManageMasterData ? adminApi.listUsers('Manager') : Promise.resolve([]),
          ]);
          setCostCenters(ccs);
          setPmUsers(mgrs);
          break;
        }
        case 'projects': {
          const [projs, pms] = await Promise.all([
            adminApi.listProjects(),
            canManageMasterData ? adminApi.listUsers('PM') : Promise.resolve([]),
          ]);
          setProjects(projs);
          setPmUsers(pms);
          break;
        }
        case 'resources': {
          const [resData, ccData] = await Promise.all([
            adminApi.listResources(),
            adminApi.listCostCenters(),
          ]);
          setResources(resData);
          setCostCenters(ccData);
          break;
        }
        case 'placeholders': {
          const [phData, ccData2] = await Promise.all([
            adminApi.listPlaceholders(),
            adminApi.listCostCenters(),
          ]);
          setPlaceholders(phData);
          setCostCenters(ccData2);
          break;
        }
        case 'manager-overrides':
          if (canManageSettings) setManagerOverrides(await adminApi.listManagerOverrides());
          break;
        case 'delegates':
          if (canManageDelegates) {
            const [dels, mgrs] = await Promise.all([adminApi.listDelegates(), adminApi.listUsers()]);
            setDelegates(dels);
            setPmUsers(mgrs);
          }
          break;
        case 'users':
          if (canManageSettings) setAdminUsers(await adminApi.listAdminUsers());
          break;
      }
    } catch (error) {
      showApiError(error as Error, 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, [selectedTab, canManageMasterData, canManageSettings, canManageDelegates]);

  useEffect(() => {
    loadData();
    setSearchText('');
    setFilterCostCenter('');
    setFilterStatus('');
  }, [selectedTab]);

  const handleTabSelect: SelectTabEventHandler = (_, data) => {
    setSelectedTab(data.value as TabValue);
  };

  const openCreateDialog = () => {
    setEditItem(null);
    setFormData({});
    setDialogOpen(true);
  };

  const openEditDialog = (item: unknown) => {
    setEditItem(item);
    setFormData(item as Record<string, unknown>);
    setDialogOpen(true);
  };

  const openCostCenterDetail = async (cc: CostCenter) => {
    setDetailItem(cc);
    setDetailType('cost-center');
    setDetailResources([]);
    setDetailLoading(true);
    try {
      const res = await adminApi.listResources();
      setDetailResources(res.filter((r) => r.cost_center_id === cc.id));
    } catch {
      setDetailResources([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      switch (selectedTab) {
        case 'cost-centers':
          if (editItem) {
            await adminApi.updateCostCenter((editItem as CostCenter).id, formData as Partial<CostCenter>);
          } else {
            await adminApi.createCostCenter(formData as { code: string; name: string; ro_user_id?: string; director_user_id?: string });
          }
          break;
        case 'projects':
          if (editItem) {
            await adminApi.updateProject((editItem as Project).id, formData as Partial<Project>);
          } else {
            await adminApi.createProject({
              code: formData.code as string,
              name: formData.name as string,
              pm_user_ids: (formData.pm_user_ids as string[]) || undefined,
            });
          }
          break;
        case 'resources':
          if (editItem) {
            await adminApi.updateResource((editItem as Resource).id, formData as Partial<Resource>);
          } else {
            await adminApi.createResource(formData as {
              cost_center_id: string;
              employee_id: string;
              display_name: string;
              initials?: string;
              resource_type?: string;
            });
          }
          break;
        case 'placeholders':
          if (editItem) {
            await adminApi.updatePlaceholder((editItem as Placeholder).id, formData as Partial<Placeholder>);
          } else {
            const cost_center_id = formData.cost_center_id as string;
            if (!cost_center_id?.trim()) {
              showApiError(new Error('Cost center is required'), 'Validation');
              return;
            }
            await adminApi.createPlaceholder({
              cost_center_id: cost_center_id.trim(),
              name: (formData.name as string) || undefined,
              description: (formData.description as string) || undefined,
              skill_profile: (formData.skill_profile as string) || undefined,
            });
          }
          break;
        case 'manager-overrides':
          if (!canManageSettings) {
            showApiError(new Error('Only Admin can manage overrides'), 'Permission denied');
            return;
          }
          if (editItem) {
            await adminApi.patchManagerOverride(
              (editItem as ManagerOverride).id,
              { is_active: formData.is_active as boolean, note: formData.note as string | undefined },
            );
          } else {
            await adminApi.createManagerOverride(formData as { employee_object_id: string; manager_object_id: string; note?: string });
          }
          break;
        case 'delegates':
          if (editItem) {
            await adminApi.patchDelegate(
              (editItem as ApprovalDelegate).id,
              { is_active: formData.is_active as boolean, note: formData.note as string | undefined },
            );
          } else {
            if (!(formData.delegate_id as string)) {
              showApiError(new Error('Delegate is required'), 'Validation');
              return;
            }
            if (user?.role !== 'Manager' && !(formData.delegator_id as string)) {
              showApiError(new Error('Delegator is required'), 'Validation');
              return;
            }
            await adminApi.createDelegate({
              ...(user?.role !== 'Manager' && { delegator_id: formData.delegator_id as string }),
              delegate_id: formData.delegate_id as string,
              note: formData.note as string | undefined,
            });
          }
          break;
      }

      showSuccess('Saved', `${selectedTab} saved successfully`);
      setDialogOpen(false);
      loadData();
    } catch (error) {
      showApiError(error as Error, 'Failed to save');
    }
  };

  const handleDelete = async (item: unknown) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    try {
      switch (selectedTab) {
        case 'cost-centers':
          await adminApi.deleteCostCenter((item as CostCenter).id);
          break;
        case 'projects':
          await adminApi.deleteProject((item as Project).id);
          break;
        case 'resources':
          await adminApi.deleteResource((item as Resource).id);
          break;
        case 'placeholders':
          await adminApi.deletePlaceholder((item as Placeholder).id);
          break;
        case 'manager-overrides':
          await adminApi.deleteManagerOverride((item as ManagerOverride).id);
          break;
        case 'delegates':
          await adminApi.deleteDelegate((item as ApprovalDelegate).id);
          break;
      }
      showSuccess('Deleted', 'Item deleted successfully');
      loadData();
    } catch (error) {
      showApiError(error as Error, 'Failed to delete');
    }
  };

  // ── Filter helpers ────────────────────────────────────────────────────────

  const filterCostCenterOptions = costCenters.map((cc) => ({ value: cc.id, label: cc.name }));

  const filteredCostCenters = costCenters.filter((cc) => {
    const q = searchText.toLowerCase();
    return !q || cc.code.toLowerCase().includes(q) || cc.name.toLowerCase().includes(q);
  });

  const filteredProjects = projects.filter((p) => {
    const q = searchText.toLowerCase();
    const matchSearch = !q || p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
    const matchStatus =
      !filterStatus ||
      (filterStatus === 'active' && p.is_active) ||
      (filterStatus === 'on_hold' && !p.is_active);
    return matchSearch && matchStatus;
  });

  const filteredResources = resources.filter((r) => {
    const q = searchText.toLowerCase();
    const matchSearch =
      !q ||
      r.display_name.toLowerCase().includes(q) ||
      r.employee_id.toLowerCase().includes(q) ||
      (r.email ?? '').toLowerCase().includes(q);
    const matchCC = !filterCostCenter || r.cost_center_id === filterCostCenter;
    return matchSearch && matchCC;
  });

  const filteredPlaceholders = placeholders.filter((ph) => {
    const q = searchText.toLowerCase();
    const matchSearch =
      !q ||
      ph.name.toLowerCase().includes(q) ||
      (ph.skill_profile ?? '').toLowerCase().includes(q) ||
      (ph.cost_center_name ?? '').toLowerCase().includes(q);
    const matchCC = !filterCostCenter || ph.cost_center_id === filterCostCenter;
    return matchSearch && matchCC;
  });

  const filteredAdminUsers = adminUsers.filter((u) => {
    const q = searchText.toLowerCase();
    const matchSearch = !q || u.display_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchRole = !filterStatus || u.role === filterStatus;
    return matchSearch && matchRole;
  });

  const clearFilters = () => {
    setSearchText('');
    setFilterCostCenter('');
    setFilterStatus('');
  };

  const pmNamesForProject = (ids: string[]) =>
    ids.length === 0
      ? '—'
      : ids.map((id) => pmUsers.find((u) => u.id === id)?.display_name ?? id).join(', ');

  // ── Table renderers ──────────────────────────────────────────────────────

  const renderTable = () => {
    if (selectedTab === 'sync') return <SyncPanel />;
    if (selectedTab === 'notifications') return <NotificationsPanel />;
    if (loading) return <Spinner label="Loading..." />;

    switch (selectedTab) {
      case 'cost-centers':
        return (
          <>
            <AdminToolbar
              searchValue={searchText}
              onSearchChange={setSearchText}
              searchPlaceholder="Search by code or name…"
              onClear={clearFilters}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Code</TableHeaderCell>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCostCenters.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Text className={styles.emptyHint}>No cost centers match the current filter.</Text>
                    </TableCell>
                  </TableRow>
                )}
                {filteredCostCenters.map((cc) => (
                  <TableRow
                    key={cc.id}
                    className={styles.clickableRow}
                    onClick={() => openCostCenterDetail(cc)}
                  >
                    <TableCell>{cc.code}</TableCell>
                    <TableCell>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {cc.name}
                        <ChevronRightRegular style={{ color: tokens.colorNeutralForeground3, fontSize: 14 }} />
                      </span>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {canManageMasterData && (
                        <>
                          <Button icon={<EditRegular />} appearance="subtle" onClick={() => openEditDialog(cc)} />
                          <Button icon={<DeleteRegular />} appearance="subtle" onClick={() => handleDelete(cc)} />
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        );

      case 'projects':
        return (
          <>
            <AdminToolbar
              searchValue={searchText}
              onSearchChange={setSearchText}
              searchPlaceholder="Search by code or name…"
              filterValue={filterStatus}
              onFilterChange={setFilterStatus}
              filterOptions={[
                { value: 'active', label: 'Active' },
                { value: 'on_hold', label: 'On Hold' },
              ]}
              filterPlaceholder="All statuses"
              onClear={clearFilters}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Code</TableHeaderCell>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Project Manager</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProjects.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Text className={styles.emptyHint}>No projects match the current filter.</Text>
                    </TableCell>
                  </TableRow>
                )}
                {filteredProjects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>{project.code}</TableCell>
                    <TableCell>{project.name}</TableCell>
                    <TableCell>{pmNamesForProject(project.pm_user_ids)}</TableCell>
                    <TableCell>
                      {canManageMasterData ? (
                        <div className={styles.statusToggle}>
                          <StatusPill status={projectStatus(project.is_active)} />
                          <Select
                            size="small"
                            value={project.is_active ? 'active' : 'on_hold'}
                            onChange={async (_, d) => {
                              const newStatus = d.value === 'active';
                              try {
                                await adminApi.updateProject(project.id, { is_active: newStatus });
                                setProjects((prev) =>
                                  prev.map((p) => (p.id === project.id ? { ...p, is_active: newStatus } : p))
                                );
                                showSuccess('Status updated');
                              } catch (err) {
                                showApiError(err);
                              }
                            }}
                            style={{ minWidth: 100 }}
                          >
                            <option value="active">Active</option>
                            <option value="on_hold">On Hold</option>
                          </Select>
                        </div>
                      ) : (
                        <StatusPill status={projectStatus(project.is_active)} />
                      )}
                    </TableCell>
                    <TableCell>
                      {canManageMasterData && (
                        <>
                          <Button icon={<EditRegular />} appearance="subtle" onClick={() => openEditDialog(project)} />
                          <Button icon={<DeleteRegular />} appearance="subtle" onClick={() => handleDelete(project)} />
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        );

      case 'resources':
        return (
          <>
            <AdminToolbar
              searchValue={searchText}
              onSearchChange={setSearchText}
              searchPlaceholder="Search by name or employee ID…"
              filterValue={filterCostCenter}
              onFilterChange={setFilterCostCenter}
              filterOptions={filterCostCenterOptions}
              filterPlaceholder="All cost centers"
              onClear={clearFilters}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Employee ID</TableHeaderCell>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Initials</TableHeaderCell>
                  <TableHeaderCell>Cost Center</TableHeaderCell>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredResources.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Text className={styles.emptyHint}>No resources match the current filter.</Text>
                    </TableCell>
                  </TableRow>
                )}
                {filteredResources.map((resource) => (
                  <TableRow
                    key={resource.id}
                    className={styles.clickableRow}
                    onClick={() => { setDetailItem(resource); setDetailType('resource'); }}
                  >
                    <TableCell>{resource.employee_id}</TableCell>
                    <TableCell>{resource.display_name}</TableCell>
                    <TableCell>{resource.initials ?? '—'}</TableCell>
                    <TableCell>{costCenters.find((cc) => cc.id === resource.cost_center_id)?.name || '—'}</TableCell>
                    <TableCell>
                      <Badge color={resource.resource_type === 'Employee' ? 'brand' : 'warning'}>
                        {resource.resource_type}
                      </Badge>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {canManageMasterData && (
                        <>
                          <Button icon={<EditRegular />} appearance="subtle" onClick={() => openEditDialog(resource)} />
                          <Button icon={<DeleteRegular />} appearance="subtle" onClick={() => handleDelete(resource)} />
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        );

      case 'placeholders':
        return (
          <>
            <AdminToolbar
              searchValue={searchText}
              onSearchChange={setSearchText}
              searchPlaceholder="Search by name or skill profile…"
              filterValue={filterCostCenter}
              onFilterChange={setFilterCostCenter}
              filterOptions={filterCostCenterOptions}
              filterPlaceholder="All cost centers"
              onClear={clearFilters}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Cost Center</TableHeaderCell>
                  <TableHeaderCell>Placeholder Name</TableHeaderCell>
                  <TableHeaderCell>Skill Profile</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPlaceholders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Text className={styles.emptyHint}>No placeholders match the current filter.</Text>
                    </TableCell>
                  </TableRow>
                )}
                {filteredPlaceholders.map((ph) => (
                  <TableRow
                    key={ph.id}
                    className={styles.clickableRow}
                    onClick={() => { setDetailItem(ph); setDetailType('placeholder'); }}
                  >
                    <TableCell>{ph.cost_center_name || '—'}</TableCell>
                    <TableCell>{ph.name}</TableCell>
                    <TableCell>{ph.skill_profile || '—'}</TableCell>
                    <TableCell>
                      <StatusPill status={resourceStatus(ph.is_active)} />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {canManageMasterData && (
                        <>
                          <Button icon={<EditRegular />} appearance="subtle" onClick={() => openEditDialog(ph)} />
                          <Button icon={<DeleteRegular />} appearance="subtle" onClick={() => handleDelete(ph)} title="Deactivate" />
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        );

      case 'manager-overrides':
        return (
          <>
            <div style={{ marginBottom: tokens.spacingVerticalM, display: 'flex', gap: tokens.spacingHorizontalS }}>
              <Button
                appearance="secondary"
                onClick={async () => {
                  try {
                    const result = await adminApi.syncReportingCache();
                    showSuccess('Cache rebuilt', result.message);
                  } catch (error) {
                    showApiError(error as Error, 'Failed to rebuild cache');
                  }
                }}
              >
                Rebuild Reporting Cache
              </Button>
              <p style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, margin: 'auto 0' }}>
                Rebuilds the manager hierarchy from current Graph data. Run after any org chart changes.
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Employee (object ID)</TableHeaderCell>
                  <TableHeaderCell>Manager (object ID)</TableHeaderCell>
                  <TableHeaderCell>Active</TableHeaderCell>
                  <TableHeaderCell>Note</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {managerOverrides.map((override) => (
                  <TableRow key={override.id}>
                    <TableCell>{override.employee_object_id}</TableCell>
                    <TableCell>{override.manager_object_id}</TableCell>
                    <TableCell>
                      <Badge appearance="filled" color={override.is_active ? 'success' : 'danger'}>
                        {override.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>{override.note || '—'}</TableCell>
                    <TableCell>
                      <Button icon={<EditRegular />} appearance="subtle" onClick={() => openEditDialog(override)} />
                      <Button icon={<DeleteRegular />} appearance="subtle" onClick={() => handleDelete(override)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        );

      case 'delegates':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Delegator (approvals owner)</TableHeaderCell>
                <TableHeaderCell>Delegate (acts on their behalf)</TableHeaderCell>
                <TableHeaderCell>Active</TableHeaderCell>
                <TableHeaderCell>Note</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {delegates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Text className={styles.emptyHint}>No approval delegates configured.</Text>
                  </TableCell>
                </TableRow>
              )}
              {delegates.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.delegator_name || d.delegator_id}</TableCell>
                  <TableCell>{d.delegate_name || d.delegate_id}</TableCell>
                  <TableCell>
                    <Badge appearance="filled" color={d.is_active ? 'success' : 'danger'}>
                      {d.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>{d.note || '—'}</TableCell>
                  <TableCell>
                    <Button icon={<EditRegular />} appearance="subtle" onClick={() => openEditDialog(d)} />
                    <Button icon={<DeleteRegular />} appearance="subtle" onClick={() => handleDelete(d)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );

      case 'users':
        return (
          <>
            <AdminToolbar
              searchValue={searchText}
              onSearchChange={setSearchText}
              searchPlaceholder="Search by name or email…"
              filterValue={filterStatus}
              onFilterChange={setFilterStatus}
              filterOptions={[
                { value: 'Admin', label: 'Admin' },
                { value: 'Finance', label: 'Finance' },
                { value: 'PM', label: 'PM' },
                { value: 'Manager', label: 'Manager' },
                { value: 'Employee', label: 'Employee' },
              ]}
              filterPlaceholder="All roles"
              onClear={clearFilters}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Email</TableHeaderCell>
                  <TableHeaderCell>Role</TableHeaderCell>
                  <TableHeaderCell>Cost Center</TableHeaderCell>
                  <TableHeaderCell>Active</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAdminUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Text className={styles.emptyHint}>No users match the current filter.</Text>
                    </TableCell>
                  </TableRow>
                )}
                {filteredAdminUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.display_name}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <select
                        className={styles.nativeSelect}
                        value={u.role}
                        disabled={u.object_id === user?.object_id}
                        onChange={async (e) => {
                          const newRole = e.target.value as UserRole;
                          if (newRole === 'Admin' && !confirm('Assign Admin role? This gives full system access.')) return;
                          try {
                            const updated = await adminApi.updateAdminUser(u.id, { role: newRole });
                            setAdminUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
                            showSuccess('Role updated');
                          } catch (err) {
                            showApiError(err as Error, 'Failed to update role');
                          }
                        }}
                      >
                        {(['Admin', 'Finance', 'PM', 'Manager', 'Employee'] as UserRole[]).map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>{u.cost_center_name || '—'}</TableCell>
                    <TableCell>
                      <select
                        className={styles.nativeSelect}
                        value={u.is_active ? 'active' : 'inactive'}
                        disabled={u.object_id === user?.object_id}
                        onChange={async (e) => {
                          try {
                            const updated = await adminApi.updateAdminUser(u.id, { is_active: e.target.value === 'active' });
                            setAdminUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
                            showSuccess('Status updated');
                          } catch (err) {
                            showApiError(err as Error, 'Failed to update status');
                          }
                        }}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        );
    }
  };

  // ── Dialog form renderers ────────────────────────────────────────────────

  const renderDialogForm = () => {
    switch (selectedTab) {
      case 'cost-centers':
        return (
          <>
            <div className={styles.dialogField}>
              <Label required>Code</Label>
              <Input
                value={String(formData.code || '')}
                onChange={(_, d) => setFormData({ ...formData, code: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label required>Name</Label>
              <Input
                value={String(formData.name || '')}
                onChange={(_, d) => setFormData({ ...formData, name: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label>Manager / RO</Label>
              <Select
                value={String(formData.ro_user_id || '')}
                onChange={(_, d) => setFormData({ ...formData, ro_user_id: d.value || null })}
              >
                <option value="">— none —</option>
                {pmUsers.filter((u) => u.role === 'Manager' || u.role === 'Admin').map((u) => (
                  <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>
                ))}
              </Select>
            </div>
            <div className={styles.dialogField}>
              <Label>Director</Label>
              <Select
                value={String(formData.director_user_id || '')}
                onChange={(_, d) => setFormData({ ...formData, director_user_id: d.value || null })}
              >
                <option value="">— none —</option>
                {pmUsers.filter((u) => u.role === 'Manager' || u.role === 'Admin').map((u) => (
                  <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>
                ))}
              </Select>
            </div>
          </>
        );

      case 'projects':
        return (
          <>
            <div className={styles.dialogField}>
              <Label required>Code</Label>
              <Input
                value={String(formData.code || '')}
                onChange={(_, d) => setFormData({ ...formData, code: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label required>Name</Label>
              <Input
                value={String(formData.name || '')}
                onChange={(_, d) => setFormData({ ...formData, name: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label>Project Managers (hold Ctrl/Cmd to select multiple)</Label>
              <select
                className={styles.nativeSelect}
                multiple
                value={(formData.pm_user_ids as string[]) ?? []}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                  setFormData({ ...formData, pm_user_ids: selected });
                }}
              >
                {pmUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name} ({u.email})
                  </option>
                ))}
              </select>
            </div>
          </>
        );

      case 'resources':
        return (
          <>
            <div className={styles.dialogField}>
              <Label required>Cost Center</Label>
              <select
                className={styles.nativeSelect}
                value={String(formData.cost_center_id || '')}
                onChange={(e) => setFormData({ ...formData, cost_center_id: e.target.value })}
              >
                <option value="">Select Cost Center</option>
                {costCenters.map((cc) => (
                  <option key={cc.id} value={cc.id}>{cc.name}</option>
                ))}
              </select>
            </div>
            <div className={styles.dialogField}>
              <Label required>Employee ID</Label>
              <Input
                value={String(formData.employee_id || '')}
                onChange={(_, d) => setFormData({ ...formData, employee_id: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label required>Display Name</Label>
              <Input
                value={String(formData.display_name || '')}
                onChange={(_, d) => setFormData({ ...formData, display_name: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label>Initials</Label>
              <Input
                value={String(formData.initials ?? '')}
                onChange={(_, d) => setFormData({ ...formData, initials: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label>Email</Label>
              <Input
                value={String(formData.email || '')}
                onChange={(_, d) => setFormData({ ...formData, email: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label>Resource Type</Label>
              <select
                className={styles.nativeSelect}
                value={String(formData.resource_type || 'Employee')}
                onChange={(e) => setFormData({ ...formData, resource_type: e.target.value })}
              >
                <option value="Employee">Employee</option>
                <option value="External">External</option>
                <option value="Student">Student</option>
                <option value="OOP">OOP</option>
              </select>
            </div>
          </>
        );

      case 'placeholders':
        return (
          <>
            {editItem ? (
              <div className={styles.dialogField}>
                <Label>Cost Center</Label>
                <Input value={String((editItem as Placeholder).cost_center_name || '—')} readOnly disabled />
              </div>
            ) : (
              <div className={styles.dialogField}>
                <Label required>Cost Center</Label>
                <select
                  className={styles.nativeSelect}
                  value={String(formData.cost_center_id || '')}
                  onChange={(e) => setFormData({ ...formData, cost_center_id: e.target.value })}
                >
                  <option value="">Select Cost Center</option>
                  {costCenters.map((cc) => (
                    <option key={cc.id} value={cc.id}>{cc.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className={styles.dialogField}>
              <Label required>Name</Label>
              <Input
                value={String(formData.name || '')}
                onChange={(_, d) => setFormData({ ...formData, name: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label>Skill Profile</Label>
              <Input
                value={String(formData.skill_profile || '')}
                onChange={(_, d) => setFormData({ ...formData, skill_profile: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label>Description</Label>
              <Input
                value={String(formData.description || '')}
                onChange={(_, d) => setFormData({ ...formData, description: d.value })}
              />
            </div>
          </>
        );

      case 'manager-overrides':
        return (
          <>
            {!editItem ? (
              <>
                <div className={styles.dialogField}>
                  <Label required>Employee Entra Object ID</Label>
                  <Input
                    value={String(formData.employee_object_id || '')}
                    onChange={(_, d) => setFormData({ ...formData, employee_object_id: d.value })}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </div>
                <div className={styles.dialogField}>
                  <Label required>Manager Entra Object ID</Label>
                  <Input
                    value={String(formData.manager_object_id || '')}
                    onChange={(_, d) => setFormData({ ...formData, manager_object_id: d.value })}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </div>
              </>
            ) : (
              <Checkbox
                label="Active"
                checked={formData.is_active !== false}
                onChange={(_, d) => setFormData({ ...formData, is_active: d.checked })}
              />
            )}
            <div className={styles.dialogField}>
              <Label>Note</Label>
              <Input
                value={String(formData.note || '')}
                onChange={(_, d) => setFormData({ ...formData, note: d.value })}
              />
            </div>
          </>
        );

      case 'delegates':
        return (
          <>
            {!editItem ? (
              <>
                {user?.role !== 'Manager' && (
                  <div className={styles.dialogField}>
                    <Label required>Delegator (whose approvals to delegate)</Label>
                    <Select
                      value={String(formData.delegator_id || '')}
                      onChange={(_, d) => setFormData({ ...formData, delegator_id: d.value })}
                    >
                      <option value="">— select manager —</option>
                      {pmUsers.filter((u) => u.role === 'Manager' || u.role === 'Admin').map((u) => (
                        <option key={u.id} value={u.id}>{u.display_name}</option>
                      ))}
                    </Select>
                  </div>
                )}
                {user?.role === 'Manager' && (
                  <div className={styles.dialogField}>
                    <Label>Delegator</Label>
                    <Input value={user.display_name} readOnly />
                  </div>
                )}
                <div className={styles.dialogField}>
                  <Label required>Delegate (who will approve on their behalf)</Label>
                  <Select
                    value={String(formData.delegate_id || '')}
                    onChange={(_, d) => setFormData({ ...formData, delegate_id: d.value })}
                  >
                    <option value="">— select delegate —</option>
                    {pmUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.display_name} ({u.role})</option>
                    ))}
                  </Select>
                </div>
              </>
            ) : (
              <Checkbox
                label="Active"
                checked={formData.is_active !== false}
                onChange={(_, d) => setFormData({ ...formData, is_active: d.checked })}
              />
            )}
            <div className={styles.dialogField}>
              <Label>Note</Label>
              <Input
                value={String(formData.note || '')}
                onChange={(_, d) => setFormData({ ...formData, note: d.value })}
              />
            </div>
          </>
        );
    }
  };

  // ── Detail dialog content ────────────────────────────────────────────────

  const renderDetailContent = () => {
    if (!detailItem || !detailType) return null;

    if (detailType === 'cost-center') {
      const cc = detailItem as CostCenter;
      return (
        <>
          <div className={styles.detailGrid}>
            <span className={styles.detailLabel}>Code</span><span>{cc.code}</span>
            <span className={styles.detailLabel}>Name</span><span>{cc.name}</span>
            <span className={styles.detailLabel}>Status</span>
            <span><StatusPill status={resourceStatus(cc.is_active)} /></span>
          </div>
          <div className={styles.sectionTitle}>Resources in this cost center</div>
          {detailLoading ? (
            <Spinner size="tiny" label="Loading resources…" />
          ) : detailResources.length === 0 ? (
            <Text className={styles.emptyHint}>No active resources assigned to this cost center.</Text>
          ) : (
            <div>
              {detailResources.map((r) => (
                <span key={r.id} className={styles.resourceChip}>
                  <Badge color={r.resource_type === 'Employee' ? 'brand' : 'warning'} size="small">
                    {r.resource_type[0]}
                  </Badge>
                  {r.display_name}
                  {r.initials ? ` (${r.initials})` : ''}
                </span>
              ))}
            </div>
          )}
        </>
      );
    }

    if (detailType === 'resource') {
      const r = detailItem as Resource;
      return (
        <div className={styles.detailGrid}>
          <span className={styles.detailLabel}>Employee ID</span><span>{r.employee_id}</span>
          <span className={styles.detailLabel}>Display Name</span><span>{r.display_name}</span>
          <span className={styles.detailLabel}>Initials</span><span>{r.initials ?? '—'}</span>
          <span className={styles.detailLabel}>Email</span><span>{r.email ?? '—'}</span>
          <span className={styles.detailLabel}>Cost Center</span>
          <span>{costCenters.find((cc) => cc.id === r.cost_center_id)?.name ?? '—'}</span>
          <span className={styles.detailLabel}>Type</span>
          <span><Badge color={r.resource_type === 'Employee' ? 'brand' : 'warning'}>{r.resource_type}</Badge></span>
          <span className={styles.detailLabel}>Hourly Cost</span><span>{r.hourly_cost != null ? r.hourly_cost : '—'}</span>
          <span className={styles.detailLabel}>Status</span>
          <span><StatusPill status={resourceStatus(r.is_active)} /></span>
        </div>
      );
    }

    if (detailType === 'placeholder') {
      const ph = detailItem as Placeholder;
      return (
        <div className={styles.detailGrid}>
          <span className={styles.detailLabel}>Name</span><span>{ph.name}</span>
          <span className={styles.detailLabel}>Cost Center</span><span>{ph.cost_center_name ?? '—'}</span>
          <span className={styles.detailLabel}>Description</span><span>{ph.description ?? '—'}</span>
          <span className={styles.detailLabel}>Skill Profile</span><span>{ph.skill_profile ?? '—'}</span>
          <span className={styles.detailLabel}>Estimated Cost</span><span>{ph.estimated_cost != null ? ph.estimated_cost : '—'}</span>
          <span className={styles.detailLabel}>Status</span>
          <span><StatusPill status={resourceStatus(ph.is_active)} /></span>
        </div>
      );
    }

    return null;
  };

  // ── Tab labels ───────────────────────────────────────────────────────────

  const tabLabels: Record<TabValue, string> = {
    'cost-centers': 'Cost Centers',
    'projects': 'Projects',
    'resources': 'Resources',
    'placeholders': 'Placeholders',
    'manager-overrides': 'Manager Overrides',
    'delegates': 'Approval Delegates',
    'users': 'Users',
    'sync': 'Graph Synchronization',
    'notifications': 'Notifications',
  };

  const detailDialogTitle =
    detailType === 'cost-center'
      ? `Cost Center: ${(detailItem as CostCenter)?.name ?? ''}`
      : detailType === 'resource'
      ? 'Resource Details'
      : 'Placeholder Details';

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={styles.container}>
      <Card className={styles.card}>
        <TabList selectedValue={selectedTab} onTabSelect={handleTabSelect}>
          {canManageMasterData && <Tab value="cost-centers" icon={<OrganizationRegular />}>Cost Centers</Tab>}
          {canManageMasterData && <Tab value="projects" icon={<FolderRegular />}>Projects</Tab>}
          {canManageMasterData && <Tab value="resources" icon={<PersonRegular />}>Resources</Tab>}
          {canManageMasterData && <Tab value="placeholders" icon={<PersonQuestionMarkRegular />}>Placeholders</Tab>}
          {canManageSettings && (
            <Tab value="manager-overrides" icon={<PeopleTeamRegular />}>Manager Overrides</Tab>
          )}
          {canManageDelegates && (
            <Tab value="delegates" icon={<PeopleTeamRegular />}>Approval Delegates</Tab>
          )}
          {canManageSettings && (
            <Tab value="users" icon={<PeopleTeamRegular />}>Users</Tab>
          )}
          {canManageSettings && (
            <Tab value="sync" icon={<ArrowSyncRegular />}>Sync</Tab>
          )}
          {canManageMasterData && (
            <Tab value="notifications" icon={<AlertRegular />}>Notifications</Tab>
          )}
        </TabList>

        <div className={styles.tabContent}>
          <div className={styles.header}>
            <div>
              <Title3>{tabLabels[selectedTab]}</Title3>
              {selectedTab === 'cost-centers' && (
                <p style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, margin: '4px 0 0 0' }}>
                  A placeholder is created automatically for each cost center. Click a row to see assigned resources.
                </p>
              )}
              {selectedTab === 'placeholders' && (
                <p style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, margin: '4px 0 0 0' }}>
                  One placeholder per cost center. Edit name and details here; create cost centers to add placeholders.
                </p>
              )}
            </div>
            {selectedTab !== 'users' && selectedTab !== 'sync' && selectedTab !== 'notifications' && (canManageMasterData ||
              (selectedTab === 'manager-overrides' && canManageSettings) ||
              (selectedTab === 'delegates' && canManageDelegates)) && (
              <Button appearance="primary" icon={<AddRegular />} onClick={openCreateDialog}>
                Add {tabLabels[selectedTab].replace(/s$/, '')}
              </Button>
            )}
          </div>

          {renderTable()}
        </div>
      </Card>

      {/* Dev Tools — only visible in dev auth bypass mode */}
      {config.devAuthBypass && (
        <Card className={styles.card}>
          <div className={styles.header}>
            <div>
              <Title3>Dev Tools</Title3>
              <p style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, margin: '4px 0 0 0' }}>
                Development-only utilities. Wipes all tenant data and re-seeds with example data including the correct approval hierarchy.
              </p>
            </div>
          </div>
          <DevSeedResetButton />
        </Card>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(_, data) => setDialogOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {editItem ? 'Edit' : 'Create'} {tabLabels[selectedTab].replace(/s$/, '')}
            </DialogTitle>
            <DialogContent>{renderDialogForm()}</DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button appearance="primary" onClick={handleSave}>Save</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Detail Dialog (cost center resources / resource / placeholder) */}
      <Dialog
        open={detailItem != null}
        onOpenChange={(_, data) => {
          if (!data.open) {
            setDetailItem(null);
            setDetailType(null);
          }
        }}
      >
        <DialogSurface style={{ minWidth: 480 }}>
          <DialogBody>
            <DialogTitle>{detailDialogTitle}</DialogTitle>
            <DialogContent>{renderDetailContent()}</DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => { setDetailItem(null); setDetailType(null); }}>
                Close
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
