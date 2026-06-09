/**
 * Finance Page — Shell
 *
 * Orchestrates shared state and data loading for all Finance tabs.
 * Tabs: Cost Overview, OoP + Equipment.
 * Snapshots, Cost Report, and Period Management have moved to Admin.
 * Accessible to: Admin, Finance, Director
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Spinner,
  makeStyles,
  Tab,
  TabList,
  tokens,
} from '@fluentui/react-components';
import {
  consolidationApi,
  Snapshot,
} from '../api/consolidation';
import { usePeriod } from '../contexts/PeriodContext';
import { useToast } from '../hooks/useToast';
import { useAuth, useHasRole, useCanPM } from '../auth/AuthProvider';

// Tab components
import { ConsolidatedCostChart } from '../components/finance/ConsolidatedCostChart';
import { ProjectCostsMatrix } from '../components/project-costs/ProjectCostsMatrix';

// ─── Types ───────────────────────────────────────────────────────────────────

type ActiveTab = 'costoverview' | 'projectcosts';

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  container: {
    padding: tokens.spacingHorizontalXXL,
    maxWidth: '1600px',
    margin: '0 auto',
    minHeight: 'calc(100vh - 80px)',
  },
  toolbar: {
    backgroundColor: tokens.colorNeutralBackground1,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    marginBottom: tokens.spacingVerticalL,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: tokens.spacingVerticalS,
  },
  toolbarRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    flexWrap: 'wrap' as const,
  },
  toolbarMeta: {
    marginLeft: 'auto',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    padding: tokens.spacingVerticalXXL,
  },
});

// ─── Main component ──────────────────────────────────────────────────────────

export const Finance: React.FC = () => {
  const styles = useStyles();
  const { showApiError } = useToast();
  const { user } = useAuth();
  const canPM = useCanPM();
  const canSeeStats = useHasRole('Finance', 'Manager', 'Admin');
  const canSeeSnapshots = useHasRole('Finance', 'Admin');
  const canSeeProjectCosts = useHasRole('Finance', 'Admin', 'PM') || canPM;
  const isPM = user?.role === 'PM' || canPM;

  // ── Period ──
  const {
    selectedPeriodId,
    loading: periodsLoading,
  } = usePeriod();

  // ── Tab ──
  const [activeTab, setActiveTab] = useState<ActiveTab>('costoverview');

  // ── Snapshots (loaded only to display "Last snapshot" info) ──
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  const latestSnapshot = useMemo(() =>
    snapshots.length > 0
      ? [...snapshots].sort((a, b) =>
          new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
        )[0]
      : null,
    [snapshots]
  );

  // ── Reload when period changes ──
  useEffect(() => {
    if (selectedPeriodId && canSeeSnapshots) loadSnapshots(selectedPeriodId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodId]);

  // ── Data loaders ──

  const loadSnapshots = async (periodId?: string) => {
    const pid = periodId || selectedPeriodId;
    try {
      const data = await consolidationApi.getSnapshots(pid);
      setSnapshots(data);
    } catch (err) {
      showApiError(err as Error, 'Failed to load snapshots');
    }
  };

  // ── Loading state ──
  if (periodsLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="large" label="Loading..." />
      </div>
    );
  }

  return (
    <div className={styles.container}>

      {/* ── Sticky toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarRow}>
          <TabList
            selectedValue={activeTab}
            onTabSelect={(_, data) => setActiveTab(data.value as ActiveTab)}
          >
            {(canSeeStats || isPM) && <Tab value="costoverview">Cost Overview</Tab>}
            {canSeeProjectCosts && <Tab value="projectcosts">OoP + Equipment</Tab>}
          </TabList>

        </div>
      </div>

      {/* ── Tab content ── */}

      {activeTab === 'projectcosts' && canSeeProjectCosts && (
        <ProjectCostsMatrix />
      )}
      {activeTab === 'costoverview' && (canSeeStats || isPM) && (
        <>
          <ConsolidatedCostChart latestSnapshot={latestSnapshot} />
        </>
      )}
    </div>
  );
};

export default Finance;
