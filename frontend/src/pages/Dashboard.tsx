/**
 * Role-based Dashboard
 * All roles see KPI stats + breakdown charts.
 * Admin additionally sees System panels at the bottom.
 */
import { useEffect, useState, useMemo } from 'react';
import {
  makeStyles,
  tokens,
  Title3,
  Badge,
  Body1,
  Card,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
  Skeleton,
  SkeletonItem,
  Button,
  Select,
  Combobox,
  Option,
} from '@fluentui/react-components';
import {
  BuildingRegular,
  ShieldCheckmarkRegular,
} from '@fluentui/react-icons';
import { useAuth } from '../auth/AuthProvider';
import { apiClient } from '../api/client';
import { HealthResponse } from '../types';
import { dashboardApi, DemandSupplyByCostCenter, DemandSupplyByProject } from '../api/dashboard';
import { usePeriod } from '../contexts/PeriodContext';
import { periodsApi } from '../api/periods';
import { lookupsApi } from '../api/lookups';
import { adminApi } from '../api/admin';
import type { Period } from '../types';
import type { CostCenter, Project } from '../api/admin';
import { GroupedBarChart } from '../components/GroupedBarChart';

/* ─── Styles ────────────────────────────────────────────────────── */

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    maxWidth: '1400px',
    margin: '0 auto',
  },
  /* ── Section separators ── */
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    paddingTop: tokens.spacingVerticalM,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  sectionTitle: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },

  /* ── Chart filters toolbar ── */
  filtersToolbar: {
    position: 'sticky',
    top: tokens.spacingVerticalM,
    zIndex: 1,
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
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  filtersToolbarRows: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
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

  /* ── KPI row (5 columns) ── */
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
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
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: tokens.spacingVerticalXXS,
  },
  kpiValue: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
    lineHeight: '1.2',
  },
  kpiMeta: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    marginTop: tokens.spacingVerticalXXS,
  },
  kpiCardClickable: {
    cursor: 'pointer',
    transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
    '&:hover': {
      boxShadow: tokens.shadow8,
    },
    '&:focus-visible': {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '2px',
    },
  },
  kpiCardViewDetails: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalS,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorBrandForeground1,
  },
  kpiDetailTableWrap: {
    maxHeight: '320px',
    overflow: 'auto',
    marginTop: tokens.spacingVerticalM,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  kpiDetailDefinition: {
    marginBottom: tokens.spacingVerticalS,
    color: tokens.colorNeutralForeground2,
  },
  kpiDetailFormula: {
    marginBottom: tokens.spacingVerticalM,
    fontFamily: 'monospace',
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground3,
  },
  kpiDetailPeriod: {
    marginBottom: tokens.spacingVerticalM,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  kpiDetailSummaryRow: {
    fontWeight: tokens.fontWeightSemibold,
    backgroundColor: tokens.colorNeutralBackground3,
  },

  /* ── Charts ── */
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
  chartCardBody: {
    padding: tokens.spacingHorizontalL,
  },
  chartCardHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    gap: tokens.spacingHorizontalM,
  },
  chartModalSurface: {
    maxWidth: '90vw',
    width: '90vw',
    height: '80vh',
  },
  chartModalBody: {
    overflow: 'auto',
    padding: tokens.spacingHorizontalL,
  },
  chartsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
    gap: tokens.spacingHorizontalL,
  },

  /* ── Admin ── */
  adminSection: {
    marginTop: tokens.spacingVerticalXS,
  },
  adminCard: {
    padding: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalM,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow2,
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalS} 0`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    '&:last-child': {
      borderBottom: 'none',
    },
  },
  label: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  value: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  permissionList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalS,
  },

  /* ── Skeletons ── */
  skeletonKpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalL,
  },
  skeletonCard: {
    height: '88px',
    borderRadius: '12px',
  },
  skeletonChart: {
    height: '320px',
    borderRadius: '12px',
    marginBottom: tokens.spacingVerticalL,
  },
});

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/* ─── Component ─────────────────────────────────────────────────── */

export function Dashboard() {
  const styles = useStyles();
  const { user } = useAuth();
  const { selectedPeriodId, loading: periodsLoading, periods } = usePeriod();

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [aggLoading, setAggLoading] = useState(false);
  const [aggByCostCenter, setAggByCostCenter] = useState<DemandSupplyByCostCenter[]>([]);
  const [aggByProject, setAggByProject] = useState<DemandSupplyByProject[]>([]);

  // Filter state
  const [periodOptions, setPeriodOptions] = useState<Period[]>([]);
  const [costCenterOptions, setCostCenterOptions] = useState<CostCenter[]>([]);
  const [lookupsProjects, setLookupsProjects] = useState<Project[]>([]);
  const [selectedPeriodIds, setSelectedPeriodIds] = useState<string[]>([]);
  const [periodPreset, setPeriodPreset] = useState<'all' | 'first3' | 'first6' | 'custom'>('all');
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Cost center lookup map
  const [costCenterMap, setCostCenterMap] = useState<Record<string, string>>({});

  const isAdmin = user?.role === 'Admin';

  // Load aggregated demand/supply data for grouped bar charts
  useEffect(() => {
    setAggLoading(true);
    dashboardApi.getDemandSupplyAggregation()
      .then(({ by_project, by_cost_center }) => {
        setAggByProject(by_project);
        setAggByCostCenter(by_cost_center);
      })
      .catch(() => {
        setAggByProject([]);
        setAggByCostCenter([]);
      })
      .finally(() => setAggLoading(false));
  }, []); // Add dependencies if you want to reload on filter change

  // Sync periodOptions with periods from context
  useEffect(() => {
    setPeriodOptions(periods);
  }, [periods]);

  // Load cost center options for filter (use lookupsApi for all roles)
  useEffect(() => {
    lookupsApi.listCostCenters?.()
      .then((costCenters) => setCostCenterOptions(costCenters))
      .catch(() => setCostCenterOptions([]));
  }, []);

  // Load projects from lookups (all active projects)
  useEffect(() => {
    lookupsApi.listProjects?.()
      .then((projects) => setLookupsProjects(projects))
      .catch(() => setLookupsProjects([]));
  }, []);

  // Merge lookups projects with projects from aggregation (ensures all projects with demand/supply data are in the dropdown)
  const projectOptions = useMemo(() => {
    const map = new Map(lookupsProjects.map((p) => [p.id, p]));
    aggByProject.forEach((row) => {
      if (row.project_id && !map.has(row.project_id)) {
        map.set(row.project_id, {
          id: row.project_id,
          name: row.project_name || row.project_id,
          code: '',
          tenant_id: '',
          cost_center_id: null,
          pm_user_ids: [],
          is_active: true,
          created_at: '',
          updated_at: '',
        } as Project);
      }
    });
    return Array.from(map.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [lookupsProjects, aggByProject]);

  // Load cost center lookup map (fallback to empty on error)
  useEffect(() => {
    lookupsApi.listCostCenters?.()
      .then((costCenters) => {
        const map: Record<string, string> = {};
        costCenters.forEach((c) => { map[c.id] = c.name; });
        setCostCenterMap(map);
      })
      .catch(() => setCostCenterMap({}));
  }, []);

  const sortedPeriods = useMemo(() => {
    return [...periodOptions].sort((a, b) => {
      if (a.year === b.year) {
        return a.month - b.month;
      }
      return a.year - b.year;
    });
  }, [periodOptions]);

  const applyLastNPeriods = (n: number) => {
    if (!sortedPeriods.length) {
      setSelectedPeriodIds([]);
      return;
    }
    const openPeriods = sortedPeriods.filter(p => p.status === 'open');
    const slice = openPeriods.slice(0, n);
    setSelectedPeriodIds(slice.map(p => `${p.year}-${p.month}`));
  };

  // Filter handlers
  const handlePeriodChange = (periodId: string | null) => {
    if (periodId) {
      setSelectedPeriodIds([periodId]);
      setPeriodPreset('custom');
    } else {
      setSelectedPeriodIds([]);
      setPeriodPreset('all');
    }
  };
  const handleCostCenterChange = (costCenterId: string | null) => {
    setSelectedCostCenterId(costCenterId);
    setIsUpdating(true);
  };
  const handleProjectChange = (projectId: string | null) => {
    setSelectedProjectId(projectId);
    setIsUpdating(true);
  };

  // Mark updates as complete after filters have been applied to data
  useEffect(() => {
    if (!isUpdating) return;
    const timeout = window.setTimeout(() => {
      setIsUpdating(false);
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [isUpdating, selectedPeriodIds, selectedProjectId, selectedCostCenterId, aggByProject, aggByCostCenter]);

  // Build chart data: group by period, columns for each project's demand/supply
  const chartData = useMemo(() => {
    if (!aggByProject.length) return [];
    // Get all unique periods and projects
    const periodMap = new Map<string, { year: number; month: number }>();
    const projectMap = new Map<string, string>();
    aggByProject.forEach(row => {
      periodMap.set(`${row.year}-${row.month}`, { year: row.year, month: row.month });
      projectMap.set(row.project_id, row.project_name || row.project_id);
    });
    // Build a row for each period
    const data: any[] = Array.from(periodMap.entries()).map(([key, { year, month }]) => {
      const row: any = { label: `${monthNames[month - 1]} ${year}` };
      projectMap.forEach((projectName, projectId) => {
        // Find the matching agg row
        const agg = aggByProject.find(r => r.year === year && r.month === month && r.project_id === projectId);
        row[`${projectName}_demand`] = agg ? agg.demand_fte : 0;
        row[`${projectName}_supply`] = agg ? agg.supply_fte : 0;
      });
      return row;
    });
    return data;
  }, [aggByProject, monthNames]);

  // Build keys and legend map for all projects
  const projectNames = useMemo(() => {
    const names = new Set<string>();
    aggByProject.forEach(row => names.add(row.project_name || row.project_id));
    return Array.from(names);
  }, [aggByProject]);

  const demandKeys = useMemo(() => projectNames.map(name => `${name}_demand`), [projectNames]);
  const supplyKeys = useMemo(() => projectNames.map(name => `${name}_supply`), [projectNames]);

  const legendMap: Record<string, string> = {};
  projectNames.forEach((name) => {
    legendMap[`${name}_demand`] = `${name} Demand`;
    legendMap[`${name}_supply`] = `${name} Supply`;
  });

  // Build chart data: group by period, columns for each department's demand/supply
  const deptChartData = useMemo(() => {
    if (!aggByCostCenter.length) return [];
    // Get all unique periods and departments
    const periodMap = new Map<string, { year: number; month: number }>();
    const deptMap = new Map<string, string>();
    aggByCostCenter.forEach(row => {
      periodMap.set(`${row.year}-${row.month}`, { year: row.year, month: row.month });
      // Use cost center name from row, or lookup from costCenterMap, or fallback to ID
      deptMap.set(row.cost_center_id, row.cost_center_name || costCenterMap[row.cost_center_id] || row.cost_center_id);
    });
    // Build a row for each period
    const data: any[] = Array.from(periodMap.entries()).map(([key, { year, month }]) => {
      const row: any = { label: `${monthNames[month - 1]} ${year}` };
      deptMap.forEach((deptName, deptId) => {
        // Find the matching agg row
        const agg = aggByCostCenter.find(r => r.year === year && r.month === month && r.cost_center_id === deptId);
        row[`${deptName}_demand`] = agg ? agg.demand_fte : 0;
        row[`${deptName}_supply`] = agg ? agg.supply_fte : 0;
      });
      return row;
    });
    return data;
  }, [aggByCostCenter, monthNames, costCenterMap]);

  // Build keys and legend map for all departments
  const deptNames = useMemo(() => {
    const names = new Set<string>();
    aggByCostCenter.forEach(row => names.add(row.cost_center_name || costCenterMap[row.cost_center_id] || row.cost_center_id));
    return Array.from(names);
  }, [aggByCostCenter, costCenterMap]);

  const deptDemandKeys = useMemo(() => deptNames.map(name => `${name}_demand`), [deptNames]);
  const deptSupplyKeys = useMemo(() => deptNames.map(name => `${name}_supply`), [deptNames]);

  const deptLegendMap: Record<string, string> = {};
  deptNames.forEach((name) => {
    deptLegendMap[`${name}_demand`] = `${name} Demand`;
    deptLegendMap[`${name}_supply`] = `${name} Supply`;
  });

  // Active filter labels for chips
  const activePeriodLabel = useMemo(() => {
    if (!selectedPeriodIds.length) return null;
    const id = selectedPeriodIds[0];
    const match = periodOptions.find(p => `${p.year}-${p.month}` === id);
    if (!match) return id;
    return `${monthNames[match.month - 1]} ${match.year}`;
  }, [selectedPeriodIds, periodOptions]);

  const activeProjectLabel = useMemo(() => {
    if (!selectedProjectId) return null;
    const match = projectOptions.find(p => p.id === selectedProjectId);
    return match?.name || selectedProjectId;
  }, [selectedProjectId, projectOptions]);

  const activeCostCenterLabel = useMemo(() => {
    if (!selectedCostCenterId) return null;
    const match = costCenterOptions.find(c => c.id === selectedCostCenterId);
    return match?.name || selectedCostCenterId;
  }, [selectedCostCenterId, costCenterOptions]);

  const hasActiveFilters =
    !!activePeriodLabel || !!activeProjectLabel || !!activeCostCenterLabel;

  // Filtered chart data for GroupedBarChart (Projects)
  const filteredChartData = useMemo(() => {
    let filtered = aggByProject;
    if (selectedPeriodIds.length > 0) {
      filtered = filtered.filter(row => selectedPeriodIds.includes(`${row.year}-${row.month}`));
    }
    if (selectedProjectId) {
      filtered = filtered.filter(row => row.project_id === selectedProjectId);
    }
    // Build chart data as before
    const periodMap = new Map<string, { year: number; month: number }>();
    const projectMap = new Map<string, string>();
    filtered.forEach(row => {
      periodMap.set(`${row.year}-${row.month}`, { year: row.year, month: row.month });
      projectMap.set(row.project_id, row.project_name || row.project_id);
    });
    const data: any[] = Array.from(periodMap.entries()).map(([key, { year, month }]) => {
      const row: any = { label: `${monthNames[month - 1]} ${year}` };
      projectMap.forEach((projectName, projectId) => {
        const agg = filtered.find(r => r.year === year && r.month === month && r.project_id === projectId);
        row[`${projectName}_demand`] = agg ? agg.demand_fte : 0;
        row[`${projectName}_supply`] = agg ? agg.supply_fte : 0;
      });
      return row;
    });
    return data;
  }, [aggByProject, selectedPeriodIds, selectedProjectId, monthNames]);

  // Filtered chart data for GroupedBarChart (Departments)
  const filteredDeptChartData = useMemo(() => {
    let filtered = aggByCostCenter;
    if (selectedPeriodIds.length > 0) {
      filtered = filtered.filter(row => selectedPeriodIds.includes(`${row.year}-${row.month}`));
    }
    if (selectedCostCenterId) {
      filtered = filtered.filter(row => row.cost_center_id === selectedCostCenterId);
    }
    // Build chart data as before
    const periodMap = new Map<string, { year: number; month: number }>();
    const deptMap = new Map<string, string>();
    filtered.forEach(row => {
      periodMap.set(`${row.year}-${row.month}`, { year: row.year, month: row.month });
      deptMap.set(row.cost_center_id, row.cost_center_name || costCenterMap[row.cost_center_id] || row.cost_center_id);
    });
    const data: any[] = Array.from(periodMap.entries()).map(([key, { year, month }]) => {
      const row: any = { label: `${monthNames[month - 1]} ${year}` };
      deptMap.forEach((deptName, deptId) => {
        const agg = filtered.find(r => r.year === year && r.month === month && r.cost_center_id === deptId);
        row[`${deptName}_demand`] = agg ? agg.demand_fte : 0;
        row[`${deptName}_supply`] = agg ? agg.supply_fte : 0;
      });
      return row;
    });
    return data;
  }, [aggByCostCenter, selectedPeriodIds, selectedCostCenterId, monthNames, costCenterMap]);

  /* ── Loading skeleton ── */

  if (periodsLoading) {
    return (
      <div className={styles.container}>
        <Skeleton style={{ height: 48, marginBottom: 24, width: '40%' }}>
          <SkeletonItem />
        </Skeleton>
        <div className={styles.skeletonKpiRow}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className={styles.skeletonCard}>
              <SkeletonItem />
            </Skeleton>
          ))}
        </div>
        <Skeleton className={styles.skeletonChart}>
          <SkeletonItem />
        </Skeleton>
      </div>
    );
  }

  if (!periodsLoading && periodOptions.length === 0) {
    return (
      <div className={styles.container}>
        <div style={{ margin: '80px auto', textAlign: 'center', color: tokens.colorPaletteRedForeground1 }}>
          <Title3>No periods available</Title3>
          <p>There are no open periods configured in the system. Please contact your administrator.</p>
        </div>
      </div>
    );
  }

  /* ── Render ── */

  return (
    <div className={styles.container}>
      {/* ── Chart filters toolbar (applies to both charts below) ── */}
      <div className={styles.filtersToolbar}>
        <Card className={styles.filtersToolbarCard}>
          <div className={styles.filtersToolbarHeader}>
            <div className={styles.filtersToolbarTitle}>
              <span aria-hidden="true">Filters</span>
            </div>
            {isUpdating && !aggLoading && (
              <Body1 as="span" style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                Updating&hellip;
              </Body1>
            )}
            <Button
              appearance="subtle"
              size="small"
              onClick={() => {
                handlePeriodChange(null);
                handleProjectChange(null);
                handleCostCenterChange(null);
              }}
            >
              Clear filters
            </Button>
          </div>
          <div className={styles.filtersToolbarRows}>
            <div className={styles.filtersRow}>
              <div className={styles.filterGroup}>
                <span className={styles.filterLabel}>Period</span>
                <div className={styles.periodPresetRow}>
                  <Button
                    size="small"
                    appearance={periodPreset === 'all' ? 'primary' : 'secondary'}
                    onClick={() => {
                      setPeriodPreset('all');
                      setSelectedPeriodIds([]);
                    }}
                  >
                    All
                  </Button>
                  <Button
                    size="small"
                    appearance={periodPreset === 'first3' ? 'primary' : 'secondary'}
                    onClick={() => {
                      setPeriodPreset('first3');
                      applyLastNPeriods(3);
                    }}
                  >
                    First 3
                  </Button>
                  <Button
                    size="small"
                    appearance={periodPreset === 'first6' ? 'primary' : 'secondary'}
                    onClick={() => {
                      setPeriodPreset('first6');
                      applyLastNPeriods(6);
                    }}
                  >
                    First 6
                  </Button>
                  <Button
                    size="small"
                    appearance={periodPreset === 'custom' ? 'primary' : 'secondary'}
                    onClick={() => setPeriodPreset('custom')}
                  >
                    Custom
                  </Button>
                </div>
                {periodPreset === 'custom' && (
                  <Select
                    value={selectedPeriodIds[0] || ''}
                    onChange={(_, data) => handlePeriodChange(data.value || null)}
                  >
                    <option value="">All periods</option>
                    {periodOptions.map(p => (
                      <option key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`}>
                        {monthNames[p.month - 1]} {p.year}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
              <div className={styles.filterGroup}>
                <span className={styles.filterLabel}>Project</span>
                <Select
                  value={selectedProjectId ?? ''}
                  onChange={(_, data) => handleProjectChange(data.value ? String(data.value) : null)}
                  style={{ minWidth: 180 }}
                >
                  <option value="">All projects</option>
                  {projectOptions.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className={styles.filterGroup}>
                <span className={styles.filterLabel}>Cost Center</span>
                <Combobox
                  value={
                    selectedCostCenterId
                      ? (costCenterOptions.find(c => c.id === selectedCostCenterId)?.name ?? '')
                      : ''
                  }
                  onOptionSelect={(_, data) => {
                    const v = data.optionValue;
                    handleCostCenterChange(v ? String(v) : null);
                  }}
                >
                  <Option key="__all-cost-centers" value="" text="All cost centers">
                    All cost centers
                  </Option>
                  {costCenterOptions.map(c => (
                    <Option key={c.id} value={c.id} text={c.name}>
                      {c.name}
                    </Option>
                  ))}
                </Combobox>
              </div>
            </div>
          </div>
        </Card>
        {hasActiveFilters && (
          <div className={styles.filtersChipsRow}>
            {activePeriodLabel && (
              <Button
                appearance="outline"
                size="small"
                onClick={() => handlePeriodChange(null)}
              >
                {`Period: ${activePeriodLabel} ✕`}
              </Button>
            )}
            {activeProjectLabel && (
              <Button
                appearance="outline"
                size="small"
                onClick={() => handleProjectChange(null)}
              >
                {`Project: ${activeProjectLabel} ✕`}
              </Button>
            )}
            {activeCostCenterLabel && (
              <Button
                appearance="outline"
                size="small"
                onClick={() => handleCostCenterChange(null)}
              >
                {`Cost center: ${activeCostCenterLabel} ✕`}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Grouped Bar Chart ── */}
      <div className={styles.section}>
        <Card className={styles.chartCard}>
          <div className={styles.chartCardHeader}>
            <div className={styles.chartCardHeaderRow}>
              <Title3 style={{ margin: 0 }}>Demand & Supply by Project</Title3>
            </div>
          </div>
          <div className={styles.chartCardBody}>
            {aggLoading ? (
              <Skeleton style={{ height: 320 }}><SkeletonItem /></Skeleton>
            ) : (
              <GroupedBarChart
                data={filteredChartData}
                demandKeys={demandKeys}
                supplyKeys={supplyKeys}
                legendMap={legendMap}
              />
            )}
          </div>
        </Card>
      </div>

      {/* ── Grouped Bar Chart: Cost Centers ── */}
      <div className={styles.section}>
        <Card className={styles.chartCard}>
          <div className={styles.chartCardHeader}>
            <div className={styles.chartCardHeaderRow}>
              <Title3 style={{ margin: 0 }}>Demand & Supply by Cost Center</Title3>
            </div>
          </div>
          <div className={styles.chartCardBody}>
            {aggLoading ? (
              <Skeleton style={{ height: 320 }}><SkeletonItem /></Skeleton>
            ) : (
              <GroupedBarChart
                data={filteredDeptChartData}
                demandKeys={deptDemandKeys}
                supplyKeys={deptSupplyKeys}
                legendMap={deptLegendMap}
              />
            )}
          </div>
        </Card>
      </div>

      {/* ── Admin-Only System Panels ── */}
      {isAdmin && (
        <div className={styles.adminSection}>
          <Card className={styles.adminCard}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: tokens.spacingHorizontalM,
                marginBottom: tokens.spacingVerticalM,
              }}
            >
              <ShieldCheckmarkRegular style={{ fontSize: 24, color: tokens.colorBrandForeground1 }} />
              <Title3>System Status</Title3>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>API Status</span>
              <Badge
                appearance="filled"
                color={health?.status === 'healthy' ? 'success' : 'danger'}
              >
                {health?.status || 'Unknown'}
              </Badge>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>Version</span>
              <span className={styles.value}>{health?.version || 'N/A'}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>Environment</span>
              <Badge appearance="outline">{health?.environment || 'N/A'}</Badge>
            </div>
          </Card>

          <Card className={styles.adminCard}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: tokens.spacingHorizontalM,
                marginBottom: tokens.spacingVerticalM,
              }}
            >
              <BuildingRegular style={{ fontSize: 24, color: tokens.colorBrandForeground1 }} />
              <Title3>Tenant Information</Title3>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>Tenant ID</span>
              <span className={styles.value} style={{ fontSize: tokens.fontSizeBase200 }}>
                {user?.tenant_id}
              </span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>User Email</span>
              <span className={styles.value}>{user?.email}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>Object ID</span>
              <span className={styles.value} style={{ fontSize: tokens.fontSizeBase200 }}>
                {user?.object_id}
              </span>
            </div>
          </Card>

          <Card className={styles.adminCard}>
            <Accordion collapsible>
              <AccordionItem value="permissions">
                <AccordionHeader>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: tokens.spacingHorizontalM,
                    }}
                  >
                    <ShieldCheckmarkRegular style={{ fontSize: 20 }} />
                    <Title3>Your Permissions</Title3>
                  </div>
                </AccordionHeader>
                <AccordionPanel>
                  <div className={styles.permissionList}>
                    {user?.permissions.map((perm) => (
                      <Badge key={perm} appearance="outline" size="small">
                        {perm}
                      </Badge>
                    ))}
                  </div>
                </AccordionPanel>
              </AccordionItem>
            </Accordion>
          </Card>
        </div>
      )}
    </div>
  );
}
