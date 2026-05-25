/**
 * ConsolidatedCostChart — Cost Overview redesign
 * API: /finance/consolidated-costs + /finance/consolidated-costs/detail
 * All demand_cost / actuals_cost are in DKK; externals_cost / equipment_cost are in cents.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Spinner, Select, Tab, TabList, Combobox, Option } from '@fluentui/react-components';
import { ChevronRight20Regular, Dismiss20Regular, ArrowDownloadRegular } from '@fluentui/react-icons';
import { PeriodPillSelector } from '../shared/PeriodPillSelector';
import {
  getConsolidatedCosts,
  getConsolidatedCostDetail,
  ConsolidatedCostRow,
  ConsolidatedCostDetail,
} from '../../api/finance';
import { usePeriod } from '../../contexts/PeriodContext';
import type { Snapshot } from '../../api/consolidation';
import { MONTH_SHORT, MONTH_NAMES } from '../../utils/format';

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg: '#faf9f8', surface: '#ffffff', border: '#edebe9', borderStrong: '#d2d0ce',
  ink1: '#201f1e', ink2: '#424241', ink3: '#605e5c', ink4: '#8a8886',
  rowHover: '#f3f2f1', accent: '#0f6cbd', accentSoft: '#eaf2fb',
  planned: '#6b7c93', plannedSoft: '#d6dbe3',
  actual: '#0f6cbd', actualSoft: '#cfe1f2',
  oop: '#8a6a3b', oopSoft: '#ece1cd',
  equip: '#5b6b3a', equipSoft: '#e3e7d3',
  pos: '#0e7a3a', neg: '#b1391a',
  periodHeader: '#eceae8',
} as const;

// ─── Constants ────────────────────────────────────────────────────────────────


// ─── Formatters ───────────────────────────────────────────────────────────────

const dkk = (v: number) =>
  new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 }).format(v);

const dkkD = (v: number) =>
  new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

// ─── Sub-components ───────────────────────────────────────────────────────────

function Sparkline({ data, width = 44, height = 18, color = C.accent }: {
  data: number[]; width?: number; height?: number; color?: string;
}) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MiniBar({ planned, actual, oop, equip, max, height = 12 }: {
  planned: number; actual: number; oop: number; equip: number; max: number; height?: number;
}) {
  const total = planned + actual + oop + equip;
  if (total === 0 || max === 0) return <div style={{ height }} />;
  const pct = Math.min(100, (total / max) * 100);
  const segs = [
    { val: planned, color: C.planned },
    { val: actual, color: C.actual },
    { val: oop, color: C.oop },
    { val: equip, color: C.equip },
  ].filter(s => s.val > 0);
  return (
    <div style={{ width: '100%', height, display: 'flex', alignItems: 'center' }}>
      <div style={{ width: `${pct}%`, height, display: 'flex', borderRadius: 2, overflow: 'hidden' }}>
        {segs.map((s, i) => <div key={i} style={{ flex: s.val, background: s.color, minWidth: 2 }} />)}
      </div>
    </div>
  );
}

function TrendCell({ data, color }: { data: number[]; color?: string }) {
  if (data.length < 2) return <span style={{ color: C.ink4, fontSize: 12 }}>—</span>;
  const first = data[0], last = data[data.length - 1];
  if (first === 0) return <span style={{ color: C.ink4, fontSize: 12 }}>—</span>;
  const delta = ((last - first) / first) * 100;
  const flat = Math.abs(delta) < 0.5;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
      <Sparkline data={data} color={color ?? C.accent} />
      {!flat && (
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 5px', borderRadius: 8,
          background: delta > 0 ? '#fde8e4' : '#e3f4ea',
          color: delta > 0 ? C.neg : C.pos,
        }}>
          {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
        </span>
      )}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface EntityRow {
  id: string; name: string;
  planned: number; actual: number; oop: number; equip: number; total: number;
  monthlyTotals: number[];
}

interface MonthlyBucket {
  year: number; month: number;
  planned: number; actual: number; oop: number; equip: number;
}

interface DrawerState {
  mode: 'project' | 'cc';
  title: string; id: string;
  year: number; month: number;
  monthlyData: MonthlyBucket[];
  kpis: { planned: number; actual: number; oop: number; equip: number };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { latestSnapshot?: Snapshot | null; }

export const ConsolidatedCostChart: React.FC<Props> = ({ latestSnapshot: _latestSnapshot }) => {
  const { periods } = usePeriod();

  // Data
  const [rawData, setRawData] = useState<ConsolidatedCostRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Locked period lazy-fetch cache: "year-month" → rows
  const lockedCacheRef = useRef(new Map<string, ConsolidatedCostRow[]>());
  const [lockedRawData, setLockedRawData] = useState<ConsolidatedCostRow[]>([]);

  // Filters
  const [selectedPeriodIds, setSelectedPeriodIds] = useState<Set<string>>(new Set());
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string | null>(null);
  const showPlanned = true;
  const [groupBy, setGroupBy] = useState<'id' | 'code'>('id');
  const [showAllProjects, setShowAllProjects] = useState(false);

  // Sticky filter bar shadow detection
  const filterSentinelRef = useRef<HTMLDivElement>(null);
  const [filterBarStuck, setFilterBarStuck] = useState(false);

  useEffect(() => {
    const sentinel = filterSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setFilterBarStuck(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Modal (formerly drawer)
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerDetail, setDrawerDetail] = useState<ConsolidatedCostDetail[] | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'bymonth' | 'planned' | 'actual' | 'oop' | 'equipment'>('bymonth');
  const [collapsedPeriods, setCollapsedPeriods] = useState<Set<string>>(new Set());

  // ── Loaders ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Clear locked-period cache when groupBy changes — cached rows used a different grouping.
    lockedCacheRef.current.clear();
    setLockedRawData([]);
    setLoading(true);
    getConsolidatedCosts({ group_by: groupBy })
      .then(res => setRawData(res.data))
      .catch(() => setRawData([]))
      .finally(() => setLoading(false));
  }, [groupBy]);

  // Lazily fetch data for a selected locked period and cache it
  useEffect(() => {
    const lockedPeriod = periods.find(p => selectedPeriodIds.has(p.id) && p.status !== 'open');
    if (!lockedPeriod) {
      setLockedRawData([]);
      return;
    }
    const key = `${lockedPeriod.year}-${lockedPeriod.month}`;
    const cached = lockedCacheRef.current.get(key);
    if (cached) {
      setLockedRawData(cached);
      return;
    }
    getConsolidatedCosts({ year: lockedPeriod.year, month: lockedPeriod.month, group_by: groupBy })
      .then(res => {
        lockedCacheRef.current.set(key, res.data);
        setLockedRawData(res.data);
      })
      .catch(() => setLockedRawData([]));
  }, [selectedPeriodIds, periods, groupBy]);


  useEffect(() => {
    if (!drawer) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer]);

  // Merge open-period base data with any fetched locked-period data
  const allRawData = useMemo(() => [...rawData, ...lockedRawData], [rawData, lockedRawData]);

  // ── Period helpers ────────────────────────────────────────────────────────────

  const openPeriods = useMemo(
    () => [...periods]
      .filter(p => p.status === 'open')
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month),
    [periods]
  );

  const selectedYearMonths = useMemo((): Set<string> | null => {
    if (selectedPeriodIds.size === 0) return null;
    const ym = new Set<string>();
    periods.filter(p => selectedPeriodIds.has(p.id)).forEach(p => ym.add(`${p.year}-${p.month}`));
    return ym;
  }, [selectedPeriodIds, periods]);

  const clearAllFilters = () => {
    setSelectedPeriodIds(new Set());
    setSelectedProjectId(null);
    setSelectedCostCenterId(null);
  };

  // ── Derived data ─────────────────────────────────────────────────────────────

  const ccNameToId = useMemo(() => {
    const m = new Map<string, string>();
    allRawData.forEach(r => { if (r.cost_center_id && r.cost_center_name) m.set(r.cost_center_name, r.cost_center_id); });
    return m;
  }, [allRawData]);

  const projectOptions = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    allRawData.forEach(r => {
      if (!seen.has(r.project_id)) {
        seen.add(r.project_id);
        result.push({ id: r.project_id, name: r.project_name });
      }
    });
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [allRawData]);

  const costCenterOptions = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    allRawData.forEach(r => {
      if (r.cost_center_id && !seen.has(r.cost_center_id)) {
        seen.add(r.cost_center_id);
        result.push({ id: r.cost_center_id, name: r.cost_center_name ?? '' });
      }
    });
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [allRawData]);

  const filteredData = useMemo(() => {
    let d = allRawData;
    if (selectedYearMonths) d = d.filter(r => selectedYearMonths.has(`${r.year}-${r.month}`));
    if (selectedProjectId) d = d.filter(r => r.project_id === selectedProjectId);
    if (selectedCostCenterId) d = d.filter(r => r.cost_center_id === selectedCostCenterId);
    return d;
  }, [allRawData, selectedYearMonths, selectedProjectId, selectedCostCenterId]);

  const sortedMonths = useMemo(() => {
    const map = new Map<string, { year: number; month: number }>();
    filteredData.forEach(r => map.set(`${r.year}-${r.month}`, { year: r.year, month: r.month }));
    return Array.from(map.values()).sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
  }, [filteredData]);

  // KPIs — oop/equipment in raw cents, planned/actual in DKK
  const kpis = useMemo(() => ({
    planned: filteredData.reduce((s, r) => s + r.demand_cost, 0),
    actual: filteredData.reduce((s, r) => s + r.actuals_cost, 0),
    oop: filteredData.reduce((s, r) => s + r.externals_cost, 0),
    equipment: filteredData.reduce((s, r) => s + r.equipment_cost, 0),
  }), [filteredData]);

  // Previous period KPIs for delta (same N months immediately before selected range)
  const prevKpis = useMemo(() => {
    if (selectedPeriodIds.size === 0) return null;
    const selPeriods = periods.filter(p => selectedPeriodIds.has(p.id));
    if (selPeriods.length === 0) return null;
    const count = selPeriods.length;
    const first = selPeriods[0];
    const prevIds: string[] = [];
    for (let i = count; i >= 1; i--) {
      let m = first.month - i, y = first.year;
      while (m <= 0) { m += 12; y--; }
      prevIds.push(`${y}-${m}`);
    }
    let prev = allRawData.filter(r => prevIds.includes(`${r.year}-${r.month}`));
    if (selectedProjectId) prev = prev.filter(r => r.project_id === selectedProjectId);
    if (selectedCostCenterId) prev = prev.filter(r => r.cost_center_id === selectedCostCenterId);
    if (prev.length === 0) return null;
    return {
      planned: prev.reduce((s, r) => s + r.demand_cost, 0),
      actual: prev.reduce((s, r) => s + r.actuals_cost, 0),
      oop: prev.reduce((s, r) => s + r.externals_cost, 0),
      equipment: prev.reduce((s, r) => s + r.equipment_cost, 0),
    };
  }, [allRawData, selectedPeriodIds, periods, selectedProjectId, selectedCostCenterId]);

  // projectRows: total and monthlyTotals use Planned + OoP + Equipment only (not Actual)
  const projectRows = useMemo((): EntityRow[] => {
    const map = new Map<string, EntityRow>();
    filteredData.forEach(r => {
      let row = map.get(r.project_id);
      if (!row) {
        row = { id: r.project_id, name: r.project_name, planned: 0, actual: 0, oop: 0, equip: 0, total: 0, monthlyTotals: [] };
        map.set(r.project_id, row);
      }
      row.planned += r.demand_cost;
      row.actual += r.actuals_cost;
      row.oop += r.externals_cost / 100;
      row.equip += r.equipment_cost / 100;
    });
    const rows = Array.from(map.values());
    rows.forEach(row => {
      row.total = row.planned + row.oop + row.equip;
      row.monthlyTotals = sortedMonths.map(({ year, month }) =>
        filteredData
          .filter(r => r.project_id === row.id && r.year === year && r.month === month)
          .reduce((s, r) => s + r.demand_cost + r.externals_cost / 100 + r.equipment_cost / 100, 0)
      );
    });
    return rows.sort((a, b) => b.total - a.total);
  }, [filteredData, sortedMonths]);

  // ccRows: total and monthlyTotals use Planned + OoP + Equipment only (not Actual)
  const ccRows = useMemo((): EntityRow[] => {
    const map = new Map<string, EntityRow>();
    filteredData.filter(r => r.cost_center_name != null && r.cost_center_name !== 'Unassigned').forEach(r => {
      const name = r.cost_center_name ?? 'Unassigned';
      let row = map.get(name);
      if (!row) {
        row = { id: name, name, planned: 0, actual: 0, oop: 0, equip: 0, total: 0, monthlyTotals: [] };
        map.set(name, row);
      }
      row.planned += r.demand_cost;
      row.actual += r.actuals_cost;
      row.oop += r.externals_cost / 100;
      row.equip += r.equipment_cost / 100;
    });
    const rows = Array.from(map.values());
    rows.forEach(row => {
      row.total = row.planned + row.oop + row.equip;
      row.monthlyTotals = sortedMonths.map(({ year, month }) =>
        filteredData
          .filter(r => (r.cost_center_name ?? 'Unassigned') === row.name && r.year === year && r.month === month)
          .reduce((s, r) => s + r.demand_cost + r.externals_cost / 100 + r.equipment_cost / 100, 0)
      );
    });
    return rows.sort((a, b) => b.total - a.total);
  }, [filteredData, sortedMonths]);

  // Heatmap: top 10 CCs × months matrix
  const heatmapMatrix = useMemo(() => {
    const top10 = ccRows.slice(0, 10);
    const cells = new Map<string, number>();
    let globalMax = 0;
    top10.forEach(row => {
      sortedMonths.forEach(({ year, month }) => {
        const val = filteredData
          .filter(r => (r.cost_center_name ?? 'Unassigned') === row.name && r.year === year && r.month === month)
          .reduce((s, r) => s + r.demand_cost + r.actuals_cost + r.externals_cost / 100 + r.equipment_cost / 100, 0);
        cells.set(`${row.name}::${year}-${month}`, val);
        if (val > globalMax) globalMax = val;
      });
    });
    return { top10, cells, globalMax };
  }, [ccRows, filteredData, sortedMonths]);

  const hasLockedSelected = useMemo(
    () => selectedPeriodIds.size > 0 && periods.some(p => selectedPeriodIds.has(p.id) && p.status !== 'open'),
    [selectedPeriodIds, periods]
  );

  const periodRangeLabel = useMemo(() => {
    if (selectedPeriodIds.size === 0) return 'All periods';
    const selPeriods = periods
      .filter(p => selectedPeriodIds.has(p.id))
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
    if (selPeriods.length === 0) return 'All periods';
    if (selPeriods.length === 1) return `${MONTH_NAMES[selPeriods[0].month - 1]} ${selPeriods[0].year}`;
    const first = selPeriods[0], last = selPeriods[selPeriods.length - 1];
    return `${MONTH_SHORT[first.month - 1]} ${first.year} – ${MONTH_SHORT[last.month - 1]} ${last.year}`;
  }, [selectedPeriodIds, periods]);

  // ── Modal ─────────────────────────────────────────────────────────────────────

  const buildMonthlyBuckets = useCallback((filter: (r: ConsolidatedCostRow) => boolean): MonthlyBucket[] =>
    sortedMonths.map(({ year, month }) => {
      const matches = filteredData.filter(r => filter(r) && r.year === year && r.month === month);
      return {
        year, month,
        planned: matches.reduce((s, r) => s + r.demand_cost, 0),
        actual: matches.reduce((s, r) => s + r.actuals_cost, 0),
        oop: matches.reduce((s, r) => s + r.externals_cost / 100, 0),
        equip: matches.reduce((s, r) => s + r.equipment_cost / 100, 0),
      };
    }),
  [filteredData, sortedMonths]);

  const closeDrawer = useCallback(() => {
    setDrawerVisible(false);
    setTimeout(() => { setDrawer(null); setDrawerDetail(null); }, 200);
  }, []);

  const togglePeriod = useCallback((key: string) => {
    setCollapsedPeriods(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const openDrawerFor = useCallback((
    mode: 'project' | 'cc',
    row: EntityRow,
    targetYear?: number,
    targetMonth?: number,
  ) => {
    const filter = mode === 'project'
      ? (r: ConsolidatedCostRow) => r.project_id === row.id
      : (r: ConsolidatedCostRow) => (r.cost_center_name ?? 'Unassigned') === row.name;

    const entityData = filteredData.filter(filter);
    const latest = entityData
      .filter(r => targetYear === undefined || (r.year === targetYear && r.month === targetMonth))
      .sort((a, b) => a.year !== b.year ? b.year - a.year : b.month - a.month)[0]
      ?? entityData.sort((a, b) => a.year !== b.year ? b.year - a.year : b.month - a.month)[0];
    if (!latest) return;

    const year = targetYear ?? latest.year;
    const month = targetMonth ?? latest.month;

    const drawerTitle = mode === 'cc' && groupBy === 'code' ? `CC ${row.name}` : row.name;
    setDrawer({
      mode, title: drawerTitle, id: row.id, year, month,
      monthlyData: buildMonthlyBuckets(filter),
      kpis: { planned: row.planned, actual: row.actual, oop: row.oop, equip: row.equip },
    });
    setDrawerTab('bymonth');
    setDrawerDetail(null);
    setCollapsedPeriods(new Set());
    requestAnimationFrame(() => setDrawerVisible(true));

    let baseParams: Record<string, string | number> | null = null;
    if (mode === 'project') {
      baseParams = { project_id: row.id };
    } else if (groupBy === 'code') {
      // row.id is the CC code; use cost_center_code so the backend aggregates all family members.
      baseParams = { cost_center_code: row.id };
    } else {
      const ccId = ccNameToId.get(row.name);
      if (ccId) baseParams = { cost_center_id: ccId };
    }

    if (baseParams) {
      setDrawerLoading(true);
      const detailParams = targetYear !== undefined
        ? { ...baseParams, year: targetYear, month: targetMonth! }
        : { ...baseParams };

      getConsolidatedCostDetail(detailParams)
        .then(details => {
          if (details.length === 0) { setDrawerDetail(null); return; }
          setDrawerDetail(details);
        }).catch(() => setDrawerDetail(null)).finally(() => setDrawerLoading(false));
    }
  }, [filteredData, buildMonthlyBuckets, ccNameToId, groupBy]);

  // ── CSV export ────────────────────────────────────────────────────────────────

  const downloadDrillDownCsv = () => {
    if (!drawerDetail || !drawer) return;
    const esc = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const isCc = drawer.mode === 'cc';
    const periodLabel = `${MONTH_NAMES[drawer.month - 1]}_${drawer.year}`;
    let header: string[], rows: string[][];
    if (drawerTab === 'planned') {
      header = ['Month', ...(isCc ? ['Project'] : ['Cost Center']), 'Employee', 'FTE %', 'Cost (DKK)'];
      rows = drawerDetail.flatMap(d => {
        const monthLabel = `${MONTH_NAMES[d.month - 1]} ${d.year}`;
        return d.demand_lines.map(l => [
          monthLabel,
          isCc ? (l.project_name ?? '') : (l.cost_center_name ?? ''),
          l.resource_name,
          String(l.fte_percent),
          String(l.cost),
        ]);
      });
    } else if (drawerTab === 'actual') {
      header = ['Month', ...(isCc ? ['Project'] : ['Cost Center']), 'Employee', 'FTE %', 'Cost (DKK)'];
      rows = drawerDetail.flatMap(d => {
        const monthLabel = `${MONTH_NAMES[d.month - 1]} ${d.year}`;
        return d.actual_lines.map(l => [
          monthLabel,
          isCc ? (l.project_name ?? '') : (l.cost_center_name ?? ''),
          l.resource_name,
          String(l.fte_percent),
          String(l.cost),
        ]);
      });
    } else if (drawerTab === 'oop') {
      header = ['Month', 'OoP Resource', 'Notes', 'Total (DKK)'];
      rows = drawerDetail.flatMap(d => {
        const monthLabel = `${MONTH_NAMES[d.month - 1]} ${d.year}`;
        return d.external_lines.map(l => [monthLabel, l.resource_name ?? l.description ?? '', l.notes ?? '', String(l.total_cost / 100)]);
      });
    } else {
      header = ['Month', 'Description', 'Cost (DKK)'];
      rows = drawerDetail.flatMap(d => {
        const monthLabel = `${MONTH_NAMES[d.month - 1]} ${d.year}`;
        return d.equipment_lines.map(l => [monthLabel, l.description ?? '', String(l.cost / 100)]);
      });
    }
    const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${drawer.title}_${periodLabel}_${drawerTab}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadFullCsv = () => {
    if (!drawerDetail || !drawer) return;
    const esc = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const isCc = drawer.mode === 'cc';
    const header = isCc
      ? ['Month', 'Category', 'Employee/Line Item', 'Project', 'FTE %', 'Cost (DKK)']
      : ['Month', 'Category', 'Employee/Line Item', 'Cost Center', 'FTE %', 'Cost (DKK)'];
    const rows: string[][] = [];
    for (const d of drawerDetail) {
      const monthLabel = `${MONTH_NAMES[d.month - 1]} ${d.year}`;
      for (const l of d.demand_lines)
        rows.push([monthLabel, 'Planned', l.resource_name,
          isCc ? (l.project_name ?? '') : (l.cost_center_name ?? ''),
          String(l.fte_percent), String(l.cost)]);
      for (const l of d.actual_lines)
        rows.push([monthLabel, 'Actual', l.resource_name,
          isCc ? (l.project_name ?? '') : (l.cost_center_name ?? ''),
          String(l.fte_percent), String(l.cost)]);
      if (drawer.mode !== 'cc') {
        for (const l of d.external_lines)
          rows.push([monthLabel, 'OoP', l.resource_name ?? l.description ?? '', '', '', String(l.total_cost / 100)]);
        for (const l of d.equipment_lines)
          rows.push([monthLabel, 'Equipment', l.description ?? '', '', '', String(l.cost / 100)]);
      }
    }
    const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${drawer.title.replace(/[^a-zA-Z0-9\-_]/g, '_')}_all_periods.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render helpers ────────────────────────────────────────────────────────────

  const maxProjTotal = projectRows[0]?.total ?? 1;
  const maxCcTotal = ccRows[0]?.total ?? 1;

  const calcDelta = (curr: number, prev: number | undefined) =>
    prev && prev !== 0 ? ((curr - prev) / prev) * 100 : null;

  const label11 = { fontSize: 11, fontWeight: 600, color: C.ink4, textTransform: 'uppercase' as const, letterSpacing: '0.5px' };
  const thStyle = { padding: '8px 10px', fontWeight: 600, color: C.ink3, borderBottom: `2px solid ${C.border}`, background: '#f3f2f1' };
  const tdStyle = { padding: '8px 10px', borderBottom: `1px solid ${C.border}` };

  // ── JSX ───────────────────────────────────────────────────────────────────────

  return (

    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Sentinel for sticky shadow detection */}
      <div ref={filterSentinelRef} style={{ height: 1, marginBottom: -1 }} />

      {/* Section 2 — Filter bar */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
        boxShadow: filterBarStuck
          ? '0 4px 10px -2px rgba(0,0,0,0.14)'
          : '0 1px 4px rgba(0,0,0,0.06)',
        padding: '14px 20px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {/* Period */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label11}>Period</span>
          <PeriodPillSelector
            periods={openPeriods}
            selectedIds={selectedPeriodIds}
            onChange={setSelectedPeriodIds}
            allPeriods={periods}
            allowArchive
          />
          {hasLockedSelected && (
            <div style={{ fontSize: 11, color: C.ink3, marginTop: 2 }}>
              Includes locked period data
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end' }}>
        {/* Project */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label11}>Project</span>
          <Select value={selectedProjectId ?? ''} onChange={(_, d) => setSelectedProjectId(d.value || null)} style={{ minWidth: 160 }}>
            <option value="">All projects</option>
            {projectOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>

        {/* Cost Center */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label11}>Cost Center</span>
          <Combobox
            value={selectedCostCenterId ? (costCenterOptions.find(c => c.id === selectedCostCenterId)?.name ?? '') : ''}
            onOptionSelect={(_, d) => setSelectedCostCenterId(d.optionValue ? String(d.optionValue) : null)}
            style={{ minWidth: 160 }}
          >
            <Option key="__all" value="" text="All cost centers">All cost centers</Option>
            {costCenterOptions.map(c => <Option key={c.id} value={c.id} text={c.name}>{c.name}</Option>)}
          </Combobox>
        </div>



        <div style={{ flex: 1 }} />
        <button onClick={clearAllFilters} style={{
          fontSize: 13, padding: '5px 12px', borderRadius: 6,
          border: `1px solid ${C.border}`, background: C.surface, color: C.ink3, cursor: 'pointer',
        }}>Clear filters</button>
        </div>
      </div>

      {/* Section 3 — KPI strip (6 cards) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
        {[
          { label: 'Planned Labor', accent: C.accent, curr: kpis.planned, prev: prevKpis?.planned, display: kpis.planned },
          { label: 'Actual Labor', accent: C.planned, curr: kpis.actual, prev: prevKpis?.actual, display: kpis.actual },
          { label: 'Out-of-Pocket', accent: C.oop, curr: kpis.oop, prev: prevKpis?.oop, display: kpis.oop / 100 },
          { label: 'Equipment', accent: C.equip, curr: kpis.equipment, prev: prevKpis?.equipment, display: kpis.equipment / 100 },
          {
            label: 'Planned Total',
            accent: C.planned,
            curr: kpis.planned + kpis.oop / 100 + kpis.equipment / 100,
            prev: prevKpis ? prevKpis.planned + prevKpis.oop / 100 + prevKpis.equipment / 100 : undefined,
            display: kpis.planned + kpis.oop / 100 + kpis.equipment / 100,
          },
          {
            label: 'Actual Total',
            accent: C.actual,
            curr: kpis.actual + kpis.oop / 100 + kpis.equipment / 100,
            prev: prevKpis ? prevKpis.actual + prevKpis.oop / 100 + prevKpis.equipment / 100 : undefined,
            display: kpis.actual + kpis.oop / 100 + kpis.equipment / 100,
          },
        ].map(({ label, accent, curr, prev, display }) => {
          const d = calcDelta(curr, prev);
          return (
            <div key={label} style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', overflow: 'hidden',
            }}>
              <div style={{ width: 3, background: accent, flexShrink: 0 }} />
              <div style={{ padding: '14px 16px', flex: 1, minWidth: 0 }}>
                <div style={{ ...label11, marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: C.ink1 }}>{dkk(display)}</div>
                {d !== null && (
                  <div style={{ marginTop: 4, fontSize: 12, color: d > 0 ? C.neg : C.pos }}>
                    {d > 0 ? '▲' : '▼'} {Math.abs(d).toFixed(1)}% vs prior period
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Section 4 — Two-panel layout */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spinner label="Loading cost data…" />
        </div>
      ) : filteredData.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.ink4, fontSize: 14 }}>
          No cost data found for the selected filters.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>

          {/* Panel A — Costs by Project */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.ink1 }}>Costs by Project</div>
              <div style={{ fontSize: 12, color: C.ink4, marginTop: 2 }}>Ranked by planned total across selected period</div>
            </div>
            <div style={{ padding: 20 }}>
              {/* Legend */}
              <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
                {[{ l: 'Planned', c: C.planned }, { l: 'Actual', c: C.actual }, { l: 'OoP', c: C.oop }, { l: 'Equipment', c: C.equip }].map(s => (
                  <div key={s.l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.ink3 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: s.c }} />{s.l}
                  </div>
                ))}
              </div>

              {/* Horizontal stacked bars — top 5 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {(showAllProjects ? projectRows : projectRows.slice(0, 5)).map(row => (
                  <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 96px', gap: 8, alignItems: 'center' }}>
                    <div style={{ fontSize: 13, color: C.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.name}>{row.name}</div>
                    <div
                      style={{ height: 18, display: 'flex', borderRadius: 3, overflow: 'hidden', cursor: 'pointer', background: C.border }}
                      onClick={() => openDrawerFor('project', row)}
                      title={`Click to drill down into ${row.name}`}
                    >
                      {showPlanned && row.planned > 0 && <div style={{ flex: row.planned, background: C.planned }} />}
                      {row.actual > 0 && <div style={{ flex: row.actual, background: C.actual }} />}
                      {row.oop > 0 && <div style={{ flex: row.oop, background: C.oop }} />}
                      {row.equip > 0 && <div style={{ flex: row.equip, background: C.equip }} />}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.ink1, textAlign: 'right' }}>{dkk(row.total)}</div>
                  </div>
                ))}
                {projectRows.length > 5 && (
                  <button onClick={() => setShowAllProjects(v => !v)} style={{
                    background: 'none', border: 'none', color: C.accent, fontSize: 13, cursor: 'pointer', textAlign: 'left', padding: 0, marginTop: 2,
                  }}>
                    {showAllProjects ? 'Show fewer' : `Show all ${projectRows.length} projects`}
                  </button>
                )}
              </div>

              {/* Ranked table */}
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 72px 110px 88px 20px', gap: 8, padding: '0 6px 8px', ...label11 }}>
                  <div>#</div><div>Name</div><div>Breakdown</div><div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Planned Total</div><div style={{ textAlign: 'right' }}>Trend</div><div />
                </div>
                {projectRows.map((row, i) => (
                  <div key={row.id}
                    onClick={() => openDrawerFor('project', row)}
                    style={{ display: 'grid', gridTemplateColumns: '24px 1fr 72px 90px 88px 20px', gap: 8, padding: '7px 6px', alignItems: 'center', cursor: 'pointer', borderRadius: 6 }}
                    onMouseEnter={e => (e.currentTarget.style.background = C.rowHover)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ fontSize: 12, color: C.ink4, fontWeight: 600 }}>{i + 1}</div>
                    <div style={{ fontSize: 13, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</div>
                    <MiniBar planned={showPlanned ? row.planned : 0} actual={row.actual} oop={row.oop} equip={row.equip} max={maxProjTotal} />
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink1, textAlign: 'right' }}>{dkk(row.total)}</div>
                    <TrendCell data={row.monthlyTotals} color={C.accent} />
                    <ChevronRight20Regular style={{ color: C.ink4 }} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Panel B — Costs by Cost Center */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.ink1 }}>Costs by Cost Center</div>
              <TabList
                selectedValue={groupBy}
                onTabSelect={(_, d) => setGroupBy(d.value as 'id' | 'code')}
                appearance="subtle"
                size="small"
              >
                <Tab value="id">Department</Tab>
                <Tab value="code">CC Code</Tab>
              </TabList>
            </div>
            <div style={{ padding: 20 }}>
              {/* Heatmap */}
              {heatmapMatrix.top10.length > 0 && sortedMonths.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.ink4, marginBottom: 8 }}>Monthly Heatmap</div>
                  <div style={{ display: 'grid', gridTemplateColumns: `130px repeat(${sortedMonths.length}, 1fr)`, gap: 2 }}>
                    <div />
                    {sortedMonths.map(m => (
                      <div key={`h-${m.year}-${m.month}`} style={{ fontSize: 10, color: C.ink4, textAlign: 'center', fontWeight: 600, paddingBottom: 3 }}>
                        {MONTH_SHORT[m.month - 1]}
                      </div>
                    ))}
                    {heatmapMatrix.top10.map(row => (
                      <React.Fragment key={row.name}>
                        <div style={{ fontSize: 12, color: C.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '22px' }} title={row.name}>{row.name}</div>
                        {sortedMonths.map(m => {
                          const val = heatmapMatrix.cells.get(`${row.name}::${m.year}-${m.month}`) ?? 0;
                          const intensity = heatmapMatrix.globalMax > 0 ? val / heatmapMatrix.globalMax : 0;
                          return (
                            <div
                              key={`${m.year}-${m.month}`}
                              title={`${row.name} · ${MONTH_SHORT[m.month - 1]} ${m.year}: ${dkk(val)}`}
                              onClick={() => val > 0 && openDrawerFor('cc', row, m.year, m.month)}
                              style={{
                                height: 22, borderRadius: 2,
                                cursor: val > 0 ? 'pointer' : 'default',
                                background: val > 0 ? `rgba(15,108,189,${(0.1 + intensity * 0.85).toFixed(2)})` : '#f0efee',
                              }}
                              onMouseEnter={e => { if (val > 0) (e.currentTarget as HTMLElement).style.outline = `2px solid ${C.accent}`; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.outline = 'none'; }}
                            />
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 11, color: C.ink4 }}>
                    <span>Low</span>
                    <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'linear-gradient(to right, rgba(15,108,189,0.1), rgba(15,108,189,0.95))' }} />
                    <span>High</span>
                  </div>
                </div>
              )}

              {/* Ranked CC table */}
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 72px 110px 88px 20px', gap: 8, padding: '0 6px 8px', ...label11 }}>
                  <div>#</div><div>Name</div><div>Breakdown</div><div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Planned Total</div><div style={{ textAlign: 'right' }}>Trend</div><div />
                </div>
                {ccRows.map((row, i) => (
                  <div key={row.id}
                    onClick={() => openDrawerFor('cc', row)}
                    style={{ display: 'grid', gridTemplateColumns: '24px 1fr 72px 90px 88px 20px', gap: 8, padding: '7px 6px', alignItems: 'center', cursor: 'pointer', borderRadius: 6 }}
                    onMouseEnter={e => (e.currentTarget.style.background = C.rowHover)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ fontSize: 12, color: C.ink4, fontWeight: 600 }}>{i + 1}</div>
                    <div style={{ fontSize: 13, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</div>
                    <MiniBar planned={showPlanned ? row.planned : 0} actual={row.actual} oop={row.oop} equip={row.equip} max={maxCcTotal} />
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink1, textAlign: 'right' }}>{dkk(row.total)}</div>
                    <TrendCell data={row.monthlyTotals} color={C.planned} />
                    <ChevronRight20Regular style={{ color: C.ink4 }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Section 5 — Centered modal drill-down */}
      {drawer && (
        <>
          {/* Backdrop */}
          <div
            onClick={closeDrawer}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.40)', zIndex: 1000,
              opacity: drawerVisible ? 1 : 0,
              transition: 'opacity 0.2s ease',
              cursor: 'pointer',
            }}
          />

          {/* Modal box — centered, 900px wide, 80vh tall */}
          <div style={{
            position: 'fixed',
            top: '50%', left: '50%',
            transform: `translate(-50%, -50%) scale(${drawerVisible ? 1 : 0.96})`,
            opacity: drawerVisible ? 1 : 0,
            transition: 'opacity 0.2s ease, transform 0.2s ease',
            width: 900,
            maxWidth: 'calc(100vw - 40px)',
            height: '80vh',
            background: C.surface,
            zIndex: 1001,
            borderRadius: 10,
            boxShadow: '0 8px 48px rgba(0,0,0,0.22)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* Modal header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.ink1 }}>{drawer.title}</div>
                  <div style={{ fontSize: 12, color: C.ink4, marginTop: 3 }}>
                    {drawer.mode === 'project' ? 'Project' : 'Cost center'} drilldown · {periodRangeLabel}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button onClick={closeDrawer} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: C.ink3, display: 'flex' }}>
                    <Dismiss20Regular />
                  </button>
                </div>
              </div>
              {/* KPI strip */}
              <div style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginTop: 14 }}>
                {(drawer.mode === 'cc' ? [
                  { label: 'Planned', val: drawer.kpis.planned },
                  { label: 'Actual', val: drawer.kpis.actual },
                ] : [
                  { label: 'Planned', val: drawer.kpis.planned },
                  { label: 'Actual', val: drawer.kpis.actual },
                  { label: 'OoP', val: drawer.kpis.oop },
                  { label: 'Equipment', val: drawer.kpis.equip },
                  { label: 'Planned Total', val: drawer.kpis.planned + drawer.kpis.oop + drawer.kpis.equip },
                  { label: 'Actual Total', val: drawer.kpis.actual + drawer.kpis.oop + drawer.kpis.equip },
                ]).map((k, i, arr) => (
                  <div key={k.label} style={{ flex: 1, padding: '10px 10px', borderRight: i < arr.length - 1 ? `1px solid ${C.border}` : 'none', background: i >= arr.length - 2 ? C.bg : C.surface }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: C.ink4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{k.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.ink1, marginTop: 3 }}>{dkk(k.val)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal tabs */}
            <div style={{ padding: '0 24px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <TabList selectedValue={drawerTab} onTabSelect={(_, d) => setDrawerTab(d.value as typeof drawerTab)}>
                <Tab value="bymonth">By month</Tab>
                <Tab value="planned">Planned ({drawerDetail ? drawerDetail.reduce((s, d) => s + d.demand_lines.length, 0) : '…'})</Tab>
                <Tab value="actual">Actual ({drawerDetail ? drawerDetail.reduce((s, d) => s + d.actual_lines.length, 0) : '…'})</Tab>
                {drawer.mode !== 'cc' && <Tab value="oop">OoP ({drawerDetail ? drawerDetail.reduce((s, d) => s + d.external_lines.length, 0) : '…'})</Tab>}
                {drawer.mode !== 'cc' && <Tab value="equipment">Equipment ({drawerDetail ? drawerDetail.reduce((s, d) => s + d.equipment_lines.length, 0) : '…'})</Tab>}
              </TabList>
            </div>

            {/* Modal body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

              {/* By month */}
              {drawerTab === 'bymonth' && (() => {
                const isCc = drawer.mode === 'cc';
                const maxBkt = Math.max(...drawer.monthlyData.map(m => isCc ? m.planned + m.actual : m.planned + m.actual + m.oop + m.equip), 1);
                return (
                  <div>
                    {/* Stacked bar chart */}
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110, marginBottom: 20, padding: '0 2px' }}>
                      {drawer.monthlyData.map((m, i) => {
                        const total = isCc ? m.planned + m.actual : m.planned + m.actual + m.oop + m.equip;
                        const hPct = (total / maxBkt) * 100;
                        const segs = [
                          ...(showPlanned ? [{ val: m.planned, color: C.planned }] : []),
                          { val: m.actual, color: C.actual },
                          ...(!isCc ? [{ val: m.oop, color: C.oop }, { val: m.equip, color: C.equip }] : []),
                        ].filter(s => s.val > 0);
                        return (
                          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <div style={{ width: '85%', height: 100, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                              <div style={{ height: `${hPct}%`, display: 'flex', flexDirection: 'column-reverse', borderRadius: '3px 3px 0 0', overflow: 'hidden', minHeight: total > 0 ? 3 : 0 }}>
                                {segs.map((s, si) => <div key={si} style={{ flex: s.val, background: s.color }} />)}
                              </div>
                            </div>
                            <div style={{ fontSize: 10, color: C.ink4, marginTop: 4 }}>{MONTH_SHORT[m.month - 1]}</div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Monthly table */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th style={{ ...thStyle, textAlign: 'left' }}>Month</th>
                          {showPlanned && <th style={{ ...thStyle, textAlign: 'right' }}>Planned</th>}
                          <th style={{ ...thStyle, textAlign: 'right' }}>Actual</th>
                          {!isCc && <th style={{ ...thStyle, textAlign: 'right' }}>OoP</th>}
                          {!isCc && <th style={{ ...thStyle, textAlign: 'right' }}>Equipment</th>}
                          {!isCc && <th style={{ ...thStyle, textAlign: 'right' }}>Planned Total</th>}
                          {!isCc && <th style={{ ...thStyle, textAlign: 'right' }}>Actual Total</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {drawer.monthlyData.map((m, i) => (
                          <tr key={i} onMouseEnter={e => (e.currentTarget.style.background = C.rowHover)} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                            <td style={{ ...tdStyle, color: C.ink2 }}>{MONTH_NAMES[m.month - 1]} {m.year}</td>
                            {showPlanned && <td style={{ ...tdStyle, textAlign: 'right', color: C.ink2 }}>{dkk(m.planned)}</td>}
                            <td style={{ ...tdStyle, textAlign: 'right', color: C.ink2 }}>{dkk(m.actual)}</td>
                            {!isCc && <td style={{ ...tdStyle, textAlign: 'right', color: C.ink2 }}>{dkk(m.oop)}</td>}
                            {!isCc && <td style={{ ...tdStyle, textAlign: 'right', color: C.ink2 }}>{dkk(m.equip)}</td>}
                            {!isCc && <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: C.ink1 }}>{dkk(m.planned + m.oop + m.equip)}</td>}
                            {!isCc && <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: C.ink1 }}>{dkk(m.actual + m.oop + m.equip)}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}

              {/* Loading state for detail tabs */}
              {drawerTab !== 'bymonth' && drawerLoading && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div>
              )}

              {/* Planned labor — grouped by period */}
              {drawerTab === 'planned' && !drawerLoading && (() => {
                if (!drawerDetail || drawerDetail.length === 0) return <div style={{ textAlign: 'center', padding: 32, color: C.ink4 }}>No detail available.</div>;
                const allLines = drawerDetail.flatMap(d => d.demand_lines);
                if (allLines.length === 0) return <div style={{ textAlign: 'center', padding: 32, color: C.ink4 }}>No planned labor for the selected period(s).</div>;
                const isCc = drawer.mode === 'cc';
                const colSpan = 4;
                const grandTotal = allLines.reduce((s, l) => s + l.cost, 0);
                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr>
                      {isCc && <th style={{ ...thStyle, textAlign: 'left' }}>Project</th>}
                      <th style={{ ...thStyle, textAlign: 'left' }}>Employee</th>
                      {!isCc && <th style={{ ...thStyle, textAlign: 'left', maxWidth: 150 }}>Cost Center</th>}
                      <th style={{ ...thStyle, textAlign: 'right' }}>FTE %</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Cost</th>
                    </tr></thead>
                    <tbody>
                      {drawerDetail.map(period => {
                        const key = `planned-${period.year}-${period.month}`;
                        const isCollapsed = collapsedPeriods.has(key);
                        const periodTotal = period.demand_lines.reduce((s, l) => s + l.cost, 0);
                        return (
                          <React.Fragment key={key}>
                            <tr style={{ background: C.periodHeader, cursor: 'pointer' }} onClick={() => togglePeriod(key)}>
                              <td colSpan={colSpan} style={{ padding: '7px 10px', fontWeight: 700, color: C.ink1, fontSize: 13 }}>
                                <span style={{ marginRight: 8, fontSize: 11 }}>{isCollapsed ? '▶' : '▼'}</span>
                                {MONTH_NAMES[period.month - 1]} {period.year}
                                <span style={{ float: 'right', fontWeight: 600, color: C.ink2 }}>
                                  {period.demand_lines.length} line{period.demand_lines.length !== 1 ? 's' : ''} · {dkk(periodTotal)}
                                </span>
                              </td>
                            </tr>
                            {!isCollapsed && period.demand_lines.map((l, i) => (
                              <tr key={i}>
                                {isCc && <td style={{ ...tdStyle, color: C.ink3 }}>{l.project_name ?? '—'}</td>}
                                <td style={{ ...tdStyle, color: C.ink1 }}>{l.resource_name}</td>
                                {!isCc && (
                                  <td style={{ ...tdStyle, color: C.ink3, fontSize: 12, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {l.cost_center_name ?? '—'}
                                  </td>
                                )}
                                <td style={{ ...tdStyle, textAlign: 'right' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                                    <div style={{ width: 50, height: 5, borderRadius: 3, background: C.plannedSoft, overflow: 'hidden' }}>
                                      <div style={{ width: `${Math.min(100, l.fte_percent)}%`, height: '100%', background: C.planned }} />
                                    </div>
                                    <span style={{ color: C.ink2 }}>{l.fte_percent}%</span>
                                  </div>
                                </td>
                                <td style={{ ...tdStyle, textAlign: 'right', color: C.ink1 }}>{dkkD(l.cost)}</td>
                              </tr>
                            ))}
                            {!isCollapsed && period.demand_lines.length > 0 && (
                              <tr style={{ background: C.bg, fontWeight: 600 }}>
                                {isCc && <td style={{ padding: '6px 10px' }} />}
                                <td style={{ padding: '6px 10px', color: C.ink2 }}>Period subtotal</td>
                                {!isCc && <td />}
                                <td />
                                <td style={{ padding: '6px 10px', textAlign: 'right', color: C.ink1 }}>{dkk(periodTotal)}</td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      <tr style={{ background: C.bg, fontWeight: 700 }}>
                        {isCc && <td style={{ padding: '8px 10px' }} />}
                        <td style={{ padding: '8px 10px', color: C.ink1 }}>Total</td>
                        {!isCc && <td />}
                        <td />
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: C.ink1 }}>{dkk(grandTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()}

              {/* Actual labor — grouped by period */}
              {drawerTab === 'actual' && !drawerLoading && (() => {
                if (!drawerDetail || drawerDetail.length === 0) return <div style={{ textAlign: 'center', padding: 32, color: C.ink4 }}>No detail available.</div>;
                const allLines = drawerDetail.flatMap(d => d.actual_lines);
                if (allLines.length === 0) return <div style={{ textAlign: 'center', padding: 32, color: C.ink4 }}>No actuals booked for the selected period(s) yet.</div>;
                const isCc = drawer.mode === 'cc';
                const colSpan = 4;
                const grandTotal = allLines.reduce((s, l) => s + l.cost, 0);
                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr>
                      {isCc && <th style={{ ...thStyle, textAlign: 'left' }}>Project</th>}
                      <th style={{ ...thStyle, textAlign: 'left' }}>Employee</th>
                      {!isCc && <th style={{ ...thStyle, textAlign: 'left', maxWidth: 150 }}>Cost Center</th>}
                      <th style={{ ...thStyle, textAlign: 'right' }}>FTE %</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Cost</th>
                    </tr></thead>
                    <tbody>
                      {drawerDetail.map(period => {
                        const key = `actual-${period.year}-${period.month}`;
                        const isCollapsed = collapsedPeriods.has(key);
                        const periodTotal = period.actual_lines.reduce((s, l) => s + l.cost, 0);
                        return (
                          <React.Fragment key={key}>
                            <tr style={{ background: C.periodHeader, cursor: 'pointer' }} onClick={() => togglePeriod(key)}>
                              <td colSpan={colSpan} style={{ padding: '7px 10px', fontWeight: 700, color: C.ink1, fontSize: 13 }}>
                                <span style={{ marginRight: 8, fontSize: 11 }}>{isCollapsed ? '▶' : '▼'}</span>
                                {MONTH_NAMES[period.month - 1]} {period.year}
                                <span style={{ float: 'right', fontWeight: 600, color: C.ink2 }}>
                                  {period.actual_lines.length} line{period.actual_lines.length !== 1 ? 's' : ''} · {dkk(periodTotal)}
                                </span>
                              </td>
                            </tr>
                            {!isCollapsed && period.actual_lines.map((l, i) => (
                              <tr key={i}>
                                {isCc && <td style={{ ...tdStyle, color: C.ink3 }}>{l.project_name ?? '—'}</td>}
                                <td style={{ ...tdStyle, color: C.ink1 }}>{l.resource_name}</td>
                                {!isCc && (
                                  <td style={{ ...tdStyle, color: C.ink3, fontSize: 12, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {l.cost_center_name ?? '—'}
                                  </td>
                                )}
                                <td style={{ ...tdStyle, textAlign: 'right' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                                    <div style={{ width: 50, height: 5, borderRadius: 3, background: C.actualSoft, overflow: 'hidden' }}>
                                      <div style={{ width: `${Math.min(100, l.fte_percent)}%`, height: '100%', background: C.actual }} />
                                    </div>
                                    <span style={{ color: C.ink2 }}>{l.fte_percent}%</span>
                                  </div>
                                </td>
                                <td style={{ ...tdStyle, textAlign: 'right', color: C.ink1 }}>{dkkD(l.cost)}</td>
                              </tr>
                            ))}
                            {!isCollapsed && period.actual_lines.length > 0 && (
                              <tr style={{ background: C.bg, fontWeight: 600 }}>
                                {isCc && <td style={{ padding: '6px 10px' }} />}
                                <td style={{ padding: '6px 10px', color: C.ink2 }}>Period subtotal</td>
                                {!isCc && <td />}
                                <td />
                                <td style={{ padding: '6px 10px', textAlign: 'right', color: C.ink1 }}>{dkk(periodTotal)}</td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      <tr style={{ background: C.bg, fontWeight: 700 }}>
                        {isCc && <td style={{ padding: '8px 10px' }} />}
                        <td style={{ padding: '8px 10px', color: C.ink1 }}>Total</td>
                        {!isCc && <td />}
                        <td />
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: C.ink1 }}>{dkk(grandTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()}

              {/* OoP — grouped by period */}
              {drawerTab === 'oop' && drawer.mode !== 'cc' && !drawerLoading && (() => {
                if (!drawerDetail || drawerDetail.length === 0) return <div style={{ textAlign: 'center', padding: 32, color: C.ink4 }}>No detail available.</div>;
                const allLines = drawerDetail.flatMap(d => d.external_lines);
                if (allLines.length === 0) return <div style={{ textAlign: 'center', padding: 32, color: C.ink4 }}>No OoP lines for the selected period(s).</div>;
                const grandTotal = allLines.reduce((s, l) => s + l.total_cost, 0) / 100;
                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Description</th>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Notes</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                    </tr></thead>
                    <tbody>
                      {drawerDetail.map(period => {
                        const key = `oop-${period.year}-${period.month}`;
                        const isCollapsed = collapsedPeriods.has(key);
                        const periodTotal = period.external_lines.reduce((s, l) => s + l.total_cost, 0) / 100;
                        return (
                          <React.Fragment key={key}>
                            <tr style={{ background: C.periodHeader, cursor: 'pointer' }} onClick={() => togglePeriod(key)}>
                              <td colSpan={3} style={{ padding: '7px 10px', fontWeight: 700, color: C.ink1, fontSize: 13 }}>
                                <span style={{ marginRight: 8, fontSize: 11 }}>{isCollapsed ? '▶' : '▼'}</span>
                                {MONTH_NAMES[period.month - 1]} {period.year}
                                <span style={{ float: 'right', fontWeight: 600, color: C.ink2 }}>
                                  {period.external_lines.length} line{period.external_lines.length !== 1 ? 's' : ''} · {dkk(periodTotal)}
                                </span>
                              </td>
                            </tr>
                            {!isCollapsed && period.external_lines.map((l, i) => (
                              <tr key={i}>
                                <td style={{ ...tdStyle, color: C.ink1 }}>{l.resource_name ?? l.description ?? '—'}</td>
                                <td style={{ ...tdStyle, color: C.ink3 }}>{l.notes ?? '—'}</td>
                                <td style={{ ...tdStyle, textAlign: 'right', color: C.ink1 }}>{dkk(l.total_cost / 100)}</td>
                              </tr>
                            ))}
                            {!isCollapsed && period.external_lines.length > 0 && (
                              <tr style={{ background: C.bg, fontWeight: 600 }}>
                                <td style={{ padding: '6px 10px', color: C.ink2 }}>Period subtotal</td>
                                <td />
                                <td style={{ padding: '6px 10px', textAlign: 'right', color: C.ink1 }}>{dkk(periodTotal)}</td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      <tr style={{ background: C.bg, fontWeight: 700 }}>
                        <td style={{ padding: '8px 10px', color: C.ink1 }}>Total</td>
                        <td />
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: C.ink1 }}>{dkk(grandTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()}

              {/* Equipment — grouped by period */}
              {drawerTab === 'equipment' && drawer.mode !== 'cc' && !drawerLoading && (() => {
                if (!drawerDetail || drawerDetail.length === 0) return <div style={{ textAlign: 'center', padding: 32, color: C.ink4 }}>No detail available.</div>;
                const allLines = drawerDetail.flatMap(d => d.equipment_lines);
                if (allLines.length === 0) return <div style={{ textAlign: 'center', padding: 32, color: C.ink4 }}>No equipment lines for the selected period(s).</div>;
                const grandTotal = allLines.reduce((s, l) => s + l.cost, 0) / 100;
                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Item</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Cost</th>
                    </tr></thead>
                    <tbody>
                      {drawerDetail.map(period => {
                        const key = `equip-${period.year}-${period.month}`;
                        const isCollapsed = collapsedPeriods.has(key);
                        const periodTotal = period.equipment_lines.reduce((s, l) => s + l.cost, 0) / 100;
                        return (
                          <React.Fragment key={key}>
                            <tr style={{ background: C.periodHeader, cursor: 'pointer' }} onClick={() => togglePeriod(key)}>
                              <td colSpan={2} style={{ padding: '7px 10px', fontWeight: 700, color: C.ink1, fontSize: 13 }}>
                                <span style={{ marginRight: 8, fontSize: 11 }}>{isCollapsed ? '▶' : '▼'}</span>
                                {MONTH_NAMES[period.month - 1]} {period.year}
                                <span style={{ float: 'right', fontWeight: 600, color: C.ink2 }}>
                                  {period.equipment_lines.length} line{period.equipment_lines.length !== 1 ? 's' : ''} · {dkk(periodTotal)}
                                </span>
                              </td>
                            </tr>
                            {!isCollapsed && period.equipment_lines.map((l, i) => (
                              <tr key={i}>
                                <td style={{ ...tdStyle, color: C.ink1 }}>{l.description ?? '—'}</td>
                                <td style={{ ...tdStyle, textAlign: 'right', color: C.ink1 }}>{dkkD(l.cost / 100)}</td>
                              </tr>
                            ))}
                            {!isCollapsed && period.equipment_lines.length > 0 && (
                              <tr style={{ background: C.bg, fontWeight: 600 }}>
                                <td style={{ padding: '6px 10px', color: C.ink2 }}>Period subtotal</td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', color: C.ink1 }}>{dkk(periodTotal)}</td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      <tr style={{ background: C.bg, fontWeight: 700 }}>
                        <td style={{ padding: '8px 10px', color: C.ink1 }}>Total</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: C.ink1 }}>{dkk(grandTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()}
            </div>

            {/* Modal footer */}
            <div style={{ padding: '14px 24px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', flexShrink: 0, gap: 12 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {drawerDetail && drawerTab !== 'bymonth' && (
                  <button onClick={downloadDrillDownCsv} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
                    borderRadius: 6, border: `1px solid ${C.borderStrong}`, background: C.surface,
                    color: C.ink2, cursor: 'pointer', fontSize: 13,
                  }}>
                    <ArrowDownloadRegular style={{ fontSize: 16 }} /> Download CSV
                  </button>
                )}
                {drawerDetail && (
                  <button onClick={downloadFullCsv} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
                    borderRadius: 6, border: `1px solid ${C.borderStrong}`, background: C.surface,
                    color: C.ink2, cursor: 'pointer', fontSize: 13,
                  }}>
                    <ArrowDownloadRegular style={{ fontSize: 16 }} /> Export All
                  </button>
                )}
              </div>
              <button onClick={closeDrawer} style={{
                padding: '7px 22px', borderRadius: 6, border: 'none',
                background: C.accent, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              }}>Done</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
