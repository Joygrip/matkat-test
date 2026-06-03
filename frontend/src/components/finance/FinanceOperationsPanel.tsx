import { useState, useEffect, useCallback } from 'react';
import {
  makeStyles,
  tokens,
  Title3,
  Badge,
  Divider,
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
import { MONTH_NAMES } from '../../utils/format';

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
    gap: tokens.spacingVerticalM,
  },
  contextStrip: {
    minHeight: '52px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalL,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    flexWrap: 'wrap',
  },
  stripGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
    minWidth: 0,
  },
  stripLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    fontWeight: tokens.fontWeightSemibold,
  },
  stripValue: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  stripStatusOpen: {
    color: tokens.colorBrandForeground1,
  },
  stripStatusLocked: {
    color: tokens.colorNeutralForeground3,
  },
  stripDivider: {
    height: '24px',
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
    borderRadius: tokens.borderRadiusSmall,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    minWidth: 0,
  },
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: '3fr 2fr',
    gap: tokens.spacingHorizontalXXL,
    alignItems: 'start',
    marginTop: tokens.spacingVerticalM,
    '@media (max-width: 1100px)': {
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

  const selectedPeriodLabel = currentPeriod
    ? `${MONTH_NAMES[currentPeriod.month - 1]} ${currentPeriod.year}`
    : 'No period selected';

  const selectedPeriodStatus = currentPeriod?.status ?? 'unknown';

  return (
    <>
      <div className={styles.root}>
        <div className={styles.pageHeader}>
          <Title3>Finance Operations</Title3>
          <span className={styles.pageSubtitle}>Manage monthly periods, FTE cost rates, and reporting snapshots.</span>
        </div>

        <div className={styles.contentStack}>
          <div className={styles.contextStrip}>
            <div className={styles.stripGroup}>
              <span className={styles.stripLabel}>Working period</span>
              <span className={styles.stripValue}>
                {selectedPeriodLabel}
                {selectedPeriodStatus !== 'unknown' && (
                  <Badge appearance={selectedPeriodStatus === 'open' ? 'filled' : 'tint'} color="informative" size="small">
                    <span className={selectedPeriodStatus === 'open' ? styles.stripStatusOpen : styles.stripStatusLocked}>
                      {selectedPeriodStatus === 'open' ? 'Open' : 'Locked'}
                    </span>
                  </Badge>
                )}
              </span>
            </div>

            <Divider vertical className={styles.stripDivider} />

            <div className={styles.stripGroup}>
              <span className={styles.stripLabel}>Cost settings</span>
              <CostReportTab
                selectedPeriodId={selectedPeriodId}
                showSuccess={showSuccess}
                showError={showError}
                showApiError={showApiError}
              />
            </div>
          </div>

          <div className={styles.mainGrid}>
            <section className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <Body2 className={styles.sectionTitle}>Periods</Body2>
                <Body2 className={styles.sectionSubtitle}>Select a month row to set the working period.</Body2>
              </div>
              <PeriodPanel
                variant="compact"
                selectedWorkingPeriodId={selectedPeriodId}
                onSelectWorkingPeriod={setSelectedPeriodId}
              />
            </section>

            <section className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <Body2 className={styles.sectionTitle}>Snapshots</Body2>
                <Body2 className={styles.sectionSubtitle}>Publish immutable snapshots and review history.</Body2>
              </div>
              <SnapshotsTab
                snapshots={snapshots}
                canDownloadCsv={canManageFinanceData}
                showApiError={showApiError}
                selectedPeriodLabel={selectedPeriodLabel}
                selectedPeriodStatus={selectedPeriodStatus}
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
