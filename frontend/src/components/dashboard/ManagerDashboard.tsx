import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { makeStyles, tokens, Badge, Button, Spinner } from '@fluentui/react-components';
import { DashboardKPIStrip } from '../shared/DashboardKPIStrip';
import type { KPIStripItem } from '../shared/DashboardKPIStrip';
import { DashboardSection } from './DashboardSection';
import { FinanceOverview } from '../shared/FinanceOverview';
import { actualsApi } from '../../api/actuals';
import { approvalsApi } from '../../api/approvals';
import type { ActualLine } from '../../api/actuals';
import type { ApprovalInstance } from '../../api/approvals';
import type { DemandLine, SupplyLine } from '../../api/planning';
import type { CostCenter } from '../../api/admin';
import type { Period, MeResponse } from '../../types/index';
import { useToast } from '../../hooks/useToast';

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
    gridTemplateColumns: 'minmax(180px, 1.2fr) 100px 1.4fr 240px',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalM} 0`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
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

  // FTE cell
  fteCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  ftePrimary: {
    fontSize: '18px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    lineHeight: '1.2',
  },
  fteSub: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    whiteSpace: 'nowrap',
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

  // Actions cell
  actionsCell: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },

  // Spare capacity
  capacityList: {
    display: 'flex',
    flexDirection: 'column',
  },
  capacityRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 1.5fr) 1fr 100px',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} 0`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    '&:last-child': { borderBottom: 'none' },
  },
  capacityBarCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  capacityAvailLabel: {
    fontSize: '13px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorPaletteGreenForeground2,
    textAlign: 'right' as const,
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

function CapacityBar({ pct }: { pct: number }) {
  const filled = Math.min(Math.max(pct, 0), 100);
  const color = filled < 50 ? '#107c10' : filled < 75 ? '#bc8400' : '#c50f1f';
  return (
    <div style={{ position: 'relative', height: 6, borderRadius: 3, background: tokens.colorNeutralBackground4 }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, height: '100%',
        width: `${filled}%`, background: color, borderRadius: 3,
      }} />
    </div>
  );
}

// ─── component ────────────────────────────────────────────────────────────────

