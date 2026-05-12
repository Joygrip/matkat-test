/**
 * Finance Page — Shell
 *
 * Orchestrates shared state and data loading for all Finance tabs.
 * Tabs: Overview, Cost Overview, OoP + Equipment.
 * Snapshots, Cost Report, and Period Management have moved to Admin.
 * Accessible to: Admin, Finance, Director
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Spinner,
  makeStyles,
  Select,
  MessageBar,
  MessageBarBody,
  Tab,
  TabList,
  tokens,
} from '@fluentui/react-components';
import {
  consolidationApi,
  Snapshot,
} from '../api/consolidation';
import { usePeriod } from '../contexts/PeriodContext';
import { lookupsApi } from '../api/lookups';
import { PeriodSelector } from '../components/PeriodSelector';
import { useToast } from '../hooks/useToast';
import { useAuth, useHasRole } from '../auth/AuthProvider';

// Tab components
import { FinanceOverview } from '../components/shared/FinanceOverview';
import { ConsolidatedCostChart } from '../components/finance/ConsolidatedCostChart';
import { ProjectCostsMatrix } from '../components/project-costs/ProjectCostsMatrix';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LookupProject { id: string; name: string; }

type ActiveTab = 'overview' | 'costoverview' | 'projectcosts';

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
  toolbarFilters: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: tokens.spacingHorizontalL,
    flexWrap: 'wrap' as const,
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: tokens.spacingVerticalXXS,
    minWidth: '140px',
  },
  filterLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
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
  const canSeeStats = useHasRole('Finance', 'Manager', 'Admin');
  const canSeeSnapshots = useHasRole('Finance', 'Admin');
  const canSeeProjectCosts = useHasRole('Finance', 'Admin', 'PM');
  const isPM = user?.role === 'PM';

  // ── Period ──
  const {
    periods,
    selectedPeriodId,
    setSelectedPeriodId,
    loading: periodsLoading,
  } = usePeriod();

  // ── Tab ──
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');

  // ── Snapshots (loaded only to display "Last snapshot" info) ──
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  // ── Overview filters ──
  const [overviewProjectId, setOverviewProjectId] = useState<string>('');

  // ── Lookups ──
  const [projects, setProjects] = useState<LookupProject[]>([]);

  const latestSnapshot = useMemo(() =>
    snapshots.length > 0
      ? [...snapshots].sort((a, b) =>
          new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
        )[0]
      : null,
    [snapshots]
  );

  // ── Initial loads ──
  useEffect(() => {
    const fetch = isPM ? lookupsApi.listProjectsScoped() : lookupsApi.listProjects();
    fetch.then(setProjects);
  }, [isPM]);

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
            <Tab value="overview">Overview</Tab>
            {(canSeeStats || isPM) && <Tab value="costoverview">Cost Overview</Tab>}
            {canSeeProjectCosts && <Tab value="projectcosts">OoP + Equipment</Tab>}
          </TabList>
          <span className={styles.toolbarMeta}>
            {latestSnapshot
              ? `Last snapshot: ${new Date(latestSnapshot.published_at).toLocaleDateString()}`
              : 'No snapshots yet'}
          </span>
        </div>

        <div className={styles.toolbarFilters}>
          {/* Period — always visible */}
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Period</span>
            <PeriodSelector
              periods={periods}
              selectedId={selectedPeriodId}
              onSelect={setSelectedPeriodId}
            />
          </div>

          {/* Overview-only filters */}
          {activeTab === 'overview' && (
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>Project</span>
              <Select
                value={overviewProjectId}
                onChange={(_, data) => setOverviewProjectId(data.value ?? '')}
                style={{ minWidth: 140 }}
              >
                <option value="">All projects</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* ── Tab content ── */}

      {activeTab === 'overview' && (
        <>
          <MessageBar intent="info" style={{ marginBottom: 12 }}>
            <MessageBarBody>Cost figures reflect fully approved actuals only. Pending or rejected actuals are excluded.</MessageBarBody>
          </MessageBar>
          <FinanceOverview
            scope={isPM ? 'pm' : user?.role === 'Manager' ? 'manager' : user?.role === 'Finance' ? 'finance' : user?.role === 'Admin' ? 'admin' : 'reader'}
            projectId={overviewProjectId}
          />
        </>
      )}
      {activeTab === 'projectcosts' && canSeeProjectCosts && (
        <ProjectCostsMatrix />
      )}
      {activeTab === 'costoverview' && (canSeeStats || isPM) && (
        <>
          <MessageBar intent="info" style={{ marginBottom: 12 }}>
            <MessageBarBody>Cost figures reflect fully approved actuals only. Pending or rejected actuals are excluded.</MessageBarBody>
          </MessageBar>
          <ConsolidatedCostChart latestSnapshot={latestSnapshot} />
        </>
      )}
    </div>
  );
};

export default Finance;
