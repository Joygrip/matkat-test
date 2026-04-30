import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { flushSync } from 'react-dom';
import {
  Button,
  Spinner,
  tokens,
  makeStyles,
  mergeClasses,
  Select,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogActions,
  DialogContent,
} from '@fluentui/react-components';
import { Add24Regular, ChevronRight20Regular, ChevronDown20Regular } from '@fluentui/react-icons';
import { planningApi, DemandLine, SupplyLine } from '../api/planning';
import { useToast } from '../hooks/useToast';
import { lookupsApi, Project, CostCenter, Resource, Placeholder } from '../api/lookups';
import { Period } from '../types/index';

const RESOURCE_COL_WIDTH = 180;
const PROJECT_COL_WIDTH = 150;
const TYPE_COL_WIDTH = 70;
const PERIOD_COL_WIDTH = 88;
const RESOURCE_COL_PX = `${RESOURCE_COL_WIDTH}px`;
const PROJECT_COL_PX = `${PROJECT_COL_WIDTH}px`;
const TYPE_COL_PX = `${TYPE_COL_WIDTH}px`;
const PERIOD_COL_PX = `${PERIOD_COL_WIDTH}px`;
const TYPE_LEFT = RESOURCE_COL_WIDTH + PROJECT_COL_WIDTH;
const TYPE_LEFT_PX = `${TYPE_LEFT}px`;

const DEMAND_COLOR = '#dbeafe';
const SUPPLY_COLOR = '#dcfce7';

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function getFteColor(val: number): { background: string; color: string } | undefined {
  if (val === 0) return undefined;
  if (val <= 49) return { background: tokens.colorPaletteGreenBackground2, color: tokens.colorPaletteGreenForeground2 };
  if (val <= 79) return { background: tokens.colorPaletteMarigoldBackground2, color: tokens.colorPaletteMarigoldForeground2 };
  return { background: tokens.colorPaletteRedBackground2, color: tokens.colorPaletteRedForeground2 };
}

function buildCellKey(
  type: 'demand' | 'supply',
  resourceId: string | null,
  placeholderId: string | null,
  projectId: string | null,
  periodId: string,
): string {
  return `${type}::${resourceId ?? ''}::${placeholderId ?? ''}::${projectId ?? 'general'}::${periodId}`;
}

function parseCellKey(key: string): {
  type: 'demand' | 'supply';
  resourceId: string | null;
  placeholderId: string | null;
  projectId: string;
  periodId: string;
} {
  const parts = key.split('::');
  return {
    type: parts[0] as 'demand' | 'supply',
    resourceId: parts[1] || null,
    placeholderId: parts[2] || null,
    projectId: parts[3],
    periodId: parts[4],
  };
}

const useStyles = makeStyles({
  headerWrap: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
    overflow: 'hidden' as const,
    width: '100%',
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: `0 1px 0 ${tokens.colorNeutralStroke1}`,
  },
  wrapper: {
    overflowX: 'auto' as const,
    width: '100%',
    scrollbarWidth: 'none' as const,
    '&::-webkit-scrollbar': { display: 'none' },
  },
  table: {
    borderCollapse: 'collapse',
    minWidth: '100%',
    fontSize: tokens.fontSizeBase200,
  },
  th: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    textAlign: 'center' as const,
    whiteSpace: 'nowrap' as const,
  },
  thResource: {
    position: 'sticky' as const,
    left: 0,
    zIndex: 4,
    textAlign: 'left' as const,
    minWidth: RESOURCE_COL_PX,
  },
  thProject: {
    position: 'sticky' as const,
    left: RESOURCE_COL_PX,
    zIndex: 4,
    textAlign: 'left' as const,
    minWidth: PROJECT_COL_PX,
  },
  thType: {
    position: 'sticky' as const,
    left: TYPE_LEFT_PX,
    zIndex: 4,
    textAlign: 'left' as const,
    minWidth: TYPE_COL_PX,
  },
  summaryRow: {
    backgroundColor: tokens.colorNeutralBackground3,
    cursor: 'pointer',
    ':hover': { filter: 'brightness(0.97)' },
  },
  summaryFixed: {
    fontWeight: tokens.fontWeightSemibold,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap' as const,
    position: 'sticky' as const,
    left: 0,
    backgroundColor: tokens.colorNeutralBackground3,
    zIndex: 1,
    minWidth: RESOURCE_COL_PX,
  },
  summaryProject: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
    position: 'sticky' as const,
    left: RESOURCE_COL_PX,
    backgroundColor: tokens.colorNeutralBackground3,
    zIndex: 1,
    minWidth: PROJECT_COL_PX,
  },
  summaryType: {
    padding: `2px ${tokens.spacingHorizontalXS}`,
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
    position: 'sticky' as const,
    left: TYPE_LEFT_PX,
    backgroundColor: tokens.colorNeutralBackground3,
    zIndex: 1,
    minWidth: TYPE_COL_PX,
  },
  summaryValueCell: {
    padding: `8px ${tokens.spacingHorizontalXS}`,
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
    textAlign: 'center' as const,
    width: PERIOD_COL_PX,
    minWidth: PERIOD_COL_PX,
    verticalAlign: 'middle' as const,
  },
  typeCellDemand: {
    backgroundColor: DEMAND_COLOR,
    color: '#1a3a7a',
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase100,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    position: 'sticky' as const,
    left: TYPE_LEFT_PX,
    zIndex: 1,
    whiteSpace: 'nowrap' as const,
    minWidth: TYPE_COL_PX,
  },
  typeCellSupply: {
    backgroundColor: SUPPLY_COLOR,
    color: '#0a4a1a',
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase100,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    position: 'sticky' as const,
    left: TYPE_LEFT_PX,
    zIndex: 1,
    whiteSpace: 'nowrap' as const,
    minWidth: TYPE_COL_PX,
  },
  resourceCell: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    whiteSpace: 'nowrap' as const,
    position: 'sticky' as const,
    left: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: 1,
    minWidth: RESOURCE_COL_PX,
    maxWidth: RESOURCE_COL_PX,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    verticalAlign: 'middle' as const,
  },
  projectCell: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    whiteSpace: 'nowrap' as const,
    position: 'sticky' as const,
    left: RESOURCE_COL_PX,
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: 1,
    minWidth: PROJECT_COL_PX,
    maxWidth: PROJECT_COL_PX,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    verticalAlign: 'middle' as const,
  },
  valueCell: {
    padding: '2px 2px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    textAlign: 'center' as const,
    width: PERIOD_COL_PX,
    minWidth: PERIOD_COL_PX,
  },
  cellInput: {
    width: '64px',
    textAlign: 'center' as const,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    borderRadius: tokens.borderRadiusSmall,
    padding: '2px 2px',
    fontSize: tokens.fontSizeBase200,
    outline: 'none',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  cellValue: {
    display: 'inline-block',
    minWidth: '42px',
    padding: '2px 4px',
    borderRadius: tokens.borderRadiusSmall,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase200,
    textAlign: 'center' as const,
    ':hover': { filter: 'brightness(0.92)' },
  },
  emptyCell: {
    color: tokens.colorNeutralForeground4,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase200,
    display: 'inline-block',
    minWidth: '42px',
    padding: '2px 4px',
    borderRadius: tokens.borderRadiusSmall,
    ':hover': { backgroundColor: tokens.colorNeutralBackground3 },
  },
  emptyCellReadonly: {
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase200,
    display: 'inline-block',
    minWidth: '42px',
    padding: '2px 4px',
  },
  addLineRow: {
    backgroundColor: tokens.colorNeutralBackground1,
  },
  addLineCell: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  addLineForm: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'center',
    flexWrap: 'wrap' as const,
  },
  cellEditable: {
    cursor: 'crosshair',
    ':hover': {
      backgroundColor: tokens.colorBrandBackground2,
      opacity: 0.8,
    },
  },
  cellSelected: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    outline: `2px solid ${tokens.colorBrandBackground}`,
    outlineOffset: '-2px',
  },
  cellDimmed: {
    opacity: 0.35,
    pointerEvents: 'none' as const,
  },
  matrixContainerSelecting: {
    userSelect: 'none' as const,
  },
  // Floating popover (replaces pinned edit toolbar)
  popover: {
    position: 'fixed' as const,
    zIndex: 1000,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow16,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    flexWrap: 'nowrap' as const,
  },
});

interface MergedMatrixRow {
  key: string;
  resourceId: string | null;
  resourceName: string;
  placeholderId: string | null;
  projectId: string | null;
  projectName: string;
  isGeneral: boolean;
  isPlaceholder: boolean;
  demandByPeriod: Map<string, DemandLine>;
  supplyByPeriod: Map<string, SupplyLine>;
}

interface ResourceGroup {
  resourceKey: string;
  resourceName: string;
  rows: MergedMatrixRow[];
}

interface MatrixGroup {
  ccId: string;
  ccName: string;
  resourceGroups: ResourceGroup[];
}

interface LocalRow {
  key: string;
  resourceId: string | null;
  resourceName: string;
  placeholderId: string | null;
  projectId: string | null;
  projectName: string;
  isGeneral: boolean;
  isPlaceholder: boolean;
}

