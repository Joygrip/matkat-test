import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { flushSync, createPortal } from 'react-dom';
import {
  Button,
  Spinner,
  FluentProvider,
  tokens,
  makeStyles,
  mergeClasses,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogActions,
  DialogContent,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  Tooltip,
} from '@fluentui/react-components';
import { Add24Regular, ChevronRight20Regular, ChevronDown20Regular, MoreHorizontalRegular } from '@fluentui/react-icons';
import { planningApi, DemandLine, SupplyLine, MoveDemandGroupRequest, DeleteSupplyGroupRequest, MoveSupplyGroupRequest, MoveCapPeriodDetail } from '../api/planning';
import { ApiError } from '../types';
import { useToast } from '../hooks/useToast';
import { lookupsApi, Project, CostCenter, Resource, Placeholder } from '../api/lookups';
import { Period } from '../types/index';
import { MONTH_SHORT } from '../utils/format';
import { avatarColor, getInitials } from '../utils/avatar';
import { ferrosanTheme } from '../theme/ferrosanTheme';

const RESOURCE_COL_WIDTH = 180;
const PROJECT_COL_WIDTH = 150;
const TYPE_COL_WIDTH = 80;
const PERIOD_COL_WIDTH = 88;
const RESOURCE_COL_PX = `${RESOURCE_COL_WIDTH}px`;
const PROJECT_COL_PX = `${PROJECT_COL_WIDTH}px`;
const TYPE_COL_PX = `${TYPE_COL_WIDTH}px`;
const PERIOD_COL_PX = `${PERIOD_COL_WIDTH}px`;
const TYPE_LEFT = RESOURCE_COL_WIDTH + PROJECT_COL_WIDTH;
const TYPE_LEFT_PX = `${TYPE_LEFT}px`;

const DEMAND_ROW_BG   = 'rgba(217, 119, 6, 0.10)';
const SUPPLY_ROW_BG   = 'rgba(13, 148, 136, 0.10)';
const DEMAND_TYPE_BG  = 'rgba(217, 119, 6, 0.10)';
const SUPPLY_TYPE_BG  = 'rgba(13, 148, 136, 0.10)';
const DEMAND_ACCENT   = '#d97706';
const SUPPLY_ACCENT   = '#0d9488';
const COL_HOVER_HDR_BG = 'rgba(30, 58, 95, 0.12)';


const AVATAR_PALETTES = [
  '#1e3a5f', '#a32f2a', '#2d6a4f', '#5a4b8a',
  '#8b5e3c', '#1a5c8a', '#6b3a4f', '#3a6b3a',
];
function nameHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function getAvatarBg(name: string): string {
  return AVATAR_PALETTES[nameHash(name) % AVATAR_PALETTES.length];
}
function isCurrentPeriod(p: { year: number; month: number }): boolean {
  const now = new Date();
  return p.year === now.getFullYear() && p.month === (now.getMonth() + 1);
}
function getPipColor(dSum: number, sSum: number): string {
  if (dSum === 0 && sSum === 0) return '#cfcfcc';
  if (sSum >= dSum) return '#22c55e';
  return (dSum - sSum) / dSum >= 0.5 ? '#ef4444' : '#f59e0b';
}

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
    backgroundColor: '#f6f5f2',
    textAlign: 'center' as const,
    whiteSpace: 'nowrap' as const,
    verticalAlign: 'bottom' as const,
  },
  thResource: {
    position: 'sticky' as const,
    left: 0,
    zIndex: 4,
    textAlign: 'left' as const,
    minWidth: RESOURCE_COL_PX,
    backgroundColor: '#f6f5f2',
  },
  thProject: {
    position: 'sticky' as const,
    left: RESOURCE_COL_PX,
    zIndex: 4,
    textAlign: 'left' as const,
    minWidth: PROJECT_COL_PX,
    backgroundColor: '#f6f5f2',
  },
  thType: {
    position: 'sticky' as const,
    left: TYPE_LEFT_PX,
    zIndex: 4,
    textAlign: 'left' as const,
    minWidth: TYPE_COL_PX,
    backgroundColor: '#f6f5f2',
  },
  summaryRow: {
    backgroundColor: '#f1efeb',
    cursor: 'pointer',
    borderTop: '1px solid #e5e4e0',
    borderBottom: '1px solid #e5e4e0',
    ':hover': { filter: 'brightness(0.97)' },
  },
  summaryFixed: {
    fontWeight: 700,
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: '1px solid #e5e4e0',
    borderTop: '1px solid #e5e4e0',
    whiteSpace: 'nowrap' as const,
    position: 'sticky' as const,
    left: 0,
    backgroundColor: '#f1efeb',
    zIndex: 1,
    minWidth: RESOURCE_COL_PX,
  },
  summaryProject: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: '1px solid #e5e4e0',
    borderTop: '1px solid #e5e4e0',
    position: 'sticky' as const,
    left: RESOURCE_COL_PX,
    backgroundColor: '#f1efeb',
    zIndex: 1,
    minWidth: PROJECT_COL_PX,
  },
  summaryType: {
    padding: `2px ${tokens.spacingHorizontalXS}`,
    borderBottom: '1px solid #e5e4e0',
    borderTop: '1px solid #e5e4e0',
    position: 'sticky' as const,
    left: TYPE_LEFT_PX,
    backgroundColor: '#f1efeb',
    zIndex: 1,
    minWidth: TYPE_COL_PX,
  },
  summaryValueCell: {
    padding: `6px ${tokens.spacingHorizontalXS}`,
    borderBottom: '1px solid #e5e4e0',
    borderTop: '1px solid #e5e4e0',
    textAlign: 'center' as const,
    width: PERIOD_COL_PX,
    minWidth: PERIOD_COL_PX,
    verticalAlign: 'middle' as const,
    backgroundColor: '#f1efeb',
  },
  typeCellDemand: {
    backgroundColor: DEMAND_TYPE_BG,
    color: DEMAND_ACCENT,
    fontWeight: 600,
    fontSize: '10.5px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    boxShadow: `inset 3px 0 0 ${DEMAND_ACCENT}`,
    position: 'sticky' as const,
    left: TYPE_LEFT_PX,
    zIndex: 1,
    whiteSpace: 'nowrap' as const,
    minWidth: TYPE_COL_PX,
  },
  typeCellSupply: {
    backgroundColor: SUPPLY_TYPE_BG,
    color: SUPPLY_ACCENT,
    fontWeight: 600,
    fontSize: '10.5px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    boxShadow: `inset 3px 0 0 ${SUPPLY_ACCENT}`,
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
    padding: '2px 4px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    textAlign: 'center' as const,
    width: PERIOD_COL_PX,
    minWidth: PERIOD_COL_PX,
    fontFamily: 'monospace',
    fontSize: '12.5px',
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
    color: '#cfcfcc',
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase200,
    display: 'inline-block',
    minWidth: '42px',
    padding: '2px 4px',
    borderRadius: tokens.borderRadiusSmall,
    ':hover': { backgroundColor: tokens.colorNeutralBackground3 },
  },
  emptyCellReadonly: {
    color: '#cfcfcc',
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
  // Transfer selection highlight — grape/purple, distinct from drag-select (brand blue),
  // demand (amber), and supply (teal)
  cellTransferSelected: {
    backgroundColor: 'rgba(118, 74, 188, 0.15)',
    outline: '2px solid rgba(118, 74, 188, 0.72)',
    outlineOffset: '-2px',
  },
  // Payload drag preview: valid mapped target cell
  cellPayloadPreviewTarget: {
    outline: '2px dashed rgba(118, 74, 188, 0.85)',
    outlineOffset: '-2px',
    backgroundColor: 'rgba(118, 74, 188, 0.08)',
  },
  // Payload drag error: invalid drop target cell
  cellPayloadDropError: {
    outline: '2px dashed rgba(220, 38, 38, 0.85)',
    outlineOffset: '-2px',
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
  actionDialogContent: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    paddingTop: '2px',
  },
  actionDialogBodyText: {
    fontSize: '13px',
    lineHeight: '1.45',
    color: tokens.colorNeutralForeground1,
  },
  actionDialogSecondary: {
    fontSize: '12px',
    lineHeight: '1.45',
    color: tokens.colorNeutralForeground3,
  },
  actionDialogError: {
    fontSize: '12px',
    color: tokens.colorPaletteRedForeground2,
  },
});

