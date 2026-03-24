/**
 * Project Costs Page — non-internal costs (externals and OoP equipment) per project/period.
 * Accessible to: Admin, Finance, PM, Director, RO
 * PM: sees and edits only own projects.
 * Finance/Admin: sees all, can edit.
 * Director/RO: read-only.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  makeStyles,
  tokens,
  Title3,
  Tab,
  TabList,
  Select,
  Label,
  Spinner,
} from '@fluentui/react-components';
import { usePeriod } from '../contexts/PeriodContext';
import { lookupsApi } from '../api/lookups';
import { projectCostsApi, ProjectCostSummary } from '../api/projectCosts';
import { useToast } from '../hooks/useToast';
import { FinanceKpiStrip } from '../components/finance/FinanceKpiStrip';
import { ExternalsPanel } from '../components/project-costs/ExternalsPanel';
import { EquipmentPanel } from '../components/project-costs/EquipmentPanel';
import type { Project } from '../api/lookups';

type ActiveTab = 'externals' | 'equipment';

const formatDKK = (cents: number) =>
  new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 }).format(
    cents / 100,
  );

const useStyles = makeStyles({
  container: {
    padding: tokens.spacingHorizontalXXL,
    maxWidth: '1400px',
    margin: '0 auto',
    minHeight: 'calc(100vh - 80px)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.spacingVerticalL,
    paddingBottom: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  filterBar: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalL,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    flexWrap: 'wrap' as const,
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: tokens.spacingVerticalXXS,
    minWidth: '200px',
  },
  filterLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  tabs: {
    marginBottom: tokens.spacingVerticalL,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  tabContent: {
    paddingTop: tokens.spacingVerticalM,
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    padding: tokens.spacingVerticalXXL,
  },
});

export const ProjectCosts: React.FC = () => {
  const styles = useStyles();
  const { showApiError } = useToast();
  const { selectedPeriodId } = usePeriod();

  const [activeTab, setActiveTab] = useState<ActiveTab>('externals');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [summary, setSummary] = useState<ProjectCostSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    lookupsApi.listProjects().then(setProjects).catch(() => {});
  }, []);

  const loadSummary = useCallback(async () => {
    if (!selectedPeriodId) return;
    setSummaryLoading(true);
    try {
      const data = await projectCostsApi.getSummary({
        period_id: selectedPeriodId,
        project_id: selectedProjectId || undefined,
      });
      setSummary(data);
    } catch (err) {
      showApiError(err as Error, 'loading cost summary');
    } finally {
      setSummaryLoading(false);
    }
  }, [selectedPeriodId, selectedProjectId, showApiError]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const kpiTiles = [
    {
      label: 'Externals Total',
      value: summary ? formatDKK(summary.externals_total) : '—',
    },
    {
      label: 'Equipment Total',
      value: summary ? formatDKK(summary.equipment_total) : '—',
    },
    {
      label: 'Combined Total',
      value: summary ? formatDKK(summary.combined_total) : '—',
      color: 'default' as const,
    },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Title3>Project Costs</Title3>
      </div>

      <div className={styles.filterBar}>
        <div className={styles.filterGroup}>
          <Label className={styles.filterLabel}>Project</Label>
          <Select
            value={selectedProjectId}
            onChange={(_, d) => setSelectedProjectId(d.value)}
          >
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </div>
      </div>

      <FinanceKpiStrip tiles={kpiTiles} loading={summaryLoading} />

      <div className={styles.tabs}>
        <TabList
          selectedValue={activeTab}
          onTabSelect={(_, d) => setActiveTab(d.value as ActiveTab)}
        >
          <Tab value="externals">Externals</Tab>
          <Tab value="equipment">OoP Equipment</Tab>
        </TabList>
      </div>

      <div className={styles.tabContent}>
        {activeTab === 'externals' && (
          <ExternalsPanel
            periodId={selectedPeriodId}
            projectId={selectedProjectId}
            projects={projects}
          />
        )}
        {activeTab === 'equipment' && (
          <EquipmentPanel
            periodId={selectedPeriodId}
            projectId={selectedProjectId}
            projects={projects}
          />
        )}
      </div>
    </div>
  );
};
