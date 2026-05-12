import { useState, useEffect } from 'react';
import {
  tokens,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogContent,
  Button,
  Spinner,
  Select,
  type DialogOpenChangeData,
  type DialogOpenChangeEvent,
} from '@fluentui/react-components';
import {
  Dismiss24Regular,
  Delete24Regular,
  AddRegular,
  CheckmarkRegular,
  DismissRegular,
} from '@fluentui/react-icons';
import type { ResourceDetail } from '../../api/consolidation';
import { consolidationApi } from '../../api/consolidation';
import { planningApi, type DemandLine, type SupplyLine } from '../../api/planning';
import { lookupsApi, type Project } from '../../api/lookups';
import { useToast } from '../../hooks/useToast';
import { usePeriod } from '../../contexts/PeriodContext';

// ── Color system (matches OverviewTab) ────────────────────────────────────────

const C = {
  accent:   '#1e3a5f',
  good:     '#2a6f4d', goodSoft:  '#e3efe7',
  warn:     '#9a5b00', warnSoft:  '#fbe8cf',
  bad:      '#a32f2a', badSoft:   '#f6dad7',
  over:     '#1e5fa0', overSoft:  '#dbeaf6',
  ink:      '#1b1b1a',
  ink2:     '#424242',
  ink3:     '#707070',
  line:     '#e5e4e0',
  surface:  '#ffffff',
  surface2: '#f6f5f2',
};

type Severity = 'bad' | 'warn' | 'good' | 'over' | 'neutral';

const SEV: Record<Severity, { bar: string; bg: string; text: string }> = {
  bad:     { bar: C.bad,   bg: C.badSoft,  text: C.bad   },
  warn:    { bar: C.warn,  bg: C.warnSoft, text: C.warn  },
  good:    { bar: C.good,  bg: C.goodSoft, text: C.good  },
  over:    { bar: C.over,  bg: C.overSoft, text: C.over  },
  neutral: { bar: '#aaa',  bg: C.surface2, text: C.ink3  },
};

function gapSev(gap: number): Severity {
  if (gap < -20) return 'bad';
  if (gap < 0)   return 'warn';
  if (gap > 15)  return 'over';
  return 'good';
}

function getInitials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

function fmtGap(gap: number): string {
  return `${gap > 0 ? '+' : ''}${gap}%`;
}

// ── Balance bar ───────────────────────────────────────────────────────────────

function BalanceBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 110) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
      <div style={{ width: 60, fontSize: 11, color: C.ink3, textAlign: 'right', flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, position: 'relative', height: 8, borderRadius: 4, backgroundColor: '#ebe9e4', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0,
          width: `${Math.min(pct, 100)}%`, height: '100%',
          borderRadius: 4, backgroundColor: color,
        }} />
      </div>
      <div style={{ width: 44, fontSize: 12, fontFamily: 'monospace', color: C.ink2, textAlign: 'right', flexShrink: 0, fontWeight: 600 }}>
        {value}%
      </div>
    </div>
  );
}

// ── Mini allocation bar inside table rows ────────────────────────────────────

function MiniPctBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ position: 'relative', height: 4, borderRadius: 2, backgroundColor: '#ebe9e4', width: 72, flexShrink: 0 }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 2, backgroundColor: color }} />
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({
  title, count, totalPct, canAdd, adding, saving, onAdd, color,
}: {
  title: string; count: number; totalPct: number;
  canAdd: boolean; adding: boolean; saving: boolean;
  onAdd: () => void; color: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 16px',
      borderBottom: `1px solid ${C.line}`,
      backgroundColor: C.surface2,
    }}>
      <div style={{ width: 3, height: 16, borderRadius: 2, backgroundColor: color, flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: C.ink, flex: 1 }}>{title}</span>
      <span style={{ fontSize: 12, color: C.ink3 }}>
        {count} line{count !== 1 ? 's' : ''}
      </span>
      <span style={{
        fontSize: 12, fontFamily: 'monospace', fontWeight: 600,
        padding: '1px 8px', borderRadius: 10,
        backgroundColor: `${color}18`, color,
      }}>
        {totalPct}%
      </span>
      {canAdd && (
        <Button
          size="small"
          appearance="subtle"
          icon={<AddRegular />}
          onClick={onAdd}
          disabled={adding || saving}
          style={{ fontSize: 11, color: C.accent }}
        >
          Add
        </Button>
      )}
    </div>
  );
}

