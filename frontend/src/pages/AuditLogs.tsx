/**
 * Audit Logs Page
 *
 * Admin and Finance: View all audit log entries with filters, pagination,
 * UTC+2 timestamps, and a details dialog.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button,
  Spinner,
  Badge,
  tokens,
  makeStyles,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Input,
  Select,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  Text,
  Tooltip,
} from '@fluentui/react-components';
import {
  ArrowClockwise24Regular,
  DocumentBulletList24Regular,
  FilterRegular,
} from '@fluentui/react-icons';
import { apiClient, AuditLogEntry, AuditLogParams } from '../api/client';
import { EmptyState } from '../components/EmptyState';

// ─── Label mappings ────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  approve: 'Approved',
  reject: 'Rejected',
  proxy_approve_step: 'Approved as delegate',
  proxy_approve_step1: 'Approved as delegate',
  proxy_sign: 'Signed as proxy',
  resubmit: 'Resubmitted',
  lock: 'Locked',
  unlock: 'Unlocked',
  sign: 'Signed',
  unsign: 'Unsigned',
  publish: 'Published',
  run_notifications: 'Notifications run',
  run_conflict_alerts: 'Conflict alerts run',
  run_missing_actuals_alerts: 'Missing actuals alerts run',
  run_planning_reminder: 'Planning reminder run',
  run_approval_reminder: 'Approval reminder run',
  auto_override_from_cc_manager_change: 'Auto override (manager change)',
};

const ENTITY_LABELS: Record<string, string> = {
  ApprovalStep: 'Approval step',
  ApprovalInstance: 'Approval instance',
  ActualLine: 'Actual line',
  DemandLine: 'Demand line',
  SupplyLine: 'Supply line',
  ApprovalDelegate: 'Approval delegate',
  Period: 'Period',
  CostCenter: 'Cost center',
  Resource: 'Resource',
  Placeholder: 'Placeholder',
  Holiday: 'Holiday',
  Settings: 'Settings',
  ManagerOverride: 'Manager override',
};

// Options for filter dropdowns (value = raw backend value, label = friendly)
const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'create', label: 'Created' },
  { value: 'update', label: 'Updated' },
  { value: 'delete', label: 'Deleted' },
  { value: 'approve', label: 'Approved' },
  { value: 'reject', label: 'Rejected' },
  { value: 'proxy_approve_step1', label: 'Approved as delegate' },
  { value: 'proxy_sign', label: 'Signed as proxy' },
  { value: 'sign', label: 'Signed' },
  { value: 'unsign', label: 'Unsigned' },
  { value: 'resubmit', label: 'Resubmitted' },
  { value: 'lock', label: 'Locked' },
  { value: 'unlock', label: 'Unlocked' },
  { value: 'publish', label: 'Published' },
];

const ENTITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'CostCenter', label: 'Cost center' },
  { value: 'DemandLine', label: 'Demand line' },
  { value: 'SupplyLine', label: 'Supply line' },
  { value: 'Resource', label: 'Resource' },
  { value: 'Placeholder', label: 'Placeholder' },
  { value: 'ActualLine', label: 'Actual line' },
  { value: 'ApprovalStep', label: 'Approval step' },
  { value: 'ApprovalInstance', label: 'Approval instance' },
  { value: 'ApprovalDelegate', label: 'Approval delegate' },
  { value: 'Period', label: 'Period' },
  { value: 'Settings', label: 'Settings' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getEntityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType;
}

type BadgeColor = 'success' | 'danger' | 'warning' | 'brand' | 'informative' | 'subtle';

function getActionBadgeColor(action: string): BadgeColor {
  if (['approve', 'proxy_approve_step', 'proxy_approve_step1', 'sign', 'proxy_sign', 'unlock', 'publish'].includes(action)) {
    return 'success';
  }
  if (['reject', 'delete'].includes(action)) return 'danger';
  if (['lock', 'unsign'].includes(action)) return 'warning';
  if (action === 'create') return 'brand';
  if (['update', 'resubmit'].includes(action)) return 'informative';
  return 'subtle';
}

/**
 * Format a UTC timestamp (naive or with Z) as UTC+2.
 * Backend stores naive datetimes representing UTC; the router appends "Z".
 */
