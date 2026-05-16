/**
 * Supply Planning Page
 * 
 * RO/Finance: Create and edit supply lines (resource availability)
 * Admin/PM: Read-only view
 * 
 * Features: Cost center filters, grouped table
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Body1,
  Card,
  CardHeader,
  Button,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Badge,
  tokens,
  makeStyles,
  Input,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  Toolbar,
  ToolbarButton,
  TabList,
  Tab,
  Dropdown,
  Option,
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
} from '@fluentui/react-components';
import { Add24Regular, Delete24Regular, PeopleRegular, Edit24Regular, ChevronRight20Regular, ChevronDown20Regular } from '@fluentui/react-icons';
import { planningApi, SupplyLine, CreateSupplyLine } from '../api/planning';
import { usePeriod } from '../contexts/PeriodContext';
import { useAppData } from '../contexts/AppDataContext';
import { lookupsApi, Resource } from '../api/lookups';
import { useToast } from '../hooks/useToast';
import { formatApiError } from '../utils/errors';
import { MONTH_NAMES } from '../utils/format';
import { useAuth } from '../auth/AuthProvider';
import { EmptyState } from '../components/EmptyState';
import { StatusBanner } from '../components/StatusBanner';
import { SearchableFilter } from '../components/SearchableFilter';
import { SearchableMultiselect } from '../components/SearchableMultiselect';
import { LoadingState } from '../components/LoadingState';
import { ResourcePicker } from '../components/ResourcePicker';
import { periodsApi } from '../api/periods';
import { Period } from '../types';

interface SupplyBulkPreviewLine {
  resource_id: string;
  year: number;
  month: number;
  project_id?: string;
  fte_percent: number;
}

const useStyles = makeStyles({
  container: {
    padding: tokens.spacingHorizontalXXL,
    maxWidth: '1600px',
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
  filters: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    alignItems: 'center',
    marginBottom: tokens.spacingVerticalL,
    flexWrap: 'wrap' as const,
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
    fontSize: tokens.fontSizeHero600,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
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
  filterLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
  },
  card: {
    marginBottom: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    transition: 'all 0.2s ease',
    '&:hover': {
      boxShadow: tokens.shadow8,
    },
  },
  table: {
    width: '100%',
    '& thead': {
      backgroundColor: tokens.colorNeutralBackground2,
      position: 'sticky' as const,
      top: 0,
      zIndex: 1,
    },
    '& th': {
      fontWeight: tokens.fontWeightSemibold,
      fontSize: tokens.fontSizeBase300,
      color: tokens.colorNeutralForeground2,
      padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
      backgroundColor: tokens.colorNeutralBackground2,
    },
    '& td': {
      padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
      borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    },
    '& tbody tr': {
      transition: 'background-color 0.15s ease',
      '&:hover': {
        backgroundColor: tokens.colorNeutralBackground1,
      },
    },
  },
  groupHeader: {
    backgroundColor: tokens.colorNeutralBackground3,
    fontWeight: tokens.fontWeightSemibold,
    '& td': {
      padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
      borderBottom: `2px solid ${tokens.colorBrandStroke1}`,
      fontSize: tokens.fontSizeBase400,
    },
  },
  formField: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalM,
  },
  formLabel: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    marginBottom: tokens.spacingVerticalXXS,
  },
  chartCard: {
    marginBottom: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow4,
    overflow: 'hidden',
  },
  chartCardHeader: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  chartCardBody: {
    padding: tokens.spacingHorizontalL,
  },
});

interface GroupedSupplies {
  costCenterId: string | undefined;
  costCenterName: string;
  supplies: SupplyLine[];
}

function groupSuppliesByCostCenter(supplies: SupplyLine[]): GroupedSupplies[] {
  const ccMap = new Map<string, GroupedSupplies>();

  for (const s of supplies) {
    const ccKey = s.cost_center_id || '__none__';
    const ccName = s.cost_center_name || 'Unassigned';
    if (!ccMap.has(ccKey)) {
      ccMap.set(ccKey, { costCenterId: s.cost_center_id, costCenterName: ccName, supplies: [] });
    }
    ccMap.get(ccKey)!.supplies.push(s);
  }

  const result = Array.from(ccMap.values());
  result.sort((a, b) => a.costCenterName.localeCompare(b.costCenterName));
  return result;
}

export const Supply: React.FC = () => {
  const styles = useStyles();
  const { showSuccess, showApiError, showError } = useToast();
  const { user } = useAuth();
  
  const { selectedPeriodId, selectedPeriod: currentPeriod } = usePeriod();
  const { projects, costCenters } = useAppData();

  const [supplies, setSupplies] = useState<SupplyLine[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState<CreateSupplyLine>({
    period_id: '',
    resource_id: '',
    fte_percent: 100,
  });
  const [editId, setEditId] = useState<string | null>(null); // Track editing line
  
  // Bulk actions state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [bulkEditFte, setBulkEditFte] = useState<number>(100);

  // Bulk Add state (used when addMode === 'bulk')
  const [bulkAddResources, setBulkAddResources] = useState<string[]>([]);
  const [bulkAddPeriods, setBulkAddPeriods] = useState<Period[]>([]);
  const [bulkAddProjectId, setBulkAddProjectId] = useState<string>('');
  const [bulkAddFte, setBulkAddFte] = useState<number>(100);
  const [bulkAddPreview, setBulkAddPreview] = useState<SupplyBulkPreviewLine[]>([]);
  const [openPeriods, setOpenPeriods] = useState<Period[]>([]);
  const [addMode, setAddMode] = useState<'single' | 'bulk'>('single');

  type SortColumn = 'resource' | 'project' | 'period' | 'fte';
  const [sortBy, setSortBy] = useState<SortColumn>('resource');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const isLocked = currentPeriod?.status === 'locked';
  const canEdit = user?.role === 'Finance' || user?.role === 'Manager';

  const filteredSupplies = useMemo(() => {
    return supplies.filter(s => {
      if (selectedProjectId && s.project_id !== selectedProjectId) {
        return false;
      }
      if (selectedResourceId && s.resource_id !== selectedResourceId) {
        return false;
      }
      return true;
    });
  }, [supplies, selectedProjectId, selectedResourceId]);

  const groupedSupplies = useMemo(() => groupSuppliesByCostCenter(filteredSupplies), [filteredSupplies]);
  const totalColumns = canEdit ? 8 : 7;

  const activeProjectLabel = useMemo(() => {
    if (!selectedProjectId) return null;
    const project = projects.find(p => p.id === selectedProjectId);
    return project ? `Project: ${project.name}` : 'Project filter';
  }, [projects, selectedProjectId]);

  const activeResourceLabel = useMemo(() => {
    if (!selectedResourceId) return null;
    const resource = resources.find(r => r.id === selectedResourceId);
    return resource ? `Resource: ${resource.display_name}` : 'Resource filter';
  }, [resources, selectedResourceId]);

  const activeCostCenterLabel = useMemo(() => {
    if (!selectedCostCenterId) return null;
    const cc = costCenters.find(c => c.id === selectedCostCenterId);
    return cc ? `Cost center: ${cc.name}` : 'Cost center filter';
  }, [costCenters, selectedCostCenterId]);

  const hasActiveFilters = !!(activeProjectLabel || activeResourceLabel || activeCostCenterLabel);

  const totalFtePercent = useMemo(() => {
    return filteredSupplies.reduce((sum, s) => sum + (s.fte_percent ?? 0), 0);
  }, [filteredSupplies]);

  const distinctResourcesCount = useMemo(() => {
    const ids = new Set<string>();
    for (const s of filteredSupplies) {
      if (s.resource_id) ids.add(s.resource_id);
    }
    return ids.size;
  }, [filteredSupplies]);

  const distinctProjectsCount = useMemo(() => {
    const ids = new Set<string>();
    for (const s of filteredSupplies) {
      if (s.project_id) ids.add(s.project_id);
    }
    return ids.size;
  }, [filteredSupplies]);

  const sortedGroupedSupplies = useMemo(() => {
    const direction = sortDir === 'asc' ? 1 : -1;
    const compare = (a: SupplyLine, b: SupplyLine) => {
      switch (sortBy) {
        case 'resource': {
          const aName = a.resource_name || '';
          const bName = b.resource_name || '';
          return aName.localeCompare(bName) * direction;
        }
        case 'project': {
          const aName = a.project_name || '';
          const bName = b.project_name || '';
          return aName.localeCompare(bName) * direction;
        }
        case 'period': {
          const aKey = (a.year ?? 0) * 100 + (a.month ?? 0);
          const bKey = (b.year ?? 0) * 100 + (b.month ?? 0);
          return (aKey - bKey) * direction;
        }
        case 'fte': {
          const aFte = a.fte_percent ?? 0;
          const bFte = b.fte_percent ?? 0;
          return (aFte - bFte) * direction;
        }
        default:
          return 0;
      }
    };

    return groupedSupplies.map(group => ({
      ...group,
      supplies: [...group.supplies].sort(compare),
    }));
  }, [groupedSupplies, sortBy, sortDir]);
  
  useEffect(() => {
    loadInitialData();
  }, []);
  
  useEffect(() => {
    if (selectedPeriodId) {
      loadSupplies(selectedPeriodId, selectedCostCenterId || undefined);
    }
  }, [selectedPeriodId, selectedCostCenterId]);
  
  useEffect(() => {
    if (isDialogOpen && addMode === 'bulk') {
      periodsApi.list().then((periods: Period[]) => {
        setOpenPeriods(periods.filter(p => p.status === 'open'));
      });
    }
  }, [isDialogOpen, addMode]);
  
  const loadInitialData = async () => {
    try {
      setLoading(true);
      const resourcesData = await (user?.role === 'Manager'
        ? lookupsApi.listResourcesScoped()
        : lookupsApi.listResources());
      setResources(resourcesData);
    } catch (err: unknown) {
      setError(formatApiError(err, 'Failed to load data'));
    } finally {
      setLoading(false);
    }
  };
  
  const loadSupplies = async (periodId?: string, costCenterId?: string) => {
    const pid = periodId || selectedPeriodId;
    if (!pid) return;
    try {
      const data = await planningApi.getSupplyLines(pid, {
        costCenterId: costCenterId ?? (selectedCostCenterId || undefined),
      });
      setSupplies(data);
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to load supply lines');
    }
  };
  
  const handleCreate = async () => {
    if (!canEdit) {
      showError('Read-only', 'Only ROs can edit supply lines.');
      return;
    }
    if (!formData.resource_id) {
      showError('Missing resource', 'Please select a resource.');
      return;
    }
    if (!selectedPeriodId || !currentPeriod) {
      showError('Missing period', 'Please select a period.');
      return;
    }
    try {
      await planningApi.createSupplyLine({
        period_id: selectedPeriodId,
        resource_id: formData.resource_id,
        project_id: formData.project_id || undefined,
        fte_percent: formData.fte_percent,
        year: currentPeriod.year,
        month: currentPeriod.month,
      });
      showSuccess('Supply line created');
      setIsDialogOpen(false);
      loadSupplies();
      setFormData({ period_id: selectedPeriodId, resource_id: '', project_id: '', fte_percent: 100 });
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to create supply line');
    }
  };
  
  const handleEdit = (s: SupplyLine) => {
    setEditId(s.id);
    setFormData({
      period_id: s.period_id,
      resource_id: s.resource_id,
      project_id: s.project_id,
      fte_percent: s.fte_percent,
      year: s.year,
      month: s.month,
    });
    setIsDialogOpen(true);
  };
  
  const handleSaveEdit = async () => {
    if (!editId) return;
    if (!canEdit) {
      showError('Read-only', 'Only ROs can edit supply lines.');
      return;
    }
    if (!formData.resource_id) {
      showError('Missing resource', 'Please select a resource.');
      return;
    }
    if (!selectedPeriodId || !currentPeriod) {
      showError('Missing period', 'Please select a period.');
      return;
    }
    try {
      const data: Partial<CreateSupplyLine> & { id?: string } = {
        id: editId,
        resource_id: formData.resource_id,
        project_id: formData.project_id || undefined,
        fte_percent: formData.fte_percent,
        year: currentPeriod.year,
        month: currentPeriod.month,
      };
      await planningApi.updateSupplyLine(editId, data);
      showSuccess('Supply line updated');
      setIsDialogOpen(false);
      setEditId(null);
      loadSupplies();
      setFormData({ period_id: selectedPeriodId, resource_id: '', project_id: '', fte_percent: 100 });
    } catch (err) {
      showApiError(err as Error, 'Failed to update supply line');
    }
  };
  
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this supply line?')) return;
    try {
      await planningApi.deleteSupplyLine(id);
      showSuccess('Supply line deleted');
      loadSupplies();
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to delete supply line');
    }
  };
  
  const allSelected = filteredSupplies.length > 0 && selectedIds.length === filteredSupplies.length;
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : filteredSupplies.map(s => s.id));
  };
  const toggleSelect = (id: string) => {
    setSelectedIds(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  };
  
  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedIds.length} supply lines?`)) return;
    try {
      const actions = selectedIds.map(id => ({ action: 'delete' as const, data: { id } }));
      await planningApi.bulkSupplyLines({ actions, all_or_nothing: true });
      showSuccess('Bulk delete successful');
      setSelectedIds([]);
      loadSupplies();
    } catch (err) {
      showApiError(err as Error, 'Bulk delete failed');
    }
  };

  const handleBulkEdit = async () => {
    try {
      const actions = selectedIds.map(id => ({ action: 'update' as const, data: { id, fte_percent: bulkEditFte } }));
      await planningApi.bulkSupplyLines({ actions, all_or_nothing: true });
      showSuccess('Bulk edit successful');
      setSelectedIds([]);
      setIsBulkEditOpen(false);
      loadSupplies();
    } catch (err) {
      showApiError(err as Error, 'Bulk edit failed');
    }
  };

  const handleBulkAddPreview = () => {
    // Preview lines
    const preview = [];
    for (const resourceId of bulkAddResources) {
      for (const period of bulkAddPeriods) {
        preview.push({
          resource_id: resourceId,
          year: period.year,
          month: period.month,
          project_id: bulkAddProjectId || undefined,
          fte_percent: bulkAddFte,
        });
      }
    }
    setBulkAddPreview(preview);
  };

  const handleBulkAddSubmit = async () => {
    if (!canEdit || bulkAddResources.length === 0 || bulkAddPeriods.length === 0) {
      showError('Missing fields', 'Please fill all fields and preview before submitting.');
      return;
    }
    try {
      const actions = bulkAddPreview.map(line => ({ action: 'create' as const, data: line }));
      await planningApi.bulkSupplyLines({ actions, all_or_nothing: true });
      showSuccess('Bulk supply lines created');
      setIsDialogOpen(false);
      setAddMode('single');
      loadSupplies();
    } catch (err) {
      showApiError(err as Error, 'Bulk add failed');
    }
  };

  const handleSort = (column: SortColumn) => {
    setSortDir(prev => (sortBy === column && prev === 'asc' ? 'desc' : 'asc'));
    setSortBy(column);
  };

  const toggleGroupCollapsed = (groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };
  
  if (loading) {
    return <LoadingState message="Loading supply planning data..." />;
  }
  
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div style={{ display: 'flex', gap: tokens.spacingHorizontalM, alignItems: 'center', marginLeft: 'auto' }}>
          {!isLocked && canEdit && (
            <Button
              appearance="primary"
              icon={<Add24Regular />}
              onClick={() => {
                setEditId(null);
                setAddMode('single');
                setIsDialogOpen(true);
              }}
            >
              Add Supply
            </Button>
          )}
        </div>
      </div>

      {/* Filters bar - period summary + project/resource/cost center filters (searchable) */}
      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Period</span>
          <Body1>
            {currentPeriod
              ? `${MONTH_NAMES[currentPeriod.month - 1]} ${currentPeriod.year}`
              : 'No period selected'}
          </Body1>
        </div>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Project</span>
          <SearchableFilter
            options={projects.map(p => ({ id: p.id, label: p.name }))}
            value={selectedProjectId || ''}
            onChange={(id) => setSelectedProjectId(id || null)}
            placeholder="Type to search projects..."
            allLabel="All projects"
          />
        </div>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Resource</span>
          <SearchableFilter
            options={resources.map(r => ({ id: r.id, label: r.display_name }))}
            value={selectedResourceId || ''}
            onChange={(id) => setSelectedResourceId(id || null)}
            placeholder="Type to search resources..."
            allLabel="All resources"
          />
        </div>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Cost Center</span>
          <SearchableFilter
            options={costCenters.map(c => ({ id: c.id, label: c.name }))}
            value={selectedCostCenterId}
            onChange={setSelectedCostCenterId}
            placeholder="Type to search cost centers..."
            allLabel="All cost centers"
          />
        </div>
      </div>

      {hasActiveFilters && (
        <div className={styles.filtersChipsRow}>
          <div className={styles.filtersChipsList}>
            {activeProjectLabel && (
              <Button
                size="small"
                appearance="outline"
                onClick={() => setSelectedProjectId(null)}
              >
                {activeProjectLabel}
              </Button>
            )}
            {activeResourceLabel && (
              <Button
                size="small"
                appearance="outline"
                onClick={() => setSelectedResourceId(null)}
              >
                {activeResourceLabel}
              </Button>
            )}
            {activeCostCenterLabel && (
              <Button
                size="small"
                appearance="outline"
                onClick={() => setSelectedCostCenterId('')}
              >
                {activeCostCenterLabel}
              </Button>
            )}
          </div>
          <Button
            size="small"
            appearance="subtle"
            onClick={() => {
              setSelectedProjectId(null);
              setSelectedResourceId(null);
              setSelectedCostCenterId('');
            }}
          >
            Clear all
          </Button>
        </div>
      )}

      {/* KPI summary based on current filters */}
      <div className={styles.kpiRow}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Total FTE%</span>
          <span className={styles.kpiValue}>{totalFtePercent}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Distinct resources</span>
          <span className={styles.kpiValue}>{distinctResourcesCount}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Distinct projects</span>
          <span className={styles.kpiValue}>{distinctProjectsCount}</span>
        </div>
      </div>
      
      {isLocked && (
        <StatusBanner intent="warning" title="Period Locked" message="This period is locked. Editing is disabled." />
      )}
      {error && (
        <StatusBanner intent="error" title="Error" message={error} />
      )}
      
      {selectedIds.length > 0 && canEdit && (
        <Toolbar style={{ marginBottom: 16 }}>
          <ToolbarButton onClick={handleBulkDelete} icon={<Delete24Regular />}>Delete Selected</ToolbarButton>
          <ToolbarButton onClick={() => setIsBulkEditOpen(true)}>Edit FTE %</ToolbarButton>
        </Toolbar>
      )}
      
      {canEdit && (
        <Dialog open={isBulkEditOpen} onOpenChange={(_, data) => setIsBulkEditOpen(data.open)}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Bulk Edit FTE %</DialogTitle>
              <DialogContent>
                <Input
                  type="number"
                  min={5}
                  max={100}
                  step={5}
                  value={bulkEditFte}
                  onChange={e => setBulkEditFte(Number(e.target.value))}
                  style={{ width: 120 }}
                />
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setIsBulkEditOpen(false)}>Cancel</Button>
                <Button appearance="primary" onClick={handleBulkEdit}>Apply</Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      
      {/* Add / Edit Supply Dialog with Single and Bulk modes */}
      {canEdit && (
        <Drawer
          type="overlay"
          position="end"
          size="large"
          open={isDialogOpen}
          onOpenChange={(_, data) => {
            setIsDialogOpen(data.open);
            if (!data.open) {
              setEditId(null);
              setAddMode('single');
            }
          }}
        >
          <DrawerHeader>
            <DrawerHeaderTitle>
              {editId
                ? 'Edit Supply Line'
                : addMode === 'single'
                ? 'Add Supply Line'
                : 'Bulk Add Supply Lines'}
            </DrawerHeaderTitle>
          </DrawerHeader>
          <DrawerBody>
            {!editId && (
              <div style={{ marginBottom: tokens.spacingVerticalM }}>
                <TabList
                  selectedValue={addMode}
                  onTabSelect={(_, data) => setAddMode(data.value as 'single' | 'bulk')}
                >
                  <Tab value="single">Single line</Tab>
                  <Tab value="bulk">Bulk add</Tab>
                </TabList>
              </div>
            )}

            {(addMode === 'single' || editId) && (
              <>
                {currentPeriod && (
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>Period</label>
                    <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
                      {MONTH_NAMES[currentPeriod.month - 1]} {currentPeriod.year} ({currentPeriod.status})
                    </Body1>
                  </div>
                )}
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Resource *</label>
                  {resources.length === 0 && !loading ? (
                    <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
                      No resources in your reporting line. Contact your admin.
                    </Body1>
                  ) : (
                    <ResourcePicker
                      resources={resources}
                      value={formData.resource_id || ''}
                      onChange={val =>
                        setFormData(f => ({ ...f, resource_id: val }))
                      }
                      placeholder="Type name..."
                    />
                  )}
                </div>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Project (optional)</label>
                  <SearchableFilter
                    options={projects.map(p => ({ id: p.id, label: p.name }))}
                    value={formData.project_id || ''}
                    onChange={val => setFormData(f => ({ ...f, project_id: val || '' }))}
                    placeholder="Type project name..."
                    allLabel="None (general availability)"
                  />
                </div>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>FTE % <span style={{ fontWeight: 400, color: 'gray', fontSize: 12 }}>(5–100, multiples of 5)</span></label>
                  <Input
                    type="number"
                    min={5}
                    max={100}
                    step={5}
                    placeholder="e.g. 100"
                    value={formData.fte_percent === 0 ? '' : String(formData.fte_percent)}
                    onChange={e => setFormData(f => ({ ...f, fte_percent: e.target.value === '' ? 0 : parseInt(e.target.value) }))}
                    style={{ width: 120 }}
                  />
                </div>
              </>
            )}

            {addMode === 'bulk' && !editId && (
              <>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Resources *</label>
                  {resources.length === 0 && !loading ? (
                    <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
                      No resources in your reporting line. Contact your admin.
                    </Body1>
                  ) : (
                    <SearchableMultiselect
                      options={resources.map(r => ({ id: r.id, label: r.display_name }))}
                      value={bulkAddResources}
                      onChange={setBulkAddResources}
                      placeholder="Type to search resources..."
                    />
                  )}
                </div>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Periods</label>
                  <Dropdown
                    multiselect
                    selectedOptions={bulkAddPeriods.map(p => p.id)}
                    onOptionSelect={(_, data) => {
                      setBulkAddPeriods(
                        openPeriods.filter(p => data.selectedOptions.includes(p.id)),
                      );
                    }}
                    placeholder="Select open periods..."
                  >
                    {openPeriods.map(p => (
                      <Option key={p.id} value={p.id} text={`${MONTH_NAMES[p.month - 1]} ${p.year}`}>
                        {MONTH_NAMES[p.month - 1]} {p.year}
                      </Option>
                    ))}
                  </Dropdown>
                </div>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Project (optional)</label>
                  <SearchableFilter
                    options={projects.map(p => ({ id: p.id, label: p.name }))}
                    value={bulkAddProjectId}
                    onChange={val => setBulkAddProjectId(val)}
                    placeholder="Type project name..."
                    allLabel="None (General Availability)"
                  />
                </div>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>FTE % <span style={{ fontWeight: 400, color: 'gray', fontSize: 12 }}>(5–100, multiples of 5)</span></label>
                  <Input
                    type="number"
                    min={5}
                    max={100}
                    step={5}
                    value={String(bulkAddFte)}
                    onChange={e => setBulkAddFte(e.target.value ? parseInt(e.target.value) : 100)}
                    style={{ width: 120 }}
                  />
                </div>
                <Button
                  appearance="secondary"
                  onClick={handleBulkAddPreview}
                  disabled={bulkAddResources.length === 0 || bulkAddPeriods.length === 0}
                >
                  Preview
                </Button>
                {bulkAddPreview.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <strong>Preview ({bulkAddPreview.length} lines):</strong>
                    <Table className={styles.table}>
                      <TableHeader>
                        <TableRow>
                          <TableHeaderCell>Resource</TableHeaderCell>
                          <TableHeaderCell>Year</TableHeaderCell>
                          <TableHeaderCell>Month</TableHeaderCell>
                          <TableHeaderCell>Project</TableHeaderCell>
                          <TableHeaderCell>FTE %</TableHeaderCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bulkAddPreview.map((line, idx) => (
                          <TableRow key={idx}>
                            <TableCell>
                              {resources.find(r => r.id === line.resource_id)?.display_name ||
                                line.resource_id}
                            </TableCell>
                            <TableCell>{line.year}</TableCell>
                            <TableCell>{String(line.month).padStart(2, '0')}</TableCell>
                            <TableCell>
                              {projects.find(p => p.id === line.project_id)?.name || '—'}
                            </TableCell>
                            <TableCell>{line.fte_percent}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: tokens.spacingHorizontalS, marginTop: tokens.spacingVerticalL }}>
              <Button
                onClick={() => {
                  setIsDialogOpen(false);
                  setEditId(null);
                  setAddMode('single');
                }}
              >
                Cancel
              </Button>
              {addMode === 'bulk' && !editId ? (
                <Button
                  appearance="primary"
                  onClick={handleBulkAddSubmit}
                  disabled={bulkAddPreview.length === 0}
                >
                  Create All
                </Button>
              ) : editId ? (
                <Button appearance="primary" onClick={handleSaveEdit}>
                  Save
                </Button>
              ) : (
                <Button appearance="primary" onClick={handleCreate}>
                  Create
                </Button>
              )}
            </div>
          </DrawerBody>
        </Drawer>
      )}
      
      <Card className={styles.card}>
        <CardHeader header={<Body1><strong>Supply Lines ({filteredSupplies.length})</strong></Body1>} />
        
        <Table className={styles.table}>
          <TableHeader>
            <TableRow>
              {canEdit && (
                <TableHeaderCell>
                  <Checkbox checked={allSelected} onChange={toggleSelectAll} />
                </TableHeaderCell>
              )}
              <TableHeaderCell>Cost Center</TableHeaderCell>
              <TableHeaderCell>
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={() => handleSort('resource')}
                >
                  Resource
                  {sortBy === 'resource' && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                </Button>
              </TableHeaderCell>
              <TableHeaderCell>
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={() => handleSort('project')}
                >
                  Project
                  {sortBy === 'project' && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                </Button>
              </TableHeaderCell>
              <TableHeaderCell>
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={() => handleSort('period')}
                >
                  Period
                  {sortBy === 'period' && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                </Button>
              </TableHeaderCell>
              <TableHeaderCell>
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={() => handleSort('fte')}
                >
                  FTE %
                  {sortBy === 'fte' && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                </Button>
              </TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSupplies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={totalColumns} style={{ padding: tokens.spacingVerticalXXL }}>
                  <EmptyState
                    icon={<PeopleRegular style={{ fontSize: 48 }} />}
                    title="No supply lines"
                    message="No supply lines found for the selected filters. Create one to get started."
                    action={
                      !isLocked && canEdit ? (
                        <Button
                          appearance="primary"
                          icon={<Add24Regular />}
                          onClick={() => {
                            setEditId(null);
                            setAddMode('single');
                            setIsDialogOpen(true);
                          }}
                        >
                          Add Supply Line
                        </Button>
                      ) : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              <>
                {sortedGroupedSupplies.map(cc => {
                  const groupKey = cc.costCenterId || '__none__';
                  const isCollapsed = collapsedGroups.has(groupKey);
                  const groupFte = cc.supplies.reduce((sum, s) => sum + (s.fte_percent ?? 0), 0);
                  return (
                  <React.Fragment key={groupKey}>
                    <TableRow className={styles.groupHeader}>
                      <TableCell colSpan={totalColumns}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Button
                              appearance="subtle"
                              size="small"
                              icon={isCollapsed ? <ChevronRight20Regular /> : <ChevronDown20Regular />}
                              onClick={() => toggleGroupCollapsed(groupKey)}
                            />
                            <span>{cc.costCenterName}</span>
                            <Badge appearance="outline" style={{ marginLeft: 8 }}>
                              {cc.supplies.length} lines
                            </Badge>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Badge appearance="outline" color="informative">
                              Total FTE: {groupFte}
                            </Badge>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                    {!isCollapsed && cc.supplies.map(s => (
                      <TableRow
                        key={s.id}
                        style={selectedIds.includes(s.id) ? { backgroundColor: tokens.colorBrandBackground2 } : undefined}
                      >
                        {canEdit && (
                          <TableCell>
                            <Checkbox checked={selectedIds.includes(s.id)} onChange={() => toggleSelect(s.id)} />
                          </TableCell>
                        )}
                        <TableCell>{s.cost_center_name || '-'}</TableCell>
                        <TableCell>{s.resource_name || 'Unknown'}</TableCell>
                        <TableCell>{s.project_name || '—'}</TableCell>
                        <TableCell>{s.year}-{String(s.month).padStart(2, '0')}</TableCell>
                        <TableCell>
                          <Badge appearance="filled" color="informative">{s.fte_percent}%</Badge>
                        </TableCell>
                        <TableCell>
                          {!isLocked && canEdit && (
                            <>
                              <Button
                                icon={<Edit24Regular />}
                                appearance="subtle"
                                onClick={() => handleEdit(s)}
                                title="Edit line"
                                style={{ marginRight: 4 }}
                              />
                              <Button
                                icon={<Delete24Regular />}
                                appearance="subtle"
                                onClick={() => handleDelete(s.id)}
                                title="Delete line"
                              />
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </React.Fragment>
                )})}
              </>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};

export default Supply;
