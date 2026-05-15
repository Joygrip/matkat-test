/**
 * Admin page for managing master data.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
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
  Textarea,
  Label,
  Checkbox,
  makeStyles,
  tokens,
  Title3,
  SelectTabEventHandler,
  Select,
  Combobox,
  Option,
  MessageBar,
  MessageBarBody,
  Body1,
  Body2,
  Text,
  Radio,
  RadioGroup,
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
  EyeRegular,
  CalendarMonthRegular,
  CameraRegular,
  MoneyRegular,
} from '@fluentui/react-icons';
import {
  adminApi,
  CostCenter,
  CostCenterHierarchy,
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
import { usePeriod } from '../contexts/PeriodContext';
import { consolidationApi, Snapshot } from '../api/consolidation';
import { PeriodPanel } from '../components/PeriodPanel';
import { PeriodSelector } from '../components/PeriodSelector';
import { SnapshotsTab } from '../components/finance/SnapshotsTab';
import { CostReportTab } from '../components/finance/CostReportTab';

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
  tabBarWrapper: {
    overflowX: 'auto',
    overflowY: 'hidden',
    whiteSpace: 'nowrap',
    scrollbarWidth: 'thin',
    WebkitOverflowScrolling: 'touch',
    boxShadow: 'inset -20px 0 15px -15px rgba(0,0,0,0.06)',
    '& [role="tab"]': {
      flexShrink: 0,
    },
  },
});

type TabValue =
  | 'cost-centers'
  | 'projects'
  | 'resources'
  | 'placeholders'
  | 'periods'
  | 'snapshots'
  | 'cost-report'
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

interface SyncStatusResponse {
  last_sync_at: string | null;
  status: 'never' | 'running' | 'completed' | 'failed';
  sync_type: string | null;
}

function formatLastSync(s: SyncStatusResponse | null): string {
  if (!s || s.status === 'never') return 'Never';
  if (s.status === 'running') return 'Running now…';
  if (!s.last_sync_at) return 'Unknown';
  const diffMs = Date.now() - new Date(s.last_sync_at).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
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
  const [syncStarted, setSyncStarted] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(null);

  useEffect(() => {
    apiClient.get<SyncStatusResponse>('/admin/sync/status').then(setSyncStatus).catch(() => {});
  }, []);

  const handleRunSync = async () => {
    setLoading(true);
    setSyncStarted(false);
    setSyncError(null);
    try {
      await apiClient.post('/admin/sync/full');
      setSyncStarted(true);
      setSyncStatus({ last_sync_at: null, status: 'running', sync_type: 'full' });
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Failed to start sync');
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
      {syncStatus && (
        <Text style={{ color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase200 }}>
          Last synced: {formatLastSync(syncStatus)}
        </Text>
      )}
      <div>
        <Button
          appearance="primary"
          icon={loading ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
          disabled={loading}
          onClick={handleRunSync}
        >
          {loading ? 'Starting…' : 'Run Full Sync'}
        </Button>
      </div>
      {syncError && (
        <MessageBar intent="error">
          <MessageBarBody>{syncError}</MessageBarBody>
        </MessageBar>
      )}
      {syncStarted && (
        <>
          <MessageBar intent="success">
            <MessageBarBody>
              Sync started — running in background. This may take 2–3 minutes. Refresh the page when done.
            </MessageBarBody>
          </MessageBar>
          <div>
            <Button appearance="outline" onClick={() => window.location.reload()}>
              Refresh Page
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Notification Schedules & Logs Panel ──────────────────────────────────────

interface PreviewRecipientItem {
  email: string;
  display_name: string;
  role: string;
  reason: string;
  email_subject: string;
  email_body_html: string;
  already_notified: boolean;
  excluded?: boolean;
}

interface SchedulePreviewData {
  period: { year: number; month: number; label: string };
  recipients: PreviewRecipientItem[];
  total_recipients: number;
  skipped: number;
  would_skip: boolean;
}

interface NotificationScheduleItem {
  id: string;
  notification_type: string;
  trigger_type: string;
  trigger_value: number;
  time_of_day: string;
  is_active: boolean;
  last_run_at: string | null;
  notify_pm: boolean;
  notify_manager: boolean;
  notify_finance: boolean;
  notify_employee: boolean;
  excluded_emails: string[];
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

function triggerLabelFull(type: string, value: number, time: string): string {
  switch (type) {
    case 'day_of_month': return `${ordinal(value)} of each month at ${time}`;
    case 'day_of_week': return `Every ${DAYS_OF_WEEK[value] ?? value} at ${time}`;
    case 'days_before_period_close': return `${value} day${value !== 1 ? 's' : ''} before close at ${time}`;
    default: return `${String(value)} at ${time}`;
  }
}

function computeNextRun(s: NotificationScheduleItem): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (s.trigger_type === 'day_of_month') {
    let d = new Date(today.getFullYear(), today.getMonth(), s.trigger_value);
    if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, s.trigger_value);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  if (s.trigger_type === 'day_of_week') {
    // Our system: 0=Monday … 6=Sunday. JS Date.getDay(): 0=Sunday … 6=Saturday.
    const jsTarget = (s.trigger_value + 1) % 7;
    const daysAhead = (jsTarget - today.getDay() + 7) % 7 || 7;
    const d = new Date(today);
    d.setDate(today.getDate() + daysAhead);
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  if (s.trigger_type === 'days_before_period_close') {
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const d = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() - s.trigger_value);
    if (d < today) {
      const nextLast = new Date(today.getFullYear(), today.getMonth() + 2, 0);
      return new Date(nextLast.getFullYear(), nextLast.getMonth(), nextLast.getDate() - s.trigger_value)
        .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  return '—';
}

function snapToQuarterHour(time: string): string {
  const [h, m] = time.split(':');
  const minutes = parseInt(m ?? '0', 10);
  const snapped = [0, 15, 30, 45].reduce((prev, curr) =>
    Math.abs(curr - minutes) < Math.abs(prev - minutes) ? curr : prev
  );
  return `${h}:${String(snapped).padStart(2, '0')}`;
}

function scheduleSummary(form: Partial<NotificationScheduleItem>): string {
  const typeName = NOTIFICATION_TYPE_LABELS[form.notification_type ?? ''] ?? (form.notification_type ?? 'Notification');
  const time = form.time_of_day ?? '00:00';

  let triggerDesc = 'on the scheduled trigger';
  switch (form.trigger_type) {
    case 'day_of_month':
      triggerDesc = `on the ${ordinal(form.trigger_value ?? 1)} of each month`;
      break;
    case 'day_of_week':
      triggerDesc = `every ${DAYS_OF_WEEK[form.trigger_value ?? 0] ?? 'day'}`;
      break;
    case 'days_before_period_close': {
      const n = form.trigger_value ?? 3;
      triggerDesc = `${n} day${n !== 1 ? 's' : ''} before period close`;
      break;
    }
  }

  const recips: string[] = [];
  if (form.notify_pm && form.notification_type !== 'missing_actuals') recips.push('PMs (their projects)');
  if (form.notify_manager) recips.push('Managers (their department)');
  if (form.notify_finance) recips.push('Finance');
  if (form.notify_employee && form.notification_type === 'missing_actuals') recips.push('Employees');

  const recipStr = recips.length === 0 ? ''
    : recips.length === 1 ? ` to ${recips[0]}`
    : ` to ${recips.slice(0, -1).join(', ')}, and ${recips[recips.length - 1]}`;

  return `${typeName} will be sent ${triggerDesc} at ${time} CEST${recipStr}.`;
}

const DEFAULT_TRIGGER_VALUES: Record<string, number> = {
  day_of_month: 1,
  day_of_week: 0,
  days_before_period_close: 3,
};

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

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSched, setPreviewSched] = useState<NotificationScheduleItem | null>(null);
  const [previewData, setPreviewData] = useState<SchedulePreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedPreviewEmail, setSelectedPreviewEmail] = useState<string>('');
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [sendLoading, setSendLoading] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [excludedEmails, setExcludedEmails] = useState<string[]>([]);
  const [exclusionSearch, setExclusionSearch] = useState('');
  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);
  const [form, setForm] = useState<Partial<NotificationScheduleItem>>({
    notification_type: 'conflict_alerts',
    trigger_type: 'day_of_month',
    trigger_value: 1,
    time_of_day: '07:00',
    is_active: true,
    notify_pm: true,
    notify_manager: true,
    notify_finance: true,
    notify_employee: true,
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
    setForm({
      notification_type: 'conflict_alerts',
      trigger_type: 'day_of_month',
      trigger_value: 1,
      time_of_day: '07:00',
      is_active: true,
      notify_pm: true,
      notify_manager: true,
      notify_finance: true,
      notify_employee: true,
    });
    setExcludedEmails([]);
    setExclusionSearch('');
    if (allUsers.length === 0) {
      adminApi.listUsers().then(setAllUsers).catch(() => {});
    }
    setDialogOpen(true);
  };

  const openEdit = (s: NotificationScheduleItem) => {
    setEditSched(s);
    setForm({
      notification_type: s.notification_type,
      trigger_type: s.trigger_type,
      trigger_value: s.trigger_value,
      time_of_day: snapToQuarterHour(s.time_of_day),
      is_active: s.is_active,
      notify_pm: s.notify_pm,
      notify_manager: s.notify_manager,
      notify_finance: s.notify_finance,
      notify_employee: s.notify_employee,
    });
    setExcludedEmails(s.excluded_emails || []);
    setExclusionSearch('');
    if (allUsers.length === 0) {
      adminApi.listUsers().then(setAllUsers).catch(() => {});
    }
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
        notify_pm: form.notify_pm ?? true,
        notify_manager: form.notify_manager ?? true,
        notify_finance: form.notify_finance ?? true,
        notify_employee: form.notify_employee ?? true,
        excluded_emails: excludedEmails,
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

  const handlePreview = async (s: NotificationScheduleItem) => {
    setPreviewSched(s);
    setPreviewData(null);
    setSelectedPreviewEmail('');
    setSelectedEmails(new Set());
    setSendResult(null);
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const data = await apiClient.get<SchedulePreviewData>(`/notification-schedules/${s.id}/preview`);
      setPreviewData(data);
      const initialSelected = new Set(
        data.recipients.filter((r) => !r.excluded).map((r) => r.email),
      );
      setSelectedEmails(initialSelected);
      const firstChecked = data.recipients.find((r) => !r.excluded);
      if (firstChecked) setSelectedPreviewEmail(firstChecked.email);
    } catch (err) {
      showApiError(err as Error);
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSendFromPreview = async () => {
    if (!previewSched) return;
    const emailList = [...selectedEmails];
    const isResend = previewData?.recipients.some((r) => r.already_notified && selectedEmails.has(r.email)) ?? false;
    setSendLoading(true);
    setSendResult(null);
    try {
      await apiClient.post(`/notification-schedules/${previewSched.id}/run`, {
        recipient_emails: emailList,
        force: isResend,
      });
      const n = emailList.length;
      setSendResult({ ok: true, msg: `${isResend ? 'Resent' : 'Sent'} to ${n} recipient${n !== 1 ? 's' : ''}` });
      loadSchedules();
      loadLogs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send';
      setSendResult({ ok: false, msg: `Failed to send — ${msg}` });
    } finally {
      setSendLoading(false);
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
                <TableHeaderCell>Recipients</TableHeaderCell>
                <TableHeaderCell>Time (CEST)</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Last Run</TableHeaderCell>
                <TableHeaderCell>Next Run</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8}>
                    <Text style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>
                      No schedules configured. Add one to automate notifications.
                    </Text>
                  </TableCell>
                </TableRow>
              )}
              {schedules.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{NOTIFICATION_TYPE_LABELS[s.notification_type] ?? s.notification_type}</TableCell>
                  <TableCell>{triggerLabelFull(s.trigger_type, s.trigger_value, s.time_of_day)}</TableCell>
                  <TableCell>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {s.notify_pm && <Badge appearance="tint" color="brand" size="small">PM</Badge>}
                      {s.notify_manager && <Badge appearance="tint" color="warning" size="small">Manager</Badge>}
                      {s.notify_finance && <Badge appearance="tint" color="success" size="small">Finance</Badge>}
                      {s.notify_employee && s.notification_type === 'missing_actuals' && (
                        <Badge appearance="tint" color="informative" size="small">Employee</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{s.time_of_day} CEST</TableCell>
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
                  <TableCell>{computeNextRun(s)}</TableCell>
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
                    <Button size="small" appearance="subtle" icon={<EyeRegular />} title="Preview" onClick={() => handlePreview(s)} />
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

      {/* Preview modal */}
      <Dialog open={previewOpen} onOpenChange={(_, d) => setPreviewOpen(d.open)}>
        <DialogSurface style={{ maxWidth: '860px', width: '860px' }}>
          <DialogBody>
            <DialogTitle>
              Preview — {previewSched ? (NOTIFICATION_TYPE_LABELS[previewSched.notification_type] ?? previewSched.notification_type) : ''}
            </DialogTitle>
            <DialogContent>
              {previewLoading && <Spinner label="Loading preview…" />}
              {!previewLoading && previewData && (() => {
                const { period, recipients, total_recipients, skipped } = previewData;

                // Active first, excluded last
                const sortedRecipients = [
                  ...recipients.filter((r) => !r.excluded),
                  ...recipients.filter((r) => r.excluded),
                ];
                const allCheckable = sortedRecipients.filter((r) => !r.excluded);
                const checkedCheckable = allCheckable.filter((r) => selectedEmails.has(r.email));
                const headerCheckState: boolean | 'mixed' =
                  checkedCheckable.length === 0 ? false
                  : checkedCheckable.length === allCheckable.length ? true
                  : 'mixed';

                const toggleAll = () => {
                  if (headerCheckState === true) {
                    setSelectedEmails(new Set());
                  } else {
                    setSelectedEmails(new Set(allCheckable.map((r) => r.email)));
                  }
                };

                const toggleEmail = (email: string) => {
                  const next = new Set(selectedEmails);
                  if (next.has(email)) next.delete(email);
                  else next.add(email);
                  setSelectedEmails(next);
                };

                const checkedRecipients = sortedRecipients.filter((r) => selectedEmails.has(r.email));
                const effectivePreviewEmail = selectedEmails.has(selectedPreviewEmail)
                  ? selectedPreviewEmail
                  : checkedRecipients[0]?.email ?? '';
                const selectedRecipient = sortedRecipients.find((r) => r.email === effectivePreviewEmail) ?? null;

                const selectedCount = checkedCheckable.length;

                return (
                  <>
                    {/* Section A — Recipient list */}
                    <Text weight="semibold" style={{ display: 'block', marginBottom: tokens.spacingVerticalS }}>
                      {period.label} — {total_recipients} recipient{total_recipients !== 1 ? 's' : ''}
                      {skipped > 0 ? ` (${skipped} already notified)` : ''}
                    </Text>

                    {recipients.length === 0 ? (
                      <Text style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>
                        No recipients found for this period. No emails would be sent.
                      </Text>
                    ) : (
                      <>
                        <div style={{ maxHeight: '240px', overflowY: 'auto', marginBottom: tokens.spacingVerticalXS }}>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHeaderCell style={{ width: '40px' }}>
                                  <Checkbox
                                    checked={headerCheckState}
                                    onChange={toggleAll}
                                    title={headerCheckState === true ? 'Deselect all' : 'Select all'}
                                  />
                                </TableHeaderCell>
                                <TableHeaderCell>Name</TableHeaderCell>
                                <TableHeaderCell>Email</TableHeaderCell>
                                <TableHeaderCell>Role</TableHeaderCell>
                                <TableHeaderCell>Reason</TableHeaderCell>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {sortedRecipients.map((r, idx) => (
                                <TableRow key={idx} style={{ opacity: r.excluded ? 0.5 : 1 }}>
                                  <TableCell>
                                    <Checkbox
                                      checked={selectedEmails.has(r.email)}
                                      disabled={r.excluded}
                                      onChange={() => toggleEmail(r.email)}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Text>{r.display_name}</Text>
                                    {r.already_notified && (
                                      <Badge appearance="tint" color="subtle" size="small" style={{ marginLeft: 6 }}>
                                        Already sent
                                      </Badge>
                                    )}
                                    {r.excluded && (
                                      <Badge appearance="tint" color="subtle" size="small" style={{ marginLeft: 6 }}>
                                        Excluded
                                      </Badge>
                                    )}
                                  </TableCell>
                                  <TableCell><Text size={200}>{r.email}</Text></TableCell>
                                  <TableCell>
                                    <Badge
                                      appearance="tint"
                                      size="small"
                                      color={
                                        r.role === 'PM' ? 'brand'
                                          : r.role === 'Manager' ? 'warning'
                                          : r.role === 'Finance' ? 'success'
                                          : 'informative'
                                      }
                                    >
                                      {r.role}
                                    </Badge>
                                  </TableCell>
                                  <TableCell><Text size={200}>{r.reason}</Text></TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground2, display: 'block', marginBottom: tokens.spacingVerticalM }}>
                          {selectedCount} of {total_recipients} recipient{total_recipients !== 1 ? 's' : ''} selected
                          {skipped > 0 ? ` (${skipped} already notified)` : ''}
                        </Text>
                      </>
                    )}

                    {/* Section B — Email preview */}
                    {recipients.length > 0 && (
                      <>
                        <div style={{ borderTop: `1px solid ${tokens.colorNeutralStroke2}`, paddingTop: tokens.spacingVerticalM, marginBottom: tokens.spacingVerticalS }}>
                          <Label>Preview email for</Label>
                          <select
                            className={panelStyles.nativeSelect}
                            style={{ marginTop: '4px' }}
                            value={effectivePreviewEmail}
                            onChange={(e) => setSelectedPreviewEmail(e.target.value)}
                          >
                            {checkedRecipients.map((r, idx) => (
                              <option key={idx} value={r.email}>
                                {r.display_name} &lt;{r.email}&gt;
                              </option>
                            ))}
                          </select>
                        </div>

                        {selectedRecipient && (
                          <div style={{
                            border: `1px solid ${tokens.colorNeutralStroke2}`,
                            borderRadius: tokens.borderRadiusMedium,
                            overflow: 'hidden',
                          }}>
                            <div style={{
                              background: '#1e3a5f',
                              color: 'white',
                              padding: '8px 16px',
                              fontWeight: 600,
                              fontSize: tokens.fontSizeBase300,
                              letterSpacing: '0.02em',
                            }}>
                              MatKat
                            </div>
                            <div style={{ padding: '12px 16px 8px', background: tokens.colorNeutralBackground2, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                              <div><strong>From:</strong> matkat-noreply@ferrosanmd.com</div>
                              <div><strong>To:</strong> {selectedRecipient.email}</div>
                              <div><strong>Subject:</strong> {selectedRecipient.email_subject}</div>
                            </div>
                            <div style={{ borderTop: `1px solid ${tokens.colorNeutralStroke2}` }} />
                            <iframe
                              srcDoc={selectedRecipient.email_body_html}
                              style={{ width: '100%', height: '500px', border: 'none', borderRadius: '8px', display: 'block' }}
                              sandbox="allow-same-origin"
                              title="Email preview"
                            />
                          </div>
                        )}
                      </>
                    )}

                    {/* Send result */}
                    {sendResult && (
                      <MessageBar intent={sendResult.ok ? 'success' : 'error'} style={{ marginTop: tokens.spacingVerticalM }}>
                        <MessageBarBody>{sendResult.msg}</MessageBarBody>
                      </MessageBar>
                    )}
                  </>
                );
              })()}
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                disabled={!previewSched || !previewData || selectedEmails.size === 0 || sendLoading}
                icon={sendLoading ? <Spinner size="tiny" /> : undefined}
                title={selectedEmails.size === 0 ? 'Select at least one recipient' : undefined}
                onClick={handleSendFromPreview}
              >
                {(() => {
                  if (!previewData) return 'Send Now';
                  const { total_recipients } = previewData;
                  const n = previewData.recipients.filter((r) => !r.excluded && selectedEmails.has(r.email)).length;
                  const hasResend = previewData.recipients.some((r) => r.already_notified && selectedEmails.has(r.email));
                  const label = hasResend ? 'Resend' : 'Send Now';
                  if (n === 0) return label;
                  if (n === total_recipients) return `${label} (${n} recipient${n !== 1 ? 's' : ''})`;
                  return `${label} (${n} of ${total_recipients} recipient${total_recipients !== 1 ? 's' : ''})`;
                })()}
              </Button>
              <Button appearance="secondary" onClick={() => setPreviewOpen(false)}>Close</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(_, d) => setDialogOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{editSched ? 'Edit Schedule' : 'Add Schedule'}</DialogTitle>
            <DialogContent>
              {/* Notification Type */}
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

              {/* Trigger Type — radio buttons */}
              <div className={panelStyles.dialogField}>
                <Label required>Trigger Type</Label>
                <RadioGroup
                  value={form.trigger_type ?? 'day_of_month'}
                  onChange={(_, d) => setForm({ ...form, trigger_type: d.value, trigger_value: DEFAULT_TRIGGER_VALUES[d.value] ?? 1 })}
                >
                  <Radio value="day_of_month" label="On a specific day of the month" />
                  <Radio value="day_of_week" label="On a specific day of the week" />
                  <Radio value="days_before_period_close" label="X days before period closes" />
                </RadioGroup>
              </div>

              {/* Day of Month — mini calendar grid */}
              {form.trigger_type === 'day_of_month' && (
                <div className={panelStyles.dialogField}>
                  <Label>Day of month</Label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginTop: '4px' }}>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => setForm({ ...form, trigger_value: day })}
                        style={{
                          padding: '6px 0',
                          borderRadius: tokens.borderRadiusMedium,
                          border: `1px solid ${form.trigger_value === day ? tokens.colorBrandBackground : tokens.colorNeutralStroke1}`,
                          background: form.trigger_value === day ? tokens.colorBrandBackground : 'transparent',
                          color: form.trigger_value === day ? tokens.colorNeutralForegroundOnBrand : tokens.colorNeutralForeground1,
                          cursor: 'pointer',
                          fontSize: tokens.fontSizeBase200,
                          textAlign: 'center',
                        }}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: '6px', display: 'block' }}>
                    Will run on the {ordinal(form.trigger_value ?? 1)} of each month
                  </Text>
                </div>
              )}

              {/* Day of Week — pill buttons */}
              {form.trigger_type === 'day_of_week' && (
                <div className={panelStyles.dialogField}>
                  <Label>Day of week</Label>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setForm({ ...form, trigger_value: i })}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '100px',
                          border: `1px solid ${form.trigger_value === i ? tokens.colorBrandBackground : tokens.colorNeutralStroke1}`,
                          background: form.trigger_value === i ? tokens.colorBrandBackground : 'transparent',
                          color: form.trigger_value === i ? tokens.colorNeutralForegroundOnBrand : tokens.colorNeutralForeground1,
                          cursor: 'pointer',
                          fontSize: tokens.fontSizeBase300,
                        }}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: '6px', display: 'block' }}>
                    Will run every {DAYS_OF_WEEK[form.trigger_value ?? 0]}
                  </Text>
                </div>
              )}

              {/* Days before period close */}
              {form.trigger_type === 'days_before_period_close' && (() => {
                const today = new Date();
                const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
                const closeDate = lastDay.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
                const nDays = form.trigger_value ?? 3;
                const triggerDay = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() - nDays);
                const triggerDate = triggerDay.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
                return (
                  <div className={panelStyles.dialogField}>
                    <Label>Days before period close (1–14)</Label>
                    <input
                      type="number"
                      min={1}
                      max={14}
                      value={nDays}
                      onChange={(e) => setForm({ ...form, trigger_value: Number(e.target.value) })}
                      style={{ padding: '8px', borderRadius: tokens.borderRadiusMedium, border: `1px solid ${tokens.colorNeutralStroke1}`, fontSize: tokens.fontSizeBase300, width: '100%' }}
                    />
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: '6px', display: 'block' }}>
                      Enter {nDays} to send notifications {nDays} day{nDays !== 1 ? 's' : ''} before the period locks.
                      {' '}Current period closes on {closeDate}. Next trigger: {triggerDate}.
                    </Text>
                  </div>
                );
              })()}

              {/* Time — hour + minute dropdowns */}
              <div className={panelStyles.dialogField}>
                <Label required>Time (UTC+2 / CEST)</Label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select
                    className={panelStyles.nativeSelect}
                    style={{ width: 'auto' }}
                    value={(form.time_of_day ?? '07:00').split(':')[0]}
                    onChange={(e) => {
                      const min = (form.time_of_day ?? '07:00').split(':')[1] ?? '00';
                      setForm({ ...form, time_of_day: `${e.target.value}:${min}` });
                    }}
                  >
                    {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  <Text weight="semibold">:</Text>
                  <select
                    className={panelStyles.nativeSelect}
                    style={{ width: 'auto' }}
                    value={(form.time_of_day ?? '07:00').split(':')[1] ?? '00'}
                    onChange={(e) => {
                      const hr = (form.time_of_day ?? '07:00').split(':')[0] ?? '07';
                      setForm({ ...form, time_of_day: `${hr}:${e.target.value}` });
                    }}
                  >
                    {['00', '15', '30', '45'].map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: '6px', display: 'block' }}>
                  Will send at {form.time_of_day ?? '07:00'} CEST
                </Text>
              </div>

              {/* Recipients */}
              <div className={panelStyles.dialogField}>
                <Label>Recipients</Label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                  {form.notification_type !== 'missing_actuals' && (
                    <Checkbox
                      label="Notify PMs (scoped to their projects)"
                      checked={form.notify_pm !== false}
                      onChange={(_, d) => setForm({ ...form, notify_pm: d.checked as boolean })}
                    />
                  )}
                  <Checkbox
                    label="Notify Managers / ROs (scoped to their department)"
                    checked={form.notify_manager !== false}
                    onChange={(_, d) => setForm({ ...form, notify_manager: d.checked as boolean })}
                  />
                  <Checkbox
                    label="Notify Finance & Admin (full overview)"
                    checked={form.notify_finance !== false}
                    onChange={(_, d) => setForm({ ...form, notify_finance: d.checked as boolean })}
                  />
                  {form.notification_type === 'missing_actuals' && (
                    <Checkbox
                      label="Notify Employees (their own missing actuals)"
                      checked={form.notify_employee !== false}
                      onChange={(_, d) => setForm({ ...form, notify_employee: d.checked as boolean })}
                    />
                  )}
                </div>
              </div>

              <Checkbox
                label="Active"
                checked={form.is_active !== false}
                onChange={(_, d) => setForm({ ...form, is_active: d.checked as boolean })}
              />

              {/* Excluded Recipients */}
              <div className={panelStyles.dialogField} style={{ marginTop: tokens.spacingVerticalM }}>
                <Text weight="semibold" style={{ display: 'block', marginBottom: '2px' }}>
                  Excluded Recipients
                </Text>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: 'block', marginBottom: tokens.spacingVerticalS }}>
                  These users will never receive emails from this schedule.
                </Text>

                {/* Typeahead input */}
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Search by name or email to exclude…"
                    value={exclusionSearch}
                    onChange={(e) => setExclusionSearch(e.target.value)}
                    style={{
                      padding: '8px',
                      borderRadius: tokens.borderRadiusMedium,
                      border: `1px solid ${tokens.colorNeutralStroke1}`,
                      fontSize: tokens.fontSizeBase300,
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  />
                  {exclusionSearch.trim().length > 0 && (() => {
                    const q = exclusionSearch.trim().toLowerCase();
                    const matches = allUsers.filter(
                      (u) =>
                        !excludedEmails.includes(u.email) &&
                        (u.display_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
                    ).slice(0, 10);
                    if (matches.length === 0) return null;
                    return (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        zIndex: 9999,
                        background: tokens.colorNeutralBackground1,
                        border: `1px solid ${tokens.colorNeutralStroke1}`,
                        borderRadius: tokens.borderRadiusMedium,
                        boxShadow: tokens.shadow8,
                        maxHeight: '200px',
                        overflowY: 'auto',
                      }}>
                        {matches.map((u) => (
                          <div
                            key={u.id}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setExcludedEmails((prev) => [...prev, u.email]);
                              setExclusionSearch('');
                            }}
                            style={{
                              padding: '8px 12px',
                              cursor: 'pointer',
                              fontSize: tokens.fontSizeBase300,
                              borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = tokens.colorNeutralBackground1Hover; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                          >
                            <strong>{u.display_name}</strong>
                            <span style={{ color: tokens.colorNeutralForeground3, marginLeft: 6, fontSize: tokens.fontSizeBase200 }}>
                              &lt;{u.email}&gt;
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* Pills */}
                <div style={{ marginTop: tokens.spacingVerticalS }}>
                  {excludedEmails.length === 0 ? (
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>
                      No exclusions — all eligible recipients will receive this notification.
                    </Text>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {excludedEmails.map((email) => (
                        <div
                          key={email}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
                            borderRadius: tokens.borderRadiusMedium,
                            background: tokens.colorNeutralBackground3,
                            fontSize: tokens.fontSizeBase200,
                          }}
                        >
                          {email}
                          <button
                            type="button"
                            onClick={() => setExcludedEmails((prev) => prev.filter((e) => e !== email))}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: '0 2px',
                              fontSize: tokens.fontSizeBase300,
                              color: tokens.colorNeutralForeground3,
                              lineHeight: 1,
                            }}
                            title={`Remove ${email}`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Schedule summary preview */}
              <div style={{
                padding: tokens.spacingVerticalM,
                borderRadius: tokens.borderRadiusMedium,
                background: tokens.colorNeutralBackground2,
                marginTop: tokens.spacingVerticalM,
              }}>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>
                  {scheduleSummary(form)}
                </Text>
              </div>
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
  const { showSuccess, showError, showApiError } = useToast();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [selectedTab, setSelectedTab] = useState<TabValue>(searchParams.get('tab') ?? 'cost-centers');
  const [loading, setLoading] = useState(true);

  const canManageMasterData = user?.role === 'Admin' || user?.role === 'Finance';
  const canManageSettings = user?.role === 'Admin';
  const canManageDelegates = user?.role === 'Admin' || user?.role === 'Finance' || user?.role === 'Manager';
  const canManageFinanceData = user?.role === 'Admin' || user?.role === 'Finance';

  // ── Period context (for Snapshots and Cost Report tabs) ──
  const {
    periods,
    selectedPeriodId,
    setSelectedPeriodId,
    selectedPeriod: currentPeriod,
  } = usePeriod();

  // ── Snapshots tab state ──
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  const [publishName, setPublishName] = useState('');
  const [publishDescription, setPublishDescription] = useState('');


  const latestSnapshot = useMemo(() =>
    snapshots.length > 0
      ? [...snapshots].sort((a, b) =>
          new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
        )[0]
      : null,
    [snapshots]
  );

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

  // Delegate combobox search state
  const [delegatorSearch, setDelegatorSearch] = useState('');
  const [delegateSearch, setDelegateSearch] = useState('');

  const delegateUserInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  };

  const delegateOptionLabel = (u: AdminUser) => {
    const ini = delegateUserInitials(u.display_name);
    const cc = u.cost_center_name ? ` — ${u.cost_center_name}` : '';
    return `${ini} ${u.display_name} (${u.role})${cc}`;
  };

  const filterDelegateUsers = (users: AdminUser[], query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      u.display_name.toLowerCase().includes(q) ||
      delegateUserInitials(u.display_name).toLowerCase().includes(q)
    );
  };

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<unknown>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  // Detail dialog state (cost center resources, resource/placeholder details)
  const [detailItem, setDetailItem] = useState<CostCenter | Resource | Placeholder | null>(null);
  const [detailType, setDetailType] = useState<'cost-center' | 'resource' | 'placeholder' | null>(null);
  const [detailResources, setDetailResources] = useState<Resource[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [ccHierarchy, setCcHierarchy] = useState<CostCenterHierarchy | null>(null);
  const [hierarchyLoading, setHierarchyLoading] = useState(false);

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

  // ── Finance data loaders (Snapshots + Cost Report tabs) ──

  const loadSnapshots = useCallback(async () => {
    if (!canManageFinanceData) return;
    try {
      const data = await consolidationApi.getSnapshots(selectedPeriodId);
      setSnapshots(data);
    } catch (err) {
      showApiError(err as Error, 'Failed to load snapshots');
    }
  }, [selectedPeriodId, canManageFinanceData]);

  const handlePublish = async () => {
    if (!publishName.trim()) { showError('Name is required'); return; }
    try {
      await consolidationApi.publishSnapshot(selectedPeriodId, publishName, publishDescription || undefined);
      showSuccess('Snapshot published successfully');
      setIsPublishDialogOpen(false);
      setPublishName('');
      setPublishDescription('');
      loadSnapshots();
    } catch (err) {
      showApiError(err as Error, 'Failed to publish snapshot');
    }
  };

  // Reload snapshots when period changes while on that tab
  useEffect(() => {
    if (selectedPeriodId && selectedTab === 'snapshots') loadSnapshots();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodId]);

  // Load snapshots when switching to that tab
  useEffect(() => {
    if (selectedTab === 'snapshots' && selectedPeriodId) loadSnapshots();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab]);

  const handleTabSelect: SelectTabEventHandler = (_, data) => {
    setSelectedTab(data.value as TabValue);
  };

  const openCreateDialog = () => {
    setEditItem(null);
    setFormData({});
    setDelegatorSearch('');
    setDelegateSearch('');
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
    setCcHierarchy(null);
    setDetailLoading(true);
    setHierarchyLoading(true);
    try {
      const [res, hier] = await Promise.all([
        adminApi.listResources(),
        adminApi.getCostCenterHierarchy(cc.id).catch(() => null),
      ]);
      setDetailResources(res.filter((r) => r.cost_center_id === cc.id));
      setCcHierarchy(hier);
    } catch {
      setDetailResources([]);
    } finally {
      setDetailLoading(false);
      setHierarchyLoading(false);
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

    // ── Finance-data tabs (self-managed, no master-data loading) ──
    if (selectedTab === 'periods') {
      return <PeriodPanel variant="embedded" />;
    }

    if (selectedTab === 'snapshots') {
      return (
        <>
          {/* Period selector + Publish button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalL, marginBottom: tokens.spacingVerticalL, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS }}>
              <span style={{ fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground2, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Period</span>
              <PeriodSelector periods={periods} selectedId={selectedPeriodId} onSelect={setSelectedPeriodId} />
            </div>
            <Button appearance="primary" style={{ marginTop: 'auto' }} onClick={() => setIsPublishDialogOpen(true)}>
              Publish Snapshot
            </Button>
            <span style={{ marginLeft: 'auto', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
              {latestSnapshot
                ? `Last snapshot: ${new Date(latestSnapshot.published_at).toLocaleDateString()}`
                : 'No snapshots yet'}
            </span>
          </div>
          <SnapshotsTab snapshots={snapshots} canDownloadCsv={canManageFinanceData} showApiError={showApiError} />
        </>
      );
    }

    if (selectedTab === 'cost-report') {
      return (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalL, marginBottom: tokens.spacingVerticalL, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS }}>
              <span style={{ fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground2, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Period</span>
              <PeriodSelector periods={periods} selectedId={selectedPeriodId} onSelect={setSelectedPeriodId} />
            </div>
          </div>
          <CostReportTab
            selectedPeriodId={selectedPeriodId}
            currentPeriod={currentPeriod}
            showSuccess={showSuccess}
            showError={showError}
            showApiError={showApiError}
          />
        </>
      );
    }

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
                  <TableHeaderCell>Location</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCostCenters.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
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
                    <TableCell>{cc.location ?? '—'}</TableCell>
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
                      {resource.user_role ? (
                        <Badge color={
                          resource.user_role === 'Manager' ? 'warning' :
                          resource.user_role === 'PM'      ? 'brand'   :
                          resource.user_role === 'Finance' ? 'success'  :
                          resource.user_role === 'Admin'   ? 'danger'   :
                          'informative'
                        }>
                          {resource.user_role}
                        </Badge>
                      ) : (
                        <Badge color="subtle">—</Badge>
                      )}
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
                  <TableHeaderCell>Secondary Role</TableHeaderCell>
                  <TableHeaderCell>Cost Center</TableHeaderCell>
                  <TableHeaderCell>Active</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAdminUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
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
                    <TableCell>
                      {u.role === 'Manager' ? (
                        <select
                          className={styles.nativeSelect}
                          value={u.secondary_role ?? ''}
                          onChange={async (e) => {
                            const val = e.target.value || null;
                            try {
                              const updated = await adminApi.updateAdminUserSecondaryRole(u.id, val);
                              setAdminUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
                              showSuccess('Secondary role updated');
                            } catch (err) {
                              showApiError(err as Error, 'Failed to update secondary role');
                            }
                          }}
                        >
                          <option value="">None</option>
                          <option value="Reader">Reader</option>
                        </select>
                      ) : (
                        u.secondary_role ? (
                          <Badge appearance="filled" color="informative" style={{ fontSize: '11px' }}>
                            {u.secondary_role}
                          </Badge>
                        ) : (
                          <span style={{ color: 'var(--colorNeutralForeground3)' }}>—</span>
                        )
                      )}
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
            <div className={styles.dialogField}>
              <Label>Location</Label>
              <Input
                value={String(formData.location || '')}
                placeholder="e.g. Denmark, Poland"
                onChange={(_, d) => setFormData({ ...formData, location: d.value || null })}
              />
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
                    <Combobox
                      placeholder="Search by name or initials…"
                      value={delegatorSearch}
                      onInput={(e) => {
                        const q = (e.target as HTMLInputElement).value;
                        setDelegatorSearch(q);
                        if (!q) setFormData({ ...formData, delegator_id: '' });
                      }}
                      onOptionSelect={(_, d) => {
                        setFormData({ ...formData, delegator_id: d.optionValue ?? '' });
                        const picked = pmUsers.find(u => u.id === d.optionValue);
                        setDelegatorSearch(picked ? delegateOptionLabel(picked) : '');
                      }}
                      selectedOptions={formData.delegator_id ? [String(formData.delegator_id)] : []}
                    >
                      {filterDelegateUsers(
                        pmUsers.filter(u => u.role === 'Manager' || u.role === 'Admin'),
                        delegatorSearch
                      ).map(u => (
                        <Option key={u.id} value={u.id} text={delegateOptionLabel(u)}>
                          {delegateOptionLabel(u)}
                        </Option>
                      ))}
                    </Combobox>
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
                  <Combobox
                    placeholder="Search by name or initials…"
                    value={delegateSearch}
                    onInput={(e) => {
                      const q = (e.target as HTMLInputElement).value;
                      setDelegateSearch(q);
                      if (!q) setFormData({ ...formData, delegate_id: '' });
                    }}
                    onOptionSelect={(_, d) => {
                      setFormData({ ...formData, delegate_id: d.optionValue ?? '' });
                      const picked = pmUsers.find(u => u.id === d.optionValue);
                      setDelegateSearch(picked ? delegateOptionLabel(picked) : '');
                    }}
                    selectedOptions={formData.delegate_id ? [String(formData.delegate_id)] : []}
                  >
                    {filterDelegateUsers(
                      pmUsers.filter(u => u.role === 'Manager' || u.role === 'Admin'),
                      delegateSearch
                    ).map(u => (
                      <Option key={u.id} value={u.id} text={delegateOptionLabel(u)}>
                        {delegateOptionLabel(u)}
                      </Option>
                    ))}
                  </Combobox>
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
            {cc.location && (
              <><span className={styles.detailLabel}>Location</span><span>{cc.location}</span></>
            )}
            <span className={styles.detailLabel}>Status</span>
            <span><StatusPill status={resourceStatus(cc.is_active)} /></span>
          </div>

          <div className={styles.sectionTitle}>Management Chain</div>
          {hierarchyLoading ? (
            <Spinner size="tiny" label="Loading hierarchy…" />
          ) : !ccHierarchy || ccHierarchy.chain.length === 0 ? (
            <Text className={styles.emptyHint}>No management chain configured for this cost center.</Text>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {ccHierarchy.chain.map((member, idx) => (
                <div key={member.user_id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      backgroundColor: idx === 0 ? tokens.colorBrandBackground : tokens.colorNeutralBackground4,
                      color: idx === 0 ? tokens.colorNeutralForegroundOnBrand : tokens.colorNeutralForeground1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: tokens.fontSizeBase200, fontWeight: 600, flexShrink: 0,
                    }}>
                      {member.display_name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: tokens.fontSizeBase300 }}>{member.display_name}</div>
                      <div style={{ color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 }}>
                        {member.title}{member.email ? ` · ${member.email}` : ''}
                      </div>
                    </div>
                  </div>
                  {idx < ccHierarchy.chain.length - 1 && (
                    <div style={{
                      width: 2, height: 16, marginLeft: 15,
                      backgroundColor: tokens.colorNeutralStroke1,
                    }} />
                  )}
                </div>
              ))}
            </div>
          )}

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
          <span>
            {r.user_role ? (
              <Badge color={
                r.user_role === 'Manager' ? 'warning' :
                r.user_role === 'PM'      ? 'brand'   :
                r.user_role === 'Finance' ? 'success'  :
                r.user_role === 'Admin'   ? 'danger'   :
                'informative'
              }>
                {r.user_role}
              </Badge>
            ) : (
              <Badge color="subtle">—</Badge>
            )}
          </span>
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
    'periods': 'Periods',
    'snapshots': 'Snapshots',
    'cost-report': 'Cost Report',
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
        <div className={styles.tabBarWrapper}>
        <TabList selectedValue={selectedTab} onTabSelect={handleTabSelect}>
          {canManageMasterData && <Tab value="cost-centers" icon={<OrganizationRegular />}>Cost Centers</Tab>}
          {canManageMasterData && <Tab value="projects" icon={<FolderRegular />}>Projects</Tab>}
          {canManageMasterData && <Tab value="resources" icon={<PersonRegular />}>Resources</Tab>}
          {canManageMasterData && <Tab value="placeholders" icon={<PersonQuestionMarkRegular />}>Placeholders</Tab>}
          {canManageFinanceData && <Tab value="periods" icon={<CalendarMonthRegular />}>Periods</Tab>}
          {canManageFinanceData && <Tab value="snapshots" icon={<CameraRegular />}>Snapshots</Tab>}
          {canManageFinanceData && <Tab value="cost-report" icon={<MoneyRegular />}>Cost Report</Tab>}
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
        </div>

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
            {selectedTab !== 'users' && selectedTab !== 'sync' && selectedTab !== 'notifications' &&
             selectedTab !== 'periods' && selectedTab !== 'snapshots' && selectedTab !== 'cost-report' &&
             (canManageMasterData ||
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

      {/* Publish Snapshot dialog */}
      {canManageFinanceData && (
        <Dialog open={isPublishDialogOpen} onOpenChange={(_, data) => setIsPublishDialogOpen(data.open)}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Publish Snapshot</DialogTitle>
              <DialogContent>
                <MessageBar intent="info" style={{ marginBottom: tokens.spacingVerticalM }}>
                  <MessageBarBody>A snapshot is an immutable copy of planning data at this point in time.</MessageBarBody>
                </MessageBar>
                {currentPeriod && (
                  <div style={{ marginBottom: tokens.spacingVerticalM }}>
                    <Body2 style={{ fontWeight: tokens.fontWeightSemibold }}>Period</Body2>
                    <Body1>{currentPeriod.year}-{String(currentPeriod.month).padStart(2, '0')}</Body1>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS, marginBottom: tokens.spacingVerticalM }}>
                  <label>Snapshot Name *</label>
                  <Input
                    value={publishName}
                    onChange={(_, data) => setPublishName(data.value)}
                    placeholder={`${currentPeriod?.year}-${String(currentPeriod?.month ?? 1).padStart(2, '0')} Final`}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS, marginBottom: tokens.spacingVerticalM }}>
                  <label>Description (optional)</label>
                  <Textarea
                    value={publishDescription}
                    onChange={(_, data) => setPublishDescription(data.value)}
                    placeholder="Optional description..."
                  />
                </div>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setIsPublishDialogOpen(false)}>Cancel</Button>
                <Button appearance="primary" onClick={handlePublish}>Publish</Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </div>
  );
}
