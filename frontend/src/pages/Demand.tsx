/**
 * Demand Planning Page
 * 
 * PM/Finance: Create and edit demand lines (project + resource/placeholder + FTE)
 * Admin: Read-only view
 * 
 * Features: Cost center filters, grouped table, placeholder picker
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
  Select,
  Input,
  Checkbox,
  Toolbar,
  ToolbarButton,
  TabList,
  Tab,
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@fluentui/react-components';
import { Add24Regular, Delete24Regular, CalendarRegular, Edit24Regular, ChevronRight20Regular, ChevronDown20Regular } from '@fluentui/react-icons';
import { planningApi, DemandLine, CreateDemandLine } from '../api/planning';
import { usePeriod } from '../contexts/PeriodContext';
import { lookupsApi, Project, Resource, Placeholder, CostCenter } from '../api/lookups';
import { useToast } from '../hooks/useToast';
import { formatApiError } from '../utils/errors';
import { useAuth } from '../auth/AuthProvider';
import { StatusBanner } from '../components/StatusBanner';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ResourcePicker } from '../components/ResourcePicker';
import { PlaceholderPicker } from '../components/PlaceholderPicker';
import { periodsApi } from '../api/periods';
import { Period } from '../types';
import { SearchableFilter } from '../components/SearchableFilter';
import { SearchableMultiselect } from '../components/SearchableMultiselect';
import { Dropdown, Option } from '@fluentui/react-components';

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

interface GroupedDemands {
  costCenterId: string | undefined;
  costCenterName: string;
  demands: DemandLine[];
}

function groupDemandsByCostCenter(demands: DemandLine[]): GroupedDemands[] {
  const ccMap = new Map<string, GroupedDemands>();

  for (const d of demands) {
    const ccKey = d.cost_center_id || '__none__';
    const ccName = d.cost_center_name || 'Unassigned';
    if (!ccMap.has(ccKey)) {
      ccMap.set(ccKey, { costCenterId: d.cost_center_id, costCenterName: ccName, demands: [] });
    }
    ccMap.get(ccKey)!.demands.push(d);
  }

  const result = Array.from(ccMap.values());
  result.sort((a, b) => a.costCenterName.localeCompare(b.costCenterName));
  return result;
}

export const Demand: React.FC = () => {
  const styles = useStyles();
  const { showSuccess, showApiError, showError } = useToast();
  const { user } = useAuth();
  
  const { selectedPeriodId, selectedPeriod: currentPeriod } = usePeriod();
  
  const [demands, setDemands] = useState<DemandLine[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState<CreateDemandLine>({
    period_id: '',
    project_id: '',
    fte_percent: 50,
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [useResource, setUseResource] = useState(true);
  const [filteredPlaceholders, setFilteredPlaceholders] = useState<Placeholder[]>([]);
  const [dialogCostCenterId, setDialogCostCenterId] = useState<string>('');
  
  // Selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  // Bulk Edit Dialog State
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [bulkEditForm, setBulkEditForm] = useState<Partial<CreateDemandLine>>({});
  const [bulkEditUseResource, setBulkEditUseResource] = useState<'resource' | 'placeholder' | ''>('');

  // Add dialog mode: single line vs bulk add (both use isDialogOpen)
  const [addMode, setAddMode] = useState<'single' | 'bulk'>('single');
  const [bulkAddProjects, setBulkAddProjects] = useState<string[]>([]);
  const [bulkAddResourceType, setBulkAddResourceType] = useState<'resource' | 'placeholder' | ''>('');
  const [bulkAddResourceIds, setBulkAddResourceIds] = useState<string[]>([]);
  const [bulkAddPeriods, setBulkAddPeriods] = useState<Period[]>([]);
  const [bulkAddFte, setBulkAddFte] = useState<number>(50);
  const [bulkAddPreview, setBulkAddPreview] = useState<any[]>([]);
  const [openPeriods, setOpenPeriods] = useState<Period[]>([]);

  type SortColumn = 'project' | 'resource' | 'period' | 'fte';
  const [sortBy, setSortBy] = useState<SortColumn>('project');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  
  const filteredDemands = useMemo(() => {
    return demands.filter((d) => {
      if (selectedProjectId && d.project_id !== selectedProjectId) {
        return false;
      }
      if (selectedResourceId) {
        const lineResourceId = d.resource_id || d.placeholder_id;
        if (lineResourceId !== selectedResourceId) {
          return false;
        }
      }
      return true;
    });
  }, [demands, selectedProjectId, selectedResourceId]);
  
  const groupedDemands = useMemo(() => groupDemandsByCostCenter(filteredDemands), [filteredDemands]);
  const totalColumns = (user?.role === 'Finance' || user?.role === 'PM') ? 7 : 6;

  const activeProjectLabel = useMemo(() => {
    if (!selectedProjectId) return null;
    const project = projects.find(p => p.id === selectedProjectId);
    return project ? `Project: ${project.name}` : 'Project filter';
  }, [projects, selectedProjectId]);

  const activeResourceLabel = useMemo(() => {
    if (!selectedResourceId) return null;
    const resource = resources.find(r => r.id === selectedResourceId);
    if (resource) {
      return `Resource: ${resource.display_name}`;
    }
    const placeholder = placeholders.find(ph => ph.id === selectedResourceId);
    if (placeholder) {
      return `Placeholder: ${placeholder.name}`;
    }
    return 'Resource filter';
  }, [resources, placeholders, selectedResourceId]);

  const activeCostCenterLabel = useMemo(() => {
    if (!selectedCostCenterId) return null;
    const cc = costCenters.find(c => c.id === selectedCostCenterId);
    return cc ? `Cost center: ${cc.name}` : 'Cost center filter';
  }, [costCenters, selectedCostCenterId]);

  const hasActiveFilters = !!(activeProjectLabel || activeResourceLabel || activeCostCenterLabel);

  const totalFtePercent = useMemo(() => {
    return filteredDemands.reduce((sum, d) => sum + (d.fte_percent ?? 0), 0);
  }, [filteredDemands]);

  const distinctProjectsCount = useMemo(() => {
    const ids = new Set<string>();
    for (const d of filteredDemands) {
      if (d.project_id) ids.add(d.project_id);
    }
    return ids.size;
  }, [filteredDemands]);

  const distinctAssignmentsCount = useMemo(() => {
    const ids = new Set<string>();
    for (const d of filteredDemands) {
      if (d.resource_id) ids.add(`r:${d.resource_id}`);
      if (d.placeholder_id) ids.add(`p:${d.placeholder_id}`);
    }
    return ids.size;
  }, [filteredDemands]);

  const sortedGroupedDemands = useMemo(() => {
    const direction = sortDir === 'asc' ? 1 : -1;
    const compare = (a: DemandLine, b: DemandLine) => {
      switch (sortBy) {
        case 'project': {
          const aName = a.project_name || '';
          const bName = b.project_name || '';
          return aName.localeCompare(bName) * direction;
        }
        case 'resource': {
          const aName = a.resource_name || a.placeholder_name || '';
          const bName = b.resource_name || b.placeholder_name || '';
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

    return groupedDemands.map(group => ({
      ...group,
      demands: [...group.demands].sort(compare),
    }));
  }, [groupedDemands, sortBy, sortDir]);
  
  useEffect(() => {
    loadInitialData();
  }, []);
  
  useEffect(() => {
    if (selectedPeriodId) {
      loadDemands(selectedPeriodId, selectedCostCenterId || undefined);
    }
  }, [selectedPeriodId, selectedCostCenterId]);

  useEffect(() => {
    if (dialogCostCenterId) {
      lookupsApi.listPlaceholders(dialogCostCenterId).then(setFilteredPlaceholders);
    } else {
      setFilteredPlaceholders(placeholders);
    }
  }, [dialogCostCenterId, placeholders]);
  
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
      const [projectsData, resourcesData, placeholdersData, costCentersData] = await Promise.all([
        user?.role === 'PM' ? lookupsApi.listProjectsScoped() : lookupsApi.listProjects(),
        lookupsApi.listResources(),
        lookupsApi.listPlaceholders(),
        lookupsApi.listCostCenters(),
      ]);
      
      setProjects(projectsData);
      setResources(resourcesData);
      setPlaceholders(placeholdersData);
      setCostCenters(costCentersData);
    } catch (err: unknown) {
      setError(formatApiError(err, 'Failed to load data'));
    } finally {
      setLoading(false);
    }
  };
  
  const loadDemands = async (periodId?: string, costCenterId?: string) => {
    const pid = periodId || selectedPeriodId;
    if (!pid) return;
    try {
      const data = await planningApi.getDemandLines(pid, {
        costCenterId: costCenterId ?? (selectedCostCenterId || undefined),
      });
      setDemands(data);
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to load demand lines');
    }
  };
  
  const handleCreate = async () => {
    if (!canEdit) {
      showError('Read-only', 'Only Finance and PM can create demand lines.');
      return;
    }
    if (!formData.project_id) {
      showError('Missing project', 'Please select a project.');
      return;
    }
    if (!selectedPeriodId || !currentPeriod) {
      showError('Missing period', 'Please select a period.');
      return;
    }
    if (useResource && !formData.resource_id) {
      showError('Missing resource', 'Please select a resource.');
      return;
    }
    if (!useResource && !formData.placeholder_id) {
      showError('Missing placeholder', 'Please select a placeholder.');
      return;
    }
    try {
      const data: CreateDemandLine = {
        period_id: selectedPeriodId,
        project_id: formData.project_id,
        fte_percent: formData.fte_percent,
        year: currentPeriod.year,
        month: currentPeriod.month,
      };
      if (useResource) {
        data.resource_id = formData.resource_id;
      } else {
        data.placeholder_id = formData.placeholder_id;
      }
      await planningApi.createDemandLine(data);
      showSuccess('Demand line created');
      setIsDialogOpen(false);
      loadDemands();
      setFormData({ period_id: selectedPeriodId, project_id: '', fte_percent: 50 });
      setDialogCostCenterId('');
    } catch (err: any) {
      showApiError(err, 'Failed to create demand line');
    }
  };
  
  const handleEdit = (d: DemandLine) => {
    setEditId(d.id);
    setFormData({
      period_id: d.period_id,
      project_id: d.project_id,
      fte_percent: d.fte_percent,
      resource_id: d.resource_id,
      placeholder_id: d.placeholder_id,
      year: d.year,
      month: d.month,
    });
    setUseResource(!!d.resource_id);
    setDialogCostCenterId(d.cost_center_id || '');
    setIsDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editId) return;
    if (!canEdit) {
      showError('Read-only', 'Only PMs can edit demand lines.');
      return;
    }
    if (!formData.project_id) {
      showError('Missing project', 'Please select a project.');
      return;
    }
    if (!selectedPeriodId || !currentPeriod) {
      showError('Missing period', 'Please select a period.');
      return;
    }
    if (useResource && !formData.resource_id) {
      showError('Missing resource', 'Please select a resource.');
      return;
    }
    if (!useResource && !formData.placeholder_id) {
      showError('Missing placeholder', 'Please select a placeholder.');
      return;
    }
    try {
      const data: any = {
        id: editId,
        project_id: formData.project_id,
        fte_percent: formData.fte_percent,
        year: currentPeriod.year,
        month: currentPeriod.month,
      };
      if (useResource) {
        data.resource_id = formData.resource_id;
        data.placeholder_id = undefined;
      } else {
        data.placeholder_id = formData.placeholder_id;
        data.resource_id = undefined;
      }
      await planningApi.updateDemandLine(editId, data);
      showSuccess('Demand line updated');
      setIsDialogOpen(false);
      setEditId(null);
      loadDemands();
      setFormData({ period_id: selectedPeriodId, project_id: '', fte_percent: 50 });
      setDialogCostCenterId('');
    } catch (err: any) {
      showApiError(err, 'Failed to update demand line');
    }
  };
  
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this demand line?')) return;
    try {
      await planningApi.deleteDemandLine(id);
      showSuccess('Demand line deleted');
      loadDemands();
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to delete demand line');
    }
  };
  
  const isLocked = currentPeriod?.status === 'locked';
  const canEdit = user?.role === 'Finance' || user?.role === 'PM';
  
  const allSelected = filteredDemands.length > 0 && selectedIds.length === filteredDemands.length;
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : filteredDemands.map(d => d.id));
  };
  const toggleSelect = (id: string) => {
    setSelectedIds(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  };
  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedIds.length} demand lines?`)) return;
    try {
      const actions = selectedIds.map(id => ({ action: 'delete', data: { id } }));
      await planningApi.bulkDemandLines({ actions, all_or_nothing: true });
      showSuccess('Bulk delete successful');
      setSelectedIds([]);
      loadDemands();
    } catch (err) {
      showApiError(err, 'Bulk delete failed');
    }
  };

  const handleOpenBulkEdit = () => {
    setBulkEditForm({});
    setBulkEditUseResource('');
    setIsBulkEditOpen(true);
  };

  const handleBulkEditSubmit = async () => {
    if (!canEdit) return;
    if (Object.keys(bulkEditForm).length === 0 && !bulkEditUseResource) {
      showError('No changes', 'Please select at least one field to update.');
      return;
    }
    try {
      const actions = selectedIds.map(id => ({
        action: 'update',
        data: {
          id,
          ...bulkEditForm,
          ...(bulkEditUseResource === 'resource' ? { resource_id: bulkEditForm.resource_id, placeholder_id: undefined } : {}),
          ...(bulkEditUseResource === 'placeholder' ? { placeholder_id: bulkEditForm.placeholder_id, resource_id: undefined } : {}),
        },
      }));
      await planningApi.bulkDemandLines({ actions, all_or_nothing: true });
      showSuccess('Bulk edit successful');
      setIsBulkEditOpen(false);
      setSelectedIds([]);
      loadDemands();
    } catch (err) {
      showApiError(err, 'Bulk edit failed');
    }
  };

  // Helper: Generate periods between two dates (inclusive)
  function generatePeriods(startYear: number, startMonth: number, endYear: number, endMonth: number) {
    const periods = [];
    let y = startYear, m = startMonth;
    while (y < endYear || (y === endYear && m <= endMonth)) {
      periods.push({ year: y, month: m });
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return periods;
  }


  const handleBulkAddPreview = () => {
    // Preview lines: projects x resources/placeholders x periods
    const preview = [];
    for (const projectId of bulkAddProjects) {
      for (const resourceId of bulkAddResourceIds) {
        for (const period of bulkAddPeriods) {
          preview.push({
            project_id: projectId,
            year: period.year,
            month: period.month,
            resource_id: bulkAddResourceType === 'resource' ? resourceId : undefined,
            placeholder_id: bulkAddResourceType === 'placeholder' ? resourceId : undefined,
            fte_percent: bulkAddFte,
          });
        }
      }
    }
    setBulkAddPreview(preview);
  };

  const handleBulkAddSubmit = async () => {
    if (!canEdit || bulkAddProjects.length === 0 || !bulkAddResourceType || bulkAddResourceIds.length === 0 || bulkAddPeriods.length === 0) {
      showError('Missing fields', 'Please fill all fields and preview before submitting.');
      return;
    }
    try {
      const actions = bulkAddPreview.map(line => ({ action: 'create', data: line }));
      await planningApi.bulkDemandLines({ actions, all_or_nothing: true });
      showSuccess('Bulk demand lines created');
      setIsDialogOpen(false);
      setAddMode('single');
      loadDemands();
    } catch (err) {
      showApiError(err, 'Bulk add failed');
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
    return <LoadingState message="Loading demand planning data..." />;
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
              Add Demand
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
              ? `${monthNames[currentPeriod.month - 1]} ${currentPeriod.year}`
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
            options={[
              ...resources.map(r => ({ id: r.id, label: r.display_name })),
              ...placeholders.map(ph => ({ id: ph.id, label: `${ph.name} (placeholder)` })),
            ]}
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
          <span className={styles.kpiLabel}>Distinct resources / placeholders</span>
          <span className={styles.kpiValue}>{distinctAssignmentsCount}</span>
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
          <ToolbarButton onClick={handleOpenBulkEdit}>Edit Selected</ToolbarButton>
        </Toolbar>
      )}

      {/* Bulk Edit Dialog */}
      {canEdit && (
        <Dialog open={isBulkEditOpen} onOpenChange={(_, d) => setIsBulkEditOpen(d.open)}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Bulk Edit Demand Lines</DialogTitle>
              <DialogContent>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Project</label>
                  <Select
                    value={bulkEditForm.project_id || ''}
                    onChange={(_, data) => setBulkEditForm(f => ({ ...f, project_id: data.value }))}
                  >
                    <option value="">No change</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </div>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>FTE % <span style={{ fontWeight: 400, color: 'gray', fontSize: 12 }}>(5–100, multiples of 5; leave blank = no change)</span></label>
                  <Input
                    type="number"
                    min={5}
                    max={100}
                    step={5}
                    placeholder="No change"
                    value={bulkEditForm.fte_percent ? String(bulkEditForm.fte_percent) : ''}
                    onChange={e => setBulkEditForm(f => ({ ...f, fte_percent: e.target.value ? parseInt(e.target.value) : undefined }))}
                    style={{ width: 120 }}
                  />
                </div>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setIsBulkEditOpen(false)}>Cancel</Button>
                <Button appearance="primary" onClick={handleBulkEditSubmit}>Apply Changes</Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      
      <Card className={styles.card}>
        <CardHeader header={<Body1><strong>Demand Lines ({filteredDemands.length})</strong></Body1>} />
        
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
            {filteredDemands.length === 0 ? (
              <TableRow>
                <TableCell colSpan={totalColumns} style={{ padding: tokens.spacingVerticalXXL }}>
                  <EmptyState
                    icon={<CalendarRegular style={{ fontSize: 48 }} />}
                    title="No demand lines"
                    message="No demand lines found for the selected filters. Create one to get started."
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
                          Add Demand Line
                        </Button>
                      ) : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              sortedGroupedDemands.map(cc => {
                const groupKey = cc.costCenterId || '__none__';
                const isCollapsed = collapsedGroups.has(groupKey);
                const groupFte = cc.demands.reduce((sum, d) => sum + (d.fte_percent ?? 0), 0);
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
                            {cc.demands.length} lines
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
                  {!isCollapsed && cc.demands.map(d => (
                    <TableRow
                      key={d.id}
                      style={selectedIds.includes(d.id) ? { backgroundColor: tokens.colorBrandBackground2 } : undefined}
                    >
                      {canEdit && (
                        <TableCell>
                          <Checkbox checked={selectedIds.includes(d.id)} onChange={() => toggleSelect(d.id)} />
                        </TableCell>
                      )}
                      <TableCell>{d.cost_center_name || '-'}</TableCell>
                      <TableCell>{d.project_name || 'Unknown'}</TableCell>
                      <TableCell>
                        {d.resource_name ? (
                          d.resource_name
                        ) : d.placeholder_name ? (
                          <>
                            {d.placeholder_name}
                            <Badge appearance="outline" color="warning" style={{ marginLeft: 6 }}>Placeholder</Badge>
                          </>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>{d.year}-{String(d.month).padStart(2, '0')}</TableCell>
                      <TableCell>
                        <Badge appearance="filled" color="informative">{d.fte_percent}%</Badge>
                      </TableCell>
                      <TableCell>
                        {!isLocked && canEdit && (
                          <>
                            <Button
                              icon={<Edit24Regular />}
                              appearance="subtle"
                              onClick={() => handleEdit(d)}
                              title="Edit line"
                              style={{ marginRight: 4 }}
                            />
                            <Button
                              icon={<Delete24Regular />}
                              appearance="subtle"
                              onClick={() => handleDelete(d.id)}
                              title="Delete line"
                            />
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </React.Fragment>
              )})
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Add / Edit Demand Drawer with Single and Bulk modes */}
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
              setBulkAddProjects([]);
              setBulkAddResourceType('');
              setBulkAddResourceIds([]);
              setBulkAddPeriods([]);
              setBulkAddPreview([]);
            }
          }}
        >
          <DrawerHeader>
            <DrawerHeaderTitle>
              {editId
                ? 'Edit Demand Line'
                : addMode === 'single'
                  ? 'Add Demand Line'
                  : 'Bulk Add Demand Lines'}
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
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Project *</label>
                  {projects.length === 0 && !loading ? (
                    <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
                      No projects available. Contact your admin.
                    </Body1>
                  ) : (
                    <SearchableFilter
                      options={projects.map(p => ({ id: p.id, label: p.name }))}
                      value={formData.project_id || ''}
                      onChange={val => setFormData(f => ({ ...f, project_id: val }))}
                      placeholder="Type project name..."
                      allLabel="Select project..."
                    />
                  )}
                </div>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Assignment Type</label>
                  <Select
                    value={useResource ? 'resource' : 'placeholder'}
                    onChange={(_, data) => setUseResource(data.value === 'resource')}
                  >
                    <option value="resource">Named Resource</option>
                    <option value="placeholder">Placeholder (TBD)</option>
                  </Select>
                </div>
                {useResource ? (
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>Resource</label>
                    <ResourcePicker resources={resources} value={formData.resource_id || ''} onChange={val => setFormData(f => ({ ...f, resource_id: val, placeholder_id: undefined }))} placeholder="Type name..." />
                  </div>
                ) : (
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>Placeholder</label>
                    <PlaceholderPicker placeholders={filteredPlaceholders} value={formData.placeholder_id || ''} onChange={val => setFormData(f => ({ ...f, placeholder_id: val, resource_id: undefined }))} placeholder="Type placeholder..." />
                  </div>
                )}
                <div className={styles.formField}>
                  <label className={styles.formLabel}>FTE % <span style={{ fontWeight: 400, color: 'gray', fontSize: 12 }}>(5–100, multiples of 5)</span></label>
                  <Input
                    type="number"
                    min={5}
                    max={100}
                    step={5}
                    placeholder="e.g. 50"
                    value={formData.fte_percent ? String(formData.fte_percent) : ''}
                    onChange={e => setFormData(f => ({ ...f, fte_percent: e.target.value ? parseInt(e.target.value) : 50 }))}
                    style={{ width: 120 }}
                  />
                </div>
              </>
            )}

            {addMode === 'bulk' && !editId && (
              <>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Projects *</label>
                  {projects.length === 0 && !loading ? (
                    <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
                      No projects available. Contact your admin.
                    </Body1>
                  ) : (
                    <SearchableMultiselect
                      options={projects.map(p => ({ id: p.id, label: p.name }))}
                      value={bulkAddProjects}
                      onChange={setBulkAddProjects}
                      placeholder="Type to search projects..."
                    />
                  )}
                </div>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Assignment Type</label>
                  <Select value={bulkAddResourceType} onChange={(_, data) => { setBulkAddResourceType(data.value); setBulkAddResourceIds([]); }}>
                    <option value="">Select...</option>
                    <option value="resource">Named Resource</option>
                    <option value="placeholder">Placeholder (TBD)</option>
                  </Select>
                </div>
                {bulkAddResourceType === 'resource' && (
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>Resources</label>
                    <SearchableMultiselect
                      options={resources.map(r => ({ id: r.id, label: r.display_name }))}
                      value={bulkAddResourceIds}
                      onChange={setBulkAddResourceIds}
                      placeholder="Type to search resources..."
                    />
                  </div>
                )}
                {bulkAddResourceType === 'placeholder' && (
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>Placeholders</label>
                    <SearchableMultiselect
                      options={placeholders.map(ph => ({ id: ph.id, label: ph.name }))}
                      value={bulkAddResourceIds}
                      onChange={setBulkAddResourceIds}
                      placeholder="Type to search placeholders..."
                    />
                  </div>
                )}
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Periods</label>
                  <Dropdown
                    multiselect
                    selectedOptions={bulkAddPeriods.map(p => p.id)}
                    onOptionSelect={(_, data) => {
                      setBulkAddPeriods(openPeriods.filter(p => data.selectedOptions.includes(p.id)));
                    }}
                    placeholder="Select open periods..."
                  >
                    {openPeriods.map(p => (
                      <Option key={p.id} value={p.id} text={`${monthNames[p.month - 1]} ${p.year}`}>
                        {monthNames[p.month - 1]} {p.year}
                      </Option>
                    ))}
                  </Dropdown>
                </div>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>FTE % <span style={{ fontWeight: 400, color: 'gray', fontSize: 12 }}>(5–100, multiples of 5)</span></label>
                  <Input
                    type="number"
                    min={5}
                    max={100}
                    step={5}
                    value={String(bulkAddFte)}
                    onChange={e => setBulkAddFte(e.target.value ? parseInt(e.target.value) : 50)}
                    style={{ width: 120 }}
                  />
                </div>
                <Button appearance="secondary" onClick={handleBulkAddPreview} disabled={bulkAddProjects.length === 0 || bulkAddResourceIds.length === 0 || bulkAddPeriods.length === 0}>Preview</Button>
                {bulkAddPreview.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <strong>Preview ({bulkAddPreview.length} lines):</strong>
                    <Table className={styles.table}>
                      <TableHeader>
                        <TableRow>
                          <TableHeaderCell>Project</TableHeaderCell>
                          <TableHeaderCell>Resource</TableHeaderCell>
                          <TableHeaderCell>Year</TableHeaderCell>
                          <TableHeaderCell>Month</TableHeaderCell>
                          <TableHeaderCell>FTE %</TableHeaderCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bulkAddPreview.map((line, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{projects.find(p => p.id === line.project_id)?.name || line.project_id}</TableCell>
                            <TableCell>
                              {line.resource_id
                                ? (resources.find(r => r.id === line.resource_id)?.display_name || line.resource_id)
                                : (placeholders.find(ph => ph.id === line.placeholder_id)?.name || line.placeholder_id || '—')}
                            </TableCell>
                            <TableCell>{line.year}</TableCell>
                            <TableCell>{String(line.month).padStart(2, '0')}</TableCell>
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
                <Button appearance="primary" onClick={handleSaveEdit}>Save Changes</Button>
              ) : (
                <Button appearance="primary" onClick={handleCreate}>Create</Button>
              )}
            </div>
          </DrawerBody>
        </Drawer>
      )}
    </div>
  );
};

export default Demand;
