import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Body1,
  Button,
  Card,
  CardHeader,
  tokens,
  makeStyles,
} from '@fluentui/react-components';
import { planningApi, DemandLine, SupplyLine } from '../api/planning';
import { adminApi } from '../api/admin';
import { lookupsApi } from '../api/lookups';
import { usePeriod } from '../contexts/PeriodContext';
import { useAppData } from '../contexts/AppDataContext';
import { useAuth } from '../auth/AuthProvider';
import { formatApiError } from '../utils/errors';
import { SearchableFilter } from '../components/SearchableFilter';
import { LoadingState } from '../components/LoadingState';
import { StatusBanner } from '../components/StatusBanner';
import { ResourcePlanningMatrix } from '../components/ResourcePlanningMatrix';
import { PeriodPillSelector } from '../components/shared/PeriodPillSelector';
import { Period } from '../types/index';
import {
  ComposedChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea,
} from 'recharts';

// Module-level cache — persists across MSAL-triggered remounts so duplicate
// fetches caused by acquireTokenPopup re-initializing the component are skipped.
// Only caches demand/supply lines; projects, cost-centers, and periods come from context.
const _cache: {
  demandLines: DemandLine[] | null
  supplyLines: SupplyLine[] | null
  loadedAt: number | null
  tenantId: string | null
} = {
  demandLines: null, supplyLines: null,
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
  overviewCard: {
    marginBottom: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    overflow: 'hidden',
  },
  overviewCardHeader: {
    padding: '12px 20px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  overviewCardBody: {
    padding: '16px 20px',
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
  const isManagerReader = user?.role === 'Manager' && user?.secondary_role === 'Reader';
  const canEditSupply = user?.role === 'Manager' || user?.role === 'Finance' || user?.role === 'Admin';
  const isManager = user?.role === 'Manager' && !isManagerReader;
  const isAnyManager = user?.role === 'Manager';

  const { periods: contextPeriods } = usePeriod();
  const { costCenters, projects, myResource } = useAppData();

  const [openPeriods, setOpenPeriods] = useState<Period[]>([]);
  const openPeriodsRef = useRef<Period[]>([]);
  const [demandLines, setDemandLines] = useState<DemandLine[]>([]);
  const [supplyLines, setSupplyLines] = useState<SupplyLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managerCcId, setManagerCcId] = useState<string | null>(null);
  const [delegatedCcIds, setDelegatedCcIds] = useState<Set<string>>(new Set());

  const [searchResource, setSearchResource] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string>('');
  const [selectedPeriodIds, setSelectedPeriodIds] = useState<Set<string>>(new Set());

  // Derive open periods from context whenever it updates
  useEffect(() => {
    if (contextPeriods.length > 0) {
      const open = contextPeriods
        .filter(p => p.status === 'open')
        .sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));
      setOpenPeriods(open);
    }
  }, [contextPeriods]);

  // Trigger line fetch once both user and context periods are ready
  useEffect(() => {
    if (!user?.tenant_id || contextPeriods.length === 0) return;
    const open = contextPeriods
      .filter(p => p.status === 'open')
      .sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));
    loadAll(open);
  }, [user?.tenant_id, contextPeriods.length > 0 ? 'ready' : 'waiting']);

  // Keep ref in sync so reloadLines always has the latest periods without stale closure
  useEffect(() => { openPeriodsRef.current = openPeriods; }, [openPeriods]);

  // Derive the manager's own CC from the cached resource record (context) + scoped resources list.
  // Scoped resources always includes the manager's own resource even when they have no supply lines.
  // For ManagerReader: also fetch delegations to identify which other CCs are delegated.
  useEffect(() => {
    if (!user?.object_id || !isAnyManager || !myResource) return;
    const rid: string | null = myResource.resource_id;
    const fetches: Promise<any>[] = [lookupsApi.listResourcesScoped()];
    if (isManagerReader) {
      fetches.push(adminApi.listDelegatesAsDelegate());
    }
    Promise.all(fetches).then(([resources, delegates]) => {
      const userRes = rid ? resources.find((r: { id: string; cost_center_id: string }) => r.id === rid) : null;
      setManagerCcId(userRes?.cost_center_id ?? null);
      if (isManagerReader && delegates) {
        const activeDelegatorIds = new Set(
          delegates.filter((d: { is_active: boolean; delegator_id: string }) => d.is_active).map((d: { delegator_id: string }) => d.delegator_id)
        );
        const ccIds = new Set<string>(
          resources
            .filter((r: { user_id: string | null; cost_center_id: string }) => r.user_id && activeDelegatorIds.has(r.user_id))
            .map((r: { cost_center_id: string }) => r.cost_center_id)
        );
        setDelegatedCcIds(ccIds);
      }
    }).catch(() => {});
  }, [user?.object_id, isAnyManager, isManagerReader, myResource]);

  // Default KPI selection: earliest open period
  useEffect(() => {
    if (openPeriods.length > 0 && selectedPeriodIds.size === 0) {
      setSelectedPeriodIds(new Set([openPeriods[0].id]));
    }
  }, [openPeriods]);

  const loadAll = async (open: Period[]) => {
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
      setLoading(false);
      return;
    }

    if (open.length === 0) {
      setDemandLines([]);
      setSupplyLines([]);
      _cache.demandLines = [];
      _cache.supplyLines = [];
      _cache.tenantId = user?.tenant_id ?? null;
      _cache.loadedAt = _cache.tenantId ? Date.now() : null;
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [demandData, supplyData] = await Promise.all([
        planningApi.getAllDemandLines(),
        planningApi.getAllSupplyLines(),
      ]);

      setDemandLines(demandData);
      setSupplyLines(supplyData);

      _cache.demandLines = demandData;
      _cache.supplyLines = supplyData;
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

  // CCs the user may write supply lines for (own CC + delegated CCs).
  // Only needed for ManagerReader — pure Managers already have backend-scoped lines.
  const editableCcIds = useMemo((): Set<string> | null => {
    if (!isManagerReader) return null;
    const ids = new Set<string>();
    if (managerCcId) ids.add(managerCcId);
    delegatedCcIds.forEach(id => ids.add(id));
    // If still loading (managerCcId not yet resolved) return null so filter is skipped
    return ids.size > 0 ? ids : null;
  }, [isManagerReader, managerCcId, delegatedCcIds]);

  const filteredDemandLines = useMemo(() => {
    return demandLines.filter(d => {
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
  }, [demandLines, selectedProjectId, selectedCostCenterId, searchResource]);

  const filteredSupplyLines = useMemo(() => {
    return supplyLines.filter(s => {
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
  }, [supplyLines, selectedProjectId, selectedCostCenterId, searchResource]);

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

  const overviewChartData = useMemo(() => {
    const demandByPeriod = new Map<string, number>();
    const supplyByPeriod = new Map<string, number>();
    filteredDemandLines.forEach(d => {
      demandByPeriod.set(d.period_id, (demandByPeriod.get(d.period_id) ?? 0) + (d.fte_percent ?? 0));
    });
    filteredSupplyLines.forEach(s => {
      supplyByPeriod.set(s.period_id, (supplyByPeriod.get(s.period_id) ?? 0) + (s.fte_percent ?? 0));
    });
    // Show all periods for 0 or 1 selected; zoom to selection when 2+
    const periodsToShow = selectedPeriodIds.size > 1
      ? openPeriods.filter(p => selectedPeriodIds.has(p.id))
      : openPeriods;
    return periodsToShow.map(p => {
      const label = fmtPeriodShort(p);
      const demand = Math.round((demandByPeriod.get(p.id) ?? 0) * 10) / 10;
      const supply = Math.round((supplyByPeriod.get(p.id) ?? 0) * 10) / 10;
      const base = Math.min(demand, supply);
      return {
        label,
        periodId: p.id,
        demand,
        supply,
        base: Math.round(base * 10) / 10,
        gap_under: demand > supply ? Math.round((demand - supply) * 10) / 10 : 0,
        gap_over: supply > demand ? Math.round((supply - demand) * 10) / 10 : 0,
      };
    });
  }, [filteredDemandLines, filteredSupplyLines, openPeriods, selectedPeriodIds]);

  // Only show CCs that have at least one demand or supply line (matching active filters).
  // For managers: always include managerCcId even if empty (own CC), plus any delegated CCs with lines.
  const visibleCostCenters = useMemo(() => {
    const activeCcIds = new Set([
      ...filteredDemandLines.map(d => d.cost_center_id).filter(Boolean),
      ...filteredSupplyLines.map(s => s.cost_center_id).filter(Boolean),
    ]);
    if (isAnyManager && managerCcId) activeCcIds.add(managerCcId);
    return costCenters.filter(c => activeCcIds.has(c.id));
  }, [costCenters, filteredDemandLines, filteredSupplyLines, isAnyManager, managerCcId]);

  if (loading) {
    return <LoadingState message="Loading resource planning data..." />;
  }

  return (
    <div className={styles.container}>

      {/* Period selector */}
      {openPeriods.length > 0 && (
        <div className={styles.periodSelectorWrap}>
          <span className={styles.periodSelectorLabel}>Period</span>
          <PeriodPillSelector
            periods={openPeriods}
            selectedIds={selectedPeriodIds}
            onChange={setSelectedPeriodIds}
          />
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

      {/* Resource Planning Overview chart */}
      {openPeriods.length > 0 && (
        <div className={styles.overviewCard}>
          <div className={styles.overviewCardHeader}>
            <strong style={{ fontSize: tokens.fontSizeBase400, color: tokens.colorNeutralForeground1 }}>
              Resource Planning Overview
            </strong>
          </div>
          <div className={styles.overviewCardBody}>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={overviewChartData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} unit="%" />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload) return null;
                    const demandEntry = payload.find(p => p.dataKey === 'demand');
                    const supplyEntry = payload.find(p => p.dataKey === 'supply');
                    if (!demandEntry && !supplyEntry) return null;
                    const gap = ((demandEntry?.value as number) ?? 0) - ((supplyEntry?.value as number) ?? 0);
                    const gapAbs = Math.abs(Math.round(gap * 10) / 10);
                    const isUnder = gap > 0;
                    return (
                      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}>
                        <p style={{ margin: '0 0 6px', fontWeight: 600, color: '#111827' }}>{label}</p>
                        {demandEntry && <p style={{ margin: '2px 0', color: '#d97706' }}>Total Demand: {demandEntry.value}%</p>}
                        {supplyEntry && <p style={{ margin: '2px 0', color: '#0d9488' }}>Total Supply: {supplyEntry.value}%</p>}
                        {gapAbs > 0 && (
                          <p style={{ margin: '4px 0 0', color: isUnder ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
                            {isUnder ? `Understaffed: ${gapAbs}%` : `Overstaffed: ${gapAbs}%`}
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                <Legend />
                {/* Highlight the single selected period when showing all periods */}
                {selectedPeriodIds.size === 1 && openPeriods
                  .filter(p => selectedPeriodIds.has(p.id))
                  .map(p => (
                    <ReferenceArea
                      key={p.id}
                      x1={fmtPeriodShort(p)}
                      x2={fmtPeriodShort(p)}
                      fill="#d97706"
                      fillOpacity={0.08}
                    />
                  ))
                }
                {/* Shaded gap areas — stacked to fill between lines */}
                <Area type="monotone" dataKey="base" stackId="gap" fill="transparent" stroke="none" legendType="none" tooltipType="none" isAnimationActive={false} />
                <Area type="monotone" dataKey="gap_under" stackId="gap" fill="#fee2e2" fillOpacity={0.4} stroke="none" legendType="none" name="Understaffed gap" isAnimationActive={false} />
                <Area type="monotone" dataKey="gap_over" stackId="gap" fill="#dcfce7" fillOpacity={0.4} stroke="none" legendType="none" name="Overstaffed gap" isAnimationActive={false} />
                {/* Lines on top */}
                <Line type="monotone" dataKey="demand" stroke="#d97706" strokeWidth={2.5} dot={false} name="Total Demand" unit="%" />
                <Line type="monotone" dataKey="supply" stroke="#0d9488" strokeWidth={2.5} dot={false} name="Total Supply" unit="%" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

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
          editableCcIds={editableCcIds ?? undefined}
        />
      </Card>
    </div>
  );
};

export default ResourcePlanning;
