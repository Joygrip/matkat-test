import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Body1,
  Button,
  Card,
  CardHeader,
  Tab,
  TabList,
  tokens,
  makeStyles,
} from '@fluentui/react-components';
import { planningApi, DemandLine, SupplyLine } from '../api/planning';
import { adminApi } from '../api/admin';
import { lookupsApi } from '../api/lookups';
import { usePeriod } from '../contexts/PeriodContext';
import { useAppData } from '../contexts/AppDataContext';
import { useAuth, useCanPM } from '../auth/AuthProvider';
import { formatApiError } from '../utils/errors';
import { getEarliestOpenPeriod } from '../utils/periodUtils';
import { MONTH_NAMES, MONTH_SHORT } from '../utils/format';
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
  loading: boolean
} = {
  demandLines: null, supplyLines: null,
  loadedAt: null, tenantId: null,
  loading: false,
}
const CACHE_TTL_MS = 60_000

// History view shows at most this many locked months (most recent first)
const HISTORY_MAX_MONTHS = 12;

const fmtPeriodShort = (p: Period) => `${MONTH_SHORT[p.month - 1]} '${String(p.year).slice(2)}`;
const fmtPeriodFull = (p: Period) => `${MONTH_NAMES[p.month - 1]} ${p.year}`;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

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

  const canPM = useCanPM();
  const canEditDemand = user?.role === 'PM' || user?.role === 'Finance' || user?.role === 'Admin' || canPM;
  const isManagerReader = user?.role === 'Manager' && user?.secondary_role === 'Reader';
  const canEditSupply = user?.role === 'Manager' || user?.role === 'Finance' || user?.role === 'Admin';
  const isManager = user?.role === 'Manager' && !isManagerReader;
  const isAnyManager = user?.role === 'Manager';

  const { periods: contextPeriods } = usePeriod();
  const { costCenters, projects, myResource } = useAppData();

  const [openPeriods, setOpenPeriods] = useState<Period[]>([]);
  const openPeriodsRef = useRef<Period[]>([]);
  const selectedProjectIdRef = useRef<string | null>(null);
  const selectedCostCenterIdRef = useRef<string>('');
  // null = first run not yet recorded; distinguishes "no filter yet" from "filter is empty string"
  const previousFilterKeyRef = useRef<string | null>(null);
  const [demandLines, setDemandLines] = useState<DemandLine[]>([]);
  const [supplyLines, setSupplyLines] = useState<SupplyLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managerCcId, setManagerCcId] = useState<string | null>(null);
  const [delegatedCcIds, setDelegatedCcIds] = useState<Set<string>>(new Set());
  const [scopedCcIds, setScopedCcIds] = useState<Set<string>>(new Set());

  const [searchResource, setSearchResource] = useState('');
  const debouncedSearchResource = useDebouncedValue(searchResource, 250);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string>('');
  const [selectedPeriodIds, setSelectedPeriodIds] = useState<Set<string>>(new Set());

  // Planning shows open periods (editable); History shows locked periods read-only.
  // Historical lines live in separate state so the planning cache/optimistic
  // patching is never polluted with locked-period data.
  const [viewMode, setViewMode] = useState<'planning' | 'history'>('planning');
  const viewModeRef = useRef<'planning' | 'history'>('planning');
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  const [historyDemandLines, setHistoryDemandLines] = useState<DemandLine[]>([]);
  const [historySupplyLines, setHistorySupplyLines] = useState<SupplyLine[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyLoadedRef = useRef(false);

  const lockedRecentPeriods = useMemo(
    () => contextPeriods
      .filter(p => p.status !== 'open')
      .sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month))
      .slice(-HISTORY_MAX_MONTHS),
    [contextPeriods]
  );

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

  // Keep refs in sync so reloadLines always has the latest values without stale closures
  useEffect(() => { openPeriodsRef.current = openPeriods; }, [openPeriods]);
  useEffect(() => { selectedProjectIdRef.current = selectedProjectId; }, [selectedProjectId]);
  useEffect(() => { selectedCostCenterIdRef.current = selectedCostCenterId; }, [selectedCostCenterId]);

  // When project or CC filter changes, fetch server-side filtered lines.
  // Normalized primitive filterKey avoids object-identity pitfalls.
  // First run (previousFilterKeyRef === null): record key and return — initial load is
  // handled by loadAll, not here. StrictMode remount: ref persists (useRef survives simulated
  // unmount), key unchanged → skip. Genuine filter change: key differs → reloadLines once.
  useEffect(() => {
    const normalizedProjectId = selectedProjectId ?? '';
    const normalizedCostCenterId = selectedCostCenterId ?? '';
    const filterKey = `${normalizedProjectId}|${normalizedCostCenterId}`;
    if (previousFilterKeyRef.current === null) {
      previousFilterKeyRef.current = filterKey;
      return;
    }
    if (previousFilterKeyRef.current === filterKey) return;
    previousFilterKeyRef.current = filterKey;
    // History mode filters client-side over already-loaded locked lines — no refetch
    if (viewModeRef.current === 'history') return;
    if (import.meta.env.DEV) console.log('[RP fetch] filter changed → reloadLines', { filterKey });
    reloadLines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, selectedCostCenterId]);

  // Derive the manager's own CC from the cached resource record (context) + scoped resources list.
  // Scoped resources always includes the manager's own resource even when they have no supply lines.
  // For ManagerReader: also fetch delegations to identify which other CCs are delegated.
  useEffect(() => {
    if (!user?.object_id || !isAnyManager || !myResource) return;
    const rid: string | null = myResource.resource_id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // forWrite:true ensures Manager+Reader gets write-scoped resources (own+director+delegated)
    // rather than read-expanded company-wide resources. For plain Manager the result is identical.
    const fetches: Promise<any>[] = [lookupsApi.listResourcesScoped({ forWrite: true })];
    if (user?.role === 'Manager') {
      fetches.push(adminApi.listDelegatesAsDelegate());
    }
    Promise.all(fetches).then(([resources, delegates]) => {
      const userRes = rid ? resources.find((r: { id: string; cost_center_id: string; user_id?: string | null }) => r.id === rid) : null;
      setManagerCcId(userRes?.cost_center_id ?? null);
      setScopedCcIds(new Set(resources.map((r: { cost_center_id: string }) => r.cost_center_id).filter(Boolean)));
      if (user?.role === 'Manager' && delegates) {
        const activeDelegatorIds = new Set(
          delegates.filter((d: { is_active: boolean }) => d.is_active)
                   .map((d: { delegator_id: string }) => d.delegator_id)
        );
        const ccIds = new Set<string>(
          costCenters
            .filter(cc =>
              (cc.ro_user_id && activeDelegatorIds.has(cc.ro_user_id)) ||
              (cc.director_user_id && activeDelegatorIds.has(cc.director_user_id))
            )
            .map(cc => cc.id)
        );
        setDelegatedCcIds(ccIds);
      }
    }).catch(() => {});
  }, [user?.object_id, isAnyManager, isManagerReader, myResource]);

  // Default selected column = earliest open period (active planning window).
  useEffect(() => {
    if (viewMode !== 'planning') return;
    if (openPeriods.length > 0 && selectedPeriodIds.size === 0) {
      const defaultPeriod = getEarliestOpenPeriod(openPeriods);
      if (defaultPeriod) setSelectedPeriodIds(new Set([defaultPeriod.id]));
    }
  }, [openPeriods, viewMode]);

  // Mode switch: reset the period selection to a sensible default for the mode.
  const switchViewMode = useCallback((mode: 'planning' | 'history') => {
    setViewMode(mode);
    if (mode === 'history') {
      setSelectedPeriodIds(new Set(lockedRecentPeriods.map(p => p.id)));
    } else {
      const defaultPeriod = getEarliestOpenPeriod(openPeriods);
      setSelectedPeriodIds(defaultPeriod ? new Set([defaultPeriod.id]) : new Set());
    }
  }, [lockedRecentPeriods, openPeriods]);

  // Lazily load historical (locked-period) lines once, on first History visit.
  // Kept out of the planning module cache on purpose.
  useEffect(() => {
    if (viewMode !== 'history' || historyLoadedRef.current) return;
    historyLoadedRef.current = true;
    setHistoryLoading(true);
    const lockedIds = new Set(lockedRecentPeriods.map(p => p.id));
    Promise.all([
      planningApi.getAllDemandLines({ includeLocked: true }),
      planningApi.getAllSupplyLines({ includeLocked: true }),
    ])
      .then(([demandData, supplyData]) => {
        setHistoryDemandLines(demandData.filter(l => lockedIds.has(l.period_id)));
        setHistorySupplyLines(supplyData.filter(l => lockedIds.has(l.period_id)));
      })
      .catch((err: unknown) => {
        historyLoadedRef.current = false; // allow retry on next visit
        setError(formatApiError(err, 'Failed to load historical planning data'));
      })
      .finally(() => setHistoryLoading(false));
  }, [viewMode, lockedRecentPeriods]);

  const isHistory = viewMode === 'history';
  const displayPeriods = isHistory ? lockedRecentPeriods : openPeriods;

  const loadAll = async (open: Period[]) => {
    if (!user?.tenant_id) return;
    // In-flight guard: prevents concurrent calls (e.g. React 18 StrictMode double-mount)
    // from both making network requests before the first resolves and sets _cache.loadedAt.
    if (_cache.loading) {
      if (import.meta.env.DEV) console.log('[RP fetch] loadAll SKIPPED (already in-flight)');
      return;
    }
    const now = Date.now();
    const cacheValid =
      _cache.tenantId === user?.tenant_id &&
      _cache.loadedAt !== null &&
      (now - _cache.loadedAt) < CACHE_TTL_MS &&
      _cache.demandLines !== null;

    if (cacheValid) {
      if (import.meta.env.DEV) console.log('[RP fetch] loadAll HIT cache');
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

    _cache.loading = true;
    if (import.meta.env.DEV) console.log('[RP fetch] loadAll FETCH');
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
      _cache.loading = false;
      setLoading(false);
    }
  };

  // --- Local state patchers for A1 (no full reload on individual cell edits) ---
  const upsertDemandLine = useCallback((line: DemandLine) => {
    setDemandLines(prev => {
      const idx = prev.findIndex(x => x.id === line.id);
      if (idx === -1) return [...prev, line];
      const next = [...prev];
      next[idx] = line;
      return next;
    });
    _cache.loadedAt = null; // invalidate so next remount re-fetches
  }, []);

  const removeDemandLine = useCallback((id: string) => {
    setDemandLines(prev => prev.filter(x => x.id !== id));
    _cache.loadedAt = null;
  }, []);

  const upsertSupplyLine = useCallback((line: SupplyLine) => {
    setSupplyLines(prev => {
      const idx = prev.findIndex(x => x.id === line.id);
      if (idx === -1) return [...prev, line];
      const next = [...prev];
      next[idx] = line;
      return next;
    });
    _cache.loadedAt = null;
  }, []);

  const removeSupplyLine = useCallback((id: string) => {
    setSupplyLines(prev => prev.filter(x => x.id !== id));
    _cache.loadedAt = null;
  }, []);

  // Lightweight reload: only re-fetches lines, no loading spinner; always bypasses cache.
  // Passes active project/CC filters so backend returns only the relevant subset.
  const reloadLines = useCallback(async () => {
    if (openPeriodsRef.current.length === 0) return;
    if (import.meta.env.DEV) console.log('[RP fetch] reloadLines', { projectId: selectedProjectIdRef.current, costCenterId: selectedCostCenterIdRef.current });
    const projectId = selectedProjectIdRef.current || undefined;
    const costCenterId = selectedCostCenterIdRef.current || undefined;
    const filters = (projectId || costCenterId) ? { projectId, costCenterId } : undefined;
    try {
      const [demandData, supplyData] = await Promise.all([
        planningApi.getAllDemandLines(filters),
        planningApi.getAllSupplyLines(filters),
      ]);
      setDemandLines(demandData);
      setSupplyLines(supplyData);
      // Only update the module cache for unfiltered fetches
      if (!filters) {
        _cache.demandLines = demandData;
        _cache.supplyLines = supplyData;
        _cache.loadedAt = Date.now();
      } else {
        _cache.loadedAt = null; // stale after a filtered reload
      }
    } catch {
      // silent — the edited cell already reflects the change optimistically
    }
  }, []);

  // CCs the user may write supply lines for.
  // Source of truth is scopedCcIds (from listResourcesScoped({ forWrite: true })), which the backend
  // scopes to own CC + director CCs + delegated resources. Supply/demand line CCs are NOT unioned here
  // because for Manager+Reader the read-expanded backend returns company-wide lines, which would pollute
  // the writable set. Backend remains final authority; this only controls UI picker options.
  const editableCcIds = useMemo((): Set<string> | null => {
    if (!isAnyManager) return null;
    const ids = new Set<string>();
    if (managerCcId) ids.add(managerCcId);
    // Delegated CCs from explicit delegation grants
    if (user?.role === 'Manager') delegatedCcIds.forEach(id => ids.add(id));
    // Write-scoped CCs from the forWrite=true lookup (own CC + director CCs + delegated)
    scopedCcIds.forEach(id => ids.add(id));
    // Return null only while still loading (nothing resolved yet)
    return ids.size > 0 ? ids : null;
  }, [isAnyManager, isManagerReader, managerCcId, delegatedCcIds, scopedCcIds]);

  // CCs labelled "My CC": direct-RO and director CCs for this user.
  // Use isAnyManager (not isManager) so Manager+Reader also gets labels for their own CCs.
  const managedCcIds = useMemo(() => {
    if (!isAnyManager || !user?.id) return new Set<string>();
    return new Set(
      costCenters
        .filter(cc => cc.ro_user_id === user.id || cc.director_user_id === user.id)
        .map(cc => cc.id)
    );
  }, [costCenters, user?.id, isAnyManager]);

  const sourceDemandLines = isHistory ? historyDemandLines : demandLines;
  const sourceSupplyLines = isHistory ? historySupplyLines : supplyLines;

  const filteredDemandLines = useMemo(() => {
    return sourceDemandLines.filter(d => {
      if (selectedProjectId && d.project_id !== selectedProjectId) return false;
      if (selectedCostCenterId && d.cost_center_id !== selectedCostCenterId) return false;
      if (debouncedSearchResource) {
        const q = debouncedSearchResource.toLowerCase();
        const name = (d.resource_name || d.placeholder_name || '').toLowerCase();
        const initials = (d.resource_initials || '').toLowerCase();
        if (!name.includes(q) && !initials.includes(q)) return false;
      }
      return true;
    });
  }, [sourceDemandLines, selectedProjectId, selectedCostCenterId, debouncedSearchResource]);

  const filteredSupplyLines = useMemo(() => {
    return sourceSupplyLines.filter(s => {
      if (selectedProjectId && s.project_id !== selectedProjectId) return false;
      if (selectedCostCenterId && s.cost_center_id !== selectedCostCenterId) return false;
      if (debouncedSearchResource) {
        const q = debouncedSearchResource.toLowerCase();
        const name = (s.resource_name || '').toLowerCase();
        const initials = (s.resource_initials || '').toLowerCase();
        if (!name.includes(q) && !initials.includes(q)) return false;
      }
      return true;
    });
  }, [sourceSupplyLines, selectedProjectId, selectedCostCenterId, debouncedSearchResource]);

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
      ? displayPeriods.filter(p => selectedPeriodIds.has(p.id))
      : displayPeriods;
    return periodsToShow.map(p => {
      const label = fmtPeriodShort(p);
      const rawDemand = demandByPeriod.get(p.id);
      const rawSupply = supplyByPeriod.get(p.id);
      const demand = rawDemand !== undefined ? Math.round(rawDemand * 10) / 10 : 0;
      const supply = rawSupply !== undefined ? Math.round(rawSupply * 10) / 10 : 0;
      const base = Math.round(Math.min(demand, supply) * 10) / 10;
      return {
        label,
        periodId: p.id,
        demand,
        supply,
        base,
        // Use 0 (not null) so Recharts stacked areas accumulate correctly and both colours show.
        gap_under: demand > supply ? Math.round((demand - supply) * 10) / 10 : 0,
        gap_over: supply > demand ? Math.round((supply - demand) * 10) / 10 : 0,
      };
    });
  }, [filteredDemandLines, filteredSupplyLines, displayPeriods, selectedPeriodIds]);

  // Only show CCs that have at least one demand or supply line (matching active filters).
  // For managers: always include managerCcId even if empty (own CC), plus any delegated CCs with lines.
  const visibleCostCenters = useMemo(() => {
    const activeCcIds = new Set([
      ...filteredDemandLines.map(d => d.cost_center_id).filter(Boolean),
      ...filteredSupplyLines.map(s => s.cost_center_id).filter(Boolean),
    ]);
    if (isAnyManager && managerCcId) activeCcIds.add(managerCcId);
    managedCcIds.forEach(id => activeCcIds.add(id));
    return costCenters.filter(c => activeCcIds.has(c.id));
  }, [costCenters, filteredDemandLines, filteredSupplyLines, isAnyManager, managerCcId, managedCcIds]);

  if (loading) {
    return <LoadingState message="Loading resource planning data..." />;
  }

  return (
    <div className={styles.container}>

      {/* Planning / History mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: tokens.spacingVerticalM }}>
        <TabList
          size="small"
          selectedValue={viewMode}
          onTabSelect={(_, d) => switchViewMode(d.value as 'planning' | 'history')}
        >
          <Tab value="planning">Planning</Tab>
          <Tab value="history">History</Tab>
        </TabList>
        {isHistory && (
          <span style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
            🔒 Historical view — locked periods are read-only
            {lockedRecentPeriods.length === HISTORY_MAX_MONTHS && ` (last ${HISTORY_MAX_MONTHS} locked months)`}
          </span>
        )}
      </div>

      {isHistory && historyLoading && (
        <LoadingState message="Loading historical planning data..." />
      )}
      {isHistory && !historyLoading && lockedRecentPeriods.length === 0 && (
        <StatusBanner
          intent="info"
          title="No historical periods"
          message="No locked periods yet. Periods appear here after Finance locks them."
        />
      )}

      {/* Period selector */}
      {displayPeriods.length > 0 && (
        <div className={styles.periodSelectorWrap}>
          <span className={styles.periodSelectorLabel}>Period</span>
          <PeriodPillSelector
            periods={displayPeriods}
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
        const selPeriods = displayPeriods.filter(p => selectedPeriodIds.has(p.id));
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
      {displayPeriods.length > 0 && (
        <div className={styles.overviewCard}>
          <div className={styles.overviewCardHeader}>
            <strong style={{ fontSize: tokens.fontSizeBase400, color: tokens.colorNeutralForeground1 }}>
              Resource Planning Overview
            </strong>
          </div>
          <div className={styles.overviewCardBody}>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={overviewChartData} margin={{ top: 8, right: 24, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#666' }}
                  interval="preserveStartEnd"
                  angle={0}
                  textAnchor="middle"
                  height={30}
                />
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
                {selectedPeriodIds.size === 1 && displayPeriods
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
                <Line type="monotone" dataKey="demand" stroke="#d97706" strokeWidth={2.5} dot={false} name="Total Demand" unit="%" connectNulls={true} />
                <Line type="monotone" dataKey="supply" stroke="#0d9488" strokeWidth={2.5} dot={false} name="Total Supply" unit="%" connectNulls={true} />
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
              {isManagerReader && (
                <span style={{
                  display: 'inline-block', marginLeft: 10,
                  fontSize: 11, fontWeight: 600,
                  padding: '2px 7px', borderRadius: 4,
                  backgroundColor: '#fff8e6', color: '#7a5900',
                  border: '1px solid #f0d060',
                  verticalAlign: 'middle',
                }}>
                  Company view · Reader access
                </span>
              )}
            </Body1>
          }
        />
        <ResourcePlanningMatrix
          demandLines={filteredDemandLines}
          supplyLines={filteredSupplyLines}
          periods={displayPeriods}
          projects={projects}
          costCenters={visibleCostCenters}
          canEditDemand={canEditDemand && !isHistory}
          canEditSupply={canEditSupply && !isHistory}
          onReload={reloadLines}
          onDemandSaved={upsertDemandLine}
          onDemandDeleted={removeDemandLine}
          onSupplySaved={upsertSupplyLine}
          onSupplyDeleted={removeSupplyLine}
          userRole={user?.role ?? ''}
          managedCcIds={managedCcIds}
          allCostCenters={costCenters}
          editableCcIds={editableCcIds ?? undefined}
          canPM={canPM}
        />
      </Card>
    </div>
  );
};

export default ResourcePlanning;
