import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Label,
  Spinner,
  tokens,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components';
import { Add24Regular, ChevronRight20Regular, ChevronDown20Regular, DeleteRegular, EditRegular } from '@fluentui/react-icons';
import { projectCostsApi, ExternalLine, EquipmentLine } from '../../api/projectCosts';
import { lookupsApi } from '../../api/lookups';
import { periodsApi } from '../../api/periods';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../hooks/useToast';
import type { Period } from '../../types';
import { MONTH_SHORT } from '../../utils/format';

// ─── Layout constants ─────────────────────────────────────────────────────────

const PROJECT_COL_WIDTH = 180;
const DESC_COL_WIDTH = 210;
const TYPE_COL_WIDTH = 60;
const PERIOD_COL_WIDTH = 100;
const PROJECT_COL_PX = `${PROJECT_COL_WIDTH}px`;
const DESC_COL_PX = `${DESC_COL_WIDTH}px`;
const TYPE_COL_PX = `${TYPE_COL_WIDTH}px`;
const PERIOD_COL_PX = `${PERIOD_COL_WIDTH}px`;
const DESC_LEFT_PX = `${PROJECT_COL_WIDTH}px`;
const TYPE_LEFT_PX = `${PROJECT_COL_WIDTH + DESC_COL_WIDTH}px`;
const FIXED_AREA_WIDTH = PROJECT_COL_WIDTH + DESC_COL_WIDTH + TYPE_COL_WIDTH;
const FIXED_AREA_PX = `${FIXED_AREA_WIDTH}px`;

