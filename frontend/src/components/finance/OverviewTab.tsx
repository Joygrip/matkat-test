import { useState, useMemo } from 'react';
import {
  Body1,
  Input,
  Tab,
  TabList,
  Skeleton,
  SkeletonItem,
  Button,
  tokens,
} from '@fluentui/react-components';
import {
  SearchRegular,
  BuildingRegular,
  Warning24Regular,
  EditRegular,
} from '@fluentui/react-icons';
import type {
  ConsolidationDashboard,
  DashboardCostCenter,
  DashboardResource,
  OverAllocation,
  ResourceDetail,
} from '../../api/consolidation';
import { consolidationApi } from '../../api/consolidation';
import { useWorkQueueSort } from '../../hooks/useWorkQueueSort';
import { useHasRole } from '../../auth/AuthProvider';
import { ResourceDetailModal } from './ResourceDetailModal';

// ── Color system ──────────────────────────────────────────────────────────────

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

// ── Severity helpers ──────────────────────────────────────────────────────────

type Severity = 'bad' | 'warn' | 'good' | 'over' | 'neutral';

const SEV: Record<Severity, { bar: string; bg: string; text: string; label: string }> = {
  bad:     { bar: C.bad,     bg: C.badSoft,  text: C.bad,  label: 'Critical shortage' },
  warn:    { bar: C.warn,    bg: C.warnSoft, text: C.warn, label: 'Shortage'           },
  good:    { bar: C.good,    bg: C.goodSoft, text: C.good, label: 'Balanced'           },
  over:    { bar: C.over,    bg: C.overSoft, text: C.over, label: 'Over-staffed'       },
  neutral: { bar: '#aaa',    bg: C.surface2, text: C.ink3, label: 'No assignments'     },
};

function gapSeverity(gapFte: number, hasActivity: boolean): Severity {
  if (!hasActivity) return 'neutral';
  if (gapFte < -20) return 'bad';
  if (gapFte < 0)   return 'warn';
  if (gapFte > 15)  return 'over';
  return 'good';
}

function ccSeverity(cc: DashboardCostCenter): Severity {
  const hasActivity = cc.resources.length > 0 || cc.placeholders.length > 0;
  // Treat a CC as understaffed if any resource is 'under'
  const hasUnder = cc.resources.some(r => r.status === 'under');
  if (!hasActivity) return 'neutral';
  if (hasUnder && cc.gap_fte < -20) return 'bad';
  if (hasUnder) return 'warn';
  return gapSeverity(cc.gap_fte, true);
}

function resourceSeverity(r: DashboardResource): Severity {
  if (r.status === 'under') return r.gap_fte < -20 ? 'bad' : 'warn';
  if (r.status === 'over')  return 'over';
  return 'good';
}

function getInitials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

function fmtGap(gap: number): string {
  return `${gap > 0 ? '+' : ''}${gap}%`;
}

// ── Visual sub-components ─────────────────────────────────────────────────────

function AllocationBar({ demand, supply, width = 160 }: { demand: number; supply: number; width?: number }) {
  const max = Math.max(demand, supply, 1);
  const dPct = Math.min((demand / max) * 100, 100);
  const sPct = Math.min((supply / max) * 100, 100);
  const sFill = supply >= demand ? C.good : C.accent;

  return (
    <div style={{ position: 'relative', width, height: 8, borderRadius: 4, backgroundColor: '#ebe9e4', overflow: 'visible', flexShrink: 0 }}>
      {/* demand track */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: `${dPct}%`, height: '100%', borderRadius: 4, backgroundColor: C.badSoft }} />
      {/* supply fill */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: `${sPct}%`, height: '100%', borderRadius: 4, backgroundColor: sFill, opacity: 0.85 }} />
      {/* demand marker */}
      {demand > 0 && (
        <div style={{
          position: 'absolute',
          left: `${dPct}%`,
          top: -2,
          width: 2,
          height: 12,
          borderRadius: 1,
          backgroundColor: C.bad,
          transform: 'translateX(-50%)',
        }} />
      )}
    </div>
  );
}

function MiniBar({ demand, supply }: { demand: number; supply: number }) {
  const max = Math.max(demand, supply, 1);
  const dPct = Math.min((demand / max) * 100, 100);
  const sPct = Math.min((supply / max) * 100, 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
      <div style={{ position: 'relative', height: 3, borderRadius: 2, backgroundColor: C.badSoft }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: `${dPct}%`, height: '100%', borderRadius: 2, backgroundColor: C.bad }} />
      </div>
      <div style={{ position: 'relative', height: 3, borderRadius: 2, backgroundColor: C.overSoft }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: `${sPct}%`, height: '100%', borderRadius: 2, backgroundColor: C.accent }} />
      </div>
    </div>
  );
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────

interface FilteredSummary {
  total_cost_centers: number;
  total_demand_fte: number;
  total_supply_fte: number;
  total_gap_fte: number;
  orphans_count: number;
  over_allocations_count: number;
  understaffed_count: number;
}

