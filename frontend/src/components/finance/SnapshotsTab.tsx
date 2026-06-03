import { useState, useMemo } from 'react';
import {
  makeStyles,
  tokens,
  Body1,
  Body2,
  Button,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
} from '@fluentui/react-components';
import { consolidationApi, Snapshot, SnapshotDetail } from '../../api/consolidation';

export interface SnapshotsTabProps {
  snapshots: Snapshot[];
  canDownloadCsv: boolean;
  showApiError: (err: Error, ctx?: string) => void;
  selectedPeriodLabel: string;
  selectedPeriodStatus: 'open' | 'locked' | 'unknown';
  onPublishClick: () => void;
}

const useStyles = makeStyles({
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  actionsRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  contextRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
  },
  periodContext: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    minWidth: '220px',
  },
  periodLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  periodValue: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  periodStatusOpen: {
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  periodStatusLocked: {
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightSemibold,
  },
  lastSnapshot: {
    marginLeft: 'auto',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    alignSelf: 'center',
  },
  tableWrap: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    overflowX: 'auto',
    overflowY: 'hidden',
    width: '100%',
  },
  table: { width: '100%' },
  sortableTable: {
    width: '100%',
    minWidth: '680px',
    '& thead': {
      backgroundColor: tokens.colorNeutralBackground2,
    },
    '& th': {
      fontWeight: tokens.fontWeightSemibold,
      fontSize: tokens.fontSizeBase200,
      color: tokens.colorNeutralForeground2,
      padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    '& td': {
      padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    '& tbody tr:last-child td': {
      borderBottom: 'none',
    },
    '& tbody tr:hover': { backgroundColor: tokens.colorNeutralBackground2 },
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalL}`,
    gap: tokens.spacingVerticalS,
    textAlign: 'center' as const,
    color: tokens.colorNeutralForeground3,
  },
  actionCell: {
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
    alignItems: 'center',
    whiteSpace: 'nowrap',
  },
});

export function SnapshotsTab({
  snapshots,
  canDownloadCsv,
  showApiError,
  selectedPeriodLabel,
  selectedPeriodStatus,
  onPublishClick,
}: SnapshotsTabProps) {
  const styles = useStyles();
  const [viewedSnapshot, setViewedSnapshot] = useState<SnapshotDetail | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const latestSnapshot = useMemo(() =>
    snapshots.length > 0
      ? [...snapshots].sort((a, b) =>
          new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
        )[0]
      : null,
    [snapshots]
  );

  const handleView = async (id: string) => {
    try {
      const detail = await consolidationApi.getSnapshot(id);
      setViewedSnapshot(detail);
    } catch (err) {
      showApiError(err as Error, 'Failed to load snapshot');
    }
  };

  const handleDownload = async (id: string) => {
    setDownloadingId(id);
    try {
      await consolidationApi.downloadSnapshotCsv(id);
    } catch (err) {
      showApiError(err as Error, 'Failed to download snapshot');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className={styles.wrapper}>

      <div className={styles.actionsRow}>
        <Button appearance="primary" size="small" onClick={onPublishClick}>
          Publish Snapshot
        </Button>
      </div>

      <div className={styles.contextRow}>
        <div className={styles.periodContext}>
          <span className={styles.periodLabel}>Snapshots for</span>
          <span className={styles.periodValue}>
            <span>{selectedPeriodLabel}</span>
            <span className={selectedPeriodStatus === 'open' ? styles.periodStatusOpen : styles.periodStatusLocked}>
              {selectedPeriodStatus === 'open' ? 'Open' : selectedPeriodStatus === 'locked' ? 'Locked' : ''}
            </span>
          </span>
        </div>
        <span className={styles.lastSnapshot}>
          {latestSnapshot
            ? `Last snapshot: ${new Date(latestSnapshot.published_at).toLocaleDateString()}`
            : 'No snapshots for selected period'}
        </span>
      </div>

      <div className={styles.tableWrap}>
        {snapshots.length > 0 ? (
          <Table className={styles.sortableTable}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Published At</TableHeaderCell>
                <TableHeaderCell>Published By</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Lines</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshots.map(snapshot => (
                <TableRow key={snapshot.id}>
                  <TableCell>{new Date(snapshot.published_at).toLocaleString()}</TableCell>
                  <TableCell>{snapshot.published_by}</TableCell>
                  <TableCell><strong>{snapshot.name}</strong></TableCell>
                  <TableCell>{snapshot.lines_count}</TableCell>
                  <TableCell>
                    <div className={styles.actionCell}>
                      <Button size="small" appearance="subtle" onClick={() => handleView(snapshot.id)}>
                        View
                      </Button>
                      {canDownloadCsv && (
                        <Button
                          size="small"
                          appearance="subtle"
                          disabled={downloadingId === snapshot.id}
                          onClick={() => handleDownload(snapshot.id)}
                        >
                          {downloadingId === snapshot.id ? 'Downloading…' : 'Download CSV'}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className={styles.emptyState}>
            <Body1>No snapshots published for {selectedPeriodLabel}.</Body1>
            <Body2>
              Publish a snapshot to freeze reporting values for this period.
            </Body2>
          </div>
        )}
      </div>

      {/* Detail dialog — unchanged */}
      <Dialog open={!!viewedSnapshot} onOpenChange={(_, d) => !d.open && setViewedSnapshot(null)}>
        <DialogSurface style={{ maxWidth: 720 }}>
          <DialogBody>
            <DialogTitle>{viewedSnapshot?.name ?? 'Snapshot'}</DialogTitle>
            <DialogContent>
              {viewedSnapshot && (
                <>
                  <Body2 style={{ marginBottom: tokens.spacingVerticalM, color: tokens.colorNeutralForeground3 }}>
                    {viewedSnapshot.description || 'No description'} · {viewedSnapshot.lines_count} lines · {new Date(viewedSnapshot.published_at).toLocaleString()}
                  </Body2>
                  <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                    <Table className={styles.table}>
                      <TableHeader>
                        <TableRow>
                          <TableHeaderCell>Type</TableHeaderCell>
                          <TableHeaderCell>Project</TableHeaderCell>
                          <TableHeaderCell>Resource</TableHeaderCell>
                          <TableHeaderCell>Period</TableHeaderCell>
                          <TableHeaderCell>FTE %</TableHeaderCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {viewedSnapshot.lines.slice(0, 100).map((line, i) => (
                          <TableRow key={i}>
                            <TableCell>{line.line_type}</TableCell>
                            <TableCell>{line.project_name || '—'}</TableCell>
                            <TableCell>{line.resource_name || line.placeholder_name || '—'}</TableCell>
                            <TableCell>{line.year}-{String(line.month).padStart(2, '0')}</TableCell>
                            <TableCell>{line.fte_percent ?? '—'}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {viewedSnapshot.lines.length > 100 && (
                      <Body2 style={{ marginTop: tokens.spacingVerticalS, color: tokens.colorNeutralForeground3 }}>
                        Showing first 100 of {viewedSnapshot.lines.length} lines.
                      </Body2>
                    )}
                  </div>
                </>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setViewedSnapshot(null)}>Close</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

    </div>
  );
}
