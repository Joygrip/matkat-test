import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { makeStyles, tokens, Badge, MessageBar, MessageBarBody } from '@fluentui/react-components';
import { DashboardKPIStrip } from '../shared/DashboardKPIStrip';
import type { KPIStripItem } from '../shared/DashboardKPIStrip';
import { DashboardSection } from './DashboardSection';
import { FinanceOverview } from '../shared/FinanceOverview';
import { actualsApi } from '../../api/actuals';
import type { ActualLine } from '../../api/actuals';
import type { DemandLine, SupplyLine } from '../../api/planning';
import type { CostCenter, ApprovalDelegate } from '../../api/admin';
import { adminApi } from '../../api/admin';
import type { Period, MeResponse } from '../../types/index';

// ─── helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

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

// ─── styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },

  // Approval Queue (hero)
  queueCard: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: '1px solid #d4c8f0',
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  queueHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderBottom: '1px solid #d4c8f0',
    background: 'linear-gradient(180deg, #fbf9ff, #f3f0fa)',
  },
  queueHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
  queueTitle: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    margin: 0,
  },
  queueBody: {
    padding: `0 ${tokens.spacingHorizontalL}`,
  },
  queueFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  queueFooterLabel: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
  },
  queueRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(200px, 1.2fr) 100px 1.4fr 80px 30px',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalM} 0`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: 'pointer',
    borderRadius: tokens.borderRadiusMedium,
    ':hover': { backgroundColor: tokens.colorNeutralBackground2 },
    '&:last-child': { borderBottom: 'none' },
  },

  // Resource cell
  resourceCell: {
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
  resourceName: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  resourceSub: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  // Lines pending cell
  linesCell: {
    fontSize: '12px',
    fontWeight: tokens.fontWeightSemibold,
    color: '#6b4eb8',
    whiteSpace: 'nowrap',
  },

  // Total FTE cell
  totalFteCell: {
    fontSize: '13px',
    fontWeight: tokens.fontWeightSemibold,
    fontFamily: 'monospace',
    color: tokens.colorNeutralForeground1,
    whiteSpace: 'nowrap',
    textAlign: 'right' as const,
  },

  // Chevron cell
  chevronCell: {
    fontSize: '16px',
    color: tokens.colorNeutralForeground3,
    textAlign: 'center' as const,
  },

  // Project chips cell
  projectChips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    alignItems: 'center',
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 600,
    background: '#ede9f8',
    color: '#4b2d9e',
    whiteSpace: 'nowrap',
  },

  emptySuccess: {
    textAlign: 'center',
    color: tokens.colorPaletteGreenForeground2,
    padding: `${tokens.spacingVerticalXL} 0`,
    fontSize: tokens.fontSizeBase300,
  },
  emptyNeutral: {
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
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
  costCenters: CostCenter[];
  periods: Period[];
  approvalStatuses: Record<string, { status: string }>;
  user: MeResponse;
}

// ─── sub-components ───────────────────────────────────────────────────────────

// ─── component ────────────────────────────────────────────────────────────────