function KpiCards({ summary: s, costCenters }: { summary: FilteredSummary; costCenters: DashboardCostCenter[] }) {
  const dist = useMemo(() => {
    let bad = 0, warn = 0, good = 0, over = 0, neutral = 0;
    for (const cc of costCenters) {
      const sev = ccSeverity(cc);
      if (sev === 'bad')     bad++;
      else if (sev === 'warn')    warn++;
      else if (sev === 'good')    good++;
      else if (sev === 'over')    over++;
      else                        neutral++;
    }
    return { bad, warn, good, over, neutral, total: costCenters.length };
  }, [costCenters]);

  const { shortage, surplus, netGap } = useMemo(() => {
    let shortage = 0;
    let surplus = 0;
    for (const cc of costCenters) {
      for (const r of cc.resources) {
        if (r.gap_fte < 0) shortage += r.gap_fte;
        else if (r.gap_fte > 0) surplus += r.gap_fte;
      }
    }
    return { shortage: Math.round(shortage), surplus: Math.round(surplus), netGap: Math.round(shortage + surplus) };
  }, [costCenters]);

  const totalResources = costCenters.reduce((n, cc) => n + cc.resources.length, 0);
  const coveredPct = s.total_demand_fte > 0
    ? Math.round((s.total_supply_fte / s.total_demand_fte) * 100)
    : 0;
  const netSev = gapSeverity(netGap, true);
  const netColors = SEV[netSev];

  const card: React.CSSProperties = {
    padding: '14px 16px',
    borderRadius: 10,
    border: `1px solid ${C.line}`,
    backgroundColor: C.surface,
    boxShadow: '0 1px 3px rgba(0,0,0,.06)',
    minWidth: 0,
  };
  const cardLabel: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: C.ink3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 4,
  };
  const cardValue: React.CSSProperties = {
    fontSize: 28,
    fontWeight: 700,
    lineHeight: '1.15',
    color: C.ink,
  };
  const cardSub: React.CSSProperties = {
    fontSize: 11,
    color: C.ink3,
    marginBottom: 6,
    marginTop: 1,
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1fr 1fr 1.4fr 1.1fr', gap: 12, marginBottom: 20 }}>

      {/* Cost Centers */}
      <div style={card}>
        <div style={cardLabel}>Cost Centers</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={cardValue}>{s.total_cost_centers}</span>
          <span style={{ fontSize: 12, color: C.ink3 }}>active</span>
        </div>
        {dist.bad > 0
          ? <div style={{ ...cardSub, color: C.bad }}>{dist.bad} with critical gaps</div>
          : <div style={cardSub}>{dist.warn > 0 ? `${dist.warn} with gaps` : 'No issues'}</div>
        }
        {dist.total > 0 && (
          <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', gap: 1 }}>
            {dist.bad     > 0 && <div style={{ flex: dist.bad,     backgroundColor: C.bad }}  />}
            {dist.warn    > 0 && <div style={{ flex: dist.warn,    backgroundColor: C.warn }} />}
            {dist.good    > 0 && <div style={{ flex: dist.good,    backgroundColor: C.good }} />}
            {dist.over    > 0 && <div style={{ flex: dist.over,    backgroundColor: C.over }} />}
            {dist.neutral > 0 && <div style={{ flex: dist.neutral, backgroundColor: '#ccc' }}  />}
          </div>
        )}
      </div>

      {/* Demand */}
      <div style={card}>
        <div style={cardLabel}>Demand</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={cardValue}>{s.total_demand_fte}%</span>
        </div>
        <div style={cardSub}>across {totalResources} resource{totalResources !== 1 ? 's' : ''}</div>
        <div style={{ position: 'relative', height: 4, borderRadius: 2, backgroundColor: C.badSoft }}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: `${Math.min(s.total_demand_fte, 100)}%`, height: '100%', borderRadius: 2, backgroundColor: C.bad }} />
        </div>
      </div>

      {/* Supply */}
      <div style={card}>
        <div style={cardLabel}>Supply</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={cardValue}>{s.total_supply_fte}%</span>
        </div>
        <div style={cardSub}>{s.total_demand_fte > 0 ? `${coveredPct}% of demand covered` : 'No demand'}</div>
        <div style={{ position: 'relative', height: 4, borderRadius: 2, backgroundColor: C.overSoft }}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: `${Math.min(s.total_supply_fte, 100)}%`, height: '100%', borderRadius: 2, backgroundColor: C.accent }} />
        </div>
      </div>

      {/* Net Gap — hero card */}
      <div style={{
        ...card,
        border: `1px solid ${netGap < 0 ? C.badSoft : C.line}`,
        background: netGap < 0
          ? 'linear-gradient(180deg, #fff 0%, #fbf4f2 100%)'
          : 'linear-gradient(180deg, #fff 0%, #f4f8ff 100%)',
      }}>
        <div style={cardLabel}>Net Gap</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 4 }}>
          <div>
            <div style={{ fontSize: 10, color: C.ink3, marginBottom: 2 }}>Shortage</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.bad }}>
              {fmtGap(shortage)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.ink3, marginBottom: 2 }}>Surplus</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.over }}>
              {fmtGap(surplus)}
            </div>
          </div>
          <div style={{ borderLeft: `1px solid ${C.line}`, paddingLeft: 8 }}>
            <div style={{ fontSize: 10, color: C.ink3, marginBottom: 2 }}>Net</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: netColors.text }}>
              {fmtGap(netGap)}
            </div>
          </div>
        </div>
      </div>

      {/* Understaffed Resources — attention card */}
      <div style={{
        ...card,
        border: `1px solid ${s.understaffed_count > 0 ? '#f0dfa0' : C.line}`,
        background: s.understaffed_count > 0
          ? 'linear-gradient(180deg, #fff 0%, #fffdf0 100%)'
          : C.surface,
      }}>
        <div style={cardLabel}>Understaffed</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ ...cardValue, color: s.understaffed_count > 0 ? C.warn : C.ink }}>
            {s.understaffed_count}
          </span>
          <span style={{ fontSize: 12, color: C.ink3 }}>resources</span>
        </div>
        {s.understaffed_count > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
            {dist.bad > 0 && (
              <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 10, backgroundColor: C.badSoft, color: C.bad, fontWeight: 500 }}>
                {dist.bad} critical
              </span>
            )}
            {dist.warn > 0 && (
              <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 10, backgroundColor: C.warnSoft, color: C.warn, fontWeight: 500 }}>
                {dist.warn} attention
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Alert Banner ──────────────────────────────────────────────────────────────

