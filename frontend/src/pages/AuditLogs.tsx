/**
 * Audit Logs Page
 *
 * Admin and Finance: View all audit log entries (lock/unlock, CRUD, sign, approve, etc.)
 */
import React, { useState, useEffect } from 'react';
import {
  Body1,
  Card,
  CardHeader,
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
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
} from '@fluentui/react-components';
import { ArrowClockwise24Regular, DocumentBulletList24Regular } from '@fluentui/react-icons';
import { apiClient, AuditLogEntry } from '../api/client';
import { EmptyState } from '../components/EmptyState';

const useStyles = makeStyles({
  container: {
    padding: tokens.spacingHorizontalXXL,
    maxWidth: '1600px',
    margin: '0 auto',
    minHeight: 'calc(100vh - 80px)',
  },
  header: {
    marginBottom: tokens.spacingVerticalXXL,
    paddingBottom: tokens.spacingVerticalL,
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  pageTitle: {
    fontSize: tokens.fontSizeHero800,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
    marginBottom: tokens.spacingVerticalXS,
    lineHeight: '1.2',
  },
  pageSubtitle: {
    fontSize: tokens.fontSizeBase400,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
  },
  card: {
    marginBottom: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  table: {
    width: '100%',
    '& thead': {
      backgroundColor: tokens.colorNeutralBackground2,
      position: 'sticky' as const,
      top: 0,
      zIndex: 1,
    },
    '& th': {
      fontWeight: tokens.fontWeightSemibold,
      fontSize: tokens.fontSizeBase300,
      color: tokens.colorNeutralForeground2,
      padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
    },
    '& td': {
      padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
      borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
      fontSize: tokens.fontSizeBase300,
    },
    '& tbody tr': {
      transition: 'background-color 0.15s ease',
      '&:hover': {
        backgroundColor: tokens.colorNeutralBackground1,
      },
    },
  },
  detailsPanel: {
    padding: tokens.spacingVerticalS,
    fontSize: tokens.fontSizeBase200,
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    maxHeight: '200px',
    overflowY: 'auto' as const,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusSmall,
  },
  loadMore: {
    marginTop: tokens.spacingVerticalM,
  },
});

const PAGE_SIZE = 100;

export const AuditLogs: React.FC = () => {
  const styles = useStyles();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadLogs = async (append: boolean = false) => {
    const currentOffset = append ? offset : 0;
    if (!append) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const data = await apiClient.getAuditLogs(PAGE_SIZE, currentOffset);
      if (append) {
        setLogs(prev => [...prev, ...data]);
      } else {
        setLogs(data);
      }
      setHasMore(data.length === PAGE_SIZE);
      setOffset(currentOffset + data.length);
    } catch {
      setError('Failed to load audit logs');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const formatTimestamp = (ts: string) => {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  const truncateId = (id: string | null) => {
    if (!id) return '—';
    return id.length > 12 ? `${id.slice(0, 8)}…` : id;
  };

  if (loading && logs.length === 0) {
    return (
      <div className={styles.container}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: tokens.spacingVerticalXXL }}>
          <Spinner size="large" label="Loading audit logs..." />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.pageTitle}>Audit logs</h1>
          <p className={styles.pageSubtitle}>All actions (lock/unlock, create, update, delete, sign, approve) for this tenant</p>
        </div>
        <Button
          appearance="secondary"
          icon={<ArrowClockwise24Regular />}
          onClick={() => loadLogs()}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>

      {error && (
        <Card className={styles.card}>
          <div style={{ padding: tokens.spacingVerticalL, color: tokens.colorPaletteRedForeground1 }}>
            {error}
          </div>
        </Card>
      )}

      <Card className={styles.card}>
        <CardHeader
          header={<Body1><strong>Log entries</strong></Body1>}
          action={logs.length > 0 ? <Badge appearance="outline">{logs.length} loaded</Badge> : null}
        />
        {logs.length === 0 ? (
          <EmptyState
            icon={<DocumentBulletList24Regular style={{ fontSize: 48 }} />}
            title="No audit logs"
            message="No log entries found, or you do not have permission to view them."
          />
        ) : (
          <>
            <Table className={styles.table}>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Timestamp</TableHeaderCell>
                  <TableHeaderCell>User</TableHeaderCell>
                  <TableHeaderCell>Action</TableHeaderCell>
                  <TableHeaderCell>Entity type</TableHeaderCell>
                  <TableHeaderCell>Entity ID</TableHeaderCell>
                  <TableHeaderCell>Reason</TableHeaderCell>
                  <TableHeaderCell>Details</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log, idx) => (
                  <React.Fragment key={`${log.timestamp}-${log.entity_id}-${idx}`}>
                    <TableRow>
                      <TableCell>{formatTimestamp(log.timestamp)}</TableCell>
                      <TableCell>{log.user_email}</TableCell>
                      <TableCell>
                        <Badge appearance="outline" size="small">{log.action}</Badge>
                      </TableCell>
                      <TableCell>{log.entity_type}</TableCell>
                      <TableCell title={log.entity_id ?? ''}>{truncateId(log.entity_id)}</TableCell>
                      <TableCell style={{ maxWidth: 200 }} title={log.reason ?? ''}>
                        {log.reason ? (log.reason.length > 40 ? `${log.reason.slice(0, 40)}…` : log.reason) : '—'}
                      </TableCell>
                      <TableCell>
                        {(log.old_values || log.new_values) ? (
                          <Accordion collapsible>
                            <AccordionItem value="details">
                              <AccordionHeader size="small">Details</AccordionHeader>
                              <AccordionPanel>
                                <div className={styles.detailsPanel}>
                                  {log.old_values && (
                                    <>
                                      <strong>Old:</strong> {log.old_values}
                                      {'\n'}
                                    </>
                                  )}
                                  {log.new_values && (
                                    <>
                                      <strong>New:</strong> {log.new_values}
                                    </>
                                  )}
                                </div>
                              </AccordionPanel>
                            </AccordionItem>
                          </Accordion>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
            {hasMore && (
              <div className={styles.loadMore} style={{ padding: tokens.spacingHorizontalL }}>
                <Button
                  appearance="secondary"
                  onClick={() => loadLogs(true)}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading...' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
};

export default AuditLogs;