// ── Assignment row ────────────────────────────────────────────────────────────

function AssignmentRow({
  projectName,
  ftePct,
  barColor,
  canEdit,
  saving,
  editing,
  onDelete,
  onFteChange,
}: {
  projectName: string | null;
  ftePct: number;
  barColor: string;
  canEdit: boolean;
  saving: boolean;
  editing: boolean;
  onDelete: () => void;
  onFteChange?: (newPct: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [localFte, setLocalFte] = useState(ftePct);
  const [fteFocused, setFteFocused] = useState(false);

  useEffect(() => {
    if (!fteFocused) setLocalFte(ftePct);
  }, [ftePct, fteFocused]);

  const commitFte = () => {
    setFteFocused(false);
    if (localFte !== ftePct && onFteChange) {
      onFteChange(localFte);
    }
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 16px',
        borderBottom: `1px solid ${C.line}`,
        backgroundColor: hovered ? C.surface2 : C.surface,
        transition: 'background 0.1s',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {projectName ?? <em style={{ color: C.ink3 }}>General availability</em>}
        </div>
      </div>

      {/* FTE value — inline input when editable */}
      {canEdit && onFteChange ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <input
            type="number"
            min={5} max={100} step={5}
            value={localFte}
            onChange={e => setLocalFte(Math.min(100, Math.max(5, parseInt(e.target.value) || 5)))}
            onFocus={() => setFteFocused(true)}
            onBlur={commitFte}
            onKeyDown={e => {
              if (e.key === 'Enter') { commitFte(); (e.target as HTMLInputElement).blur(); }
              if (e.key === 'Escape') { setLocalFte(ftePct); setFteFocused(false); (e.target as HTMLInputElement).blur(); }
            }}
            disabled={saving}
            style={{
              width: 50, padding: '2px 4px', borderRadius: 4,
              border: `1px solid ${fteFocused ? C.accent : C.line}`,
              fontSize: 12, fontFamily: 'monospace', fontWeight: 600,
              color: C.ink2, textAlign: 'right',
              background: fteFocused ? '#fff' : 'transparent',
              outline: 'none',
            }}
          />
          <span style={{ fontSize: 12, color: C.ink3, flexShrink: 0 }}>%</span>
        </div>
      ) : (
        <div style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 600, color: C.ink2, width: 42, textAlign: 'right', flexShrink: 0 }}>
          {ftePct}%
        </div>
      )}

      <MiniPctBar pct={ftePct} color={barColor} />

      {canEdit && (
        <div style={{ display: 'flex', gap: 2, opacity: hovered ? 1 : 0, transition: 'opacity 0.1s', flexShrink: 0 }}>
          <Button
            size="small"
            appearance="subtle"
            icon={<Delete24Regular />}
            onClick={onDelete}
            disabled={saving || editing}
            title="Remove"
            style={{ color: C.bad }}
          />
        </div>
      )}
    </div>
  );
}

// ── Edit row (inline add form) ─────────────────────────────────────────────────

function EditRow({
  projects, projectId, ftePct, saving, supplyMode,
  onProjectChange, onFteChange, onSave, onCancel,
}: {
  projects: Project[];
  projectId: string;
  ftePct: number;
  saving: boolean;
  supplyMode?: boolean;
  onProjectChange: (v: string) => void;
  onFteChange: (v: number) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
      borderBottom: `1px solid ${C.line}`, backgroundColor: '#f0f4fa',
    }}>
      <div style={{ flex: 1 }}>
        <Select
          value={projectId}
          onChange={e => onProjectChange(e.target.value)}
          style={{ width: '100%', fontSize: 13 }}
          size="small"
        >
          <option value="">{supplyMode ? '— General availability —' : '— Select project —'}</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <input
        type="number"
        min={5} max={100} step={5}
        value={ftePct}
        onChange={e => onFteChange(Math.min(100, Math.max(5, parseInt(e.target.value) || 5)))}
        style={{
          width: 60, padding: '4px 6px', borderRadius: 4,
          border: `1px solid ${C.line}`, fontSize: 12,
          fontFamily: 'monospace', color: C.ink2,
        }}
      />
      <Button size="small" appearance="primary" icon={<CheckmarkRegular />} onClick={onSave} disabled={saving || (!supplyMode && !projectId)} />
      <Button size="small" appearance="subtle" icon={<DismissRegular />} onClick={onCancel} disabled={saving} />
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ResourceDetailModalProps {
  open: boolean;
  resourceId: string | null;
  resourceName: string;
  resourceInitials?: string | null;
  ccName?: string;
  detail: ResourceDetail | null;
  loading: boolean;
  periodId: string | null;
  canEditDemand: boolean;
  canEditSupply: boolean;
  isPM: boolean;
  /** When set (PM scope), restrict visible lines to these project IDs */
  scopeProjectIds?: string[];
  onClose: () => void;
  onDataChanged: () => void;
}