function AlertBanner({
  summary,
  costCenters,
  showIssuesOnly,
  onToggleIssues,
}: {
  summary: FilteredSummary;
  costCenters: DashboardCostCenter[];
  showIssuesOnly: boolean;
  onToggleIssues: () => void;
}) {
  const { understaffed_count, orphans_count, over_allocations_count } = summary;
  const total = understaffed_count + orphans_count + over_allocations_count;
  if (total === 0) return null;

  const affectedCcs = costCenters.filter(
    cc => cc.resources.some(r => r.status === 'under') || cc.placeholders.length > 0
  );
  const worstCcs = affectedCcs.slice(0, 3);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      padding: '12px 14px',
      borderRadius: 10,
      border: '1px solid #f0e0b8',
      backgroundColor: '#fffdf5',
      marginBottom: 16,
    }}>
      <Warning24Regular style={{ color: C.warn, flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: C.ink }}>
          {understaffed_count > 0 && `${understaffed_count} understaffed resource${understaffed_count !== 1 ? 's' : ''}`}
          {understaffed_count > 0 && orphans_count > 0 && ' · '}
          {orphans_count > 0 && `${orphans_count} orphan demand${orphans_count !== 1 ? 's' : ''}`}
          {(understaffed_count > 0 || orphans_count > 0) && over_allocations_count > 0 && ' · '}
          {over_allocations_count > 0 && `${over_allocations_count} over-allocation${over_allocations_count !== 1 ? 's' : ''}`}
          {affectedCcs.length > 0 && ` across ${affectedCcs.length} cost center${affectedCcs.length !== 1 ? 's' : ''}`}
        </div>
        {worstCcs.length > 0 && (
          <div style={{ fontSize: 11, color: C.ink3, marginTop: 2 }}>
            {worstCcs.map(cc => {
              const n = cc.resources.filter(r => r.status === 'under').length + cc.placeholders.length;
              return `${cc.cost_center_name} (${n})`;
            }).join(' · ')}
            {affectedCcs.length > 3 && ` · +${affectedCcs.length - 3} more`}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <Button
          size="small"
          appearance={showIssuesOnly ? 'primary' : 'outline'}
          onClick={onToggleIssues}
        >
          {showIssuesOnly ? 'Clear filter' : 'Issues only'}
        </Button>
      </div>
    </div>
  );
}

// ── CC Navigator Card ─────────────────────────────────────────────────────────

