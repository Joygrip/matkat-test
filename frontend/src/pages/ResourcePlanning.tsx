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

// Module-level cache — persists across MSAL-triggered remounts so duplicate
// fetches caused by acquireTokenPopup re-initializing the component are skipped.
const _cache: {
  demandLines: DemandLine[] | null
  supplyLines: SupplyLine[] | null
  projects: Project[] | null
  costCenters: CostCenter[] | null
  openPeriods: Period[] | null
  loadedAt: number | null
  tenantId: string | null
} = {
  demandLines: null, supplyLines: null, projects: null,
  costCenters: null, openPeriods: null,
  loadedAt: null, tenantId: null,
}
const CACHE_TTL_MS = 60_000

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtPeriodShort = (p: Period) => `${MONTH_ABBR[p.month - 1]} '${String(p.year).slice(2)}`;
const fmtPeriodFull = (p: Period) => `${MONTH_FULL[p.month - 1]} ${p.year}`;

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
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
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
  },
  periodSelectorWrap: {
    marginBottom: tokens.spacingVerticalM,
  },
  periodSelectorLabel: {
    display: 'block',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: tokens.spacingVerticalXS,
  },
  periodPills: {
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
    flexWrap: 'wrap' as const,
    alignItems: 'center',
  },
  periodPill: {
    padding: `4px 10px`,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    cursor: 'pointer',
    fontFamily: 'inherit',
    userSelect: 'none' as const,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground3,
    },
  },
  periodPillActive: {
    padding: `4px 10px`,
    borderRadius: tokens.borderRadiusMedium,
    border: '1px solid #1e3a5f',
    backgroundColor: '#1e3a5f',
    color: '#ffffff',
    fontSize: tokens.fontSizeBase200,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: tokens.fontWeightSemibold,
    userSelect: 'none' as const,
  },
  periodPillInRange: {
    padding: `4px 10px`,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid #4a90d9`,
    backgroundColor: '#d0e3f7',
    color: '#1e3a5f',
    fontSize: tokens.fontSizeBase200,
    cursor: 'grabbing',
    fontFamily: 'inherit',
    fontWeight: tokens.fontWeightSemibold,
    userSelect: 'none' as const,
  },
  kpiShowingLabel: {
    marginTop: tokens.spacingVerticalXS,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  kpiAvgRows: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    marginTop: tokens.spacingVerticalXXS,
  },
  kpiAvgRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: tokens.spacingHorizontalS,
  },
  kpiAvgRowLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  kpiAvgRowValue: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
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
  const [selectedPeriodIds, setSelectedPeriodIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartIdx, setDragStartIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!user?.tenant_id) return;
    loadAll();
  }, [user?.tenant_id]);

  // Keep ref in sync so reloadLines always has the latest periods without stale closure
  useEffect(() => { openPeriodsRef.current = openPeriods; }, [openPeriods]);

  // When contextPeriods loads, derive open periods only if loadAll hasn't populated them yet
  useEffect(() => {
    if (contextPeriods.length > 0 && openPeriods.length === 0 && _cache.loadedAt === null) {
      const open = contextPeriods
        .filter(p => p.status === 'open')
        .sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));
      setOpenPeriods(open);
    }
  }, [contextPeriods]);

  // Default KPI selection: earliest open period
  useEffect(() => {
    if (openPeriods.length > 0 && selectedPeriodIds.size === 0) {
      setSelectedPeriodIds(new Set([openPeriods[0].id]));
    }
  }, [openPeriods]);

  // End drag on mouseup anywhere in the document
  useEffect(() => {
    const handleMouseUp = () => { setIsDragging(false); setDragStartIdx(null); };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const isPM = user?.role === 'PM';

  const loadAll = async () => {
    if (!user?.tenant_id) return;
    const now = Date.now();
    const cacheValid =
      _cache.tenantId === user?.tenant_id &&
      _cache.loadedAt !== null &&
      (now - _cache.loadedAt) < CACHE_TTL_MS &&
      _cache.demandLines !== null;

    if (cacheValid) {
      setDemandLines(_cache.demandLines!);
      setSupplyLines(_cache.supplyLines!);
      setProjects(_cache.projects!);
      setCostCenters(_cache.costCenters!);
      setOpenPeriods(_cache.openPeriods!);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      // PMs only see their assigned projects; Finance/Admin see all via scoped too.
      // Manager is not allowed on the scoped endpoint so falls back to listProjects.
      const projectsFetch = (isPM || user?.role === 'Finance' || user?.role === 'Admin')
        ? lookupsApi.listProjectsScoped()
        : lookupsApi.listProjects();
      const [periodsData, projectsData, costCentersData] = await Promise.all([
        periodsApi.list(),
        projectsFetch,
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
        _cache.demandLines = [];
        _cache.supplyLines = [];
        _cache.projects = projectsData;
        _cache.costCenters = costCentersData;
        _cache.openPeriods = open;
        _cache.tenantId = user?.tenant_id ?? null;
        _cache.loadedAt = _cache.tenantId ? Date.now() : null;
        return;
      }

      const [demandData, supplyData] = await Promise.all([
        planningApi.getAllDemandLines(),
        planningApi.getAllSupplyLines(),
      ]);

      setDemandLines(demandData);
      setSupplyLines(supplyData);

      _cache.demandLines = demandData;
      _cache.supplyLines = supplyData;
      _cache.projects = projectsData;
      _cache.costCenters = costCentersData;
      _cache.openPeriods = open;
      _cache.tenantId = user?.tenant_id ?? null;
      _cache.loadedAt = _cache.tenantId ? Date.now() : null;
    } catch (err: unknown) {
      setError(formatApiError(err, 'Failed to load resource planning data'));
    } finally {
      setLoading(false);
    }
  };

  // Lightweight reload: only re-fetches lines, no loading spinner; always bypasses cache
  const reloadLines = useCallback(async () => {
    if (openPeriodsRef.current.length === 0) return;
    try {
      const [demandData, supplyData] = await Promise.all([
        planningApi.getAllDemandLines(),
        planningApi.getAllSupplyLines(),
      ]);
      setDemandLines(demandData);
      setSupplyLines(supplyData);
      _cache.demandLines = demandData;
      _cache.supplyLines = supplyData;
      _cache.loadedAt = Date.now();
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
        const q = searchResource.toLowerCase();
        const name = (d.resource_name || d.placeholder_name || '').toLowerCase();
        const initials = (d.resource_initials || '').toLowerCase();
        if (!name.includes(q) && !initials.includes(q)) return false;
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
        const q = searchResource.toLowerCase();
        const name = (s.resource_name || '').toLowerCase();
        const initials = (s.resource_initials || '').toLowerCase();
        if (!name.includes(q) && !initials.includes(q)) return false;
      }
      return true;
    });
  }, [supplyLines, isManager, managerCcId, selectedProjectId, selectedCostCenterId, searchResource]);

  const selectedDemandLines = useMemo(
    () => filteredDemandLines.filter(d => selectedPeriodIds.has(d.period_id)),
    [filteredDemandLines, selectedPeriodIds],
  );

  const selectedSupplyLines = useMemo(
    () => filteredSupplyLines.filter(s => selectedPeriodIds.has(s.period_id)),
    [filteredSupplyLines, selectedPeriodIds],
  );

  const totalDemand = useMemo(
    () => selectedDemandLines.reduce((sum, d) => sum + (d.fte_percent ?? 0), 0),
    [selectedDemandLines],
  );

  const totalSupply = useMemo(
    () => selectedSupplyLines.reduce((sum, s) => sum + (s.fte_percent ?? 0), 0),
    [selectedSupplyLines],
  );

  const balance = totalSupply - totalDemand;

  const selectedCount = selectedPeriodIds.size;
  const avgDemand = selectedCount > 0 ? Math.round((totalDemand / selectedCount) * 10) / 10 : 0;
  const avgSupply = selectedCount > 0 ? Math.round((totalSupply / selectedCount) * 10) / 10 : 0;
  const avgBalance = Math.round((avgSupply - avgDemand) * 10) / 10;

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

      {/* Period selector */}
      {openPeriods.length > 0 && (
        <div className={styles.periodSelectorWrap}>
          <span className={styles.periodSelectorLabel}>Period</span>
          <div
            className={styles.periodPills}
            style={{ cursor: isDragging ? 'grabbing' : 'default' }}
          >
            {openPeriods.map((p, i) => {
              const isSelected = selectedPeriodIds.has(p.id);
              const pillClass = isSelected
                ? (isDragging ? styles.periodPillInRange : styles.periodPillActive)
                : styles.periodPill;
              return (
                <button
                  key={p.id}
                  className={pillClass}
                  onMouseDown={e => {
                    e.preventDefault();
                    setIsDragging(true);
                    setDragStartIdx(i);
                    setSelectedPeriodIds(new Set([p.id]));
                  }}
                  onMouseEnter={() => {
                    if (!isDragging || dragStartIdx === null) return;
                    const lo = Math.min(dragStartIdx, i);
                    const hi = Math.max(dragStartIdx, i);
                    setSelectedPeriodIds(new Set(openPeriods.slice(lo, hi + 1).map(x => x.id)));
                  }}
                >
                  {fmtPeriodShort(p)}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>
            {selectedCount > 1 ? `Avg of ${selectedCount} Periods` : 'Average Per Period'}
          </span>
          <div className={styles.kpiAvgRows}>
            <div className={styles.kpiAvgRow}>
              <span className={styles.kpiAvgRowLabel}>Avg Demand</span>
              <span className={styles.kpiAvgRowValue}>{avgDemand}</span>
            </div>
            <div className={styles.kpiAvgRow}>
              <span className={styles.kpiAvgRowLabel}>Avg Supply</span>
              <span className={styles.kpiAvgRowValue}>{avgSupply}</span>
            </div>
            <div className={styles.kpiAvgRow}>
              <span className={styles.kpiAvgRowLabel}>Avg Balance</span>
              <span
                className={styles.kpiAvgRowValue}
                style={{ color: avgBalance >= 0 ? tokens.colorPaletteGreenForeground2 : tokens.colorPaletteRedForeground2 }}
              >
                {avgBalance >= 0 ? '+' : ''}{avgBalance}
              </span>
            </div>
          </div>
        </div>
      </div>
      {selectedCount > 0 && (() => {
        const selPeriods = openPeriods.filter(p => selectedPeriodIds.has(p.id));
        if (selPeriods.length === 1) {
          return <div className={styles.kpiShowingLabel}>Showing: {fmtPeriodFull(selPeriods[0])}</div>;
        }
        return (
          <div className={styles.kpiShowingLabel}>
            Showing: {fmtPeriodFull(selPeriods[0])} – {fmtPeriodFull(selPeriods[selPeriods.length - 1])} ({selPeriods.length} periods)
          </div>
        );
      })()}

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

      <Card className={styles.matrixCard} style={{ overflow: 'visible' }}>
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
