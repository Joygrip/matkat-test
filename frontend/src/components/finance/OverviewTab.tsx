import { useState, useMemo, useEffect } from 'react';
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
  DismissRegular,
  ChevronDownRegular,
} from '@fluentui/react-icons';
import type {
  ConsolidationDashboard,
  DashboardCostCenter,
  DashboardResource,
  OverAllocation,
  ResourceDetail,
} from '../../api/consolidation';
import { consolidationApi } from '../../api/consolidation';
import { lookupsApi } from '../../api/lookups';
import type { Project } from '../../api/lookups';
import { getInitials } from '../../utils/avatar';
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
  isOwnCc,
  isDelegatedCc,
  onClick,
}: {
  cc: DashboardCostCenter;
  selected: boolean;
  isOwnCc?: boolean;
  isDelegatedCc?: boolean;
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
            {isOwnCc && (
              <span style={{
                display: 'inline-block', marginLeft: 6,
                fontSize: 9, fontWeight: 700,
                padding: '1px 5px', borderRadius: 3,
                backgroundColor: '#e6f0fb', color: '#1e3a5f',
                border: '1px solid #c5d9f1',
                verticalAlign: 'middle',
              }}>
                ★ My CC
              </span>
            )}
            {isDelegatedCc && (
              <span style={{
                display: 'inline-block', marginLeft: 6,
                fontSize: 9, fontWeight: 700,
                padding: '1px 5px', borderRadius: 3,
                backgroundColor: '#f3eeff', color: '#6b4eb8',
                border: '1px solid #d4c8f0',
                verticalAlign: 'middle',
              }}>
                Delegated
              </span>
            )}
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
  const initials = getInitials(resource.resource_name, resource.initials);
  const COLS = 'minmax(200px,1.6fr) 80px 80px minmax(160px,1.8fr) 96px 124px';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={e => e.key === 'Enter' && onEdit()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        alignItems: 'center',
        borderBottom: `1px solid ${C.line}`,
        borderLeft: `3px solid ${sev !== 'good' && sev !== 'neutral' ? sevC.bar : 'transparent'}`,
        backgroundColor: hovered ? '#fbfaf6' : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.1s',
        outline: 'none',
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
  const COLS = 'minmax(200px,1.6fr) 80px 80px minmax(160px,1.8fr) 96px 124px';
  const COL_HDRS = ['Resource', 'Demand', 'Supply', 'Demand vs Supply', 'Gap', 'Status'];

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
  /** When set (PM scope), restricts the project dropdown and CC navigator to these project IDs */
  scopeProjectIds?: string[];
  onDashboardChanged?: () => void;
  /** Reader scope: the reader's own CC ID. Enables supply editing only for that CC and shows a "My CC" indicator. */
  readerOwnCcId?: string;
  /** Manager scope: the manager's own CC ID. Shows "My CC" on their CC; other CCs in scope show "Delegated". */
  managerOwnCcId?: string;
  /** Manager scope: explicit set of delegated CC IDs. When provided, only CCs in this set get the "Delegated" label. */
  delegatedCcIds?: Set<string>;
}

type CcSortKey = 'gap' | 'name' | 'demand' | 'supply';

const SORT_OPTIONS: { key: CcSortKey; label: string }[] = [
  { key: 'gap',    label: 'Severity' },
  { key: 'name',   label: 'Name'     },
  { key: 'demand', label: 'Demand'   },
];

export function OverviewTab({ dashboard, loading, projectId, scopeProjectIds, onDashboardChanged, readerOwnCcId, managerOwnCcId, delegatedCcIds }: OverviewTabProps) {
  const canEditDemand = useHasRole('Finance', 'PM');
  const canEditSupply = useHasRole('Finance', 'Manager');
  const isPM          = useHasRole('PM');

  const [showIssuesOnly, setShowIssuesOnly] = useState(false);
  const [selectedCcId,  setSelectedCcId]  = useState<string | null>(null);
  const [search,        setSearch]        = useState('');
  const [selectedProjectIds,  setSelectedProjectIds]  = useState<string[]>([]);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [projectsData,        setProjectsData]        = useState<Project[]>([]);
  const [drillOpen,     setDrillOpen]     = useState(false);
  const [drillResourceId,       setDrillResourceId]       = useState<string | null>(null);
  const [drillResourceName,     setDrillResourceName]     = useState('');
  const [drillResourceInitials, setDrillResourceInitials] = useState<string | null>(null);
  const [drillCcName,           setDrillCcName]           = useState('');
  const [resourceDetail,        setResourceDetail]        = useState<ResourceDetail | null>(null);
  const [resourceDetailLoading, setResourceDetailLoading] = useState(false);

  const [sortBy, setSortBy] = useState<CcSortKey>('gap');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // When reader scope: supply editing is allowed only for the reader's own CC.
  // Demand editing is already blocked by role (reader is not Finance/PM).
  const effectiveCanEditSupply = canEditSupply && (!readerOwnCcId || selectedCcId === readerOwnCcId);

  const handleSortClick = (key: CcSortKey) => {
    if (sortBy === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setSortDir(key === 'demand' ? 'desc' : 'asc');
    }
  };

  useEffect(() => {
    lookupsApi.listProjects().then(setProjectsData).catch(() => {/* non-critical */});
  }, []);

  const handleResourceClick = async (resource: DashboardResource) => {
    if (!dashboard) return;
    // Capture the currently selected CC name for the modal subtitle
    const currentCc = selectedCcId
      ? dashboard.cost_centers.find(cc => (cc.cost_center_id ?? '__none__') === selectedCcId)
      : null;
    setDrillResourceId(resource.resource_id);
    setDrillResourceName(resource.resource_name);
    setDrillResourceInitials(resource.initials ?? null);
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

  // Cost centers scoped to the external projectId prop (Finance toolbar / scope).
  const externalProjectCcs = useMemo(() => {
    if (!dashboard) return [];
    if (!projectId) return dashboard.cost_centers;
    return dashboard.cost_centers.filter(cc => cc.project_ids.includes(projectId));
  }, [dashboard, projectId]);

  // Projects that appear in the current scope, with names and codes from the lookup table.
  const allProjects = useMemo(() => {
    // Collect all project IDs referenced by the scoped cost centers.
    const scopedIds = new Set<string>();
    for (const cc of externalProjectCcs) {
      for (const pid of cc.project_ids) scopedIds.add(pid);
    }
    // When PM scope is active, restrict the dropdown to only the PM's assigned projects.
    // A CC can be included because it touches any one of PM's projects, but may also have
    // other projects that the PM should not be able to filter on.
    const displayIds = scopeProjectIds?.length
      ? new Set([...scopedIds].filter(id => scopeProjectIds!.includes(id)))
      : scopedIds;
    // Build lookup by project.id from the fetched list.
    const byId = new Map(projectsData.map(p => [p.id, p]));
    // Fall back to placeholder-sourced names for any IDs not in the lookup (e.g. auth-limited scope).
    const placeholderNames = new Map<string, string>();
    for (const cc of externalProjectCcs) {
      for (const ph of cc.placeholders) {
        if (!placeholderNames.has(ph.project_id)) placeholderNames.set(ph.project_id, ph.project_name);
      }
    }
    return Array.from(displayIds)
      .map(pid => {
        const p = byId.get(pid);
        if (p) {
          const label = p.code ? `${p.name} (${p.code})` : p.name;
          return { project_id: pid, project_name: label };
        }
        const fallbackName = placeholderNames.get(pid);
        if (fallbackName) return { project_id: pid, project_name: fallbackName };
        return null; // skip IDs with no resolvable name
      })
      .filter((x): x is { project_id: string; project_name: string } => x !== null)
      .sort((a, b) => a.project_name.localeCompare(b.project_name));
  }, [externalProjectCcs, projectsData, scopeProjectIds]);

  // Apply the internal project filter (sidebar dropdown) on top of the external scope.
  // When projects are selected, rebuild resource aggregates from project_allocations so that
  // demand/supply/gap reflect only the selected-project lines — not org-wide totals.
  const projectFilteredCcs = useMemo((): DashboardCostCenter[] => {
    if (!selectedProjectIds.length) return externalProjectCcs;
    const idSet = new Set(selectedProjectIds);

    return externalProjectCcs
      .map((cc): DashboardCostCenter | null => {
        const scopedPlaceholders = cc.placeholders.filter(ph => idSet.has(ph.project_id));

        const scopedResources = cc.resources
          .map((r): DashboardResource | null => {
            // Fall back to including the resource as-is when no line-level breakdown is available.
            if (!r.project_allocations?.length) return r;
            const relevant = r.project_allocations.filter(
              pa => pa.project_id !== null && idSet.has(pa.project_id)
            );
            const scopedDemand = relevant.reduce((s, pa) => s + pa.demand_fte, 0);
            const scopedSupply = relevant.reduce((s, pa) => s + pa.supply_fte, 0);
            if (scopedDemand === 0 && scopedSupply === 0) return null;
            const scopedGap = scopedSupply - scopedDemand;
            return {
              ...r,
              demand_fte: scopedDemand,
              supply_fte: scopedSupply,
              gap_fte: scopedGap,
              status: scopedGap < 0 ? 'under' : scopedGap > 0 ? 'over' : 'balanced',
            };
          })
          .filter((r): r is DashboardResource => r !== null);

        if (scopedResources.length === 0 && scopedPlaceholders.length === 0) return null;

        const resDemand   = scopedResources.reduce((s, r) => s + r.demand_fte, 0);
        const resSupply   = scopedResources.reduce((s, r) => s + r.supply_fte, 0);
        const phDemand    = scopedPlaceholders.reduce((s, ph) => s + ph.demand_fte, 0);
        const totalDemand = resDemand + phDemand;
        return {
          ...cc,
          resources: scopedResources,
          placeholders: scopedPlaceholders,
          total_demand_fte: totalDemand,
          total_supply_fte: resSupply,
          gap_fte: resSupply - totalDemand,
        };
      })
      .filter((cc): cc is DashboardCostCenter => cc !== null);
  }, [externalProjectCcs, selectedProjectIds]);

  // Derive over-allocations from filtered CC data so a resource whose project-scoped demand
  // is ≤ 100% is not flagged even if their org-wide total exceeds 100%.
  const filteredOverAllocs = useMemo((): OverAllocation[] => {
    if (!dashboard) return [];
    if (!selectedProjectIds.length && !projectId) return dashboard.over_allocations;
    return projectFilteredCcs.flatMap(cc =>
      cc.resources
        .filter(r => r.demand_fte > 100)
        .map(r => ({
          resource_id: r.resource_id,
          resource_name: r.resource_name,
          cost_center_id: cc.cost_center_id ?? undefined,
          cost_center_name: cc.cost_center_name,
          total_demand_fte: r.demand_fte,
        }))
    );
  }, [dashboard, projectId, projectFilteredCcs, selectedProjectIds]);

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
      ccs = ccs.filter(cc => {
        if (cc.cost_center_name.toLowerCase().includes(q)) return true;
        return cc.resources.some(r =>
          r.resource_name.toLowerCase().includes(q) ||
          getInitials(r.resource_name, r.initials).toLowerCase().includes(q)
        );
      });
    }
    return ccs;
  }, [dashboard, showIssuesOnly, search, projectFilteredCcs, filteredOverAllocs]);

  const sortedCcs = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filteredCcs].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name':   cmp = a.cost_center_name.localeCompare(b.cost_center_name); break;
        case 'demand': cmp = a.total_demand_fte - b.total_demand_fte; break;
        case 'supply': cmp = a.total_supply_fte - b.total_supply_fte; break;
        case 'gap':
        default:       cmp = a.gap_fte - b.gap_fte; break;
      }
      return cmp * dir;
    });
  }, [filteredCcs, sortBy, sortDir]);

  const selectedCc = useMemo(() =>
    selectedCcId
      ? projectFilteredCcs.find(cc => (cc.cost_center_id ?? '__none__') === selectedCcId) ?? null
      : null,
    [selectedCcId, projectFilteredCcs]
  );

  const overAllocsForSelected = useMemo(() =>
    selectedCc
      ? filteredOverAllocs.filter(oa =>
          (oa.cost_center_id ?? '__none__') === (selectedCc.cost_center_id ?? '__none__'))
      : [],
    [selectedCc, filteredOverAllocs]
  );

  // When search or project filter is active and the current CC is filtered out, select the first visible result.
  useEffect(() => {
    if (!search.trim() && !selectedProjectIds.length) return;
    if (!sortedCcs.length) return;
    setSelectedCcId(prev => {
      if (prev && sortedCcs.some(cc => (cc.cost_center_id ?? '__none__') === prev)) return prev;
      return sortedCcs[0].cost_center_id ?? '__none__';
    });
  }, [sortedCcs, search, selectedProjectIds]);

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
            contentAfter={search ? (
              <button
                onClick={() => setSearch('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
              >
                <DismissRegular style={{ fontSize: 12, color: C.ink3 }} />
              </button>
            ) : undefined}
            placeholder="Search cost centers, employees, initials..."
            value={search}
            onChange={(_, d) => setSearch(d.value)}
            size="small"
          />

          {/* Project filter */}
          {allProjects.length > 0 && (
            <div style={{ position: 'relative' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.ink3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                PROJECT{selectedProjectIds.length > 0 ? ` (${selectedProjectIds.length})` : ''}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => setProjectDropdownOpen(v => !v)}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 12px', border: `1px solid ${selectedProjectIds.length > 0 ? C.accent : C.line}`,
                    borderRadius: 6, backgroundColor: C.surface, fontSize: 13, cursor: 'pointer',
                    color: selectedProjectIds.length > 0 ? C.ink : C.ink3,
                    fontWeight: selectedProjectIds.length > 0 ? 500 : 400,
                    outline: 'none',
                  }}
                >
                  <span>{selectedProjectIds.length === 0 ? 'All projects' : `${selectedProjectIds.length} project${selectedProjectIds.length !== 1 ? 's' : ''} selected`}</span>
                  <ChevronDownRegular style={{
                    fontSize: 12, color: C.ink3, marginLeft: 4, flexShrink: 0,
                    transform: projectDropdownOpen ? 'rotate(180deg)' : undefined,
                    transition: 'transform 0.12s',
                  }} />
                </button>
                {selectedProjectIds.length > 0 && (
                  <button
                    onClick={() => setSelectedProjectIds([])}
                    title="Clear project filter"
                    style={{ padding: '7px 9px', border: `1px solid ${C.line}`, borderRadius: 6, backgroundColor: C.surface, cursor: 'pointer', display: 'flex', alignItems: 'center', outline: 'none' }}
                  >
                    <DismissRegular style={{ fontSize: 12, color: C.ink3 }} />
                  </button>
                )}
              </div>
              {projectDropdownOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setProjectDropdownOpen(false)} />
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, zIndex: 100,
                    backgroundColor: C.surface, border: `1px solid ${C.line}`, borderRadius: 8,
                    boxShadow: '0 4px 16px rgba(0,0,0,.12)', maxHeight: 220, overflowY: 'auto',
                    padding: '4px 0',
                  }}>
                    {allProjects.map(p => {
                      const checked = selectedProjectIds.includes(p.project_id);
                      return (
                        <div
                          key={p.project_id}
                          role="checkbox"
                          aria-checked={checked}
                          tabIndex={0}
                          onClick={() => setSelectedProjectIds(prev =>
                            checked ? prev.filter(id => id !== p.project_id) : [...prev, p.project_id]
                          )}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedProjectIds(prev =>
                                checked ? prev.filter(id => id !== p.project_id) : [...prev, p.project_id]
                              );
                            }
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '7px 12px', cursor: 'pointer', fontSize: 13,
                            backgroundColor: checked ? `${C.accent}0d` : 'transparent',
                            color: C.ink, userSelect: 'none',
                          }}
                        >
                          <div style={{
                            width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                            border: `1.5px solid ${checked ? C.accent : '#bbb'}`,
                            backgroundColor: checked ? C.accent : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {checked && <div style={{ width: 6, height: 6, backgroundColor: C.surface, borderRadius: 1 }} />}
                          </div>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {p.project_name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Sort segmented control */}
          <div style={{ display: 'flex', gap: 3, backgroundColor: C.surface2, borderRadius: 8, padding: 3 }}>
            {SORT_OPTIONS.map(opt => {
              const active = sortBy === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => handleSortClick(opt.key)}
                  style={{
                    flex: 1, padding: '4px 0', borderRadius: 6,
                    border: 'none',
                    backgroundColor: active ? C.surface : 'transparent',
                    boxShadow: active ? '0 1px 3px rgba(0,0,0,.10)' : 'none',
                    color: active ? C.accent : C.ink3,
                    fontSize: 11, fontWeight: active ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                >
                  {opt.label}
                  {active && (
                    <span style={{ marginLeft: 3, color: C.ink3 }}>
                      {sortDir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </button>
              );
            })}
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
                  isOwnCc={
                    readerOwnCcId ? ccKey === readerOwnCcId :
                    managerOwnCcId ? ccKey === managerOwnCcId :
                    false
                  }
                  isDelegatedCc={delegatedCcIds ? delegatedCcIds.has(ccKey) : (!!managerOwnCcId && ccKey !== managerOwnCcId)}
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

      {/* Resource detail modal */}
      <ResourceDetailModal
        open={drillOpen}
        resourceId={drillResourceId}
        resourceName={drillResourceName}
        resourceInitials={drillResourceInitials}
        ccName={drillCcName}
        detail={resourceDetail}
        loading={resourceDetailLoading}
        periodId={dashboard?.period_id ?? null}
        canEditDemand={canEditDemand}
        canEditSupply={effectiveCanEditSupply}
        isPM={isPM}
        scopeProjectIds={scopeProjectIds}
        onClose={() => setDrillOpen(false)}
        onDataChanged={() => onDashboardChanged?.()}
      />
    </>
  );
}
