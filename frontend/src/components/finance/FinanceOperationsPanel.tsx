import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  makeStyles,
  mergeClasses,
  tokens,
  Title3,
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
  Badge,
} from '@fluentui/react-components';
import { CalendarMonthRegular, CameraRegular, MoneyRegular } from '@fluentui/react-icons';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../hooks/useToast';
import { usePeriod } from '../../contexts/PeriodContext';
import { consolidationApi, Snapshot } from '../../api/consolidation';
import { MONTH_NAMES } from '../../utils/format';
import { PeriodPanel } from '../PeriodPanel';
import { SnapshotsTab } from './SnapshotsTab';
import { CostReportTab } from './CostReportTab';

export type FinanceSubTab = 'period-control' | 'snapshot-publishing' | 'cost-settings-export';

export interface FinanceOperationsPanelProps {
  initialSubTab?: FinanceSubTab;
}

const useStyles = makeStyles({
  // Cockpit page header
  pageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalL,
    flexWrap: 'wrap',
  },
  pageHeaderLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
  },
  pageSubtitle: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  pageHeaderRight: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    paddingTop: tokens.spacingVerticalXS,
  },
  periodName: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  // Operation selection cards
  opCardsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalM,
  },
  opCard: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    minHeight: '110px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    color: 'inherit',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
    ':focus-visible': {
      outlineOffset: '2px',
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: tokens.colorBrandBackground,
    },
  },
  opCardActive: {
    boxShadow: `0 0 0 2px ${tokens.colorBrandBackground}`,
  },
  opCardIcon: {
    fontSize: '22px',
    lineHeight: '1',
    display: 'flex',
    color: tokens.colorNeutralForeground2,
    marginBottom: tokens.spacingVerticalXXS,
  },
  opCardIconActive: {
    color: tokens.colorBrandBackground,
  },
  opCardTitle: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  opCardDescription: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  opCardMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    marginTop: 'auto',
    paddingTop: tokens.spacingVerticalXS,
  },
  divider: {
    height: '1px',
    backgroundColor: tokens.colorNeutralStroke2,
    marginTop: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalL,
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

  const periodLabel = currentPeriod
    ? `${MONTH_NAMES[currentPeriod.month - 1]} ${currentPeriod.year}`
    : '—';

  // Operation card definitions — icons, titles, descriptions, live meta
  const operationCards = [
    {
      key: 'period-control' as FinanceSubTab,
      icon: <CalendarMonthRegular />,
      title: 'Period Control',
      description: 'Lock, unlock, and create finance periods.',
      meta: currentPeriod ? (
        <>
          <span>{periodLabel}</span>
          <Badge
            appearance="filled"
            color={currentPeriod.status === 'open' ? 'success' : 'danger'}
            shape="rounded"
            size="small"
          >
            {currentPeriod.status === 'open' ? 'Open' : 'Locked'}
          </Badge>
        </>
      ) : <span>No active period</span>,
    },
    {
      key: 'snapshot-publishing' as FinanceSubTab,
      icon: <CameraRegular />,
      title: 'Snapshot Publishing',
      description: 'Freeze reporting data for the selected period.',
      meta: latestSnapshot
        ? `Last: ${new Date(latestSnapshot.published_at).toLocaleDateString()}`
        : 'No snapshots yet',
    },
    {
      key: 'cost-settings-export' as FinanceSubTab,
      icon: <MoneyRegular />,
      title: 'Cost Settings & Export',
      description: 'Maintain FTE cost and export reporting data.',
      meta: 'Reporting settings',
    },
  ];

  const renderContent = () => {
    if (subTab === 'period-control') {
      return <PeriodPanel variant="embedded" />;
    }
    if (subTab === 'snapshot-publishing') {
      return (
        <SnapshotsTab
          snapshots={snapshots}
          canDownloadCsv={canManageFinanceData}
          showApiError={showApiError}
          periods={periods}
          selectedPeriodId={selectedPeriodId}
          onSelectPeriod={setSelectedPeriodId}
          onPublishClick={() => setIsPublishDialogOpen(true)}
        />
      );
    }
    if (subTab === 'cost-settings-export') {
      return (
        <CostReportTab
          selectedPeriodId={selectedPeriodId}
          currentPeriod={currentPeriod ?? null}
          showSuccess={showSuccess}
          showError={showError}
          showApiError={showApiError}
        />
      );
    }
    return null;
  };

  return (
    <>
      {/* Cockpit page header — title/subtitle left, current period right */}
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderLeft}>
          <Title3>Finance Operations</Title3>
          <span className={styles.pageSubtitle}>
            Manage monthly period status, publish snapshots, and maintain cost reporting settings.
          </span>
        </div>
        <div className={styles.pageHeaderRight}>
          <span className={styles.periodName}>{periodLabel}</span>
          {currentPeriod && (
            <Badge
              appearance="filled"
              color={currentPeriod.status === 'open' ? 'success' : 'danger'}
              shape="rounded"
            >
              {currentPeriod.status === 'open' ? 'Open' : 'Locked'}
            </Badge>
          )}
        </div>
      </div>

      {/* Operation selection cards — replace the old internal TabList */}
      <div className={styles.opCardsGrid}>
        {operationCards.map(card => (
          <button
            key={card.key}
            type="button"
            className={mergeClasses(styles.opCard, subTab === card.key && styles.opCardActive)}
            onClick={() => setSubTab(card.key)}
          >
            <div className={mergeClasses(styles.opCardIcon, subTab === card.key && styles.opCardIconActive)}>
              {card.icon}
            </div>
            <div className={styles.opCardTitle}>{card.title}</div>
            <div className={styles.opCardDescription}>{card.description}</div>
            <div className={styles.opCardMeta}>{card.meta}</div>
          </button>
        ))}
      </div>

      <div className={styles.divider} />

      {/* Selected section content */}
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