function formatAuditTimestampUtcPlus2(timestamp: string): string {
  // Ensure the string is treated as UTC
  const ts = /Z$|[+-]\d{2}:\d{2}$/.test(timestamp) ? timestamp : timestamp + 'Z';
  const date = new Date(ts);
  if (isNaN(date.getTime())) return timestamp;
  return (
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Etc/GMT-2',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date) + ' UTC+2'
  );
}

function toRawUtcString(timestamp: string): string {
  return /Z$|[+-]\d{2}:\d{2}$/.test(timestamp) ? timestamp : timestamp + 'Z';
}

function formatJson(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function shortId(id: string | null): string {
  if (!id) return '—';
  return id.length > 10 ? id.slice(0, 8) + '…' : id;
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  page: {
    padding: `${tokens.spacingVerticalXL} ${tokens.spacingHorizontalXXL}`,
    maxWidth: '1600px',
    margin: '0 auto',
    minHeight: 'calc(100vh - 80px)',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    flexWrap: 'wrap',
    marginBottom: tokens.spacingVerticalM,
  },
  searchInput: {
    width: '220px',
  },
  filterSelect: {
    minWidth: '160px',
  },
  dateInput: {
    padding: `0 ${tokens.spacingHorizontalS}`,
    height: '32px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: 'pointer',
  },
  statusLine: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    marginBottom: tokens.spacingVerticalS,
    paddingLeft: tokens.spacingHorizontalXS,
  },
  tableWrapper: {
    overflowX: 'auto',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    '& thead th': {
      backgroundColor: tokens.colorNeutralBackground2,
      fontWeight: tokens.fontWeightSemibold,
      fontSize: tokens.fontSizeBase200,
      color: tokens.colorNeutralForeground2,
      padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
      textTransform: 'uppercase',
      letterSpacing: '0.4px',
      borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
      whiteSpace: 'nowrap',
    },
    '& tbody td': {
      padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
      borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
      fontSize: tokens.fontSizeBase300,
      verticalAlign: 'middle',
      height: '40px',
    },
    '& tbody tr:last-child td': {
      borderBottom: 'none',
    },
    '& tbody tr:hover td': {
      backgroundColor: tokens.colorNeutralBackground2,
    },
  },
  eventCell: {
    whiteSpace: 'nowrap',
  },
  entityDot: {
    color: tokens.colorNeutralForeground3,
    margin: `0 ${tokens.spacingHorizontalXS}`,
  },
  entityType: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  reasonText: {
    maxWidth: '180px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'block',
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  targetId: {
    fontFamily: 'monospace',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  viewBtn: {
    padding: 0,
    minWidth: 'auto',
    height: 'auto',
    fontSize: tokens.fontSizeBase200,
  },
  loadMoreBar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  errorBox: {
    padding: tokens.spacingVerticalM,
    color: tokens.colorPaletteRedForeground1,
    border: `1px solid ${tokens.colorPaletteRedBorder1}`,
    borderRadius: tokens.borderRadiusMedium,
    marginBottom: tokens.spacingVerticalM,
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
  },
  // Details dialog
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: '130px 1fr',
    gap: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    marginBottom: tokens.spacingVerticalM,
  },
  detailLabel: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    alignSelf: 'start',
    paddingTop: '2px',
  },
  detailValue: {
    fontSize: tokens.fontSizeBase300,
    wordBreak: 'break-all',
  },
  detailRaw: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontFamily: 'monospace',
  },
  jsonBlock: {
    fontFamily: 'monospace',
    fontSize: tokens.fontSizeBase200,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    maxHeight: '180px',
    overflowY: 'auto',
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusSmall,
    padding: tokens.spacingVerticalS,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  jsonSectionTitle: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    marginTop: tokens.spacingVerticalS,
    marginBottom: tokens.spacingVerticalXS,
  },
  dialogTitle: {
    paddingRight: tokens.spacingHorizontalXL,
  },
});

