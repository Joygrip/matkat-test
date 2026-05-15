import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { makeStyles, tokens } from '@fluentui/react-components';
import { DashboardSection } from './DashboardSection';
import { FinanceOverview } from '../shared/FinanceOverview';
import { getConsolidatedCosts } from '../../api/finance';
import type { ConsolidatedCostResponse } from '../../api/finance';
import { useToast } from '../../hooks/useToast';
import type { DemandLine, SupplyLine } from '../../api/planning';
import type { CostCenter, Project } from '../../api/admin';
import type { Period, MeResponse } from '../../types/index';

// ─── constants ────────────────────────────────────────────────────────────────

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const C_BAD       = '#a32f2a';
const C_WARN      = '#9a5b00';
const C_GOOD      = '#2a6f4d';
const C_AMBER     = '#ca5010';
const C_GREEN     = '#107c10';
const C_PURPLE    = '#5b4892';
const C_OVER      = '#1e5fa0';
const C_OVER_SOFT = '#dbeaf6';
const C_BAD_SOFT  = '#fde7e9';
const C_WARN_SOFT = '#fff4e0';
const C_ACCENT    = '#1e3a5f';

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDKK(n: number): string {
  return Math.round(n).toLocaleString('da-DK');
}

function fmtCostShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return Math.round(n).toString();
}