const dlgSurfaceDelete = { maxWidth: 420, borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)', padding: '20px 24px' };
const dlgSurfaceMove = { maxWidth: 480, borderRadius: 10, overflow: 'visible' as const, boxShadow: '0 4px 20px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)', padding: '20px 24px' };
const dlgTitleStyle = { fontSize: 18, fontWeight: 600, lineHeight: 1.3, marginBottom: 12 };
const compactBtn = { height: 34, padding: '0 14px', borderRadius: 6, fontSize: 13, fontWeight: 500, minWidth: 0, whiteSpace: 'nowrap' as const, display: 'inline-flex' as const, alignItems: 'center' as const, justifyContent: 'center' as const };
const dangerBtn = { height: 34, padding: '0 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, minWidth: 0, whiteSpace: 'nowrap' as const, display: 'inline-flex' as const, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: '#C92A2A', borderColor: '#C92A2A' };

interface MergedMatrixRow {
  key: string;
  resourceId: string | null;
  resourceName: string;
  resourceInitials: string | null;
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
  resourceInitials: string | null;
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

type SelectedPlanningCell = {
  rowKey: string;
  lineType: 'demand' | 'supply';
  sourceResourceId: string | null;
  sourcePlaceholderId: string | null;
  sourceProjectId: string | null;
  periodId: string;
  year: number;
  month: number;
  value: number;
  costCenterId: string | null;
  // display helpers for the action bar
  sourceName: string;
  sourceProjectName: string;
};

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
  managedCcIds: Set<string>;
  allCostCenters: CostCenter[];
  /** When set (Manager/ManagerReader), restricts the supply Add Line CC dropdown to own + delegated CCs. */
  editableCcIds?: Set<string>;
  /** True when user has effective PM capability (primary PM or Manager+PM secondary role). */
  canPM?: boolean;
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

// Pure helper: given sorted transferSelection and a hover target cell, compute the
// period_mappings that would be sent to the backend (from → to). Returns null mappings
// plus an error string when the target window doesn't contain all mapped periods.
function computePayloadMappings(
  sortedSelection: SelectedPlanningCell[],
  targetYear: number,
  targetMonth: number,
  allPeriods: Period[],
): { mappings: Array<{ fromId: string; toId: string }> | null; error: string | null } {
  if (sortedSelection.length === 0) return { mappings: [], error: null };
  const baseNum = sortedSelection[0].year * 12 + sortedSelection[0].month;
  const targetNum = targetYear * 12 + targetMonth;
  const mappings: Array<{ fromId: string; toId: string }> = [];
  for (const cell of sortedSelection) {
    const offset = cell.year * 12 + cell.month - baseNum;
    const toNum = targetNum + offset;
    // Reverse: year * 12 + month = toNum  (month is 1-based)
    const toYear = Math.floor((toNum - 1) / 12);
    const toMonth = ((toNum - 1) % 12) + 1;
    const targetPeriod = allPeriods.find(p => p.year === toYear && p.month === toMonth);
    if (!targetPeriod) return { mappings: null, error: 'Target period is outside the visible window' };
    if (targetPeriod.status === 'locked') {
      return { mappings: null, error: `Target period ${MONTH_SHORT[toMonth - 1]} ${toYear} is locked` };
    }
    mappings.push({ fromId: cell.periodId, toId: targetPeriod.id });
  }
  return { mappings, error: null };
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
  managedCcIds,
  allCostCenters,
  editableCcIds,
  canPM = false,
}) => {
  const styles = useStyles();
  const { showApiError, showSuccess, showInfo } = useToast();

  const [expandedCCs, setExpandedCCs] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [addDemandCC, setAddDemandCC] = useState<string | null>(null);
  const [addSupplyCC, setAddSupplyCC] = useState<string | null>(null);
  const [addDemandForm, setAddDemandForm] = useState({ resOrPh: '', projectId: '' });
  const [addSupplyForm, setAddSupplyForm] = useState({ resourceId: '', projectId: '' });
  const [addDemandResQuery, setAddDemandResQuery] = useState('');
  const [addDemandResDropdownOpen, setAddDemandResDropdownOpen] = useState(false);
  const [addDemandProjectQuery, setAddDemandProjectQuery] = useState('');
  const [addDemandProjectDropdownOpen, setAddDemandProjectDropdownOpen] = useState(false);
  const [addSupplyResQuery, setAddSupplyResQuery] = useState('');
  const [addSupplyResDropdownOpen, setAddSupplyResDropdownOpen] = useState(false);
  const [addSupplyProjectQuery, setAddSupplyProjectQuery] = useState('');
  const [addSupplyProjectDropdownOpen, setAddSupplyProjectDropdownOpen] = useState(false);
  const [ccResources, setCcResources] = useState<Record<string, Resource[]>>({});
  const [ccPlaceholders, setCcPlaceholders] = useState<Record<string, Placeholder[]>>({});
  const [localDemandRows, setLocalDemandRows] = useState<Record<string, LocalRow[]>>({});
  const [localSupplyRows, setLocalSupplyRows] = useState<Record<string, LocalRow[]>>({});

  // Drag / bulk-edit state
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);

  // Transfer selection state — separate from drag/bulk-edit; toggled by Ctrl/Meta+click
  const [transferSelection, setTransferSelection] = useState<SelectedPlanningCell[]>([]);

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
  // Refs for portal-positioned inline add-row dropdowns
  const addDemandResInputRef = useRef<HTMLInputElement>(null);
  const addDemandProjectInputRef = useRef<HTMLInputElement>(null);
  const addSupplyResInputRef = useRef<HTMLInputElement>(null);
  const addSupplyProjectInputRef = useRef<HTMLInputElement>(null);
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

  // Payload drag — started from the drag handle on the last transfer-selected cell.
  const [isPayloadDragging, setIsPayloadDragging] = useState(false);
  const isPayloadDraggingRef = useRef(false);
  const [payloadDragCursorPos, setPayloadDragCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [payloadDropTarget, setPayloadDropTarget] = useState<{
    periodId: string; year: number; month: number;
    rowKey: string; lineType: 'demand' | 'supply';
    resourceId: string | null; placeholderId: string | null; projectId: string | null;
  } | null>(null);
  const [payloadOperation, setPayloadOperation] = useState<'move' | 'copy'>('move');
  const [payloadDropError, setPayloadDropError] = useState<string | null>(null);
  const [payloadPreviewPeriodIds, setPayloadPreviewPeriodIds] = useState<Set<string>>(new Set());
  // Refs used inside the window event handlers to avoid stale closures
  const sortedTransferRef = useRef<SelectedPlanningCell[]>([]);
  const periodsRef = useRef<Period[]>([]);
  const payloadDropTargetRef = useRef<typeof payloadDropTarget>(null);
  const payloadDropErrorRef = useRef<string | null>(null);
  const payloadOperationRef = useRef<'move' | 'copy'>('move');
  const payloadMappingsRef = useRef<Array<{ fromId: string; toId: string }>>([]);
  const handlePayloadDropRef = useRef<(() => Promise<void>) | null>(null);

  const [hoveredColIdx, setHoveredColIdx] = useState<number | null>(null);
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [dragType, setDragType] = useState<'demand' | 'supply' | null>(null);
  const [applyValue, setApplyValue] = useState<string>('');
  const [applying, setApplying] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete group dialog state
  const [deleteGroupRow, setDeleteGroupRow] = useState<MergedMatrixRow | null>(null);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [deleteGroupError, setDeleteGroupError] = useState<string | null>(null);

  // Delete supply group dialog state
  const [deleteSupplyGroupRow, setDeleteSupplyGroupRow] = useState<MergedMatrixRow | null>(null);
  const [deletingSupplyGroup, setDeletingSupplyGroup] = useState(false);
  const [deleteSupplyGroupError, setDeleteSupplyGroupError] = useState<string | null>(null);

  // Move supply group dialog state
  const [moveSupplyGroupRow, setMoveSupplyGroupRow] = useState<MergedMatrixRow | null>(null);
  const [movingSupplyGroup, setMovingSupplyGroup] = useState(false);
  const [moveSupplyGroupError, setMoveSupplyGroupError] = useState<string | null>(null);
  const [moveSupplyTargetId, setMoveSupplyTargetId] = useState('');
  const [moveSupplyAllResources, setMoveSupplyAllResources] = useState<Resource[]>([]);
  const [moveSupplyResourcesLoading, setMoveSupplyResourcesLoading] = useState(false);
  const [moveSupplyTargetProjectId, setMoveSupplyTargetProjectId] = useState('');
  const [moveSupplyAllProjects, setMoveSupplyAllProjects] = useState<Project[]>([]);
  const [moveSupplyProjectsLoading, setMoveSupplyProjectsLoading] = useState(false);
  const [moveSupplyProjectQuery, setMoveSupplyProjectQuery] = useState('');
  const [moveSupplyProjectDropdownOpen, setMoveSupplyProjectDropdownOpen] = useState(false);

  // Move group dialog state
  const [moveGroupRow, setMoveGroupRow] = useState<MergedMatrixRow | null>(null);
  const [movingGroup, setMovingGroup] = useState(false);
  const [moveGroupError, setMoveGroupError] = useState<string | null>(null);
  const [moveTargetId, setMoveTargetId] = useState('');
  const [moveAllResources, setMoveAllResources] = useState<Resource[]>([]);
  const [moveResourcesLoading, setMoveResourcesLoading] = useState(false);
  const [moveDemandQuery, setMoveDemandQuery] = useState('');
  const [moveDemandDropdownOpen, setMoveDemandDropdownOpen] = useState(false);
  const [moveSupplyQuery, setMoveSupplyQuery] = useState('');
  const [moveSupplyDropdownOpen, setMoveSupplyDropdownOpen] = useState(false);
  const [moveTargetProjectId, setMoveTargetProjectId] = useState('');
  const [moveDemandAllProjects, setMoveDemandAllProjects] = useState<Project[]>([]);
  const [moveDemandProjectsLoading, setMoveDemandProjectsLoading] = useState(false);
  const [moveDemandProjectQuery, setMoveDemandProjectQuery] = useState('');
  const [moveDemandProjectDropdownOpen, setMoveDemandProjectDropdownOpen] = useState(false);

  // Demand cap confirmation state
  const [demandCapPeriods, setDemandCapPeriods] = useState<MoveCapPeriodDetail[]>([]);
  const [demandCapPendingBody, setDemandCapPendingBody] = useState<MoveDemandGroupRequest | null>(null);
  const [confirmingDemandCap, setConfirmingDemandCap] = useState(false);

  // Supply cap confirmation state
  const [supplyCapPeriods, setSupplyCapPeriods] = useState<MoveCapPeriodDetail[]>([]);
  const [supplyCapPendingBody, setSupplyCapPendingBody] = useState<MoveSupplyGroupRequest | null>(null);
  const [confirmingSupplyCap, setConfirmingSupplyCap] = useState(false);

  // Transfer dialog state (Phase 3 — cell-level copy/move)
  const [transferDialogMode, setTransferDialogMode] = useState<'copy' | 'move' | null>(null);
  const [transferDialogTargetResourceId, setTransferDialogTargetResourceId] = useState('');
  const [transferDialogTargetProjectId, setTransferDialogTargetProjectId] = useState<string | null>(null);
  const [transferDialogLoading, setTransferDialogLoading] = useState(false);
  const [transferDialogError, setTransferDialogError] = useState<string | null>(null);
  const [transferDialogResources, setTransferDialogResources] = useState<Resource[]>([]);
  const [transferDialogProjects, setTransferDialogProjects] = useState<Project[]>([]);
  const [transferDialogResourcesLoading, setTransferDialogResourcesLoading] = useState(false);
  const [transferDialogResourceQuery, setTransferDialogResourceQuery] = useState('');
  const [transferDialogResourceDropdownOpen, setTransferDialogResourceDropdownOpen] = useState(false);
  const [transferDialogProjectQuery, setTransferDialogProjectQuery] = useState('');
  const [transferDialogProjectDropdownOpen, setTransferDialogProjectDropdownOpen] = useState(false);

  // Transfer cap confirmation state (separate from whole-line move cap state)
  const [transferCapPeriods, setTransferCapPeriods] = useState<MoveCapPeriodDetail[]>([]);
  const [transferCapPendingBody, setTransferCapPendingBody] = useState<MoveDemandGroupRequest | MoveSupplyGroupRequest | null>(null);
  const [transferCapLineType, setTransferCapLineType] = useState<'demand' | 'supply' | null>(null);
  const [confirmingTransferCap, setConfirmingTransferCap] = useState(false);

  // Add Line dialog state
  const [addLineDialogOpen, setAddLineDialogOpen] = useState(false);
  const [dlgLineType, setDlgLineType] = useState<'demand' | 'supply'>('demand');
  const [dlgCcId, setDlgCcId] = useState('');
  const [dlgResourceQuery, setDlgResourceQuery] = useState('');
  const [dlgSelectedResources, setDlgSelectedResources] = useState<SelectedResource[]>([]);
  const [dlgProjectId, setDlgProjectId] = useState('');
  const [dlgSelectedPeriods, setDlgSelectedPeriods] = useState<Set<string>>(new Set());
  const [dlgFte, setDlgFte] = useState('5');
  const [dlgSaving, setDlgSaving] = useState(false);
  const [dlgError, setDlgError] = useState<string | null>(null);
  const [dlgShowResourceDropdown, setDlgShowResourceDropdown] = useState(false);
  const [dlgAllResources, setDlgAllResources] = useState<Resource[]>([]);
  const [dlgAllPlaceholders, setDlgAllPlaceholders] = useState<Placeholder[]>([]);
  const [dlgPmProjects, setDlgPmProjects] = useState<Project[]>([]);
  const [dlgPmProjectsLoading, setDlgPmProjectsLoading] = useState(false);
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
          resourceInitials: line.resource_initials || null,
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
          resourceInitials: line.resource_initials || null,
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

  // transferSelection sorted ascending by year/month — used for handle placement and mapping
  const sortedTransfer = useMemo(() =>
    [...transferSelection].sort((a, b) =>
      a.year !== b.year ? a.year - b.year : a.month - b.month
    ), [transferSelection]);
  const lastTransferCell = sortedTransfer.length > 0 ? sortedTransfer[sortedTransfer.length - 1] : null;

  // Keep refs in sync so the window event handlers never read stale values
  sortedTransferRef.current = sortedTransfer;
  periodsRef.current = periods;
  payloadDropTargetRef.current = payloadDropTarget;
  payloadDropErrorRef.current = payloadDropError;
  payloadOperationRef.current = payloadOperation;

  const isRoleManager = userRole === 'Manager';
  const isRolePM = userRole === 'PM';

  /*
   * Manager+PM scope model:
   *
   * DEMAND:
   *   resources/cost centers = all active planning resources (listResources, no CC scope)
   *   projects              = assigned PM projects only (listProjectsScoped)
   *   backend enforces: unassigned project demand writes → 403
   *
   * SUPPLY:
   *   resources/cost centers = managed/delegated Manager CCs only (listResourcesScoped forWrite)
   *   projects               = all active projects (listProjects)
   *   backend enforces: resource outside Manager write scope → 403
   *
   * Dashboard / RA Overview:
   *   read scope = Manager visible data UNION assigned PM project data (backend union query)
   */
  const dlgFilteredResources = useMemo(() => {
    const query = dlgResourceQuery.toLowerCase();
    const matchesResource = (r: Resource) =>
      !query ||
      r.display_name.toLowerCase().includes(query) ||
      (r.initials ? r.initials.toLowerCase().includes(query) : false);
    // Manager+PM adding demand uses the full resource list (same as primary PM).
    // Plain Manager or Manager+PM adding supply stays CC-scoped.
    const useAllResources = !isRoleManager || (canPM && dlgLineType === 'demand');
    if (!useAllResources) {
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
  }, [isRoleManager, canPM, dlgCcId, dlgResourceQuery, dlgLineType, ccResources, ccPlaceholders, dlgAllResources, dlgAllPlaceholders]);

  const moveDemandFilteredResources = useMemo(() => {
    const q = moveDemandQuery.trim().toLowerCase();
    return moveAllResources.filter(r => !q ||
      r.display_name.toLowerCase().includes(q) ||
      (r.initials ? r.initials.toLowerCase().includes(q) : false) ||
      (r.email ? r.email.toLowerCase().includes(q) : false)
    );
  }, [moveAllResources, moveDemandQuery]);

  const moveSupplyFilteredResources = useMemo(() => {
    const q = moveSupplyQuery.trim().toLowerCase();
    return moveSupplyAllResources.filter(r => !q ||
      r.display_name.toLowerCase().includes(q) ||
      (r.initials ? r.initials.toLowerCase().includes(q) : false) ||
      (r.email ? r.email.toLowerCase().includes(q) : false)
    );
  }, [moveSupplyAllResources, moveSupplyQuery]);

  const moveDemandFilteredProjects = useMemo(() => {
    const q = moveDemandProjectQuery.trim().toLowerCase();
    return moveDemandAllProjects.filter(p =>
      !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
    );
  }, [moveDemandAllProjects, moveDemandProjectQuery]);

  const transferDialogFilteredResources = useMemo(() => {
    const q = transferDialogResourceQuery.trim().toLowerCase();
    return transferDialogResources.filter(r =>
      !q ||
      r.display_name.toLowerCase().includes(q) ||
      (r.initials ? r.initials.toLowerCase().includes(q) : false) ||
      (r.email ? r.email.toLowerCase().includes(q) : false)
    );
  }, [transferDialogResources, transferDialogResourceQuery]);

  const transferDialogFilteredProjects = useMemo(() => {
    const q = transferDialogProjectQuery.trim().toLowerCase();
    return transferDialogProjects.filter(p =>
      !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
    );
  }, [transferDialogProjects, transferDialogProjectQuery]);

  const moveSupplyFilteredProjects = useMemo(() => {
    const q = moveSupplyProjectQuery.trim().toLowerCase();
    return moveSupplyAllProjects.filter(p =>
      !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
    );
  }, [moveSupplyAllProjects, moveSupplyProjectQuery]);

  // When Manager+PM opens inline demand add, load full resource list and PM-scoped projects.
  // The dialog and inline form never open simultaneously so dlgAllResources/dlgPmProjects are safe to reuse.
  useEffect(() => {
    if (!canPM || !addDemandCC) return;
    if (dlgAllResources.length === 0) {
      lookupsApi.listResources().then(setDlgAllResources).catch(() => {});
      lookupsApi.listPlaceholders().then(setDlgAllPlaceholders).catch(() => {});
    }
    if (dlgPmProjects.length === 0) {
      setDlgPmProjectsLoading(true);
      lookupsApi.listProjectsScoped().then(p => { setDlgPmProjects(p); setDlgPmProjectsLoading(false); }).catch(() => setDlgPmProjectsLoading(false));
    }
  }, [addDemandCC]); // eslint-disable-line react-hooks/exhaustive-deps

  const addDemandFilteredResAndPh = useMemo(() => {
    if (!addDemandCC) return { resources: [] as Resource[], placeholders: [] as Placeholder[] };
    const q = addDemandResQuery.trim().toLowerCase();
    // Manager+PM demand: use the full planning resource list, not CC-scoped list.
    if (canPM) {
      const resources = dlgAllResources.filter(r => !q ||
        r.display_name.toLowerCase().includes(q) ||
        (r.initials ? r.initials.toLowerCase().includes(q) : getInitials(r.display_name).toLowerCase().includes(q)) ||
        (r.email ? r.email.toLowerCase().includes(q) : false)
      );
      const placeholders = dlgAllPlaceholders.filter(ph => !q || ph.name.toLowerCase().includes(q));
      return { resources, placeholders };
    }
    const resources = (ccResources[addDemandCC] ?? []).filter(r => !q ||
      r.display_name.toLowerCase().includes(q) ||
      (r.initials ? r.initials.toLowerCase().includes(q) : getInitials(r.display_name).toLowerCase().includes(q)) ||
      (r.email ? r.email.toLowerCase().includes(q) : false)
    );
    const placeholders = (ccPlaceholders[addDemandCC] ?? []).filter(ph =>
      !q || ph.name.toLowerCase().includes(q)
    );
    return { resources, placeholders };
  }, [canPM, addDemandCC, addDemandResQuery, ccResources, ccPlaceholders, dlgAllResources, dlgAllPlaceholders]);

  const addDemandFilteredProjects = useMemo(() => {
    const q = addDemandProjectQuery.trim().toLowerCase();
    // Manager+PM demand: scope project list to PM-assigned projects only.
    const sourceProjects = (isRoleManager && canPM) ? dlgPmProjects : projects;
    return sourceProjects.filter(p => p.is_active !== false && (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)));
  }, [addDemandProjectQuery, projects, isRoleManager, canPM, dlgPmProjects]);

  const addSupplyFilteredResources = useMemo(() => {
    if (!addSupplyCC) return [] as Resource[];
    const q = addSupplyResQuery.trim().toLowerCase();
    return (ccResources[addSupplyCC] ?? []).filter(r => !q ||
      r.display_name.toLowerCase().includes(q) ||
      (r.initials ? r.initials.toLowerCase().includes(q) : getInitials(r.display_name).toLowerCase().includes(q)) ||
      (r.email ? r.email.toLowerCase().includes(q) : false)
    );
  }, [addSupplyCC, addSupplyResQuery, ccResources]);

  const addSupplyFilteredProjects = useMemo(() => {
    const q = addSupplyProjectQuery.trim().toLowerCase();
    return projects.filter(p => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
  }, [addSupplyProjectQuery, projects]);

  const loadCcData = useCallback(async (ccId: string) => {
    const promises: Promise<void>[] = [];
    if (!ccResources[ccId]) {
      // Use write-scoped endpoint so the resource picker never shows resources outside the user's
      // writable reporting line. For Finance/Admin the scoped endpoint returns all CC resources
      // (no scope applied), so their Add Line experience is unchanged.
      promises.push(
        lookupsApi.listResourcesScoped({ costCenterId: ccId, forWrite: true })
          .then(r => setCcResources(prev => ({ ...prev, [ccId]: r })))
      );
    }
    if (!ccPlaceholders[ccId]) {
      promises.push(
        lookupsApi.listPlaceholders(ccId).then(p => setCcPlaceholders(prev => ({ ...prev, [ccId]: p })))
      );
    }
    await Promise.all(promises);
  }, [ccResources, ccPlaceholders]);

  const handleExpandCC = useCallback((ccId: string) => {
    setExpandedCCs(prev => {
      const next = new Set(prev);
      if (next.has(ccId)) { next.delete(ccId); return next; }
      next.add(ccId);
      return next;
    });
  }, []);

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
    } catch (err) {
      showApiError(err as Error, 'Failed to save demand');
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
    } catch (err) {
      showApiError(err as Error, 'Failed to save supply');
    } finally {
      setSavingCells(prev => { const s = new Set(prev); s.delete(cellKey); return s; });
      setEditingCell(null);
    }
  }, [onReload, showApiError]);

  const handleDeleteGroup = useCallback(async () => {
    if (!deleteGroupRow) return;
    setDeletingGroup(true);
    setDeleteGroupError(null);
    const { resourceName, projectName } = deleteGroupRow;
    try {
      await planningApi.deleteDemandGroup({
        resource_id: deleteGroupRow.resourceId ?? undefined,
        placeholder_id: deleteGroupRow.placeholderId ?? undefined,
        project_id: deleteGroupRow.projectId || '',
        period_ids: periods.map(p => p.id),
      });
      setDeleteGroupRow(null);
      onReload();
      showSuccess('Demand line deleted', `Removed demand for ${resourceName} on ${projectName}.`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'PERIOD_LOCKED') {
          setDeleteGroupError('One or more periods are locked and cannot be modified.');
        } else if (err.code === 'PM_NOT_AUTHORIZED') {
          setDeleteGroupError('You are not authorized to manage demand for this project.');
        } else {
          setDeleteGroupError(err.detail || err.message || 'Failed to delete demand line.');
        }
      } else {
        setDeleteGroupError((err as Error).message || 'Failed to delete demand line.');
      }
    } finally {
      setDeletingGroup(false);
    }
  }, [deleteGroupRow, periods, onReload, showSuccess]);

  const handleDeleteSupplyGroup = useCallback(async () => {
    if (!deleteSupplyGroupRow) return;
    setDeletingSupplyGroup(true);
    setDeleteSupplyGroupError(null);
    const { resourceName, projectName } = deleteSupplyGroupRow;
    try {
      await planningApi.deleteSupplyGroup({
        resource_id: deleteSupplyGroupRow.resourceId || '',
        project_id: deleteSupplyGroupRow.projectId ?? null,
        period_ids: periods.map(p => p.id),
      } as DeleteSupplyGroupRequest);
      setDeleteSupplyGroupRow(null);
      onReload();
      showSuccess('Supply line deleted', `Removed supply for ${resourceName} on ${projectName}.`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'PERIOD_LOCKED') {
          setDeleteSupplyGroupError('One or more periods are locked and cannot be modified.');
        } else if (err.status === 403) {
          setDeleteSupplyGroupError('You are not authorized to delete supply for this resource.');
        } else {
          setDeleteSupplyGroupError(err.detail || err.message || 'Failed to delete supply line.');
        }
      } else {
        setDeleteSupplyGroupError((err as Error).message || 'Failed to delete supply line.');
      }
    } finally {
      setDeletingSupplyGroup(false);
    }
  }, [deleteSupplyGroupRow, periods, onReload, showSuccess]);

  const openMoveSupplyDialog = useCallback(async (row: MergedMatrixRow) => {
    setMoveSupplyGroupRow(row);
    setMoveSupplyTargetId(row.resourceId || '');
    setMoveSupplyTargetProjectId(row.projectId || '');
    setMoveSupplyProjectQuery('');
    setMoveSupplyGroupError(null);
    setMoveSupplyResourcesLoading(true);
    setMoveSupplyProjectsLoading(true);
    try {
      const [resources, projects] = await Promise.all([
        lookupsApi.listResourcesScoped({ forWrite: true }),
        lookupsApi.listProjects(),
      ]);
      setMoveSupplyAllResources(resources);
      setMoveSupplyAllProjects(projects.filter(p => p.is_active));
    } catch {
      setMoveSupplyAllResources([]);
      setMoveSupplyAllProjects([]);
    } finally {
      setMoveSupplyResourcesLoading(false);
      setMoveSupplyProjectsLoading(false);
    }
  }, []);

  const handleMoveSupplyGroup = useCallback(async () => {
    if (!moveSupplyGroupRow || !moveSupplyTargetId || !moveSupplyTargetProjectId) return;
    setMovingSupplyGroup(true);
    setMoveSupplyGroupError(null);
    const body: MoveSupplyGroupRequest = {
      from_resource_id: moveSupplyGroupRow.resourceId || '',
      to_resource_id: moveSupplyTargetId,
      project_id: moveSupplyGroupRow.projectId || undefined,
      to_project_id: moveSupplyTargetProjectId,
      period_ids: periods.map(p => p.id),
    };
    try {
      await planningApi.moveSupplyGroup(body);
      const targetName = moveSupplyAllResources.find(r => r.id === moveSupplyTargetId)?.display_name || moveSupplyTargetId;
      const targetProjectName = moveSupplyAllProjects.find(p => p.id === moveSupplyTargetProjectId)?.name || moveSupplyGroupRow.projectName;
      setMoveSupplyGroupRow(null);
      setMoveSupplyTargetId('');
      setMoveSupplyTargetProjectId('');
      setMoveSupplyQuery('');
      setMoveSupplyProjectQuery('');
      setMoveSupplyDropdownOpen(false);
      setMoveSupplyProjectDropdownOpen(false);
      setMoveSupplyGroupError(null);
      onReload();
      showSuccess('Supply line moved', `Moved supply to ${targetName} on ${targetProjectName}.`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'PERIOD_LOCKED') {
          setMoveSupplyGroupError('One or more periods are locked and cannot be modified.');
        } else if (err.status === 403) {
          setMoveSupplyGroupError('You are not authorized to manage supply for this resource.');
        } else if (err.code === 'MOVE_REQUIRES_CAP_CONFIRMATION') {
          setSupplyCapPeriods(err.extras.periods as MoveCapPeriodDetail[]);
          setSupplyCapPendingBody({ ...body, confirm_cap: true });
        } else if (err.code === 'RESOURCE_INACTIVE') {
          setMoveSupplyGroupError(err.detail || 'Cannot move supply to an inactive resource.');
        } else {
          setMoveSupplyGroupError(err.detail || err.message || 'Failed to move supply line.');
        }
      } else {
        setMoveSupplyGroupError((err as Error).message || 'Failed to move supply line.');
      }
    } finally {
      setMovingSupplyGroup(false);
    }
  }, [moveSupplyGroupRow, moveSupplyTargetId, moveSupplyTargetProjectId, moveSupplyAllResources, moveSupplyAllProjects, periods, onReload, showSuccess]);

  const openMoveDialog = useCallback(async (row: MergedMatrixRow) => {
    setMoveGroupRow(row);
    setMoveTargetId(row.resourceId || '');
    setMoveTargetProjectId(row.projectId || '');
    setMoveDemandProjectQuery('');
    setMoveGroupError(null);
    setMoveResourcesLoading(true);
    setMoveDemandProjectsLoading(true);
    try {
      const [resources, projects] = await Promise.all([
        lookupsApi.listResources(),
        lookupsApi.listProjectsScoped(),
      ]);
      setMoveAllResources(resources);
      setMoveDemandAllProjects(projects);
    } catch {
      setMoveAllResources([]);
      setMoveDemandAllProjects([]);
    } finally {
      setMoveResourcesLoading(false);
      setMoveDemandProjectsLoading(false);
    }
  }, []);

  const handleMoveGroup = useCallback(async () => {
    if (!moveGroupRow || !moveTargetId || !moveTargetProjectId) return;
    setMovingGroup(true);
    setMoveGroupError(null);
    const body: MoveDemandGroupRequest = {
      from_resource_id: moveGroupRow.resourceId ?? undefined,
      from_placeholder_id: moveGroupRow.placeholderId ?? undefined,
      to_resource_id: moveTargetId,
      project_id: moveGroupRow.projectId || '',
      to_project_id: moveTargetProjectId,
      period_ids: periods.map(p => p.id),
    };
    try {
      await planningApi.moveDemandGroup(body);
      const targetName = moveAllResources.find(r => r.id === moveTargetId)?.display_name || moveTargetId;
      const targetProjectName = moveDemandAllProjects.find(p => p.id === moveTargetProjectId)?.name || moveGroupRow.projectName;
      setMoveGroupRow(null);
      setMoveTargetId('');
      setMoveTargetProjectId('');
      setMoveDemandQuery('');
      setMoveDemandProjectQuery('');
      setMoveDemandDropdownOpen(false);
      setMoveDemandProjectDropdownOpen(false);
      setMoveGroupError(null);
      onReload();
      showSuccess('Demand line moved', `Moved demand to ${targetName} on ${targetProjectName}.`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'PERIOD_LOCKED') {
          setMoveGroupError('One or more periods are locked and cannot be modified.');
        } else if (err.code === 'PM_NOT_AUTHORIZED') {
          setMoveGroupError('You are not authorized to manage demand for this project.');
        } else if (err.code === 'MOVE_REQUIRES_CAP_CONFIRMATION') {
          setDemandCapPeriods(err.extras.periods as MoveCapPeriodDetail[]);
          setDemandCapPendingBody({ ...body, confirm_cap: true });
        } else if (err.code === 'RESOURCE_EXCLUDED') {
          setMoveGroupError(err.detail || 'This resource is excluded from planning.');
        } else {
          setMoveGroupError(err.detail || err.message || 'Failed to move demand line.');
        }
      } else {
        setMoveGroupError((err as Error).message || 'Failed to move demand line.');
      }
    } finally {
      setMovingGroup(false);
    }
  }, [moveGroupRow, moveTargetId, moveTargetProjectId, moveAllResources, moveDemandAllProjects, periods, onReload, showSuccess]);

  const handleDemandCapConfirm = useCallback(async () => {
    if (!demandCapPendingBody) return;
    setConfirmingDemandCap(true);
    try {
      await planningApi.moveDemandGroup(demandCapPendingBody);
      const targetName = moveAllResources.find(r => r.id === moveTargetId)?.display_name || moveTargetId;
      const targetProjectName = moveDemandAllProjects.find(p => p.id === moveTargetProjectId)?.name || moveGroupRow?.projectName;
      setDemandCapPeriods([]);
      setDemandCapPendingBody(null);
      setMoveGroupRow(null);
      setMoveTargetId('');
      setMoveTargetProjectId('');
      setMoveDemandQuery('');
      setMoveDemandProjectQuery('');
      setMoveDemandDropdownOpen(false);
      setMoveDemandProjectDropdownOpen(false);
      setMoveGroupError(null);
      onReload();
      showSuccess('Demand line moved', `Moved demand to ${targetName} on ${targetProjectName}.`);
    } catch (err) {
      setDemandCapPeriods([]);
      setDemandCapPendingBody(null);
      if (err instanceof ApiError) {
        setMoveGroupError(err.detail || err.message || 'Failed to move demand line.');
      } else {
        setMoveGroupError((err as Error).message || 'Failed to move demand line.');
      }
    } finally {
      setConfirmingDemandCap(false);
    }
  }, [demandCapPendingBody, moveAllResources, moveTargetId, moveDemandAllProjects, moveTargetProjectId, moveGroupRow, onReload, showSuccess]);

  const handleSupplyCapConfirm = useCallback(async () => {
    if (!supplyCapPendingBody) return;
    setConfirmingSupplyCap(true);
    try {
      await planningApi.moveSupplyGroup(supplyCapPendingBody);
      const targetName = moveSupplyAllResources.find(r => r.id === moveSupplyTargetId)?.display_name || moveSupplyTargetId;
      const targetProjectName = moveSupplyAllProjects.find(p => p.id === moveSupplyTargetProjectId)?.name || moveSupplyGroupRow?.projectName;
      setSupplyCapPeriods([]);
      setSupplyCapPendingBody(null);
      setMoveSupplyGroupRow(null);
      setMoveSupplyTargetId('');
      setMoveSupplyTargetProjectId('');
      setMoveSupplyQuery('');
      setMoveSupplyProjectQuery('');
      setMoveSupplyDropdownOpen(false);
      setMoveSupplyProjectDropdownOpen(false);
      setMoveSupplyGroupError(null);
      onReload();
      showSuccess('Supply line moved', `Moved supply to ${targetName} on ${targetProjectName}.`);
    } catch (err) {
      setSupplyCapPeriods([]);
      setSupplyCapPendingBody(null);
      if (err instanceof ApiError) {
        setMoveSupplyGroupError(err.detail || err.message || 'Failed to move supply line.');
      } else {
        setMoveSupplyGroupError((err as Error).message || 'Failed to move supply line.');
      }
    } finally {
      setConfirmingSupplyCap(false);
    }
  }, [supplyCapPendingBody, moveSupplyAllResources, moveSupplyTargetId, moveSupplyAllProjects, moveSupplyTargetProjectId, moveSupplyGroupRow, onReload, showSuccess]);

  const handleAddDemandLine = useCallback(async (ccId: string, allRows: MergedMatrixRow[]) => {
    const { resOrPh, projectId } = addDemandForm;
    if (!resOrPh || !projectId) return;

    const parsed = parseResOrPh(resOrPh);
    const resourceId = parsed.resourceId || null;
    const placeholderId = parsed.placeholderId || null;
    let resourceName = '—';
    if (resourceId) {
      // For Manager+PM inline demand add, resource may be from dlgAllResources (full list),
      // not from CC-scoped ccResources. Check both.
      resourceName = ccResources[ccId]?.find(r => r.id === resourceId)?.display_name
        || dlgAllResources.find(r => r.id === resourceId)?.display_name
        || resourceId;
    } else if (placeholderId) {
      resourceName = ccPlaceholders[ccId]?.find(p => p.id === placeholderId)?.name
        || dlgAllPlaceholders.find(p => p.id === placeholderId)?.name
        || placeholderId;
    }
    const projectName = projects.find(p => p.id === projectId)?.name || projectId;
    const key = resourceId ? `r:${resourceId}|p:${projectId}` : `ph:${placeholderId}|p:${projectId}`;

    if (!allRows.find(r => r.key === key)) {
      const resourceInitials = resourceId
        ? (ccResources[ccId]?.find(r => r.id === resourceId)?.initials
            || dlgAllResources.find(r => r.id === resourceId)?.initials
            || null)
        : null;
      const newRow: LocalRow = {
        key, resourceId, resourceName, resourceInitials, placeholderId,
        projectId, projectName, isGeneral: false, isPlaceholder: !!placeholderId,
      };
      setLocalDemandRows(prev => ({ ...prev, [ccId]: [...(prev[ccId] ?? []), newRow] }));
    }
    setAddDemandCC(null);
    setAddDemandForm({ resOrPh: '', projectId: '' });
  }, [addDemandForm, ccResources, ccPlaceholders, dlgAllResources, dlgAllPlaceholders, projects]);

  const handleAddSupplyLine = useCallback(async (ccId: string, allRows: MergedMatrixRow[]) => {
    const { resourceId, projectId } = addSupplyForm;
    if (!resourceId) return;

    const isGeneral = !projectId;
    const resourceName = ccResources[ccId]?.find(r => r.id === resourceId)?.display_name || resourceId;
    const projectName = isGeneral ? 'General' : (projects.find(p => p.id === projectId)?.name || projectId);
    const key = `r:${resourceId}|p:${projectId}`;

    if (!allRows.find(r => r.key === key)) {
      const resourceInitials = ccResources[ccId]?.find(r => r.id === resourceId)?.initials || null;
      const newRow: LocalRow = {
        key, resourceId, resourceName, resourceInitials, placeholderId: null,
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
      const actions: Array<{ action: 'create' | 'update' | 'delete'; data: Record<string, unknown> }> = [];

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
      const actions: Array<{ action: 'create' | 'update' | 'delete'; data: Record<string, unknown> }> = [];

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

  // Toggle a cell in/out of the transfer selection (Ctrl/Meta+click).
  // Constraint: all selected cells must share the same rowKey and lineType.
  const handleTransferToggle = useCallback((cell: SelectedPlanningCell) => {
    if (cell.value === 0) return;

    // Deselect if already in selection
    const existingIdx = transferSelection.findIndex(
      c => c.rowKey === cell.rowKey && c.lineType === cell.lineType && c.periodId === cell.periodId,
    );
    if (existingIdx >= 0) {
      setTransferSelection(prev => prev.filter((_, i) => i !== existingIdx));
      return;
    }

    // Restart if different row or line type
    if (transferSelection.length > 0) {
      const first = transferSelection[0];
      if (first.rowKey !== cell.rowKey || first.lineType !== cell.lineType) {
        showInfo('Selection restarted', 'Select cells from one row only.');
        setTransferSelection([cell]);
        return;
      }
    }

    // Add to existing (same row) or start fresh
    setTransferSelection(prev => [...prev, cell]);
  }, [transferSelection, showInfo]);

  const openTransferDialog = useCallback(async (mode: 'copy' | 'move') => {
    if (transferSelection.length === 0) return;
    setTransferDialogMode(mode);
    setTransferDialogTargetResourceId('');
    setTransferDialogTargetProjectId(transferSelection[0].lineType === 'supply' ? null : '');
    setTransferDialogError(null);
    setTransferDialogResourceQuery('');
    setTransferDialogProjectQuery('');
    setTransferDialogResourcesLoading(true);
    try {
      const [resources, prjs] = await Promise.all([
        lookupsApi.listResourcesScoped({ forWrite: true }),
        lookupsApi.listProjectsScoped(),
      ]);
      setTransferDialogResources(resources);
      setTransferDialogProjects(prjs);
    } catch {
      setTransferDialogResources([]);
      setTransferDialogProjects([]);
    } finally {
      setTransferDialogResourcesLoading(false);
    }
  }, [transferSelection]);

  const handleTransferSubmit = useCallback(async () => {
    if (!transferDialogMode || !transferDialogTargetResourceId || transferSelection.length === 0) return;
    const lineType = transferSelection[0].lineType;
    if (lineType === 'demand' && !transferDialogTargetProjectId) return;

    const periodIds = transferSelection.map(c => c.periodId);
    let demandBody: MoveDemandGroupRequest | null = null;
    let supplyBody: MoveSupplyGroupRequest | null = null;

    if (lineType === 'demand') {
      demandBody = {
        operation: transferDialogMode,
        from_resource_id: transferSelection[0].sourceResourceId ?? undefined,
        from_placeholder_id: transferSelection[0].sourcePlaceholderId ?? undefined,
        to_resource_id: transferDialogTargetResourceId,
        project_id: transferSelection[0].sourceProjectId!,
        to_project_id: transferDialogTargetProjectId!,
        period_ids: periodIds,
        confirm_cap: false,
      };
    } else {
      supplyBody = {
        operation: transferDialogMode,
        from_resource_id: transferSelection[0].sourceResourceId!,
        to_resource_id: transferDialogTargetResourceId,
        project_id: transferSelection[0].sourceProjectId ?? undefined,
        to_project_id: transferDialogTargetProjectId,
        period_ids: periodIds,
        confirm_cap: false,
      };
    }

    setTransferDialogLoading(true);
    setTransferDialogError(null);
    try {
      if (demandBody) {
        await planningApi.moveDemandGroup(demandBody);
      } else {
        await planningApi.moveSupplyGroup(supplyBody!);
      }
      const verb = transferDialogMode === 'copy' ? 'Copied' : 'Moved';
      showSuccess(`${verb} successfully`, `${verb} ${transferSelection.length} cell${transferSelection.length !== 1 ? 's' : ''}.`);
      setTransferDialogMode(null);
      setTransferSelection([]);
      onReload();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'MOVE_REQUIRES_CAP_CONFIRMATION') {
          setTransferCapPeriods(err.extras.periods as MoveCapPeriodDetail[]);
          setTransferCapPendingBody(
            demandBody ? { ...demandBody, confirm_cap: true } : { ...supplyBody!, confirm_cap: true }
          );
          setTransferCapLineType(lineType);
          setTransferDialogMode(null);
        } else {
          setTransferDialogError(err.detail || err.message || 'Transfer failed.');
        }
      } else {
        setTransferDialogError((err as Error).message || 'Transfer failed.');
      }
    } finally {
      setTransferDialogLoading(false);
    }
  }, [transferDialogMode, transferDialogTargetResourceId, transferDialogTargetProjectId, transferSelection, showSuccess, onReload]);

  const handleTransferCapConfirm = useCallback(async () => {
    if (!transferCapPendingBody || !transferCapLineType) return;
    setConfirmingTransferCap(true);
    try {
      if (transferCapLineType === 'demand') {
        await planningApi.moveDemandGroup(transferCapPendingBody as MoveDemandGroupRequest);
      } else {
        await planningApi.moveSupplyGroup(transferCapPendingBody as MoveSupplyGroupRequest);
      }
      const mode = (transferCapPendingBody as MoveDemandGroupRequest).operation === 'copy' ? 'Copied' : 'Moved';
      setTransferCapPeriods([]);
      setTransferCapPendingBody(null);
      setTransferCapLineType(null);
      setTransferSelection([]);
      onReload();
      showSuccess(`${mode} successfully`, `${mode} with capping applied.`);
    } catch (err) {
      setTransferCapPeriods([]);
      setTransferCapPendingBody(null);
      setTransferCapLineType(null);
      showApiError(err as Error, 'Transfer failed after cap confirmation.');
    } finally {
      setConfirmingTransferCap(false);
    }
  }, [transferCapPendingBody, transferCapLineType, onReload, showSuccess, showApiError]);

  // Clears all visual payload-drag state (ghost, preview, target).
  // Does NOT clear transferSelection — that happens only on successful submit.
  const clearPayloadDragState = useCallback(() => {
    setIsPayloadDragging(false);
    isPayloadDraggingRef.current = false;
    setPayloadDragCursorPos(null);
    setPayloadDropTarget(null);
    payloadDropTargetRef.current = null;
    setPayloadDropError(null);
    payloadDropErrorRef.current = null;
    setPayloadPreviewPeriodIds(new Set());
    payloadMappingsRef.current = [];
  }, []);

  // Submit a mapped transfer on mouseup. Reads all live values from refs so it is safe
  // to invoke from inside a window event handler via handlePayloadDropRef.
  const handlePayloadDrop = useCallback(async () => {
    const target = payloadDropTargetRef.current;
    const dropError = payloadDropErrorRef.current;
    const operation = payloadOperationRef.current;
    const sel = sortedTransferRef.current;
    const mappings = payloadMappingsRef.current;

    if (!target) { clearPayloadDragState(); return; }

    if (dropError) {
      clearPayloadDragState();
      showInfo('Cannot drop here', dropError);
      return;
    }

    if (sel.length === 0 || mappings.length === 0) { clearPayloadDragState(); return; }

    const lineType = sel[0].lineType;
    const periodMappings = mappings.map(m => ({ from_period_id: m.fromId, to_period_id: m.toId }));
    const periodIds = sel.map(c => c.periodId);

    // Stop the visual drag immediately (the mouse is up — the "drag" is done)
    clearPayloadDragState();

    let demandBody: MoveDemandGroupRequest | null = null;
    let supplyBody: MoveSupplyGroupRequest | null = null;

    if (lineType === 'demand') {
      demandBody = {
        operation,
        from_resource_id: sel[0].sourceResourceId ?? undefined,
        from_placeholder_id: sel[0].sourcePlaceholderId ?? undefined,
        to_resource_id: target.resourceId ?? undefined,
        to_placeholder_id: target.placeholderId ?? undefined,
        project_id: sel[0].sourceProjectId!,
        to_project_id: target.projectId ?? sel[0].sourceProjectId!,
        period_ids: periodIds,
        period_mappings: periodMappings,
        merge_mode: 'replace',
        confirm_cap: false,
      };
    } else {
      supplyBody = {
        operation,
        from_resource_id: sel[0].sourceResourceId!,
        to_resource_id: target.resourceId!,
        project_id: sel[0].sourceProjectId,
        to_project_id: target.projectId,
        period_ids: periodIds,
        period_mappings: periodMappings,
        merge_mode: 'replace',
        confirm_cap: false,
      };
    }

    try {
      if (demandBody) {
        await planningApi.moveDemandGroup(demandBody);
      } else {
        await planningApi.moveSupplyGroup(supplyBody!);
      }
      const verb = operation === 'copy' ? 'Copied' : 'Moved';
      showSuccess(`${verb} successfully`, `${verb} ${sel.length} cell${sel.length !== 1 ? 's' : ''}.`);
      setTransferSelection([]);
      onReload();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MOVE_REQUIRES_CAP_CONFIRMATION') {
        setTransferCapPeriods(err.extras.periods as MoveCapPeriodDetail[]);
        setTransferCapPendingBody(
          demandBody
            ? { ...demandBody, confirm_cap: true }
            : { ...supplyBody!, confirm_cap: true },
        );
        setTransferCapLineType(lineType);
      } else {
        showApiError(err as Error, `Failed to ${operation} cells`);
      }
    }
  }, [clearPayloadDragState, showSuccess, showApiError, showInfo, onReload]);

  // Keep accessible from the window mouseup handler without stale closures.
  handlePayloadDropRef.current = handlePayloadDrop;

  // Start a payload drag from the drag handle on the last transfer-selected cell.
  const handlePayloadDragStart = useCallback((e: React.MouseEvent, altKey: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedCells(new Set());
    setPopoverPos(null);
    setApplyValue('');
    const op = altKey ? 'copy' : 'move';
    setPayloadOperation(op);
    payloadOperationRef.current = op;
    setPayloadDragCursorPos({ x: e.clientX, y: e.clientY });
    setPayloadDropTarget(null);
    payloadDropTargetRef.current = null;
    setPayloadDropError(null);
    payloadDropErrorRef.current = null;
    setPayloadPreviewPeriodIds(new Set());
    payloadMappingsRef.current = [];
    setIsPayloadDragging(true);
    isPayloadDraggingRef.current = true;
  }, []);

  // Window-level mousemove/mouseup/keydown while a payload drag is active.
  // All mutable values are read from refs to avoid stale closures in the effect.
  useEffect(() => {
    if (!isPayloadDragging) return;

    const handleMove = (e: MouseEvent) => {
      const op = e.altKey ? 'copy' : 'move';
      setPayloadDragCursorPos({ x: e.clientX, y: e.clientY });
      setPayloadOperation(op);
      payloadOperationRef.current = op;

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const td = el?.closest('td[data-period-id]') as HTMLElement | null;

      if (!td) {
        setPayloadDropTarget(null);
        payloadDropTargetRef.current = null;
        setPayloadDropError(null);
        payloadDropErrorRef.current = null;
        payloadMappingsRef.current = [];
        setPayloadPreviewPeriodIds(new Set());
        return;
      }

      const periodId = td.dataset.periodId!;
      const year = Number(td.dataset.year);
      const month = Number(td.dataset.month);
      const rowKey = td.dataset.rowKey!;
      const lineType = td.dataset.type as 'demand' | 'supply';
      const resourceId = td.dataset.resourceId || null;
      const placeholderId = td.dataset.placeholderId || null;
      const projectId = td.dataset.projectId || null;
      const newTarget = { periodId, year, month, rowKey, lineType, resourceId, placeholderId, projectId };
      setPayloadDropTarget(newTarget);
      payloadDropTargetRef.current = newTarget;

      const sel = sortedTransferRef.current;
      const sourceLineType = sel[0]?.lineType;

      const setErr = (msg: string) => {
        setPayloadDropError(msg);
        payloadDropErrorRef.current = msg;
        payloadMappingsRef.current = [];
        setPayloadPreviewPeriodIds(new Set());
      };

      if (lineType !== sourceLineType) {
        setErr(`Cannot drop ${sourceLineType} onto ${lineType}`);
        return;
      }

      const { mappings, error } = computePayloadMappings(sel, year, month, periodsRef.current);
      if (error || !mappings) {
        setErr(error ?? 'Invalid drop target');
        return;
      }

      const isNoOp = rowKey === sel[0]?.rowKey && mappings.every(m => m.fromId === m.toId);
      if (isNoOp) {
        setErr('No movement — source and target periods are identical');
        return;
      }

      setPayloadDropError(null);
      payloadDropErrorRef.current = null;
      payloadMappingsRef.current = mappings;
      setPayloadPreviewPeriodIds(new Set(mappings.map(m => m.toId)));
    };

    const handleUp = () => { handlePayloadDropRef.current?.(); };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clearPayloadDragState(); };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('keydown', handleKey);
    };
  }, [isPayloadDragging, clearPayloadDragState]);

  // For Manager (supply path) or Manager+PM switching to supply: load CC resources when CC is set.
  // For Manager+PM in demand mode, dlgAllResources is populated by openAddLineDialog / the effect below.
  useEffect(() => {
    // Load CC-scoped resources for Manager in supply mode; skip for demand (uses full list).
  if (isRoleManager && dlgCcId && dlgLineType === 'supply') loadCcData(dlgCcId);
  }, [dlgCcId, dlgLineType]); // eslint-disable-line react-hooks/exhaustive-deps

  // For demand mode: ensure the full resource list is loaded when dialog is open.
  // Covers Manager+PM and Finance/Admin who switch to demand via the line-type radio.
  useEffect(() => {
    if (!addLineDialogOpen) return;
    if (dlgLineType === 'demand' && !isRoleManager && dlgAllResources.length === 0) {
      // Pure PM / Finance / Admin
      lookupsApi.listResources().then(setDlgAllResources).catch(() => {});
      lookupsApi.listPlaceholders().then(setDlgAllPlaceholders).catch(() => {});
    } else if (isRoleManager && canPM && dlgLineType === 'demand' && dlgAllResources.length === 0) {
      // Manager+PM demand
      lookupsApi.listResources().then(setDlgAllResources).catch(() => {});
      lookupsApi.listPlaceholders().then(setDlgAllPlaceholders).catch(() => {});
    }
  }, [dlgLineType, addLineDialogOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // End period drag selection on global mouseup
  useEffect(() => {
    if (!dlgPeriodDragging) return;
    const handleUp = () => setDlgPeriodDragging(false);
    window.addEventListener('mouseup', handleUp);
    return () => window.removeEventListener('mouseup', handleUp);
  }, [dlgPeriodDragging]);

  const openAddLineDialog = useCallback((explicitLineType?: 'demand' | 'supply') => {
    // If explicit type is passed (from "Add Demand" / "Add Supply" buttons), use it.
    // Otherwise: pure PM → demand; pure Manager → supply; Manager+PM defaults to demand;
    // Finance/Admin → demand as a reasonable starting default.
    const defaultLineType: 'demand' | 'supply' =
      explicitLineType !== undefined ? explicitLineType
      : isRoleManager && !canPM ? 'supply'
      : 'demand';
    // Default to own CC for supply; CC is auto-detected from resource selection for demand.
    const editableCostCenters = editableCcIds
      ? allCostCenters.filter(c => editableCcIds.has(c.id))
      : costCenters;
    const defaultCcId = isRoleManager && defaultLineType === 'supply'
      ? ([...managedCcIds][0] || editableCostCenters[0]?.id || costCenters[0]?.id || '')
      : '';
    setDlgLineType(defaultLineType);
    setDlgCcId(defaultCcId);
    setDlgResourceQuery('');
    setDlgSelectedResources([]);
    setDlgProjectId('');
    setDlgSelectedPeriods(new Set());
    setDlgFte('5');
    setDlgSaving(false);
    setDlgError(null);
    setDlgShowResourceDropdown(false);
    setDlgAllResources([]);
    setDlgAllPlaceholders([]);
    setDlgPmProjects([]);
    setDlgPeriodDragging(false);
    // Supply mode (Manager or Manager+PM): load CC-scoped resources.
    // Demand mode (PM, Manager+PM, Finance, Admin): load full resource list.
    const isSupplyMode = isRoleManager && defaultLineType === 'supply';
    if (isSupplyMode) {
      if (defaultCcId) loadCcData(defaultCcId);
    } else {
      lookupsApi.listResources().then(setDlgAllResources).catch(() => {});
      if (defaultLineType === 'demand') {
        lookupsApi.listPlaceholders().then(setDlgAllPlaceholders).catch(() => {});
      }
    }
    // For Manager+PM demand: fetch PM-assigned projects for the project dropdown.
    if (isRoleManager && canPM && defaultLineType === 'demand') {
      setDlgPmProjectsLoading(true);
      setDlgPmProjects([]);
      lookupsApi.listProjectsScoped()
        .then(p => { setDlgPmProjects(p); setDlgPmProjectsLoading(false); })
        .catch(() => setDlgPmProjectsLoading(false));
    }
    setAddLineDialogOpen(true);
  }, [isRoleManager, canPM, managedCcIds, costCenters, allCostCenters, editableCcIds, loadCcData]);

  // Dialog line-type switch handlers — used by the selectable Line Type control shown for
  // Finance/Admin and Manager+PM (both can add either demand or supply).
  const handleDlgSwitchToDemand = useCallback(() => {
    setDlgLineType('demand');
    setDlgSelectedResources([]);
    setDlgResourceQuery('');
    setDlgCcId(''); // CC auto-derived from resource selection in demand mode
    lookupsApi.listPlaceholders().then(setDlgAllPlaceholders).catch(() => {});
    if (isRoleManager && canPM) {
      // Manager+PM demand: need full resource list and PM-scoped project list
      if (dlgAllResources.length === 0) {
        lookupsApi.listResources().then(setDlgAllResources).catch(() => {});
      }
      setDlgPmProjectsLoading(true);
      setDlgPmProjects([]);
      lookupsApi.listProjectsScoped()
        .then(p => { setDlgPmProjects(p); setDlgPmProjectsLoading(false); })
        .catch(() => setDlgPmProjectsLoading(false));
    }
  }, [isRoleManager, canPM, dlgAllResources.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDlgSwitchToSupply = useCallback(() => {
    setDlgLineType('supply');
    setDlgSelectedResources(prev => prev.filter(r => r.type === 'resource'));
    setDlgResourceQuery('');
    setDlgAllPlaceholders([]);
    setDlgPmProjects([]);
    if (isRoleManager) {
      // Manager+PM supply: set default Manager CC so the CC dropdown has a selection
      const defaultCc = [...managedCcIds][0] || (editableCcIds ? [...editableCcIds][0] : '') || '';
      setDlgCcId(defaultCc);
    } else {
      setDlgCcId(''); // Finance/Admin: CC auto-detected from resource selection
    }
  }, [isRoleManager, managedCcIds, editableCcIds]);

  const handleDlgSave = useCallback(async () => {
    const fteVal = Number(dlgFte);

    if (dlgSelectedResources.length === 0) { setDlgError('Please select at least one resource'); return; }
    if (dlgSelectedPeriods.size === 0) { setDlgError('Please select at least one period'); return; }
    if (!dlgFte || isNaN(fteVal) || fteVal <= 0) { setDlgError('Please enter a valid FTE%'); return; }
    if (dlgLineType === 'demand' && !dlgProjectId) { setDlgError('Please select a project for demand lines'); return; }

    setDlgSaving(true);
    setDlgError(null);
    try {
      const actions: Array<{ action: 'create' | 'update' | 'delete'; data: Record<string, unknown> }> = [];
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
    {/* Payload drag ghost — fixed, follows cursor, pointerEvents:none so elementFromPoint sees through it */}
    {isPayloadDragging && payloadDragCursorPos && createPortal(
      <div
        style={{
          position: 'fixed',
          left: payloadDragCursorPos.x + 16,
          top: payloadDragCursorPos.y + 4,
          pointerEvents: 'none',
          zIndex: 10000,
          backgroundColor: payloadDropError ? 'rgba(197, 48, 48, 0.93)' : 'rgba(118, 74, 188, 0.93)',
          color: '#fff',
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: '12px',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 10px rgba(0,0,0,0.22)',
          lineHeight: 1.5,
          userSelect: 'none',
        }}
      >
        {payloadDropError
          ? `⚠ ${payloadDropError}`
          : `${payloadOperation === 'copy' ? '⊕ Copy' : '→ Move'} ${transferSelection.length} cell${transferSelection.length !== 1 ? 's' : ''}`
        }
      </div>,
      document.body,
    )}
    {/* Floating popover for drag-select bulk editing */}
    {popoverPos && selectedCells.size > 0 && !isPayloadDragging && (
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
    <div style={{ padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`, borderBottom: `1px solid #e5e4e0`, display: 'flex', alignItems: 'center', gap: 12, backgroundColor: '#ffffff' }}>
      {isRoleManager && canPM ? (
        <>
          <Button
            size="small"
            appearance="primary"
            icon={<Add24Regular />}
            onClick={() => openAddLineDialog('demand')}
          >
            Add Demand
          </Button>
          <Button
            size="small"
            appearance="outline"
            icon={<Add24Regular />}
            onClick={() => openAddLineDialog('supply')}
          >
            Add Supply
          </Button>
        </>
      ) : (
        <Button
          size="small"
          appearance="primary"
          icon={<Add24Regular />}
          onClick={() => openAddLineDialog()}
        >
          Add Line
        </Button>
      )}
      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 8, fontSize: '11.5px', color: '#6b6966' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 14, height: 10, backgroundColor: DEMAND_TYPE_BG, borderLeft: `3px solid ${DEMAND_ACCENT}`, borderRadius: 2 }} />
          <span>Demand</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 14, height: 10, backgroundColor: SUPPLY_TYPE_BG, borderLeft: `3px solid ${SUPPLY_ACCENT}`, borderRadius: 2 }} />
          <span>Supply</span>
        </div>
        <div style={{ width: 1, height: 14, backgroundColor: '#e5e4e0' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#22c55e' }} />
          <span>Balanced</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#f59e0b' }} />
          <span>Gap</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#ef4444' }} />
          <span>Shortfall &gt;50%</span>
        </div>
      </div>
    </div>
    {/* Transfer selection action bar — shown when cells are Ctrl/Meta+clicked */}
    {transferSelection.length > 0 && (
      <div style={{
        padding: '6px 16px',
        backgroundColor: 'rgba(118, 74, 188, 0.07)',
        borderBottom: '1px solid rgba(118, 74, 188, 0.22)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: '12.5px',
        flexWrap: 'wrap' as const,
      }}>
        <span style={{ color: 'rgb(95, 56, 164)', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {transferSelection.length} {transferSelection[0].lineType} cell{transferSelection.length !== 1 ? 's' : ''} selected
        </span>
        <span style={{ color: '#9b9997' }}>·</span>
        <span style={{ color: tokens.colorNeutralForeground1, fontWeight: 500 }}>
          {transferSelection[0].sourceName}
        </span>
        <span style={{ color: '#9b9997' }}>·</span>
        <span style={{ color: tokens.colorNeutralForeground2 }}>
          {transferSelection[0].sourceProjectName}
        </span>
        <span style={{ color: '#9b9997', fontSize: '11.5px' }}>
          {transferSelection
            .slice()
            .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
            .map(c => `${MONTH_SHORT[c.month - 1]} ${c.value}%`)
            .join(', ')}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button size="small" appearance="secondary" onClick={() => openTransferDialog('copy')}>
            Copy to…
          </Button>
          <Button size="small" appearance="secondary" onClick={() => openTransferDialog('move')}>
            Move to…
          </Button>
          <Button
            size="small"
            appearance="subtle"
            onClick={() => setTransferSelection([])}
          >
            Clear
          </Button>
        </div>
      </div>
    )}
    <div style={{ position: 'relative' }}>
    {/* Sticky header — lives outside the overflow-x container so vertical sticky works */}
    <div ref={headerWrapRef} className={styles.headerWrap} onMouseLeave={() => { setHoveredColIdx(null); setHoveredProject(null); }}>
      <table className={styles.table} style={{ tableLayout: 'fixed', width: RESOURCE_COL_WIDTH + PROJECT_COL_WIDTH + TYPE_COL_WIDTH + periods.length * PERIOD_COL_WIDTH, minWidth: RESOURCE_COL_WIDTH + PROJECT_COL_WIDTH + TYPE_COL_WIDTH + periods.length * PERIOD_COL_WIDTH }}>
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
              TYPE
            </th>
            {periods.map((p, colIdx) => {
              const isHov = hoveredColIdx === colIdx;
              return (
                <th
                  key={p.id}
                  className={styles.th}
                  style={{
                    width: PERIOD_COL_PX,
                    minWidth: PERIOD_COL_PX,
                    backgroundColor: isHov ? COL_HOVER_HDR_BG : '#f6f5f2',
                  }}
                  onMouseEnter={() => setHoveredColIdx(colIdx)}
                  onMouseLeave={() => setHoveredColIdx(null)}
                >
                  <div style={{ fontSize: '11px', fontWeight: 600, lineHeight: 1.3 }}>
                    {MONTH_SHORT[p.month - 1]}
                  </div>
                  <div style={{ fontSize: '9.5px', fontWeight: 400, color: '#9b9997' }}>
                    {p.year}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
      </table>
    </div>
    {/* Body scroll container — overflow-x: auto without breaking vertical sticky */}
    <div ref={scrollContainerRef} className={mergeClasses(styles.wrapper, isDragging && styles.matrixContainerSelecting)} onMouseLeave={() => { setHoveredColIdx(null); setHoveredProject(null); }}>
      <table ref={tableRef} className={styles.table} style={{ tableLayout: 'fixed', width: RESOURCE_COL_WIDTH + PROJECT_COL_WIDTH + TYPE_COL_WIDTH + periods.length * PERIOD_COL_WIDTH, minWidth: RESOURCE_COL_WIDTH + PROJECT_COL_WIDTH + TYPE_COL_WIDTH + periods.length * PERIOD_COL_WIDTH }}>
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
                  {periodTotals.map(({ dSum, sSum }, i) => {
                    const isHov = hoveredColIdx === i;
                    const pipColor = getPipColor(dSum, sSum);
                    return (
                      <td
                        key={periods[i].id}
                        className={styles.summaryValueCell}
                        style={{
                          backgroundColor: isHov ? 'rgba(30,58,95,0.08)' : '#f1efeb',
                        }}
                        onMouseEnter={() => setHoveredColIdx(i)}
                        onMouseLeave={() => setHoveredColIdx(null)}
                      >
                        {/* health pip */}
                        <div style={{
                          width: '100%',
                          height: 4,
                          backgroundColor: pipColor,
                          borderRadius: 2,
                          marginBottom: 4,
                        }} />
                        <div style={{
                          backgroundColor: 'rgba(217,119,6,0.10)',
                          color: DEMAND_ACCENT,
                          borderRadius: 2,
                          padding: '1px 0',
                          fontFamily: 'monospace',
                        }}>
                          <span style={{ fontSize: '12px', fontWeight: 600 }}>{dSum > 0 ? `${dSum}%` : '—'}</span>
                        </div>
                        <div style={{
                          backgroundColor: 'rgba(13,148,136,0.10)',
                          color: SUPPLY_ACCENT,
                          borderRadius: 2,
                          padding: '1px 0',
                          fontFamily: 'monospace',
                        }}>
                          <span style={{ fontSize: '12px', fontWeight: 600 }}>{sSum > 0 ? `${sSum}%` : '—'}</span>
                        </div>
                      </td>
                    );
                  })}
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
                            const isLastProject = rowIdx === rg.rows.length - 1;

                            return (
                              <React.Fragment key={row.key}>
                                {/* Demand row */}
                                <tr style={{ backgroundColor: DEMAND_ROW_BG }}>
                                  {isFirstRow && (() => {
                                    const initials = row.isPlaceholder
                                      ? '?'
                                      : (row.resourceInitials || row.resourceName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2));
                                    const avatarBg = row.isPlaceholder ? '#9b9997' : getAvatarBg(row.resourceName);
                                    return (
                                      <td
                                        className={styles.resourceCell}
                                        rowSpan={totalRowSpan}
                                        title={row.resourceName}
                                        style={{
                                          ...(row.isPlaceholder ? { fontStyle: 'italic' } : {}),
                                          fontSize: '12.5px',
                                          fontWeight: 600,
                                          backgroundColor: '#ffffff',
                                          borderTop: '1px solid #e5e4e0',
                                        }}
                                      >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                          <div style={{
                                            flexShrink: 0,
                                            width: 40,
                                            height: 40,
                                            minWidth: 40,
                                            borderRadius: '50%',
                                            backgroundColor: avatarBg,
                                            color: '#ffffff',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '10px',
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
                                    onMouseEnter={() => setHoveredProject(row.key)}
                                    onMouseLeave={() => setHoveredProject(null)}
                                    style={{
                                      ...(row.isGeneral ? { fontStyle: 'italic' } : {}),
                                      paddingLeft: '12px',
                                      paddingRight: '4px',
                                      color: tokens.colorNeutralForeground2,
                                      fontSize: '12.5px',
                                      fontWeight: 600,
                                      borderBottom: '1px solid #efeeea',
                                      borderTop: rowIdx > 0 ? '2px solid #c8c4be' : '1px solid #e5e4e0',
                                      background: hoveredProject === row.key ? 'rgba(30,58,95,0.08), #ffffff' : '#ffffff',
                                      overflow: 'visible',
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, overflow: 'hidden' }}>
                                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                                        {row.projectName}
                                        {row.isGeneral && ' *'}
                                      </span>
                                    </div>
                                  </td>
                                  <td
                                    className={styles.typeCellDemand}
                                    onMouseEnter={() => setHoveredProject(row.key)}
                                    onMouseLeave={() => setHoveredProject(null)}
                                    style={{
                                      borderTop: rowIdx > 0 ? '2px solid #c8c4be' : '1px solid #e5e4e0',
                                      ...(hoveredProject === row.key ? { background: 'rgba(30,58,95,0.08), rgba(217,119,6,0.10), #ffffff' } : {}),
                                    }}
                                  >
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                      <span>Demand</span>
                                      {canEditDemand && !row.isGeneral && (
                                        <Menu>
                                          <MenuTrigger disableButtonEnhancement>
                                            <Tooltip content="Demand actions" relationship="label" appearance="inverted" withArrow>
                                              <Button
                                                size="small"
                                                appearance="subtle"
                                                icon={<MoreHorizontalRegular />}
                                                aria-label={`Demand actions for ${row.projectName}`}
                                                style={{
                                                  opacity: hoveredProject === row.key ? 1 : 0.35,
                                                  flexShrink: 0,
                                                  minWidth: '24px',
                                                  height: '20px',
                                                  padding: 0,
                                                }}
                                              />
                                            </Tooltip>
                                          </MenuTrigger>
                                          <MenuPopover>
                                            <MenuList>
                                              <MenuItem
                                                onClick={() => openMoveDialog(row)}
                                              >
                                                Move demand line
                                              </MenuItem>
                                              <MenuItem
                                                onClick={() => {
                                                  setDeleteGroupRow(row);
                                                  setDeleteGroupError(null);
                                                }}
                                              >
                                                Delete demand line
                                              </MenuItem>
                                            </MenuList>
                                          </MenuPopover>
                                        </Menu>
                                      )}
                                    </span>
                                  </td>
                                  {periods.map((period, colIndex) => {
                                    const dLine = row.demandByPeriod.get(period.id);
                                    const dVal = dLine?.fte_percent ?? 0;
                                    const existingCellKey = `d-${row.key}-${period.id}`;
                                    const dragCellKey = buildCellKey('demand', row.resourceId, row.placeholderId, row.projectId, period.id);
                                    const isSelectable = canEditDemand && !row.isGeneral;
                                    const canEdit = isSelectable && !isDragging;
                                    const isSelected = selectedCells.has(dragCellKey);
                                    const isTransferSelected = transferSelection.some(
                                      c => c.lineType === 'demand' && c.periodId === period.id && c.rowKey === row.key,
                                    );
                                    const isDimmed = isDragging && dragType !== 'demand' && dragStart?.ccId === group.ccId;
                                    const isCurPeriod = isCurrentPeriod(period);
                                    const isColHov = hoveredColIdx === colIndex;
                                    const isRowHov = hoveredProject === row.key;
                                    // Suppress hover tint while a payload drag is in progress
                                    const demandCellBgStyle: React.CSSProperties = (!isSelected && !isTransferSelected && !isPayloadDragging && (isColHov || isRowHov)) ? (
                                      isColHov && isRowHov
                                        ? { background: isCurPeriod ? 'rgba(30,58,95,0.14), rgba(217,119,6,0.26)' : 'rgba(30,58,95,0.12), rgba(217,119,6,0.22)' }
                                        : isColHov
                                          ? { backgroundColor: isCurPeriod ? 'rgba(217,119,6,0.22)' : 'rgba(217,119,6,0.18)' }
                                          : { background: 'rgba(30,58,95,0.08), rgba(217,119,6,0.10)' }
                                    ) : {};
                                    // Payload drag: is this cell the handle anchor (last selected)?
                                    const isLastTransferHandleCell = lastTransferCell !== null
                                      && lastTransferCell.lineType === 'demand'
                                      && lastTransferCell.rowKey === row.key
                                      && lastTransferCell.periodId === period.id;
                                    // Payload drag: is this cell a valid preview target?
                                    const isPayloadPreviewTarget = isPayloadDragging
                                      && !payloadDropError
                                      && payloadDropTarget !== null
                                      && payloadDropTarget.lineType === 'demand'
                                      && payloadDropTarget.rowKey === row.key
                                      && payloadPreviewPeriodIds.has(period.id);
                                    // Payload drag: is this the invalid drop-start cell?
                                    const isPayloadDropErrorCell = isPayloadDragging
                                      && payloadDropError !== null
                                      && payloadDropTarget !== null
                                      && payloadDropTarget.lineType === 'demand'
                                      && payloadDropTarget.rowKey === row.key
                                      && period.id === payloadDropTarget.periodId;
                                    return (
                                      <td
                                        key={period.id}
                                        className={mergeClasses(
                                          styles.valueCell,
                                          isSelectable && styles.cellEditable,
                                          isSelected && styles.cellSelected,
                                          isTransferSelected && styles.cellTransferSelected,
                                          isDimmed && styles.cellDimmed,
                                          isPayloadPreviewTarget && styles.cellPayloadPreviewTarget,
                                          isPayloadDropErrorCell && styles.cellPayloadDropError,
                                        )}
                                        style={{
                                          borderTop: rowIdx > 0 ? '2px solid #c8c4be' : '1px solid #e5e4e0',
                                          // position:relative needed so the drag handle can be absolute
                                          ...(isTransferSelected ? { position: 'relative' as const } : {}),
                                          ...demandCellBgStyle,
                                        }}
                                        data-row-index={demandRowIndex}
                                        data-col-index={colIndex}
                                        data-cell-key={dragCellKey}
                                        data-type="demand"
                                        data-period-id={period.id}
                                        data-row-key={row.key}
                                        data-resource-id={row.resourceId ?? ''}
                                        data-placeholder-id={row.placeholderId ?? ''}
                                        data-project-id={row.projectId ?? ''}
                                        data-year={period.year}
                                        data-month={period.month}
                                        data-period-status={period.status}
                                        onMouseDown={isSelectable
                                          ? (e) => {
                                            if (e.ctrlKey || e.metaKey) {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              if (dVal > 0 && period.status !== 'locked') {
                                                handleTransferToggle({
                                                  rowKey: row.key,
                                                  lineType: 'demand',
                                                  sourceResourceId: row.resourceId,
                                                  sourcePlaceholderId: row.placeholderId,
                                                  sourceProjectId: row.projectId,
                                                  periodId: period.id,
                                                  year: period.year,
                                                  month: period.month,
                                                  value: dVal,
                                                  costCenterId: group.ccId,
                                                  sourceName: row.resourceName,
                                                  sourceProjectName: row.projectName,
                                                });
                                              }
                                              return;
                                            }
                                            handleCellMouseDown(e, dragCellKey, 'demand', demandRowIndex, colIndex, row.resourceId, row.placeholderId, row.projectId, period.id, group.ccId);
                                          }
                                          : undefined}
                                        onMouseEnter={() => {
                                          setHoveredColIdx(colIndex);
                                          setHoveredProject(row.key);
                                          if (isDragging) handleCellMouseEnter(demandRowIndex, colIndex, allRows, group.ccId);
                                        }}
                                        onMouseLeave={() => { setHoveredColIdx(null); setHoveredProject(null); }}
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
                                        {isLastTransferHandleCell && (
                                          <div
                                            title="Drag to move. Hold Alt to copy."
                                            onMouseDown={e => handlePayloadDragStart(e, e.altKey)}
                                            style={{
                                              position: 'absolute',
                                              bottom: 2,
                                              right: 2,
                                              width: 10,
                                              height: 10,
                                              borderRadius: 2,
                                              backgroundColor: 'rgba(118, 74, 188, 0.85)',
                                              cursor: 'grab',
                                              zIndex: 2,
                                              flexShrink: 0,
                                            }}
                                          />
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                                {/* Supply row */}
                                <tr style={{ backgroundColor: SUPPLY_ROW_BG }}>
                                  {/* resource and project cells spanned by rowSpan above */}
                                  <td
                                    className={styles.typeCellSupply}
                                    onMouseEnter={() => setHoveredProject(row.key)}
                                    onMouseLeave={() => setHoveredProject(null)}
                                    style={{
                                      boxShadow: isLastProject ? `inset 3px 0 0 ${SUPPLY_ACCENT}` : `inset 3px 0 0 ${SUPPLY_ACCENT}, inset 0 -3px 0 #c8c4be`,
                                      ...(hoveredProject === row.key ? { background: 'rgba(30,58,95,0.08), rgba(13,148,136,0.10), #ffffff' } : {}),
                                    }}
                                  >
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                      <span>Supply</span>
                                      {canEditSupply && !row.isPlaceholder && (!editableCcIds || editableCcIds.has(group.ccId)) && (
                                        <Menu>
                                          <MenuTrigger disableButtonEnhancement>
                                            <Tooltip content="Supply actions" relationship="label" appearance="inverted" withArrow>
                                              <Button
                                                size="small"
                                                appearance="subtle"
                                                icon={<MoreHorizontalRegular />}
                                                aria-label={`Supply actions for ${row.projectName}`}
                                                style={{
                                                  opacity: hoveredProject === row.key ? 1 : 0.35,
                                                  flexShrink: 0,
                                                  minWidth: '24px',
                                                  height: '20px',
                                                  padding: 0,
                                                }}
                                              />
                                            </Tooltip>
                                          </MenuTrigger>
                                          <MenuPopover>
                                            <MenuList>
                                              <MenuItem
                                                onClick={() => openMoveSupplyDialog(row)}
                                              >
                                                Move supply line
                                              </MenuItem>
                                              <MenuItem
                                                onClick={() => {
                                                  setDeleteSupplyGroupRow(row);
                                                  setDeleteSupplyGroupError(null);
                                                }}
                                              >
                                                Delete supply line
                                              </MenuItem>
                                            </MenuList>
                                          </MenuPopover>
                                        </Menu>
                                      )}
                                    </span>
                                  </td>
                                  {periods.map((period, colIndex) => {
                                    const sLine = row.supplyByPeriod.get(period.id);
                                    const sVal = sLine?.fte_percent ?? 0;
                                    const existingCellKey = `s-${row.key}-${period.id}`;
                                    const dragCellKey = buildCellKey('supply', row.resourceId, row.placeholderId, row.projectId, period.id);
                                    const isSelectable = canEditSupply && !row.isPlaceholder && (!editableCcIds || editableCcIds.has(group.ccId));
                                    const canEdit = isSelectable && !isDragging;
                                    const isSelected = selectedCells.has(dragCellKey);
                                    const isTransferSelected = transferSelection.some(
                                      c => c.lineType === 'supply' && c.periodId === period.id && c.rowKey === row.key,
                                    );
                                    const isDimmed = isDragging && dragType !== 'supply' && dragStart?.ccId === group.ccId;
                                    const isCurPeriod = isCurrentPeriod(period);
                                    const isColHov = hoveredColIdx === colIndex;
                                    const isRowHov = hoveredProject === row.key;
                                    // Suppress hover tint while a payload drag is in progress
                                    const supplyCellBgStyle: React.CSSProperties = (!isSelected && !isTransferSelected && !isPayloadDragging && (isColHov || isRowHov)) ? (
                                      isColHov && isRowHov
                                        ? { background: isCurPeriod ? 'rgba(30,58,95,0.14), rgba(13,148,136,0.26)' : 'rgba(30,58,95,0.12), rgba(13,148,136,0.22)' }
                                        : isColHov
                                          ? { backgroundColor: isCurPeriod ? 'rgba(13,148,136,0.22)' : 'rgba(13,148,136,0.18)' }
                                          : { background: 'rgba(30,58,95,0.08), rgba(13,148,136,0.10)' }
                                    ) : {};
                                    // Payload drag: is this cell the handle anchor (last selected)?
                                    const isLastTransferHandleCell = lastTransferCell !== null
                                      && lastTransferCell.lineType === 'supply'
                                      && lastTransferCell.rowKey === row.key
                                      && lastTransferCell.periodId === period.id;
                                    // Payload drag: is this cell a valid preview target?
                                    const isPayloadPreviewTarget = isPayloadDragging
                                      && !payloadDropError
                                      && payloadDropTarget !== null
                                      && payloadDropTarget.lineType === 'supply'
                                      && payloadDropTarget.rowKey === row.key
                                      && payloadPreviewPeriodIds.has(period.id);
                                    // Payload drag: is this the invalid drop-start cell?
                                    const isPayloadDropErrorCell = isPayloadDragging
                                      && payloadDropError !== null
                                      && payloadDropTarget !== null
                                      && payloadDropTarget.lineType === 'supply'
                                      && payloadDropTarget.rowKey === row.key
                                      && period.id === payloadDropTarget.periodId;
                                    return (
                                      <td
                                        key={period.id}
                                        className={mergeClasses(
                                          styles.valueCell,
                                          isSelectable && styles.cellEditable,
                                          isSelected && styles.cellSelected,
                                          isTransferSelected && styles.cellTransferSelected,
                                          isDimmed && styles.cellDimmed,
                                          isPayloadPreviewTarget && styles.cellPayloadPreviewTarget,
                                          isPayloadDropErrorCell && styles.cellPayloadDropError,
                                        )}
                                        style={{
                                          ...(!isLastProject ? { boxShadow: 'inset 0 -3px 0 #c8c4be' } : {}),
                                          // position:relative needed so the drag handle can be absolute
                                          ...(isTransferSelected ? { position: 'relative' as const } : {}),
                                          ...supplyCellBgStyle,
                                        }}
                                        data-row-index={supplyRowIndex}
                                        data-col-index={colIndex}
                                        data-cell-key={dragCellKey}
                                        data-type="supply"
                                        data-period-id={period.id}
                                        data-row-key={row.key}
                                        data-resource-id={row.resourceId ?? ''}
                                        data-placeholder-id={row.placeholderId ?? ''}
                                        data-project-id={row.projectId ?? ''}
                                        data-year={period.year}
                                        data-month={period.month}
                                        data-period-status={period.status}
                                        onMouseDown={isSelectable
                                          ? (e) => {
                                            if (e.ctrlKey || e.metaKey) {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              if (sVal > 0 && period.status !== 'locked') {
                                                handleTransferToggle({
                                                  rowKey: row.key,
                                                  lineType: 'supply',
                                                  sourceResourceId: row.resourceId,
                                                  sourcePlaceholderId: row.placeholderId,
                                                  sourceProjectId: row.projectId,
                                                  periodId: period.id,
                                                  year: period.year,
                                                  month: period.month,
                                                  value: sVal,
                                                  costCenterId: group.ccId,
                                                  sourceName: row.resourceName,
                                                  sourceProjectName: row.projectName,
                                                });
                                              }
                                              return;
                                            }
                                            handleCellMouseDown(e, dragCellKey, 'supply', supplyRowIndex, colIndex, row.resourceId, row.placeholderId, row.projectId, period.id, group.ccId);
                                          }
                                          : undefined}
                                        onMouseEnter={() => {
                                          setHoveredColIdx(colIndex);
                                          setHoveredProject(row.key);
                                          if (isDragging) handleCellMouseEnter(supplyRowIndex, colIndex, allRows, group.ccId);
                                        }}
                                        onMouseLeave={() => { setHoveredColIdx(null); setHoveredProject(null); }}
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
                                        {isLastTransferHandleCell && (
                                          <div
                                            title="Drag to move. Hold Alt to copy."
                                            onMouseDown={e => handlePayloadDragStart(e, e.altKey)}
                                            style={{
                                              position: 'absolute',
                                              bottom: 2,
                                              right: 2,
                                              width: 10,
                                              height: 10,
                                              borderRadius: 2,
                                              backgroundColor: 'rgba(118, 74, 188, 0.85)',
                                              cursor: 'grab',
                                              zIndex: 2,
                                              flexShrink: 0,
                                            }}
                                          />
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              </React.Fragment>
                            );
                          })}

                          {/* Resource Total row */}
                          <tr style={{ backgroundColor: '#f6f5f2' }}>
                            <td style={{
                              position: 'sticky',
                              left: 0,
                              zIndex: 1,
                              minWidth: RESOURCE_COL_PX,
                              fontWeight: 600,
                              fontSize: '11px',
                              color: tokens.colorNeutralForeground2,
                              paddingLeft: '8px',
                              paddingTop: '5px',
                              paddingBottom: '5px',
                              backgroundColor: '#f6f5f2',
                              borderTop: '1px solid #e5e4e0',
                              borderBottom: '2px solid #e5e4e0',
                              borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
                            }}>
                              Total
                            </td>
                            <td style={{
                              position: 'sticky',
                              left: RESOURCE_COL_PX,
                              zIndex: 1,
                              minWidth: PROJECT_COL_PX,
                              backgroundColor: '#f6f5f2',
                              borderTop: '1px solid #e5e4e0',
                              borderBottom: '2px solid #e5e4e0',
                              borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
                            }} />
                            <td style={{
                              position: 'sticky',
                              left: TYPE_LEFT_PX,
                              zIndex: 1,
                              minWidth: TYPE_COL_PX,
                              backgroundColor: '#f6f5f2',
                              borderTop: '1px solid #e5e4e0',
                              borderBottom: '2px solid #e5e4e0',
                              fontSize: '10px',
                              fontWeight: 600,
                              padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
                              whiteSpace: 'nowrap' as const,
                            }}>
                              <div style={{ color: DEMAND_ACCENT, fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>DEMAND</div>
                              <div style={{ color: SUPPLY_ACCENT, fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>SUPPLY</div>
                            </td>
                            {rgPeriodTotals.map(({ dSum, sSum }, i) => {
                              const diff = sSum - dSum;
                              const statusColor = (dSum === 0 && sSum === 0)
                                ? '#e5e4e0'
                                : diff >= 0 ? '#22c55e' : '#ef4444';
                              const isColHov = hoveredColIdx === i;
                              const cellBg = isColHov ? 'rgba(30,58,95,0.08)' : '#f6f5f2';

                              return (
                                <td
                                  key={periods[i].id}
                                  style={{
                                    textAlign: 'center',
                                    width: PERIOD_COL_PX,
                                    minWidth: PERIOD_COL_PX,
                                    padding: `4px ${tokens.spacingHorizontalXS}`,
                                    borderTop: `2px solid ${statusColor}`,
                                    borderBottom: '2px solid #e5e4e0',
                                    verticalAlign: 'middle',
                                    backgroundColor: cellBg,
                                    fontFamily: 'monospace',
                                  }}
                                  onMouseEnter={() => setHoveredColIdx(i)}
                                  onMouseLeave={() => setHoveredColIdx(null)}
                                >
                                  <div style={{
                                    backgroundColor: 'rgba(217,119,6,0.10)',
                                    color: DEMAND_ACCENT,
                                    borderRadius: 2,
                                    padding: '1px 0',
                                  }}>
                                    <span style={{ fontSize: '12px', fontWeight: 600 }}>{dSum > 0 ? `${dSum}%` : '—'}</span>
                                  </div>
                                  <div style={{
                                    backgroundColor: 'rgba(13,148,136,0.10)',
                                    color: SUPPLY_ACCENT,
                                    borderRadius: 2,
                                    padding: '1px 0',
                                  }}>
                                    <span style={{ fontSize: '12px', fontWeight: 600 }}>{sSum > 0 ? `${sSum}%` : '—'}</span>
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        </React.Fragment>
                      );
                    })}

                    {/* Add demand line — always visible for effective PM (canPM), otherwise
                        restricted to Manager's editable CCs. Supply actions stay CC-gated. */}
                    {canEditDemand && (!editableCcIds || editableCcIds.has(group.ccId) || canPM) && (
                      <tr className={styles.addLineRow}>
                        <td
                          className={styles.addLineCell}
                          colSpan={totalCols}
                          style={{ position: 'sticky', left: 0 }}
                        >
                          {addDemandCC === group.ccId ? (
                            <div className={styles.addLineForm}>
                              {/* Resource / Placeholder searchable picker */}
                              <div style={{ minWidth: 200 }}>
                                <input
                                  ref={addDemandResInputRef}
                                  type="text"
                                  value={addDemandResQuery}
                                  onChange={e => { setAddDemandResQuery(e.target.value); setAddDemandForm(f => ({ ...f, resOrPh: '' })); setAddDemandResDropdownOpen(true); }}
                                  onFocus={() => setAddDemandResDropdownOpen(true)}
                                  onBlur={() => setTimeout(() => setAddDemandResDropdownOpen(false), 150)}
                                  placeholder="Resource..."
                                  style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, width: '100%', boxSizing: 'border-box' }}
                                />
                                {addDemandResDropdownOpen && addDemandResInputRef.current && createPortal(
                                  <FluentProvider theme={ferrosanTheme}>
                                    <div style={{ position: 'fixed', top: addDemandResInputRef.current.getBoundingClientRect().bottom + 2, left: addDemandResInputRef.current.getBoundingClientRect().left, minWidth: addDemandResInputRef.current.getBoundingClientRect().width, zIndex: 9999, backgroundColor: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, boxShadow: tokens.shadow16, maxHeight: 200, overflowY: 'auto' }}>
                                      {addDemandFilteredResAndPh.resources.length === 0 && addDemandFilteredResAndPh.placeholders.length === 0 ? (
                                        <div style={{ padding: '6px 8px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>No matching resources</div>
                                      ) : (
                                        <>
                                          {addDemandFilteredResAndPh.resources.length > 0 && addDemandFilteredResAndPh.placeholders.length > 0 && (
                                            <div style={{ padding: '2px 8px', fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightSemibold, backgroundColor: tokens.colorNeutralBackground2, borderBottom: `1px solid ${tokens.colorNeutralStroke1}` }}>Resources</div>
                                          )}
                                          {addDemandFilteredResAndPh.resources.map(r => (
                                            <div
                                              key={`r:${r.id}`}
                                              onMouseDown={e => { e.preventDefault(); setAddDemandForm(f => ({ ...f, resOrPh: `r:${r.id}` })); setAddDemandResQuery(r.display_name); setAddDemandResDropdownOpen(false); }}
                                              style={{ padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: tokens.fontSizeBase200, backgroundColor: addDemandForm.resOrPh === `r:${r.id}` ? tokens.colorNeutralBackground3 : tokens.colorNeutralBackground1 }}
                                              onMouseEnter={e => { e.currentTarget.style.backgroundColor = tokens.colorNeutralBackground3; }}
                                              onMouseLeave={e => { e.currentTarget.style.backgroundColor = addDemandForm.resOrPh === `r:${r.id}` ? tokens.colorNeutralBackground3 : tokens.colorNeutralBackground1; }}
                                            >
                                              <span style={{ background: avatarColor(r.display_name), color: '#fff', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: tokens.fontSizeBase100, fontWeight: tokens.fontWeightSemibold, flexShrink: 0 }}>
                                                {getInitials(r.display_name, r.initials)}
                                              </span>
                                              {r.display_name}
                                            </div>
                                          ))}
                                          {addDemandFilteredResAndPh.placeholders.length > 0 && addDemandFilteredResAndPh.resources.length > 0 && (
                                            <div style={{ padding: '2px 8px', fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightSemibold, backgroundColor: tokens.colorNeutralBackground2, borderTop: `1px solid ${tokens.colorNeutralStroke1}`, borderBottom: `1px solid ${tokens.colorNeutralStroke1}` }}>Placeholders</div>
                                          )}
                                          {addDemandFilteredResAndPh.placeholders.map(ph => (
                                            <div
                                              key={`ph:${ph.id}`}
                                              onMouseDown={e => { e.preventDefault(); setAddDemandForm(f => ({ ...f, resOrPh: `ph:${ph.id}` })); setAddDemandResQuery(ph.name); setAddDemandResDropdownOpen(false); }}
                                              style={{ padding: '6px 8px', cursor: 'pointer', fontSize: tokens.fontSizeBase200, backgroundColor: addDemandForm.resOrPh === `ph:${ph.id}` ? tokens.colorNeutralBackground3 : tokens.colorNeutralBackground1 }}
                                              onMouseEnter={e => { e.currentTarget.style.backgroundColor = tokens.colorNeutralBackground3; }}
                                              onMouseLeave={e => { e.currentTarget.style.backgroundColor = addDemandForm.resOrPh === `ph:${ph.id}` ? tokens.colorNeutralBackground3 : tokens.colorNeutralBackground1; }}
                                            >
                                              {ph.name}
                                            </div>
                                          ))}
                                        </>
                                      )}
                                    </div>
                                  </FluentProvider>,
                                  document.body
                                )}
                              </div>
                              {/* Project searchable picker */}
                              <div style={{ minWidth: 180 }}>
                                <input
                                  ref={addDemandProjectInputRef}
                                  type="text"
                                  value={addDemandProjectQuery}
                                  onChange={e => { setAddDemandProjectQuery(e.target.value); setAddDemandForm(f => ({ ...f, projectId: '' })); setAddDemandProjectDropdownOpen(true); }}
                                  onFocus={() => setAddDemandProjectDropdownOpen(true)}
                                  onBlur={() => setTimeout(() => setAddDemandProjectDropdownOpen(false), 150)}
                                  placeholder="Project..."
                                  style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, width: '100%', boxSizing: 'border-box' }}
                                />
                                {addDemandProjectDropdownOpen && addDemandProjectInputRef.current && createPortal(
                                  <FluentProvider theme={ferrosanTheme}>
                                    <div style={{ position: 'fixed', top: addDemandProjectInputRef.current.getBoundingClientRect().bottom + 2, left: addDemandProjectInputRef.current.getBoundingClientRect().left, minWidth: addDemandProjectInputRef.current.getBoundingClientRect().width, zIndex: 9999, backgroundColor: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, boxShadow: tokens.shadow16, maxHeight: 200, overflowY: 'auto' }}>
                                      {addDemandFilteredProjects.length === 0 ? (
                                        <div style={{ padding: '6px 8px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>No matching projects</div>
                                      ) : (
                                        addDemandFilteredProjects.map(p => (
                                          <div
                                            key={p.id}
                                            onMouseDown={e => { e.preventDefault(); setAddDemandForm(f => ({ ...f, projectId: p.id })); setAddDemandProjectQuery(p.name); setAddDemandProjectDropdownOpen(false); }}
                                            style={{ padding: '6px 8px', cursor: 'pointer', fontSize: tokens.fontSizeBase200, backgroundColor: addDemandForm.projectId === p.id ? tokens.colorNeutralBackground3 : tokens.colorNeutralBackground1 }}
                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = tokens.colorNeutralBackground3; }}
                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = addDemandForm.projectId === p.id ? tokens.colorNeutralBackground3 : tokens.colorNeutralBackground1; }}
                                          >
                                            <span style={{ fontWeight: tokens.fontWeightSemibold }}>{p.name}</span>
                                            {p.code && <span style={{ marginLeft: 6, color: tokens.colorNeutralForeground3 }}>{p.code}</span>}
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </FluentProvider>,
                                  document.body
                                )}
                              </div>
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
                                onClick={() => { setAddDemandCC(null); setAddDemandForm({ resOrPh: '', projectId: '' }); setAddDemandResQuery(''); setAddDemandProjectQuery(''); setAddDemandResDropdownOpen(false); setAddDemandProjectDropdownOpen(false); }}
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
                                setAddDemandResQuery('');
                                setAddDemandProjectQuery('');
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
                    {canEditSupply && (!editableCcIds || editableCcIds.has(group.ccId)) && (
                      <tr className={styles.addLineRow}>
                        <td
                          className={styles.addLineCell}
                          colSpan={totalCols}
                          style={{ position: 'sticky', left: 0 }}
                        >
                          {addSupplyCC === group.ccId ? (
                            <div className={styles.addLineForm}>
                              {/* Resource searchable picker */}
                              <div style={{ minWidth: 200 }}>
                                <input
                                  ref={addSupplyResInputRef}
                                  type="text"
                                  value={addSupplyResQuery}
                                  onChange={e => { setAddSupplyResQuery(e.target.value); setAddSupplyForm(f => ({ ...f, resourceId: '' })); setAddSupplyResDropdownOpen(true); }}
                                  onFocus={() => setAddSupplyResDropdownOpen(true)}
                                  onBlur={() => setTimeout(() => setAddSupplyResDropdownOpen(false), 150)}
                                  placeholder="Resource..."
                                  style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, width: '100%', boxSizing: 'border-box' }}
                                />
                                {addSupplyResDropdownOpen && addSupplyResInputRef.current && createPortal(
                                  <FluentProvider theme={ferrosanTheme}>
                                    <div style={{ position: 'fixed', top: addSupplyResInputRef.current.getBoundingClientRect().bottom + 2, left: addSupplyResInputRef.current.getBoundingClientRect().left, minWidth: addSupplyResInputRef.current.getBoundingClientRect().width, zIndex: 9999, backgroundColor: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, boxShadow: tokens.shadow16, maxHeight: 200, overflowY: 'auto' }}>
                                      {addSupplyFilteredResources.length === 0 ? (
                                        <div style={{ padding: '6px 8px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>No matching resources</div>
                                      ) : (
                                        addSupplyFilteredResources.map(r => (
                                          <div
                                            key={r.id}
                                            onMouseDown={e => { e.preventDefault(); setAddSupplyForm(f => ({ ...f, resourceId: r.id })); setAddSupplyResQuery(r.display_name); setAddSupplyResDropdownOpen(false); }}
                                            style={{ padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: tokens.fontSizeBase200, backgroundColor: addSupplyForm.resourceId === r.id ? tokens.colorNeutralBackground3 : tokens.colorNeutralBackground1 }}
                                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = tokens.colorNeutralBackground3; }}
                                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = addSupplyForm.resourceId === r.id ? tokens.colorNeutralBackground3 : tokens.colorNeutralBackground1; }}
                                          >
                                            <span style={{ background: avatarColor(r.display_name), color: '#fff', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: tokens.fontSizeBase100, fontWeight: tokens.fontWeightSemibold, flexShrink: 0 }}>
                                              {getInitials(r.display_name, r.initials)}
                                            </span>
                                            {r.display_name}
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </FluentProvider>,
                                  document.body
                                )}
                              </div>
                              {/* Project searchable picker (optional — empty = General availability) */}
                              <div style={{ minWidth: 180 }}>
                                <input
                                  ref={addSupplyProjectInputRef}
                                  type="text"
                                  value={addSupplyProjectQuery}
                                  onChange={e => { setAddSupplyProjectQuery(e.target.value); setAddSupplyForm(f => ({ ...f, projectId: '' })); setAddSupplyProjectDropdownOpen(true); }}
                                  onFocus={() => setAddSupplyProjectDropdownOpen(true)}
                                  onBlur={() => setTimeout(() => setAddSupplyProjectDropdownOpen(false), 150)}
                                  placeholder="Project..."
                                  style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, width: '100%', boxSizing: 'border-box' }}
                                />
                                {addSupplyProjectDropdownOpen && addSupplyProjectInputRef.current && createPortal(
                                  <FluentProvider theme={ferrosanTheme}>
                                    <div style={{ position: 'fixed', top: addSupplyProjectInputRef.current.getBoundingClientRect().bottom + 2, left: addSupplyProjectInputRef.current.getBoundingClientRect().left, minWidth: addSupplyProjectInputRef.current.getBoundingClientRect().width, zIndex: 9999, backgroundColor: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, boxShadow: tokens.shadow16, maxHeight: 200, overflowY: 'auto' }}>
                                      {(!addSupplyProjectQuery.trim() || 'general availability'.includes(addSupplyProjectQuery.trim().toLowerCase())) && (
                                        <div
                                          onMouseDown={e => { e.preventDefault(); setAddSupplyForm(f => ({ ...f, projectId: '' })); setAddSupplyProjectQuery(''); setAddSupplyProjectDropdownOpen(false); }}
                                          style={{ padding: '6px 8px', cursor: 'pointer', fontSize: tokens.fontSizeBase200, fontStyle: 'italic', color: tokens.colorNeutralForeground2, backgroundColor: !addSupplyForm.projectId ? tokens.colorNeutralBackground3 : tokens.colorNeutralBackground1 }}
                                          onMouseEnter={e => { e.currentTarget.style.backgroundColor = tokens.colorNeutralBackground3; }}
                                          onMouseLeave={e => { e.currentTarget.style.backgroundColor = !addSupplyForm.projectId ? tokens.colorNeutralBackground3 : tokens.colorNeutralBackground1; }}
                                        >
                                          — General availability —
                                        </div>
                                      )}
                                      {addSupplyFilteredProjects.map(p => (
                                        <div
                                          key={p.id}
                                          onMouseDown={e => { e.preventDefault(); setAddSupplyForm(f => ({ ...f, projectId: p.id })); setAddSupplyProjectQuery(p.name); setAddSupplyProjectDropdownOpen(false); }}
                                          style={{ padding: '6px 8px', cursor: 'pointer', fontSize: tokens.fontSizeBase200, backgroundColor: addSupplyForm.projectId === p.id ? tokens.colorNeutralBackground3 : tokens.colorNeutralBackground1 }}
                                          onMouseEnter={e => { e.currentTarget.style.backgroundColor = tokens.colorNeutralBackground3; }}
                                          onMouseLeave={e => { e.currentTarget.style.backgroundColor = addSupplyForm.projectId === p.id ? tokens.colorNeutralBackground3 : tokens.colorNeutralBackground1; }}
                                        >
                                          <span style={{ fontWeight: tokens.fontWeightSemibold }}>{p.name}</span>
                                          {p.code && <span style={{ marginLeft: 6, color: tokens.colorNeutralForeground3 }}>{p.code}</span>}
                                        </div>
                                      ))}
                                      {!(!addSupplyProjectQuery.trim() || 'general availability'.includes(addSupplyProjectQuery.trim().toLowerCase())) && addSupplyFilteredProjects.length === 0 && (
                                        <div style={{ padding: '6px 8px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>No matching projects</div>
                                      )}
                                    </div>
                                  </FluentProvider>,
                                  document.body
                                )}
                              </div>
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
                                onClick={() => { setAddSupplyCC(null); setAddSupplyForm({ resourceId: '', projectId: '' }); setAddSupplyResQuery(''); setAddSupplyProjectQuery(''); setAddSupplyResDropdownOpen(false); setAddSupplyProjectDropdownOpen(false); }}
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
                                setAddSupplyResQuery('');
                                setAddSupplyProjectQuery('');
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

              {/* Line Type — selectable for Finance/Admin and Manager+PM (can do both).
                  Fixed label for pure PM (demand only) and pure Manager (supply only). */}
              {(!isRolePM && !isRoleManager) || (isRoleManager && canPM) ? (
                <div>
                  <div style={{ marginBottom: 4, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold }}>Line Type</div>
                  <div style={{ display: 'flex', gap: tokens.spacingHorizontalL }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: tokens.fontSizeBase300 }}>
                      <input type="radio" name="dlgLineType" value="demand" checked={dlgLineType === 'demand'}
                        onChange={handleDlgSwitchToDemand} />
                      Demand
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: tokens.fontSizeBase300 }}>
                      <input type="radio" name="dlgLineType" value="supply" checked={dlgLineType === 'supply'}
                        onChange={handleDlgSwitchToSupply} />
                      Supply
                    </label>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 }}>
                  Line Type: <strong>{dlgLineType === 'demand' ? 'Demand' : 'Supply'}</strong>
                </div>
              )}

              {/* Cost Center — locked for Manager in supply mode; auto-detected from resource in demand mode.
                  Manager+PM in demand mode: CC comes from resource selection, not pre-selected. */}
              {isRoleManager && (dlgLineType === 'supply' || !canPM) ? (
                <div>
                  <div style={{ marginBottom: 4, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold }}>Cost Center</div>
                  {(editableCcIds ? editableCcIds.size > 1 : costCenters.length > 1) ? (
                    <select
                      value={dlgCcId}
                      onChange={e => {
                        setDlgCcId(e.target.value);
                        setDlgSelectedResources([]);
                        setDlgResourceQuery('');
                      }}
                      style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, width: '100%', backgroundColor: tokens.colorNeutralBackground1 }}
                    >
                      {(editableCcIds ? allCostCenters.filter(c => editableCcIds.has(c.id)) : costCenters)
                        .map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name}{managedCcIds.has(c.id) ? ' (My CC)' : ''}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <div style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground3, fontSize: tokens.fontSizeBase300 }}>
                      {allCostCenters.find(c => c.id === dlgCcId)?.name || costCenters[0]?.name || '—'}
                    </div>
                  )}
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
                        <span style={{ background: avatarColor(res.name), color: '#fff', borderRadius: '50%', width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: tokens.fontWeightSemibold, flexShrink: 0 }}>
                          {getInitials(res.name, res.initials)}
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
                    disabled={isRoleManager && dlgLineType === 'supply' && !dlgCcId}
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
                                <span style={{ background: avatarColor(r.display_name), color: '#fff', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: tokens.fontSizeBase100, fontWeight: tokens.fontWeightSemibold, flexShrink: 0 }}>
                                  {getInitials(r.display_name, r.initials)}
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
                {isRoleManager && canPM && dlgLineType === 'demand' && dlgPmProjectsLoading ? (
                  <div style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, color: tokens.colorNeutralForeground3, minWidth: 240 }}>
                    Loading assigned projects…
                  </div>
                ) : isRoleManager && canPM && dlgLineType === 'demand' && dlgPmProjects.length === 0 ? (
                  <div style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, color: tokens.colorNeutralForeground3, minWidth: 240 }}>
                    No assigned projects — ask Admin to assign you as Project Manager.
                  </div>
                ) : (
                  <select
                    value={dlgProjectId}
                    onChange={e => setDlgProjectId(e.target.value)}
                    style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, minWidth: 240 }}
                  >
                    <option value="">{dlgLineType === 'supply' ? '— General availability —' : 'Select project…'}</option>
                    {(isRoleManager && canPM && dlgLineType === 'demand'
                      ? dlgPmProjects
                      : projects.filter(p => p.is_active)
                    ).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}
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
                  min={5}
                  max={100}
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
    {/* Move Demand Group Dialog */}
    <Dialog
      open={moveGroupRow !== null}
      onOpenChange={(_, d) => { if (!d.open && !movingGroup) { setMoveGroupRow(null); setMoveTargetId(''); setMoveTargetProjectId(''); setMoveDemandQuery(''); setMoveDemandProjectQuery(''); setMoveDemandDropdownOpen(false); setMoveDemandProjectDropdownOpen(false); setMoveGroupError(null); } }}
    >
      <DialogSurface style={dlgSurfaceMove}>
        <DialogBody>
          <DialogTitle style={dlgTitleStyle}>Move demand line</DialogTitle>
          <DialogContent style={{ overflow: 'visible' }}>
            <div className={styles.actionDialogContent}>
              <div className={styles.actionDialogBodyText}>
                Moving demand for <strong>{moveGroupRow?.resourceName}</strong> on{' '}
                <strong>{moveGroupRow?.projectName}</strong> across{' '}
                <strong>{periods.length} open period{periods.length !== 1 ? 's' : ''}</strong>.
                Choose the target resource and project.
              </div>

              <div>
                <div style={{ marginBottom: 4, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold }}>
                  New resource
                </div>
                {moveResourcesLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                    <Spinner size="extra-tiny" /> Loading resources…
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      value={moveDemandQuery}
                      onChange={e => { setMoveDemandQuery(e.target.value); setMoveTargetId(''); setMoveDemandDropdownOpen(true); setMoveGroupError(null); }}
                      onFocus={() => setMoveDemandDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setMoveDemandDropdownOpen(false), 150)}
                      placeholder="Search by name or initials..."
                      style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, width: '100%', boxSizing: 'border-box' }}
                    />
                    {moveDemandDropdownOpen && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000, background: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, boxShadow: tokens.shadow8, maxHeight: 300, overflowY: 'auto' }}>
                        {moveDemandFilteredResources.length === 0 ? (
                          <div style={{ padding: '6px 8px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>No matching resources</div>
                        ) : (
                          moveDemandFilteredResources.map(r => (
                            <div
                              key={r.id}
                              onMouseDown={e => {
                                e.preventDefault();
                                setMoveTargetId(r.id);
                                setMoveDemandQuery('');
                                setMoveDemandDropdownOpen(false);
                                setMoveGroupError(null);
                              }}
                              style={{ padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: tokens.fontSizeBase200, backgroundColor: r.id === moveTargetId ? tokens.colorNeutralBackground3 : 'transparent' }}
                              onMouseEnter={e => { e.currentTarget.style.backgroundColor = tokens.colorNeutralBackground3; }}
                              onMouseLeave={e => { e.currentTarget.style.backgroundColor = r.id === moveTargetId ? tokens.colorNeutralBackground3 : 'transparent'; }}
                            >
                              <span style={{ background: avatarColor(r.display_name), color: '#fff', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: tokens.fontSizeBase100, fontWeight: tokens.fontWeightSemibold, flexShrink: 0 }}>
                                {getInitials(r.display_name, r.initials)}
                              </span>
                              {r.display_name}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
                {moveTargetId && (
                  <div style={{ marginTop: 4, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 }}>
                    Selected: <strong>{moveAllResources.find(r => r.id === moveTargetId)?.display_name ?? moveTargetId}</strong>
                  </div>
                )}
              </div>

              <div>
                <div style={{ marginBottom: 4, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold }}>
                  New project
                </div>
                {moveDemandProjectsLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                    <Spinner size="extra-tiny" /> Loading projects…
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      value={moveDemandProjectQuery}
                      onChange={e => { setMoveDemandProjectQuery(e.target.value); setMoveTargetProjectId(''); setMoveDemandProjectDropdownOpen(true); setMoveGroupError(null); }}
                      onFocus={() => setMoveDemandProjectDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setMoveDemandProjectDropdownOpen(false), 150)}
                      placeholder="Search by project name or code..."
                      style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, width: '100%', boxSizing: 'border-box' }}
                    />
                    {moveDemandProjectDropdownOpen && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999, background: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, boxShadow: tokens.shadow8, maxHeight: 300, overflowY: 'auto' }}>
                        {moveDemandFilteredProjects.length === 0 ? (
                          <div style={{ padding: '6px 8px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>No matching projects</div>
                        ) : (
                          moveDemandFilteredProjects.map(p => (
                            <div
                              key={p.id}
                              onMouseDown={e => {
                                e.preventDefault();
                                setMoveTargetProjectId(p.id);
                                setMoveDemandProjectQuery('');
                                setMoveDemandProjectDropdownOpen(false);
                                setMoveGroupError(null);
                              }}
                              style={{ padding: '6px 8px', cursor: 'pointer', fontSize: tokens.fontSizeBase200, backgroundColor: p.id === moveTargetProjectId ? tokens.colorNeutralBackground3 : 'transparent' }}
                              onMouseEnter={e => { e.currentTarget.style.backgroundColor = tokens.colorNeutralBackground3; }}
                              onMouseLeave={e => { e.currentTarget.style.backgroundColor = p.id === moveTargetProjectId ? tokens.colorNeutralBackground3 : 'transparent'; }}
                            >
                              <span style={{ fontWeight: tokens.fontWeightSemibold }}>{p.name}</span>
                              {p.code && <span style={{ marginLeft: 6, color: tokens.colorNeutralForeground3 }}>{p.code}</span>}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
                {moveTargetProjectId && (
                  <div style={{ marginTop: 4, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 }}>
                    Selected: <strong>{moveDemandAllProjects.find(p => p.id === moveTargetProjectId)?.name ?? moveTargetProjectId}</strong>
                  </div>
                )}
              </div>

              {moveGroupError && (
                <div className={styles.actionDialogError}>{moveGroupError}</div>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              style={compactBtn}
              onClick={() => { setMoveGroupRow(null); setMoveTargetId(''); setMoveTargetProjectId(''); setMoveDemandQuery(''); setMoveDemandProjectQuery(''); setMoveDemandDropdownOpen(false); setMoveDemandProjectDropdownOpen(false); setMoveGroupError(null); }}
              disabled={movingGroup}
            >
              Cancel
            </Button>
            <Button
              appearance="primary"
              style={compactBtn}
              onClick={handleMoveGroup}
              disabled={
                movingGroup ||
                !moveTargetId ||
                !moveTargetProjectId ||
                moveResourcesLoading ||
                moveDemandProjectsLoading ||
                (moveTargetId === moveGroupRow?.resourceId && moveTargetProjectId === moveGroupRow?.projectId)
              }
              icon={movingGroup ? <Spinner size="extra-tiny" /> : undefined}
            >
              Move demand
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>

    {/* Delete Demand Group Confirmation Dialog */}
    <Dialog
      open={deleteGroupRow !== null}
      onOpenChange={(_, d) => { if (!d.open && !deletingGroup) { setDeleteGroupRow(null); setDeleteGroupError(null); } }}
    >
      <DialogSurface style={dlgSurfaceDelete}>
        <DialogBody>
          <DialogTitle style={dlgTitleStyle}>Delete demand line?</DialogTitle>
          <DialogContent>
            <div className={styles.actionDialogContent}>
              <div className={styles.actionDialogBodyText}>
                This will remove all demand for{' '}
                <strong>{deleteGroupRow?.resourceName}</strong> on{' '}
                <strong>{deleteGroupRow?.projectName}</strong> across{' '}
                <strong>{periods.length} open period{periods.length !== 1 ? 's' : ''}</strong>.
              </div>
              <div className={styles.actionDialogSecondary}>
                Supply and actuals will not be affected.
              </div>
              {deleteGroupError && (
                <div className={styles.actionDialogError}>{deleteGroupError}</div>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              style={compactBtn}
              onClick={() => { setDeleteGroupRow(null); setDeleteGroupError(null); }}
              disabled={deletingGroup}
            >
              Cancel
            </Button>
            <Button
              appearance="primary"
              style={dangerBtn}
              onClick={handleDeleteGroup}
              disabled={deletingGroup}
              icon={deletingGroup ? <Spinner size="extra-tiny" /> : undefined}
            >
              Delete
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
    {/* Move Supply Group Dialog */}
    <Dialog
      open={moveSupplyGroupRow !== null}
      onOpenChange={(_, d) => { if (!d.open && !movingSupplyGroup) { setMoveSupplyGroupRow(null); setMoveSupplyTargetId(''); setMoveSupplyTargetProjectId(''); setMoveSupplyQuery(''); setMoveSupplyProjectQuery(''); setMoveSupplyDropdownOpen(false); setMoveSupplyProjectDropdownOpen(false); setMoveSupplyGroupError(null); } }}
    >
      <DialogSurface style={dlgSurfaceMove}>
        <DialogBody>
          <DialogTitle style={dlgTitleStyle}>Move supply line</DialogTitle>
          <DialogContent style={{ overflow: 'visible' }}>
            <div className={styles.actionDialogContent}>
              <div className={styles.actionDialogBodyText}>
                Moving supply for <strong>{moveSupplyGroupRow?.resourceName}</strong> on{' '}
                <strong>{moveSupplyGroupRow?.projectName}</strong> across{' '}
                <strong>{periods.length} open period{periods.length !== 1 ? 's' : ''}</strong>.
                Choose the target resource and project. Demand and actuals will not be affected.
              </div>

              <div>
                <div style={{ marginBottom: 4, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold }}>
                  New resource
                </div>
                {moveSupplyResourcesLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                    <Spinner size="extra-tiny" /> Loading resources…
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      value={moveSupplyQuery}
                      onChange={e => { setMoveSupplyQuery(e.target.value); setMoveSupplyTargetId(''); setMoveSupplyDropdownOpen(true); setMoveSupplyGroupError(null); }}
                      onFocus={() => setMoveSupplyDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setMoveSupplyDropdownOpen(false), 150)}
                      placeholder="Search by name or initials..."
                      style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, width: '100%', boxSizing: 'border-box' }}
                    />
                    {moveSupplyDropdownOpen && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000, background: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, boxShadow: tokens.shadow8, maxHeight: 300, overflowY: 'auto' }}>
                        {moveSupplyFilteredResources.length === 0 ? (
                          <div style={{ padding: '6px 8px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>No matching resources</div>
                        ) : (
                          moveSupplyFilteredResources.map(r => (
                            <div
                              key={r.id}
                              onMouseDown={e => {
                                e.preventDefault();
                                setMoveSupplyTargetId(r.id);
                                setMoveSupplyQuery('');
                                setMoveSupplyDropdownOpen(false);
                                setMoveSupplyGroupError(null);
                              }}
                              style={{ padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: tokens.fontSizeBase200, backgroundColor: r.id === moveSupplyTargetId ? tokens.colorNeutralBackground3 : 'transparent' }}
                              onMouseEnter={e => { e.currentTarget.style.backgroundColor = tokens.colorNeutralBackground3; }}
                              onMouseLeave={e => { e.currentTarget.style.backgroundColor = r.id === moveSupplyTargetId ? tokens.colorNeutralBackground3 : 'transparent'; }}
                            >
                              <span style={{ background: avatarColor(r.display_name), color: '#fff', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: tokens.fontSizeBase100, fontWeight: tokens.fontWeightSemibold, flexShrink: 0 }}>
                                {getInitials(r.display_name, r.initials)}
                              </span>
                              {r.display_name}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
                {moveSupplyTargetId && (
                  <div style={{ marginTop: 4, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 }}>
                    Selected: <strong>{moveSupplyAllResources.find(r => r.id === moveSupplyTargetId)?.display_name ?? moveSupplyTargetId}</strong>
                  </div>
                )}
              </div>

              <div>
                <div style={{ marginBottom: 4, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold }}>
                  New project
                </div>
                {moveSupplyProjectsLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                    <Spinner size="extra-tiny" /> Loading projects…
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      value={moveSupplyProjectQuery}
                      onChange={e => { setMoveSupplyProjectQuery(e.target.value); setMoveSupplyTargetProjectId(''); setMoveSupplyProjectDropdownOpen(true); setMoveSupplyGroupError(null); }}
                      onFocus={() => setMoveSupplyProjectDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setMoveSupplyProjectDropdownOpen(false), 150)}
                      placeholder="Search by project name or code..."
                      style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, width: '100%', boxSizing: 'border-box' }}
                    />
                    {moveSupplyProjectDropdownOpen && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999, background: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, boxShadow: tokens.shadow8, maxHeight: 300, overflowY: 'auto' }}>
                        {moveSupplyFilteredProjects.length === 0 ? (
                          <div style={{ padding: '6px 8px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>No matching projects</div>
                        ) : (
                          moveSupplyFilteredProjects.map(p => (
                            <div
                              key={p.id}
                              onMouseDown={e => {
                                e.preventDefault();
                                setMoveSupplyTargetProjectId(p.id);
                                setMoveSupplyProjectQuery('');
                                setMoveSupplyProjectDropdownOpen(false);
                                setMoveSupplyGroupError(null);
                              }}
                              style={{ padding: '6px 8px', cursor: 'pointer', fontSize: tokens.fontSizeBase200, backgroundColor: p.id === moveSupplyTargetProjectId ? tokens.colorNeutralBackground3 : 'transparent' }}
                              onMouseEnter={e => { e.currentTarget.style.backgroundColor = tokens.colorNeutralBackground3; }}
                              onMouseLeave={e => { e.currentTarget.style.backgroundColor = p.id === moveSupplyTargetProjectId ? tokens.colorNeutralBackground3 : 'transparent'; }}
                            >
                              <span style={{ fontWeight: tokens.fontWeightSemibold }}>{p.name}</span>
                              {p.code && <span style={{ marginLeft: 6, color: tokens.colorNeutralForeground3 }}>{p.code}</span>}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
                {moveSupplyTargetProjectId && (
                  <div style={{ marginTop: 4, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 }}>
                    Selected: <strong>{moveSupplyAllProjects.find(p => p.id === moveSupplyTargetProjectId)?.name ?? moveSupplyTargetProjectId}</strong>
                  </div>
                )}
              </div>

              {moveSupplyGroupError && (
                <div className={styles.actionDialogError}>{moveSupplyGroupError}</div>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              style={compactBtn}
              onClick={() => { setMoveSupplyGroupRow(null); setMoveSupplyTargetId(''); setMoveSupplyTargetProjectId(''); setMoveSupplyQuery(''); setMoveSupplyProjectQuery(''); setMoveSupplyDropdownOpen(false); setMoveSupplyProjectDropdownOpen(false); setMoveSupplyGroupError(null); }}
              disabled={movingSupplyGroup}
            >
              Cancel
            </Button>
            <Button
              appearance="primary"
              style={compactBtn}
              onClick={handleMoveSupplyGroup}
              disabled={
                movingSupplyGroup ||
                !moveSupplyTargetId ||
                !moveSupplyTargetProjectId ||
                moveSupplyResourcesLoading ||
                moveSupplyProjectsLoading ||
                (moveSupplyTargetId === moveSupplyGroupRow?.resourceId && moveSupplyTargetProjectId === moveSupplyGroupRow?.projectId)
              }
              icon={movingSupplyGroup ? <Spinner size="extra-tiny" /> : undefined}
            >
              Move supply
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>

    {/* Transfer Dialog — Copy to… / Move to… for cell-level selection */}
    <Dialog
      open={transferDialogMode !== null}
      onOpenChange={(_, d) => {
        if (!d.open && !transferDialogLoading) {
          setTransferDialogMode(null);
          setTransferDialogTargetResourceId('');
          setTransferDialogTargetProjectId(null);
          setTransferDialogResourceQuery('');
          setTransferDialogProjectQuery('');
          setTransferDialogError(null);
        }
      }}
    >
      <DialogSurface style={dlgSurfaceMove}>
        <DialogBody>
          <DialogTitle style={dlgTitleStyle}>
            {transferDialogMode === 'copy' ? 'Copy' : 'Move'}{' '}
            {transferSelection[0]?.lineType ?? ''} cells
          </DialogTitle>
          <DialogContent style={{ overflow: 'visible' }}>
            <div className={styles.actionDialogContent}>
              {/* Source summary */}
              <div className={styles.actionDialogBodyText} style={{ borderLeft: '3px solid rgba(118,74,188,0.5)', paddingLeft: 10 }}>
                <div><strong>{transferSelection[0]?.sourceName}</strong> · {transferSelection[0]?.sourceProjectName}</div>
                <div style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, marginTop: 2 }}>
                  {transferSelection
                    .slice()
                    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
                    .map(c => `${MONTH_SHORT[c.month - 1]} ${c.year}: ${c.value}%`)
                    .join(' · ')}
                </div>
              </div>

              {/* Target resource picker */}
              <div>
                <div style={{ marginBottom: 4, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold }}>
                  Target resource
                </div>
                {transferDialogResourcesLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                    <Spinner size="extra-tiny" /> Loading resources…
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      value={transferDialogResourceQuery}
                      onChange={e => { setTransferDialogResourceQuery(e.target.value); setTransferDialogTargetResourceId(''); setTransferDialogResourceDropdownOpen(true); setTransferDialogError(null); }}
                      onFocus={() => setTransferDialogResourceDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setTransferDialogResourceDropdownOpen(false), 150)}
                      placeholder="Search by name or initials..."
                      style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, width: '100%', boxSizing: 'border-box' }}
                    />
                    {transferDialogResourceDropdownOpen && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000, background: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, boxShadow: tokens.shadow8, maxHeight: 300, overflowY: 'auto' }}>
                        {transferDialogFilteredResources.length === 0 ? (
                          <div style={{ padding: '6px 8px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>No matching resources</div>
                        ) : (
                          transferDialogFilteredResources.map(r => (
                            <div
                              key={r.id}
                              onMouseDown={e => {
                                e.preventDefault();
                                setTransferDialogTargetResourceId(r.id);
                                setTransferDialogResourceQuery('');
                                setTransferDialogResourceDropdownOpen(false);
                                setTransferDialogError(null);
                              }}
                              style={{ padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: tokens.fontSizeBase200, backgroundColor: r.id === transferDialogTargetResourceId ? tokens.colorNeutralBackground3 : 'transparent' }}
                              onMouseEnter={e => { e.currentTarget.style.backgroundColor = tokens.colorNeutralBackground3; }}
                              onMouseLeave={e => { e.currentTarget.style.backgroundColor = r.id === transferDialogTargetResourceId ? tokens.colorNeutralBackground3 : 'transparent'; }}
                            >
                              <span style={{ background: avatarColor(r.display_name), color: '#fff', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: tokens.fontSizeBase100, fontWeight: tokens.fontWeightSemibold, flexShrink: 0 }}>
                                {getInitials(r.display_name, r.initials)}
                              </span>
                              {r.display_name}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
                {transferDialogTargetResourceId && (
                  <div style={{ marginTop: 4, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 }}>
                    Selected: <strong>{transferDialogResources.find(r => r.id === transferDialogTargetResourceId)?.display_name ?? transferDialogTargetResourceId}</strong>
                  </div>
                )}
              </div>

              {/* Target project picker */}
              <div>
                <div style={{ marginBottom: 4, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold }}>
                  Target project{transferSelection[0]?.lineType === 'supply' ? ' (leave blank for general availability)' : ''}
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={transferDialogProjectQuery}
                    onChange={e => { setTransferDialogProjectQuery(e.target.value); setTransferDialogTargetProjectId(transferSelection[0]?.lineType === 'supply' ? null : ''); setTransferDialogProjectDropdownOpen(true); setTransferDialogError(null); }}
                    onFocus={() => setTransferDialogProjectDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setTransferDialogProjectDropdownOpen(false), 150)}
                    placeholder={transferSelection[0]?.lineType === 'supply' ? 'Search or leave blank for GA…' : 'Search by project name or code…'}
                    style={{ padding: '5px 8px', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase300, width: '100%', boxSizing: 'border-box' }}
                  />
                  {transferDialogProjectDropdownOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999, background: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, boxShadow: tokens.shadow8, maxHeight: 300, overflowY: 'auto' }}>
                      {transferSelection[0]?.lineType === 'supply' && (!transferDialogProjectQuery.trim() || 'general availability'.includes(transferDialogProjectQuery.trim().toLowerCase())) && (
                        <div
                          onMouseDown={e => { e.preventDefault(); setTransferDialogTargetProjectId(null); setTransferDialogProjectQuery(''); setTransferDialogProjectDropdownOpen(false); setTransferDialogError(null); }}
                          style={{ padding: '6px 8px', cursor: 'pointer', fontSize: tokens.fontSizeBase200, fontStyle: 'italic', backgroundColor: transferDialogTargetProjectId === null ? tokens.colorNeutralBackground3 : 'transparent' }}
                          onMouseEnter={e => { e.currentTarget.style.backgroundColor = tokens.colorNeutralBackground3; }}
                          onMouseLeave={e => { e.currentTarget.style.backgroundColor = transferDialogTargetProjectId === null ? tokens.colorNeutralBackground3 : 'transparent'; }}
                        >
                          — General availability —
                        </div>
                      )}
                      {transferDialogFilteredProjects.length === 0 && transferSelection[0]?.lineType !== 'supply' ? (
                        <div style={{ padding: '6px 8px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>No matching projects</div>
                      ) : (
                        transferDialogFilteredProjects.map(p => (
                          <div
                            key={p.id}
                            onMouseDown={e => {
                              e.preventDefault();
                              setTransferDialogTargetProjectId(p.id);
                              setTransferDialogProjectQuery('');
                              setTransferDialogProjectDropdownOpen(false);
                              setTransferDialogError(null);
                            }}
                            style={{ padding: '6px 8px', cursor: 'pointer', fontSize: tokens.fontSizeBase200, backgroundColor: p.id === transferDialogTargetProjectId ? tokens.colorNeutralBackground3 : 'transparent' }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = tokens.colorNeutralBackground3; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = p.id === transferDialogTargetProjectId ? tokens.colorNeutralBackground3 : 'transparent'; }}
                          >
                            <span style={{ fontWeight: tokens.fontWeightSemibold }}>{p.name}</span>
                            {p.code && <span style={{ marginLeft: 6, color: tokens.colorNeutralForeground3 }}>{p.code}</span>}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {transferDialogTargetProjectId !== null && transferDialogTargetProjectId !== '' && (
                  <div style={{ marginTop: 4, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 }}>
                    Selected: <strong>{transferDialogProjects.find(p => p.id === transferDialogTargetProjectId)?.name ?? transferDialogTargetProjectId}</strong>
                  </div>
                )}
                {transferSelection[0]?.lineType === 'supply' && transferDialogTargetProjectId === null && !transferDialogProjectQuery && (
                  <div style={{ marginTop: 4, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>
                    Target: general availability
                  </div>
                )}
              </div>

              {transferDialogError && (
                <div className={styles.actionDialogError}>{transferDialogError}</div>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              style={compactBtn}
              onClick={() => { setTransferDialogMode(null); setTransferDialogTargetResourceId(''); setTransferDialogTargetProjectId(null); setTransferDialogResourceQuery(''); setTransferDialogProjectQuery(''); setTransferDialogError(null); }}
              disabled={transferDialogLoading}
            >
              Cancel
            </Button>
            <Button
              appearance="primary"
              style={compactBtn}
              onClick={handleTransferSubmit}
              disabled={
                transferDialogLoading ||
                !transferDialogTargetResourceId ||
                (transferSelection[0]?.lineType === 'demand' && !transferDialogTargetProjectId) ||
                (transferDialogTargetResourceId === transferSelection[0]?.sourceResourceId && transferDialogTargetProjectId === transferSelection[0]?.sourceProjectId) ||
                transferDialogResourcesLoading
              }
              icon={transferDialogLoading ? <Spinner size="extra-tiny" /> : undefined}
            >
              {transferDialogMode === 'copy' ? 'Copy' : 'Move'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>

    {/* Demand Move Would Exceed 100% — Cap Confirmation Dialog */}
    <Dialog
      open={demandCapPeriods.length > 0}
      onOpenChange={(_, d) => { if (!d.open && !confirmingDemandCap) { setDemandCapPeriods([]); setDemandCapPendingBody(null); } }}
    >
      <DialogSurface style={{ maxWidth: 500, borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)', padding: '20px 24px' }}>
        <DialogBody>
          <DialogTitle style={dlgTitleStyle}>Move would exceed 100%</DialogTitle>
          <DialogContent>
            <div className={styles.actionDialogContent}>
              <div className={styles.actionDialogBodyText}>
                Some target months already have demand on this resource and project. Moving this line would
                exceed 100%. If you proceed, those months will be capped at 100%.
              </div>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {demandCapPeriods.map(p => (
                  <div key={p.period_id} style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 }}>
                    <strong>{p.label}</strong>: existing {p.existing_fte}% + moved {p.moved_fte}% = {p.raw_total}%, capped to 100%
                  </div>
                ))}
              </div>
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              style={compactBtn}
              onClick={() => { setDemandCapPeriods([]); setDemandCapPendingBody(null); }}
              disabled={confirmingDemandCap}
            >
              Cancel
            </Button>
            <Button
              appearance="primary"
              style={compactBtn}
              onClick={handleDemandCapConfirm}
              disabled={confirmingDemandCap}
              icon={confirmingDemandCap ? <Spinner size="extra-tiny" /> : undefined}
            >
              Proceed and cap at 100
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>

    {/* Supply Move Would Exceed 100% — Cap Confirmation Dialog */}
    <Dialog
      open={supplyCapPeriods.length > 0}
      onOpenChange={(_, d) => { if (!d.open && !confirmingSupplyCap) { setSupplyCapPeriods([]); setSupplyCapPendingBody(null); } }}
    >
      <DialogSurface style={{ maxWidth: 500, borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)', padding: '20px 24px' }}>
        <DialogBody>
          <DialogTitle style={dlgTitleStyle}>Move would exceed 100%</DialogTitle>
          <DialogContent>
            <div className={styles.actionDialogContent}>
              <div className={styles.actionDialogBodyText}>
                Some target months already have supply on this resource and project. Moving this line would
                exceed 100%. If you proceed, those months will be capped at 100%.
              </div>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {supplyCapPeriods.map(p => (
                  <div key={p.period_id} style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 }}>
                    <strong>{p.label}</strong>: existing {p.existing_fte}% + moved {p.moved_fte}% = {p.raw_total}%, capped to 100%
                  </div>
                ))}
              </div>
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              style={compactBtn}
              onClick={() => { setSupplyCapPeriods([]); setSupplyCapPendingBody(null); }}
              disabled={confirmingSupplyCap}
            >
              Cancel
            </Button>
            <Button
              appearance="primary"
              style={compactBtn}
              onClick={handleSupplyCapConfirm}
              disabled={confirmingSupplyCap}
              icon={confirmingSupplyCap ? <Spinner size="extra-tiny" /> : undefined}
            >
              Proceed and cap at 100
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>

    {/* Transfer Would Exceed 100% — Cap Confirmation Dialog */}
    <Dialog
      open={transferCapPeriods.length > 0}
      onOpenChange={(_, d) => { if (!d.open && !confirmingTransferCap) { setTransferCapPeriods([]); setTransferCapPendingBody(null); setTransferCapLineType(null); } }}
    >
      <DialogSurface style={{ maxWidth: 500, borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)', padding: '20px 24px' }}>
        <DialogBody>
          <DialogTitle style={dlgTitleStyle}>Transfer would exceed 100%</DialogTitle>
          <DialogContent>
            <div className={styles.actionDialogContent}>
              <div className={styles.actionDialogBodyText}>
                Some target months already have {transferCapLineType} on this resource and project.
                The transfer would exceed 100%. If you proceed, those months will be capped at 100%.
              </div>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {transferCapPeriods.map(p => (
                  <div key={p.period_id} style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 }}>
                    <strong>{p.label}</strong>: existing {p.existing_fte}% + transferred {p.moved_fte}% = {p.raw_total}%, capped to 100%
                  </div>
                ))}
              </div>
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              style={compactBtn}
              onClick={() => { setTransferCapPeriods([]); setTransferCapPendingBody(null); setTransferCapLineType(null); }}
              disabled={confirmingTransferCap}
            >
              Cancel
            </Button>
            <Button
              appearance="primary"
              style={compactBtn}
              onClick={handleTransferCapConfirm}
              disabled={confirmingTransferCap}
              icon={confirmingTransferCap ? <Spinner size="extra-tiny" /> : undefined}
            >
              Proceed and cap at 100
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>

    {/* Delete Supply Group Confirmation Dialog */}
    <Dialog
      open={deleteSupplyGroupRow !== null}
      onOpenChange={(_, d) => { if (!d.open && !deletingSupplyGroup) { setDeleteSupplyGroupRow(null); setDeleteSupplyGroupError(null); } }}
    >
      <DialogSurface style={dlgSurfaceDelete}>
        <DialogBody>
          <DialogTitle style={dlgTitleStyle}>Delete supply line?</DialogTitle>
          <DialogContent>
            <div className={styles.actionDialogContent}>
              <div className={styles.actionDialogBodyText}>
                This will remove supply for{' '}
                <strong>{deleteSupplyGroupRow?.resourceName}</strong> on{' '}
                <strong>{deleteSupplyGroupRow?.projectName}</strong> across the visible open periods.
              </div>
              <div className={styles.actionDialogSecondary}>
                Demand and actuals will not be affected.
              </div>
              {deleteSupplyGroupError && (
                <div className={styles.actionDialogError}>{deleteSupplyGroupError}</div>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              style={compactBtn}
              onClick={() => { setDeleteSupplyGroupRow(null); setDeleteSupplyGroupError(null); }}
              disabled={deletingSupplyGroup}
            >
              Cancel
            </Button>
            <Button
              appearance="primary"
              style={dangerBtn}
              onClick={handleDeleteSupplyGroup}
              disabled={deletingSupplyGroup}
              icon={deletingSupplyGroup ? <Spinner size="extra-tiny" /> : undefined}
            >
              Delete
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
        onClick={canEdit ? (e: React.MouseEvent) => { if (!e.ctrlKey && !e.metaKey) handleStartEdit(); } : undefined}
        title={canEdit ? 'Click to edit · Ctrl+click to select' : undefined}
      >
        {value}%
      </span>
    );
  }

  if (canEdit) {
    return (
      <span className={styles.emptyCell} onClick={(e: React.MouseEvent) => { if (!e.ctrlKey && !e.metaKey) handleStartEdit(); }} title="Click to add">
        —
      </span>
    );
  }

  return <span className={styles.emptyCellReadonly}>—</span>;
};

export default ResourcePlanningMatrix;
