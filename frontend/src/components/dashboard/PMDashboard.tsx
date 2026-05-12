import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { makeStyles, tokens, Badge, Button } from '@fluentui/react-components';
import { DashboardKPIStrip } from '../shared/DashboardKPIStrip';
import type { KPIStripItem } from '../shared/DashboardKPIStrip';
import { DashboardSection } from './DashboardSection';
import { FinanceOverview } from '../shared/FinanceOverview';
import type { DemandLine, SupplyLine } from '../../api/planning';
import type { Project } from '../../api/admin';
import type { Period, MeResponse } from '../../types/index';

// ─── helpers ──────────────────────────────────────────────────────────────────

type Sev = 'good' | 'warn' | 'bad';

function getSev(gap: number): Sev {
  if (gap < -20) return 'bad';
  if (gap < -0.1) return 'warn';
  return 'good';
}

const SEV_LABEL: Record<Sev, string> = { good: 'On track', warn: 'Attention', bad: 'Understaffed' };
const SEV_BADGE: Record<Sev, 'success' | 'warning' | 'danger'> = { good: 'success', warn: 'warning', bad: 'danger' };
const SEV_COLOR: Record<Sev, string> = {
  good: tokens.colorPaletteGreenForeground2,
  warn: tokens.colorPaletteMarigoldForeground2,
  bad:  tokens.colorPaletteRedForeground2,
};
const SEV_ACCENT: Record<Sev, string> = {
  good: '#107c10',
  warn: '#bc8400',
  bad:  '#c50f1f',
};

function avatarColor(name: string): string {
  const COLORS = ['#0078d4', '#107c10', '#d13438', '#ff8c00', '#8764b8', '#00b294', '#ca5010'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0x7fffffff;
  return COLORS[h % COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function GapChip({ gap }: { gap: number }) {
  const sev = getSev(gap);
  const BG: Record<Sev, string> = { good: '#e8f5e9', warn: '#fff8e1', bad: '#ffebee' };
  const FG: Record<Sev, string> = { good: '#1b5e20', warn: '#e65100', bad: '#b71c1c' };
  return (
    <span style={{
      display: 'inline-flex',
      width: 'auto',
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '12px',
      fontWeight: 600,
      background: BG[sev],
      color: FG[sev],
      whiteSpace: 'nowrap',
      alignSelf: 'center',
    }}>
      {gap >= 0 ? '+' : ''}{Math.round(gap * 10) / 10}%
    </span>
  );
}

function AllocationBar({ demand, supply, sev }: { demand: number; supply: number; sev: Sev }) {
  const max = Math.max(demand, supply, 100);
  const dPct = (demand / max) * 100;
  const sPct = (supply / max) * 100;
  const fillColor = sev === 'bad' ? '#f4cccc' : sev === 'warn' ? '#fce5cd' : '#c9dfc9';
  const strokeColor = sev === 'bad' ? '#c50f1f' : sev === 'warn' ? '#bc8400' : '#107c10';

  return (
    <div style={{ position: 'relative', height: 6, borderRadius: 3, background: tokens.colorNeutralBackground4 }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, height: '100%',
        width: `${dPct}%`, background: tokens.colorNeutralStroke1, borderRadius: 3,
      }} />
      <div style={{
        position: 'absolute', top: 0, left: 0, height: '100%',
        width: `${Math.min(sPct, 100)}%`, background: fillColor, borderRadius: 3,
      }} />
      {demand > 0 && dPct <= 100 && (
        <div style={{
          position: 'absolute', top: -2, height: 10, width: 2,
          left: `calc(${dPct}% - 1px)`, background: strokeColor, borderRadius: 1,
        }} />
      )}
    </div>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  projectGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
  },
  projectCard: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    '&:nth-child(even)': { borderRight: 'none' },
    '&:nth-last-child(-n+2)': { borderBottom: 'none' },
  },
  projectAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '3px',
    borderRadius: `${tokens.borderRadiusSmall} 0 0 ${tokens.borderRadiusSmall}`,
  },
  projectTopRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalS,
  },
  projectName: {
    fontSize: '15px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  projectNameGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    minWidth: 0,
    flex: 1,
    overflow: 'hidden',
  },
  codePill: {
    fontSize: '11px',
    fontFamily: 'monospace',
    background: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground3,
    padding: '1px 6px',
    borderRadius: '4px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  projectMetrics: {
    display: 'flex',
    gap: tokens.spacingHorizontalL,
  },
  metricBlock: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  metricLabel: {
    fontSize: '10px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
  },
  metricValue: {
    fontSize: '22px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    lineHeight: '1.2',
  },
  metricLegend: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
  },
  projectFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: tokens.spacingVerticalXXS,
  },
  // Worst Gaps section
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
  gapList: {
    display: 'flex',
    flexDirection: 'column',
  },
  gapRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 1.2fr) 1fr auto',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} 0`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    '&:last-child': { borderBottom: 'none' },
  },
  gapResourceCell: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
  },
  avatar: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: tokens.fontWeightSemibold,
    color: '#fff',
    flexShrink: 0,
  },
  gapResourceName: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  gapResourceSub: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  gapBarCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  gapBarLegend: {
    fontSize: '10px',
    color: tokens.colorNeutralForeground3,
  },
  emptySuccess: {
    textAlign: 'center',
    color: tokens.colorPaletteGreenForeground2,
    padding: `${tokens.spacingVerticalXL} 0`,
    fontSize: tokens.fontSizeBase300,
  },
  financeSubtitle: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
    marginTop: '2px',
  },
});