function padNum(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// curVal  = the displayed "current" value (ep / trendData[0])
// refVal  = the reference value to compare against (last planned period)
// refPer  = the reference period, used for the "vs [month]" label
function fmtDelta(
  curVal: number,
  refVal: number,
  refPer: Period,
  higherIsBetter: boolean,
  fmtAbs: (v: number) => string,
): { text: string; color: string } {
  const diff = refVal - curVal;
  if (Math.abs(diff) < 0.001) return { text: `= vs ${MONTH_SHORT[refPer.month - 1]}`, color: '#999' };
  const up = diff > 0;
  return {
    text: `${up ? '▲' : '▼'} ${up ? '+' : '−'}${fmtAbs(Math.abs(diff))} vs ${MONTH_SHORT[refPer.month - 1]}`,
    color: (up === higherIsBetter) ? C_GOOD : C_BAD,
  };
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const W = 160; const H = 46;
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * W,
    H - 4 - ((v - min) / range) * (H - 12),
  ] as [number, number]);
  const lineStr = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaStr =
    `M${pts[0][0].toFixed(1)},${H} ` +
    pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
    ` L${pts[pts.length - 1][0].toFixed(1)},${H} Z`;
  const gradId = `sg${color.replace('#', '')}`;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg
      style={{ display: 'block', width: '100%', height: `${H}px` }}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaStr} fill={`url(#${gradId})`} />
      <polyline
        points={lineStr}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="2.5" fill={color} />
    </svg>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },

  // ── Executive Briefing card ───────────────────────────────────────────────
  briefCard: {
    display: 'flex',
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '10px',
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  briefAccent: {
    width: '4px',
    flexShrink: 0,
    alignSelf: 'stretch',
  },
  briefInner: {
    flex: 1,
    padding: '20px 24px',
    minWidth: 0,
  },
  briefHdrRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: '14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    gap: '16px',
    flexWrap: 'wrap',
  },
  briefTitle: {
    fontSize: '16px',
    fontWeight: '600' as unknown as 600,
    color: tokens.colorNeutralForeground1,
    flexShrink: 0,
  },
  briefStatsStrip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0,
    flexWrap: 'nowrap',
  },
  briefStatsVal: {
    fontSize: '14px',
    fontFamily: 'monospace',
    fontWeight: '600' as unknown as 600,
    color: tokens.colorNeutralForeground1,
  },
  briefStatsLbl: {
    fontSize: '14px',
    color: tokens.colorNeutralForeground3,
    marginLeft: '3px',
  },
  briefStatsDot: {
    fontSize: '14px',
    color: tokens.colorNeutralForeground3,
    margin: '0 6px',
  },
  briefBullets: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '16px 0',
  },
  briefBulletRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    fontSize: '15px',
    color: tokens.colorNeutralForeground2,
    lineHeight: '1.6',
  },
  briefBulletSq: {
    width: '10px',
    height: '10px',
    borderRadius: '2px',
    flexShrink: 0,
    marginTop: '5px',
  },
  briefSummary: {
    paddingTop: '14px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: '16px',
    fontWeight: '600' as unknown as 600,
    color: tokens.colorNeutralForeground1,
  },

  // ── Approvals banner ──────────────────────────────────────────────────────
  appBanner: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '8px',
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  appBannerAccent: {
    width: '4px',
    flexShrink: 0,
    alignSelf: 'stretch',
  },
  appBannerInner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
    padding: '12px 16px',
    gap: '12px',
  },
  appBannerText: {
    fontSize: '13px',
    fontWeight: '500' as unknown as 500,
    color: tokens.colorNeutralForeground1,
  },
  appBannerLink: {
    fontSize: '13px',
    fontWeight: '500' as unknown as 500,
    color: tokens.colorBrandForeground1,
    cursor: 'pointer',
    flexShrink: 0,
    background: 'none',
    border: 'none',
    padding: 0,
  },

  // ── 6-month trends card ───────────────────────────────────────────────────
  trendsCard: {
    display: 'flex',
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '10px',
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  trendsAccent: {
    width: '4px',
    flexShrink: 0,
    alignSelf: 'stretch',
    backgroundColor: C_OVER,
  },
  trendsInner: {
    flex: 1,
    minWidth: 0,
  },
  trendsHdr: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 18px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    gap: '12px',
  },
  trendsHdrLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  trendsHdrTitle: {
    fontSize: '14px',
    fontWeight: '600' as unknown as 600,
    color: tokens.colorNeutralForeground1,
  },
  trendsHdrSub: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
  },
  trendsHdrLink: {
    fontSize: '12px',
    fontWeight: '500' as unknown as 500,
    color: tokens.colorBrandForeground1,
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    flexShrink: 0,
  },
  trendsBody: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
  },
  trendsCell: {
    padding: '14px 18px',
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    '&:last-child': { borderRight: 'none' },
  },
  trendsCellLabel: {
    fontSize: '10px',
    fontWeight: '600' as unknown as 600,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '6px',
  },
  trendsCellValueRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '4px',
    marginBottom: '3px',
  },
  trendsCellValue: {
    fontSize: '22px',
    fontFamily: 'monospace',
    fontWeight: '600' as unknown as 600,
    color: tokens.colorNeutralForeground1,
    lineHeight: '1',
  },
  trendsCellUnit: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
  },
  trendsDelta: {
    fontSize: '11px',
    fontFamily: 'monospace',
    fontWeight: '600' as unknown as 600,
    marginBottom: '8px',
  },
  trendsInsufficient: {
    padding: '24px 18px',
    fontSize: '13px',
    color: tokens.colorNeutralForeground3,
    textAlign: 'center',
  },

  // ── Attention Needed card ─────────────────────────────────────────────────
  attnCard: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '10px',
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  attnCardHdr: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 18px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  attnCardHdrLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  attnCardTitle: {
    fontSize: '14px',
    fontWeight: '600' as unknown as 600,
    color: tokens.colorNeutralForeground1,
  },
  attnBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '20px',
    padding: '0 6px',
    borderRadius: '10px',
    fontSize: '11px',
    fontWeight: '600' as unknown as 600,
  },
  attnLegend: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  attnLegendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
  },
  attnSwatch: {
    width: '10px',
    height: '10px',
    borderRadius: '2px',
    flexShrink: 0,
  },
  attnBody: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
  },
  attnColRight: {
    borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  attnSubHdr: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 18px 8px',
  },
  attnSubLabel: {
    fontSize: '11px',
    fontWeight: '600' as unknown as 600,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  attnSubCount: {
    fontSize: '11px',
    fontFamily: 'monospace',
    color: tokens.colorNeutralForeground3,
  },
  attnRow: {
    display: 'grid',
    gridTemplateColumns: '18px 4px 1fr auto',
    gap: '10px',
    alignItems: 'center',
    padding: '9px 18px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground2,
    },
  },
  attnRowNum: {
    fontSize: '11px',
    fontFamily: 'monospace',
    color: tokens.colorNeutralForeground3,
    textAlign: 'right',
  },
  attnSevBar: {
    width: '4px',
    height: '24px',
    borderRadius: '2px',
    alignSelf: 'center',
  },
  attnRowContent: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  attnRowNameLine: {
    display: 'flex',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: '4px',
  },
  attnRowName: {
    fontSize: '14px',
    fontWeight: '600' as unknown as 600,
    color: tokens.colorNeutralForeground1,
  },
  attnRoleLabel: {
    fontSize: '11.5px',
    color: tokens.colorNeutralForeground3,
    fontWeight: '400' as unknown as 400,
  },
  attnRowDesc: {
    fontSize: '12.5px',
    color: tokens.colorNeutralForeground3,
    lineHeight: '1.4',
    marginTop: '1px',
  },
  attnChip: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 8px',
    borderRadius: '10px',
    fontSize: '12px',
    fontFamily: 'monospace',
    fontWeight: '600' as unknown as 600,
    whiteSpace: 'nowrap',
  },
  attnEmpty: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
    padding: '18px',
  },
  attnAllClear: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '10px',
    boxShadow: tokens.shadow2,
    padding: '16px 18px',
    fontSize: '13px',
    color: tokens.colorPaletteGreenForeground2,
    textAlign: 'center',
  },

});