const C = {
  oopAccent:    '#9a5b00',
  oopBg:        '#fbe8cf',
  oopTint:      'rgba(251, 232, 207, 0.25)',
  oopHover:     'rgba(251, 232, 207, 0.45)',
  equipAccent:  '#1e3a5f',
  equipBg:      '#e3eaf2',
  equipTint:    'rgba(227, 234, 242, 0.25)',
  equipHover:   'rgba(227, 234, 242, 0.45)',

  line:         '#e5e4e0',
  surface2:     '#f6f5f2',
  ink2:         '#424242',
  ink3:         '#707070',
  ink4:         '#a8a8a8',
  ink5:         '#cfcfcc',
  grandTotalBg: '#efece6',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDKK(cents: number): string {
  return new Intl.NumberFormat('da-DK').format(Math.round(cents / 100));
}

function makeCellKey(projectId: string, type: string, description: string, periodId: string): string {
  return `${projectId}::${type}::${encodeURIComponent(description)}::${periodId}`;
}

function parseCellKey(key: string): { projectId: string; type: 'oop'|'equip'; description: string; periodId: string } {
  const parts = key.split('::');
  return { projectId: parts[0], type: parts[1] as 'oop'|'equip', description: decodeURIComponent(parts[2]), periodId: parts[3] };
}

// ─── Data types ───────────────────────────────────────────────────────────────

interface PeriodCell {
  id: string;
  cost: number;
  isMulti: boolean;
}

interface MatrixLine {
  lineKey: string;
  description: string;
  type: 'oop' | 'equip';
  isLocal: boolean;
  costsByPeriod: Map<string, PeriodCell>;
}

interface ProjectGroup {
  projectId: string;
  projectName: string;
  pmUserIds: string[];
  lines: MatrixLine[];
  totalsByPeriod: Map<string, number>;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const MONO = "'JetBrains Mono', 'ui-monospace', monospace";

const useStyles = makeStyles({
  cardWrapper: {
    background: 'white',
    border: `1px solid ${C.line}`,
    borderRadius: '10px',
    boxShadow: '0 1px 2px rgba(15,15,15,0.04)',
    overflow: 'hidden',
  },
  wrapper: { overflowX: 'auto', width: '100%' },
  matrixSelecting: { userSelect: 'none' as const },
  table: { borderCollapse: 'collapse', minWidth: '100%', fontSize: '13px', tableLayout: 'fixed' as const },

  th: {
    fontWeight: 500,
    fontSize: '10px',
    color: C.ink3,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${C.line}`,
    backgroundColor: C.surface2,
    textAlign: 'center' as const,
    whiteSpace: 'nowrap' as const,
    position: 'sticky' as const,
    top: 0,
    zIndex: 2,
  },
  thProject: { position: 'sticky' as const, left: 0, zIndex: 4, textAlign: 'left' as const, minWidth: PROJECT_COL_PX },
  thDesc:    { position: 'sticky' as const, left: DESC_LEFT_PX, zIndex: 4, textAlign: 'left' as const, minWidth: DESC_COL_PX },
  thType:    { position: 'sticky' as const, left: TYPE_LEFT_PX, zIndex: 4, textAlign: 'left' as const, minWidth: TYPE_COL_PX },
  summaryRow: {
    cursor: 'pointer',
    backgroundColor: 'white',
    ':hover': { backgroundColor: C.surface2 },
  },
  summaryFixed: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderTop: `1px solid ${C.line}`,
    borderBottom: `1px solid ${C.line}`,
    position: 'sticky' as const,
    left: 0,
    backgroundColor: 'white',
    zIndex: 1,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: '13.5px',
    minWidth: PROJECT_COL_PX,
    maxWidth: PROJECT_COL_PX,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  summaryFixedSpanned: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderTop: `1px solid ${C.line}`,
    borderBottom: `1px solid ${C.line}`,
    position: 'sticky' as const,
    left: 0,
    backgroundColor: 'white',
    zIndex: 1,
    width: FIXED_AREA_PX,
    minWidth: FIXED_AREA_PX,
    maxWidth: FIXED_AREA_PX,
    overflow: 'hidden' as const,
  },
  summaryDesc: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderTop: `1px solid ${C.line}`,
    borderBottom: `1px solid ${C.line}`,
    position: 'sticky' as const,
    left: DESC_LEFT_PX,
    backgroundColor: 'white',
    zIndex: 1,
    minWidth: DESC_COL_PX,
    maxWidth: DESC_COL_PX,
  },
  summaryType: {
    padding: `2px ${tokens.spacingHorizontalXS}`,
    borderTop: `1px solid ${C.line}`,
    borderBottom: `1px solid ${C.line}`,
    position: 'sticky' as const,
    left: TYPE_LEFT_PX,
    backgroundColor: 'white',
    zIndex: 1,
    minWidth: TYPE_COL_PX,
    maxWidth: TYPE_COL_PX,
  },
  summaryValueCell: {
    padding: `2px ${tokens.spacingHorizontalXS}`,
    borderTop: `1px solid ${C.line}`,
    borderBottom: `1px solid ${C.line}`,
    textAlign: 'center' as const,
    width: PERIOD_COL_PX,
    minWidth: PERIOD_COL_PX,
    verticalAlign: 'middle' as const,
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums' as const,
    fontSize: '11px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
  },

  projectCell: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${C.line}`,
    position: 'sticky' as const,
    left: 0,
    zIndex: 1,
    minWidth: PROJECT_COL_PX,
    maxWidth: PROJECT_COL_PX,
  },
  descCell: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${C.line}`,
    position: 'sticky' as const,
    left: DESC_LEFT_PX,
    zIndex: 1,
    minWidth: DESC_COL_PX,
    maxWidth: DESC_COL_PX,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
    verticalAlign: 'middle' as const,
    fontSize: '13px',
  },
  typeCellOop: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalXS}`,
    borderBottom: `1px solid ${C.line}`,
    position: 'sticky' as const,
    left: TYPE_LEFT_PX,
    zIndex: 1,
    whiteSpace: 'nowrap' as const,
    minWidth: TYPE_COL_PX,
    verticalAlign: 'middle' as const,
  },
  typeCellEquip: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalXS}`,
    borderBottom: `1px solid ${C.line}`,
    position: 'sticky' as const,
    left: TYPE_LEFT_PX,
    zIndex: 1,
    whiteSpace: 'nowrap' as const,
    minWidth: TYPE_COL_PX,
    verticalAlign: 'middle' as const,
  },
  badgeOop: {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    fontSize: '10px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    padding: '2px 6px',
    borderRadius: '3px',
    fontWeight: 600,
    lineHeight: '1.4',
    background: C.oopBg,
    color: C.oopAccent,
    border: '1px solid rgba(154,91,0,0.15)',
  },
  badgeEquip: {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    fontSize: '10px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    padding: '2px 6px',
    borderRadius: '3px',
    fontWeight: 600,
    lineHeight: '1.4',
    background: C.equipBg,
    color: C.equipAccent,
    border: '1px solid rgba(30,58,95,0.15)',
  },
  deleteBtn: {
    minWidth: 0,
    padding: '0 2px',
    transition: 'opacity 0.12s ease',
    ':hover': { backgroundColor: '#f6dad7', color: '#a32f2a' },
  },

  valueCell: {
    padding: '2px 2px',
    borderBottom: `1px solid ${C.line}`,
    textAlign: 'center' as const,
    width: PERIOD_COL_PX,
    minWidth: PERIOD_COL_PX,
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums' as const,
    fontSize: '12.5px',
  },
  cellEditable: {
    cursor: 'crosshair',
    ':hover': { backgroundColor: tokens.colorBrandBackground2, opacity: 0.8 },
  },
  cellSelected: {
    backgroundColor: tokens.colorBrandBackground2,
    outline: `2px solid ${tokens.colorBrandBackground}`,
    outlineOffset: '-2px',
  },
  cellDimmed: { opacity: 0.35, pointerEvents: 'none' as const },

  cellInput: {
    width: '80px',
    textAlign: 'right' as const,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    borderRadius: tokens.borderRadiusSmall,
    padding: '2px 4px',
    fontSize: tokens.fontSizeBase200,
    outline: 'none',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  cellValue: {
    display: 'inline-block',
    minWidth: '64px',
    padding: '2px 4px',
    borderRadius: tokens.borderRadiusSmall,
    cursor: 'pointer',
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums' as const,
    fontSize: '12.5px',
    textAlign: 'center' as const,
    backgroundColor: tokens.colorNeutralBackground3,
    margin: '0 auto',
    ':hover': { filter: 'brightness(0.92)' },
  },
  emptyCell: {
    color: C.ink5,
    cursor: 'pointer',
    fontFamily: MONO,
    fontSize: '12.5px',
    display: 'inline-block',
    minWidth: '64px',
    padding: '2px 4px',
    borderRadius: tokens.borderRadiusSmall,
    ':hover': { backgroundColor: tokens.colorNeutralBackground3 },
  },
  emptyCellReadonly: {
    color: C.ink5,
    fontFamily: MONO,
    fontSize: '12.5px',
    display: 'inline-block',
    minWidth: '64px',
    padding: '2px 4px',
  },
  multiCell: {
    display: 'inline-block',
    minWidth: '64px',
    padding: '2px 4px',
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums' as const,
    fontSize: '12.5px',
    color: tokens.colorNeutralForeground2,
    cursor: 'default',
  },

  addLineRow: { backgroundColor: 'white' },
  addLineCell: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${C.line}`,
    position: 'sticky' as const,
    left: 0,
  },
  addLineForm: { display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'center', flexWrap: 'wrap' as const },

  totalsOopRow: { backgroundColor: C.oopHover },
  totalsEquipRow: { backgroundColor: C.equipHover },
  totalsGrandRow: { backgroundColor: C.grandTotalBg },
  totalsCellLabel: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderTop: `2px solid ${C.line}`,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: '11px',
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    position: 'sticky' as const,
    left: 0,
    zIndex: 1,
  },
  totalsCellValue: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalXS}`,
    borderTop: `2px solid ${C.line}`,
    textAlign: 'center' as const,
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums' as const,
    fontSize: '12px',
    fontWeight: tokens.fontWeightSemibold,
    width: PERIOD_COL_PX,
    minWidth: PERIOD_COL_PX,
  },
  grandTotalCellLabel: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderTop: `2px solid ${C.line}`,
    fontWeight: 700,
    fontSize: '11.5px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: C.ink2,
    backgroundColor: C.grandTotalBg,
    position: 'sticky' as const,
    left: 0,
    zIndex: 1,
  },
  grandTotalCellValue: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalXS}`,
    borderTop: `2px solid ${C.line}`,
    textAlign: 'center' as const,
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums' as const,
    fontSize: '13px',
    fontWeight: 700,
    backgroundColor: C.grandTotalBg,
    width: PERIOD_COL_PX,
    minWidth: PERIOD_COL_PX,
  },

  // Floating popover (replaces top toolbar)
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

  loading: { display: 'flex', justifyContent: 'center', padding: tokens.spacingVerticalXXL },
});