interface SelectedResource {
  id: string;
  name: string;
  initials: string;
  ccId: string;
  type: 'resource' | 'placeholder';
}

export interface ResourcePlanningMatrixProps {
  demandLines: DemandLine[];
  supplyLines: SupplyLine[];
  periods: Period[];
  projects: Project[];
  costCenters: CostCenter[];
  canEditDemand: boolean;
  canEditSupply: boolean;
  onReload: () => void;
  userRole: string;
  managerCcId: string | null;
  allCostCenters: CostCenter[];
}

function parseResOrPh(val: string): { resourceId?: string; placeholderId?: string } {
  if (val.startsWith('r:')) return { resourceId: val.slice(2) };
  if (val.startsWith('ph:')) return { placeholderId: val.slice(3) };
  return {};
}

function buildResourceGroups(rows: MergedMatrixRow[]): ResourceGroup[] {
  const map = new Map<string, ResourceGroup>();
  for (const row of rows) {
    const rKey = row.resourceId ? `r:${row.resourceId}` : `ph:${row.placeholderId}`;
    if (!map.has(rKey)) {
      map.set(rKey, { resourceKey: rKey, resourceName: row.resourceName, rows: [] });
    }
    map.get(rKey)!.rows.push(row);
  }
  const result = Array.from(map.values());
  result.sort((a, b) => a.resourceName.localeCompare(b.resourceName));
  result.forEach(g => g.rows.sort((a, b) => a.projectName.localeCompare(b.projectName)));
  return result;
}