export function ManagerDashboard({ demandLines, supplyLines, costCenters, periods, approvalStatuses }: Props) {
  const styles = useStyles();
  const navigate = useNavigate();
  const { showSuccess, showApiError } = useToast();

  const [inbox, setInbox] = useState<ApprovalInstance[]>([]);
  const [actuals, setActuals] = useState<ActualLine[]>([]);
  const [approving, setApproving] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

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

  // ── Fetch inbox + actuals ──
  useEffect(() => {
    approvalsApi.getInbox().then(setInbox).catch(() => {});
    if (earliestPeriod) {
      actualsApi.getActualLines(earliestPeriod.id).then(setActuals).catch(() => {});
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

  // ── Approval queue ──
  const pendingInbox = useMemo(
    () => inbox.filter(item => item.status === 'pending' && !dismissed.has(item.resource_id ?? item.id)),
    [inbox, dismissed],
  );

  // Group by resource_id (one approval per resource per period)
  const approvalQueue = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<{
      instance: ApprovalInstance;
      resourceName: string;
      resourceInitials: string | null;
      ccName: string;
      actualTotal: number;
      plannedTotal: number;
      projects: Array<{ name: string; fte: number }>;
    }> = [];

    pendingInbox.forEach(item => {
      const rid = item.resource_id ?? item.id;
      if (seen.has(rid)) return;
      seen.add(rid);

      const name = item.resource_name ?? rid;
      const resourceInitials = pd.find(d => d.resource_id === rid)?.resource_initials ?? null;
      const ccName = myCc?.name ?? '';
      const resourceActuals = actuals.filter(a => a.resource_id === rid);
      const actualTotal = resourceActuals.reduce((s, a) => s + a.actual_fte_percent, 0);

      // Planned from demand lines for this resource
      const plannedTotal = pd
        .filter(d => d.resource_id === rid)
        .reduce((s, d) => s + d.fte_percent, 0);

      // Project breakdown from actuals
      const projMap = new Map<string, { name: string; fte: number }>();
      resourceActuals.forEach(a => {
        const pname = a.project_name ?? a.project_id;
        const ex = projMap.get(a.project_id);
        if (ex) ex.fte += a.actual_fte_percent;
        else projMap.set(a.project_id, { name: pname ?? a.project_id, fte: a.actual_fte_percent });
      });
      // Fallback to approval instance project if no actuals loaded yet
      if (projMap.size === 0 && item.project_name && item.project_id) {
        projMap.set(item.project_id, { name: item.project_name, fte: 0 });
      }

      rows.push({
        instance: item,
        resourceName: name,
        resourceInitials,
        ccName,
        actualTotal,
        plannedTotal,
        projects: Array.from(projMap.values()),
      });
    });

    return rows;
  }, [pendingInbox, actuals, pd, myCc]);

  // ── Approve handler ──
  const handleApprove = async (item: ApprovalInstance) => {
    const pendingStep = item.steps?.find(s => s.status === 'pending');
    if (!pendingStep) return;
    const rid = item.resource_id ?? item.id;
    setApproving(prev => new Set(prev).add(rid));
    try {
      await approvalsApi.approveStep(item.id, pendingStep.id);
      setDismissed(prev => new Set(prev).add(rid));
      showSuccess('Approved', `Actuals for ${item.resource_name ?? 'resource'} approved`);
    } catch (err) {
      showApiError(err as Error, 'Failed to approve');
    } finally {
      setApproving(prev => { const n = new Set(prev); n.delete(rid); return n; });
    }
  };

  const handleApproveAll = async () => {
    for (const row of approvalQueue) {
      await handleApprove(row.instance);
    }
  };

  // ── Spare capacity ──
  const spareCapacity = useMemo(() => {
    return resourceAllocations
      .filter(r => r.supply < 80)
      .sort((a, b) => a.supply - b.supply)
      .slice(0, 6);
  }, [resourceAllocations]);

  const allWellUtilized = resourceAllocations.length > 0 && spareCapacity.length === 0;

  const periodLabel = earliestPeriod
    ? `${MONTH_NAMES[earliestPeriod.month - 1]} ${earliestPeriod.year}`
    : '—';

  return (
    <div className={styles.sections}>

      {/* ── Section 1: KPI Strip ── */}
      <DashboardKPIStrip items={kpiItems} />

      {/* ── Section 2: Approval Queue (hero) ── */}
      <div className={styles.queueCard}>
        <div className={styles.queueHeader}>
          <div className={styles.queueHeaderLeft}>
            <h2 className={styles.queueTitle}>Approval Queue</h2>
            {pendingCount > 0 && (
              <Badge
                appearance="filled"
                style={{ backgroundColor: '#6b4eb8', color: '#fff' }}
              >
                {pendingCount}
              </Badge>
            )}
          </div>
          <Button
            appearance="transparent"
            size="small"
            onClick={() => navigate('/finance')}
          >
            Open Actuals →
          </Button>
        </div>

        <div className={styles.queueBody}>
          {approvalQueue.length === 0 ? (
            <div className={styles.emptySuccess}>
              No pending approvals — all actuals reviewed ✓
            </div>
          ) : (
            approvalQueue.map(row => {
              const rid = row.instance.resource_id ?? row.instance.id;
              const isApproving = approving.has(rid);
              const color = avatarColor(row.resourceName);
              const coveragePctRow = row.plannedTotal > 0
                ? Math.round((row.actualTotal / row.plannedTotal) * 100)
                : null;

              return (
                <div key={rid} className={styles.queueRow}>
                  {/* Col 1: Avatar + name */}
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

                  {/* Col 2: FTE reported */}
                  <div className={styles.fteCell}>
                    <div className={styles.ftePrimary}>
                      {Math.round(row.actualTotal * 10) / 10}%
                    </div>
                    {row.plannedTotal > 0 && (
                      <div className={styles.fteSub}>
                        of {Math.round(row.plannedTotal)}%
                        {coveragePctRow !== null && ` (${coveragePctRow}%)`}
                      </div>
                    )}
                  </div>

                  {/* Col 3: Project chips */}
                  <div className={styles.projectChips}>
                    {row.projects.length > 0 ? (
                      row.projects.map((p, i) => (
                        <span key={i} className={styles.chip}>
                          {p.name}
                          {p.fte > 0 && (
                            <span style={{ opacity: 0.7 }}>
                              {Math.round(p.fte * 10) / 10}%
                            </span>
                          )}
                        </span>
                      ))
                    ) : (
                      <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
                        Loading…
                      </span>
                    )}
                  </div>

                  {/* Col 4: Actions */}
                  <div className={styles.actionsCell}>
                    <Button
                      appearance="outline"
                      size="small"
                      onClick={() => navigate('/finance')}
                    >
                      Flag
                    </Button>
                    <Button
                      appearance="primary"
                      size="small"
                      style={{ backgroundColor: '#107c10', borderColor: '#107c10' }}
                      disabled={isApproving}
                      icon={isApproving ? <Spinner size="tiny" /> : undefined}
                      onClick={() => handleApprove(row.instance)}
                    >
                      {isApproving ? 'Approving…' : 'Approve'}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {approvalQueue.length > 0 && (
          <div className={styles.queueFooter}>
            <span className={styles.queueFooterLabel}>
              Showing {approvalQueue.length} of {pendingCount} pending
            </span>
            <Button
              appearance="primary"
              size="small"
              style={{ backgroundColor: '#107c10', borderColor: '#107c10' }}
              disabled={approving.size > 0}
              onClick={handleApproveAll}
            >
              Approve all
            </Button>
          </div>
        )}
      </div>

      {/* ── Section 3: Spare Capacity ── */}
      <DashboardSection
        title={`Spare Capacity — ${periodLabel}`}
      >
        {allWellUtilized ? (
          <div className={styles.emptySuccess}>
            All team members well utilized — no spare capacity ✓
          </div>
        ) : spareCapacity.length === 0 && resourceAllocations.length === 0 ? (
          <div className={styles.emptyNeutral}>
            No allocation data for this period
          </div>
        ) : (
          <div className={styles.capacityList}>
            {spareCapacity.map(r => {
              const available = 100 - r.supply;
              return (
                <div key={r.id} className={styles.capacityRow}>
                  <div className={styles.resourceCell}>
                    <div className={styles.avatar} style={{ background: avatarColor(r.name) }}>
                      {r.initials || initials(r.name)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className={styles.resourceName}>{r.name}</div>
                      <div className={styles.resourceSub}>{myCc?.name ?? ''}</div>
                    </div>
                  </div>

                  <div className={styles.capacityBarCell}>
                    <CapacityBar pct={r.supply} />
                    <div style={{ fontSize: '10px', color: tokens.colorNeutralForeground3 }}>
                      {Math.round(r.supply * 10) / 10}% allocated
                    </div>
                  </div>

                  <div className={styles.capacityAvailLabel}>
                    {Math.round(available * 10) / 10}% available
                  </div>
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