function CcNavCard({
  cc,
  selected,
  onClick,
}: {
  cc: DashboardCostCenter;
  selected: boolean;
  onClick: () => void;
}) {
  const sev = ccSeverity(cc);
  const sevC = SEV[sev];
  const understaffedN = cc.resources.filter(r => r.status === 'under').length;
  const overN         = cc.resources.filter(r => r.status === 'over').length;
  const hasActivity   = cc.resources.length > 0 || cc.placeholders.length > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      style={{
        display: 'flex',
        borderRadius: 8,
        border: `1px solid ${selected ? sevC.bar : C.line}`,
        backgroundColor: selected ? sevC.bg : C.surface,
        boxShadow: selected ? `0 2px 8px ${sevC.bar}28` : '0 1px 2px rgba(0,0,0,.04)',
        cursor: 'pointer',
        outline: 'none',
        transition: 'border-color 0.12s, background 0.12s',
        overflow: 'visible',
      }}
    >
      {/* Severity accent bar — border-radius applied here so parent doesn't need overflow:hidden */}
      <div style={{
        width: selected ? 4 : 3, flexShrink: 0, backgroundColor: sevC.bar,
        borderTopLeftRadius: 7, borderBottomLeftRadius: 7,
        transition: 'width 0.12s',
      }} />

      <div style={{ flex: 1, padding: '9px 11px 12px', minWidth: 0 }}>
        {/* Name + gap chip */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, wordBreak: 'break-word', flex: 1 }}>
            {cc.cost_center_name}
          </div>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 10, flexShrink: 0,
            backgroundColor: sevC.bg, color: sevC.text, border: `1px solid ${sevC.bar}44`,
          }}>
            {fmtGap(cc.gap_fte)}
          </span>
        </div>

        {/* D/S meta */}
        <div style={{ fontSize: 11, color: C.ink3, fontFamily: 'monospace', letterSpacing: '-0.3px', marginTop: 3 }}>
          D: {cc.total_demand_fte}% · S: {cc.total_supply_fte}%
        </div>

        {/* Mini bars */}
        <div style={{ marginTop: 6 }}>
          <MiniBar demand={cc.total_demand_fte} supply={cc.total_supply_fte} />
        </div>

        {/* Issue label */}
        <div style={{ marginTop: 5, fontSize: 11 }}>
          {understaffedN > 0 && <span style={{ color: C.bad, fontWeight: 500 }}>{understaffedN} understaffed</span>}
          {understaffedN === 0 && overN > 0 && <span style={{ color: C.over }}>{overN} over-staffed</span>}
          {understaffedN === 0 && overN === 0 && hasActivity && <span style={{ color: C.good }}>Balanced</span>}
          {!hasActivity && <span style={{ color: C.ink3 }}>No assignments</span>}
        </div>
      </div>
    </div>
  );
}

// ── Resource Row ──────────────────────────────────────────────────────────────

