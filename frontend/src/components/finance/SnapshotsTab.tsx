import { useState, useMemo } from 'react';
import {
  makeStyles,
  tokens,
  Body1,
  Body2,
  Badge,
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
  onPublishClick: () => void;
}

const useStyles = makeStyles({
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
  },
  periodInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
  },
  periodLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  periodValue: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground1,
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
  },
  table: { width: '100%' },
  sortableTable: {
    width: '100%',
    minWidth: '760px',
    '& thead': {
      backgroundColor: tokens.colorNeutralBackground2,
    },
    '& th': {
      fontWeight: tokens.fontWeightSemibold,
      fontSize: tokens.fontSizeBase200,
      color: tokens.colorNeutralForeground2,
      padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    '& td': {
      padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
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
  },
});

export function SnapshotsTab({
  snapshots,
  canDownloadCsv,
  showApiError,
  selectedPeriodLabel,
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

      <div className={styles.toolbar}>
        <div className={styles.periodInfo}>
          <span className={styles.periodLabel}>Period</span>
          <span className={styles.periodValue}>
            <Badge appearance="filled" color="informative" size="small">Snapshots</Badge>
            {selectedPeriodLabel}
          </span>
        </div>
        <Button appearance="primary" onClick={onPublishClick}>
          Publish Snapshot
        </Button>
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
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Description</TableHeaderCell>
                <TableHeaderCell>Lines</TableHeaderCell>
                <TableHeaderCell>Published At</TableHeaderCell>
                <TableHeaderCell>Published By</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshots.map(snapshot => (
                <TableRow key={snapshot.id}>
                  <TableCell><strong>{snapshot.name}</strong></TableCell>
                  <TableCell>{snapshot.description || '—'}</TableCell>
                  <TableCell>{snapshot.lines_count}</TableCell>
                  <TableCell>{new Date(snapshot.published_at).toLocaleString()}</TableCell>
                  <TableCell>{snapshot.published_by}</TableCell>
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
