import { useState, useMemo, useCallback } from 'react';
import {
  makeStyles,
  tokens,
  Body1,
  Input,
  Badge,
  MessageBar,
  MessageBarBody,
  Skeleton,
  SkeletonItem,
  Button,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Textarea,
} from '@fluentui/react-components';
import {
  SearchRegular,
  MoneyRegular,
  CheckmarkCircle24Regular,
  DismissCircle24Regular,
  ArrowForward24Regular,
} from '@fluentui/react-icons';
import { approvalsApi } from '../../api/approvals';
import { getInitials } from '../../utils/avatar';
import { EmptyState } from '../EmptyState';
import { useEmployeeStats } from '../../hooks/useEmployeeStats';
// ApprovalBadge available if needed for future use

// ─── Design palette ──────────────────────────────────────────────────────────

const C = {
  bg:         '#faf9f7',
  surface:    '#ffffff',
  surface2:   '#f6f5f2',
  ink:        '#1b1b1a',
  ink2:       '#424242',
  ink3:       '#707070',
  line:       '#e5e4e0',
  accent:     '#1e3a5f',
  good:       '#2a6f4d',
  goodSoft:   '#e3efe7',
  warn:       '#9a5b00',
  warnSoft:   '#fbe8cf',
  bad:        '#a32f2a',
  badSoft:    '#f6dad7',
  pending:    '#5b4892',
  pendingSoft:'#e7e1f3',
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FinanceActualRow {
  actual_id: string;
  employee_name: string;
  employee_email: string;
  employee_initials?: string | null;
  project_id: string;
  project_name: string;
  cost_center_id: string;
  cost_center_name: string;
  year: number;
  month: number;
  fte_percent: number;
  approval_status: string;
  current_approval_step?: string;
  current_approver_name?: string;
  approval_instance_id?: string;
  current_step_id?: string;
  current_approver_object_id?: string;
  can_action?: boolean;
  can_proxy_approve_step1?: boolean;
  step1_id?: string | null;
  is_delegated?: boolean;
  delegated_for?: string | null;
}

interface LookupProject { id: string; name: string; }
interface LookupCostCenter { id: string; name: string; }

export interface ActualsTabProps {
  actualsData: FinanceActualRow[];
  actualsLoading: boolean;
  actualsError: string | null;
  projects: LookupProject[];
  costCenters: LookupCostCenter[];
  actualsProjectId: string;
  actualsApprovalStatus?: string;
  year: number;
  month: number;
  canSeeStats: boolean;
  onActualsReload?: () => void;
}

type SortBy = 'attention' | 'name' | 'gap';
type EmpSortKey = 'name' | 'demand' | 'actuals' | 'status';

interface EmployeeGroup {
  employee_name: string;
  employee_email: string;
  employee_initials?: string | null;
  cost_center_id: string;
  cost_center_name: string;
  rows: FinanceActualRow[];
  isMissingOnly?: boolean; // true = employee has demand but no actual lines
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  // KPI row
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '12px',
    marginBottom: '16px',
  },
  kpiCard: {
    background: C.surface,
    border: `1px solid ${C.line}`,
    borderRadius: '10px',
    padding: '14px 16px',
    cursor: 'default',
    transition: 'box-shadow 0.15s',
    ':hover': { boxShadow: '0 2px 8px rgba(0,0,0,0.08)' },
  },
  kpiCardClickable: {
    cursor: 'pointer',
  },
  kpiCardActive: {
    outline: `2px solid ${C.accent}`,
    outlineOffset: '2px',
  },
  kpiCardBad: {
    background: C.badSoft,
    border: `1px solid ${C.bad}33`,
  },
  kpiCardWarn: {
    background: C.warnSoft,
    border: `1px solid ${C.warn}33`,
  },
  kpiLabel: {
    fontSize: '11px',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: C.ink3,
    marginBottom: '4px',
  },
  kpiValue: {
    fontSize: '26px',
    fontWeight: '700',
    lineHeight: '1.1',
    fontVariantNumeric: 'tabular-nums',
    color: C.ink,
  },
  kpiSubtitle: {
    fontSize: '11px',
    color: C.ink3,
    marginTop: '4px',
  },
  progressBar: {
    height: '3px',
    background: C.line,
    borderRadius: '2px',
    marginTop: '6px',
    overflow: 'hidden',
  },
  // Toolbar
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
    flexWrap: 'wrap',
  },
  sortSegment: {
    display: 'flex',
    border: `1px solid ${C.line}`,
    borderRadius: '8px',
    overflow: 'hidden',
  },
  sortBtn: {
    padding: '5px 12px',
    fontSize: '12px',
    fontWeight: '500',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: C.ink3,
    borderRight: `1px solid ${C.line}`,
    ':last-child': { borderRight: 'none' },
  },
  sortBtnActive: {
    background: C.accent,
    color: '#ffffff !important',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: C.ink2,
    cursor: 'pointer',
    userSelect: 'none',
    padding: '0 4px',
    whiteSpace: 'nowrap',
  },
  // Table
  tableWrapper: {
    background: C.surface,
    border: `1px solid ${C.line}`,
    borderRadius: '10px',
    overflow: 'hidden',
    marginBottom: '16px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  thead: {
    background: C.surface2,
    position: 'sticky',
    top: '0',
    zIndex: '1',
  },
  th: {
    padding: '10px 12px',
    textAlign: 'left',
    fontSize: '11px',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    color: C.ink3,
    borderBottom: `1px solid ${C.line}`,
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '10px 12px',
    borderBottom: `1px solid ${C.line}`,
    verticalAlign: 'middle',
  },
  // Row states via inline border-left on the <tr>
  tableFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    borderTop: `1px solid ${C.line}`,
    background: C.surface2,
    fontSize: '11px',
    color: C.ink3,
  },
  legend: {
    display: 'flex',
    gap: '14px',
    alignItems: 'center',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
  },
  // Employee avatar
  avatar: {
    width: '40px',
    height: '40px',
    minWidth: '40px',
    borderRadius: '50%',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: '700',
    flexShrink: 0,
    userSelect: 'none',
  },
  // Sub-table for expanded rows
  subTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '12px',
    background: C.bg,
  },
  subTh: {
    padding: '6px 12px',
    textAlign: 'left',
    fontSize: '10px',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    color: C.ink3,
    borderBottom: `1px solid ${C.line}`,
  },
  subTd: {
    padding: '7px 12px',
    borderBottom: `1px solid ${C.line}`,
    verticalAlign: 'middle',
  },
  // Employee card section (bottom)
  chartCard: {
    marginTop: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow4,
  },
  empCard: {
    background: 'white',
    border: '0.5px solid #e5e7eb',
    borderRadius: '8px',
    padding: '16px 20px',
    marginBottom: '8px',
    cursor: 'pointer',
    ':hover': { backgroundColor: '#f9fafb' },
  },
  empCardSortBar: {
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
  },
  empCardSortBtn: {
    fontSize: '12px',
    padding: '2px 8px',
    borderRadius: '12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: 'transparent',
    cursor: 'pointer',
    color: tokens.colorNeutralForeground2,
    ':hover': { background: tokens.colorNeutralBackground1Hover },
  },
  empCardSortBtnActive: {
    background: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    borderTopColor: tokens.colorBrandStroke1,
    borderRightColor: tokens.colorBrandStroke1,
    borderBottomColor: tokens.colorBrandStroke1,
    borderLeftColor: tokens.colorBrandStroke1,
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nameColor(name: string): string {
  const palette = ['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#0891b2','#4f46e5','#9333ea'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

function getOverallStatus(rows: FinanceActualRow[]): string {
  const statuses = rows.map(r => (r.approval_status ?? '').toUpperCase());
  if (statuses.some(s => s === 'REJECTED')) return 'REJECTED';
  if (statuses.length > 0 && statuses.every(s => s === 'APPROVED')) return 'APPROVED';
  if (statuses.some(s => s === 'APPROVED') && statuses.some(s => s === 'PENDING')) return 'PARTIAL';
  if (statuses.some(s => s === 'PENDING')) return 'PENDING';
  return 'PENDING';
}

function getAttentionOrder(status: string, hasDemand: boolean, actuals: number, demand: number): number {
  if (hasDemand && actuals === 0) return 0; // Missing
  if (status === 'REJECTED') return 1;
  if (status === 'PENDING') return 2;
  if (actuals < demand) return 3; // Partial
  return 4; // Approved / OK
}

// ─── Status badge — dot style ────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const dot = (color: string) => (
    <span style={{ width:7, height:7, borderRadius:'50%', background:color, display:'inline-block', flexShrink:0 }} />
  );
  const wrap = (color: string, dotColor: string, label: string, bg?: string) => (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:11, fontWeight:600, color, background: bg ?? 'transparent', border: bg ? 'none' : `1px solid ${color}33`, padding:'2px 7px', borderRadius:4 }}>
      {dot(dotColor)}{label}
    </span>
  );
  if (s === 'APPROVED')  return wrap(C.good,    C.good,    'Approved',  C.goodSoft);
  if (s === 'REJECTED')  return wrap(C.bad,     C.bad,     'Rejected',  C.badSoft);
  if (s === 'PENDING')   return wrap(C.pending, C.pending, 'Pending',   C.pendingSoft);
  if (s === 'MISSING')   return wrap(C.ink3,    C.ink3,    'Missing');
  return wrap(C.warn, C.warn, 'Partial', C.warnSoft);
}