function ResourceRow({
  resource,
  onEdit,
}: {
  resource: DashboardResource;
  onEdit: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const sev  = resourceSeverity(resource);
  const sevC = SEV[sev];
  const initials = getInitials(resource.resource_name);
  const COLS = 'minmax(200px,1.6fr) 80px 80px minmax(160px,1.4fr) 96px 124px 76px';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        alignItems: 'center',
        borderBottom: `1px solid ${C.line}`,
        borderLeft: `3px solid ${sev !== 'good' && sev !== 'neutral' ? sevC.bar : 'transparent'}`,
        backgroundColor: hovered
          ? (sev === 'bad' ? '#fdf5f4' : sev === 'warn' ? '#fdfaf5' : sev === 'over' ? '#f4f8ff' : '#f8f8f7')
          : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      {/* Resource */}
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 14, flexShrink: 0,
          background: `linear-gradient(135deg, ${sevC.bar}20, ${sevC.bar}40)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: sevC.bar,
        }}>
          {initials}
        </div>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {resource.resource_name}
        </div>
      </div>

      {/* Demand */}
      <div style={{ padding: '10px 8px', textAlign: 'right', fontSize: 13, fontFamily: 'monospace', color: C.ink2 }}>
        {resource.demand_fte}%
      </div>

      {/* Supply */}
      <div style={{ padding: '10px 8px', textAlign: 'right', fontSize: 13, fontFamily: 'monospace', color: C.ink2 }}>
        {resource.supply_fte}%
      </div>

      {/* Demand vs Supply bar */}
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center' }}>
        <AllocationBar demand={resource.demand_fte} supply={resource.supply_fte} width={130} />
      </div>

      {/* Gap chip */}
      <div style={{ padding: '10px 8px' }}>
        <span style={{
          display: 'inline-block',
          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
          backgroundColor: sevC.bg, color: sevC.text,
          border: `1px solid ${sevC.bar}44`,
          fontFamily: 'monospace',
        }}>
          {resource.gap_fte !== 0 ? (resource.gap_fte < 0 ? '▼' : '▲') : ''}{fmtGap(resource.gap_fte)}
        </span>
      </div>

      {/* Status badge */}
      <div style={{ padding: '10px 8px' }}>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 500,
          backgroundColor: sevC.bg, color: sevC.text,
          border: `1px solid ${sevC.bar}33`,
        }}>
          {resource.status === 'under' ? 'Understaffed' : resource.status === 'over' ? 'Over-staffed' : 'Balanced'}
        </span>
      </div>

      {/* Actions — reveal on hover */}
      <div style={{ padding: '10px 8px', display: 'flex', justifyContent: 'flex-end', gap: 4, opacity: hovered ? 1 : 0, transition: 'opacity 0.1s' }}>
        <Button size="small" appearance="subtle" icon={<EditRegular />} onClick={e => { e.stopPropagation(); onEdit(); }}>
          Edit
        </Button>
      </div>
    </div>
  );
}

// ── CC Detail Panel ───────────────────────────────────────────────────────────

function CcDetailPanel({
  cc,
  overAllocs,
  onResourceClick,
  showIssuesOnly = false,
}: {
  cc: DashboardCostCenter;
  overAllocs: OverAllocation[];
  onResourceClick: (r: DashboardResource) => void;
  showIssuesOnly?: boolean;
}) {
  const [detailTab, setDetailTab] = useState<'resources' | 'issues'>('resources');
  const understaffedResources = cc.resources.filter(r => r.status === 'under');
  const issueCount = cc.placeholders.length + overAllocs.length + understaffedResources.length;
  const sev  = ccSeverity(cc);
  const sevC = SEV[sev];
  const COLS = 'minmax(200px,1.6fr) 80px 80px minmax(160px,1.4fr) 96px 124px 76px';
  const COL_HDRS = ['Resource', 'Demand', 'Supply', 'Demand vs Supply', 'Gap', 'Status', ''];

  // When "Issues only" is active, hide balanced/inactive resources from the table
  const displayedResources = showIssuesOnly
    ? cc.resources.filter(r => r.status !== 'balanced')
    : cc.resources;
  // Placeholders are always orphan demands — always shown (they are issues by definition)
  const displayedPlaceholders = cc.placeholders;
  const totalCount    = cc.resources.length + cc.placeholders.length;
  const displayedCount = displayedResources.length + displayedPlaceholders.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Panel header */}
      <div style={{
        padding: '16px 20px 14px',
        borderBottom: `1px solid ${C.line}`,
        background: `linear-gradient(180deg, ${sevC.bg} 0%, ${C.surface} 100%)`,
      }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: C.ink3, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
          Cost Center · {cc.cost_center_id ?? '—'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>{cc.cost_center_name}</div>
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
            backgroundColor: `${sevC.bar}18`, color: sevC.text,
            border: `1px solid ${sevC.bar}44`,
          }}>
            {sevC.label}
          </span>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 24, marginBottom: 12 }}>
          {[
            { label: 'Demand', value: `${cc.total_demand_fte}%`, color: C.ink },
            { label: 'Supply', value: `${cc.total_supply_fte}%`, color: C.ink },
            { label: 'Net Gap', value: fmtGap(cc.gap_fte), color: sevC.text },
          ].map(({ label, value, color }) => (
            <div key={label}>
              <div style={{ fontSize: 11, color: C.ink3 }}>{label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
            </div>
          ))}
        </div>

        <AllocationBar demand={cc.total_demand_fte} supply={cc.total_supply_fte} width={220} />
      </div>

      {/* Tabs */}
      <div style={{ padding: '0 20px', borderBottom: `1px solid ${C.line}`, backgroundColor: C.surface, flexShrink: 0 }}>
        <TabList
          selectedValue={detailTab}
          onTabSelect={(_, d) => setDetailTab(d.value as 'resources' | 'issues')}
          size="small"
        >
          <Tab value="resources">
            Resources ({displayedCount}{showIssuesOnly && displayedCount < totalCount ? ` of ${totalCount}` : ''})
          </Tab>
          <Tab value="issues">Issues {issueCount > 0 ? `(${issueCount})` : ''}</Tab>
        </TabList>
      </div>

      {/* Resources tab */}
      {detailTab === 'resources' && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          {/* Column headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: COLS,
            borderBottom: `2px solid ${C.line}`,
            backgroundColor: C.surface2,
            position: 'sticky',
            top: 0,
            zIndex: 1,
          }}>
            {COL_HDRS.map((h, i) => (
              <div key={i} style={{
                padding: '8px 12px',
                fontSize: 11, fontWeight: 600, color: C.ink3,
                textTransform: 'uppercase', letterSpacing: '0.4px',
                textAlign: (i === 1 || i === 2) ? 'right' : 'left',
              }}>
                {h}
              </div>
            ))}
          </div>

          {/* Resource rows */}
          {displayedResources.map(r => (
            <ResourceRow
              key={r.resource_id}
              resource={r}
              onEdit={() => onResourceClick(r)}
            />
          ))}

          {/* Placeholder rows */}
          {displayedPlaceholders.map(ph => (
            <div key={ph.placeholder_id} style={{
              display: 'grid',
              gridTemplateColumns: COLS,
              alignItems: 'center',
              borderBottom: `1px solid ${C.line}`,
              borderLeft: `3px solid ${C.warn}`,
              backgroundColor: `${C.warnSoft}55`,
            }}>
              <div style={{ padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                  backgroundColor: C.warnSoft, color: C.warn, border: `1px solid ${C.warn}44`,
                }}>
                  TBH
                </span>
                <span style={{ fontSize: 13, color: C.ink2 }}>{ph.placeholder_name}</span>
              </div>
              <div style={{ padding: '10px 8px', textAlign: 'right', fontSize: 13, fontFamily: 'monospace', color: C.ink2 }}>{ph.demand_fte}%</div>
              <div style={{ padding: '10px 8px', textAlign: 'right', fontSize: 13, color: C.ink3 }}>—</div>
              <div style={{ padding: '10px 12px' }} />
              <div />
              <div style={{ padding: '10px 8px' }}>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, backgroundColor: C.warnSoft, color: C.warn }}>
                  Unassigned
                </span>
              </div>
              <div />
            </div>
          ))}

          {displayedResources.length === 0 && displayedPlaceholders.length === 0 && (
            <div style={{ padding: '28px 20px', color: C.ink3, fontSize: 13, textAlign: 'center' }}>
              {showIssuesOnly ? 'No issues — all resources are balanced.' : 'No resources or placeholders.'}
            </div>
          )}

          {/* Legend */}
          {displayedResources.length > 0 && (
            <div style={{ padding: '8px 16px', borderTop: `1px solid ${C.line}`, display: 'flex', gap: 16, fontSize: 11, color: C.ink3 }}>
              <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <div style={{ width: 14, height: 4, borderRadius: 2, backgroundColor: C.badSoft, border: `1px solid ${C.bad}55` }} /> Demand
              </span>
              <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <div style={{ width: 14, height: 4, borderRadius: 2, backgroundColor: C.accent }} /> Supply
              </span>
              <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <div style={{ width: 2, height: 12, borderRadius: 1, backgroundColor: C.bad }} /> Demand marker
              </span>
            </div>
          )}

          {/* Filter active indicator */}
          {showIssuesOnly && (
            <div style={{
              padding: '6px 16px',
              borderTop: `1px solid ${C.line}`,
              fontSize: 11,
              color: C.warn,
              backgroundColor: C.warnSoft,
              textAlign: 'center',
            }}>
              Showing {displayedCount} of {totalCount} resource{totalCount !== 1 ? 's' : ''} · issues only
            </div>
          )}
        </div>
      )}

      {/* Issues tab */}
      {detailTab === 'issues' && (
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {issueCount === 0 && (
            <Body1 style={{ color: C.ink3 }}>No issues for this cost center.</Body1>
          )}

          {understaffedResources.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.bad, marginBottom: 8 }}>
                Understaffed Resources ({understaffedResources.length})
              </div>
              {understaffedResources.map(r => (
                <div key={r.resource_id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px', borderRadius: 6, backgroundColor: C.badSoft, marginBottom: 4,
                }}>
                  <span style={{ fontSize: 13 }}>{r.resource_name}</span>
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: C.bad }}>
                    D:{r.demand_fte}% · S:{r.supply_fte}% · G:{fmtGap(r.gap_fte)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {cc.placeholders.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.warn, marginBottom: 8 }}>
                Orphan Demands ({cc.placeholders.length})
              </div>
              {cc.placeholders.map(ph => (
                <div key={ph.placeholder_id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px', borderRadius: 6, backgroundColor: C.warnSoft, marginBottom: 4, gap: 8,
                }}>
                  <span style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ph.placeholder_name}
                  </span>
                  <span style={{ fontSize: 11, color: C.ink3, flexShrink: 0 }}>{ph.project_name}</span>
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: C.warn, fontWeight: 600, flexShrink: 0 }}>
                    {ph.demand_fte}%
                  </span>
                </div>
              ))}
            </div>
          )}

          {overAllocs.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.over, marginBottom: 8 }}>
                Over-allocations ({overAllocs.length})
              </div>
              {overAllocs.map((oa, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px', borderRadius: 6, backgroundColor: C.overSoft, marginBottom: 4,
                }}>
                  <span style={{ fontSize: 13 }}>{oa.resource_name}</span>
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: C.over, fontWeight: 600 }}>
                    {oa.total_demand_fte}% total demand
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface OverviewTabProps {
  dashboard: ConsolidationDashboard | null;
  loading: boolean;
  projectId?: string;
  onDashboardChanged?: () => void;
}

type CcSortKey = 'gap' | 'name' | 'demand' | 'supply';

const SORT_OPTIONS: { key: CcSortKey; label: string }[] = [
  { key: 'gap',    label: 'Severity' },
  { key: 'name',   label: 'Name'     },
  { key: 'demand', label: 'Demand'   },
];

export function OverviewTab({ dashboard, loading, projectId, onDashboardChanged }: OverviewTabProps) {
  const canEditDemand = useHasRole('Finance', 'PM');
  const canEditSupply = useHasRole('Finance', 'Manager');
  const isPM          = useHasRole('PM');

  const [showIssuesOnly, setShowIssuesOnly] = useState(false);
  const [selectedCcId,  setSelectedCcId]  = useState<string | null>(null);
  const [search,        setSearch]        = useState('');
  const [drillOpen,     setDrillOpen]     = useState(false);
  const [drillResourceId,   setDrillResourceId]   = useState<string | null>(null);
  const [drillResourceName, setDrillResourceName] = useState('');
  const [drillCcName,       setDrillCcName]       = useState('');
  const [resourceDetail,        setResourceDetail]        = useState<ResourceDetail | null>(null);
  const [resourceDetailLoading, setResourceDetailLoading] = useState(false);

  const { sort, handleSortClick, sortItems } = useWorkQueueSort<CcSortKey>('gap');

  const handleResourceClick = async (resource: DashboardResource) => {
    if (!dashboard) return;
    // Capture the currently selected CC name for the modal subtitle
    const currentCc = selectedCcId
      ? dashboard.cost_centers.find(cc => (cc.cost_center_id ?? '__none__') === selectedCcId)
      : null;
    setDrillResourceId(resource.resource_id);
    setDrillResourceName(resource.resource_name);
    setDrillCcName(currentCc?.cost_center_name ?? '');
    setDrillOpen(true);
    setResourceDetail(null);
    setResourceDetailLoading(true);
    try {
      const detail = await consolidationApi.getResourceDetail(dashboard.period_id, resource.resource_id);
      setResourceDetail(detail);
    } finally {
      setResourceDetailLoading(false);
    }
  };

  // Cost centers scoped to the selected project (no list filter / search applied).
  // Used for KPI and issue totals so they reflect the full project scope.
  const projectFilteredCcs = useMemo(() => {
    if (!dashboard) return [];
    if (!projectId) return dashboard.cost_centers;
    return dashboard.cost_centers.filter(cc => cc.project_ids.includes(projectId));
  }, [dashboard, projectId]);

  const filteredOverAllocs = useMemo(() => {
    if (!dashboard) return [];
    if (!projectId) return dashboard.over_allocations;
    const ids = new Set(projectFilteredCcs.map(cc => cc.cost_center_id ?? '__none__'));
    return dashboard.over_allocations.filter(oa => ids.has(oa.cost_center_id ?? '__none__'));
  }, [dashboard, projectId, projectFilteredCcs]);

  const filteredSummary = useMemo((): FilteredSummary | null => {
    if (!dashboard) return null;
    const total_cost_centers   = projectFilteredCcs.length;
    const total_demand_fte     = projectFilteredCcs.reduce((s, cc) => s + cc.total_demand_fte, 0);
    const total_supply_fte     = projectFilteredCcs.reduce((s, cc) => s + cc.total_supply_fte, 0);
    const total_gap_fte        = total_supply_fte - total_demand_fte;
    const orphans_count        = projectFilteredCcs.reduce((s, cc) => s + cc.placeholders.length, 0);
    const over_allocations_count = filteredOverAllocs.length;
    const understaffed_count   = projectFilteredCcs.reduce(
      (s, cc) => s + cc.resources.filter(r => r.status === 'under').length, 0
    );
    return { total_cost_centers, total_demand_fte, total_supply_fte, total_gap_fte, orphans_count, over_allocations_count, understaffed_count };
  }, [dashboard, projectFilteredCcs, filteredOverAllocs]);

  const filteredCcs = useMemo(() => {
    if (!dashboard) return [];
    let ccs = projectFilteredCcs;
    // "Issues only" toggle: any CC with a gap, understaffed resource, orphan demand, or over-alloc
    if (showIssuesOnly) {
      const overIds = new Set(filteredOverAllocs.map(oa => oa.cost_center_id ?? '__none__'));
      ccs = ccs.filter(cc =>
        cc.gap_fte < 0 ||
        cc.resources.some(r => r.status === 'under') ||
        cc.placeholders.length > 0 ||
        overIds.has(cc.cost_center_id ?? '__none__')
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      ccs = ccs.filter(cc => cc.cost_center_name.toLowerCase().includes(q));
    }
    return ccs;
  }, [dashboard, showIssuesOnly, search, projectFilteredCcs, filteredOverAllocs]);

  const sortedCcs = useMemo(() =>
    sortItems(filteredCcs, (cc, key) => {
      switch (key) {
        case 'name':   return cc.cost_center_name;
        case 'demand': return cc.total_demand_fte;
        case 'supply': return cc.total_supply_fte;
        case 'gap':
        default:       return cc.gap_fte;
      }
    }),
    [filteredCcs, sortItems]
  );

  const selectedCc = useMemo(() =>
    selectedCcId && dashboard
      ? dashboard.cost_centers.find(cc => (cc.cost_center_id ?? '__none__') === selectedCcId) ?? null
      : null,
    [selectedCcId, dashboard]
  );

  const overAllocsForSelected = useMemo(() =>
    selectedCc && dashboard
      ? dashboard.over_allocations.filter(oa =>
          (oa.cost_center_id ?? '__none__') === (selectedCc.cost_center_id ?? '__none__'))
      : [],
    [selectedCc, dashboard]
  );

  // ── Loading state ──
  if (loading) {
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1fr 1fr 1.4fr 1.1fr', gap: 12, marginBottom: 20 }}>
          {[1,2,3,4,5].map(i => (
            <Skeleton key={i} style={{ height: 90, borderRadius: 10 }}>
              <SkeletonItem style={{ height: '100%', borderRadius: 10 }} />
            </Skeleton>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, minHeight: 480 }}>
          <Skeleton style={{ height: 400, borderRadius: 10 }}>
            <SkeletonItem style={{ height: '100%', borderRadius: 10 }} />
          </Skeleton>
          <Skeleton style={{ height: 400, borderRadius: 10 }}>
            <SkeletonItem style={{ height: '100%', borderRadius: 10 }} />
          </Skeleton>
        </div>
      </>
    );
  }

  if (!dashboard) {
    return (
      <div style={{ padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalL}`, textAlign: 'center', color: C.ink3 }}>
        <Body1>No planning data available. Select a period to view the overview.</Body1>
      </div>
    );
  }

  return (
    <>
      {/* KPI row */}
      {filteredSummary && (
        <KpiCards summary={filteredSummary} costCenters={projectFilteredCcs} />
      )}

      {/* Alert banner */}
      {filteredSummary && (
        <AlertBanner
          summary={filteredSummary}
          costCenters={projectFilteredCcs}
          showIssuesOnly={showIssuesOnly}
          onToggleIssues={() => { setShowIssuesOnly(v => !v); setSelectedCcId(null); }}
        />
      )}

      {/* Workspace grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, minHeight: 500, alignItems: 'start' }}>

        {/* Left: CC Navigator */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderRight: `1px solid ${C.line}`, paddingRight: 16 }}>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>Cost Centers</span>
            <span style={{ fontSize: 12, color: C.ink3 }}>{sortedCcs.length}</span>
          </div>

          {/* Search */}
          <Input
            contentBefore={<SearchRegular />}
            placeholder="Search cost centers..."
            value={search}
            onChange={(_, d) => setSearch(d.value)}
            size="small"
          />

          {/* Sort segmented control */}
          <div style={{ display: 'flex', gap: 3, backgroundColor: C.surface2, borderRadius: 8, padding: 3 }}>
            {SORT_OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => handleSortClick(opt.key)}
                style={{
                  flex: 1, padding: '4px 0', borderRadius: 6,
                  border: 'none',
                  backgroundColor: sort === opt.key ? C.surface : 'transparent',
                  boxShadow: sort === opt.key ? '0 1px 3px rgba(0,0,0,.10)' : 'none',
                  color: sort === opt.key ? C.accent : C.ink3,
                  fontSize: 11, fontWeight: sort === opt.key ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.12s',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* CC list */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            maxHeight: 'calc(100vh - 440px)',
            minHeight: 200,
          }}>
            {sortedCcs.length === 0 ? (
              <Body1 style={{ color: C.ink3, padding: '12px 0', fontSize: 13 }}>
                No cost centers match the current filter.
              </Body1>
            ) : sortedCcs.map(cc => {
              const ccKey = cc.cost_center_id ?? '__none__';
              return (
                <CcNavCard
                  key={ccKey}
                  cc={cc}
                  selected={selectedCcId === ccKey}
                  onClick={() => setSelectedCcId(ccKey)}
                />
              );
            })}
          </div>
        </div>

        {/* Right: detail panel */}
        <div style={{
          borderRadius: 10,
          border: `1px solid ${C.line}`,
          overflow: 'hidden',
          backgroundColor: C.surface,
          minHeight: 500,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {selectedCc ? (
            <CcDetailPanel
              cc={selectedCc}
              overAllocs={overAllocsForSelected}
              onResourceClick={handleResourceClick}
              showIssuesOnly={showIssuesOnly}
            />
          ) : (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 10, color: C.ink3, padding: 32,
            }}>
              <BuildingRegular style={{ fontSize: 40, color: C.line }} />
              <Body1 style={{ color: C.ink3 }}>Select a cost center to view details.</Body1>
            </div>
          )}
        </div>
      </div>

      {/* Resource detail modal — unchanged, keeps full CRUD */}
      <ResourceDetailModal
        open={drillOpen}
        resourceId={drillResourceId}
        resourceName={drillResourceName}
        ccName={drillCcName}
        detail={resourceDetail}
        loading={resourceDetailLoading}
        periodId={dashboard?.period_id ?? null}
        canEditDemand={canEditDemand}
        canEditSupply={canEditSupply}
        isPM={isPM}
        onClose={() => setDrillOpen(false)}
        onDataChanged={() => onDashboardChanged?.()}
      />
    </>
  );
}