// ─── props ────────────────────────────────────────────────────────────────────

interface Props {
  demandLines: DemandLine[];
  supplyLines: SupplyLine[];
  projects: Project[];
  periods: Period[];
  approvalStatuses: Record<string, { status: string }>;
  user: MeResponse;
}

// ─── component ────────────────────────────────────────────────────────────────

export function PMDashboard({ demandLines, supplyLines, projects, periods }: Props) {
  const styles = useStyles();
  const navigate = useNavigate();

  const earliestPeriod = useMemo(
    () => [...periods]
      .filter(p => p.status === 'open')
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)[0] ?? null,
    [periods],
  );

  const myProjectIds = useMemo(() => new Set(projects.map(p => p.id)), [projects]);

  const pd = useMemo(
    () => earliestPeriod ? demandLines.filter(d => d.period_id === earliestPeriod.id) : [],
    [demandLines, earliestPeriod],
  );
  const ps = useMemo(
    () => earliestPeriod ? supplyLines.filter(s => s.period_id === earliestPeriod.id) : [],
    [supplyLines, earliestPeriod],
  );

  // ── project rows ──
  const projectRows = useMemo(() => {
    const allIds = new Set([...myProjectIds, ...pd.map(d => d.project_id)]);
    return Array.from(allIds).map(pid => {
      const proj = projects.find(p => p.id === pid);
      const name = proj?.name ?? pd.find(d => d.project_id === pid)?.project_name ?? pid;
      const code = proj?.code ?? '';
      const demand = pd.filter(d => d.project_id === pid).reduce((s, d) => s + d.fte_percent, 0);
      const supply = ps.filter(s => s.project_id === pid).reduce((s, ln) => s + ln.fte_percent, 0);
      const gap = supply - demand;
      const resourceIds = new Set(
        pd.filter(d => d.project_id === pid && d.resource_id).map(d => d.resource_id!),
      );
      return { id: pid, name, code, demand, supply, gap, resourceCount: resourceIds.size };
    }).sort((a, b) => a.gap - b.gap);
  }, [projects, myProjectIds, pd, ps]);

  // ── resource-project gaps (for worst gaps + KPIs) ──
  const resourceGaps = useMemo(() => {
    const map = new Map<string, {
      name: string; ccName: string; projectName: string; demand: number; supply: number;
    }>();
    pd.filter(d => d.resource_id).forEach(d => {
      const key = `${d.resource_id}-${d.project_id}`;
      const ex = map.get(key);
      if (ex) {
        ex.demand += d.fte_percent;
      } else {
        map.set(key, {
          name: d.resource_name ?? d.resource_id!,
          ccName: d.cost_center_name ?? '',
          projectName: d.project_name ?? d.project_id,
          demand: d.fte_percent,
          supply: 0,
        });
      }
    });
    ps.filter(s => s.project_id).forEach(s => {
      const key = `${s.resource_id}-${s.project_id}`;
      const ex = map.get(key);
      if (ex) ex.supply += s.fte_percent;
    });
    return Array.from(map.values()).map(r => ({ ...r, gap: r.supply - r.demand }));
  }, [pd, ps]);

  // ── KPI values ──
  const totalDemand = useMemo(() => pd.reduce((s, d) => s + d.fte_percent, 0), [pd]);
  const totalSupply = useMemo(() => ps.reduce((s, ln) => s + ln.fte_percent, 0), [ps]);
  const netGap = totalSupply - totalDemand;
  const coveragePct = totalDemand > 0 ? Math.round((totalSupply / totalDemand) * 100) : 100;
  const uniqueResources = useMemo(
    () => new Set(pd.filter(d => d.resource_id).map(d => d.resource_id!)).size,
    [pd],
  );
  const understaffedCount = resourceGaps.filter(r => r.gap < -0.1).length;
  const uniqueCostCenters = useMemo(
    () => new Set(pd.filter(d => d.cost_center_id).map(d => d.cost_center_id!)).size,
    [pd],
  );
  const balancedResources = resourceGaps.filter(r => r.gap >= 0).length;
  const totalR            = resourceGaps.length || 1;

  const onTrack  = projectRows.filter(r => r.gap >= 0).length;
  const atRisk   = projectRows.filter(r => r.gap < -0.1 && r.gap >= -20).length;
  const critical = projectRows.filter(r => r.gap < -20).length;
  const totalP   = projectRows.length || 1;

  const kpiItems: KPIStripItem[] = [
    {
      label: 'My Projects',
      value: projectRows.length,
      subtitle: `${onTrack} on track · ${atRisk + critical} at risk`,
      bar: {
        segments: [
          { pct: (onTrack  / totalP) * 100, sev: 'good' },
          { pct: (atRisk   / totalP) * 100, sev: 'warn' },
          { pct: (critical / totalP) * 100, sev: 'bad'  },
        ],
      },
    },
    {
      label: 'Demand',
      value: `${Math.round(totalDemand)}%`,
      subtitle: `across ${uniqueResources} resources`,
    },
    {
      label: 'Supply',
      value: `${Math.round(totalSupply)}%`,
      subtitle: `${Math.min(coveragePct, 999)}% of demand covered`,
      severity: coveragePct >= 90 ? 'good' : coveragePct >= 60 ? 'warn' : 'bad',
      bar: {
        fill: Math.min(coveragePct, 100),
        fillSev: coveragePct >= 90 ? 'good' : coveragePct >= 60 ? 'warn' : 'bad',
      },
    },
    {
      label: 'Net Gap',
      value: `${netGap >= 0 ? '+' : ''}${Math.round(netGap * 10) / 10}%`,
      subtitle: `${understaffedCount} understaffed`,
      severity: netGap < -0.1 ? 'bad' : 'good',
    },
    {
      label: 'My Resources',
      value: uniqueResources,
      subtitle: `across ${uniqueCostCenters} cost center${uniqueCostCenters !== 1 ? 's' : ''}`,
    },
  ];

  const worstGaps = useMemo(
    () => resourceGaps.filter(r => r.gap < -0.1).sort((a, b) => a.gap - b.gap).slice(0, 8),
    [resourceGaps],
  );

  const userProjectIds = useMemo(() => projects.map(p => p.id), [projects]);

  return (
    <div className={styles.sections}>
      {/* ── Section 1: KPI Strip ── */}
      <DashboardKPIStrip items={kpiItems} />

      {/* ── Section 2: My Projects ── */}
      <DashboardSection title="My Projects">
        {projectRows.length === 0 ? (
          <div style={{ textAlign: 'center', color: tokens.colorNeutralForeground3, padding: `${tokens.spacingVerticalXL} 0` }}>
            No projects assigned to you
          </div>
        ) : (
          <div className={styles.projectGrid} style={{ margin: `-${tokens.spacingHorizontalL}` }}>
            {projectRows.map(row => {
              const sev = getSev(row.gap);
              return (
                <div key={row.id} className={styles.projectCard} data-sev={sev}>
                  <div className={styles.projectAccent} style={{ background: SEV_ACCENT[sev] }} />
                  <div style={{ paddingLeft: '8px' }}>
                    <div className={styles.projectTopRow}>
                      <div className={styles.projectNameGroup}>
                        <span className={styles.projectName}>{row.name}</span>
                        {row.code && <span className={styles.codePill}>{row.code}</span>}
                      </div>
                      <Badge
                        color={SEV_BADGE[sev]}
                        appearance="filled"
                        size="small"
                      >
                        {SEV_LABEL[sev]}
                      </Badge>
                    </div>

                    <div className={styles.projectMetrics}>
                      <div className={styles.metricBlock}>
                        <div className={styles.metricLabel}>Demand vs Supply</div>
                        <div className={styles.metricValue} style={{ color: SEV_COLOR[sev] }}>
                          {Math.round(row.demand)}%
                        </div>
                        <AllocationBar demand={row.demand} supply={row.supply} sev={sev} />
                        <div className={styles.metricLegend}>
                          <span>D {Math.round(row.demand * 10) / 10}% · S {Math.round(row.supply * 10) / 10}%</span>
                          <GapChip gap={row.gap} />
                        </div>
                      </div>

                      <div className={styles.metricBlock} style={{ maxWidth: '90px', flexShrink: 0 }}>
                        <div className={styles.metricLabel}>Resources</div>
                        <div className={styles.metricValue}>{row.resourceCount}</div>
                        <div className={styles.metricLegend}>
                          {row.resourceCount === 1 ? 'person' : 'people'}
                        </div>
                      </div>
                    </div>

                    <div className={styles.projectFooter}>
                      <Button
                        appearance="transparent"
                        size="small"
                        onClick={() => navigate('/resource-planning')}
                      >
                        Open →
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DashboardSection>

      {/* ── Section 3: Worst Gaps ── */}
      <DashboardSection
        title={
          <span className={styles.sectionTitle}>
            Worst Gaps
            {worstGaps.length > 0 && (
              <Badge color="danger" appearance="filled">{worstGaps.length}</Badge>
            )}
          </span>
        }
      >
        {worstGaps.length === 0 ? (
          <div className={styles.emptySuccess}>All resources fully staffed ✓</div>
        ) : (
          <div className={styles.gapList}>
            {worstGaps.map((r, i) => {
              const sev = getSev(r.gap);
              const color = avatarColor(r.name);
              return (
                <div key={i} className={styles.gapRow}>
                  <div className={styles.gapResourceCell}>
                    <div
                      className={styles.avatar}
                      style={{ background: color }}
                    >
                      {initials(r.name)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className={styles.gapResourceName}>{r.name}</div>
                      <div className={styles.gapResourceSub}>
                        {[r.ccName, r.projectName].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </div>

                  <div className={styles.gapBarCell}>
                    <AllocationBar demand={r.demand} supply={r.supply} sev={sev} />
                    <div className={styles.gapBarLegend}>
                      D {Math.round(r.demand * 10) / 10}% · S {Math.round(r.supply * 10) / 10}%
                    </div>
                  </div>

                  <GapChip gap={r.gap} />
                </div>
              );
            })}
          </div>
        )}
      </DashboardSection>

      {/* ── Section 4: Finance Overview ── */}
      <DashboardSection
        title={
          <div>
            <div>Resource Allocation Overview</div>
            <div className={styles.financeSubtitle}>
              Cost centers and resources for your projects
            </div>
          </div>
        }
      >
        <FinanceOverview scope="pm" projectIds={userProjectIds} />
      </DashboardSection>
    </div>
  );
}