// ─── CostCellEditor ───────────────────────────────────────────────────────────

interface CostCellEditorProps {
  cell: PeriodCell | undefined;
  isEditing: boolean;
  isSaving: boolean;
  canEdit: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (dkkValue: number) => void;
  styles: ReturnType<typeof useStyles>;
}

const CostCellEditor: React.FC<CostCellEditorProps> = ({
  cell, isEditing, isSaving, canEdit, onStartEdit, onCancel, onSave, styles,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputVal, setInputVal] = useState('');

  const handleStartEdit = () => {
    setInputVal(cell && cell.cost > 0 ? String(Math.round(cell.cost / 100)) : '');
    onStartEdit();
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    const num = inputVal === '' ? 0 : parseFloat(inputVal);
    if (isNaN(num) || num < 0) { onCancel(); return; }
    onSave(Math.round(num));
  };

  if (isSaving) return <Spinner size="extra-tiny" />;

  if (cell?.isMulti) {
    return (
      <span className={styles.multiCell} title="Multiple line items — use list view to manage">
        {fmtDKK(cell.cost)}{' '}
        <span style={{ fontSize: '10px', color: tokens.colorNeutralForeground4 }}>(multi)</span>
      </span>
    );
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={0}
        step={1}
        value={inputVal}
        className={styles.cellInput}
        onChange={e => setInputVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel(); }}
        onBlur={commit}
        autoFocus
      />
    );
  }

  if (cell && cell.cost > 0) {
    return (
      <span className={styles.cellValue} onClick={canEdit ? handleStartEdit : undefined} title={canEdit ? 'Click to edit' : undefined}>
        {fmtDKK(cell.cost)}
      </span>
    );
  }

  if (!canEdit) return <span className={styles.emptyCellReadonly}>—</span>;
  return <span className={styles.emptyCell} onClick={handleStartEdit} title="Click to add">—</span>;
};

// ─── Main component ───────────────────────────────────────────────────────────

