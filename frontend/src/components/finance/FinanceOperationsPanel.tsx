import { useState, useEffect, useCallback } from 'react';
import {
  makeStyles,
  tokens,
  Title3,
  Body1,
  Body2,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Input,
  Textarea,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../hooks/useToast';
import { usePeriod } from '../../contexts/PeriodContext';
import { consolidationApi, Snapshot } from '../../api/consolidation';
import { PeriodPanel } from '../PeriodPanel';
import { SnapshotsTab } from './SnapshotsTab';
import { CostReportTab } from './CostReportTab';

export type FinanceSubTab = 'period-control' | 'snapshot-publishing' | 'cost-settings-export';

export interface FinanceOperationsPanelProps {
  initialSubTab?: FinanceSubTab;
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  contentStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  pageHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
  },
  pageSubtitle: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  sectionCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    minWidth: 0,
  },
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(520px, 0.95fr) minmax(520px, 1.05fr)',
    gap: tokens.spacingHorizontalL,
    alignItems: 'start',
    '@media (max-width: 1240px)': {
      gridTemplateColumns: '1fr',
    },
  },
  sectionHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
  },
  sectionTitle: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  sectionSubtitle: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

export function FinanceOperationsPanel({ initialSubTab = 'period-control' }: FinanceOperationsPanelProps) {
  const styles = useStyles();
  const { user } = useAuth();
  const { showSuccess, showError, showApiError } = useToast();
  const {
    periods,
    selectedPeriodId,
    setSelectedPeriodId,
    selectedPeriod: currentPeriod,
  } = usePeriod();

  const canManageFinanceData = user?.role === 'Admin' || user?.role === 'Finance';

  void initialSubTab;

  // Snapshots state (previously owned by Admin.tsx)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  const [publishName, setPublishName] = useState('');
  const [publishDescription, setPublishDescription] = useState('');

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

  // Reload snapshots when period changes
  useEffect(() => {
    if (selectedPeriodId) loadSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodId]);

  return (
    <>
      <div className={styles.root}>
        <div className={styles.pageHeader}>
          <Title3>Finance Operations</Title3>
          <span className={styles.pageSubtitle}>Monthly finance close and reporting controls.</span>
        </div>

        <div className={styles.contentStack}>
          <section className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <Body1 className={styles.sectionTitle}>Cost Settings</Body1>
              <Body2 className={styles.sectionSubtitle}>Maintain monthly FTE cost settings.</Body2>
            </div>
            <CostReportTab
              periods={periods}
              selectedPeriodId={selectedPeriodId}
              onSelectPeriod={setSelectedPeriodId}
              showSuccess={showSuccess}
              showError={showError}
              showApiError={showApiError}
            />
          </section>

          <div className={styles.mainGrid}>
          <section className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <Body1 className={styles.sectionTitle}>Periods</Body1>
              <Body2 className={styles.sectionSubtitle}>Create, lock, and unlock monthly periods.</Body2>
            </div>
            <PeriodPanel variant="compact" />
          </section>

          <section className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <Body1 className={styles.sectionTitle}>Snapshot Publishing</Body1>
              <Body2 className={styles.sectionSubtitle}>Publish immutable snapshots and review snapshot history.</Body2>
            </div>
            <SnapshotsTab
              snapshots={snapshots}
              canDownloadCsv={canManageFinanceData}
              showApiError={showApiError}
              periods={periods}
              selectedPeriodId={selectedPeriodId}
              onSelectPeriod={setSelectedPeriodId}
              onPublishClick={() => setIsPublishDialogOpen(true)}
            />
          </section>
          </div>
        </div>
      </div>

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
    </>
  );
}