// ─── types ────────────────────────────────────────────────────────────────────

interface Props {
  demandLines: DemandLine[];
  supplyLines: SupplyLine[];
  costCenters: CostCenter[];
  periods: Period[];
  approvalStatuses: Record<string, { status: string }>;
  projects: Project[];
  user: MeResponse;
  userCcId?: string | null;
}

interface CCAttentionItem {
  type: 'cc';
  id: string;
  globalNum: number;
  severity: 'crit' | 'med';
  name: string;
  resourceCount: number;
  gapPct: number;
  chipLabel: string;
}

interface ResAttentionItem {
  type: 'resource';
  id: string;
  globalNum: number;
  severity: 'high';
  name: string;
  ccName: string;
  demand: number;
  projectCount: number;
  chipLabel: string;
}

type AnyAttentionItem = CCAttentionItem | ResAttentionItem;

// ─── Component ────────────────────────────────────────────────────────────────

export function ReaderView({
  demandLines, supplyLines, costCenters, periods, approvalStatuses, userCcId,
}: Props) {
  const styles   = useStyles();
  const navigate = useNavigate();
  const { showApiError } = useToast();

  const [costs, setCosts] = useState<ConsolidatedCostResponse | null>(null);

  useEffect(() => {
    getConsolidatedCosts()
      .then(setCosts)
      .catch(err => showApiError(err as Error, 'Failed to load cost data'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Earliest open period ────────────────────────────────────────────────

  const ep = useMemo(
    () =>
      [...periods]
        .filter(p => p.status === 'open')
        .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)[0] ?? null,
    [periods],
  );

  const periodLabel = ep ? `${MONTH_SHORT[ep.month - 1]} ${ep.year}` : '';

  // ── Trend periods: first 6 open periods starting from ep (current) ────────
  // slice(0,6) so trendData[0] === ep, matching the briefing's data source.

  const trendPeriods = useMemo(
    () =>
      [...periods]
        .filter(p => p.status === 'open')
        .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
        .slice(0, 6),
    [periods],
  );

  // ── CC staffing gap summary ─────────────────────────────────────────────

  const { staffingGapCCs, worstCC } = useMemo(() => {
    if (!ep) return { staffingGapCCs: 0, worstCC: null as null | { cc: CostCenter; gapPct: number } };

    const gaps = costCenters.map(cc => {
      const demand = demandLines
        .filter(l => l.period_id === ep.id && l.cost_center_id === cc.id)
        .reduce((s, l) => s + l.fte_percent, 0);
      const supply = supplyLines
        .filter(l => l.period_id === ep.id && l.cost_center_id === cc.id)
        .reduce((s, l) => s + l.fte_percent, 0);
      return { cc, gapPct: demand > 0 ? ((supply - demand) / demand) * 100 : 0, hasDemand: demand > 0 };
    }).filter(g => g.hasDemand);

    const negGaps = gaps.filter(g => g.gapPct < 0);
    const worst   = negGaps.length > 0 ? negGaps.reduce((a, b) => a.gapPct < b.gapPct ? a : b) : null;
    return { staffingGapCCs: negGaps.length, worstCC: worst };
  }, [ep, costCenters, demandLines, supplyLines]);

  // ── Approval stats ──────────────────────────────────────────────────────

  const approvalStats = useMemo(() => {
    const entries    = Object.entries(approvalStatuses);
    const approved   = entries.filter(([, s]) => s.status === 'approved').length;
    const pending    = entries.filter(([, s]) => s.status === 'pending').length;
    const submitted  = approved + pending;
    const approvalKeys = new Set(Object.keys(approvalStatuses));
    const resourcesWithDemand = ep
      ? new Set(demandLines.filter(d => d.period_id === ep.id && d.resource_id).map(d => d.resource_id!))
      : new Set<string>();
    const missing = [...resourcesWithDemand].filter(id => !approvalKeys.has(id)).length;
    const total   = submitted + missing;
    const pct     = total > 0 ? Math.round((approved / total) * 100) : null;
    return { approvedCount: approved, pendingCount: pending, missingCount: missing, submitted, total, submissionPct: pct };
  }, [approvalStatuses, ep, demandLines]);

  // ── Budget ──────────────────────────────────────────────────────────────

  const { plannedCost, actualCost } = useMemo(() => {
    if (!costs || !ep) return { plannedCost: 0, actualCost: 0 };
    const rows = costs.data.filter(r => r.year === ep.year && r.month === ep.month);
    return {
      plannedCost: rows.reduce((s, r) => s + r.demand_cost, 0),
      actualCost:  rows.reduce((s, r) => s + r.actuals_cost, 0),
    };
  }, [costs, ep]);

  // ── Resource headcount + avg utilization ───────────────────────────────

  const { totalFTE, avgUtil } = useMemo(() => {
    if (!ep) return { totalFTE: 0, avgUtil: 0 };
    const resourceIds = new Set<string>();
    demandLines.filter(l => l.period_id === ep.id && l.resource_id).forEach(l => resourceIds.add(l.resource_id!));
    supplyLines.filter(l => l.period_id === ep.id).forEach(l => resourceIds.add(l.resource_id));
    const supplyMap = new Map<string, number>();
    supplyLines.filter(l => l.period_id === ep.id).forEach(l => {
      supplyMap.set(l.resource_id, (supplyMap.get(l.resource_id) ?? 0) + l.fte_percent);
    });
    let totalSupplySum = 0;
    resourceIds.forEach(id => { totalSupplySum += supplyMap.get(id) ?? 0; });
    const total = resourceIds.size;
    return { totalFTE: total, avgUtil: total > 0 ? Math.round(totalSupplySum / total) : 0 };
  }, [ep, demandLines, supplyLines]);

  // ── Active cost centers ─────────────────────────────────────────────────

  const activeCCCount = useMemo(() =>
    ep
      ? costCenters.filter(cc => demandLines.some(d => d.period_id === ep.id && d.cost_center_id === cc.id)).length
      : costCenters.length,
    [ep, costCenters, demandLines],
  );

  // ── My cost center ──────────────────────────────────────────────────────

  const myCcId = userCcId ?? null;
  const myCc   = costCenters.find(cc => cc.id === myCcId) ?? null;

  // ── 6-month trend data ──────────────────────────────────────────────────

  const trendData = useMemo(() => {
    const rows = trendPeriods.map(p => {
    const resIds = new Set<string>();
    demandLines.filter(l => l.period_id === p.id && l.resource_id).forEach(l => resIds.add(l.resource_id!));
    supplyLines.filter(l => l.period_id === p.id).forEach(l => resIds.add(l.resource_id));

    const supplyByRes = new Map<string, number>();
    supplyLines.filter(l => l.period_id === p.id).forEach(l => {
      supplyByRes.set(l.resource_id, (supplyByRes.get(l.resource_id) ?? 0) + l.fte_percent);
    });

    const totalSupplyPct  = Array.from(supplyByRes.values()).reduce((s, v) => s + v, 0);
    const totalDemandPct  = demandLines.filter(l => l.period_id === p.id).reduce((s, l) => s + l.fte_percent, 0);
    const headcount       = resIds.size;
    const periodAvgUtil   = headcount > 0 ? Math.round(totalSupplyPct / headcount) : 0;
    const netGapFTE       = (totalSupplyPct - totalDemandPct) / 100;
    const costRows        = costs?.data.filter(r => r.year === p.year && r.month === p.month) ?? [];
    const totalCost       = costRows.reduce((s, r) => s + r.demand_cost, 0);

      return { period: p, headcount, avgUtil: periodAvgUtil, netGapFTE, totalCost };
    });
    // eslint-disable-next-line no-console
    console.log('[ReaderView] trendData', rows.map(r => ({ period: `${r.period.year}-${r.period.month}`, headcount: r.headcount, avgUtil: r.avgUtil, netGapFTE: r.netGapFTE, totalCost: r.totalCost })));
    return rows;
  }, [trendPeriods, demandLines, supplyLines, costs]);

  // ── Attention items ─────────────────────────────────────────────────────

  const { ccAttentionItems, resAttentionItems, totalAttentionCount } = useMemo(() => {
    if (!ep) return { ccAttentionItems: [] as CCAttentionItem[], resAttentionItems: [] as ResAttentionItem[], totalAttentionCount: 0 };

    type RawCC  = Omit<CCAttentionItem, 'globalNum'>;
    type RawRes = Omit<ResAttentionItem, 'globalNum'>;

    const ccRaw: RawCC[] = [];
    costCenters.forEach(cc => {
      const demand = demandLines.filter(l => l.period_id === ep.id && l.cost_center_id === cc.id).reduce((s, l) => s + l.fte_percent, 0);
      if (demand === 0) return;
      const supply  = supplyLines.filter(l => l.period_id === ep.id && l.cost_center_id === cc.id).reduce((s, l) => s + l.fte_percent, 0);
      const gapPct  = ((supply - demand) / demand) * 100;
      const resIds  = new Set<string>([
        ...demandLines.filter(d => d.period_id === ep.id && d.cost_center_id === cc.id && d.resource_id).map(d => d.resource_id!),
        ...supplyLines.filter(s => s.period_id === ep.id && s.cost_center_id === cc.id).map(s => s.resource_id),
      ]);
      if (gapPct < -10)
        ccRaw.push({ type: 'cc', id: `cc-crit-${cc.id}`, severity: 'crit', name: cc.name, resourceCount: resIds.size, gapPct, chipLabel: `${Math.round(gapPct)}%` });
      else if (gapPct > 20)
        ccRaw.push({ type: 'cc', id: `cc-med-${cc.id}`, severity: 'med',  name: cc.name, resourceCount: resIds.size, gapPct, chipLabel: `+${Math.round(gapPct)}%` });
    });

    const resMap = new Map<string, { name: string; demand: number; projects: Set<string>; ccId: string }>();
    demandLines.filter(d => d.period_id === ep.id && d.resource_id).forEach(d => {
      const ex = resMap.get(d.resource_id!);
      if (ex) { ex.demand += d.fte_percent; ex.projects.add(d.project_id); }
      else    resMap.set(d.resource_id!, { name: d.resource_name ?? d.resource_id!, demand: d.fte_percent, projects: new Set([d.project_id]), ccId: d.cost_center_id ?? '' });
    });

    const supplyCC = new Map<string, string>();
    supplyLines.filter(s => s.period_id === ep.id).forEach(s => { if (s.cost_center_id) supplyCC.set(s.resource_id, s.cost_center_id); });

    const resRaw: RawRes[] = [];
    resMap.forEach((r, id) => {
      if (r.demand > 120) {
        const cc = costCenters.find(c => c.id === (supplyCC.get(id) ?? r.ccId));
        resRaw.push({ type: 'resource', id: `res-over-${id}`, severity: 'high', name: r.name, ccName: cc?.name ?? '', demand: r.demand, projectCount: r.projects.size, chipLabel: `${Math.round(r.demand)}%` });
      }
    });

    const allSorted = [
      ...ccRaw.filter(i => i.severity === 'crit').sort((a, b) => a.gapPct - b.gapPct),
      ...resRaw.sort((a, b) => b.demand - a.demand),
      ...ccRaw.filter(i => i.severity === 'med').sort((a, b) => b.gapPct - a.gapPct),
    ].slice(0, 6) as (RawCC | RawRes)[];

    const numbered = allSorted.map((item, idx) => ({ ...item, globalNum: idx + 1 })) as AnyAttentionItem[];
    return {
      ccAttentionItems:    numbered.filter((i): i is CCAttentionItem  => i.type === 'cc'),
      resAttentionItems:   numbered.filter((i): i is ResAttentionItem => i.type === 'resource'),
      totalAttentionCount: numbered.length,
    };
  }, [ep, costCenters, demandLines, supplyLines]);

  // ── Derived ─────────────────────────────────────────────────────────────

  const spentPct    = plannedCost > 0 ? Math.round((actualCost / plannedCost) * 100) : 0;
  const accentColor = staffingGapCCs > 0 ? C_BAD : (approvalStats.pendingCount > 0 || approvalStats.missingCount > 0) ? C_WARN : C_GOOD;
  const summaryText = staffingGapCCs > 0
    ? 'Focus needed on staffing gaps.'
    : (approvalStats.submissionPct !== null && approvalStats.submissionPct < 60)
    ? 'Focus needed on actuals completion.'
    : actualCost > plannedCost * 1.1
    ? 'Budget variance requires attention.'
    : 'Organization on track. No critical issues.';

  // ── Trend spark values ──────────────────────────────────────────────────

  // trendData[0] = ep (current, full data)  trendData[last] = furthest planned period
  const displayTrend    = trendData[0] ?? null;
  const refTrend        = trendData[trendData.length - 1] ?? null;
  const sparkCostVals   = trendData.map(d => d.totalCost);
  const sparkHcVals     = trendData.map(d => d.headcount);
  const sparkUtilVals   = trendData.map(d => d.avgUtil);
  const sparkGapVals    = trendData.map(d => d.netGapFTE);

  const enoughTrendData = trendData.length >= 3;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className={styles.root}>

      {/* ── Section 1: Executive Briefing ── */}
      <div className={styles.briefCard}>
        <div className={styles.briefAccent} style={{ backgroundColor: accentColor }} />
        <div className={styles.briefInner}>

          {/* Header row */}
          <div className={styles.briefHdrRow}>
            <span className={styles.briefTitle}>
              Executive Briefing{periodLabel ? ` · ${periodLabel}` : ''}
            </span>
            <div className={styles.briefStatsStrip}>
              <span className={styles.briefStatsVal}>{totalFTE}</span>
              <span className={styles.briefStatsLbl}> people</span>
              <span className={styles.briefStatsDot}>·</span>
              <span className={styles.briefStatsVal}>{activeCCCount}</span>
              <span className={styles.briefStatsLbl}> cost centers</span>
              <span className={styles.briefStatsDot}>·</span>
              <span className={styles.briefStatsVal}>{avgUtil}%</span>
              <span className={styles.briefStatsLbl}> utilization</span>
              <span className={styles.briefStatsDot}>·</span>
              <span className={styles.briefStatsVal}>{approvalStats.submitted}/{approvalStats.total}</span>
              <span className={styles.briefStatsLbl}> submitted</span>
              <span className={styles.briefStatsDot}>·</span>
              <span className={styles.briefStatsVal}>{approvalStats.approvedCount}</span>
              <span className={styles.briefStatsLbl}> approved</span>
            </div>
          </div>

          {/* Narrative bullets */}
          <div className={styles.briefBullets}>
            {staffingGapCCs > 0 && worstCC && (
              <div className={styles.briefBulletRow}>
                <span className={styles.briefBulletSq} style={{ backgroundColor: C_BAD }} />
                <span>
                  Staffing gaps in{' '}
                  <strong style={{ fontFamily: 'monospace' }}>{staffingGapCCs}</strong>
                  {' '}cost center{staffingGapCCs !== 1 ? 's' : ''}.{' '}
                  <strong>{worstCC.cc.name}</strong> has the largest gap at{' '}
                  <strong style={{ fontFamily: 'monospace' }}>{Math.round(worstCC.gapPct)}%</strong>.
                </span>
              </div>
            )}
            <div className={styles.briefBulletRow}>
              <span className={styles.briefBulletSq} style={{ backgroundColor: C_WARN }} />
              <span>
                <strong style={{ fontFamily: 'monospace' }}>
                  {approvalStats.submissionPct !== null ? `${approvalStats.submissionPct}%` : '0%'}
                </strong>{' '}
                approved:{' '}
                <strong style={{ fontFamily: 'monospace' }}>{approvalStats.approvedCount}</strong> approved,{' '}
                <strong style={{ fontFamily: 'monospace' }}>{approvalStats.pendingCount}</strong> pending,{' '}
                <strong style={{ fontFamily: 'monospace' }}>{approvalStats.missingCount}</strong> missing.
              </span>
            </div>
            <div className={styles.briefBulletRow}>
              <span className={styles.briefBulletSq} style={{ backgroundColor: C_GOOD }} />
              <span>
                {actualCost === 0 ? (
                  <>
                    <strong style={{ fontFamily: 'monospace' }}>{formatDKK(plannedCost)} kr.</strong> planned. Awaiting actuals.
                  </>
                ) : (
                  <>
                    <strong style={{ fontFamily: 'monospace' }}>{formatDKK(plannedCost)} kr.</strong> planned,{' '}
                    <strong style={{ fontFamily: 'monospace' }}>{formatDKK(actualCost)} kr.</strong> actual{' '}
                    (<strong style={{ fontFamily: 'monospace' }}>{spentPct}%</strong> spent).
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Summary line */}
          <div className={styles.briefSummary}>{summaryText}</div>

        </div>
      </div>

      {/* ── Section 2: Pending Approvals banner ── */}
      <div className={styles.appBanner}>
        <div
          className={styles.appBannerAccent}
          style={{ backgroundColor: approvalStats.pendingCount > 0 ? C_PURPLE : C_GREEN }}
        />
        <div className={styles.appBannerInner}>
          <span className={styles.appBannerText}>
            {approvalStats.pendingCount > 0
              ? `${approvalStats.pendingCount} pending approval${approvalStats.pendingCount !== 1 ? 's' : ''}${myCc ? ` in ${myCc.name}` : ''}`
              : `All approvals complete ✓${myCc ? ` — ${myCc.name}` : ''}`
            }
          </span>
          {approvalStats.pendingCount > 0 && (
            <button className={styles.appBannerLink} onClick={() => navigate('/actuals')}>
              Review →
            </button>
          )}
        </div>
      </div>

      {/* ── Section 3: 6-month trends ── */}
      <div className={styles.trendsCard}>
        <div className={styles.trendsAccent} />
        <div className={styles.trendsInner}>
          <div className={styles.trendsHdr}>
            <div className={styles.trendsHdrLeft}>
              <span className={styles.trendsHdrTitle}>6-month trends</span>
              <span className={styles.trendsHdrSub}>
                Direction over the last 6 monthly periods. Sparklines, not detail — drill into Finance Overview for granularity.
              </span>
            </div>
            <button className={styles.trendsHdrLink} onClick={() => navigate('/finance')}>
              Finance Overview →
            </button>
          </div>

          {!enoughTrendData ? (
            <div className={styles.trendsInsufficient}>
              Insufficient data for trends — need at least 3 open periods.
            </div>
          ) : (
            <div className={styles.trendsBody}>

              {/* Total cost */}
              <div className={styles.trendsCell}>
                <div className={styles.trendsCellLabel}>Total cost / month</div>
                <div className={styles.trendsCellValueRow}>
                  <span className={styles.trendsCellValue}>
                    {displayTrend ? fmtCostShort(displayTrend.totalCost) : '—'}
                  </span>
                  <span className={styles.trendsCellUnit}>DKK</span>
                </div>
                {displayTrend && refTrend && refTrend !== displayTrend && (
                  <div className={styles.trendsDelta} style={{ color: fmtDelta(displayTrend.totalCost, refTrend.totalCost, refTrend.period, false, v => fmtCostShort(v) + ' DKK').color }}>
                    {fmtDelta(displayTrend.totalCost, refTrend.totalCost, refTrend.period, false, v => fmtCostShort(v) + ' DKK').text}
                  </div>
                )}
                <Sparkline values={sparkCostVals} color={C_ACCENT} />
              </div>

              {/* Headcount */}
              <div className={styles.trendsCell}>
                <div className={styles.trendsCellLabel}>Headcount</div>
                <div className={styles.trendsCellValueRow}>
                  <span className={styles.trendsCellValue}>{displayTrend?.headcount ?? '—'}</span>
                </div>
                {displayTrend && refTrend && refTrend !== displayTrend && (
                  <div className={styles.trendsDelta} style={{ color: fmtDelta(displayTrend.headcount, refTrend.headcount, refTrend.period, true, v => Math.round(v).toString()).color }}>
                    {fmtDelta(displayTrend.headcount, refTrend.headcount, refTrend.period, true, v => Math.round(v).toString()).text}
                  </div>
                )}
                <Sparkline values={sparkHcVals} color={C_GOOD} />
              </div>

              {/* Avg utilization */}
              <div className={styles.trendsCell}>
                <div className={styles.trendsCellLabel}>Avg utilization</div>
                <div className={styles.trendsCellValueRow}>
                  <span className={styles.trendsCellValue}>{displayTrend?.avgUtil ?? '—'}</span>
                  <span className={styles.trendsCellUnit}>%</span>
                </div>
                {displayTrend && refTrend && refTrend !== displayTrend && (
                  <div className={styles.trendsDelta} style={{ color: fmtDelta(displayTrend.avgUtil, refTrend.avgUtil, refTrend.period, true, v => Math.round(v) + ' pp').color }}>
                    {fmtDelta(displayTrend.avgUtil, refTrend.avgUtil, refTrend.period, true, v => Math.round(v) + ' pp').text}
                  </div>
                )}
                <Sparkline values={sparkUtilVals} color={C_WARN} />
              </div>

              {/* Net gap */}
              <div className={styles.trendsCell}>
                <div className={styles.trendsCellLabel}>Net gap (org)</div>
                <div className={styles.trendsCellValueRow}>
                  <span className={styles.trendsCellValue}>
                    {displayTrend ? (displayTrend.netGapFTE >= 0 ? '+' : '') + displayTrend.netGapFTE.toFixed(1) : '—'}
                  </span>
                  <span className={styles.trendsCellUnit}>FTE</span>
                </div>
                {displayTrend && refTrend && refTrend !== displayTrend && (
                  <div className={styles.trendsDelta} style={{ color: fmtDelta(displayTrend.netGapFTE, refTrend.netGapFTE, refTrend.period, true, v => v.toFixed(1) + ' FTE').color }}>
                    {fmtDelta(displayTrend.netGapFTE, refTrend.netGapFTE, refTrend.period, true, v => v.toFixed(1) + ' FTE').text}
                  </div>
                )}
                <Sparkline values={sparkGapVals} color={C_BAD} />
              </div>

            </div>
          )}
        </div>
      </div>

      {/* ── Section 4: Attention Needed ── */}
      {totalAttentionCount === 0 ? (
        <div className={styles.attnAllClear}>
          All clear — no organizational issues ✓
        </div>
      ) : (
        <div className={styles.attnCard}>
          <div className={styles.attnCardHdr}>
            <div className={styles.attnCardHdrLeft}>
              <span className={styles.attnCardTitle}>Attention needed</span>
              <span className={styles.attnBadge} style={{ backgroundColor: C_BAD_SOFT, color: C_BAD }}>
                {totalAttentionCount}
              </span>
            </div>
            <div className={styles.attnLegend}>
              <div className={styles.attnLegendItem}>
                <span className={styles.attnSwatch} style={{ backgroundColor: C_BAD }} />
                Critical
              </div>
              <div className={styles.attnLegendItem}>
                <span className={styles.attnSwatch} style={{ backgroundColor: C_OVER }} />
                Overloaded
              </div>
              <div className={styles.attnLegendItem}>
                <span className={styles.attnSwatch} style={{ backgroundColor: C_AMBER }} />
                Capacity review
              </div>
            </div>
          </div>

          <div className={styles.attnBody}>

            {/* Left: Cost center capacity */}
            <div>
              <div className={styles.attnSubHdr}>
                <span className={styles.attnSubLabel}>Cost center capacity</span>
                <span className={styles.attnSubCount}>{ccAttentionItems.length} ITEM{ccAttentionItems.length !== 1 ? 'S' : ''}</span>
              </div>
              {ccAttentionItems.length === 0 ? (
                <div className={styles.attnEmpty}>No issues</div>
              ) : ccAttentionItems.map(item => {
                const isCrit   = item.severity === 'crit';
                const barColor = isCrit ? C_BAD : C_AMBER;
                const chipBg   = isCrit ? C_BAD_SOFT : C_WARN_SOFT;
                const chipFg   = isCrit ? C_BAD : C_WARN;
                const desc     = isCrit
                  ? `${item.resourceCount} resource${item.resourceCount !== 1 ? 's' : ''} understaffed against demand`
                  : 'Over-allocated — capacity review recommended';
                return (
                  <div key={item.id} className={styles.attnRow}>
                    <div className={styles.attnRowNum}>{padNum(item.globalNum)}</div>
                    <div className={styles.attnSevBar} style={{ backgroundColor: barColor }} />
                    <div className={styles.attnRowContent}>
                      <div className={styles.attnRowNameLine}>
                        <span className={styles.attnRowName}>{item.name}</span>
                        <span className={styles.attnRoleLabel}>Cost center</span>
                      </div>
                      <div className={styles.attnRowDesc}>{desc}</div>
                    </div>
                    <span className={styles.attnChip} style={{ backgroundColor: chipBg, color: chipFg }}>
                      {item.chipLabel}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Right: Overloaded resources */}
            <div className={styles.attnColRight}>
              <div className={styles.attnSubHdr}>
                <span className={styles.attnSubLabel}>Overloaded resources</span>
                <span className={styles.attnSubCount}>{resAttentionItems.length} ITEM{resAttentionItems.length !== 1 ? 'S' : ''}</span>
              </div>
              {resAttentionItems.length === 0 ? (
                <div className={styles.attnEmpty}>No issues</div>
              ) : resAttentionItems.map(item => (
                <div key={item.id} className={styles.attnRow}>
                  <div className={styles.attnRowNum}>{padNum(item.globalNum)}</div>
                  <div className={styles.attnSevBar} style={{ backgroundColor: C_OVER }} />
                  <div className={styles.attnRowContent}>
                    <div className={styles.attnRowNameLine}>
                      <span className={styles.attnRowName}>{item.name}</span>
                      {item.ccName && <span className={styles.attnRoleLabel}>{item.ccName}</span>}
                    </div>
                    <div className={styles.attnRowDesc}>
                      {Math.round(item.demand)}% demand across {item.projectCount} project{item.projectCount !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <span className={styles.attnChip} style={{ backgroundColor: C_OVER_SOFT, color: C_OVER }}>
                    {item.chipLabel}
                  </span>
                </div>
              ))}
            </div>

          </div>
        </div>
      )}

      {/* ── Section 5: Resource Allocation Overview ── */}
      <DashboardSection
        title={
          <div>
            <div>Resource Allocation Overview</div>
            <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, fontWeight: 400 }}>
              Full staffing and cost center detail
            </div>
          </div>
        }
      >
        <FinanceOverview scope="reader" costCenterId={myCcId ?? undefined} />
      </DashboardSection>

    </div>
  );
}