export function ManagerDashboard({ demandLines, supplyLines, costCenters, periods, approvalStatuses }: Props) {
  const styles = useStyles();
  const navigate = useNavigate();

  const [actuals, setActuals] = useState<ActualLine[]>([]);
  const [actualsLoading, setActualsLoading] = useState(false);
  const [activeDelegations, setActiveDelegations] = useState<ApprovalDelegate[]>([]);

  useEffect(() => {
    adminApi.listDelegatesAsDelegate()
      .then(dels => setActiveDelegations(dels.filter(d => d.is_active)))
      .catch(() => {});
  }, []);

  // ── Period ──
  const earliestPeriod = useMemo(
    () => [...periods]
      .filter(p => p.status === 'open')
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)[0] ?? null,
    [periods],
  );

  // ── CC ──
  const myCcId = useMemo(() => {
    const first = supplyLines[0] || demandLines[0];
    return first?.cost_center_id ?? null;
  }, [supplyLines, demandLines]);

  const myCc = useMemo(
    () => costCenters.find(cc => cc.id === myCcId) ?? null,
    [costCenters, myCcId],
  );

  // ── Period-filtered lines ──
  const pd = useMemo(
    () => earliestPeriod ? demandLines.filter(d => d.period_id === earliestPeriod.id) : [],
    [demandLines, earliestPeriod],
  );
  const ps = useMemo(
    () => earliestPeriod ? supplyLines.filter(s => s.period_id === earliestPeriod.id) : [],
    [supplyLines, earliestPeriod],
  );

  // ── Fetch actuals ──
  useEffect(() => {
    if (earliestPeriod) {
      setActualsLoading(true);
      actualsApi.getActualLines(undefined, earliestPeriod.year, earliestPeriod.month)
        .then(lines => { setActuals(lines); setActualsLoading(false); })
        .catch(() => { setActualsLoading(false); });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earliestPeriod?.id]);

  // ── Resource allocation map ──
  const resourceAllocations = useMemo(() => {
    const map = new Map<string, { name: string; initials: string | null; demand: number; supply: number }>();
    pd.filter(d => d.resource_id).forEach(d => {
      const ex = map.get(d.resource_id!);
      if (ex) ex.demand += d.fte_percent;
      else map.set(d.resource_id!, { name: d.resource_name ?? d.resource_id!, initials: d.resource_initials ?? null, demand: d.fte_percent, supply: 0 });
    });
    ps.forEach(s => {
      const ex = map.get(s.resource_id);
      if (ex) ex.supply += s.fte_percent;
      else map.set(s.resource_id, { name: s.resource_name ?? s.resource_id, initials: s.resource_initials ?? null, demand: 0, supply: s.fte_percent });
    });
    return Array.from(map.entries()).map(([id, r]) => ({ id, ...r, gap: r.supply - r.demand }));
  }, [pd, ps]);

  const teamSize = resourceAllocations.length;
  const totalDemand = useMemo(() => pd.reduce((s, d) => s + d.fte_percent, 0), [pd]);
  const totalSupply = useMemo(() => ps.reduce((s, ln) => s + ln.fte_percent, 0), [ps]);
  const netGap = totalSupply - totalDemand;
  const coveragePct = totalDemand > 0 ? Math.round((totalSupply / totalDemand) * 100) : 100;
  const understaffedCount = resourceAllocations.filter(r => r.gap < -0.1).length;
  const overCount = resourceAllocations.filter(r => r.gap > 0.1).length;

  const pendingCount = useMemo(
    () => Object.values(approvalStatuses).filter(s => s.status === 'pending').length,
    [approvalStatuses],
  );
  // approvalQueue.length === pendingCount once actuals load; use pendingCount for badge (available immediately)

  // ── KPI strip ──
  const kpiItems: KPIStripItem[] = [
    {
      label: 'My Team',
      value: teamSize,
      subtitle: `${teamSize} ${teamSize === 1 ? 'person' : 'people'}`,
    },
    {
      label: 'Demand on Team',
      value: `${Math.round(totalDemand)}%`,
      subtitle: `across ${teamSize} resources`,
    },
    {
      label: 'Supply Allocated',
      value: `${Math.round(totalSupply)}%`,
      subtitle: `${coveragePct}% of demand covered`,
      severity: coveragePct >= 90 ? 'good' : coveragePct >= 60 ? 'warn' : 'bad',
      bar: {
        fill: Math.min(coveragePct, 100),
        fillSev: coveragePct >= 90 ? 'good' : coveragePct >= 60 ? 'warn' : 'bad',
      },
    },
    {
      label: 'Net Gap',
      value: `${netGap >= 0 ? '+' : ''}${Math.round(netGap * 10) / 10}%`,
      subtitle: `${understaffedCount} understaffed · ${overCount} over`,
      severity: netGap < -0.1 ? 'bad' : netGap > 0.1 ? 'warn' : 'good',
    },
    {
      label: 'Pending Approvals',
      value: pendingCount,
      subtitle: earliestPeriod
        ? `due end of ${MONTH_NAMES[earliestPeriod.month - 1]}`
        : 'no open period',
      severity: pendingCount > 0 ? 'pending' : 'default',
    },
  ];

  // ── Approval queue — approvalStatuses is keyed by actual_line_id, not resource_id ──
  const approvalQueue = useMemo(() => {
    // Collect pending actual_line_ids
    const pendingActualIds = Object.entries(approvalStatuses)
      .filter(([, s]) => s.status === 'pending')
      .map(([aid]) => aid);

    // Group matched actual lines by resource_id
    const byResource = new Map<string, ActualLine[]>();
    pendingActualIds.forEach(aid => {
      const actual = actuals.find(a => a.id === aid);
      if (actual) {
        const existing = byResource.get(actual.resource_id) ?? [];
        existing.push(actual);
        byResource.set(actual.resource_id, existing);
      }
    });

    return Array.from(byResource.entries()).map(([rid, resourceActuals]) => {
      const lineCount = resourceActuals.length;
      const totalFte = resourceActuals.reduce((s, a) => s + a.actual_fte_percent, 0);

      const resourceName = resourceActuals[0]?.resource_name
        ?? pd.find(d => d.resource_id === rid)?.resource_name
        ?? rid;
      const resourceInitials = pd.find(d => d.resource_id === rid)?.resource_initials ?? null;
      const ccName = myCc?.name ?? '';

      const projMap = new Map<string, { name: string; fte: number }>();
      resourceActuals.forEach(a => {
        const pname = a.project_name ?? a.project_id;
        const ex = projMap.get(a.project_id);
        if (ex) ex.fte += a.actual_fte_percent;
        else projMap.set(a.project_id, { name: pname ?? a.project_id, fte: a.actual_fte_percent });
      });

      return { rid, resourceName, resourceInitials, ccName, lineCount, totalFte, projects: Array.from(projMap.values()) };
    });
  }, [approvalStatuses, actuals, pd, myCc]);

  const periodLabel =earliestPeriod
    ? `${MONTH_NAMES[earliestPeriod.month - 1]} ${earliestPeriod.year}`
    : '—';

  return (
    <div className={styles.sections}>

      {/* ── Delegation notices ── */}
      {activeDelegations.map(d => (
        <MessageBar key={d.id} intent="info">
          <MessageBarBody>
            You are acting as delegate for <strong>{d.delegator_name ?? 'a manager'}</strong>
            {d.note ? ` — ${d.note}` : ''}
          </MessageBarBody>
        </MessageBar>
      ))}

      {/* ── Section 1: KPI Strip ── */}
      <DashboardKPIStrip items={kpiItems} />

      {/* ── Section 2: Pending Approvals (hero) ── */}
      <div className={styles.queueCard}>
        <div className={styles.queueHeader}>
          <div className={styles.queueHeaderLeft}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS }}>
                <h2 className={styles.queueTitle}>Pending Approvals</h2>
                {pendingCount > 0 && (
                  <Badge
                    appearance="filled"
                    style={{ backgroundColor: '#6b4eb8', color: '#fff' }}
                  >
                    {pendingCount}
                  </Badge>
                )}
              </div>
              <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, marginTop: '2px' }}>
                Click to review in Actuals
              </div>
            </div>
          </div>
        </div>

        <div className={styles.queueBody}>
          {actualsLoading && pendingCount > 0 ? (
            <div className={styles.emptyNeutral}>
              Loading…
            </div>
          ) : approvalQueue.length === 0 ? (
            <div className={styles.emptySuccess}>
              No pending approvals — all actuals reviewed ✓
            </div>
          ) : (
            approvalQueue.map(row => {
              const color = avatarColor(row.resourceName);
              return (
                <div
                  key={row.rid}
                  className={styles.queueRow}
                  onClick={() => navigate('/actuals')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && navigate('/actuals')}
                >
                  {/* Col 1: Avatar + name + CC */}
                  <div className={styles.resourceCell}>
                    <div className={styles.avatar} style={{ background: color }}>
                      {row.resourceInitials || initials(row.resourceName)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className={styles.resourceName}>{row.resourceName}</div>
                      {row.ccName && (
                        <div className={styles.resourceSub}>{row.ccName}</div>
                      )}
                    </div>
                  </div>

                  {/* Col 2: Lines pending */}
                  <div className={styles.linesCell}>
                    {row.lineCount > 0
                      ? `${row.lineCount} ${row.lineCount === 1 ? 'line' : 'lines'} pending`
                      : <span style={{ color: tokens.colorNeutralForeground3, fontWeight: 'normal' }}>Loading…</span>
                    }
                  </div>

                  {/* Col 3: Project chips */}
                  <div className={styles.projectChips}>
                    {row.projects.length > 0 ? (
                      row.projects.map((p, i) => (
                        <span key={i} className={styles.chip}>
                          {p.name}
                          {p.fte > 0 && (
                            <span style={{ opacity: 0.7, marginLeft: '2px' }}>
                              {Math.round(p.fte * 10) / 10}%
                            </span>
                          )}
                        </span>
                      ))
                    ) : (
                      <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
                        —
                      </span>
                    )}
                  </div>

                  {/* Col 4: Total FTE */}
                  <div className={styles.totalFteCell}>
                    {row.totalFte > 0 ? `${Math.round(row.totalFte * 10) / 10}%` : '—'}
                  </div>

                  {/* Col 5: Chevron */}
                  <div className={styles.chevronCell}>›</div>
                </div>
              );
            })
          )}
        </div>

        {approvalQueue.length > 0 && (
          <div className={styles.queueFooter}>
            <span className={styles.queueFooterLabel}>
              Showing {approvalQueue.length} {approvalQueue.length === 1 ? 'employee' : 'employees'} with pending actuals
            </span>
          </div>
        )}
      </div>

      {/* ── Section 3: Resource Allocation Overview ── */}
      <DashboardSection
        title={
          <div>
            <div>Resource Allocation Overview{myCc ? ` — ${myCc.name}` : ''}</div>
            <div className={styles.financeSubtitle}>
              Cost center allocation and actuals for your team
            </div>
          </div>
        }
      >
        <FinanceOverview scope="manager" costCenterId={myCcId ?? undefined} />
      </DashboardSection>

    </div>
  );
}