// ─── Actual vs Demand bar ─────────────────────────────────────────────────────

function ActualDemandBar({ actual, demand }: { actual: number; demand: number }) {
  // Demand = 100% of track width; actual fills proportionally (capped at 100% visually).
  const actualW = demand > 0 ? Math.min(100, (actual / demand) * 100) : 0;

  const fillColor = actual === 0 || demand === 0 ? C.ink3
    : actual >= demand        ? C.good   // on/over plan → green
    : actual >= demand * 0.75 ? C.warn   // within 25% short → amber
    : C.bad;                             // significantly short → red

  // Left: "{actual}% of {demand}%"  Right: absolute actual value
  const label = demand > 0 ? `${actual}% of ${demand}%` : `${actual}%`;

  return (
    <div style={{ minWidth: 140 }}>
      {/* Text row: left = "actual% of demand%", right = absolute actual */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:5, fontSize:11, fontVariantNumeric:'tabular-nums' }}>
        <span style={{ color: C.ink3 }}>{label}</span>
        {demand > 0 && (
          <span style={{ fontWeight:700, fontSize:11, color: actual > 0 ? fillColor : C.ink3 }}>{actual}%</span>
        )}
      </div>
      {/* Bar: grey track = demand at 100% width; colored fill = actual/demand */}
      <div style={{ height:10, background:'#d6d4cf', borderRadius:5, overflow:'hidden', position:'relative' }}>
        {actualW > 0 && (
          <div style={{
            position:'absolute', left:0, top:0, bottom:0,
            width:`${actualW}%`,
            background: fillColor,
            borderRadius:5,
            opacity: 0.85,
            transition:'width 0.3s',
          }} />
        )}
      </div>
      {/* Legend hints */}
      <div style={{ display:'flex', gap:8, marginTop:3, fontSize:10, color: C.ink3 }}>
        {demand > 0 && <span style={{ display:'flex', alignItems:'center', gap:3 }}><span style={{ width:8, height:8, borderRadius:2, background:'#d6d4cf', display:'inline-block' }} />demand</span>}
        {actual > 0 && <span style={{ display:'flex', alignItems:'center', gap:3 }}><span style={{ width:8, height:8, borderRadius:2, background:fillColor, opacity:0.85, display:'inline-block' }} />actual</span>}
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ActualsTab({
  actualsData,
  actualsLoading,
  actualsError,
  actualsProjectId,
  year,
  month,
  canSeeStats,
  onActualsReload,
}: ActualsTabProps) {
  const styles = useStyles();

  // ── Approval action state (preserved exactly) ──────────────────────────────
  const [approvalDialogRow, setApprovalDialogRow] = useState<FinanceActualRow | null>(null);
  const [approvalAction, setApprovalAction] = useState<'approve' | 'reject' | null>(null);
  const [approvalComment, setApprovalComment] = useState('');
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [localStatusOverrides, setLocalStatusOverrides] = useState<Map<string, string>>(new Map());

  // ── Proxy approve step 1 state (preserved exactly) ─────────────────────────
  const [proxyStep1Row, setProxyStep1Row] = useState<FinanceActualRow | null>(null);
  const [proxyStep1Comment, setProxyStep1Comment] = useState('');
  const [proxyStep1Submitting, setProxyStep1Submitting] = useState(false);
  const [proxyStep1Error, setProxyStep1Error] = useState<string | null>(null);

  // ── Employee card expand state (preserved for bottom section) ──────────────
  const [expandedEmployees, setExpandedEmployees] = useState<Set<string>>(new Set());
  const toggleEmployee = useCallback((resourceId: string) => {
    setExpandedEmployees(prev => {
      const next = new Set(prev);
      next.has(resourceId) ? next.delete(resourceId) : next.add(resourceId);
      return next;
    });
  }, []);

  // ── Employee sort state (preserved for bottom section) ─────────────────────
  const [empSort, setEmpSort] = useState<EmpSortKey>('status');
  const [empSortDir, setEmpSortDir] = useState<'asc' | 'desc'>('asc');

  // ── New toolbar / table state ──────────────────────────────────────────────
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortBy>('attention');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  // ── Approval handlers (preserved exactly) ──────────────────────────────────
  const handleProxyStep1Submit = async () => {
    if (!proxyStep1Row?.approval_instance_id || !proxyStep1Row?.step1_id) return;
    if (!proxyStep1Comment.trim()) { setProxyStep1Error('A reason is required.'); return; }
    setProxyStep1Submitting(true);
    setProxyStep1Error(null);
    try {
      await approvalsApi.proxyApproveStep1ByStep2(
        proxyStep1Row.approval_instance_id,
        proxyStep1Row.step1_id,
        proxyStep1Comment.trim(),
      );
      setProxyStep1Row(null);
      setProxyStep1Comment('');
      onActualsReload?.();
    } catch (err: unknown) {
      setProxyStep1Error(err instanceof Error ? err.message : 'Action failed. Please try again.');
    } finally {
      setProxyStep1Submitting(false);
    }
  };

  const openApprovalDialog = (row: FinanceActualRow, action: 'approve' | 'reject') => {
    setApprovalDialogRow(row);
    setApprovalAction(action);
    setApprovalComment('');
    setApprovalError(null);
  };

  const closeApprovalDialog = () => {
    setApprovalDialogRow(null);
    setApprovalAction(null);
    setApprovalComment('');
    setApprovalError(null);
  };

  const handleApprovalSubmit = async () => {
    if (!approvalDialogRow || !approvalAction) return;
    if (!approvalDialogRow.approval_instance_id || !approvalDialogRow.current_step_id) return;
    if (approvalAction === 'reject' && !approvalComment.trim()) {
      setApprovalError('A comment is required when rejecting.');
      return;
    }
    setApprovalSubmitting(true);
    setApprovalError(null);
    try {
      if (approvalAction === 'approve') {
        await approvalsApi.approveStep(
          approvalDialogRow.approval_instance_id,
          approvalDialogRow.current_step_id,
          approvalComment.trim() || undefined,
        );
      } else {
        await approvalsApi.rejectStep(
          approvalDialogRow.approval_instance_id,
          approvalDialogRow.current_step_id,
          approvalComment.trim(),
        );
      }
      const newStatus = approvalAction === 'approve' ? 'APPROVED' : 'REJECTED';
      setLocalStatusOverrides(prev => { const next = new Map(prev); next.set(approvalDialogRow.actual_id, newStatus); return next; });
      closeApprovalDialog();
      onActualsReload?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Action failed. Please try again.';
      setApprovalError(msg);
    } finally {
      setApprovalSubmitting(false);
    }
  };

  // ── Employee stats (preserved for bottom section + demand bar data) ─────────
  const { data: empStats, loading: empStatsLoading, error: empStatsError } = useEmployeeStats(
    year,
    month,
    undefined,
    actualsProjectId || undefined,
    year > 0 && month > 0,
  );

  const empStatsByName = useMemo(() => {
    const map = new Map<string, NonNullable<typeof empStats>[0]>();
    for (const s of empStats ?? []) map.set(s.employee_name, s);
    return map;
  }, [empStats]);

  // ── Derived filter options — prefer lookup lists so filters are always populated
  //    even when no actuals exist for the selected period yet.
  // ── Filtered actuals ───────────────────────────────────────────────────────
  const filteredActuals = useMemo(() => {
    let out = actualsData;
    if (selectedStatuses.size > 0) out = out.filter(d => selectedStatuses.has((d.approval_status ?? '').toUpperCase()));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      out = out.filter(d =>
        d.employee_name.toLowerCase().includes(q) ||
        d.employee_email.toLowerCase().includes(q) ||
        d.project_name.toLowerCase().includes(q) ||
        d.cost_center_name.toLowerCase().includes(q) ||
        (d.employee_initials != null && d.employee_initials.toLowerCase().includes(q)),
      );
    }
    return out;
  }, [actualsData, selectedStatuses, searchQuery]);

  // ── Group by employee (employees with actuals) ────────────────────────────
  const groupedEmployees = useMemo((): EmployeeGroup[] => {
    const map = new Map<string, EmployeeGroup>();
    for (const row of filteredActuals) {
      const existing = map.get(row.employee_name);
      if (existing) {
        existing.rows.push(row);
      } else {
        map.set(row.employee_name, {
          employee_name: row.employee_name,
          employee_email: row.employee_email,
          employee_initials: row.employee_initials,
          cost_center_id: row.cost_center_id,
          cost_center_name: row.cost_center_name,
          rows: [row],
        });
      }
    }
    return Array.from(map.values());
  }, [filteredActuals]);

  // ── Missing employees: have demand but zero actuals (from empStats only) ──
  const missingGroups = useMemo((): EmployeeGroup[] => {
    if (!empStats) return [];
    if (selectedStatuses.size > 0 && !selectedStatuses.has('MISSING')) return [];
    // Use unfiltered actualsData so employees who submitted (e.g. PENDING) are
    // never shown as Missing even when the MISSING status filter is active.
    const nameSet = new Set(actualsData.map(d => d.employee_name));
    const q = searchQuery.trim().toLowerCase();
    return empStats
      .filter(s => s.demand_fte > 0 && s.actuals_fte === 0 && !nameSet.has(s.employee_name))
      .filter(s => !q || s.employee_name.toLowerCase().includes(q) || s.projects.some(p => p.project_name.toLowerCase().includes(q)) || (s.cost_center_name ?? '').toLowerCase().includes(q) || (s.employee_initials ?? '').toLowerCase().includes(q))
      .map(s => ({
        employee_name: s.employee_name,
        employee_email: '',
        cost_center_id: s.cost_center_id ?? '',
        cost_center_name: s.cost_center_name ?? '',
        employee_initials: s.employee_initials,
        rows: [],
        isMissingOnly: true,
      }));
  }, [empStats, actualsData, selectedStatuses, searchQuery]);

  const sortedGroups = useMemo(() => {
    const combined = [...groupedEmployees, ...missingGroups];
    return combined.sort((a, b) => {
      const aS = empStatsByName.get(a.employee_name);
      const bS = empStatsByName.get(b.employee_name);
      if (sortBy === 'name') return a.employee_name.localeCompare(b.employee_name);
      if (sortBy === 'gap') {
        const aGap = (aS?.actuals_fte ?? 0) - (aS?.demand_fte ?? 0);
        const bGap = (bS?.actuals_fte ?? 0) - (bS?.demand_fte ?? 0);
        return aGap - bGap;
      }
      // attention sort: missing rows come first (order 0)
      const aStatus = a.isMissingOnly ? 'MISSING' : getOverallStatus(a.rows);
      const bStatus = b.isMissingOnly ? 'MISSING' : getOverallStatus(b.rows);
      const aOrder = getAttentionOrder(aStatus, (aS?.demand_fte ?? 0) > 0, aS?.actuals_fte ?? 0, aS?.demand_fte ?? 0);
      const bOrder = getAttentionOrder(bStatus, (bS?.demand_fte ?? 0) > 0, bS?.actuals_fte ?? 0, bS?.demand_fte ?? 0);
      return aOrder - bOrder;
    });
  }, [groupedEmployees, missingGroups, sortBy, empStatsByName]);

  // ── KPI values ─────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const totalWithDemand = empStats?.filter(s => s.demand_fte > 0).length ?? 0;
    const submitted = empStats?.filter(s => s.demand_fte > 0 && s.actuals_fte > 0).length ?? 0;
    // An employee is "missing" only if they have ZERO actuals submissions at all.
    // Use nameSet from actualsData (any submission = not missing) and deduplicate by name
    // in case empStats has multiple rows per employee (one per demand line/project).
    const submittedNames = new Set(actualsData.map(d => d.employee_name));
    const missingCount = empStats
      ? new Set(
          empStats
            .filter(s => s.demand_fte > 0 && s.actuals_fte === 0 && !submittedNames.has(s.employee_name))
            .map(s => s.employee_name),
        ).size
      : 0;
    const pendingLines = actualsData.filter(d => (d.approval_status ?? '').toUpperCase() === 'PENDING');
    const rejectedLines = actualsData.filter(d => (d.approval_status ?? '').toUpperCase() === 'REJECTED');
    const approvedLines = actualsData.filter(d => (d.approval_status ?? '').toUpperCase() === 'APPROVED');
    const pendingPeople = new Set(pendingLines.map(d => d.employee_name)).size;
    const submittedPct = totalWithDemand > 0 ? Math.round((submitted / totalWithDemand) * 100) : 0;
    return { totalWithDemand, submitted, submittedPct, missingCount, pendingLines: pendingLines.length, pendingPeople, rejectedLines: rejectedLines.length, approvedLines: approvedLines.length };
  }, [actualsData, empStats]);

  // ── Employee sort helpers (preserved for bottom section) ───────────────────
  const getEmpStatusOrder = (demand: number, actuals: number): number => {
    if (demand === 0) return 3;
    if (actuals >= demand) return 2;
    if (actuals > 0) return 1;
    return 0;
  };

  const handleEmpSort = (key: EmpSortKey) => {
    if (empSort === key) setEmpSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setEmpSort(key); setEmpSortDir('asc'); }
  };

  const empSortIndicator = (key: EmpSortKey) =>
    empSort === key ? (empSortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕';

  const sortedEmpStats = useMemo(() => {
    if (!empStats) return [];
    return [...empStats].sort((a, b) => {
      let cmp = 0;
      if (empSort === 'name') cmp = a.employee_name.localeCompare(b.employee_name);
      else if (empSort === 'demand') cmp = a.demand_fte - b.demand_fte;
      else if (empSort === 'actuals') cmp = a.actuals_fte - b.actuals_fte;
      else cmp = getEmpStatusOrder(a.demand_fte, a.actuals_fte) - getEmpStatusOrder(b.demand_fte, b.actuals_fte);
      return empSortDir === 'asc' ? cmp : -cmp;
    });
  }, [empStats, empSort, empSortDir]);

  // ── Toggle helpers ──────────────────────────────────────────────────────────
  const toggleRow = (key: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const getRowBorderColor = (status: string): string => {
    const s = status.toUpperCase();
    if (s === 'REJECTED') return C.bad;
    if (s === 'PENDING') return C.pending;
    if (s === 'MISSING') return C.ink3;
    return 'transparent';
  };

  const getRowBg = (status: string, hovered: boolean): string => {
    const s = status.toUpperCase();
    if (hovered) return '#f5f4f0';
    if (s === 'REJECTED') return '#fff8f7';
    if (s === 'PENDING') return '#fefcff';
    return C.surface;
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {actualsError && (
        <MessageBar intent="error" style={{ marginBottom: 12 }}>
          <MessageBarBody>{actualsError}</MessageBarBody>
        </MessageBar>
      )}

      {/* ── KPI Row ─────────────────────────────────────────────────────── */}
      <div className={styles.kpiRow}>
        {/* 1. Submission progress */}
        <div
          className={`${styles.kpiCard} ${selectedStatuses.size > 0 ? styles.kpiCardClickable : ''}`}
          onClick={() => setSelectedStatuses(new Set())}
          style={selectedStatuses.size > 0 ? { cursor: 'pointer' } : undefined}
        >
          <div className={styles.kpiLabel}>Submission progress</div>
          <div className={styles.kpiValue} style={{ fontSize: 22 }}>
            {kpi.submittedPct}%
            <span style={{ fontSize: 13, fontWeight: 400, color: C.ink3, marginLeft: 6 }}>
              {kpi.submitted} / {kpi.totalWithDemand}
            </span>
          </div>
          <div className={styles.progressBar}>
            <div style={{ height: '100%', width: `${kpi.submittedPct}%`, background: C.good, borderRadius: 2, transition: 'width 0.4s' }} />
          </div>
          <div className={styles.kpiSubtitle}>{kpi.totalWithDemand - kpi.submitted} employees still owe submissions</div>
        </div>

        {/* 2. Missing */}
        <div
          className={`${styles.kpiCard} ${styles.kpiCardClickable} ${styles.kpiCardBad}`}
          onClick={() => setSelectedStatuses(prev => { const n = new Set(prev); n.has('MISSING') ? n.delete('MISSING') : (n.clear(), n.add('MISSING')); return n; })}
          style={selectedStatuses.has('MISSING') ? { borderBottom: `2px solid ${C.accent}` } : undefined}
        >
          <div className={styles.kpiLabel} style={{ color: C.bad }}>Missing</div>
          <div className={styles.kpiValue} style={{ color: C.bad }}>{kpi.missingCount}</div>
          <div className={styles.kpiSubtitle} style={{ color: C.bad }}>overdue submissions · click to filter</div>
        </div>

        {/* 3. Pending */}
        <div
          className={`${styles.kpiCard} ${styles.kpiCardClickable} ${styles.kpiCardWarn}`}
          onClick={() => setSelectedStatuses(prev => prev.has('PENDING') ? new Set() : new Set(['PENDING']))}
          style={selectedStatuses.has('PENDING') ? { borderBottom: `2px solid ${C.accent}` } : undefined}
        >
          <div className={styles.kpiLabel} style={{ color: C.warn }}>Pending approval</div>
          <div className={styles.kpiValue} style={{ color: C.warn }}>{kpi.pendingLines}</div>
          <div className={styles.kpiSubtitle} style={{ color: C.warn }}>across {kpi.pendingPeople} people</div>
        </div>

        {/* 4. Rejected */}
        <div
          className={`${styles.kpiCard} ${styles.kpiCardClickable}`}
          onClick={() => setSelectedStatuses(prev => prev.has('REJECTED') ? new Set() : new Set(['REJECTED']))}
          style={selectedStatuses.has('REJECTED') ? { borderBottom: `2px solid ${C.accent}` } : undefined}
        >
          <div className={styles.kpiLabel}>Rejected</div>
          <div className={styles.kpiValue} style={{ color: C.bad }}>{kpi.rejectedLines}</div>
          <div className={styles.kpiSubtitle}>returned for rework</div>
        </div>

        {/* 5. Approved */}
        <div
          className={`${styles.kpiCard} ${styles.kpiCardClickable}`}
          onClick={() => setSelectedStatuses(prev => prev.has('APPROVED') ? new Set() : new Set(['APPROVED']))}
          style={selectedStatuses.has('APPROVED') ? { borderBottom: `2px solid ${C.accent}` } : undefined}
        >
          <div className={styles.kpiLabel}>Approved</div>
          <div className={styles.kpiValue} style={{ color: C.good }}>{kpi.approvedLines}</div>
          <div className={styles.kpiSubtitle}>finalized entries</div>
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className={styles.toolbar}>
        {/* Search */}
        <Input
          contentBefore={<SearchRegular />}
          placeholder="Search employee, project, cost center..."
          value={searchQuery}
          onChange={(_, d) => setSearchQuery(d.value)}
          style={{ minWidth: 260 }}
          size="small"
        />
        {selectedStatuses.size > 0 && (
          <button
            onClick={() => setSelectedStatuses(new Set())}
            style={{ background: 'none', border: 'none', padding: '0 4px', fontSize: 12, color: C.accent, cursor: 'pointer', textDecoration: 'underline', whiteSpace: 'nowrap' }}
          >
            Clear filter
          </button>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Sort segmented control */}
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:C.ink3 }}>
          <span>Sort:</span>
          <div className={styles.sortSegment}>
            {(['attention','name','gap'] as SortBy[]).map(s => (
              <button
                key={s}
                className={`${styles.sortBtn} ${sortBy === s ? styles.sortBtnActive : ''}`}
                onClick={() => setSortBy(s)}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Unified Table ────────────────────────────────────────────────── */}
      {actualsLoading ? (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {[1,2,3,4].map(i => <Skeleton key={i} style={{ height: 54 }}><SkeletonItem /></Skeleton>)}
        </div>
      ) : sortedGroups.length === 0 ? (
        <EmptyState
          icon={<MoneyRegular style={{ fontSize: 48 }} />}
          title="No actuals data"
          message="No actuals found for this period. Adjust the filters or select a different period."
        />
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th} style={{ width: 32 }} />
                <th className={styles.th}>Employee</th>
                <th className={styles.th}>Project · Cost Center</th>
                <th className={styles.th} style={{ minWidth: 160 }}>Actual vs Demand</th>
                <th className={styles.th} style={{ width: 70 }}>Gap</th>
                <th className={styles.th} style={{ width: 110 }}>Status</th>
                <th className={styles.th}>Approver · Step</th>
                <th className={styles.th} style={{ width: 130 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedGroups.map(group => {
                const stat = empStatsByName.get(group.employee_name);
                const actual = group.isMissingOnly ? 0 : group.rows.reduce((s, r) => s + r.fte_percent, 0);
                const demand = stat?.demand_fte ?? 0;
                const gap = actual - demand;
                const overallStatus = group.isMissingOnly ? 'MISSING' : getOverallStatus(
                  group.rows.map(r => ({ ...r, approval_status: localStatusOverrides.get(r.actual_id) ?? r.approval_status }))
                );
                const isExpanded = expandedRows.has(group.employee_name);
                const isHovered = hoveredRow === group.employee_name;
                const firstProject = group.rows[0] ?? null;
                // For missing-only employees, derive project name from empStats
                const firstProjectName = firstProject?.project_name
                  ?? stat?.projects?.[0]?.project_name
                  ?? '—';
                const borderColor = getRowBorderColor(overallStatus);
                const rowBg = getRowBg(overallStatus, isHovered);

                return [
                  <tr
                    key={group.employee_name}
                    style={{ borderLeft: `3px solid ${borderColor}`, background: rowBg, cursor:'pointer' }}
                    onMouseEnter={() => setHoveredRow(group.employee_name)}
                    onMouseLeave={() => setHoveredRow(null)}
                    onClick={e => {
                      if ((e.target as HTMLElement).closest('button')) return;
                      toggleRow(group.employee_name);
                    }}
                  >
                    {/* Chevron */}
                    <td className={styles.td} style={{ padding:'10px 8px 10px 10px', color: C.ink3 }}>
                      <span style={{ display:'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition:'transform 0.15s', fontSize:11, lineHeight:1 }}>▶</span>
                    </td>

                    {/* Employee */}
                    <td className={styles.td}>
                      <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                        <div className={styles.avatar} style={{ background: nameColor(group.employee_name) }}>
                          {getInitials(group.employee_name, group.employee_initials)}
                        </div>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontWeight:600, fontSize:13, color:C.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                            {group.employee_name}
                          </div>
                          <div style={{ fontSize:11, color:C.ink3 }}>{group.employee_email}</div>
                        </div>
                      </div>
                      {group.rows.some(r => r.is_delegated && r.delegated_for) && (
                        <div style={{ marginTop:3 }}>
                          <Badge appearance="filled" color="warning" size="small">
                            Delegate for {group.rows.find(r => r.delegated_for)?.delegated_for}
                          </Badge>
                        </div>
                      )}
                    </td>

                    {/* Project · CC */}
                    <td className={styles.td}>
                      <div style={{ fontWeight:600, fontSize:13, color:C.ink }}>{firstProjectName}</div>
                      <div style={{ fontSize:11, color:C.ink3, marginTop:2, display:'flex', alignItems:'center', gap:5 }}>
                        {group.cost_center_name || (stat?.projects?.length ? 'Demand only' : '—')}
                        {!group.isMissingOnly && group.rows.length > 1 && (
                          <span style={{ background:C.surface2, border:`1px solid ${C.line}`, borderRadius:10, padding:'0 6px', fontSize:10, color:C.ink3 }}>
                            +{group.rows.length - 1} more
                          </span>
                        )}
                        {group.isMissingOnly && (stat?.projects?.length ?? 0) > 1 && (
                          <span style={{ background:C.surface2, border:`1px solid ${C.line}`, borderRadius:10, padding:'0 6px', fontSize:10, color:C.ink3 }}>
                            +{(stat?.projects?.length ?? 1) - 1} more
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Actual vs Demand bar */}
                    <td className={styles.td}>
                      <ActualDemandBar actual={actual} demand={demand} />
                    </td>

                    {/* Gap */}
                    <td className={styles.td}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:3, fontVariantNumeric:'tabular-nums', fontSize:13, fontWeight:700, color: gap > 0 ? C.good : gap < 0 ? C.bad : C.ink3 }}>
                        {gap > 0 ? '▲' : gap < 0 ? '▼' : null}
                        {gap > 0 ? `+${gap}%` : gap < 0 ? `${gap}%` : '0%'}
                      </span>
                    </td>

                    {/* Status */}
                    <td className={styles.td}>
                      <StatusBadge status={overallStatus} />
                    </td>

                    {/* Approver · Step */}
                    <td className={styles.td}>
                      {(() => {
                        const approverRow = group.rows.find(r => r.current_approver_name || r.current_approval_step);
                        if (approverRow) {
                          return (
                            <div>
                              <div style={{ fontSize:12, color:C.ink2 }}>{approverRow.current_approver_name || '—'}</div>
                              {approverRow.current_approval_step && (
                                <span style={{ background:C.pendingSoft, color:C.pending, fontSize:10, fontWeight:600, padding:'1px 6px', borderRadius:10, marginTop:2, display:'inline-block' }}>
                                  {approverRow.current_approval_step}
                                </span>
                              )}
                            </div>
                          );
                        }
                        if (overallStatus === 'APPROVED') {
                          return <span style={{ color:C.good, fontSize:11, fontWeight:600 }}>Approved</span>;
                        }
                        if (overallStatus === 'MISSING') {
                          return <span style={{ color:C.ink3, fontSize:11 }}>—</span>;
                        }
                        return <span style={{ color:C.ink3, fontSize:11 }}>— not yet routed</span>;
                      })()}
                    </td>

                    {/* Actions — expand row to action individual lines */}
                    <td className={styles.td}>
                      <span style={{ fontSize:11, color:C.ink3, opacity: isHovered ? 1 : 0, transition:'opacity 0.15s', whiteSpace:'nowrap' }}>
                        ▶ expand to action
                      </span>
                    </td>
                  </tr>,

                  /* Expanded row */
                  isExpanded && (
                    <tr key={`${group.employee_name}-expanded`} style={{ background: '#f3f2f1' }}>
                      <td colSpan={8} style={{ padding:0, borderLeft: `3px solid ${borderColor}`, borderBottom: `1px solid ${C.line}` }}>

                        {/* Meta strip */}
                        <div style={{ background: '#f3f2f1', borderBottom: `1px solid ${C.line}`, padding:'7px 16px 7px 52px', display:'flex', gap:28, fontSize:11, color:C.ink3, flexWrap:'wrap' }}>
                          <span>PERIOD <strong style={{ color:C.ink, marginLeft:4 }}>{group.rows[0] ? `${group.rows[0].year}-${String(group.rows[0].month).padStart(2,'0')}` : (year > 0 ? `${year}-${String(month).padStart(2,'0')}` : '—')}</strong></span>
                          <span>COST CENTER <strong style={{ color:C.ink, marginLeft:4 }}>{group.cost_center_name}</strong></span>
                          <span>SUPPLY <strong style={{ color:C.ink, marginLeft:4 }}>{stat?.supply_fte != null ? `${stat.supply_fte}%` : '—'}</strong></span>
                          <span>DEMAND <strong style={{ color:C.ink, marginLeft:4 }}>{demand > 0 ? `${demand}%` : '—'}</strong></span>
                          <span>ACTUAL <strong style={{ color:C.ink, marginLeft:4 }}>{actual > 0 ? `${actual}%` : '0%'}</strong></span>
                          <span>GAP <strong style={{ color: gap < 0 ? C.bad : gap > 0 ? C.good : C.ink3, marginLeft:4 }}>{gap >= 0 ? `+${gap}%` : `${gap}%`}</strong></span>
                        </div>

                        {/* Sub-header */}
                        <div style={{ padding:'8px 16px 4px 52px', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.6px', color:C.ink3 }}>
                          Project Breakdown · {group.isMissingOnly ? (stat?.projects?.length ?? 0) : group.rows.length} {(group.isMissingOnly ? (stat?.projects?.length ?? 0) : group.rows.length) === 1 ? 'line' : 'lines'}
                        </div>

                        {/* Sub-table — for missing-only employees use empStats.projects; otherwise use actual rows */}
                        {(() => {
                          // Build rows: missing employees use demand project breakdown; others use actual rows
                          type SubRow = {
                            key: string;
                            projectName: string;
                            costCenterName: string;
                            rowDemand: number;
                            rowSupply: number | null;
                            rowActual: number;
                            row?: FinanceActualRow;
                          };
                          const subRows: SubRow[] = group.isMissingOnly
                            ? (stat?.projects ?? []).map(p => ({
                                key: p.project_id,
                                projectName: p.project_name,
                                costCenterName: '',
                                rowDemand: p.demand_fte,
                                rowSupply: p.supply_fte != null ? p.supply_fte : null,
                                rowActual: 0,
                              }))
                            : group.rows.map(row => {
                                const projStat = stat?.projects?.find(p => p.project_id === row.project_id);
                                return {
                                  key: row.actual_id,
                                  projectName: row.project_name,
                                  costCenterName: row.cost_center_name,
                                  rowDemand: projStat?.demand_fte ?? 0,
                                  rowSupply: projStat?.supply_fte != null ? projStat.supply_fte : null,
                                  rowActual: row.fte_percent,
                                  row,
                                };
                              });

                          return (
                            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                              <thead>
                                <tr style={{ background: C.surface2 }}>
                                  <th style={{ padding:'5px 12px 5px 52px', textAlign:'left', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.4px', color:C.ink3, borderBottom:`1px solid ${C.line}`, width:'26%' }}>Project</th>
                                  <th style={{ padding:'5px 12px', textAlign:'left', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.4px', color:C.ink3, borderBottom:`1px solid ${C.line}`, width:'22%' }}>Allocation</th>
                                  <th style={{ padding:'5px 12px', textAlign:'right', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.4px', color:C.ink3, borderBottom:`1px solid ${C.line}`, width:'10%' }}>Demand</th>
                                  <th style={{ padding:'5px 12px', textAlign:'right', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.4px', color:C.ink3, borderBottom:`1px solid ${C.line}`, width:'10%' }}>Supply</th>
                                  <th style={{ padding:'5px 12px', textAlign:'right', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.4px', color:C.ink3, borderBottom:`1px solid ${C.line}`, width:'10%' }}>Actual</th>
                                  <th style={{ padding:'5px 12px', textAlign:'right', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.4px', color:C.ink3, borderBottom:`1px solid ${C.line}`, width:'10%' }}>Gap</th>
                                  <th style={{ padding:'5px 12px', textAlign:'left', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.4px', color:C.ink3, borderBottom:`1px solid ${C.line}` }}>Status</th>
                                  <th style={{ padding:'5px 12px', textAlign:'left', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.4px', color:C.ink3, borderBottom:`1px solid ${C.line}` }} />
                                </tr>
                              </thead>
                              <tbody>
                                {subRows.map(sr => {
                                  const rowGap = sr.rowActual - sr.rowDemand;
                                  const maxAlloc = Math.max(sr.rowDemand, sr.rowActual, 100);
                                  const allocBarW = maxAlloc > 0 ? Math.min(100, (sr.rowDemand / maxAlloc) * 100) : 0;
                                  const effectiveRowStatus = sr.row ? (localStatusOverrides.get(sr.row.actual_id) ?? sr.row.approval_status) : null;
                                  const rowCanAction = sr.row && effectiveRowStatus?.toUpperCase() === 'PENDING' && sr.row.approval_instance_id && sr.row.current_step_id && sr.row.can_action;

                                  return (
                                    <tr key={sr.key} style={{ background: C.surface, borderBottom: `1px solid ${C.line}` }}>
                                      <td style={{ padding:'10px 12px 10px 52px', verticalAlign:'middle' }}>
                                        <div style={{ fontWeight:600, color:C.ink }}>{sr.projectName}</div>
                                      </td>
                                      <td style={{ padding:'10px 12px', verticalAlign:'middle' }}>
                                        <div style={{ flex:1, height:5, background:C.line, borderRadius:3, minWidth:80 }}>
                                          <div style={{ width:`${allocBarW}%`, height:5, background:C.ink3, borderRadius:3 }} />
                                        </div>
                                      </td>
                                      <td style={{ padding:'10px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', color:C.ink3, verticalAlign:'middle' }}>
                                        {sr.rowDemand > 0 ? `${sr.rowDemand}%` : '—'}
                                      </td>
                                      <td style={{ padding:'10px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', color:C.ink3, verticalAlign:'middle' }}>
                                        {sr.rowSupply != null && sr.rowSupply > 0 ? `${sr.rowSupply}%` : '—'}
                                      </td>
                                      <td style={{ padding:'10px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:600, color:C.ink, verticalAlign:'middle' }}>
                                        {sr.rowActual > 0 ? `${sr.rowActual}%` : '—'}
                                      </td>
                                      <td style={{ padding:'10px 12px', textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:700, color: sr.rowDemand > 0 ? (rowGap >= 0 ? C.good : C.bad) : C.ink3, verticalAlign:'middle' }}>
                                        {sr.rowDemand > 0 ? (rowGap >= 0 ? `+${rowGap}%` : `${rowGap}%`) : '—'}
                                      </td>
                                      <td style={{ padding:'10px 12px', verticalAlign:'middle' }}>
                                        <StatusBadge status={sr.row ? (localStatusOverrides.get(sr.row.actual_id) ?? sr.row.approval_status) : 'MISSING'} />
                                      </td>
                                      <td style={{ padding:'10px 12px', verticalAlign:'middle' }}>
                                        {sr.row && (
                                          <div style={{ display:'flex', gap:4 }}>
                                            {rowCanAction && (
                                              <>
                                                <Button appearance="subtle" size="small" icon={<CheckmarkCircle24Regular />} title="Approve" style={{ color:C.good }} onClick={e => { e.stopPropagation(); openApprovalDialog(sr.row!, 'approve'); }} />
                                                <Button appearance="subtle" size="small" icon={<DismissCircle24Regular />} title="Reject" style={{ color:C.bad }} onClick={e => { e.stopPropagation(); openApprovalDialog(sr.row!, 'reject'); }} />
                                              </>
                                            )}
                                            {sr.row.can_proxy_approve_step1 && sr.row.approval_instance_id && sr.row.step1_id && (
                                              <Button appearance="subtle" size="small" icon={<ArrowForward24Regular />} title="Proxy approve step 1" onClick={e => { e.stopPropagation(); setProxyStep1Row(sr.row!); setProxyStep1Comment(''); setProxyStep1Error(null); }} />
                                            )}
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          );
                        })()}

                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>

          {/* Table footer */}
          <div className={styles.tableFooter}>
            <div className={styles.legend}>
              <div className={styles.legendItem}>
                <div style={{ width:10, height:8, background:C.line, borderRadius:2 }} />
                <span>Demand track</span>
              </div>
              <div className={styles.legendItem}>
                <div style={{ width:10, height:8, background:C.good, borderRadius:2 }} />
                <span>On / over plan</span>
              </div>
              <div className={styles.legendItem}>
                <div style={{ width:10, height:8, background:C.warn, borderRadius:2 }} />
                <span>Under plan</span>
              </div>
              <div className={styles.legendItem}>
                <div style={{ width:10, height:8, background:C.bad, borderRadius:2 }} />
                <span>Significantly over</span>
              </div>
              <div className={styles.legendItem}>
                <div style={{ width:2, height:10, background:C.ink2, borderRadius:1 }} />
                <span>Demand target</span>
              </div>
            </div>
            <span>Showing {sortedGroups.length} of {kpi.totalWithDemand} employees</span>
          </div>
        </div>
      )}

      {/* ── Approval dialog (preserved exactly) ──────────────────────────── */}
      <Dialog open={!!approvalDialogRow} onOpenChange={(_, d) => { if (!d.open) closeApprovalDialog(); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {approvalAction === 'approve' ? 'Approve Actuals' : 'Reject Actuals'}
            </DialogTitle>
            <DialogContent>
              {approvalDialogRow && (
                <Body1 style={{ display: 'block', marginBottom: tokens.spacingVerticalM }}>
                  {approvalAction === 'approve'
                    ? `Approve actuals for ${approvalDialogRow.employee_name} on ${approvalDialogRow.project_name}?`
                    : `Reject actuals for ${approvalDialogRow.employee_name} on ${approvalDialogRow.project_name}?`}
                </Body1>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS }}>
                <label style={{ fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase300 }}>
                  {approvalAction === 'reject' ? 'Reason (required)' : 'Comment (optional)'}
                </label>
                <Textarea
                  value={approvalComment}
                  onChange={(_, d) => setApprovalComment(d.value)}
                  placeholder={approvalAction === 'reject' ? 'Explain why these actuals are being rejected...' : 'Add a comment...'}
                  rows={3}
                />
              </div>
              {approvalError && (
                <MessageBar intent="error" style={{ marginTop: tokens.spacingVerticalS }}>
                  <MessageBarBody>{approvalError}</MessageBarBody>
                </MessageBar>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={closeApprovalDialog} disabled={approvalSubmitting}>Cancel</Button>
              <Button
                appearance="primary"
                onClick={handleApprovalSubmit}
                disabled={approvalSubmitting || (approvalAction === 'reject' && !approvalComment.trim())}
                style={approvalAction === 'reject' ? { backgroundColor: tokens.colorPaletteRedBackground3 } : undefined}
              >
                {approvalSubmitting ? 'Saving...' : approvalAction === 'approve' ? 'Approve' : 'Reject'}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* ── Proxy Approve Step 1 dialog (preserved exactly) ───────────────── */}
      <Dialog open={!!proxyStep1Row} onOpenChange={(_, d) => { if (!d.open) { setProxyStep1Row(null); setProxyStep1Comment(''); setProxyStep1Error(null); } }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Proxy Approve Step 1</DialogTitle>
            <DialogContent>
              {proxyStep1Row && (
                <Body1 style={{ display: 'block', marginBottom: tokens.spacingVerticalM }}>
                  Proxy-approve the manager review step for <strong>{proxyStep1Row.employee_name}</strong> on <strong>{proxyStep1Row.project_name}</strong> on behalf of the direct manager.
                </Body1>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS }}>
                <label style={{ fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase300 }}>Reason (required)</label>
                <Textarea
                  value={proxyStep1Comment}
                  onChange={(_, d) => setProxyStep1Comment(d.value)}
                  placeholder="Explain why you are proxy-approving step 1..."
                  rows={3}
                />
              </div>
              {proxyStep1Error && (
                <MessageBar intent="error" style={{ marginTop: tokens.spacingVerticalS }}>
                  <MessageBarBody>{proxyStep1Error}</MessageBarBody>
                </MessageBar>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => { setProxyStep1Row(null); setProxyStep1Comment(''); setProxyStep1Error(null); }} disabled={proxyStep1Submitting}>Cancel</Button>
              <Button
                appearance="primary"
                onClick={handleProxyStep1Submit}
                disabled={proxyStep1Submitting || !proxyStep1Comment.trim()}
              >
                {proxyStep1Submitting ? 'Saving...' : 'Proxy Approve'}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Bottom employee card section removed */}
      {false && canSeeStats && year > 0 && month > 0 && (
        <div className={styles.chartCard} style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <Body1><strong>Actuals vs Demand by Employee</strong></Body1>
            <div className={styles.empCardSortBar}>
              <span style={{ fontSize: '11px', color: '#9ca3af', marginRight: 4 }}>Sort:</span>
              {([
                { key: 'status' as EmpSortKey, label: 'Status' },
                { key: 'name' as EmpSortKey, label: 'Name' },
                { key: 'demand' as EmpSortKey, label: 'Demand' },
                { key: 'actuals' as EmpSortKey, label: 'Actuals' },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  className={`${styles.empCardSortBtn} ${empSort === key ? styles.empCardSortBtnActive : ''}`}
                  onClick={() => handleEmpSort(key)}
                >
                  {label}{empSortIndicator(key)}
                </button>
              ))}
            </div>
          </div>

          {empStatsLoading ? (
            <Body1 style={{ display: 'block', padding: tokens.spacingVerticalL, color: tokens.colorNeutralForeground3 }}>Loading...</Body1>
          ) : empStatsError ? (
            <MessageBar intent="error"><MessageBarBody>{empStatsError}</MessageBarBody></MessageBar>
          ) : sortedEmpStats.length === 0 ? (
            <Body1 style={{ display: 'block', padding: tokens.spacingVerticalL, color: tokens.colorNeutralForeground3 }}>No demand data found for this period.</Body1>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '11px', color: '#6b7280' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, background: '#16a34a', borderRadius: 2, opacity: 0.4 }} />Supply
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, background: '#3b82f6', borderRadius: 2, opacity: 0.5 }} />Demand
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, background: '#1e3a5f', borderRadius: 2 }} />Actuals
                </span>
              </div>

              {sortedEmpStats.map(row => {
                const supply = row.supply_fte;
                const demand = row.demand_fte;
                const actuals = row.actuals_fte;
                const maxVal = Math.max(supply, demand, actuals, 100);
                const isExpanded = expandedEmployees.has(row.resource_id);
                const meta = (() => {
                  for (const r of actualsData) if (r.employee_name === row.employee_name) return { email: r.employee_email, cost_center_name: r.cost_center_name };
                  return null;
                })();
                const statusOrder = getEmpStatusOrder(demand, actuals);

                return (
                  <div
                    key={row.resource_id}
                    className={styles.empCard}
                    onClick={() => toggleEmployee(row.resource_id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && toggleEmployee(row.resource_id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', flexWrap: 'wrap' }}>
                      <div style={{ width:40, height:40, minWidth:40, borderRadius:'50%', background:nameColor(row.employee_name), color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'13px', fontWeight:600, flexShrink:0, userSelect:'none' }}>
                        {getInitials(row.employee_name, row.employee_initials)}
                      </div>
                      <div style={{ flex:'1 1 120px', minWidth:0 }}>
                        <div style={{ fontSize:'14px', fontWeight:600, lineHeight:'1.2' }}>{row.employee_name}</div>
                        {(meta?.email || meta?.cost_center_name) && (
                          <div style={{ fontSize:'12px', color:'#6b7280', marginTop:'1px' }}>
                            {meta?.email}
                            {meta?.email && meta?.cost_center_name && <span style={{ margin:'0 4px' }}>·</span>}
                            {meta?.cost_center_name}
                          </div>
                        )}
                      </div>
                      <div style={{ display:'flex', gap:'6px', flexShrink:0, flexWrap:'wrap' }}>
                        <span style={{ background:'#dcfce7', color:'#166534', fontSize:'12px', padding:'2px 8px', borderRadius:'12px', whiteSpace:'nowrap' }}>Supply: {supply}%</span>
                        <span style={{ background:'#dbeafe', color:'#1e40af', fontSize:'12px', padding:'2px 8px', borderRadius:'12px', whiteSpace:'nowrap' }}>Demand: {demand}%</span>
                        <span style={{ background:'#e0e7ff', color:'#3730a3', fontSize:'12px', padding:'2px 8px', borderRadius:'12px', whiteSpace:'nowrap' }}>Actuals: {actuals}%</span>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px', flexShrink:0 }}>
                        {statusOrder === 2 && <Badge appearance="filled" color="success" size="small">On Track</Badge>}
                        {statusOrder === 1 && <Badge appearance="filled" color="warning" size="small">Partial</Badge>}
                        {statusOrder === 0 && <Badge appearance="filled" color="danger" size="small">Missing</Badge>}
                        {statusOrder === 3 && <Badge appearance="outline" size="small">No Demand</Badge>}
                        <span style={{ fontSize:'11px', color:'#9ca3af', userSelect:'none' }}>{isExpanded ? '▼' : '▶'}</span>
                      </div>
                    </div>

                    <div style={{ position:'relative', height:'8px', background:'#f3f4f6', borderRadius:'4px' }}>
                      <div style={{ position:'absolute', left:0, top:0, height:'8px', width:`${Math.min(100, maxVal > 0 ? (supply/maxVal)*100 : 0)}%`, background:'#16a34a', borderRadius:'4px', opacity:0.4 }} />
                      <div style={{ position:'absolute', left:0, top:0, height:'8px', width:`${Math.min(100, maxVal > 0 ? (demand/maxVal)*100 : 0)}%`, background:'#3b82f6', borderRadius:'4px', opacity:0.5 }} />
                      <div style={{ position:'absolute', left:0, top:0, height:'8px', width:`${Math.min(100, maxVal > 0 ? (actuals/maxVal)*100 : 0)}%`, background:'#1e3a5f', borderRadius:'4px' }} />
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop:'12px', paddingTop:'12px', borderTop:'1px solid #f3f4f6' }} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize:'11px', textTransform:'uppercase', color:'#9ca3af', letterSpacing:'0.5px', marginBottom:'8px' }}>Project breakdown</div>
                        {row.projects.length === 0 ? (
                          <div style={{ fontSize:'13px', color:'#9ca3af', fontStyle:'italic', padding:'4px 0' }}>No project breakdown available.</div>
                        ) : (
                          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'13px' }}>
                            <thead>
                              <tr>
                                <th style={{ padding:'6px 10px', textAlign:'left', fontWeight:600, color:'#6b7280', fontSize:'11px', textTransform:'uppercase', letterSpacing:'0.3px', borderBottom:'1px solid #f3f4f6' }}>Project</th>
                                <th style={{ padding:'6px 10px', textAlign:'right', fontWeight:600, color:'#6b7280', fontSize:'11px', textTransform:'uppercase', letterSpacing:'0.3px', borderBottom:'1px solid #f3f4f6' }}>Demand</th>
                                <th style={{ padding:'6px 10px', textAlign:'right', fontWeight:600, color:'#6b7280', fontSize:'11px', textTransform:'uppercase', letterSpacing:'0.3px', borderBottom:'1px solid #f3f4f6' }}>Actuals</th>
                                <th style={{ padding:'6px 10px', textAlign:'right', fontWeight:600, color:'#6b7280', fontSize:'11px', textTransform:'uppercase', letterSpacing:'0.3px', borderBottom:'1px solid #f3f4f6' }}>Gap</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.projects.map((proj, pi) => {
                                const gap2 = proj.actuals_fte - proj.demand_fte;
                                return (
                                  <tr key={proj.project_id} style={{ background: pi % 2 === 0 ? 'white' : '#f9fafb' }}>
                                    <td style={{ padding:'8px 10px' }}>{proj.project_name}</td>
                                    <td style={{ padding:'8px 10px', textAlign:'right' }}>
                                      <span style={{ display:'inline-flex', alignItems:'center', gap:'4px' }}>
                                        <span style={{ width:6, height:6, borderRadius:'50%', background:'#3b82f6', display:'inline-block', flexShrink:0 }} />{proj.demand_fte}%
                                      </span>
                                    </td>
                                    <td style={{ padding:'8px 10px', textAlign:'right' }}>
                                      {proj.actuals_fte > 0 ? (
                                        <span style={{ display:'inline-flex', alignItems:'center', gap:'4px' }}>
                                          <span style={{ width:6, height:6, borderRadius:'50%', background:'#1e3a5f', display:'inline-block', flexShrink:0 }} />{proj.actuals_fte}%
                                        </span>
                                      ) : <span style={{ color:'#9ca3af' }}>—</span>}
                                    </td>
                                    <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:600, color: gap2 >= 0 ? '#16a34a' : '#dc2626' }}>
                                      {gap2 >= 0 ? `+${gap2}%` : `${gap2}%`}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                        <div style={{ marginTop:'8px', fontSize:'12px', color:'#9ca3af', fontStyle:'italic' }}>
                          Total supply allocated: {supply}% FTE
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </>
  );
}
