import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Title3,
  Body1,
  Button,
  Card,
  CardHeader,
  tokens,
  makeStyles,
} from '@fluentui/react-components';
import { planningApi, DemandLine, SupplyLine } from '../api/planning';
import { lookupsApi, Project, CostCenter } from '../api/lookups';
import { usePeriod } from '../contexts/PeriodContext';
import { useAuth } from '../auth/AuthProvider';
import { formatApiError } from '../utils/errors';
import { SearchableFilter } from '../components/SearchableFilter';
import { LoadingState } from '../components/LoadingState';
import { StatusBanner } from '../components/StatusBanner';
import { ResourcePlanningMatrix } from '../components/ResourcePlanningMatrix';
import { Period } from '../types/index';
import { periodsApi } from '../api/periods';

const useStyles = makeStyles({
  container: {
    padding: tokens.spacingHorizontalXXL,
    maxWidth: '1800px',
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
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalL,
  },
  kpiCard: {
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
  },
  kpiLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  kpiValue: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  filters: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    alignItems: 'flex-end',
    marginBottom: tokens.spacingVerticalL,
    flexWrap: 'wrap' as const,
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
  },
  filterLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  filtersChipsRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: tokens.spacingVerticalL,
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap' as const,
  },
  filtersChipsList: {
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
    flexWrap: 'wrap' as const,
  },
  matrixCard: {
    marginBottom: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    overflowX: 'auto',
  },
});