export const ProjectCostsMatrix: React.FC = () => {
  const styles = useStyles();
  const { user } = useAuth();
  const { showApiError } = useToast();

  const isFinanceOrAdmin = user?.role === 'Finance' || user?.role === 'Admin';
  const isPM = user?.role === 'PM';

  // The backend's /lookups/projects/scoped already restricts PMs to their assigned
  // projects only, so any project returned to a PM is one they can edit.
  // pm_user_ids in the response contains internal DB UUIDs, not Azure AD object_ids,
  // so we cannot reliably compare them in the frontend.
  const canEditProject = useCallback((_pmUserIds: string[]): boolean => {
    return isFinanceOrAdmin || isPM;
  }, [isFinanceOrAdmin, isPM]);

  // ── Data ──
  const [allPeriods, setAllPeriods] = useState<Period[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; pm_user_ids: string[] }>>([]);
  const [extLines, setExtLines] = useState<ExternalLine[]>([]);
  const [equipLines, setEquipLines] = useState<EquipmentLine[]>([]);
  const [loading, setLoading] = useState(true);

  // ── UI state ──
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());

  // ── Drag-to-fill ──
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragType, setDragType] = useState<'oop' | 'equip' | null>(null);
  const [dragStart, setDragStart] = useState<{ projectId: string; lineIdx: number; colIdx: number } | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);
  const [applyValue, setApplyValue] = useState('');
  const [applying, setApplying] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [hoveredLine, setHoveredLine] = useState<string | null>(null);
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null);

  // Refs for window event handlers (avoid stale closures)
  const isDraggingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // ── Rename dialog ──
  const [renamingLine, setRenamingLine] = useState<{ projectId: string; projectName: string; type: 'oop'|'equip'; description: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  // ── Local (unsaved) lines ──
  const [localLines, setLocalLines] = useState<Array<{ projectId: string; type: 'oop'|'equip'; description: string }>>([]);
  const [addLineState, setAddLineState] = useState<{ projectId: string; type: 'oop'|'equip'; desc: string } | null>(null);

  // ── Load ──
  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const [periodsData, projectsData, extData, equipData] = await Promise.all([
        periodsApi.list(),
        lookupsApi.listProjectsScoped(),
        projectCostsApi.listExternals(),
        projectCostsApi.listEquipment(),
      ]);
      periodsData.sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
      projectsData.sort((a, b) => a.name.localeCompare(b.name));
      setAllPeriods(periodsData);
      setProjects(projectsData as Array<{ id: string; name: string; pm_user_ids: string[] }>);
      setExtLines(extData);
      setEquipLines(equipData);
    } catch (err) {
      showApiError(err as Error, 'loading project costs');
    } finally {
      setLoading(false);
    }
  }, [showApiError]);

  useEffect(() => { load(); }, [load]);

  // Window mouseup: finalize drag or clear click-only selection
  useEffect(() => {
    const up = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        if (hasDraggedRef.current) {
          setPopoverPos({ x: e.clientX, y: e.clientY });
        } else {
          // Just a click, not a real drag — clear selection so inline edit works
          setSelectedCells(new Set());
        }
      }
      setIsDragging(false);
      isDraggingRef.current = false;
      hasDraggedRef.current = false;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []); // stable: only refs and stable state setters

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

  // ── Open periods only ──
  const openPeriods = useMemo(() => allPeriods.filter(p => p.status === 'open'), [allPeriods]);
  const openPeriodIds = useMemo(() => new Set(openPeriods.map(p => p.id)), [openPeriods]);

  // ── Build matrix groups ──
  const matrixGroups = useMemo<ProjectGroup[]>(() => {
    return projects.map(proj => {
      const oopDescMap = new Map<string, Map<string, Array<{ id: string; cost: number }>>>();
      for (const l of extLines) {
        if (l.project_id !== proj.id || !openPeriodIds.has(l.period_id)) continue;
        const desc = l.description ?? '—';
        if (!oopDescMap.has(desc)) oopDescMap.set(desc, new Map());
        const pm = oopDescMap.get(desc)!;
        const arr = pm.get(l.period_id) ?? [];
        arr.push({ id: l.id, cost: l.cost });
        pm.set(l.period_id, arr);
      }

      const equipDescMap = new Map<string, Map<string, Array<{ id: string; cost: number }>>>();
      for (const l of equipLines) {
        if (l.project_id !== proj.id || !openPeriodIds.has(l.period_id)) continue;
        const desc = l.description ?? '—';
        if (!equipDescMap.has(desc)) equipDescMap.set(desc, new Map());
        const pm = equipDescMap.get(desc)!;
        const arr = pm.get(l.period_id) ?? [];
        arr.push({ id: l.id, cost: l.cost });
        pm.set(l.period_id, arr);
      }

      const lines: MatrixLine[] = [];

      for (const [desc, periodMap] of oopDescMap) {
        const costsByPeriod = new Map<string, PeriodCell>();
        for (const [periodId, items] of periodMap) {
          costsByPeriod.set(periodId, { id: items[0].id, cost: items.reduce((s, i) => s + i.cost, 0), isMulti: items.length > 1 });
        }
        lines.push({ lineKey: `oop::${encodeURIComponent(desc)}`, description: desc, type: 'oop', isLocal: false, costsByPeriod });
      }

      for (const [desc, periodMap] of equipDescMap) {
        const costsByPeriod = new Map<string, PeriodCell>();
        for (const [periodId, items] of periodMap) {
          costsByPeriod.set(periodId, { id: items[0].id, cost: items.reduce((s, i) => s + i.cost, 0), isMulti: items.length > 1 });
        }
        lines.push({ lineKey: `equip::${encodeURIComponent(desc)}`, description: desc, type: 'equip', isLocal: false, costsByPeriod });
      }

      for (const local of localLines) {
        if (local.projectId !== proj.id) continue;
        const lk = `${local.type}::${encodeURIComponent(local.description)}`;
        if (!lines.find(l => l.lineKey === lk)) {
          lines.push({ lineKey: lk, description: local.description, type: local.type, isLocal: true, costsByPeriod: new Map() });
        }
      }

      lines.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'oop' ? -1 : 1;
        return a.description.localeCompare(b.description);
      });

      const totalsByPeriod = new Map<string, number>();
      for (const period of openPeriods) {
        totalsByPeriod.set(period.id, lines.reduce((s, l) => s + (l.costsByPeriod.get(period.id)?.cost ?? 0), 0));
      }

      return { projectId: proj.id, projectName: proj.name, pmUserIds: proj.pm_user_ids ?? [], lines, totalsByPeriod };
    });
  }, [projects, extLines, equipLines, localLines, openPeriods, openPeriodIds]);

  // ── Cross-project totals by type ──
  const totalsByType = useMemo(() => {
    const oopByPeriod = new Map<string, number>();
    const equipByPeriod = new Map<string, number>();
    for (const group of matrixGroups) {
      for (const line of group.lines) {
        const target = line.type === 'oop' ? oopByPeriod : equipByPeriod;
        for (const [periodId, cell] of line.costsByPeriod) {
          target.set(periodId, (target.get(periodId) ?? 0) + cell.cost);
        }
      }
    }
    return { oopByPeriod, equipByPeriod };
  }, [matrixGroups]);

  // ── Rename dialog handlers ──
  const openRenameDialog = useCallback((group: ProjectGroup, line: MatrixLine) => {
    setRenamingLine({ projectId: group.projectId, projectName: group.projectName, type: line.type, description: line.description });
    setRenameValue(line.description);
    setRenameError('');
  }, []);

  const closeRenameDialog = useCallback(() => {
    setRenamingLine(null);
    setRenameValue('');
    setRenameError('');
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingLine) return;
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenameError('Name is required.'); return; }
    setRenameSaving(true);
    setRenameError('');
    try {
      const group = matrixGroups.find(g => g.projectId === renamingLine.projectId);
      const line = group?.lines.find(l => l.type === renamingLine.type && l.description === renamingLine.description);
      if (line && !line.isLocal) {
        const promises: Promise<unknown>[] = [];
        for (const [, cell] of line.costsByPeriod) {
          if (!cell.isMulti) {
            promises.push(
              renamingLine.type === 'oop'
                ? projectCostsApi.updateExternal(cell.id, { description: trimmed })
                : projectCostsApi.updateEquipment(cell.id, { description: trimmed }),
            );
          }
        }
        await Promise.all(promises);
        await load(false);
      }
      closeRenameDialog();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Failed to rename line.');
    } finally {
      setRenameSaving(false);
    }
  }, [renamingLine, renameValue, matrixGroups, load, closeRenameDialog]);

  // ── Cell save ──
  const saveCostCell = useCallback(async (
    projectId: string,
    type: 'oop' | 'equip',
    description: string,
    periodId: string,
    existingId: string | null,
    isLocal: boolean,
    dkkValue: number,
  ) => {
    const cellKey = makeCellKey(projectId, type, description, periodId);
    setSavingCells(prev => new Set(prev).add(cellKey));
    const cents = Math.round(dkkValue * 100);
    try {
      if (type === 'oop') {
        if (cents > 0 && !existingId) {
          await projectCostsApi.createExternal({ project_id: projectId, period_id: periodId, description, cost: cents });
        } else if (cents > 0 && existingId) {
          await projectCostsApi.updateExternal(existingId, { cost: cents });
        } else if (cents === 0 && existingId) {
          await projectCostsApi.deleteExternal(existingId);
        }
      } else {
        if (cents > 0 && !existingId) {
          await projectCostsApi.createEquipment({ project_id: projectId, period_id: periodId, description, cost: cents });
        } else if (cents > 0 && existingId) {
          await projectCostsApi.updateEquipment(existingId, { cost: cents });
        } else if (cents === 0 && existingId) {
          await projectCostsApi.deleteEquipment(existingId);
        }
      }
      if (isLocal && cents > 0) {
        setLocalLines(prev => prev.filter(l => !(l.projectId === projectId && l.type === type && l.description === description)));
      }
      await load(false);
    } catch (err) {
      showApiError(err as Error, 'saving cost');
    } finally {
      setSavingCells(prev => { const s = new Set(prev); s.delete(cellKey); return s; });
      setEditingCell(null);
    }
  }, [load, showApiError]);

  // ── Delete entire line (all periods) ──
  const handleDeleteLine = useCallback(async (projectId: string, type: 'oop'|'equip', description: string, isLocal: boolean) => {
    if (isLocal) {
      setLocalLines(prev => prev.filter(l => !(l.projectId === projectId && l.type === type && l.description === description)));
      return;
    }
    const group = matrixGroups.find(g => g.projectId === projectId);
    const line = group?.lines.find(l => l.type === type && l.description === description);
    if (!line) return;
    try {
      const promises: Promise<void>[] = [];
      for (const [, cell] of line.costsByPeriod) {
        if (!cell.isMulti) {
          promises.push(type === 'oop' ? projectCostsApi.deleteExternal(cell.id) : projectCostsApi.deleteEquipment(cell.id));
        }
      }
      await Promise.all(promises);
      await load(false);
    } catch (err) {
      showApiError(err as Error, 'deleting line');
    }
  }, [matrixGroups, load, showApiError]);

  // ── Add line ──
  const handleAddLine = (projectId: string, type: 'oop'|'equip') => {
    setAddLineState({ projectId, type, desc: '' });
  };

  const confirmAddLine = () => {
    if (!addLineState || !addLineState.desc.trim()) return;
    const { projectId, type } = addLineState;
    const desc = addLineState.desc.trim();
    const lk = `${type}::${encodeURIComponent(desc)}`;
    const group = matrixGroups.find(g => g.projectId === projectId);
    if (!group?.lines.find(l => l.lineKey === lk)) {
      setLocalLines(prev => [...prev, { projectId, type, description: desc }]);
    }
    setAddLineState(null);
  };

  // ── Drag handlers ──
  const handleCellMouseDown = useCallback((
    e: React.MouseEvent,
    cellKey: string,
    type: 'oop'|'equip',
    projectId: string,
    lineIdx: number,
    colIdx: number,
  ) => {
    e.preventDefault();
    e.stopPropagation(); // prevent click-outside listener from firing on cell clicks
    setIsDragging(true);
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    setDragType(type);
    setDragStart({ projectId, lineIdx, colIdx });
    setSelectedCells(new Set([cellKey]));
    setPopoverPos(null);
    setApplyValue('');
    setEditError(null);
  }, []);

  const handleCellMouseEnter = useCallback((projectId: string, lineIdx: number, colIdx: number) => {
    if (!isDragging || !dragStart || !dragType) return;
    if (dragStart.projectId !== projectId) return; // restrict to same project

    const group = matrixGroups.find(g => g.projectId === projectId);
    if (!group) return;

    const minRow = Math.min(dragStart.lineIdx, lineIdx);
    const maxRow = Math.max(dragStart.lineIdx, lineIdx);
    const minCol = Math.min(dragStart.colIdx, colIdx);
    const maxCol = Math.max(dragStart.colIdx, colIdx);

    hasDraggedRef.current = true;
    const newSel = new Set<string>();
    group.lines.forEach((line, lIdx) => {
      if (line.type !== dragType) return;
      if (lIdx < minRow || lIdx > maxRow) return;
      openPeriods.forEach((period, pIdx) => {
        if (pIdx < minCol || pIdx > maxCol) return;
        if (line.costsByPeriod.get(period.id)?.isMulti) return;
        newSel.add(makeCellKey(projectId, line.type, line.description, period.id));
      });
    });
    setSelectedCells(newSel);
  }, [isDragging, dragStart, dragType, matrixGroups, openPeriods]);

  // ── Bulk apply ──
  const handleApplyValue = useCallback(async (dkkValue: number) => {
    if (selectedCells.size === 0) return;
    setApplying(true);
    setEditError(null);
    try {
      const promises: Promise<void>[] = [];
      for (const ck of selectedCells) {
        const { projectId, type, description, periodId } = parseCellKey(ck);
        const group = matrixGroups.find(g => g.projectId === projectId);
        if (!group) continue;
        const line = group.lines.find(l => l.type === type && l.description === description);
        if (!line) continue;
        const cell = line.costsByPeriod.get(periodId);
        if (cell?.isMulti) continue;
        const existingId = cell?.id ?? null;
        const cents = Math.round(dkkValue * 100);
        if (type === 'oop') {
          if (cents > 0 && !existingId) promises.push(projectCostsApi.createExternal({ project_id: projectId, period_id: periodId, description, cost: cents }).then(() => {}));
          else if (cents > 0 && existingId) promises.push(projectCostsApi.updateExternal(existingId, { cost: cents }).then(() => {}));
          else if (cents === 0 && existingId) promises.push(projectCostsApi.deleteExternal(existingId));
        } else {
          if (cents > 0 && !existingId) promises.push(projectCostsApi.createEquipment({ project_id: projectId, period_id: periodId, description, cost: cents }).then(() => {}));
          else if (cents > 0 && existingId) promises.push(projectCostsApi.updateEquipment(existingId, { cost: cents }).then(() => {}));
          else if (cents === 0 && existingId) promises.push(projectCostsApi.deleteEquipment(existingId));
        }
      }
      await Promise.all(promises);
      await load(false);
      setSelectedCells(new Set());
      setApplyValue('');
      setPopoverPos(null);
      setEditError(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to apply');
    } finally {
      setApplying(false);
    }
  }, [selectedCells, matrixGroups, load]);

  const handleApply = useCallback(async () => {
    const num = parseFloat(applyValue);
    if (isNaN(num) || num < 0) return;
    await handleApplyValue(num);
  }, [applyValue, handleApplyValue]);

  const handleClear = useCallback(async () => {
    await handleApplyValue(0);
  }, [handleApplyValue]);

  // ── Popover position with edge-flip ──
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

  const totalCols = 3 + openPeriods.length;

  if (loading) return <div className={styles.loading}><Spinner label="Loading project costs…" /></div>;

  return (
    <div className={styles.cardWrapper}>
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
            step={1}
            placeholder="DKK"
            value={applyValue}
            className={styles.cellInput}
            onChange={e => setApplyValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleApply();
              if (e.key === 'Escape') { setSelectedCells(new Set()); setPopoverPos(null); }
            }}
            style={{ width: '110px' }}
            autoFocus
          />
          <Button size="small" appearance="primary" onClick={handleApply} disabled={applying || !applyValue}>
            {applying ? <Spinner size="tiny" /> : 'Apply'}
          </Button>
          <Button size="small" appearance="subtle" onClick={handleClear} disabled={applying}>
            Clear
          </Button>
          {editError && (
            <span style={{ color: tokens.colorStatusDangerForeground1, fontSize: tokens.fontSizeBase200 }}>
              {editError}
            </span>
          )}
        </div>
      )}

      <div className={mergeClasses(styles.wrapper, isDragging && styles.matrixSelecting)}>
        <table className={styles.table} onMouseLeave={() => setHoveredMonth(null)}>
          <colgroup>
            <col style={{ width: PROJECT_COL_WIDTH }} />
            <col style={{ width: DESC_COL_WIDTH }} />
            <col style={{ width: TYPE_COL_WIDTH }} />
            {openPeriods.map(period => (
              <col key={period.id} style={{ width: PERIOD_COL_WIDTH }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className={mergeClasses(styles.th, styles.thProject)} style={{ textAlign: 'left' }}>Project</th>
              <th className={mergeClasses(styles.th, styles.thDesc)}    style={{ textAlign: 'left' }}>Name</th>
              <th className={mergeClasses(styles.th, styles.thType)}    style={{ textAlign: 'left' }}>Type</th>
              {openPeriods.map((p, idx) => {
                const isColHovered = hoveredMonth === idx;
                return (
                  <th
                    key={p.id}
                    className={styles.th}
                    style={{
                      width: PERIOD_COL_PX,
                      minWidth: PERIOD_COL_PX,
                      transition: 'background-color 0.1s ease',
                      ...(isColHovered ? { backgroundColor: 'rgba(30,58,95,0.06)' } : {}),
                    }}
                    onMouseEnter={() => setHoveredMonth(idx)}
                  >
                    <span style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: C.ink2, textTransform: 'none', letterSpacing: 0 }}>
                      {MONTH_SHORT[p.month - 1]}
                    </span>
                    <span style={{ display: 'block', fontSize: '9.5px', color: C.ink4, marginTop: '1px', letterSpacing: '0.05em', textTransform: 'none' }}>
                      {p.year}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {matrixGroups.map(group => {
              const isExpanded = expandedProjects.has(group.projectId);
              const canEditThisProject = canEditProject(group.pmUserIds);
              const lineCount = group.lines.length;

              return (
                <React.Fragment key={group.projectId}>
                  {/* ── Project summary row ── */}
                  <tr
                    className={styles.summaryRow}
                    onClick={() => setExpandedProjects(prev => {
                      const s = new Set(prev);
                      s.has(group.projectId) ? s.delete(group.projectId) : s.add(group.projectId);
                      return s;
                    })}
                  >
                    <td
                      className={styles.summaryFixedSpanned}
                      colSpan={3}
                      style={{ boxShadow: `inset 3px 0 0 ${C.equipAccent}`, paddingLeft: 14 }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {isExpanded ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
                        <span style={{ fontSize: '13.5px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                          {group.projectName}
                        </span>
                        {lineCount > 0 && (
                          <span style={{ fontSize: '11px', color: C.ink3, fontWeight: 400, flexShrink: 0, whiteSpace: 'nowrap' }}>
                            · {lineCount} line{lineCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </span>
                    </td>
                    {openPeriods.map((p, colIdx) => {
                      const total = group.totalsByPeriod.get(p.id) ?? 0;
                      const isColHovered = hoveredMonth === colIdx;
                      return (
                        <td
                          key={p.id}
                          className={styles.summaryValueCell}
                          style={{
                            transition: 'background-color 0.1s ease',
                            ...(isColHovered ? { backgroundColor: 'rgba(30,58,95,0.06)' } : {}),
                          }}
                          onMouseEnter={() => setHoveredMonth(colIdx)}
                        >
                          {total > 0 ? fmtDKK(total) : <span style={{ color: C.ink5, fontWeight: 400 }}>—</span>}
                        </td>
                      );
                    })}
                  </tr>

                  {/* ── Line item rows (expanded) ── */}
                  {isExpanded && group.lines.map((line, lineIdx) => {
                    const isDimmed = isDragging && dragType !== null && dragType !== line.type && dragStart?.projectId === group.projectId;
                    const isHovered = hoveredLine === line.lineKey;
                    const rowBg = isHovered
                      ? (line.type === 'oop' ? C.oopHover : C.equipHover)
                      : (line.type === 'oop' ? C.oopTint : C.equipTint);
                    const stickyBg = isHovered ? rowBg : 'white';
                    const leftBorder = line.type === 'oop' ? C.oopAccent : C.equipAccent;

                    return (
                      <tr
                        key={line.lineKey}
                        style={{ backgroundColor: rowBg }}
                        onMouseEnter={() => setHoveredLine(line.lineKey)}
                        onMouseLeave={() => setHoveredLine(null)}
                      >
                        <td
                          className={styles.descCell}
                          colSpan={2}
                          title={line.description}
                          style={{
                            left: 0,
                            minWidth: `${PROJECT_COL_WIDTH + DESC_COL_WIDTH}px`,
                            maxWidth: `${PROJECT_COL_WIDTH + DESC_COL_WIDTH}px`,
                            backgroundColor: stickyBg,
                            boxShadow: `inset 3px 0 0 ${leftBorder}`,
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {line.isLocal && (
                              <span style={{ fontSize: '10px', color: tokens.colorNeutralForeground4, fontStyle: 'italic' }}>new</span>
                            )}
                            {line.description}
                          </span>
                        </td>

                        <td
                          className={line.type === 'oop' ? styles.typeCellOop : styles.typeCellEquip}
                          style={{ backgroundColor: stickyBg }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                            <span className={line.type === 'oop' ? styles.badgeOop : styles.badgeEquip}>
                              {line.type === 'oop' ? 'OoP' : 'Equip'}
                            </span>
                            {canEditThisProject && !line.isLocal && (
                              <Button
                                size="small"
                                appearance="subtle"
                                icon={<EditRegular />}
                                className={styles.deleteBtn}
                                style={{ opacity: isHovered ? 1 : 0 }}
                                title="Edit line name"
                                onClick={() => openRenameDialog(group, line)}
                              />
                            )}
                            {canEditThisProject && (
                              <Button
                                size="small"
                                appearance="subtle"
                                icon={<DeleteRegular />}
                                className={styles.deleteBtn}
                                style={{ opacity: isHovered ? 1 : 0 }}
                                onClick={() => {
                                  if (window.confirm(`Delete "${line.description}"? This will remove all values across all periods.`)) {
                                    handleDeleteLine(group.projectId, line.type, line.description, line.isLocal);
                                  }
                                }}
                              />
                            )}
                          </span>
                        </td>

                        {openPeriods.map((period, colIdx) => {
                          const cell = line.costsByPeriod.get(period.id);
                          const cellKey = makeCellKey(group.projectId, line.type, line.description, period.id);
                          const isSelected = selectedCells.has(cellKey);
                          const canDrag = canEditThisProject && !cell?.isMulti;

                          return (
                            <td
                              key={period.id}
                              className={mergeClasses(
                                styles.valueCell,
                                canDrag && styles.cellEditable,
                                isSelected && styles.cellSelected,
                                isDimmed && styles.cellDimmed,
                              )}
                              style={hoveredMonth === colIdx ? { backgroundColor: 'rgba(30,58,95,0.06)', transition: 'background-color 0.1s ease' } : undefined}
                              onMouseDown={canDrag
                                ? e => handleCellMouseDown(e, cellKey, line.type, group.projectId, lineIdx, colIdx)
                                : undefined}
                              onMouseEnter={isDragging
                                ? () => handleCellMouseEnter(group.projectId, lineIdx, colIdx)
                                : () => setHoveredMonth(colIdx)}
                            >
                              <CostCellEditor
                                cell={cell}
                                isEditing={editingCell === cellKey}
                                isSaving={savingCells.has(cellKey)}
                                canEdit={canEditThisProject && !isDragging && !cell?.isMulti}
                                onStartEdit={() => setEditingCell(cellKey)}
                                onCancel={() => setEditingCell(null)}
                                onSave={val => saveCostCell(group.projectId, line.type, line.description, period.id, cell?.id ?? null, line.isLocal, val)}
                                styles={styles}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}

                  {/* ── Add line row — always visible when expanded and user can edit this project ── */}
                  {isExpanded && canEditThisProject && (
                    <tr className={styles.addLineRow}>
                      <td className={styles.addLineCell} colSpan={totalCols} style={{ position: 'sticky', left: 0 }}>
                        {addLineState?.projectId === group.projectId ? (
                          <div className={styles.addLineForm}>
                            <Button
                              size="small"
                              appearance={addLineState.type === 'oop' ? 'primary' : 'subtle'}
                              onClick={() => setAddLineState(s => s ? { ...s, type: 'oop' } : s)}
                            >OoP</Button>
                            <Button
                              size="small"
                              appearance={addLineState.type === 'equip' ? 'primary' : 'subtle'}
                              onClick={() => setAddLineState(s => s ? { ...s, type: 'equip' } : s)}
                            >Equipment</Button>
                            <Input
                              size="small"
                              placeholder="Name / description…"
                              value={addLineState.desc}
                              onChange={(_, d) => setAddLineState(s => s ? { ...s, desc: d.value } : s)}
                              onKeyDown={e => { if (e.key === 'Enter') confirmAddLine(); if (e.key === 'Escape') setAddLineState(null); }}
                              style={{ minWidth: 220 }}
                              autoFocus
                            />
                            <Button size="small" appearance="primary" onClick={confirmAddLine} disabled={!addLineState.desc.trim()}>
                              Add
                            </Button>
                            <Button size="small" appearance="subtle" onClick={() => setAddLineState(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <div className={styles.addLineForm}>
                            <Button size="small" appearance="subtle" icon={<Add24Regular />}
                              onClick={() => handleAddLine(group.projectId, 'oop')}>
                              Add OoP
                            </Button>
                            <Button size="small" appearance="subtle" icon={<Add24Regular />}
                              onClick={() => handleAddLine(group.projectId, 'equip')}>
                              Add Equipment
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}

            {/* ── Totals footer ── */}
            <tr className={styles.totalsOopRow}>
              <td
                className={styles.totalsCellLabel}
                colSpan={3}
                style={{ backgroundColor: C.oopHover, boxShadow: `inset 3px 0 0 ${C.oopAccent}`, color: C.oopAccent }}
              >
                Total OoP
              </td>
              {openPeriods.map((p, colIdx) => {
                const val = totalsByType.oopByPeriod.get(p.id) ?? 0;
                return (
                  <td
                    key={p.id}
                    className={styles.totalsCellValue}
                    style={hoveredMonth === colIdx ? { backgroundColor: 'rgba(30,58,95,0.06)', transition: 'background-color 0.1s ease' } : undefined}
                    onMouseEnter={() => setHoveredMonth(colIdx)}
                  >
                    {val > 0 ? fmtDKK(val) : <span style={{ color: C.ink5, fontWeight: 400 }}>—</span>}
                  </td>
                );
              })}
            </tr>
            <tr className={styles.totalsEquipRow}>
              <td
                className={styles.totalsCellLabel}
                colSpan={3}
                style={{ backgroundColor: C.equipHover, boxShadow: `inset 3px 0 0 ${C.equipAccent}`, color: C.equipAccent }}
              >
                Total Equipment
              </td>
              {openPeriods.map((p, colIdx) => {
                const val = totalsByType.equipByPeriod.get(p.id) ?? 0;
                return (
                  <td
                    key={p.id}
                    className={styles.totalsCellValue}
                    style={hoveredMonth === colIdx ? { backgroundColor: 'rgba(30,58,95,0.06)', transition: 'background-color 0.1s ease' } : undefined}
                    onMouseEnter={() => setHoveredMonth(colIdx)}
                  >
                    {val > 0 ? fmtDKK(val) : <span style={{ color: C.ink5, fontWeight: 400 }}>—</span>}
                  </td>
                );
              })}
            </tr>
            <tr className={styles.totalsGrandRow}>
              <td className={styles.grandTotalCellLabel} colSpan={3}>Grand Total</td>
              {openPeriods.map((p, colIdx) => {
                const total = (totalsByType.oopByPeriod.get(p.id) ?? 0) + (totalsByType.equipByPeriod.get(p.id) ?? 0);
                return (
                  <td
                    key={p.id}
                    className={styles.grandTotalCellValue}
                    style={hoveredMonth === colIdx ? { backgroundColor: 'rgba(30,58,95,0.08)', transition: 'background-color 0.1s ease' } : undefined}
                    onMouseEnter={() => setHoveredMonth(colIdx)}
                  >
                    {total > 0 ? fmtDKK(total) : <span style={{ color: C.ink5, fontWeight: 400 }}>—</span>}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Rename dialog ── */}
      <Dialog open={!!renamingLine} onOpenChange={(_, d) => { if (!d.open) closeRenameDialog(); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Edit line name</DialogTitle>
            <DialogContent>
              <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS }}>
                  <Label>Project</Label>
                  <span style={{ fontSize: tokens.fontSizeBase300, color: tokens.colorNeutralForeground2 }}>
                    {renamingLine?.projectName}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS }}>
                  <Label>Type</Label>
                  <span style={{ fontSize: tokens.fontSizeBase300, color: tokens.colorNeutralForeground2 }}>
                    {renamingLine?.type === 'oop' ? 'OoP' : 'Equipment'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS }}>
                  <Label required htmlFor="rename-input">Name</Label>
                  <Input
                    id="rename-input"
                    value={renameValue}
                    onChange={(_, d) => { setRenameValue(d.value); setRenameError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') closeRenameDialog(); }}
                    autoFocus
                    disabled={renameSaving}
                  />
                  {renameError && (
                    <span style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorStatusDangerForeground1 }}>
                      {renameError}
                    </span>
                  )}
                </div>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={closeRenameDialog} disabled={renameSaving}>Cancel</Button>
              <Button appearance="primary" onClick={handleRenameSubmit} disabled={renameSaving}>
                {renameSaving ? <Spinner size="tiny" /> : 'Save'}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
};