export const ResourcePlanningMatrix: React.FC<ResourcePlanningMatrixProps> = ({
  demandLines,
  supplyLines,
  periods,
  projects,
  costCenters,
  canEditDemand,
  canEditSupply,
  onReload,
  userRole,
  managerCcId,
  allCostCenters,
}) => {
  const styles = useStyles();
  const { showApiError } = useToast();

  const [expandedCCs, setExpandedCCs] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [addDemandCC, setAddDemandCC] = useState<string | null>(null);
  const [addSupplyCC, setAddSupplyCC] = useState<string | null>(null);
  const [addDemandForm, setAddDemandForm] = useState({ resOrPh: '', projectId: '' });
  const [addSupplyForm, setAddSupplyForm] = useState({ resourceId: '', projectId: '' });
  const [ccResources, setCcResources] = useState<Record<string, Resource[]>>({});
  const [ccPlaceholders, setCcPlaceholders] = useState<Record<string, Placeholder[]>>({});
  const [localDemandRows, setLocalDemandRows] = useState<Record<string, LocalRow[]>>({});
  const [localSupplyRows, setLocalSupplyRows] = useState<Record<string, LocalRow[]>>({});

  // Drag / bulk-edit state
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);

  // Refs for window event handlers (avoid stale closures)
  const isDraggingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Refs for sticky header + synced horizontal scrollbar
  const headerWrapRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fixedBarRef = useRef<HTMLDivElement>(null);
  const phantomRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const isSyncingScrollRef = useRef(false);
  const [dragStart, setDragStart] = useState<{
    cellKey: string;
    resourceId: string | null;
    placeholderId: string | null;
    projectId: string | null;
    periodId: string;
    type: 'demand' | 'supply';
    rowIndex: number;
    colIndex: number;
    ccId: string;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragType, setDragType] = useState<'demand' | 'supply' | null>(null);
  const [applyValue, setApplyValue] = useState<string>('');
  const [applying, setApplying] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Add Line dialog state
  const [addLineDialogOpen, setAddLineDialogOpen] = useState(false);
  const [dlgLineType, setDlgLineType] = useState<'demand' | 'supply'>('demand');
  const [dlgCcId, setDlgCcId] = useState('');
  const [dlgResourceQuery, setDlgResourceQuery] = useState('');
  const [dlgSelectedResources, setDlgSelectedResources] = useState<SelectedResource[]>([]);
  const [dlgProjectId, setDlgProjectId] = useState('');
  const [dlgSelectedPeriods, setDlgSelectedPeriods] = useState<Set<string>>(new Set());
  const [dlgFte, setDlgFte] = useState('');
  const [dlgSaving, setDlgSaving] = useState(false);
  const [dlgError, setDlgError] = useState<string | null>(null);
  const [dlgShowResourceDropdown, setDlgShowResourceDropdown] = useState(false);
  const [dlgAllResources, setDlgAllResources] = useState<Resource[]>([]);
  const [dlgAllPlaceholders, setDlgAllPlaceholders] = useState<Placeholder[]>([]);
  const [dlgPeriodDragging, setDlgPeriodDragging] = useState(false);
  const [dlgPeriodDragAdd, setDlgPeriodDragAdd] = useState(true);

  const groups = useMemo((): MatrixGroup[] => {
    const groupMap = new Map<string, { ccName: string; rowMap: Map<string, MergedMatrixRow> }>();

    const getOrCreate = (ccId: string, ccName: string) => {
      if (!groupMap.has(ccId)) groupMap.set(ccId, { ccName, rowMap: new Map() });
      return groupMap.get(ccId)!;
    };

    for (const line of demandLines) {
      if (!line.cost_center_id) continue;
      const g = getOrCreate(line.cost_center_id, line.cost_center_name || line.cost_center_id);
      const key = line.resource_id
        ? `r:${line.resource_id}|p:${line.project_id}`
        : `ph:${line.placeholder_id}|p:${line.project_id}`;
      if (!g.rowMap.has(key)) {
        g.rowMap.set(key, {
          key,
          resourceId: line.resource_id || null,
          resourceName: line.resource_name || line.resource_id || '—',
          placeholderId: line.placeholder_id || null,
          projectId: line.project_id,
          projectName: line.project_name || line.project_id,
          isGeneral: false,
          isPlaceholder: !!line.placeholder_id,
          demandByPeriod: new Map(),
          supplyByPeriod: new Map(),
        });
      }
      g.rowMap.get(key)!.demandByPeriod.set(line.period_id, line);
    }

    for (const line of supplyLines) {
      if (!line.cost_center_id) continue;
      const g = getOrCreate(line.cost_center_id, line.cost_center_name || line.cost_center_id);
      const isGeneral = !line.project_id;
      const key = `r:${line.resource_id}|p:${line.project_id || ''}`;
      if (!g.rowMap.has(key)) {
        g.rowMap.set(key, {
          key,
          resourceId: line.resource_id,
          resourceName: line.resource_name || line.resource_id,
          placeholderId: null,
          projectId: line.project_id || null,
          projectName: isGeneral ? 'General' : (line.project_name || line.project_id || '—'),
          isGeneral,
          isPlaceholder: false,
          demandByPeriod: new Map(),
          supplyByPeriod: new Map(),
        });
      }
      g.rowMap.get(key)!.supplyByPeriod.set(line.period_id, line);
    }

    for (const [ccId, rows] of Object.entries(localDemandRows)) {
      const ccName = costCenters.find(c => c.id === ccId)?.name || ccId;
      const g = getOrCreate(ccId, ccName);
      for (const row of rows) {
        if (!g.rowMap.has(row.key)) {
          g.rowMap.set(row.key, { ...row, demandByPeriod: new Map(), supplyByPeriod: new Map() });
        }
      }
    }

    for (const [ccId, rows] of Object.entries(localSupplyRows)) {
      const ccName = costCenters.find(c => c.id === ccId)?.name || ccId;
      const g = getOrCreate(ccId, ccName);
      for (const row of rows) {
        if (!g.rowMap.has(row.key)) {
          g.rowMap.set(row.key, { ...row, demandByPeriod: new Map(), supplyByPeriod: new Map() });
        }
      }
    }

    // Include all known cost centers so users can add lines to CCs with no existing lines
    for (const cc of costCenters) {
      if (!groupMap.has(cc.id)) {
        groupMap.set(cc.id, { ccName: cc.name, rowMap: new Map() });
      }
    }

    const result: MatrixGroup[] = Array.from(groupMap.entries()).map(([ccId, { ccName, rowMap }]) => ({
      ccId,
      ccName,
      resourceGroups: buildResourceGroups(Array.from(rowMap.values())),
    }));
    result.sort((a, b) => a.ccName.localeCompare(b.ccName));
    return result;
  }, [demandLines, supplyLines, costCenters, localDemandRows, localSupplyRows]);

  const isRoleManager = userRole === 'Manager';
  const isRolePM = userRole === 'PM';

  const dlgFilteredResources = useMemo(() => {
    const query = dlgResourceQuery.toLowerCase();
    const matchesResource = (r: Resource) =>
      !query ||
      r.display_name.toLowerCase().includes(query) ||
      (r.initials ? r.initials.toLowerCase().includes(query) : false);
    if (isRoleManager) {
      if (!dlgCcId) return { resources: [] as Resource[], placeholders: [] as Placeholder[] };
      const resources = (ccResources[dlgCcId] ?? []).filter(matchesResource);
      const placeholders = dlgLineType === 'demand'
        ? (ccPlaceholders[dlgCcId] ?? []).filter(ph => !query || ph.name.toLowerCase().includes(query))
        : [];
      return { resources, placeholders };
    }
    const resources = dlgAllResources.filter(matchesResource);
    const placeholders = dlgLineType === 'demand'
      ? dlgAllPlaceholders.filter(ph => !query || ph.name.toLowerCase().includes(query))
      : [];
    return { resources, placeholders };
  }, [isRoleManager, dlgCcId, dlgResourceQuery, dlgLineType, ccResources, ccPlaceholders, dlgAllResources, dlgAllPlaceholders]);

  const loadCcData = useCallback(async (ccId: string) => {
    const promises: Promise<void>[] = [];
    if (!ccResources[ccId]) {
      promises.push(
        lookupsApi.listResources(ccId).then(r => setCcResources(prev => ({ ...prev, [ccId]: r })))
      );
    }
    if (!ccPlaceholders[ccId]) {
      promises.push(
        lookupsApi.listPlaceholders(ccId).then(p => setCcPlaceholders(prev => ({ ...prev, [ccId]: p })))
      );
    }
    await Promise.all(promises);
  }, [ccResources, ccPlaceholders]);

  const handleExpandCC = useCallback(async (ccId: string) => {
    setExpandedCCs(prev => {
      const next = new Set(prev);
      if (next.has(ccId)) { next.delete(ccId); return next; }
      next.add(ccId);
      return next;
    });
    await loadCcData(ccId);
  }, [loadCcData]);

  const saveDemandCell = useCallback(async (
    cellKey: string,
    existingLine: DemandLine | undefined,
    row: MergedMatrixRow,
    period: Period,
    newValue: number,
  ) => {
    setSavingCells(prev => new Set(prev).add(cellKey));
    try {
      if (existingLine && newValue === 0) {
        await planningApi.deleteDemandLine(existingLine.id);
      } else if (existingLine) {
        await planningApi.updateDemandLine(existingLine.id, { fte_percent: newValue });
      } else if (newValue > 0) {
        await planningApi.createDemandLine({
          period_id: period.id,
          project_id: row.projectId || '',
          resource_id: row.resourceId || undefined,
          placeholder_id: row.placeholderId || undefined,
          fte_percent: newValue,
          year: period.year,
          month: period.month,
        });
      }
      onReload();
    } catch (err: any) {
      showApiError(err, 'Failed to save demand');
    } finally {
      setSavingCells(prev => { const s = new Set(prev); s.delete(cellKey); return s; });
      setEditingCell(null);
    }
  }, [onReload, showApiError]);

  const saveSupplyCell = useCallback(async (
    cellKey: string,
    existingLine: SupplyLine | undefined,
    row: MergedMatrixRow,
    period: Period,
    newValue: number,
  ) => {
    setSavingCells(prev => new Set(prev).add(cellKey));
    try {
      if (existingLine && newValue === 0) {
        await planningApi.deleteSupplyLine(existingLine.id);
      } else if (existingLine) {
        await planningApi.updateSupplyLine(existingLine.id, { fte_percent: newValue });
      } else if (newValue > 0) {
        await planningApi.createSupplyLine({
          period_id: period.id,
          resource_id: row.resourceId || '',
          project_id: row.projectId || undefined,
          fte_percent: newValue,
          year: period.year,
          month: period.month,
        });
      }
      onReload();
    } catch (err: any) {
      showApiError(err, 'Failed to save supply');
    } finally {
      setSavingCells(prev => { const s = new Set(prev); s.delete(cellKey); return s; });
      setEditingCell(null);
    }
  }, [onReload, showApiError]);

  const handleAddDemandLine = useCallback(async (ccId: string, allRows: MergedMatrixRow[]) => {
    const { resOrPh, projectId } = addDemandForm;
    if (!resOrPh || !projectId) return;

    const parsed = parseResOrPh(resOrPh);
    const resourceId = parsed.resourceId || null;
    const placeholderId = parsed.placeholderId || null;
    let resourceName = '—';
    if (resourceId) {
      resourceName = ccResources[ccId]?.find(r => r.id === resourceId)?.display_name || resourceId;
    } else if (placeholderId) {
      resourceName = ccPlaceholders[ccId]?.find(p => p.id === placeholderId)?.name || placeholderId;
    }
    const projectName = projects.find(p => p.id === projectId)?.name || projectId;
    const key = resourceId ? `r:${resourceId}|p:${projectId}` : `ph:${placeholderId}|p:${projectId}`;

    if (!allRows.find(r => r.key === key)) {
      const newRow: LocalRow = {
        key, resourceId, resourceName, placeholderId,
        projectId, projectName, isGeneral: false, isPlaceholder: !!placeholderId,
      };
      setLocalDemandRows(prev => ({ ...prev, [ccId]: [...(prev[ccId] ?? []), newRow] }));
    }
    setAddDemandCC(null);
    setAddDemandForm({ resOrPh: '', projectId: '' });
  }, [addDemandForm, ccResources, ccPlaceholders, projects]);

  const handleAddSupplyLine = useCallback(async (ccId: string, allRows: MergedMatrixRow[]) => {
    const { resourceId, projectId } = addSupplyForm;
    if (!resourceId) return;

    const isGeneral = !projectId;
    const resourceName = ccResources[ccId]?.find(r => r.id === resourceId)?.display_name || resourceId;
    const projectName = isGeneral ? 'General' : (projects.find(p => p.id === projectId)?.name || projectId);
    const key = `r:${resourceId}|p:${projectId}`;

    if (!allRows.find(r => r.key === key)) {
      const newRow: LocalRow = {
        key, resourceId, resourceName, placeholderId: null,
        projectId: projectId || null, projectName, isGeneral, isPlaceholder: false,
      };
      setLocalSupplyRows(prev => ({ ...prev, [ccId]: [...(prev[ccId] ?? []), newRow] }));
    }
    setAddSupplyCC(null);
    setAddSupplyForm({ resourceId: '', projectId: '' });
  }, [addSupplyForm, ccResources, projects]);

  // Window mouseup: finalize drag or clear click-only selection
  useEffect(() => {
    const up = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        if (hasDraggedRef.current) {
          setPopoverPos({ x: e.clientX, y: e.clientY });
        } else {
          // Just a click, not a real drag — clear so inline edit can work
          setSelectedCells(new Set());
        }
      }
      // flushSync ensures isDragging=false renders before the subsequent click event.
      // Without this, canEdit stays stale (false) during click and the inline editor never opens.
      flushSync(() => setIsDragging(false));
      isDraggingRef.current = false;
      hasDraggedRef.current = false;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []); // stable: only refs and stable state setters

  // Sync horizontal scroll: body ↔ sticky header ↔ fixed bottom scrollbar
  useEffect(() => {
    const header = headerWrapRef.current;
    const container = scrollContainerRef.current;
    const fixedBar = fixedBarRef.current;
    const phantom = phantomRef.current;
    const table = tableRef.current;
    if (!header || !container || !fixedBar || !phantom || !table) return;

    const updatePhantomWidth = () => {
      phantom.style.width = `${table.scrollWidth}px`;
    };
    updatePhantomWidth();

    const ro = new ResizeObserver(updatePhantomWidth);
    ro.observe(table);

    const onContainerScroll = () => {
      if (isSyncingScrollRef.current) return;
      isSyncingScrollRef.current = true;
      header.scrollLeft = container.scrollLeft;
      fixedBar.scrollLeft = container.scrollLeft;
      isSyncingScrollRef.current = false;
    };
    const onFixedBarScroll = () => {
      if (isSyncingScrollRef.current) return;
      isSyncingScrollRef.current = true;
      container.scrollLeft = fixedBar.scrollLeft;
      header.scrollLeft = fixedBar.scrollLeft;
      isSyncingScrollRef.current = false;
    };

    container.addEventListener('scroll', onContainerScroll);
    fixedBar.addEventListener('scroll', onFixedBarScroll);
    return () => {
      ro.disconnect();
      container.removeEventListener('scroll', onContainerScroll);
      fixedBar.removeEventListener('scroll', onFixedBarScroll);
    };
  }, []);

  // Click-outside closes popover
  useEffect(() => {
    if (!popoverPos) return;
    const handleDocMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setSelectedCells(new Set());
        setPopoverPos(null);
        setApplyValue('');
        setEditError(null);
      }
    };
    document.addEventListener('mousedown', handleDocMouseDown);
    return () => document.removeEventListener('mousedown', handleDocMouseDown);
  }, [popoverPos]);

  const handleCellMouseDown = useCallback((
    e: React.MouseEvent,
    cellKey: string,
    type: 'demand' | 'supply',
    rowIndex: number,
    colIndex: number,
    resourceId: string | null,
    placeholderId: string | null,
    projectId: string | null,
    periodId: string,
    ccId: string,
  ) => {
    e.preventDefault();
    e.stopPropagation(); // prevent click-outside from firing on cell clicks
    setIsDragging(true);
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    setDragType(type);
    setDragStart({ cellKey, resourceId, placeholderId, projectId, periodId, type, rowIndex, colIndex, ccId });
    setSelectedCells(new Set([cellKey]));
    setPopoverPos(null);
    setApplyValue('');
    setEditError(null);
  }, []);

  const handleCellMouseEnter = useCallback((
    rowIndex: number,
    colIndex: number,
    allGroupRows: MergedMatrixRow[],
    ccId: string,
  ) => {
    if (!isDragging || !dragStart || !dragType) return;
    if (dragStart.ccId !== ccId) return; // restrict to same cost center

    const minRow = Math.min(dragStart.rowIndex, rowIndex);
    const maxRow = Math.max(dragStart.rowIndex, rowIndex);
    const minCol = Math.min(dragStart.colIndex, colIndex);
    const maxCol = Math.max(dragStart.colIndex, colIndex);

    hasDraggedRef.current = true;
    const newSelection = new Set<string>();
    allGroupRows.forEach((row, flatIdx) => {
      const demandRowIdx = flatIdx * 2;
      const supplyRowIdx = flatIdx * 2 + 1;

      periods.forEach((period, pColIdx) => {
        if (pColIdx < minCol || pColIdx > maxCol) return;

        if (dragType === 'demand' && demandRowIdx >= minRow && demandRowIdx <= maxRow) {
          newSelection.add(buildCellKey('demand', row.resourceId, row.placeholderId, row.projectId, period.id));
        }
        if (dragType === 'supply' && supplyRowIdx >= minRow && supplyRowIdx <= maxRow) {
          newSelection.add(buildCellKey('supply', row.resourceId, row.placeholderId, row.projectId, period.id));
        }
      });
    });

    setSelectedCells(newSelection);
  }, [isDragging, dragStart, dragType, periods]);

  const handleApply = useCallback(async () => {
    const numVal = parseInt(applyValue, 10);
    if (selectedCells.size === 0 || isNaN(numVal)) return;

    // Validate FTE: 0 means delete; otherwise must be 5-100 in steps of 5
    if (numVal !== 0 && (numVal < 5 || numVal > 100 || numVal % 5 !== 0)) {
      setEditError('Value must be 0 (to clear) or between 5 and 100 in steps of 5');
      return;
    }

    setApplying(true);
    setEditError(null);

    try {
      const actions: Array<{ action: string; data: Record<string, unknown> }> = [];

      for (const cellKey of selectedCells) {
        const { type, resourceId, placeholderId, projectId, periodId } = parseCellKey(cellKey);
        const period = periods.find(p => p.id === periodId);
        if (!period) continue;

        if (type === 'demand') {
          const existingLine = demandLines.find(l =>
            (resourceId ? l.resource_id === resourceId : l.placeholder_id === placeholderId) &&
            (projectId === 'general' ? !l.project_id : l.project_id === projectId) &&
            l.period_id === periodId
          );
          if (existingLine && numVal > 0) {
            actions.push({ action: 'update', data: { id: existingLine.id, fte_percent: numVal } });
          } else if (existingLine && numVal === 0) {
            actions.push({ action: 'delete', data: { id: existingLine.id } });
          } else if (!existingLine && numVal > 0) {
            actions.push({ action: 'create', data: {
              period_id: periodId,
              project_id: projectId === 'general' ? null : projectId,
              resource_id: resourceId || null,
              placeholder_id: placeholderId || null,
              fte_percent: numVal,
              year: period.year,
              month: period.month,
            }});
          }
        } else {
          const existingLine = supplyLines.find(l =>
            l.resource_id === resourceId &&
            (projectId === 'general' ? !l.project_id : l.project_id === projectId) &&
            l.period_id === periodId
          );
          if (existingLine && numVal > 0) {
            actions.push({ action: 'update', data: { id: existingLine.id, fte_percent: numVal } });
          } else if (existingLine && numVal === 0) {
            actions.push({ action: 'delete', data: { id: existingLine.id } });
          } else if (!existingLine && numVal > 0) {
            actions.push({ action: 'create', data: {
              period_id: periodId,
              project_id: projectId === 'general' ? null : projectId,
              resource_id: resourceId || null,
              fte_percent: numVal,
              year: period.year,
              month: period.month,
            }});
          }
        }
      }

      if (actions.length > 0) {
        let resp: { results?: Array<{ status: string; error?: string | null }> };
        if (dragType === 'demand') {
          resp = await planningApi.bulkDemandLines({ actions });
        } else {
          resp = await planningApi.bulkSupplyLines({ actions });
        }
        const firstError = resp?.results?.find(r => r.status === 'error');
        if (firstError) {
          throw new Error(firstError.error ?? 'Bulk operation failed');
        }
      }

      onReload();
      setSelectedCells(new Set());
      setApplyValue('');
      setPopoverPos(null);
      setEditError(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to apply changes');
    } finally {
      setApplying(false);
    }
  }, [selectedCells, applyValue, dragType, demandLines, supplyLines, periods, onReload]);

  const handleClear = useCallback(async () => {
    if (selectedCells.size === 0) return;

    setApplying(true);
    setEditError(null);

    try {
      const actions: Array<{ action: string; data: Record<string, unknown> }> = [];

      for (const cellKey of selectedCells) {
        const { type, resourceId, placeholderId, projectId, periodId } = parseCellKey(cellKey);

        if (type === 'demand') {
          const existingLine = demandLines.find(l =>
            (resourceId ? l.resource_id === resourceId : l.placeholder_id === placeholderId) &&
            (projectId === 'general' ? !l.project_id : l.project_id === projectId) &&
            l.period_id === periodId
          );
          if (existingLine) {
            actions.push({ action: 'delete', data: { id: existingLine.id } });
          }
        } else {
          const existingLine = supplyLines.find(l =>
            l.resource_id === resourceId &&
            (projectId === 'general' ? !l.project_id : l.project_id === projectId) &&
            l.period_id === periodId
          );
          if (existingLine) {
            actions.push({ action: 'delete', data: { id: existingLine.id } });
          }
        }
      }

      if (actions.length > 0) {
        let resp: { results?: Array<{ status: string; error?: string | null }> };
        if (dragType === 'demand') {
          resp = await planningApi.bulkDemandLines({ actions });
        } else {
          resp = await planningApi.bulkSupplyLines({ actions });
        }
        const firstError = resp?.results?.find(r => r.status === 'error');
        if (firstError) {
          throw new Error(firstError.error ?? 'Bulk operation failed');
        }
        onReload();
      }

      setSelectedCells(new Set());
      setPopoverPos(null);
      setEditError(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to clear cells');
    } finally {
      setApplying(false);
    }
  }, [selectedCells, dragType, demandLines, supplyLines, onReload]);

  // For Manager: load CC resources when their CC is set in the dialog
  useEffect(() => {
    if (isRoleManager && dlgCcId) loadCcData(dlgCcId);
  }, [dlgCcId]); // eslint-disable-line react-hooks/exhaustive-deps

  // End period drag selection on global mouseup
  useEffect(() => {
    if (!dlgPeriodDragging) return;
    const handleUp = () => setDlgPeriodDragging(false);
    window.addEventListener('mouseup', handleUp);
    return () => window.removeEventListener('mouseup', handleUp);
  }, [dlgPeriodDragging]);

  const openAddLineDialog = useCallback(() => {
    const defaultLineType: 'demand' | 'supply' = isRolePM ? 'demand' : isRoleManager ? 'supply' : 'demand';
    const defaultCcId = isRoleManager ? (managerCcId || costCenters[0]?.id || '') : '';
    setDlgLineType(defaultLineType);
    setDlgCcId(defaultCcId);
    setDlgResourceQuery('');
    setDlgSelectedResources([]);
    setDlgProjectId('');
    setDlgSelectedPeriods(new Set());
    setDlgFte('');
    setDlgSaving(false);
    setDlgError(null);
    setDlgShowResourceDropdown(false);
    setDlgAllResources([]);
    setDlgAllPlaceholders([]);
    setDlgPeriodDragging(false);
    if (isRoleManager) {
      if (defaultCcId) loadCcData(defaultCcId);
    } else {
      lookupsApi.listResources().then(setDlgAllResources).catch(() => {});
      if (defaultLineType === 'demand') {
        lookupsApi.listPlaceholders().then(setDlgAllPlaceholders).catch(() => {});
      }
    }
    setAddLineDialogOpen(true);
  }, [isRolePM, isRoleManager, managerCcId, costCenters, loadCcData]);

  const handleDlgSave = useCallback(async () => {
    const fteVal = Number(dlgFte);

    if (dlgSelectedResources.length === 0) { setDlgError('Please select at least one resource'); return; }
    if (dlgSelectedPeriods.size === 0) { setDlgError('Please select at least one period'); return; }
    if (!dlgFte || isNaN(fteVal) || fteVal <= 0) { setDlgError('Please enter a valid FTE%'); return; }
    if (dlgLineType === 'demand' && !dlgProjectId) { setDlgError('Please select a project for demand lines'); return; }

    setDlgSaving(true);
    setDlgError(null);
    try {
      const actions: Array<{ action: string; data: Record<string, unknown> }> = [];
      for (const res of dlgSelectedResources) {
        for (const periodId of dlgSelectedPeriods) {
          const period = periods.find(p => p.id === periodId);
          if (!period) continue;
          if (dlgLineType === 'demand') {
            actions.push({ action: 'create', data: {
              period_id: periodId,
              project_id: dlgProjectId,
              resource_id: res.type === 'resource' ? res.id : undefined,
              placeholder_id: res.type === 'placeholder' ? res.id : undefined,
              fte_percent: fteVal,
              year: period.year,
              month: period.month,
            }});
          } else {
            actions.push({ action: 'create', data: {
              period_id: periodId,
              resource_id: res.id,
              project_id: dlgProjectId || undefined,
              fte_percent: fteVal,
              year: period.year,
              month: period.month,
            }});
          }
        }
      }
      if (actions.length > 0) {
        const resp = dlgLineType === 'demand'
          ? await planningApi.bulkDemandLines({ actions })
          : await planningApi.bulkSupplyLines({ actions });
        const firstError = resp?.results?.find((r: { status: string; error?: string | null }) => r.status === 'error');
        if (firstError) throw new Error(firstError.error ?? 'Bulk save failed');
      }
      onReload();
      setAddLineDialogOpen(false);
    } catch (err) {
      setDlgError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setDlgSaving(false);
    }
  }, [dlgSelectedResources, dlgFte, dlgSelectedPeriods, dlgLineType, dlgProjectId, periods, onReload]);

  const totalCols = 3 + periods.length;

  const getPopoverStyle = (pos: { x: number; y: number }): React.CSSProperties => {
    const W = 360;
    const H = 52;
    const margin = 8;
    const offsetY = 16;
    let left = pos.x;
    let top = pos.y + offsetY;
    if (left + W + margin > window.innerWidth) left = window.innerWidth - W - margin;
    if (left < margin) left = margin;
    if (top + H + margin > window.innerHeight) top = pos.y - H - margin;
    return { left, top };
  };

  return (
    <>
    {/* Floating popover for drag-select bulk editing */}
    {popoverPos && selectedCells.size > 0 && (
      <div
        ref={popoverRef}
        className={styles.popover}
        style={getPopoverStyle(popoverPos)}
        onMouseDown={e => e.stopPropagation()}
      >
        <span style={{ fontSize: tokens.fontSizeBase200, whiteSpace: 'nowrap', color: tokens.colorNeutralForeground2 }}>
          {selectedCells.size} cell{selectedCells.size !== 1 ? 's' : ''}
        </span>
        <input
          type="number"
          min={0}
          max={200}
          step={5}
          placeholder="FTE %"
          value={applyValue}
          onChange={e => setApplyValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleApply();
            if (e.key === 'Escape') { setSelectedCells(new Set()); setPopoverPos(null); }
          }}
          style={{
            width: '72px',
            padding: '3px 6px',
            border: `1px solid ${tokens.colorNeutralStroke1}`,
            borderRadius: tokens.borderRadiusSmall,
            fontSize: tokens.fontSizeBase200,
            outline: 'none',
          }}
          autoFocus
        />
        <span style={{ fontSize: tokens.fontSizeBase200 }}>%</span>
        <Button
          size="small"
          appearance="primary"
          disabled={applyValue === '' || applying}
          onClick={handleApply}
          icon={applying ? <Spinner size="extra-tiny" /> : undefined}
        >
          Apply
        </Button>
        <Button
          size="small"
          appearance="secondary"
          disabled={applying}
          onClick={handleClear}
        >
          Clear
        </Button>
        {editError && (
          <span style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorPaletteRedForeground2 }}>
            {editError}
          </span>
        )}
      </div>
    )}
    <div style={{ padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`, borderBottom: `2px solid ${tokens.colorNeutralStroke2}`, display: 'flex', alignItems: 'center' }}>
      <Button
        size="small"
        appearance="primary"
        icon={<Add24Regular />}
        onClick={openAddLineDialog}
      >
        Add Line
      </Button>
    </div>
    <div style={{ position: 'relative' }}>
    {/* Sticky header — lives outside the overflow-x container so vertical sticky works */}
    <div ref={headerWrapRef} className={styles.headerWrap}>
      <table className={styles.table} style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: RESOURCE_COL_PX, minWidth: RESOURCE_COL_PX }} />
          <col style={{ width: PROJECT_COL_PX, minWidth: PROJECT_COL_PX }} />
          <col style={{ width: TYPE_COL_PX, minWidth: TYPE_COL_PX }} />
          {periods.map(p => <col key={p.id} style={{ width: PERIOD_COL_PX, minWidth: PERIOD_COL_PX }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className={`${styles.th} ${styles.thResource}`} style={{ textAlign: 'left' }}>
              Resource
            </th>
            <th className={`${styles.th} ${styles.thProject}`} style={{ textAlign: 'left' }}>
              Project
            </th>
            <th className={`${styles.th} ${styles.thType}`} style={{ textAlign: 'left' }}>
              D / S
            </th>
            {periods.map(p => (
              <th
                key={p.id}
                className={styles.th}
                style={{ width: PERIOD_COL_PX, minWidth: PERIOD_COL_PX }}
              >
                {MONTH_SHORT[p.month - 1]} {p.year}
              </th>
            ))}
          </tr>
        </thead>
      </table>
    </div>
    {/* Body scroll container — overflow-x: auto without breaking vertical sticky */}
    <div ref={scrollContainerRef} className={mergeClasses(styles.wrapper, isDragging && styles.matrixContainerSelecting)}>
      <table ref={tableRef} className={styles.table} style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: RESOURCE_COL_PX, minWidth: RESOURCE_COL_PX }} />
          <col style={{ width: PROJECT_COL_PX, minWidth: PROJECT_COL_PX }} />
          <col style={{ width: TYPE_COL_PX, minWidth: TYPE_COL_PX }} />
          {periods.map(p => <col key={p.id} style={{ width: PERIOD_COL_PX, minWidth: PERIOD_COL_PX }} />)}
        </colgroup>
        <tbody>
          {groups.map(group => {
            const isExpanded = expandedCCs.has(group.ccId);
            const allRows = group.resourceGroups.flatMap(rg => rg.rows);

            const periodTotals = periods.map(p => {
              let dSum = 0, sSum = 0;
              for (const row of allRows) {
                dSum += row.demandByPeriod.get(p.id)?.fte_percent ?? 0;
                sSum += row.supplyByPeriod.get(p.id)?.fte_percent ?? 0;
              }
              return { dSum, sSum };
            });

            return (
              <React.Fragment key={group.ccId}>
                {/* CC summary row */}
                <tr
                  className={styles.summaryRow}
                  onClick={() => handleExpandCC(group.ccId)}
                >
                  <td className={styles.summaryFixed}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {isExpanded ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
                      {group.ccName}
                    </span>
                  </td>
                  <td className={styles.summaryProject} />
                  <td className={styles.summaryType} />
                  {periodTotals.map(({ dSum, sSum }, i) => (
                    <td key={periods[i].id} className={styles.summaryValueCell}>
                      <div style={{
                        backgroundColor: DEMAND_COLOR,
                        color: getFteColor(dSum)?.color ?? tokens.colorNeutralForeground3,
                      }}>
                        <span style={{ fontSize: '11px', fontWeight: 400 }}>D: </span>
                        <span style={{ fontSize: '13px', fontWeight: 600 }}>{dSum > 0 ? `${dSum}%` : '—'}</span>
                      </div>
                      <div style={{
                        backgroundColor: SUPPLY_COLOR,
                        color: getFteColor(sSum)?.color ?? tokens.colorNeutralForeground3,
                      }}>
                        <span style={{ fontSize: '11px', fontWeight: 400 }}>S: </span>
                        <span style={{ fontSize: '13px', fontWeight: 600 }}>{sSum > 0 ? `${sSum}%` : '—'}</span>
                      </div>
                    </td>
                  ))}
                </tr>

                {isExpanded && (
                  <>
                    {/* Resource groups → data rows (2 per MatrixRow: demand + supply) + Total row */}
                    {group.resourceGroups.map(rg => {
                      const rgPeriodTotals = periods.map(p => {
                        let dSum = 0, sSum = 0;
                        for (const r of rg.rows) {
                          dSum += r.demandByPeriod.get(p.id)?.fte_percent ?? 0;
                          sSum += r.supplyByPeriod.get(p.id)?.fte_percent ?? 0;
                        }
                        return { dSum, sSum };
                      });

                      return (
                        <React.Fragment key={rg.resourceKey}>
                          {rg.rows.map((row, rowIdx) => {
                            const totalRowSpan = rg.rows.length * 2;
                            const flatRowIndex = allRows.indexOf(row);
                            const demandRowIndex = flatRowIndex * 2;
                            const supplyRowIndex = flatRowIndex * 2 + 1;
                            const isFirstRow = rowIdx === 0;
                            const topBorder = isFirstRow ? `3px solid ${tokens.colorBrandBackground}` : undefined;
                            const demandBorderTop = isFirstRow ? `3px solid ${tokens.colorBrandBackground}` : `2px solid #93c5fd`;

                            return (
                              <React.Fragment key={row.key}>
                                {/* Demand row */}
                                <tr style={{ backgroundColor: DEMAND_COLOR }}>
                                  {isFirstRow && (() => {
                                    const initials = row.isPlaceholder
                                      ? '?'
                                      : row.resourceName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
                                    return (
                                      <td
                                        className={styles.resourceCell}
                                        rowSpan={totalRowSpan}
                                        title={row.resourceName}
                                        style={{
                                          ...(row.isPlaceholder ? { fontStyle: 'italic' } : {}),
                                          fontSize: '14px',
                                          fontWeight: 600,
                                          backgroundColor: tokens.colorNeutralBackground2,
                                          borderTop: topBorder,
                                          borderLeft: `3px solid ${tokens.colorBrandBackground}`,
                                        }}
                                      >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                          <div style={{
                                            flexShrink: 0,
                                            width: 28,
                                            height: 28,
                                            borderRadius: '50%',
                                            backgroundColor: tokens.colorBrandBackground,
                                            color: tokens.colorNeutralForegroundOnBrand,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '11px',
                                            fontWeight: 700,
                                          }}>
                                            {initials}
                                          </div>
                                          <div style={{ minWidth: 0 }}>
                                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              {row.resourceName}
                                            </div>
                                            {row.isPlaceholder && (
                                              <div style={{
                                                fontSize: tokens.fontSizeBase100,
                                                color: tokens.colorNeutralForeground3,
                                              }}>
                                                [TBD]
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </td>
                                    );
                                  })()}
                                  <td
                                    className={styles.projectCell}
                                    rowSpan={2}
                                    title={row.projectName}
                                    style={{
                                      ...(row.isGeneral ? { fontStyle: 'italic' } : {}),
                                      paddingLeft: '16px',
                                      color: tokens.colorNeutralForeground2,
                                      fontSize: '13px',
                                      fontWeight: 'normal',
                                      borderBottom: `1.5px solid ${tokens.colorNeutralStroke1}`,
                                      borderTop: demandBorderTop,
                                      borderLeft: '3px solid #93c5fd',
                                    }}
                                  >
                                    {row.projectName}
                                    {row.isGeneral && ' *'}
                                  </td>
                                  <td className={styles.typeCellDemand} style={{ borderTop: demandBorderTop }}>Demand</td>
                                  {periods.map((period, colIndex) => {
                                    const dLine = row.demandByPeriod.get(period.id);
                                    const sLine = row.supplyByPeriod.get(period.id);
                                    const dVal = dLine?.fte_percent ?? 0;
                                    const sVal = sLine?.fte_percent ?? 0;
                                    const existingCellKey = `d-${row.key}-${period.id}`;
                                    const dragCellKey = buildCellKey('demand', row.resourceId, row.placeholderId, row.projectId, period.id);
                                    const isSelectable = canEditDemand && !row.isGeneral;
                                    const canEdit = isSelectable && !isDragging;
                                    const isSelected = selectedCells.has(dragCellKey);
                                    const isDimmed = isDragging && dragType !== 'demand' && dragStart?.ccId === group.ccId;
                                    return (
                                      <td
                                        key={period.id}
                                        className={mergeClasses(
                                          styles.valueCell,
                                          isSelectable && styles.cellEditable,
                                          isSelected && styles.cellSelected,
                                          isDimmed && styles.cellDimmed,
                                        )}
                                        style={{ borderTop: demandBorderTop }}
                                        data-row-index={demandRowIndex}
                                        data-col-index={colIndex}
                                        data-cell-key={dragCellKey}
                                        data-type="demand"
                                        onMouseDown={isSelectable
                                          ? (e) => handleCellMouseDown(e, dragCellKey, 'demand', demandRowIndex, colIndex, row.resourceId, row.placeholderId, row.projectId, period.id, group.ccId)
                                          : undefined}
                                        onMouseEnter={isDragging
                                          ? () => handleCellMouseEnter(demandRowIndex, colIndex, allRows, group.ccId)
                                          : undefined}
                                      >
                                        <CellEditor
                                          value={dVal}
                                          colorStyle={getFteColor(dVal)}
                                          isEditing={editingCell === existingCellKey}
                                          isSaving={savingCells.has(existingCellKey)}
                                          canEdit={canEdit}
                                          onStartEdit={() => canEdit && setEditingCell(existingCellKey)}
                                          onCancel={() => setEditingCell(null)}
                                          onSave={val => saveDemandCell(existingCellKey, dLine, row, period, val)}
                                          styles={styles}
                                        />
                                      </td>
                                    );
                                  })}
                                </tr>
                                {/* Supply row */}
                                <tr style={{ backgroundColor: SUPPLY_COLOR }}>
                                  {/* resource and project cells spanned by rowSpan above */}
                                  <td className={styles.typeCellSupply} style={{ borderBottom: `1.5px solid ${tokens.colorNeutralStroke1}` }}>Supply</td>
                                  {periods.map((period, colIndex) => {
                                    const dLine = row.demandByPeriod.get(period.id);
                                    const sLine = row.supplyByPeriod.get(period.id);
                                    const dVal = dLine?.fte_percent ?? 0;
                                    const sVal = sLine?.fte_percent ?? 0;
                                    const existingCellKey = `s-${row.key}-${period.id}`;
                                    const dragCellKey = buildCellKey('supply', row.resourceId, row.placeholderId, row.projectId, period.id);
                                    const isSelectable = canEditSupply && !row.isPlaceholder;
                                    const canEdit = isSelectable && !isDragging;
                                    const isSelected = selectedCells.has(dragCellKey);
                                    const isDimmed = isDragging && dragType !== 'supply' && dragStart?.ccId === group.ccId;
                                    return (
                                      <td
                                        key={period.id}
                                        className={mergeClasses(
                                          styles.valueCell,
                                          isSelectable && styles.cellEditable,
                                          isSelected && styles.cellSelected,
                                          isDimmed && styles.cellDimmed,
                                        )}
                                        style={{ borderBottom: `1.5px solid ${tokens.colorNeutralStroke1}` }}
                                        data-row-index={supplyRowIndex}
                                        data-col-index={colIndex}
                                        data-cell-key={dragCellKey}
                                        data-type="supply"
                                        onMouseDown={isSelectable
                                          ? (e) => handleCellMouseDown(e, dragCellKey, 'supply', supplyRowIndex, colIndex, row.resourceId, row.placeholderId, row.projectId, period.id, group.ccId)
                                          : undefined}
                                        onMouseEnter={isDragging
                                          ? () => handleCellMouseEnter(supplyRowIndex, colIndex, allRows, group.ccId)
                                          : undefined}
                                      >
                                        <CellEditor
                                          value={sVal}
                                          colorStyle={getFteColor(sVal)}
                                          isEditing={editingCell === existingCellKey}
                                          isSaving={savingCells.has(existingCellKey)}
                                          canEdit={canEdit}
                                          onStartEdit={() => canEdit && setEditingCell(existingCellKey)}
                                          onCancel={() => setEditingCell(null)}
                                          onSave={val => saveSupplyCell(existingCellKey, sLine, row, period, val)}
                                          styles={styles}
                                        />
                                      </td>
                                    );
                                  })}
                                </tr>
                              </React.Fragment>
                            );
                          })}

                          {/* Resource Total row */}
                          <tr style={{ backgroundColor: tokens.colorNeutralBackground3 }}>
                            <td style={{
                              position: 'sticky',
                              left: 0,
                              zIndex: 1,
                              minWidth: RESOURCE_COL_PX,
                              fontWeight: 600,
                              fontSize: '12px',
                              color: tokens.colorNeutralForeground2,
                              paddingLeft: '8px',
                              paddingTop: '6px',
                              paddingBottom: '6px',
                              backgroundColor: tokens.colorNeutralBackground3,
                              borderBottom: `3px solid ${tokens.colorBrandBackground}`,
                              borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
                              borderLeft: `3px solid ${tokens.colorBrandBackground}`,
                            }}>
                              Total
                            </td>
                            <td style={{
                              position: 'sticky',
                              left: RESOURCE_COL_PX,
                              zIndex: 1,
                              minWidth: PROJECT_COL_PX,
                              backgroundColor: tokens.colorNeutralBackground3,
                              borderBottom: `3px solid ${tokens.colorBrandBackground}`,
                              borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
                            }} />
                            <td style={{
                              position: 'sticky',
                              left: TYPE_LEFT_PX,
                              zIndex: 1,
                              minWidth: TYPE_COL_PX,
                              backgroundColor: tokens.colorNeutralBackground3,
                              borderBottom: `3px solid ${tokens.colorBrandBackground}`,
                              fontSize: '11px',
                              fontWeight: tokens.fontWeightSemibold,
                              padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
                              whiteSpace: 'nowrap' as const,
                            }}>
                              <div style={{ color: '#1a3a7a', fontSize: '10px', fontWeight: 600 }}>Demand</div>
                              <div style={{ color: '#0a4a1a', fontSize: '10px', fontWeight: 600 }}>Supply</div>
                            </td>
                            {rgPeriodTotals.map(({ dSum, sSum }, i) => {
                              const diff = sSum - dSum;
                              const statusColor = (dSum === 0 && sSum === 0)
                                ? tokens.colorNeutralStroke1
                                : diff >= 0
                                  ? '#22c55e'
                                  : '#ef4444';

                              return (
                                <td key={periods[i].id} style={{
                                  textAlign: 'center',
                                  width: PERIOD_COL_PX,
                                  minWidth: PERIOD_COL_PX,
                                  padding: `4px ${tokens.spacingHorizontalXS}`,
                                  borderTop: `3px solid ${statusColor}`,
                                  borderBottom: `3px solid ${tokens.colorBrandBackground}`,
                                  verticalAlign: 'middle',
                                  backgroundColor: tokens.colorNeutralBackground3,
                                }}>
                                  <div style={{
                                    backgroundColor: '#dbeafe',
                                    color: '#1a3a7a',
                                    borderRadius: 2,
                                    padding: '1px 0',
                                  }}>
                                    <span style={{ fontSize: '10px', fontWeight: 400 }}>D: </span>
                                    <span style={{ fontSize: '12px', fontWeight: 600 }}>{dSum > 0 ? `${dSum}%` : '—'}</span>
                                  </div>
                                  <div style={{
                                    backgroundColor: '#dcfce7',
                                    color: '#0a4a1a',
                                    borderRadius: 2,
                                    padding: '1px 0',
                                  }}>
                                    <span style={{ fontSize: '10px', fontWeight: 400 }}>S: </span>
                                    <span style={{ fontSize: '12px', fontWeight: 600 }}>{sSum > 0 ? `${sSum}%` : '—'}</span>
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        </React.Fragment>
                      );
                    })}

                    {/* Add demand line */}
                    {canEditDemand && (
                      <tr className={styles.addLineRow}>
                        <td
                          className={styles.addLineCell}
                          colSpan={totalCols}
                          style={{ position: 'sticky', left: 0 }}
                        >
                          {addDemandCC === group.ccId ? (
                            <div className={styles.addLineForm}>
                              <Select
                                value={addDemandForm.resOrPh}
                                onChange={(_, d) => setAddDemandForm(f => ({ ...f, resOrPh: d.value }))}
                                style={{ minWidth: 200 }}
                              >
                                <option value="">Resource / Placeholder…</option>
                                {(ccResources[group.ccId] ?? []).length > 0 && (
                                  <optgroup label="Resources">
                                    {(ccResources[group.ccId] ?? []).map(r => (
                                      <option key={`r:${r.id}`} value={`r:${r.id}`}>{r.display_name}</option>
                                    ))}
                                  </optgroup>
                                )}
                                {(ccPlaceholders[group.ccId] ?? []).length > 0 && (
                                  <optgroup label="Placeholders">
                                    {(ccPlaceholders[group.ccId] ?? []).map(ph => (
                                      <option key={`ph:${ph.id}`} value={`ph:${ph.id}`}>{ph.name}</option>
                                    ))}
                                  </optgroup>
                                )}
                              </Select>
                              <Select
                                value={addDemandForm.projectId}
                                onChange={(_, d) => setAddDemandForm(f => ({ ...f, projectId: d.value }))}
                                style={{ minWidth: 160 }}
                              >
                                <option value="">Project…</option>
                                {projects.map(p => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </Select>
                              <Button
                                size="small"
                                appearance="primary"
                                onClick={() => handleAddDemandLine(group.ccId, allRows)}
                                disabled={!addDemandForm.resOrPh || !addDemandForm.projectId}
                              >
                                Add
                              </Button>
                              <Button
                                size="small"
                                appearance="subtle"
                                onClick={() => { setAddDemandCC(null); setAddDemandForm({ resOrPh: '', projectId: '' }); }}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="small"
                              appearance="subtle"
                              icon={<Add24Regular />}
                              onClick={async e => {
                                e.stopPropagation();
                                setAddDemandCC(group.ccId);
                                setAddDemandForm({ resOrPh: '', projectId: '' });
                                await loadCcData(group.ccId);
                              }}
                            >
                              Add demand line
                            </Button>
                          )}
                        </td>
                      </tr>
                    )}

                    {/* Add supply line */}
                    {canEditSupply && (
                      <tr className={styles.addLineRow}>
                        <td
                          className={styles.addLineCell}
                          colSpan={totalCols}
                          style={{ position: 'sticky', left: 0 }}
                        >
                          {addSupplyCC === group.ccId ? (
                            <div className={styles.addLineForm}>
                              <Select
                                value={addSupplyForm.resourceId}
                                onChange={(_, d) => setAddSupplyForm(f => ({ ...f, resourceId: d.value }))}
                                style={{ minWidth: 200 }}
                              >
                                <option value="">Resource…</option>
                                {(ccResources[group.ccId] ?? []).map(r => (
                                  <option key={r.id} value={r.id}>{r.display_name}</option>
                                ))}
                              </Select>
                              <Select
                                value={addSupplyForm.projectId}
                                onChange={(_, d) => setAddSupplyForm(f => ({ ...f, projectId: d.value }))}
                                style={{ minWidth: 180 }}
                              >
                                <option value="">— General availability —</option>
                                {projects.map(p => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </Select>
                              <Button
                                size="small"
                                appearance="primary"
                                onClick={() => handleAddSupplyLine(group.ccId, allRows)}
                                disabled={!addSupplyForm.resourceId}
                              >
                                Add
                              </Button>
                              <Button
                                size="small"
                                appearance="subtle"
                                onClick={() => { setAddSupplyCC(null); setAddSupplyForm({ resourceId: '', projectId: '' }); }}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="small"
                              appearance="subtle"
                              icon={<Add24Regular />}
                              onClick={async e => {
                                e.stopPropagation();
                                setAddSupplyCC(group.ccId);
                                setAddSupplyForm({ resourceId: '', projectId: '' });
                                await loadCcData(group.ccId);
                              }}
                            >
                              Add supply line
                            </Button>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )}
              </React.Fragment>
            );
          })}

          {groups.length === 0 && (
            <tr>
              <td
                colSpan={totalCols}
                style={{
                  padding: tokens.spacingVerticalXXL,
                  textAlign: 'center',
                  color: tokens.colorNeutralForeground3,
                }}
              >
                No cost centers found. Add cost centers before planning resources.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    <div
      ref={fixedBarRef}
      style={{
        position: 'sticky',
        bottom: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        height: '12px',
        background: tokens.colorNeutralBackground2,
        borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
      }}
    >
      <div ref={phantomRef} style={{ height: '1px' }} />
    </div>
    </div>

    {/* Add Line Dialog */}
    <Dialog open={addLineDialogOpen} onOpenChange={(_, d) => { if (!d.open && !dlgSaving) setAddLineDialogOpen(false); }}>
      <DialogSurface style={{ minWidth: 540 }}>
        <DialogBody>
          <DialogTitle>Add Line</DialogTitle>
          <DialogContent>
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, paddingTop: tokens.spacingVerticalS }}>

              {/* Line Type — Finance/Admin only; fixed label for PM and Manager */}
              {!isRolePM && !isRoleManager ? (
                <div>
                  <div style={{ marginBottom: 4, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold }}>Line Type</div>
                  <div style={{ display: 'flex', gap: tokens.spacingHorizontalL }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: tokens.fontSizeBase300 }}>
                      <input type="radio" name="dlgLineType" value="demand" checked={dlgLineType === 'demand'}
                        onChange={() => { setDlgLineType('demand'); setDlgSelectedResources([]); setDlgResourceQuery(''); setDlgCcId(''); lookupsApi.listPlaceholders().then(setDlgAllPlaceholders).catch(() => {}); }} />
                      Demand
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: tokens.fontSizeBase300 }}>
                      <input type="radio" name="dlgLineType" value="supply" checked={dlgLineType === 'supply'}
                        onChange={() => { setDlgLineType('supply'); setDlgSelectedResources(prev => prev.filter(r => r.type === 'resource')); setDlgResourceQuery(''); setDlgCcId(''); setDlgAllPlaceholders([]); }} />
                      Supply
                    </label>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 }}>
                  Line Type: <strong>{dlgLineType === 'demand' ? 'Demand' : 'Supply'}</strong>
                </div>
              )}

              {/* Cost Center — locked for Manager; auto-detected from selections for others */}
              {isRoleManager ? (
                <div>
                  <div style={{ marginBottom: 4, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold }}>Cost Center</div>
                  <div style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground3, fontSize: tokens.fontSizeBase300 }}>
                    {allCostCenters.find(c => c.id === dlgCcId)?.name || costCenters[0]?.name || '—'}
                  </div>
                </div>
              ) : dlgSelectedResources.length > 0 ? (
                <div style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 }}>
                  Cost Center: <strong>
                    {dlgSelectedResources.every(r => r.ccId === dlgSelectedResources[0].ccId)
                      ? (allCostCenters.find(c => c.id === dlgSelectedResources[0].ccId)?.name || dlgSelectedResources[0].ccId)
                      : 'Multiple'}
                  </strong>
                </div>
              ) : null}

              {/* Resource typeahead — multi-select */}
              <div>
                <div style={{ marginBottom: 4, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold }}>
                  Resource{dlgSelectedResources.length > 1 ? ` (${dlgSelectedResources.length} selected)` : ''}
                </div>

                {/* Selected chips */}
                {dlgSelectedResources.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                    {dlgSelectedResources.map(res => (
                      <span
                        key={res.id}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px 2px 4px', border: `1px solid ${tokens.colorBrandStroke1}`, borderRadius: tokens.borderRadiusCircular, backgroundColor: tokens.colorBrandBackground2, fontSize: tokens.fontSizeBase100 }}
                      >
                        <span style={{ background: tokens.colorBrandBackground, color: tokens.colorNeutralForegroundOnBrand, borderRadius: '50%', width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: tokens.fontWeightSemibold, flexShrink: 0 }}>
                          {res.initials}
                        </span>
                        {res.name}
                        <button
                          onMouseDown={e => { e.preventDefault(); setDlgSelectedResources(prev => prev.filter(r => r.id !== res.id)); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: 14, lineHeight: 1, color: tokens.colorBrandForeground1 }}
                          title="Remove"
                        >×</button>
                      </span>
                    ))}
                  </div>
                )}

                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={dlgResourceQuery}
                    onChange={e => { setDlgResourceQuery(e.target.value); setDlgShowResourceDropdown(true); }}
                    onFocus={() => setDlgShowResourceDropdown(true)}
                    onBlur={() => setTimeout(() => setDlgShowResourceDropdown(false), 150)}
                    placeholder="Type name or initials…"
                    disabled={isRoleManager && !dlgCcId}
                    style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, width: '100%', boxSizing: 'border-box' }}
                  />
                  {dlgShowResourceDropdown && (dlgFilteredResources.resources.length > 0 || dlgFilteredResources.placeholders.length > 0) && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000, background: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, boxShadow: tokens.shadow8, maxHeight: 220, overflowY: 'auto' }}>
                      {dlgFilteredResources.resources.length > 0 && (
                        <>
                          {dlgFilteredResources.placeholders.length > 0 && (
                            <div style={{ padding: '3px 8px', fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightSemibold, backgroundColor: tokens.colorNeutralBackground2 }}>
                              Resources
                            </div>
                          )}
                          {dlgFilteredResources.resources.map(r => {
                            const alreadySelected = dlgSelectedResources.some(s => s.id === r.id);
                            return (
                              <div
                                key={r.id}
                                onMouseDown={e => {
                                  e.preventDefault();
                                  if (!alreadySelected) {
                                    setDlgSelectedResources(prev => [...prev, {
                                      id: r.id,
                                      name: r.display_name,
                                      initials: r.initials || r.display_name.slice(0, 2).toUpperCase(),
                                      ccId: r.cost_center_id,
                                      type: 'resource',
                                    }]);
                                    setDlgCcId(r.cost_center_id);
                                  }
                                  setDlgResourceQuery('');
                                }}
                                style={{ padding: '6px 8px', cursor: alreadySelected ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: tokens.fontSizeBase200, opacity: alreadySelected ? 0.5 : 1 }}
                                onMouseEnter={e => { if (!alreadySelected) e.currentTarget.style.backgroundColor = tokens.colorNeutralBackground3; }}
                                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                              >
                                <span style={{ background: tokens.colorBrandBackground2, color: tokens.colorBrandForeground1, borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: tokens.fontSizeBase100, fontWeight: tokens.fontWeightSemibold, flexShrink: 0 }}>
                                  {r.initials || r.display_name.slice(0, 2).toUpperCase()}
                                </span>
                                {r.display_name}
                                {alreadySelected && <span style={{ marginLeft: 'auto', fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 }}>✓</span>}
                              </div>
                            );
                          })}
                        </>
                      )}
                      {dlgFilteredResources.placeholders.length > 0 && (
                        <>
                          <div style={{ padding: '3px 8px', fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightSemibold, backgroundColor: tokens.colorNeutralBackground2 }}>
                            Placeholders
                          </div>
                          {dlgFilteredResources.placeholders.map(ph => {
                            const alreadySelected = dlgSelectedResources.some(s => s.id === ph.id);
                            return (
                              <div
                                key={ph.id}
                                onMouseDown={e => {
                                  e.preventDefault();
                                  if (!alreadySelected) {
                                    setDlgSelectedResources(prev => [...prev, {
                                      id: ph.id,
                                      name: ph.name,
                                      initials: '?',
                                      ccId: ph.cost_center_id,
                                      type: 'placeholder',
                                    }]);
                                    setDlgCcId(ph.cost_center_id);
                                  }
                                  setDlgResourceQuery('');
                                }}
                                style={{ padding: '6px 8px', cursor: alreadySelected ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: tokens.fontSizeBase200, fontStyle: 'italic', opacity: alreadySelected ? 0.5 : 1 }}
                                onMouseEnter={e => { if (!alreadySelected) e.currentTarget.style.backgroundColor = tokens.colorNeutralBackground3; }}
                                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                              >
                                <span style={{ background: tokens.colorNeutralBackground3, borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: tokens.fontSizeBase100, flexShrink: 0 }}>?</span>
                                {ph.name} [TBD]
                                {alreadySelected && <span style={{ marginLeft: 'auto', fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 }}>✓</span>}
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Project — required for Demand, optional for Supply */}
              <div>
                <div style={{ marginBottom: 4, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold }}>
                  Project{dlgLineType === 'supply' ? ' (optional)' : ''}
                </div>
                <select
                  value={dlgProjectId}
                  onChange={e => setDlgProjectId(e.target.value)}
                  style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, minWidth: 240 }}
                >
                  <option value="">{dlgLineType === 'supply' ? '— General availability —' : 'Select project…'}</option>
                  {projects.filter(p => p.is_active).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Periods — drag to select multiple */}
              <div>
                <div style={{ marginBottom: 6, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold }}>Periods</div>
                <div style={{ display: 'flex', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' }}>
                  {periods.map(p => (
                    <label
                      key={p.id}
                      onMouseDown={e => {
                        e.preventDefault();
                        const willAdd = !dlgSelectedPeriods.has(p.id);
                        setDlgPeriodDragging(true);
                        setDlgPeriodDragAdd(willAdd);
                        const next = new Set(dlgSelectedPeriods);
                        if (willAdd) next.add(p.id); else next.delete(p.id);
                        setDlgSelectedPeriods(next);
                      }}
                      onMouseEnter={() => {
                        if (!dlgPeriodDragging) return;
                        const next = new Set(dlgSelectedPeriods);
                        if (dlgPeriodDragAdd) next.add(p.id); else next.delete(p.id);
                        setDlgSelectedPeriods(next);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: tokens.fontSizeBase200, padding: '3px 8px', border: `1px solid ${dlgSelectedPeriods.has(p.id) ? tokens.colorBrandStroke1 : tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, backgroundColor: dlgSelectedPeriods.has(p.id) ? tokens.colorBrandBackground2 : 'transparent', userSelect: 'none' }}
                    >
                      <input
                        type="checkbox"
                        checked={dlgSelectedPeriods.has(p.id)}
                        readOnly
                        style={{ margin: 0, pointerEvents: 'none' }}
                      />
                      {MONTH_SHORT[p.month - 1]} {p.year}
                    </label>
                  ))}
                </div>
              </div>

              {/* FTE % */}
              <div>
                <div style={{ marginBottom: 4, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold }}>FTE %</div>
                <input
                  type="number"
                  value={dlgFte}
                  onChange={e => setDlgFte(e.target.value)}
                  min={1}
                  max={200}
                  step={5}
                  placeholder="e.g. 100"
                  style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, width: 100 }}
                />
              </div>

              {dlgError && (
                <div style={{ color: tokens.colorPaletteRedForeground2, fontSize: tokens.fontSizeBase200 }}>
                  {dlgError}
                </div>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => setAddLineDialogOpen(false)} disabled={dlgSaving}>
              Cancel
            </Button>
            <Button
              appearance="primary"
              onClick={handleDlgSave}
              disabled={dlgSaving}
              icon={dlgSaving ? <Spinner size="extra-tiny" /> : undefined}
            >
              Save
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
    </>
  );
};

interface CellEditorProps {
  value: number;
  colorStyle?: { background: string; color: string };
  isEditing: boolean;
  isSaving: boolean;
  canEdit: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (value: number) => void;
  styles: ReturnType<typeof useStyles>;
}

const CellEditor: React.FC<CellEditorProps> = ({
  value,
  colorStyle,
  isEditing,
  isSaving,
  canEdit,
  onStartEdit,
  onCancel,
  onSave,
  styles,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputVal, setInputVal] = useState('');
  // Prevents double-commit: when Enter is pressed, saveDemandCell queues a re-render
  // that unmounts the input, firing onBlur which would call commit() a second time.
  const committedRef = useRef(false);

  const handleStartEdit = () => {
    committedRef.current = false;
    setInputVal(value > 0 ? String(value) : '');
    onStartEdit();
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const num = inputVal === '' ? 0 : parseInt(inputVal, 10);
    if (isNaN(num)) { committedRef.current = false; onCancel(); return; }
    onSave(num);
  };

  if (isSaving) return <Spinner size="extra-tiny" />;

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={0}
        max={200}
        step={5}
        value={inputVal}
        className={styles.cellInput}
        onChange={e => setInputVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={commit}
        autoFocus
      />
    );
  }

  if (value > 0) {
    return (
      <span
        className={styles.cellValue}
        style={colorStyle ?? { backgroundColor: 'transparent' }}
        onClick={canEdit ? handleStartEdit : undefined}
        title={canEdit ? 'Click to edit' : undefined}
      >
        {value}%
      </span>
    );
  }

  if (canEdit) {
    return (
      <span className={styles.emptyCell} onClick={handleStartEdit} title="Click to add">
        —
      </span>
    );
  }

  return <span className={styles.emptyCellReadonly}>—</span>;
};

export default ResourcePlanningMatrix;
