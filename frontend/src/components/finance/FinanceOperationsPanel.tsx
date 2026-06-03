import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  makeStyles,
  tokens,
  TabList,
  Tab,
  SelectTabEventHandler,
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
  Body1,
  Body2,
} from '@fluentui/react-components';
import { CalendarMonthRegular, CameraRegular, MoneyRegular } from '@fluentui/react-icons';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../hooks/useToast';
import { usePeriod } from '../../contexts/PeriodContext';
import { consolidationApi, Snapshot } from '../../api/consolidation';
import { PeriodPanel } from '../PeriodPanel';
import { PeriodSelector } from '../PeriodSelector';
import { SnapshotsTab } from './SnapshotsTab';
import { CostReportTab } from './CostReportTab';

export type FinanceSubTab = 'period-control' | 'snapshot-publishing' | 'cost-settings-export';

export interface FinanceOperationsPanelProps {
  initialSubTab?: FinanceSubTab;
}

const useStyles = makeStyles({
  subtitle: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    margin: `0 0 ${tokens.spacingVerticalM} 0`,
  },
  subnavWrapper: {
    overflowX: 'auto',
    overflowY: 'hidden',
    whiteSpace: 'nowrap',
    scrollbarWidth: 'thin',
    marginBottom: tokens.spacingVerticalL,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    '& [role="tab"]': {
      flexShrink: 0,
    },
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

  const [subTab, setSubTab] = useState<FinanceSubTab>(initialSubTab);

  // Snapshots state (previously owned by Admin.tsx)
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

  // Reload snapshots when period changes while on snapshot-publishing subtab
  useEffect(() => {
    if (selectedPeriodId && subTab === 'snapshot-publishing') loadSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodId]);

  // Load snapshots when switching to snapshot-publishing subtab
  useEffect(() => {
    if (subTab === 'snapshot-publishing' && selectedPeriodId) loadSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  const handleSubTabSelect: SelectTabEventHandler = (_, data) => {
    setSubTab(data.value as FinanceSubTab);
  };

  const renderContent = () => {
    if (subTab === 'period-control') {
      return <PeriodPanel variant="embedded" />;
    }

    if (subTab === 'snapshot-publishing') {
      return (
        <>
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

    if (subTab === 'cost-settings-export') {
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
            currentPeriod={currentPeriod ?? null}
            showSuccess={showSuccess}
            showError={showError}
            showApiError={showApiError}
          />
        </>
      );
    }

    return null;
  };

  return (
    <>
      <p className={styles.subtitle}>
        Manage monthly period status, publish snapshots, and maintain cost reporting settings.
      </p>
      <div className={styles.subnavWrapper}>
        <TabList selectedValue={subTab} onTabSelect={handleSubTabSelect} appearance="subtle">
          <Tab value="period-control" icon={<CalendarMonthRegular />}>Period Control</Tab>
          <Tab value="snapshot-publishing" icon={<CameraRegular />}>Snapshot Publishing</Tab>
          <Tab value="cost-settings-export" icon={<MoneyRegular />}>Cost Settings &amp; Export</Tab>
        </TabList>
      </div>
      {renderContent()}

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
