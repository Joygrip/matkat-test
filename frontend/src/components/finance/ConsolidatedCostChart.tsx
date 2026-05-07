/**
 * ConsolidatedCostChart — Cost Overview redesign
 * API: /finance/consolidated-costs + /finance/consolidated-costs/detail
 * All demand_cost / actuals_cost are in DKK; externals_cost / equipment_cost are in cents.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Spinner, Select, Tab, TabList, Combobox, Option } from '@fluentui/react-components';
import { ChevronRight20Regular, Dismiss20Regular, ArrowDownloadRegular } from '@fluentui/react-icons';
import {
  getConsolidatedCosts,
  getConsolidatedCostDetail,
  ConsolidatedCostRow,
  ConsolidatedCostDetail,
} from '../../api/finance';
import { usePeriod } from '../../contexts/PeriodContext';
import { lookupsApi } from '../../api/lookups';
import type { Project, CostCenter } from '../../api/admin';
import type { Snapshot } from '../../api/consolidation';

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
} as const;

// ─── Constants ────────────────────────────────────────────────────────────────

const MS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MF = ['January','February','March','April','May','June','July','August','September','October','November','December'];

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
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
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

export const ConsolidatedCostChart: React.FC<Props> = ({ latestSnapshot }) => {
  const { periods, selectedPeriod } = usePeriod();

  // Data
  const [rawData, setRawData] = useState<ConsolidatedCostRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [projectOptions, setProjectOptions] = useState<Project[]>([]);
  const [costCenterOptions, setCostCenterOptions] = useState<CostCenter[]>([]);

  // Filters
  const [selectedPeriodIds, setSelectedPeriodIds] = useState<string[]>(
    () => selectedPeriod ? [`${selectedPeriod.year}-${selectedPeriod.month}`] : []
  );
  const [periodPreset, setPeriodPreset] = useState<'all' | 'first3' | 'first6' | 'custom'>(
    () => selectedPeriod ? 'custom' : 'all'
  );
  const [customStart, setCustomStart] = useState(() => selectedPeriod ? `${selectedPeriod.year}-${selectedPeriod.month}` : '');
  const [customEnd, setCustomEnd] = useState(() => selectedPeriod ? `${selectedPeriod.year}-${selectedPeriod.month}` : '');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string | null>(null);
  const [showPlanned, setShowPlanned] = useState(true);
  const [showAllProjects, setShowAllProjects] = useState(false);

  // Drawer
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerDetail, setDrawerDetail] = useState<ConsolidatedCostDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'bymonth' | 'planned' | 'actual' | 'oop' | 'equipment'>('bymonth');

  // ── Loaders ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true);
    getConsolidatedCosts()
      .then(res => setRawData(res.data))
      .catch(() => setRawData([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    lookupsApi.listProjects?.().then(setProjectOptions).catch(() => {});
    lookupsApi.listCostCenters?.().then(setCostCenterOptions).catch(() => {});
  }, []);

  useEffect(() => {
    if (!drawer) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer]);

  // ── Period helpers ────────────────────────────────────────────────────────────

  const sortedPeriods = useMemo(
    () => [...periods].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month),
    [periods]
  );

  const applyLastNPeriods = (n: number) => {
    const open = sortedPeriods.filter(p => p.status === 'open').slice(0, n);
    setSelectedPeriodIds(open.map(p => `${p.year}-${p.month}`));
  };

  const applyCustomRange = (start: string, end: string) => {
    if (!start || !end) { setSelectedPeriodIds([]); return; }
    const [sy, sm] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    const lo = Math.min(sy * 12 + sm, ey * 12 + em);
    const hi = Math.max(sy * 12 + sm, ey * 12 + em);
    setSelectedPeriodIds(
      sortedPeriods
        .filter(p => { const v = p.year * 12 + p.month; return v >= lo && v <= hi && p.status !== 'locked'; })
        .map(p => `${p.year}-${p.month}`)
    );
  };

  const clearAllFilters = () => {
    setSelectedPeriodIds([]); setPeriodPreset('all');
    setCustomStart(''); setCustomEnd('');
    setSelectedProjectId(null); setSelectedCostCenterId(null);
    setShowPlanned(true);
  };

  // ── Derived data ─────────────────────────────────────────────────────────────

  const ccNameToId = useMemo(() => {
    const m = new Map<string, string>();
    rawData.forEach(r => { if (r.cost_center_id && r.cost_center_name) m.set(r.cost_center_name, r.cost_center_id); });
    return m;
  }, [rawData]);

  const filteredData = useMemo(() => {
    let d = rawData;
    if (selectedPeriodIds.length > 0) d = d.filter(r => selectedPeriodIds.includes(`${r.year}-${r.month}`));
    if (selectedProjectId) d = d.filter(r => r.project_id === selectedProjectId);
    if (selectedCostCenterId) {
      const pids = new Set(projectOptions.filter(p => p.cost_center_id === selectedCostCenterId).map(p => p.id));
      d = d.filter(r => pids.has(r.project_id));
    }
    return d;
  }, [rawData, selectedPeriodIds, selectedProjectId, selectedCostCenterId, projectOptions]);

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
    if (selectedPeriodIds.length === 0) return null;
    const sorted = [...selectedPeriodIds].sort();
    const [fy, fm] = sorted[0].split('-').map(Number);
    const count = sorted.length;
    const prevIds: string[] = [];
    for (let i = count; i >= 1; i--) {
      let m = fm - i, y = fy;
      while (m <= 0) { m += 12; y--; }
      prevIds.push(`${y}-${m}`);
    }
    let prev = rawData.filter(r => prevIds.includes(`${r.year}-${r.month}`));
    if (selectedProjectId) prev = prev.filter(r => r.project_id === selectedProjectId);
    if (selectedCostCenterId) {
      const pids = new Set(projectOptions.filter(p => p.cost_center_id === selectedCostCenterId).map(p => p.id));
      prev = prev.filter(r => pids.has(r.project_id));
    }
    if (prev.length === 0) return null;
    return {
      planned: prev.reduce((s, r) => s + r.demand_cost, 0),
      actual: prev.reduce((s, r) => s + r.actuals_cost, 0),
      oop: prev.reduce((s, r) => s + r.externals_cost, 0),
      equipment: prev.reduce((s, r) => s + r.equipment_cost, 0),
    };
  }, [rawData, selectedPeriodIds, selectedProjectId, selectedCostCenterId, projectOptions]);

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
      row.total = row.planned + row.actual + row.oop + row.equip;
      row.monthlyTotals = sortedMonths.map(({ year, month }) =>
        filteredData
          .filter(r => r.project_id === row.id && r.year === year && r.month === month)
          .reduce((s, r) => s + r.demand_cost + r.actuals_cost + r.externals_cost / 100 + r.equipment_cost / 100, 0)
      );
    });
    return rows.sort((a, b) => b.total - a.total);
  }, [filteredData, sortedMonths]);

  const ccRows = useMemo((): EntityRow[] => {
    const map = new Map<string, EntityRow>();
    filteredData.forEach(r => {
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
      row.total = row.planned + row.actual + row.oop + row.equip;
      row.monthlyTotals = sortedMonths.map(({ year, month }) =>
        filteredData
          .filter(r => (r.cost_center_name ?? 'Unassigned') === row.name && r.year === year && r.month === month)
          .reduce((s, r) => s + r.demand_cost + r.actuals_cost + r.externals_cost / 100 + r.equipment_cost / 100, 0)
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

  const periodRangeLabel = useMemo(() => {
    if (selectedPeriodIds.length === 0) return 'All periods';
    const sorted = [...selectedPeriodIds].sort();
    const [fy, fm] = sorted[0].split('-').map(Number);
    const [ly, lm] = sorted[sorted.length - 1].split('-').map(Number);
    if (sorted.length === 1) return `${MF[fm - 1]} ${fy}`;
    return `${MS[fm - 1]} ${fy} – ${MS[lm - 1]} ${ly}`;
  }, [selectedPeriodIds]);

  // ── Drawer ────────────────────────────────────────────────────────────────────

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
    setTimeout(() => { setDrawer(null); setDrawerDetail(null); }, 300);
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

    setDrawer({
      mode, title: row.name, id: row.id, year, month,
      monthlyData: buildMonthlyBuckets(filter),
      kpis: { planned: row.planned, actual: row.actual, oop: row.oop, equip: row.equip },
    });
    setDrawerTab('bymonth');
    setDrawerDetail(null);
    requestAnimationFrame(() => setDrawerVisible(true));

    const ccId = mode === 'cc' ? ccNameToId.get(row.name) : undefined;
    if (mode === 'project' || ccId) {
      setDrawerLoading(true);
      const params = mode === 'project' ? { project_id: row.id, year, month } : { cost_center_id: ccId!, year, month };
      getConsolidatedCostDetail(params)
        .then(setDrawerDetail).catch(() => setDrawerDetail(null)).finally(() => setDrawerLoading(false));
    }
  }, [filteredData, buildMonthlyBuckets, ccNameToId]);

  // ── CSV export (preserved from original) ─────────────────────────────────────

  const downloadDrillDownCsv = () => {
    if (!drawerDetail || !drawer) return;
    const esc = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const isCc = drawer.mode === 'cc';
    const periodLabel = `${MF[drawer.month - 1]}_${drawer.year}`;
    let header: string[], rows: string[][];
    if (drawerTab === 'planned') {
      header = [...(isCc ? ['Project'] : []), 'Employee', 'FTE %', 'Cost (DKK)'];
      rows = drawerDetail.demand_lines.map(l => [...(isCc ? [l.project_name ?? ''] : []), l.resource_name, String(l.fte_percent), String(l.cost)]);
    } else if (drawerTab === 'actual') {
      header = [...(isCc ? ['Project'] : []), 'Employee', 'FTE %', 'Cost (DKK)'];
      rows = drawerDetail.actual_lines.map(l => [...(isCc ? [l.project_name ?? ''] : []), l.resource_name, String(l.fte_percent), String(l.cost)]);
    } else if (drawerTab === 'oop') {
      header = ['OoP Resource', 'Notes', 'Total (DKK)'];
      rows = drawerDetail.external_lines.map(l => [l.resource_name ?? l.description ?? '', l.notes ?? '', String(l.total_cost / 100)]);
    } else {
      header = ['Description', 'Cost (DKK)'];
      rows = drawerDetail.equipment_lines.map(l => [l.description ?? '', String(l.cost / 100)]);
    }
    const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${drawer.title}_${periodLabel}_${drawerTab}.csv`; a.click();
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

      {/* Section 1 — Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: C.ink1 }}>Cost Overview</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: C.ink3 }}>{periodRangeLabel}</p>
        </div>
        {latestSnapshot && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.ink3 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.pos, display: 'inline-block', flexShrink: 0 }} />
            Last snapshot: {new Date(latestSnapshot.published_at).toLocaleDateString('da-DK')}
          </div>
        )}
      </div>

      {/* Section 2 — Filter bar */}
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)', padding: '14px 20px',
        display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-end',
      }}>
        {/* Period */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label11}>Period</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'first3', 'first6', 'custom'] as const).map(p => (
              <button key={p} onClick={() => {
                setPeriodPreset(p);
                if (p === 'all') setSelectedPeriodIds([]);
                else if (p === 'first3') applyLastNPeriods(3);
                else if (p === 'first6') applyLastNPeriods(6);
              }} style={{
                padding: '5px 12px', fontSize: 13, borderRadius: 6,
                border: `1px solid ${periodPreset === p ? C.accent : C.borderStrong}`,
                background: periodPreset === p ? C.accent : C.surface,
                color: periodPreset === p ? '#fff' : C.ink2,
                cursor: 'pointer', fontWeight: periodPreset === p ? 600 : 400,
              }}>
                {p === 'all' ? 'All' : p === 'first3' ? 'First 3' : p === 'first6' ? 'First 6' : 'Custom'}
              </button>
            ))}
          </div>
          {periodPreset === 'custom' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <Select value={customStart} onChange={(_, d) => { const v = d.value || ''; setCustomStart(v); applyCustomRange(v, customEnd); }}>
                <option value="">From</option>
                {sortedPeriods.filter(p => p.status !== 'locked').map(p => (
                  <option key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`}>{MS[p.month - 1]} {p.year}</option>
                ))}
              </Select>
              <Select value={customEnd} onChange={(_, d) => { const v = d.value || ''; setCustomEnd(v); applyCustomRange(customStart, v); }}>
                <option value="">To</option>
                {sortedPeriods.filter(p => p.status !== 'locked').map(p => (
                  <option key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`}>{MS[p.month - 1]} {p.year}</option>
                ))}
              </Select>
            </div>
          )}
        </div>

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

        {/* Planned toggle */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label11}>Planned</span>
          <button onClick={() => setShowPlanned(v => !v)} style={{
            padding: '5px 14px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
            border: `1px solid ${showPlanned ? C.accent : C.borderStrong}`,
            background: showPlanned ? C.accentSoft : C.surface,
            color: showPlanned ? C.accent : C.ink3, fontWeight: showPlanned ? 600 : 400,
          }}>
            {showPlanned ? '● On' : 'Off'}
          </button>
        </div>

        <div style={{ flex: 1 }} />
        <button onClick={clearAllFilters} style={{
          fontSize: 13, padding: '5px 12px', borderRadius: 6,
          border: `1px solid ${C.border}`, background: C.surface, color: C.ink3, cursor: 'pointer',
        }}>Clear filters</button>
      </div>

      {/* Section 3 — KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Planned Labor', accent: C.accent, curr: kpis.planned, prev: prevKpis?.planned, display: kpis.planned },
          { label: 'Actual Labor', accent: C.planned, curr: kpis.actual, prev: prevKpis?.actual, display: kpis.actual },
          { label: 'Out-of-Pocket', accent: C.oop, curr: kpis.oop, prev: prevKpis?.oop, display: kpis.oop / 100 },
          { label: 'Equipment', accent: C.equip, curr: kpis.equipment, prev: prevKpis?.equipment, display: kpis.equipment / 100 },
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
              <div style={{ fontSize: 12, color: C.ink4, marginTop: 2 }}>Ranked by total cost across selected period</div>
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
                <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 72px 90px 88px 20px', gap: 8, padding: '0 6px 8px', ...label11 }}>
                  <div>#</div><div>Name</div><div>Breakdown</div><div style={{ textAlign: 'right' }}>Total</div><div>Trend</div><div />
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
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.ink1 }}>Costs by Cost Center</div>
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
                        {MS[m.month - 1]}
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
                              title={`${row.name} · ${MS[m.month - 1]} ${m.year}: ${dkk(val)}`}
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
                <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 72px 90px 88px 20px', gap: 8, padding: '0 6px 8px', ...label11 }}>
                  <div>#</div><div>Name</div><div>Breakdown</div><div style={{ textAlign: 'right' }}>Total</div><div>Trend</div><div />
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

      {/* Section 5 — Drill-down drawer */}
      {drawer && (
        <>
          <div
            onClick={closeDrawer}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000,
              opacity: drawerVisible ? 1 : 0, transition: 'opacity 0.25s ease', cursor: 'pointer',
            }}
          />
          <div style={{
            position: 'fixed', right: 0, top: 0, bottom: 0, width: 560,
            background: C.surface, zIndex: 1001,
            boxShadow: '-4px 0 32px rgba(0,0,0,0.18)',
            transform: drawerVisible ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* Drawer header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.ink1 }}>{drawer.title}</div>
                  <div style={{ fontSize: 12, color: C.ink4, marginTop: 3 }}>
                    {drawer.mode === 'project' ? 'Project' : 'Cost center'} drilldown · {periodRangeLabel}
                  </div>
                </div>
                <button onClick={closeDrawer} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: C.ink3, display: 'flex' }}>
                  <Dismiss20Regular />
                </button>
              </div>
              {/* KPI strip */}
              <div style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginTop: 14 }}>
                {[
                  { label: 'Planned', val: drawer.kpis.planned },
                  { label: 'Actual', val: drawer.kpis.actual },
                  { label: 'OoP', val: drawer.kpis.oop },
                  { label: 'Equipment', val: drawer.kpis.equip },
                  { label: 'Total', val: drawer.kpis.planned + drawer.kpis.actual + drawer.kpis.oop + drawer.kpis.equip },
                ].map((k, i, arr) => (
                  <div key={k.label} style={{ flex: 1, padding: '10px 10px', borderRight: i < arr.length - 1 ? `1px solid ${C.border}` : 'none', background: i === arr.length - 1 ? C.bg : C.surface }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: C.ink4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{k.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.ink1, marginTop: 3 }}>{dkk(k.val)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Drawer tabs */}
            <div style={{ padding: '0 24px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <TabList selectedValue={drawerTab} onTabSelect={(_, d) => setDrawerTab(d.value as typeof drawerTab)}>
                <Tab value="bymonth">By month</Tab>
                <Tab value="planned">Planned ({drawerDetail?.demand_lines.length ?? '…'})</Tab>
                <Tab value="actual">Actual ({drawerDetail?.actual_lines.length ?? '…'})</Tab>
                {drawer.mode !== 'cc' && <Tab value="oop">OoP ({drawerDetail?.external_lines.length ?? '…'})</Tab>}
                {drawer.mode !== 'cc' && <Tab value="equipment">Equipment ({drawerDetail?.equipment_lines.length ?? '…'})</Tab>}
              </TabList>
            </div>

            {/* Drawer body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

              {/* By month */}
              {drawerTab === 'bymonth' && (() => {
                const maxBkt = Math.max(...drawer.monthlyData.map(m => m.planned + m.actual + m.oop + m.equip), 1);
                return (
                  <div>
                    {/* Stacked bar chart */}
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110, marginBottom: 20, padding: '0 2px' }}>
                      {drawer.monthlyData.map((m, i) => {
                        const total = m.planned + m.actual + m.oop + m.equip;
                        const hPct = (total / maxBkt) * 100;
                        const segs = [
                          ...(showPlanned ? [{ val: m.planned, color: C.planned }] : []),
                          { val: m.actual, color: C.actual },
                          { val: m.oop, color: C.oop },
                          { val: m.equip, color: C.equip },
                        ].filter(s => s.val > 0);
                        return (
                          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <div style={{ width: '85%', height: 100, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                              <div style={{ height: `${hPct}%`, display: 'flex', flexDirection: 'column-reverse', borderRadius: '3px 3px 0 0', overflow: 'hidden', minHeight: total > 0 ? 3 : 0 }}>
                                {segs.map((s, si) => <div key={si} style={{ flex: s.val, background: s.color }} />)}
                              </div>
                            </div>
                            <div style={{ fontSize: 10, color: C.ink4, marginTop: 4 }}>{MS[m.month - 1]}</div>
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
                          <th style={{ ...thStyle, textAlign: 'right' }}>OoP</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Equipment</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drawer.monthlyData.map((m, i) => (
                          <tr key={i} onMouseEnter={e => (e.currentTarget.style.background = C.rowHover)} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                            <td style={{ ...tdStyle, color: C.ink2 }}>{MF[m.month - 1]} {m.year}</td>
                            {showPlanned && <td style={{ ...tdStyle, textAlign: 'right', color: C.ink2 }}>{dkk(m.planned)}</td>}
                            <td style={{ ...tdStyle, textAlign: 'right', color: C.ink2 }}>{dkk(m.actual)}</td>
                            <td style={{ ...tdStyle, textAlign: 'right', color: C.ink2 }}>{dkk(m.oop)}</td>
                            <td style={{ ...tdStyle, textAlign: 'right', color: C.ink2 }}>{dkk(m.equip)}</td>
                            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: C.ink1 }}>{dkk(m.planned + m.actual + m.oop + m.equip)}</td>
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

              {/* Planned labor */}
              {drawerTab === 'planned' && !drawerLoading && (() => {
                if (!drawerDetail) return <div style={{ textAlign: 'center', padding: 32, color: C.ink4 }}>No detail available. Data shown is for {MF[drawer.month - 1]} {drawer.year}.</div>;
                if (drawerDetail.demand_lines.length === 0) return <div style={{ textAlign: 'center', padding: 32, color: C.ink4 }}>No planned labor for {MF[drawer.month - 1]} {drawer.year}.</div>;
                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr>
                      {drawer.mode === 'cc' && <th style={{ ...thStyle, textAlign: 'left' }}>Project</th>}
                      <th style={{ ...thStyle, textAlign: 'left' }}>Employee</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>FTE %</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Cost</th>
                    </tr></thead>
                    <tbody>
                      {drawerDetail.demand_lines.map((l, i) => (
                        <tr key={i}>
                          {drawer.mode === 'cc' && <td style={{ ...tdStyle, color: C.ink3 }}>{l.project_name ?? '—'}</td>}
                          <td style={{ ...tdStyle, color: C.ink1 }}>{l.resource_name}</td>
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
                      <tr style={{ background: C.bg, fontWeight: 700 }}>
                        {drawer.mode === 'cc' && <td style={{ padding: '8px 10px' }} />}
                        <td style={{ padding: '8px 10px', color: C.ink1 }}>Total</td>
                        <td />
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: C.ink1 }}>{dkk(drawerDetail.demand_lines.reduce((s, l) => s + l.cost, 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()}

              {/* Actual labor */}
              {drawerTab === 'actual' && !drawerLoading && (() => {
                if (!drawerDetail) return <div style={{ textAlign: 'center', padding: 32, color: C.ink4 }}>No detail available.</div>;
                if (drawerDetail.actual_lines.length === 0) return <div style={{ textAlign: 'center', padding: 32, color: C.ink4 }}>No actuals booked for {MF[drawer.month - 1]} {drawer.year} yet.</div>;
                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr>
                      {drawer.mode === 'cc' && <th style={{ ...thStyle, textAlign: 'left' }}>Project</th>}
                      <th style={{ ...thStyle, textAlign: 'left' }}>Employee</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>FTE %</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Cost</th>
                    </tr></thead>
                    <tbody>
                      {drawerDetail.actual_lines.map((l, i) => (
                        <tr key={i}>
                          {drawer.mode === 'cc' && <td style={{ ...tdStyle, color: C.ink3 }}>{l.project_name ?? '—'}</td>}
                          <td style={{ ...tdStyle, color: C.ink1 }}>{l.resource_name}</td>
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
                      <tr style={{ background: C.bg, fontWeight: 700 }}>
                        {drawer.mode === 'cc' && <td style={{ padding: '8px 10px' }} />}
                        <td style={{ padding: '8px 10px', color: C.ink1 }}>Total</td>
                        <td />
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: C.ink1 }}>{dkk(drawerDetail.actual_lines.reduce((s, l) => s + l.cost, 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()}

              {/* OoP */}
              {drawerTab === 'oop' && drawer.mode !== 'cc' && !drawerLoading && (() => {
                if (!drawerDetail) return <div style={{ textAlign: 'center', padding: 32, color: C.ink4 }}>No detail available.</div>;
                if (drawerDetail.external_lines.length === 0) return <div style={{ textAlign: 'center', padding: 32, color: C.ink4 }}>No OoP lines for {MF[drawer.month - 1]} {drawer.year}.</div>;
                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Description</th>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Notes</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                    </tr></thead>
                    <tbody>
                      {drawerDetail.external_lines.map((l, i) => (
                        <tr key={i}>
                          <td style={{ ...tdStyle, color: C.ink1 }}>{l.resource_name ?? l.description ?? '—'}</td>
                          <td style={{ ...tdStyle, color: C.ink3 }}>{l.notes ?? '—'}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', color: C.ink1 }}>{dkk(l.total_cost / 100)}</td>
                        </tr>
                      ))}
                      <tr style={{ background: C.bg, fontWeight: 700 }}>
                        <td style={{ padding: '8px 10px', color: C.ink1 }}>Total</td><td />
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: C.ink1 }}>{dkk(drawerDetail.external_lines.reduce((s, l) => s + l.total_cost, 0) / 100)}</td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()}

              {/* Equipment */}
              {drawerTab === 'equipment' && drawer.mode !== 'cc' && !drawerLoading && (() => {
                if (!drawerDetail) return <div style={{ textAlign: 'center', padding: 32, color: C.ink4 }}>No detail available.</div>;
                if (drawerDetail.equipment_lines.length === 0) return <div style={{ textAlign: 'center', padding: 32, color: C.ink4 }}>No equipment lines for {MF[drawer.month - 1]} {drawer.year}.</div>;
                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Item</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Cost</th>
                    </tr></thead>
                    <tbody>
                      {drawerDetail.equipment_lines.map((l, i) => (
                        <tr key={i}>
                          <td style={{ ...tdStyle, color: C.ink1 }}>{l.description ?? '—'}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', color: C.ink1 }}>{dkkD(l.cost / 100)}</td>
                        </tr>
                      ))}
                      <tr style={{ background: C.bg, fontWeight: 700 }}>
                        <td style={{ padding: '8px 10px', color: C.ink1 }}>Total</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: C.ink1 }}>{dkk(drawerDetail.equipment_lines.reduce((s, l) => s + l.cost, 0) / 100)}</td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()}
            </div>

            {/* Drawer footer */}
            <div style={{ padding: '14px 24px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', flexShrink: 0, gap: 12 }}>
              {drawerDetail && drawerTab !== 'bymonth' ? (
                <button onClick={downloadDrillDownCsv} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
                  borderRadius: 6, border: `1px solid ${C.borderStrong}`, background: C.surface,
                  color: C.ink2, cursor: 'pointer', fontSize: 13,
                }}>
                  <ArrowDownloadRegular style={{ fontSize: 16 }} /> Download CSV
                </button>
              ) : <div />}
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
