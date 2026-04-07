/**
 * ConsolidatedCostChart
 *
 * Grouped bar chart combining planned labor, actual labor, external contractor,
 * and equipment costs per project and cost center, filterable by period, project,
 * and cost center. Follows Dashboard's filter toolbar and chart card patterns.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Button,
  Select,
  Combobox,
  Option,
  Spinner,
  Body1,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tab,
  TabList,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
} from '@fluentui/react-components';
import {
  getConsolidatedCosts,
  getConsolidatedCostDetail,
  ConsolidatedCostRow,
  ConsolidatedCostDetail,
} from '../../api/finance';
import { usePeriod } from '../../contexts/PeriodContext';
import { lookupsApi } from '../../api/lookups';
import type { Project, CostCenter } from '../../api/admin';
import { CostGroupedBarChart } from '../CostGroupedBarChart';
import type { GroupedBarChartDatum } from '../GroupedBarChart';
import { ArrowDownloadRegular } from '@fluentui/react-icons';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const dkk = (val: number) =>
  new Intl.NumberFormat('da-DK', {
    style: 'currency',
    currency: 'DKK',
    maximumFractionDigits: 0,
  }).format(val);

const dkkDetail = (val: number) =>
  new Intl.NumberFormat('da-DK', {
    style: 'currency',
    currency: 'DKK',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },

  // Filter toolbar (mirrors Dashboard)
  filtersToolbar: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  filtersToolbarCard: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    boxShadow: tokens.shadow2,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  filtersToolbarHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
  },
  filtersToolbarTitle: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  filtersRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: tokens.spacingHorizontalM,
    alignItems: 'flex-end',
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: tokens.spacingVerticalXXS,
    minWidth: '160px',
  },
  filterLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  periodPresetRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: tokens.spacingHorizontalXS,
    marginBottom: tokens.spacingVerticalXXS,
  },
  filtersChipsRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalXXS,
  },

  // KPI strip
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: tokens.spacingHorizontalM,
  },
  kpiCard: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
  },
  kpiLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: tokens.spacingVerticalXXS,
  },
  kpiValue: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
    lineHeight: '1.2',
  },

  // Chart card (mirrors Dashboard)
  chartCard: {
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow4,
    overflow: 'hidden',
  },
  chartCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  chartCardTitle: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  chartCardBody: {
    padding: tokens.spacingHorizontalL,
  },
  chartsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
    gap: tokens.spacingHorizontalL,
  },
  emptyState: {
    padding: `${tokens.spacingVerticalXXL} 0`,
    textAlign: 'center' as const,
    color: tokens.colorNeutralForeground3,
  },
  loadingWrap: {
    display: 'flex',
    justifyContent: 'center',
    padding: tokens.spacingVerticalXXL,
  },

  // Drill-down dialog
  dialogSurface: {
    maxWidth: '860px',
    width: '90vw',
    height: '80vh',
  },
  dialogBody: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  dialogContent: {
    flex: 1,
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: tokens.spacingVerticalM,
    paddingTop: tokens.spacingVerticalS,
  },
  detailKpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: tokens.spacingHorizontalS,
  },
  detailKpiCard: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  detailKpiLabel: {
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  detailKpiValue: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
  },
  tableWrap: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    overflow: 'hidden',
    width: '100%',
  },
  tableHeaderRow: {
    backgroundColor: tokens.colorNeutralBackground3,
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
    fontWeight: tokens.fontWeightSemibold,
  },
  totalRow: {
    fontWeight: tokens.fontWeightBold,
    backgroundColor: tokens.colorNeutralBackground3,
    borderTop: `2px solid ${tokens.colorNeutralStroke2}`,
  },
});

// ─── Component ───────────────────────────────────────────────────────────────

export const ConsolidatedCostChart: React.FC = () => {
  const styles = useStyles();
  const { periods, selectedPeriod } = usePeriod();

  // Raw API data
  const [rawData, setRawData] = useState<ConsolidatedCostRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Lookups for filter dropdowns
  const [projectOptions, setProjectOptions] = useState<Project[]>([]);
  const [costCenterOptions, setCostCenterOptions] = useState<CostCenter[]>([]);

  // Filter state — default to the globally selected period so values match Project Costs
  const [selectedPeriodIds, setSelectedPeriodIds] = useState<string[]>(
    () => selectedPeriod ? [`${selectedPeriod.year}-${selectedPeriod.month}`] : []
  );
  const [periodPreset, setPeriodPreset] = useState<'all' | 'first3' | 'first6' | 'custom'>(
    () => selectedPeriod ? 'custom' : 'all'
  );
  const [customStart, setCustomStart] = useState<string>(
    () => selectedPeriod ? `${selectedPeriod.year}-${selectedPeriod.month}` : ''
  );
  const [customEnd, setCustomEnd] = useState<string>(
    () => selectedPeriod ? `${selectedPeriod.year}-${selectedPeriod.month}` : ''
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string | null>(null);

  // Planned cost visibility toggle
  const [showPlanned, setShowPlanned] = useState(true);

  // Drill-down dialog state
  const [drillDown, setDrillDown] = useState<{
    mode: 'project' | 'cc';
    title: string;
    year: number;
    month: number;
    projectId?: string;
    costCenterId?: string;
  } | null>(null);
  const [drillDownData, setDrillDownData] = useState<ConsolidatedCostDetail | null>(null);
  const [drillDownLoading, setDrillDownLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'planned' | 'actual' | 'oop' | 'equipment'>('planned');

  // Load aggregation data
  useEffect(() => {
    setLoading(true);
    getConsolidatedCosts()
      .then((res) => setRawData(res.data))
      .catch(() => setRawData([]))
      .finally(() => setLoading(false));
  }, []);

  // Load lookups for filter dropdowns
  useEffect(() => {
    lookupsApi.listProjects?.().then(setProjectOptions).catch(() => {});
    lookupsApi.listCostCenters?.().then(setCostCenterOptions).catch(() => {});
  }, []);

  // ── Period helpers ────────────────────────────────────────────────────────

  const sortedPeriods = useMemo(
    () => [...periods].sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month)),
    [periods]
  );

  const applyLastNPeriods = (n: number) => {
    const open = sortedPeriods.filter((p) => p.status === 'open').slice(0, n);
    setSelectedPeriodIds(open.map((p) => `${p.year}-${p.month}`));
  };

  const applyCustomRange = (start: string, end: string) => {
    if (!start || !end) {
      setSelectedPeriodIds([]);
      return;
    }
    const [sy, sm] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    const startVal = sy * 12 + sm;
    const endVal = ey * 12 + em;
    const lo = Math.min(startVal, endVal);
    const hi = Math.max(startVal, endVal);
    const ids = sortedPeriods
      .filter((p) => { const v = p.year * 12 + p.month; return v >= lo && v <= hi && p.status !== 'locked'; })
      .map((p) => `${p.year}-${p.month}`);
    setSelectedPeriodIds(ids);
  };

  const handlePeriodChange = (periodId: string | null) => {
    if (periodId === null) {
      setSelectedPeriodIds([]);
      setCustomStart('');
      setCustomEnd('');
      setPeriodPreset('all');
    }
  };

  const clearAllFilters = () => {
    setSelectedPeriodIds([]);
    setPeriodPreset('all');
    setCustomStart('');
    setCustomEnd('');
    setSelectedProjectId(null);
    setSelectedCostCenterId(null);
    setShowPlanned(true);
  };

  const closeDrillDown = () => {
    setDrillDown(null);
    setDrillDownData(null);
  };

  // Project bar click → open detail dialog
  const handleProjectBarClick = (entityName: string, label: string) => {
    const [monthStr, yearStr] = label.split(' ');
    const year = parseInt(yearStr, 10);
    const month = monthNames.indexOf(monthStr) + 1;
    const match = rawData.find((r) => r.project_name === entityName && r.year === year && r.month === month);
    if (!match) return;
    setDrillDown({ mode: 'project', title: entityName, year, month, projectId: match.project_id });
    setDetailTab('planned');
    setDrillDownLoading(true);
    getConsolidatedCostDetail({ project_id: match.project_id, year, month })
      .then(setDrillDownData)
      .catch(() => setDrillDownData(null))
      .finally(() => setDrillDownLoading(false));
  };

  // Cost center bar click → open detail dialog for that CC + period
  const handleCcBarClick = (entityName: string, label: string) => {
    const [monthStr, yearStr] = label.split(' ');
    const year = parseInt(yearStr, 10);
    const month = monthNames.indexOf(monthStr) + 1;
    const cc = costCenterOptions.find((c) => c.name === entityName);
    if (!cc) return;
    setDrillDown({ mode: 'cc', title: entityName, year, month, costCenterId: cc.id });
    setDetailTab('planned');
    setDrillDownLoading(true);
    getConsolidatedCostDetail({ cost_center_id: cc.id, year, month })
      .then(setDrillDownData)
      .catch(() => setDrillDownData(null))
      .finally(() => setDrillDownLoading(false));
  };

  // ── Filtered data ─────────────────────────────────────────────────────────

  const filteredData = useMemo(() => {
    let d = rawData;
    if (selectedPeriodIds.length > 0) {
      d = d.filter((r) => selectedPeriodIds.includes(`${r.year}-${r.month}`));
    }
    if (selectedProjectId) {
      d = d.filter((r) => r.project_id === selectedProjectId);
    }
    if (selectedCostCenterId) {
      const ccProjectIds = new Set(
        projectOptions.filter((p) => p.cost_center_id === selectedCostCenterId).map((p) => p.id)
      );
      d = d.filter((r) => ccProjectIds.has(r.project_id));
    }
    return d;
  }, [rawData, selectedPeriodIds, selectedProjectId, selectedCostCenterId, projectOptions]);

  // ── KPI totals ────────────────────────────────────────────────────────────

  const kpis = useMemo(
    () => ({
      planned: filteredData.reduce((s, r) => s + r.demand_cost, 0),
      actual: filteredData.reduce((s, r) => s + r.actuals_cost, 0),
      oop: filteredData.reduce((s, r) => s + r.externals_cost, 0),
      equipment: filteredData.reduce((s, r) => s + r.equipment_cost, 0),
    }),
    [filteredData]
  );

  // ── Chart data: by project ────────────────────────────────────────────────

  const { projectChartData, projectNames, projectLegendMap } = useMemo(() => {
    const periodMap = new Map<string, { year: number; month: number }>();
    const projMap = new Map<string, string>(); // id → name
    filteredData.forEach((r) => {
      periodMap.set(`${r.year}-${r.month}`, { year: r.year, month: r.month });
      projMap.set(r.project_id, r.project_name);
    });

    const data: GroupedBarChartDatum[] = Array.from(periodMap.entries())
      .sort(([a], [b]) => {
        const [ay, am] = a.split('-').map(Number);
        const [by, bm] = b.split('-').map(Number);
        return ay !== by ? ay - by : am - bm;
      })
      .map(([, { year, month }]) => {
        const row: GroupedBarChartDatum = { label: `${monthNames[month - 1]} ${year}` };
        projMap.forEach((name, id) => {
          const match = filteredData.find((r) => r.project_id === id && r.year === year && r.month === month);
          row[`${name}_planned`] = match?.demand_cost ?? 0;
          row[`${name}_actual`] = match?.actuals_cost ?? 0;
          row[`${name}_oop`] = match?.externals_cost ? match.externals_cost / 100 : 0;
          row[`${name}_equipment`] = match?.equipment_cost ? match.equipment_cost / 100 : 0;
        });
        return row;
      });

    const allNames = Array.from(projMap.values());
    const names = allNames; // No TopN filtering

    const legendMap: Record<string, string> = {};
    names.forEach((n) => {
      legendMap[`${n}_planned`] = `${n} — Planned`;
      legendMap[`${n}_actual`] = `${n} — Actual`;
      legendMap[`${n}_oop`] = `${n} — OoP`;
      legendMap[`${n}_equipment`] = `${n} — Equipment`;
    });

    return { projectChartData: data, projectNames: names, projectLegendMap: legendMap };
  }, [filteredData]);

  // ── Chart data: by cost center ────────────────────────────────────────────

  const { ccChartData, ccNames, ccLegendMap } = useMemo(() => {
    const projToCcName = new Map<string, string>();
    projectOptions.forEach((p) => {
      if (p.cost_center_id) {
        const cc = costCenterOptions.find((c) => c.id === p.cost_center_id);
        projToCcName.set(p.id, cc?.name ?? p.cost_center_id);
      }
    });

    const periodMap = new Map<string, { year: number; month: number }>();
    const ccSet = new Set<string>();
    filteredData.forEach((r) => {
      periodMap.set(`${r.year}-${r.month}`, { year: r.year, month: r.month });
      ccSet.add(projToCcName.get(r.project_id) ?? 'Unassigned');
    });

    const data: GroupedBarChartDatum[] = Array.from(periodMap.entries())
      .sort(([a], [b]) => {
        const [ay, am] = a.split('-').map(Number);
        const [by, bm] = b.split('-').map(Number);
        return ay !== by ? ay - by : am - bm;
      })
      .map(([, { year, month }]) => {
        const row: GroupedBarChartDatum = { label: `${monthNames[month - 1]} ${year}` };
        ccSet.forEach((ccName) => {
          const related = filteredData.filter((r) => {
            const rCc = projToCcName.get(r.project_id) ?? 'Unassigned';
            return rCc === ccName && r.year === year && r.month === month;
          });
          row[`${ccName}_planned`] = related.reduce((s, r) => s + r.demand_cost, 0);
          row[`${ccName}_actual`] = related.reduce((s, r) => s + r.actuals_cost, 0);
          row[`${ccName}_oop`] = related.reduce((s, r) => s + r.externals_cost, 0) / 100;
          row[`${ccName}_equipment`] = related.reduce((s, r) => s + r.equipment_cost, 0) / 100;
        });
        return row;
      });

    const names = Array.from(ccSet);
    const legendMap: Record<string, string> = {};
    names.forEach((n) => {
      legendMap[`${n}_planned`] = `${n} — Planned`;
      legendMap[`${n}_actual`] = `${n} — Actual`;
      legendMap[`${n}_oop`] = `${n} — OoP`;
      legendMap[`${n}_equipment`] = `${n} — Equipment`;
    });

    return { ccChartData: data, ccNames: names, ccLegendMap: legendMap };
  }, [filteredData, projectOptions, costCenterOptions]);

  // ── Active filter labels (for chips) ─────────────────────────────────────

  const activePeriodLabel = useMemo(() => {
    if (!selectedPeriodIds.length) return null;
    if (periodPreset === 'custom' && customStart && customEnd) {
      const startP = periods.find((p) => `${p.year}-${p.month}` === customStart);
      const endP = periods.find((p) => `${p.year}-${p.month}` === customEnd);
      const startLabel = startP ? `${monthNames[startP.month - 1]} ${startP.year}` : customStart;
      const endLabel = endP ? `${monthNames[endP.month - 1]} ${endP.year}` : customEnd;
      return customStart === customEnd ? startLabel : `${startLabel} – ${endLabel}`;
    }
    const id = selectedPeriodIds[0];
    const match = periods.find((p) => `${p.year}-${p.month}` === id);
    return match ? `${monthNames[match.month - 1]} ${match.year}` : id;
  }, [selectedPeriodIds, periods, periodPreset, customStart, customEnd]);

  const activeProjectLabel = useMemo(
    () => (selectedProjectId ? (projectOptions.find((p) => p.id === selectedProjectId)?.name ?? selectedProjectId) : null),
    [selectedProjectId, projectOptions]
  );

  const activeCcLabel = useMemo(
    () =>
      selectedCostCenterId
        ? (costCenterOptions.find((c) => c.id === selectedCostCenterId)?.name ?? selectedCostCenterId)
        : null,
    [selectedCostCenterId, costCenterOptions]
  );

  const hasActiveFilters = !!activePeriodLabel || !!activeProjectLabel || !!activeCcLabel;

  // ── Drill-down CSV export ─────────────────────────────────────────────────

  const downloadDrillDownCsv = () => {
    if (!drillDownData || !drillDown) return;
    const esc = (v: string | number | null | undefined) =>
      `"${String(v ?? '').replace(/"/g, '""')}"`;
    const isCc = drillDown.mode === 'cc';
    const periodLabel = `${monthNames[drillDown.month - 1]}_${drillDown.year}`;
    let header: string[];
    let rows: string[][];

    if (detailTab === 'planned') {
      header = [...(isCc ? ['Project'] : []), 'Employee', 'FTE %', 'Cost (DKK)'];
      rows = drillDownData.demand_lines.map((l) => [
        ...(isCc ? [l.project_name ?? ''] : []),
        l.resource_name, String(l.fte_percent), String(l.cost),
      ]);
    } else if (detailTab === 'actual') {
      header = [...(isCc ? ['Project'] : []), 'Employee', 'FTE %', 'Cost (DKK)'];
      rows = drillDownData.actual_lines.map((l) => [
        ...(isCc ? [l.project_name ?? ''] : []),
        l.resource_name, String(l.fte_percent), String(l.cost),
      ]);
    } else if (detailTab === 'oop') {
      header = [...(isCc ? ['Project'] : []), 'OoP Resource', 'Notes', 'Hours', 'Rate (DKK)', 'Total (DKK)'];
      rows = drillDownData.external_lines.map((l) => [
        ...(isCc ? [l.project_name ?? ''] : []),
        l.resource_name ?? l.description ?? '', l.notes ?? '',
        String(l.hours), String(l.rate), String(l.total_cost),
      ]);
    } else {
      header = [...(isCc ? ['Project'] : []), 'Description', 'Cost (DKK)'];
      rows = drillDownData.equipment_lines.map((l) => [
        ...(isCc ? [l.project_name ?? ''] : []),
        l.description ?? '', String(l.cost),
      ]);
    }

    const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${drillDown.title}_${periodLabel}_${detailTab}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllRealCostCsv = () => {
    if (!drillDownData || !drillDown) return;
    const esc = (v: string | number | null | undefined) =>
      `"${String(v ?? '').replace(/"/g, '""')}"`;
    const periodLabel = `${monthNames[drillDown.month - 1]}_${drillDown.year}`;
    const header = ['Type', 'Project', 'Resource/Description', 'Notes', 'Hours', 'Rate (DKK)', 'FTE %', 'Cost (DKK)'];
    const rows: string[][] = [
      ...drillDownData.actual_lines.map((l) => [
        'Actual Labor',
        l.project_name ?? '',
        l.resource_name ?? '',
        '',
        '',
        '',
        String(l.fte_percent),
        String(l.cost),
      ]),
      ...drillDownData.external_lines.map((l) => [
        'OoP',
        l.project_name ?? '',
        l.resource_name ?? l.description ?? '',
        l.notes ?? '',
        String(l.hours),
        String(l.rate / 100),
        '',
        String(l.total_cost / 100),
      ]),
      ...drillDownData.equipment_lines.map((l) => [
        'Equipment',
        l.project_name ?? '',
        l.description ?? '',
        '',
        '',
        '',
        '',
        String(l.cost / 100),
      ]),
    ];
    const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${drillDown.title}_${periodLabel}_all_real_cost.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.root}>
      {/* ── Filter toolbar ── */}
      <div className={styles.filtersToolbar}>
        <Card className={styles.filtersToolbarCard}>
          <div className={styles.filtersToolbarHeader}>
            <span className={styles.filtersToolbarTitle}>Filters</span>
            <Button appearance="subtle" size="small" onClick={clearAllFilters}>
              Clear filters
            </Button>
          </div>
          <div className={styles.filtersRow}>
            {/* Period */}
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>Period</span>
              <div className={styles.periodPresetRow}>
                <Button
                  size="small"
                  appearance={periodPreset === 'all' ? 'primary' : 'secondary'}
                  onClick={() => { setPeriodPreset('all'); setSelectedPeriodIds([]); }}
                >All</Button>
                <Button
                  size="small"
                  appearance={periodPreset === 'first3' ? 'primary' : 'secondary'}
                  onClick={() => { setPeriodPreset('first3'); applyLastNPeriods(3); }}
                >First 3</Button>
                <Button
                  size="small"
                  appearance={periodPreset === 'first6' ? 'primary' : 'secondary'}
                  onClick={() => { setPeriodPreset('first6'); applyLastNPeriods(6); }}
                >First 6</Button>
                <Button
                  size="small"
                  appearance={periodPreset === 'custom' ? 'primary' : 'secondary'}
                  onClick={() => setPeriodPreset('custom')}
                >Custom</Button>
              </div>
              {periodPreset === 'custom' && (
                <div style={{ display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'flex-end' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS }}>
                    <span className={styles.filterLabel}>From</span>
                    <Select
                      value={customStart}
                      onChange={(_, data) => {
                        const val = data.value || '';
                        setCustomStart(val);
                        applyCustomRange(val, customEnd);
                      }}
                    >
                      <option value="">Start</option>
                      {sortedPeriods.filter((p) => p.status !== 'locked').map((p) => (
                        <option key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`}>
                          {monthNames[p.month - 1]} {p.year}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS }}>
                    <span className={styles.filterLabel}>To</span>
                    <Select
                      value={customEnd}
                      onChange={(_, data) => {
                        const val = data.value || '';
                        setCustomEnd(val);
                        applyCustomRange(customStart, val);
                      }}
                    >
                      <option value="">End</option>
                      {sortedPeriods.filter((p) => p.status !== 'locked').map((p) => (
                        <option key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`}>
                          {monthNames[p.month - 1]} {p.year}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              )}
            </div>

            {/* Project */}
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>Project</span>
              <Select
                value={selectedProjectId ?? ''}
                onChange={(_, data) => setSelectedProjectId(data.value || null)}
                style={{ minWidth: 180 }}
              >
                <option value="">All projects</option>
                {projectOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </div>

            {/* Show Planned toggle */}
            <div className={styles.filterGroup} style={{ justifyContent: 'flex-end' }}>
              <Button
                size="small"
                appearance={showPlanned ? 'primary' : 'secondary'}
                onClick={() => setShowPlanned((v) => !v)}
              >
                {showPlanned ? 'Planned: On' : 'Planned: Off'}
              </Button>
            </div>

            {/* Cost Center */}
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>Cost Center</span>
              <Combobox
                value={selectedCostCenterId ? (costCenterOptions.find((c) => c.id === selectedCostCenterId)?.name ?? '') : ''}
                onOptionSelect={(_, data) => setSelectedCostCenterId(data.optionValue ? String(data.optionValue) : null)}
              >
                <Option key="__all" value="" text="All cost centers">All cost centers</Option>
                {costCenterOptions.map((c) => (
                  <Option key={c.id} value={c.id} text={c.name}>{c.name}</Option>
                ))}
              </Combobox>
            </div>
          </div>
        </Card>

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className={styles.filtersChipsRow}>
            {activePeriodLabel && (
              <Button appearance="outline" size="small" onClick={() => handlePeriodChange(null)}>
                {`Period: ${activePeriodLabel} ✕`}
              </Button>
            )}
            {activeProjectLabel && (
              <Button appearance="outline" size="small" onClick={() => setSelectedProjectId(null)}>
                {`Project: ${activeProjectLabel} ✕`}
              </Button>
            )}
            {activeCcLabel && (
              <Button appearance="outline" size="small" onClick={() => setSelectedCostCenterId(null)}>
                {`Cost center: ${activeCcLabel} ✕`}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── KPI strip ── */}
      <div className={styles.kpiRow}>
        {[ 
          { label: 'Total Planned Labor', value: kpis.planned, divide: false },
          { label: 'Total Actual Labor', value: kpis.actual, divide: false },
          { label: 'Total OoP', value: kpis.oop, divide: true },
          { label: 'Total Equipment', value: kpis.equipment, divide: true },
        ].map(({ label, value, divide }) => (
          <div key={label} className={styles.kpiCard}>
            <div className={styles.kpiLabel}>{label}</div>
            <div className={styles.kpiValue}>{dkk(divide ? value / 100 : value)}</div>
          </div>
        ))}
      </div>

      {/* ── Charts ── */}
      {loading ? (
        <div className={styles.loadingWrap}>
          <Spinner label="Loading cost data…" />
        </div>
      ) : filteredData.length === 0 ? (
        <div className={styles.emptyState}>
          <Body1>No cost data found for the selected filters.</Body1>
        </div>
      ) : (
        <div className={styles.chartsGrid}>
          {/* By project — click a bar to open detail dialog */}
          <div className={styles.chartCard}>
            <div className={styles.chartCardHeader}>
              <span className={styles.chartCardTitle}>Costs by Project</span>
              <Body1 style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                Click a bar to drill down
              </Body1>
            </div>
            <div className={styles.chartCardBody}>
              <CostGroupedBarChart
                data={projectChartData}
                entityNames={projectNames}
                legendMap={projectLegendMap}
                onBarClick={handleProjectBarClick}
                hiddenCategories={showPlanned ? [] : ['planned']}
              />
            </div>
          </div>

          {/* By cost center — click a bar to drill down into that CC's costs */}
          <div className={styles.chartCard}>
            <div className={styles.chartCardHeader}>
              <span className={styles.chartCardTitle}>Costs by Cost Center</span>
              <Body1 style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                Click a bar to drill down
              </Body1>
            </div>
            <div className={styles.chartCardBody}>
              {ccNames.length > 0 ? (
                <CostGroupedBarChart
                  data={ccChartData}
                  entityNames={ccNames}
                  legendMap={ccLegendMap}
                  onBarClick={handleCcBarClick}
                  hiddenCategories={showPlanned ? ['oop', 'equipment'] : ['planned', 'oop', 'equipment']}
                />
              ) : (
                <div className={styles.emptyState}>
                  <Body1>No cost center mapping found. Ensure projects are assigned to cost centers.</Body1>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Drill-down dialog ── */}
      <Dialog open={!!drillDown} onOpenChange={(_, d) => { if (!d.open) closeDrillDown(); }}>
        <DialogSurface className={styles.dialogSurface}>
          <DialogBody className={styles.dialogBody}>
            <DialogTitle>
              {drillDown?.title} — {monthNames[(drillDown?.month ?? 1) - 1]} {drillDown?.year}
            </DialogTitle>
            <DialogContent className={styles.dialogContent}>
              {drillDownLoading ? (
                <div className={styles.loadingWrap}>
                  <Spinner label="Loading details…" />
                </div>
              ) : drillDownData ? (
                <>
                  {/* Detail KPI strip */}
                  <div className={styles.detailKpiRow}>
                    {(() => {
                      const actualTotal = drillDownData.actual_lines.reduce((s, l) => s + l.cost, 0);
                      const oopTotal = drillDownData.external_lines.reduce((s, l) => s + l.total_cost, 0) / 100;
                      const equipTotal = drillDownData.equipment_lines.reduce((s, l) => s + l.cost, 0) / 100;
                      return [
                        { label: 'Planned Labor', value: drillDownData.demand_lines.reduce((s, l) => s + l.cost, 0) },
                        { label: 'Actual Labor', value: actualTotal },
                        { label: 'OoP', value: oopTotal },
                        { label: 'Equipment', value: equipTotal },
                        { label: 'Total Cost', value: actualTotal + oopTotal + equipTotal },
                      ].map(({ label, value }) => (
                        <div key={label} className={styles.detailKpiCard}>
                          <div className={styles.detailKpiLabel}>{label}</div>
                          <div className={styles.detailKpiValue}>{dkk(value)}</div>
                        </div>
                      ));
                    })()}
                  </div>

                  {/* Tab navigation */}
                  <TabList
                    value={detailTab}
                    onTabSelect={(_, d) => setDetailTab(d.value as typeof detailTab)}
                  >
                    <Tab value="planned">Planned Labor ({drillDownData.demand_lines.length})</Tab>
                    <Tab value="actual">Actual Labor ({drillDownData.actual_lines.length})</Tab>
                    <Tab value="oop">OoP ({drillDownData.external_lines.length})</Tab>
                    <Tab value="equipment">Equipment ({drillDownData.equipment_lines.length})</Tab>
                  </TabList>

                  {/* Planned Labor table */}
                  {detailTab === 'planned' && (
                    drillDownData.demand_lines.length === 0 ? (
                      <div className={styles.emptyState}><Body1>No planned labor lines for this period.</Body1></div>
                    ) : (
                      <div className={styles.tableWrap}>
                        <Table size="small">
                          <TableHeader>
                            <TableRow className={styles.tableHeaderRow}>
                              {drillDown?.mode === 'cc' && <TableHeaderCell style={{ flex: '0 0 180px' }}>Project</TableHeaderCell>}
                              <TableHeaderCell style={{ flex: '1 1 auto' }}>Employee</TableHeaderCell>
                              <TableHeaderCell style={{ flex: '0 0 80px', justifyContent: 'flex-end' }}>FTE %</TableHeaderCell>
                              <TableHeaderCell style={{ flex: '0 0 150px', justifyContent: 'flex-end' }}>Cost (DKK)</TableHeaderCell>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {drillDownData.demand_lines.map((l, i) => (
                              <TableRow key={i}>
                                {drillDown?.mode === 'cc' && <TableCell style={{ flex: '0 0 180px' }}>{l.project_name ?? '—'}</TableCell>}
                                <TableCell style={{ flex: '1 1 auto' }}>{l.resource_name}</TableCell>
                                <TableCell style={{ flex: '0 0 80px', justifyContent: 'flex-end' }}>{l.fte_percent}%</TableCell>
                                <TableCell style={{ flex: '0 0 150px', justifyContent: 'flex-end' }}>{dkkDetail(l.cost)}</TableCell>
                              </TableRow>
                            ))}
                            <TableRow className={styles.totalRow}>
                              {drillDown?.mode === 'cc' && <TableCell style={{ flex: '0 0 180px' }} />}
                              <TableCell style={{ flex: '1 1 auto' }}>Total</TableCell>
                              <TableCell style={{ flex: '0 0 80px' }} />
                              <TableCell style={{ flex: '0 0 150px', justifyContent: 'flex-end' }}>
                                {dkk(drillDownData.demand_lines.reduce((s, l) => s + l.cost, 0))}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    )
                  )}

                  {/* Actual Labor table */}
                  {detailTab === 'actual' && (
                    drillDownData.actual_lines.length === 0 ? (
                      <div className={styles.emptyState}><Body1>No actual labor lines for this period.</Body1></div>
                    ) : (
                      <div className={styles.tableWrap}>
                        <Table size="small">
                          <TableHeader>
                            <TableRow className={styles.tableHeaderRow}>
                              {drillDown?.mode === 'cc' && <TableHeaderCell style={{ flex: '0 0 180px' }}>Project</TableHeaderCell>}
                              <TableHeaderCell style={{ flex: '1 1 auto' }}>Employee</TableHeaderCell>
                              <TableHeaderCell style={{ flex: '0 0 80px', justifyContent: 'flex-end' }}>FTE %</TableHeaderCell>
                              <TableHeaderCell style={{ flex: '0 0 150px', justifyContent: 'flex-end' }}>Cost (DKK)</TableHeaderCell>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {drillDownData.actual_lines.map((l, i) => (
                              <TableRow key={i}>
                                {drillDown?.mode === 'cc' && <TableCell style={{ flex: '0 0 180px' }}>{l.project_name ?? '—'}</TableCell>}
                                <TableCell style={{ flex: '1 1 auto' }}>{l.resource_name}</TableCell>
                                <TableCell style={{ flex: '0 0 80px', justifyContent: 'flex-end' }}>{l.fte_percent}%</TableCell>
                                <TableCell style={{ flex: '0 0 150px', justifyContent: 'flex-end' }}>{dkkDetail(l.cost)}</TableCell>
                              </TableRow>
                            ))}
                            <TableRow className={styles.totalRow}>
                              {drillDown?.mode === 'cc' && <TableCell style={{ flex: '0 0 180px' }} />}
                              <TableCell style={{ flex: '1 1 auto' }}>Total</TableCell>
                              <TableCell style={{ flex: '0 0 80px' }} />
                              <TableCell style={{ flex: '0 0 150px', justifyContent: 'flex-end' }}>
                                {dkk(drillDownData.actual_lines.reduce((s, l) => s + l.cost, 0))}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    )
                  )}

                  {/* Externals table */}
                  {detailTab === 'oop' && (
                    drillDownData.external_lines.length === 0 ? (
                      <div className={styles.emptyState}><Body1>No OoP lines for this period.</Body1></div>
                    ) : (
                      <div className={styles.tableWrap}>
                        <Table size="small">
                          <TableHeader>
                            <TableRow className={styles.tableHeaderRow}>
                              {drillDown?.mode === 'cc' && <TableHeaderCell style={{ flex: '0 0 160px' }}>Project</TableHeaderCell>}
                              <TableHeaderCell style={{ flex: '1 1 auto' }}>OoP Resource</TableHeaderCell>
                              <TableHeaderCell style={{ flex: '1 1 auto' }}>Notes</TableHeaderCell>
                              <TableHeaderCell style={{ flex: '0 0 70px', justifyContent: 'flex-end' }}>Hours</TableHeaderCell>
                              <TableHeaderCell style={{ flex: '0 0 130px', justifyContent: 'flex-end' }}>Rate (DKK/hr)</TableHeaderCell>
                              <TableHeaderCell style={{ flex: '0 0 150px', justifyContent: 'flex-end' }}>Total (DKK)</TableHeaderCell>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {drillDownData.external_lines.map((l, i) => (
                              <TableRow key={i}>
                                {drillDown?.mode === 'cc' && <TableCell style={{ flex: '0 0 160px' }}>{l.project_name ?? '—'}</TableCell>}
                                <TableCell style={{ flex: '1 1 auto' }}>{l.resource_name ?? l.description ?? '—'}</TableCell>
                                <TableCell style={{ flex: '1 1 auto' }}>{l.notes ?? '—'}</TableCell>
                                <TableCell style={{ flex: '0 0 70px', justifyContent: 'flex-end' }}>{l.hours}</TableCell>
                                <TableCell style={{ flex: '0 0 130px', justifyContent: 'flex-end' }}>{dkkDetail(l.rate / 100)}</TableCell>
                                <TableCell style={{ flex: '0 0 150px', justifyContent: 'flex-end' }}>{dkk(l.total_cost / 100)}</TableCell>
                              </TableRow>
                            ))}
                            <TableRow className={styles.totalRow}>
                              {drillDown?.mode === 'cc' && <TableCell style={{ flex: '0 0 160px' }} />}
                              <TableCell style={{ flex: '1 1 auto' }}>Total</TableCell>
                              <TableCell style={{ flex: '1 1 auto' }} /><TableCell style={{ flex: '0 0 70px' }} /><TableCell style={{ flex: '0 0 130px' }} />
                              <TableCell style={{ flex: '0 0 150px', justifyContent: 'flex-end' }}>
                                {dkk(drillDownData.external_lines.reduce((s, l) => s + l.total_cost, 0) / 100)}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    )
                  )}

                  {/* Equipment table */}
                  {detailTab === 'equipment' && (
                    drillDownData.equipment_lines.length === 0 ? (
                      <div className={styles.emptyState}><Body1>No equipment lines for this period.</Body1></div>
                    ) : (
                      <div className={styles.tableWrap}>
                        <Table size="small">
                          <TableHeader>
                            <TableRow className={styles.tableHeaderRow}>
                              {drillDown?.mode === 'cc' && <TableHeaderCell style={{ flex: '0 0 180px' }}>Project</TableHeaderCell>}
                              <TableHeaderCell style={{ flex: '1 1 auto' }}>Description</TableHeaderCell>
                              <TableHeaderCell style={{ flex: '0 0 150px', justifyContent: 'flex-end' }}>Cost (DKK)</TableHeaderCell>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {drillDownData.equipment_lines.map((l, i) => (
                              <TableRow key={i}>
                                {drillDown?.mode === 'cc' && <TableCell style={{ flex: '0 0 180px' }}>{l.project_name ?? '—'}</TableCell>}
                                <TableCell style={{ flex: '1 1 auto' }}>{l.description ?? '—'}</TableCell>
                                <TableCell style={{ flex: '0 0 150px', justifyContent: 'flex-end' }}>{dkkDetail(l.cost / 100)}</TableCell>
                              </TableRow>
                            ))}
                            <TableRow className={styles.totalRow}>
                              {drillDown?.mode === 'cc' && <TableCell style={{ flex: '0 0 180px' }} />}
                              <TableCell style={{ flex: '1 1 auto' }}>Total</TableCell>
                              <TableCell style={{ flex: '0 0 150px', justifyContent: 'flex-end' }}>
                                {dkk(drillDownData.equipment_lines.reduce((s, l) => s + l.cost, 0) / 100)}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    )
                  )}
                </>
              ) : (
                <div className={styles.emptyState}><Body1>No detail data available.</Body1></div>
              )}
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                icon={<ArrowDownloadRegular />}
                onClick={downloadDrillDownCsv}
                disabled={!drillDownData || drillDownLoading}
              >
                Download CSV
              </Button>
              <Button
                appearance="secondary"
                icon={<ArrowDownloadRegular />}
                onClick={downloadAllRealCostCsv}
                disabled={!drillDownData || drillDownLoading}
              >
                Download All Real Cost CSV
              </Button>
              <Button onClick={closeDrillDown}>Close</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
};