// ─── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

interface Filters {
  q: string;
  action: string;
  entity_type: string;
  actor: string;
  from_date: string;
  to_date: string;
}

const EMPTY_FILTERS: Filters = {
  q: '',
  action: '',
  entity_type: '',
  actor: '',
  from_date: '',
  to_date: '',
};

function hasActiveFilters(f: Filters): boolean {
  return Object.values(f).some(v => v !== '');
}

// ─── Details Dialog ────────────────────────────────────────────────────────────

interface DetailsDialogProps {
  log: AuditLogEntry | null;
  onClose: () => void;
}

const DetailsDialog: React.FC<DetailsDialogProps> = ({ log, onClose }) => {
  const styles = useStyles();
  if (!log) return null;

  const oldJson = formatJson(log.old_values);
  const newJson = formatJson(log.new_values);

  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: '620px', width: '95vw' }}>
        <DialogTitle className={styles.dialogTitle}>
          <span>
            <Badge color={getActionBadgeColor(log.action)} appearance="tint" size="small" style={{ marginRight: 6 }}>
              {getActionLabel(log.action)}
            </Badge>
            <span className={styles.entityType}>{getEntityLabel(log.entity_type)}</span>
          </span>
        </DialogTitle>
        <DialogBody>
          <DialogContent>
            <div className={styles.detailGrid}>
              <span className={styles.detailLabel}>Action</span>
              <span>
                <Text className={styles.detailValue}>{getActionLabel(log.action)}</Text>
                <br />
                <Text className={styles.detailRaw}>{log.action}</Text>
              </span>

              <span className={styles.detailLabel}>Actor</span>
              <Text className={styles.detailValue}>{log.user_email}</Text>

              <span className={styles.detailLabel}>Time</span>
              <span>
                <Text className={styles.detailValue}>{formatAuditTimestampUtcPlus2(log.timestamp)}</Text>
                <br />
                <Text className={styles.detailRaw}>Raw UTC: {toRawUtcString(log.timestamp)}</Text>
              </span>

              <span className={styles.detailLabel}>Entity type</span>
              <span>
                <Text className={styles.detailValue}>{getEntityLabel(log.entity_type)}</Text>
                <br />
                <Text className={styles.detailRaw}>{log.entity_type}</Text>
              </span>

              <span className={styles.detailLabel}>Entity ID</span>
              <Text className={styles.detailRaw} style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {log.entity_id ?? '—'}
              </Text>

              {log.reason && (
                <>
                  <span className={styles.detailLabel}>Reason</span>
                  <Text className={styles.detailValue}>{log.reason}</Text>
                </>
              )}

              {log.ip_address && (
                <>
                  <span className={styles.detailLabel}>IP address</span>
                  <Text className={styles.detailRaw}>{log.ip_address}</Text>
                </>
              )}
            </div>

            {(oldJson || newJson) && (
              <>
                {oldJson && (
                  <>
                    <div className={styles.jsonSectionTitle}>Before</div>
                    <div className={styles.jsonBlock}>{oldJson}</div>
                  </>
                )}
                {newJson && (
                  <>
                    <div className={styles.jsonSectionTitle}>After</div>
                    <div className={styles.jsonBlock}>{newJson}</div>
                  </>
                )}
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};

// ─── Main Page ─────────────────────────────────────────────────────────────────

export const AuditLogs: React.FC = () => {
  const styles = useStyles();

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // Debounced text fields (q and actor)
  const [debouncedQ, setDebouncedQ] = useState('');
  const [debouncedActor, setDebouncedActor] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build API params from current filters + debounced text fields
  const buildParams = useCallback(
    (currentOffset: number): AuditLogParams => ({
      limit: PAGE_SIZE,
      offset: currentOffset,
      action: filters.action || undefined,
      entity_type: filters.entity_type || undefined,
      actor: debouncedActor || undefined,
      q: debouncedQ || undefined,
      from_date: filters.from_date || undefined,
      to_date: filters.to_date || undefined,
    }),
    [filters, debouncedQ, debouncedActor],
  );

  const fetchLogs = useCallback(
    async (append: boolean) => {
      const currentOffset = append ? offset : 0;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const resp = await apiClient.getAuditLogs(buildParams(currentOffset));
        if (append) {
          setLogs(prev => [...prev, ...resp.items]);
        } else {
          setLogs(resp.items);
        }
        setHasMore(resp.has_more);
        setOffset(currentOffset + resp.items.length);
      } catch {
        setError('Could not load audit logs.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [buildParams, offset],
  );

  // Reload from page 1 when filters/debounced values change
  useEffect(() => {
    setOffset(0);
    setLogs([]);
    setLoading(true);
    setError(null);
    apiClient
      .getAuditLogs(buildParams(0))
      .then(resp => {
        setLogs(resp.items);
        setHasMore(resp.has_more);
        setOffset(resp.items.length);
      })
      .catch(() => setError('Could not load audit logs.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.action, filters.entity_type, filters.from_date, filters.to_date, debouncedQ, debouncedActor]);

  // Debounce q
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(filters.q), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [filters.q]);

  // Debounce actor
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedActor(filters.actor), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [filters.actor]);

  const handleRefresh = () => {
    setOffset(0);
    setLogs([]);
    setLoading(true);
    setError(null);
    apiClient
      .getAuditLogs(buildParams(0))
      .then(resp => {
        setLogs(resp.items);
        setHasMore(resp.has_more);
        setOffset(resp.items.length);
      })
      .catch(() => setError('Could not load audit logs.'))
      .finally(() => setLoading(false));
  };

  const handleResetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setDebouncedQ('');
    setDebouncedActor('');
  };

  const setFilter = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const filtersActive = hasActiveFilters(filters);

  const statusText = loading
    ? 'Loading…'
    : filtersActive
    ? `${logs.length} filtered result${logs.length !== 1 ? 's' : ''}`
    : `Showing ${logs.length} latest entr${logs.length !== 1 ? 'ies' : 'y'}`;

  return (
    <div className={styles.page}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <Button
          appearance="secondary"
          icon={<ArrowClockwise24Regular />}
          onClick={handleRefresh}
          disabled={loading}
        >
          Refresh
        </Button>

        <Input
          className={styles.searchInput}
          placeholder="Search…"
          value={filters.q}
          onChange={(_, d) => setFilter('q', d.value)}
          contentBefore={<FilterRegular />}
        />

        <Select
          className={styles.filterSelect}
          value={filters.action}
          onChange={(_, d) => setFilter('action', d.value)}
        >
          <option value="">All actions</option>
          {ACTION_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>

        <Select
          className={styles.filterSelect}
          value={filters.entity_type}
          onChange={(_, d) => setFilter('entity_type', d.value)}
        >
          <option value="">All entity types</option>
          {ENTITY_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>

        <Input
          placeholder="Actor (email)"
          value={filters.actor}
          onChange={(_, d) => setFilter('actor', d.value)}
          style={{ width: '160px' }}
        />

        <input
          type="date"
          className={styles.dateInput}
          value={filters.from_date}
          onChange={e => setFilter('from_date', e.target.value)}
          title="From date"
        />
        <input
          type="date"
          className={styles.dateInput}
          value={filters.to_date}
          onChange={e => setFilter('to_date', e.target.value)}
          title="To date"
        />

        {filtersActive && (
          <Button appearance="subtle" onClick={handleResetFilters}>
            Reset filters
          </Button>
        )}
      </div>

      {/* Status line */}
      {!loading && !error && (
        <div className={styles.statusLine}>{statusText}</div>
      )}

      {/* Error */}
      {error && (
        <div className={styles.errorBox}>
          <span>{error}</span>
          <Button appearance="secondary" size="small" onClick={handleRefresh}>
            Retry
          </Button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: tokens.spacingVerticalXXL }}>
          <Spinner size="medium" label="Loading audit logs…" />
        </div>
      )}

      {/* Table */}
      {!loading && !error && logs.length === 0 && (
        <EmptyState
          icon={<DocumentBulletList24Regular style={{ fontSize: 48 }} />}
          title="No audit logs"
          message={
            filtersActive
              ? 'No audit logs match the current filters.'
              : 'No log entries found, or you do not have permission to view them.'
          }
        />
      )}

      {!loading && logs.length > 0 && (
        <div className={styles.tableWrapper}>
          <Table className={styles.table} noNativeElements>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Time</TableHeaderCell>
                <TableHeaderCell>Actor</TableHeaderCell>
                <TableHeaderCell>Event</TableHeaderCell>
                <TableHeaderCell>Target</TableHeaderCell>
                <TableHeaderCell>Reason</TableHeaderCell>
                <TableHeaderCell>Details</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map(log => (
                <TableRow key={log.id}>
                  <TableCell>
                    <Tooltip content={`Raw UTC: ${toRawUtcString(log.timestamp)}`} relationship="label">
                      <Text style={{ whiteSpace: 'nowrap', fontSize: tokens.fontSizeBase200 }}>
                        {formatAuditTimestampUtcPlus2(log.timestamp)}
                      </Text>
                    </Tooltip>
                  </TableCell>

                  <TableCell>
                    <Text style={{ fontSize: tokens.fontSizeBase300 }}>{log.user_email}</Text>
                  </TableCell>

                  <TableCell className={styles.eventCell}>
                    <Badge
                      color={getActionBadgeColor(log.action)}
                      appearance="tint"
                      size="small"
                    >
                      {getActionLabel(log.action)}
                    </Badge>
                    <span className={styles.entityDot}>·</span>
                    <span className={styles.entityType}>{getEntityLabel(log.entity_type)}</span>
                  </TableCell>

                  <TableCell>
                    <Tooltip content={log.entity_id ?? ''} relationship="label">
                      <span className={styles.targetId}>{shortId(log.entity_id)}</span>
                    </Tooltip>
                  </TableCell>

                  <TableCell>
                    {log.reason ? (
                      <Tooltip content={log.reason} relationship="label">
                        <span className={styles.reasonText}>
                          {log.reason.length > 50 ? `${log.reason.slice(0, 50)}…` : log.reason}
                        </span>
                      </Tooltip>
                    ) : (
                      <Text style={{ color: tokens.colorNeutralForeground4 }}>—</Text>
                    )}
                  </TableCell>

                  <TableCell>
                    <Button
                      appearance="transparent"
                      size="small"
                      className={styles.viewBtn}
                      onClick={() => setSelectedLog(log)}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {(hasMore || loadingMore) && (
            <div className={styles.loadMoreBar}>
              <Button
                appearance="secondary"
                size="small"
                onClick={() => fetchLogs(true)}
                disabled={loadingMore}
              >
                {loadingMore ? <Spinner size="tiny" /> : 'Load more'}
              </Button>
              {!loadingMore && hasMore && (
                <Text style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                  More entries available
                </Text>
              )}
            </div>
          )}
        </div>
      )}

      {/* Details dialog */}
      {selectedLog && (
        <DetailsDialog log={selectedLog} onClose={() => setSelectedLog(null)} />
      )}
    </div>
  );
};

export default AuditLogs;