// ── Main component ────────────────────────────────────────────────────────────

export function ResourceDetailModal({
  open,
  resourceId,
  resourceName,
  resourceInitials,
  ccName,
  detail,
  loading,
  periodId,
  canEditDemand,
  canEditSupply,
  isPM,
  scopeProjectIds,
  onClose,
  onDataChanged,
}: ResourceDetailModalProps) {
  const { showSuccess, showApiError } = useToast();
  const { periods } = usePeriod();
  const selectedPeriod = periods.find(p => p.id === periodId);

  const [demandLines,  setDemandLines]  = useState<DemandLine[]>([]);
  const [supplyLines,  setSupplyLines]  = useState<SupplyLine[]>([]);
  const [projects,     setProjects]     = useState<Project[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [localDetail,  setLocalDetail]  = useState<ResourceDetail | null>(null);

  const [editingDemandId, setEditingDemandId] = useState<string | null>(null);
  const [addingDemand,    setAddingDemand]    = useState(false);
  const [demandForm, setDemandForm] = useState({ project_id: '', fte_percent: 50 });

  const [editingSupplyId, setEditingSupplyId] = useState<string | null>(null);
  const [addingSupply,    setAddingSupply]    = useState(false);
  const [supplyForm, setSupplyForm] = useState({ project_id: '', fte_percent: 100 });

  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  useEffect(() => { setLocalDetail(detail); }, [detail]);

  useEffect(() => {
    if (!open) {
      setEditingDemandId(null);
      setEditingSupplyId(null);
      setAddingDemand(false);
      setAddingSupply(false);
      setDemandLines([]);
      setSupplyLines([]);
      setLastSaved(null);
      return;
    }
    if ((canEditDemand || canEditSupply) && periodId && resourceId) {
      loadLines();
      if (projects.length === 0) loadProjects();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canEditDemand, canEditSupply, periodId, resourceId]);

  const loadLines = async () => {
    if (!periodId || !resourceId) return;
    setLinesLoading(true);
    try {
      const [dl, sl] = await Promise.all([
        planningApi.getDemandLines(periodId, { resourceId }),
        planningApi.getSupplyLines(periodId, { resourceId }),
      ]);
      setDemandLines(dl);
      setSupplyLines(sl);
    } finally {
      setLinesLoading(false);
    }
  };

  const loadProjects = async () => {
    try {
      const ps = isPM ? await lookupsApi.listProjectsScoped() : await lookupsApi.listProjects();
      setProjects(ps);
    } catch {}
  };

  // ── Demand handlers ──────────────────────────────────────────────────────────

  const startAddDemand = () => {
    setAddingDemand(true);
    setEditingDemandId(null);
    setDemandForm({ project_id: '', fte_percent: 50 });
  };

  const saveDemand = async (lineId: string | null) => {
    if (!demandForm.project_id || !periodId || !resourceId) return;
    if (!lineId && (!selectedPeriod?.year || !selectedPeriod?.month)) return;
    setSaving(true);
    try {
      if (lineId) {
        const oldLine = demandLines.find(l => l.id === lineId);
        const updated = await planningApi.updateDemandLine(lineId, {
          project_id: demandForm.project_id,
          fte_percent: demandForm.fte_percent,
        });
        setDemandLines(prev => prev.map(l => l.id === lineId ? updated : l));
        if (oldLine) {
          const diff = updated.fte_percent - oldLine.fte_percent;
          setLocalDetail(prev => prev ? {
            ...prev,
            total_demand_fte: prev.total_demand_fte + diff,
            gap_fte: prev.gap_fte - diff,
          } : prev);
        }
        showSuccess('Demand line updated');
      } else {
        const newLine = await planningApi.createDemandLine({
          period_id: periodId,
          project_id: demandForm.project_id,
          resource_id: resourceId,
          fte_percent: demandForm.fte_percent,
          year: selectedPeriod!.year,
          month: selectedPeriod!.month,
        });
        setDemandLines(prev => [...prev, newLine]);
        setLocalDetail(prev => prev ? {
          ...prev,
          total_demand_fte: prev.total_demand_fte + newLine.fte_percent,
          gap_fte: prev.gap_fte - newLine.fte_percent,
        } : prev);
        showSuccess('Demand line added');
      }
      setEditingDemandId(null);
      setAddingDemand(false);
      setLastSaved(new Date());
      onDataChanged();
    } catch (e) { showApiError(e as Error); }
    finally { setSaving(false); }
  };

  const updateFteDemand = async (lineId: string, newPct: number) => {
    const oldLine = demandLines.find(l => l.id === lineId);
    if (!oldLine) return;
    const diff = newPct - oldLine.fte_percent;
    // Optimistic update
    setDemandLines(prev => prev.map(l => l.id === lineId ? { ...l, fte_percent: newPct } : l));
    setLocalDetail(prev => prev ? {
      ...prev,
      total_demand_fte: prev.total_demand_fte + diff,
      gap_fte: prev.gap_fte - diff,
    } : prev);
    try {
      await planningApi.updateDemandLine(lineId, { fte_percent: newPct });
      setLastSaved(new Date());
      onDataChanged();
    } catch (e) {
      // Revert
      setDemandLines(prev => prev.map(l => l.id === lineId ? oldLine : l));
      setLocalDetail(prev => prev ? {
        ...prev,
        total_demand_fte: prev.total_demand_fte - diff,
        gap_fte: prev.gap_fte + diff,
      } : prev);
      showApiError(e as Error);
    }
  };

  const deleteDemand = async (lineId: string) => {
    const oldLine = demandLines.find(l => l.id === lineId);
    if (!oldLine) return;
    // Optimistic remove
    setDemandLines(prev => prev.filter(l => l.id !== lineId));
    setLocalDetail(prev => prev ? {
      ...prev,
      total_demand_fte: prev.total_demand_fte - oldLine.fte_percent,
      gap_fte: prev.gap_fte + oldLine.fte_percent,
    } : prev);
    setSaving(true);
    try {
      await planningApi.deleteDemandLine(lineId);
      showSuccess('Demand line removed');
      setLastSaved(new Date());
      onDataChanged();
    } catch (e) {
      // Revert
      setDemandLines(prev => [...prev, oldLine]);
      setLocalDetail(prev => prev ? {
        ...prev,
        total_demand_fte: prev.total_demand_fte + oldLine.fte_percent,
        gap_fte: prev.gap_fte - oldLine.fte_percent,
      } : prev);
      showApiError(e as Error);
    } finally {
      setSaving(false);
    }
  };

  // ── Supply handlers ──────────────────────────────────────────────────────────

  const startAddSupply = () => {
    setAddingSupply(true);
    setEditingSupplyId(null);
    setSupplyForm({ project_id: '', fte_percent: 100 });
  };

  const saveSupply = async (lineId: string | null) => {
    if (!periodId || !resourceId) return;
    if (!lineId && (!selectedPeriod?.year || !selectedPeriod?.month)) return;
    setSaving(true);
    try {
      if (lineId) {
        const oldLine = supplyLines.find(l => l.id === lineId);
        const updated = await planningApi.updateSupplyLine(lineId, {
          project_id: supplyForm.project_id || undefined,
          fte_percent: supplyForm.fte_percent,
        });
        setSupplyLines(prev => prev.map(l => l.id === lineId ? updated : l));
        if (oldLine) {
          const diff = updated.fte_percent - oldLine.fte_percent;
          setLocalDetail(prev => prev ? {
            ...prev,
            total_supply_fte: prev.total_supply_fte + diff,
            gap_fte: prev.gap_fte + diff,
          } : prev);
        }
        showSuccess('Supply line updated');
      } else {
        const newLine = await planningApi.createSupplyLine({
          period_id: periodId,
          resource_id: resourceId,
          project_id: supplyForm.project_id || undefined,
          fte_percent: supplyForm.fte_percent,
          year: selectedPeriod!.year,
          month: selectedPeriod!.month,
        });
        setSupplyLines(prev => [...prev, newLine]);
        setLocalDetail(prev => prev ? {
          ...prev,
          total_supply_fte: prev.total_supply_fte + newLine.fte_percent,
          gap_fte: prev.gap_fte + newLine.fte_percent,
        } : prev);
        showSuccess('Supply line added');
      }
      setEditingSupplyId(null);
      setAddingSupply(false);
      setLastSaved(new Date());
      onDataChanged();
    } catch (e) { showApiError(e as Error); }
    finally { setSaving(false); }
  };

  const updateFteSupply = async (lineId: string, newPct: number) => {
    const oldLine = supplyLines.find(l => l.id === lineId);
    if (!oldLine) return;
    const diff = newPct - oldLine.fte_percent;
    // Optimistic update
    setSupplyLines(prev => prev.map(l => l.id === lineId ? { ...l, fte_percent: newPct } : l));
    setLocalDetail(prev => prev ? {
      ...prev,
      total_supply_fte: prev.total_supply_fte + diff,
      gap_fte: prev.gap_fte + diff,
    } : prev);
    try {
      await planningApi.updateSupplyLine(lineId, { fte_percent: newPct });
      setLastSaved(new Date());
      onDataChanged();
    } catch (e) {
      // Revert
      setSupplyLines(prev => prev.map(l => l.id === lineId ? oldLine : l));
      setLocalDetail(prev => prev ? {
        ...prev,
        total_supply_fte: prev.total_supply_fte - diff,
        gap_fte: prev.gap_fte - diff,
      } : prev);
      showApiError(e as Error);
    }
  };

  const deleteSupply = async (lineId: string) => {
    const oldLine = supplyLines.find(l => l.id === lineId);
    if (!oldLine) return;
    // Optimistic remove
    setSupplyLines(prev => prev.filter(l => l.id !== lineId));
    setLocalDetail(prev => prev ? {
      ...prev,
      total_supply_fte: prev.total_supply_fte - oldLine.fte_percent,
      gap_fte: prev.gap_fte - oldLine.fte_percent,
    } : prev);
    setSaving(true);
    try {
      await planningApi.deleteSupplyLine(lineId);
      showSuccess('Supply line removed');
      setLastSaved(new Date());
      onDataChanged();
    } catch (e) {
      // Revert
      setSupplyLines(prev => [...prev, oldLine]);
      setLocalDetail(prev => prev ? {
        ...prev,
        total_supply_fte: prev.total_supply_fte + oldLine.fte_percent,
        gap_fte: prev.gap_fte + oldLine.fte_percent,
      } : prev);
      showApiError(e as Error);
    } finally {
      setSaving(false);
    }
  };

  // ── Derived display values ───────────────────────────────────────────────────

  const anyCanEdit = canEditDemand || canEditSupply;
  const showEditableLines = anyCanEdit && !linesLoading;

  // filterIdSet: use explicit scopeProjectIds when provided (PM scope), otherwise fall back
  // to the projects loaded for PM editing (editableProjectIds logic).
  const filterIdSet: Set<string> | null = scopeProjectIds?.length
    ? new Set(scopeProjectIds)
    : (isPM && projects.length > 0 ? new Set(projects.map(p => p.id)) : null);

  // Demand filtering
  const visibleDemandLines = filterIdSet
    ? demandLines.filter(l => filterIdSet.has(l.project_id))
    : demandLines;
  const visibleReadOnlyDemandLines = filterIdSet && localDetail
    ? localDetail.demand_lines.filter(l => l.project_id != null && filterIdSet.has(l.project_id))
    : (localDetail?.demand_lines ?? []);

  // Supply filtering — null project_id means "general availability" and is always visible
  const visibleSupplyLines = filterIdSet
    ? supplyLines.filter(l => !l.project_id || filterIdSet.has(l.project_id))
    : supplyLines;
  const visibleReadOnlySupplyLines = filterIdSet && localDetail
    ? localDetail.supply_lines.filter(l => !l.project_id || filterIdSet.has(l.project_id))
    : (localDetail?.supply_lines ?? []);

  const shownDemandLines = showEditableLines ? visibleDemandLines : visibleReadOnlyDemandLines;
  const shownSupplyLines = showEditableLines ? visibleSupplyLines : visibleReadOnlySupplyLines;
  const totalDemandPct = shownDemandLines.reduce((s, l) => s + l.fte_percent, 0);
  const totalSupplyPct = shownSupplyLines.reduce((s, l) => s + l.fte_percent, 0);

  // Count of lines hidden from PM scope (for "X additional lines on other projects" note)
  const allDemandForCount = showEditableLines ? demandLines : (localDetail?.demand_lines ?? []);
  const allSupplyForCount = showEditableLines ? supplyLines : (localDetail?.supply_lines ?? []);
  const hiddenDemandCount = filterIdSet
    ? allDemandForCount.filter(l => l.project_id != null && !filterIdSet.has(l.project_id)).length
    : 0;
  const hiddenSupplyCount = filterIdSet
    ? allSupplyForCount.filter(l => !!l.project_id && !filterIdSet.has(l.project_id)).length
    : 0;
  const hiddenCount = hiddenDemandCount + hiddenSupplyCount;

  const activeDetail = localDetail ?? detail;
  const gap = activeDetail?.gap_fte ?? 0;
  const gapSeverity = gapSev(gap);
  const gapColors = SEV[gapSeverity];
  const initials = resourceInitials || getInitials(resourceName);

  // When scoped, derive gap from visible lines so the summary strip reflects PM's projects
  const scopedGap = totalSupplyPct - totalDemandPct;
  const displayGap = filterIdSet ? scopedGap : gap;
  const displayGapColors = SEV[gapSev(displayGap)];

  const maxFte = Math.max(
    filterIdSet ? totalDemandPct : (activeDetail?.total_demand_fte ?? 0),
    filterIdSet ? totalSupplyPct : (activeDetail?.total_supply_fte ?? 0),
    1,
  );

  const periodLabel = selectedPeriod
    ? `${selectedPeriod.year}-${String(selectedPeriod.month).padStart(2, '0')}`
    : '';

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Dialog
      open={open}
      onOpenChange={(_ev: DialogOpenChangeEvent, data: DialogOpenChangeData) => { if (!data.open) onClose(); }}
    >
      <DialogSurface style={{ width: 700, maxWidth: '94vw', padding: 0, overflow: 'hidden', borderRadius: 12 }}>
        <DialogBody style={{ display: 'flex', flexDirection: 'column', maxHeight: '88vh', padding: 0 }}>

          {/* ── Header ── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '18px 20px',
            borderBottom: `1px solid ${C.line}`,
            background: `linear-gradient(135deg, ${displayGapColors.bg} 0%, ${C.surface} 60%)`,
            flexShrink: 0,
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 22, flexShrink: 0,
              background: `linear-gradient(135deg, ${displayGapColors.bar}28, ${displayGapColors.bar}55)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700, color: displayGapColors.bar,
              border: `1.5px solid ${displayGapColors.bar}44`,
            }}>
              {initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>{resourceName}</div>
              <div style={{ fontSize: 12, color: C.ink3, marginTop: 1 }}>
                {[ccName, periodLabel].filter(Boolean).join(' · ')}
              </div>
            </div>
            <Button
              appearance="subtle"
              icon={<Dismiss24Regular />}
              onClick={onClose}
              aria-label="Close"
            />
          </div>

          {/* ── Scrollable content ── */}
          <DialogContent style={{ padding: 0, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: tokens.spacingVerticalXL }}>
                <Spinner label="Loading assignments..." />
              </div>
            )}

            {!loading && activeDetail && (
              <>
                {/* ── Summary strip ── */}
                {filterIdSet ? (
                  /* PM scoped view: show "My projects" values prominently + full total as context */
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                    borderBottom: `1px solid ${C.line}`,
                  }}>
                    {[
                      { label: 'Demand',  scopedVal: `${totalDemandPct}%`,     totalVal: `${activeDetail.total_demand_fte}%`, color: C.bad,                  bg: C.badSoft  },
                      { label: 'Supply',  scopedVal: `${totalSupplyPct}%`,     totalVal: `${activeDetail.total_supply_fte}%`, color: C.accent,               bg: C.overSoft },
                      { label: 'Net Gap', scopedVal: fmtGap(scopedGap),        totalVal: fmtGap(gap),                         color: displayGapColors.text,  bg: displayGapColors.bg },
                    ].map(({ label, scopedVal, totalVal, color, bg }, i) => (
                      <div key={label} style={{
                        padding: '12px 20px',
                        backgroundColor: bg,
                        borderRight: i < 2 ? `1px solid ${C.line}` : undefined,
                        textAlign: 'center',
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
                          My projects
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: 'monospace' }}>
                          {scopedVal}
                        </div>
                        <div style={{ fontSize: 11, color: C.ink3, marginTop: 3 }}>
                          Total: {totalVal}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Standard view */
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                    borderBottom: `1px solid ${C.line}`,
                  }}>
                    {[
                      { label: 'Demand',  value: `${activeDetail.total_demand_fte}%`, color: C.bad,          bg: C.badSoft  },
                      { label: 'Supply',  value: `${activeDetail.total_supply_fte}%`, color: C.accent,       bg: C.overSoft },
                      { label: 'Net Gap', value: fmtGap(gap),                          color: gapColors.text, bg: gapColors.bg },
                    ].map(({ label, value, color, bg }, i) => (
                      <div key={label} style={{
                        padding: '14px 20px',
                        backgroundColor: bg,
                        borderRight: i < 2 ? `1px solid ${C.line}` : undefined,
                        textAlign: 'center',
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 500, color: C.ink3, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                          {label}
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: 'monospace' }}>
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Balance bars ── */}
                <div style={{ padding: '14px 20px 10px', borderBottom: `1px solid ${C.line}` }}>
                  <BalanceBar label="Demand" value={filterIdSet ? totalDemandPct : activeDetail.total_demand_fte} max={maxFte} color={C.bad} />
                  <BalanceBar label="Supply" value={filterIdSet ? totalSupplyPct : activeDetail.total_supply_fte} max={maxFte} color={C.accent} />
                </div>

                {/* ── Demand assignments ── */}
                <div style={{ borderTop: `1px solid ${C.line}` }}>
                  <SectionHeader
                    title="Demand assignments"
                    count={shownDemandLines.length}
                    totalPct={totalDemandPct}
                    canAdd={canEditDemand}
                    adding={addingDemand}
                    saving={saving}
                    onAdd={startAddDemand}
                    color={C.bad}
                  />

                  {linesLoading && canEditDemand ? (
                    <div style={{ padding: '16px 20px' }}>
                      <Spinner size="tiny" label="Loading..." />
                    </div>
                  ) : (
                    <>
                      {shownDemandLines.length === 0 && !addingDemand && (
                        <div style={{ padding: '16px 20px', fontSize: 13, color: C.ink3 }}>
                          No demand assignments.
                        </div>
                      )}

                      {showEditableLines
                        ? visibleDemandLines.map(line => (
                            editingDemandId === line.id ? (
                              <EditRow
                                key={line.id}
                                projects={projects}
                                projectId={demandForm.project_id}
                                ftePct={demandForm.fte_percent}
                                saving={saving}
                                onProjectChange={v => setDemandForm(f => ({ ...f, project_id: v }))}
                                onFteChange={v => setDemandForm(f => ({ ...f, fte_percent: v }))}
                                onSave={() => saveDemand(line.id)}
                                onCancel={() => setEditingDemandId(null)}
                              />
                            ) : (
                              <AssignmentRow
                                key={line.id}
                                projectName={line.project_name ?? null}
                                ftePct={line.fte_percent}
                                barColor={C.bad}
                                canEdit={canEditDemand}
                                saving={saving}
                                editing={!!editingDemandId || addingDemand}
                                onDelete={() => deleteDemand(line.id)}
                                onFteChange={canEditDemand ? (newPct) => updateFteDemand(line.id, newPct) : undefined}
                              />
                            )
                          ))
                        : visibleReadOnlyDemandLines.map((line, i) => (
                            <AssignmentRow
                              key={i}
                              projectName={line.project_name ?? null}
                              ftePct={line.fte_percent}
                              barColor={C.bad}
                              canEdit={false}
                              saving={false}
                              editing={false}
                              onDelete={() => {}}
                            />
                          ))
                      }

                      {addingDemand && (
                        <EditRow
                          projects={projects}
                          projectId={demandForm.project_id}
                          ftePct={demandForm.fte_percent}
                          saving={saving}
                          onProjectChange={v => setDemandForm(f => ({ ...f, project_id: v }))}
                          onFteChange={v => setDemandForm(f => ({ ...f, fte_percent: v }))}
                          onSave={() => saveDemand(null)}
                          onCancel={() => setAddingDemand(false)}
                        />
                      )}
                    </>
                  )}

                  {shownDemandLines.length > 0 && (
                    <div style={{
                      padding: '8px 16px',
                      borderTop: `1px solid ${C.line}`,
                      display: 'flex', justifyContent: 'space-between',
                      fontSize: 11, color: C.ink3,
                      backgroundColor: C.surface2,
                    }}>
                      <span>{shownDemandLines.length} demand line{shownDemandLines.length !== 1 ? 's' : ''}</span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600, color: C.bad }}>Total {totalDemandPct}%</span>
                    </div>
                  )}
                </div>

                {/* ── Supply assignments ── */}
                <div style={{ borderTop: `1px solid ${C.line}` }}>
                  <SectionHeader
                    title="Supply assignments"
                    count={shownSupplyLines.length}
                    totalPct={totalSupplyPct}
                    canAdd={canEditSupply}
                    adding={addingSupply}
                    saving={saving}
                    onAdd={startAddSupply}
                    color={C.accent}
                  />

                  {linesLoading && canEditSupply ? (
                    <div style={{ padding: '16px 20px' }}>
                      <Spinner size="tiny" label="Loading..." />
                    </div>
                  ) : (
                    <>
                      {shownSupplyLines.length === 0 && !addingSupply && (
                        <div style={{ padding: '16px 20px', fontSize: 13, color: C.ink3 }}>
                          No supply assignments.
                        </div>
                      )}

                      {showEditableLines
                        ? visibleSupplyLines.map(line => (
                            editingSupplyId === line.id ? (
                              <EditRow
                                key={line.id}
                                projects={projects}
                                projectId={supplyForm.project_id}
                                ftePct={supplyForm.fte_percent}
                                saving={saving}
                                supplyMode
                                onProjectChange={v => setSupplyForm(f => ({ ...f, project_id: v }))}
                                onFteChange={v => setSupplyForm(f => ({ ...f, fte_percent: v }))}
                                onSave={() => saveSupply(line.id)}
                                onCancel={() => setEditingSupplyId(null)}
                              />
                            ) : (
                              <AssignmentRow
                                key={line.id}
                                projectName={line.project_name ?? null}
                                ftePct={line.fte_percent}
                                barColor={C.accent}
                                canEdit={canEditSupply}
                                saving={saving}
                                editing={!!editingSupplyId || addingSupply}
                                onDelete={() => deleteSupply(line.id)}
                                onFteChange={canEditSupply ? (newPct) => updateFteSupply(line.id, newPct) : undefined}
                              />
                            )
                          ))
                        : visibleReadOnlySupplyLines.map((line, i) => (
                            <AssignmentRow
                              key={i}
                              projectName={line.project_name ?? null}
                              ftePct={line.fte_percent}
                              barColor={C.accent}
                              canEdit={false}
                              saving={false}
                              editing={false}
                              onDelete={() => {}}
                            />
                          ))
                      }

                      {addingSupply && (
                        <EditRow
                          projects={projects}
                          projectId={supplyForm.project_id}
                          ftePct={supplyForm.fte_percent}
                          saving={saving}
                          supplyMode
                          onProjectChange={v => setSupplyForm(f => ({ ...f, project_id: v }))}
                          onFteChange={v => setSupplyForm(f => ({ ...f, fte_percent: v }))}
                          onSave={() => saveSupply(null)}
                          onCancel={() => setAddingSupply(false)}
                        />
                      )}
                    </>
                  )}

                  {shownSupplyLines.length > 0 && (
                    <div style={{
                      padding: '8px 16px',
                      borderTop: `1px solid ${C.line}`,
                      display: 'flex', justifyContent: 'space-between',
                      fontSize: 11, color: C.ink3,
                      backgroundColor: C.surface2,
                    }}>
                      <span>{shownSupplyLines.length} supply line{shownSupplyLines.length !== 1 ? 's' : ''}</span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600, color: C.accent }}>Total {totalSupplyPct}%</span>
                    </div>
                  )}
                </div>

                {/* Hidden lines note — shown in PM scope when this resource has lines on other projects */}
                {hiddenCount > 0 && (
                  <div style={{
                    padding: '10px 20px',
                    fontSize: 12,
                    color: C.ink3,
                    textAlign: 'center',
                    borderTop: `1px solid ${C.line}`,
                    backgroundColor: C.surface2,
                  }}>
                    {hiddenCount} additional line{hiddenCount !== 1 ? 's' : ''} on other projects not shown
                  </div>
                )}

              </>
            )}
          </DialogContent>

          {/* ── Footer ── */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 20px',
            borderTop: `1px solid ${C.line}`,
            backgroundColor: C.surface2,
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 11, color: C.ink3 }}>
              {saving
                ? '⏳ Saving…'
                : lastSaved
                  ? `✓ Saved ${lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'Auto-saved · all changes saved immediately'
              }
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button appearance="secondary" onClick={onClose}>Close</Button>
              <Button appearance="primary" onClick={onClose} disabled={saving}>Apply</Button>
            </div>
          </div>

        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