export const ResourcePlanning: React.FC = () => {
  const styles = useStyles();
  const { user } = useAuth();

  const canEditDemand = user?.role === 'PM' || user?.role === 'Finance' || user?.role === 'Admin';
  const canEditSupply = user?.role === 'Manager' || user?.role === 'Finance' || user?.role === 'Admin';
  const isManager = user?.role === 'Manager';

  const { periods: contextPeriods } = usePeriod();

  const [openPeriods, setOpenPeriods] = useState<Period[]>([]);
  const openPeriodsRef = useRef<Period[]>([]);
  const [demandLines, setDemandLines] = useState<DemandLine[]>([]);
  const [supplyLines, setSupplyLines] = useState<SupplyLine[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchResource, setSearchResource] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string>('');

  useEffect(() => {
    loadAll();
  }, []);

  // Keep ref in sync so reloadLines always has the latest periods without stale closure
  useEffect(() => { openPeriodsRef.current = openPeriods; }, [openPeriods]);

  // When contextPeriods loads, derive open periods if we haven't yet
  useEffect(() => {
    if (contextPeriods.length > 0 && openPeriods.length === 0) {
      const open = contextPeriods
        .filter(p => p.status === 'open')
        .sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));
      setOpenPeriods(open);
    }
  }, [contextPeriods]);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [periodsData, projectsData, costCentersData] = await Promise.all([
        periodsApi.list(),
        lookupsApi.listProjects(),
        lookupsApi.listCostCenters(),
      ]);

      const open = periodsData
        .filter((p: Period) => p.status === 'open')
        .sort((a: Period, b: Period) => (a.year * 12 + a.month) - (b.year * 12 + b.month));
      setOpenPeriods(open);
      setProjects(projectsData);
      setCostCenters(costCentersData);

      if (open.length === 0) {
        setDemandLines([]);
        setSupplyLines([]);
        return;
      }

      const periodIds = open.map((p: Period) => p.id);
      const [demandResults, supplyResults] = await Promise.all([
        Promise.all(periodIds.map((pid: string) => planningApi.getDemandLines(pid))),
        Promise.all(periodIds.map((pid: string) => planningApi.getSupplyLines(pid))),
      ]);

      setDemandLines(demandResults.flat());
      setSupplyLines(supplyResults.flat());
    } catch (err: unknown) {
      setError(formatApiError(err, 'Failed to load resource planning data'));
    } finally {
      setLoading(false);
    }
  };

  // Lightweight reload: only re-fetches lines, no loading spinner
  const reloadLines = useCallback(async () => {
    const periods = openPeriodsRef.current;
    if (periods.length === 0) return;
    try {
      const periodIds = periods.map(p => p.id);
      const [demandResults, supplyResults] = await Promise.all([
        Promise.all(periodIds.map(pid => planningApi.getDemandLines(pid))),
        Promise.all(periodIds.map(pid => planningApi.getSupplyLines(pid))),
      ]);
      setDemandLines(demandResults.flat());
      setSupplyLines(supplyResults.flat());
    } catch {
      // silent — the edited cell already reflects the change optimistically
    }
  }, []);

  // Manager scoping: derive manager's CC from loaded lines
  const managerCcId = useMemo(() => {
    if (!isManager) return null;
    const first = supplyLines[0] || demandLines[0];
    return first?.cost_center_id || null;
  }, [isManager, supplyLines, demandLines]);

  const filteredDemandLines = useMemo(() => {
    return demandLines.filter(d => {
      if (isManager && managerCcId && d.cost_center_id !== managerCcId) return false;
      if (selectedProjectId && d.project_id !== selectedProjectId) return false;
      if (selectedCostCenterId && d.cost_center_id !== selectedCostCenterId) return false;
      if (searchResource) {
        const name = (d.resource_name || d.placeholder_name || '').toLowerCase();
        if (!name.includes(searchResource.toLowerCase())) return false;
      }
      return true;
    });
  }, [demandLines, isManager, managerCcId, selectedProjectId, selectedCostCenterId, searchResource]);

  const filteredSupplyLines = useMemo(() => {
    return supplyLines.filter(s => {
      if (isManager && managerCcId && s.cost_center_id !== managerCcId) return false;
      if (selectedProjectId && s.project_id !== selectedProjectId) return false;
      if (selectedCostCenterId && s.cost_center_id !== selectedCostCenterId) return false;
      if (searchResource) {
        const name = (s.resource_name || '').toLowerCase();
        if (!name.includes(searchResource.toLowerCase())) return false;
      }
      return true;
    });
  }, [supplyLines, isManager, managerCcId, selectedProjectId, selectedCostCenterId, searchResource]);

  const totalDemand = useMemo(
    () => filteredDemandLines.reduce((sum, d) => sum + (d.fte_percent ?? 0), 0),
    [filteredDemandLines],
  );
  const totalSupply = useMemo(
    () => filteredSupplyLines.reduce((sum, s) => sum + (s.fte_percent ?? 0), 0),
    [filteredSupplyLines],
  );
  const balance = totalSupply - totalDemand;

  const activeProjectLabel = useMemo(() => {
    if (!selectedProjectId) return null;
    return `Project: ${projects.find(p => p.id === selectedProjectId)?.name || ''}`;
  }, [projects, selectedProjectId]);

  const activeCostCenterLabel = useMemo(() => {
    if (!selectedCostCenterId) return null;
    return `Cost center: ${costCenters.find(c => c.id === selectedCostCenterId)?.name || ''}`;
  }, [costCenters, selectedCostCenterId]);

  const hasActiveFilters = !!(searchResource || activeProjectLabel || activeCostCenterLabel);

  // Managers always see their own CC even if empty.
  // All other roles only see CCs that have at least one demand or supply line
  // (matching any active filters), so the matrix never shows empty rows.
  const visibleCostCenters = useMemo(() => {
    if (isManager && managerCcId) {
      return costCenters.filter(c => c.id === managerCcId);
    }
    const activeCcIds = new Set([
      ...filteredDemandLines.map(d => d.cost_center_id).filter(Boolean),
      ...filteredSupplyLines.map(s => s.cost_center_id).filter(Boolean),
    ]);
    return costCenters.filter(c => activeCcIds.has(c.id));
  }, [costCenters, filteredDemandLines, filteredSupplyLines, isManager, managerCcId]);

  if (loading) {
    return <LoadingState message="Loading resource planning data..." />;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Title3>Resource Planning</Title3>
      </div>

      {/* KPI strip */}
      <div className={styles.kpiRow}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Total Demand FTE%</span>
          <span className={styles.kpiValue}>{totalDemand}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Total Supply FTE%</span>
          <span className={styles.kpiValue}>{totalSupply}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Balance (Supply − Demand)</span>
          <span
            className={styles.kpiValue}
            style={{ color: balance >= 0 ? tokens.colorPaletteGreenForeground2 : tokens.colorPaletteRedForeground2 }}
          >
            {balance >= 0 ? '+' : ''}{balance}
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Resource</span>
          <input
            type="text"
            placeholder="Search resource name…"
            value={searchResource}
            onChange={e => setSearchResource(e.target.value)}
            style={{
              padding: '4px 8px',
              border: `1px solid ${tokens.colorNeutralStroke1}`,
              borderRadius: tokens.borderRadiusMedium,
              fontSize: tokens.fontSizeBase300,
              minWidth: 200,
            }}
          />
        </div>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Project</span>
          <SearchableFilter
            options={projects.map(p => ({ id: p.id, label: p.name }))}
            value={selectedProjectId || ''}
            onChange={id => setSelectedProjectId(id || null)}
            placeholder="Type to search projects…"
            allLabel="All projects"
          />
        </div>
        {!isManager && (
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Cost Center</span>
            <SearchableFilter
              options={costCenters.map(c => ({ id: c.id, label: c.name }))}
              value={selectedCostCenterId}
              onChange={setSelectedCostCenterId}
              placeholder="Type to search cost centers…"
              allLabel="All cost centers"
            />
          </div>
        )}
      </div>

      {hasActiveFilters && (
        <div className={styles.filtersChipsRow}>
          <div className={styles.filtersChipsList}>
            {searchResource && (
              <Button size="small" appearance="outline" onClick={() => setSearchResource('')}>
                Resource: {searchResource}
              </Button>
            )}
            {activeProjectLabel && (
              <Button size="small" appearance="outline" onClick={() => setSelectedProjectId(null)}>
                {activeProjectLabel}
              </Button>
            )}
            {activeCostCenterLabel && (
              <Button size="small" appearance="outline" onClick={() => setSelectedCostCenterId('')}>
                {activeCostCenterLabel}
              </Button>
            )}
          </div>
          <Button
            size="small"
            appearance="subtle"
            onClick={() => {
              setSearchResource('');
              setSelectedProjectId(null);
              setSelectedCostCenterId('');
            }}
          >
            Clear all
          </Button>
        </div>
      )}

      {error && <StatusBanner intent="error" title="Error" message={error} />}

      <Card className={styles.matrixCard}>
        <CardHeader
          header={
            <Body1>
              <strong>
                Resource Planning Matrix ({filteredDemandLines.length} demand / {filteredSupplyLines.length} supply lines)
              </strong>
            </Body1>
          }
        />
        <ResourcePlanningMatrix
          demandLines={filteredDemandLines}
          supplyLines={filteredSupplyLines}
          periods={openPeriods}
          projects={projects}
          costCenters={visibleCostCenters}
          canEditDemand={canEditDemand}
          canEditSupply={canEditSupply}
          onReload={reloadLines}
          userRole={user?.role ?? ''}
          managerCcId={managerCcId}
          allCostCenters={costCenters}
        />
      </Card>
    </div>
  );
};

export default ResourcePlanning;
