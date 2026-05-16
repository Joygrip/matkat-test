import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { makeStyles, tokens, Spinner } from '@fluentui/react-components';
import { DashboardSection } from './DashboardSection';
import { FinanceOverview } from '../shared/FinanceOverview';
import { getConsolidatedCosts } from '../../api/finance';
import type { ConsolidatedCostResponse } from '../../api/finance';
import { apiClient } from '../../api/client';
import { usePeriod } from '../../contexts/PeriodContext';
import { useToast } from '../../hooks/useToast';
import type { FinanceActualRow } from '../finance/ActualsTab';
import type { DemandLine, SupplyLine } from '../../api/planning';
import type { CostCenter } from '../../api/admin';
import type { Period, MeResponse } from '../../types/index';
import { MONTH_SHORT, formatDKK } from '../../utils/format';

// ─── colors ───────────────────────────────────────────────────────────────────

const SEV_FG = {
  good:   tokens.colorPaletteGreenForeground2,
  warn:   tokens.colorPaletteMarigoldForeground2,
  bad:    tokens.colorPaletteRedForeground2,
  purple: '#7B5EA7',
};

const SEV_BAR = {
  good:   tokens.colorPaletteGreenBackground2,
  warn:   tokens.colorPaletteMarigoldBackground2,
  bad:    tokens.colorPaletteRedBackground2,
  purple: '#C5B3E6',
};

// ─── styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },

  // KPI strip — 5 columns
  kpiStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: tokens.spacingHorizontalM,
  },
  kpiCard: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    boxShadow: tokens.shadow2,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
  },
  kpiLabel: {
    fontSize: '11px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  kpiValue: {
    fontSize: '26px',
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: '1.2',
  },
  kpiSub: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
  },
  barTrack: {
    marginTop: tokens.spacingVerticalXXS,
    height: '4px',
    borderRadius: '2px',
    backgroundColor: tokens.colorNeutralBackground4,
    overflow: 'hidden',
    display: 'flex',
  },
  barFill: {
    height: '100%',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
  },

  // Period Close Tracker — header layout
  closeHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: tokens.spacingHorizontalXL,
  },
  closeTitleGroup: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  closeMiniKpis: {
    display: 'flex',
    gap: tokens.spacingHorizontalXL,
  },
  closeMiniKpi: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    minWidth: '80px',
  },
  closeMiniKpiLabel: {
    fontSize: '10px',
    fontWeight: tokens.fontWeightSemibold,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: tokens.colorNeutralForeground3,
  },
  closeMiniKpiValue: {
    fontSize: '20px',
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: '1.2',
    fontVariantNumeric: 'tabular-nums',
  },
  closeMiniBar: {
    height: '3px',
    borderRadius: '2px',
    backgroundColor: tokens.colorNeutralBackground4,
    overflow: 'hidden',
    width: '100%',
    marginTop: '2px',
  },
  closeMiniBarUnit: {
    fontSize: '10px',
    color: tokens.colorNeutralForeground3,
  },

  // Period Close Tracker — table
  closeTable: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  closeThead: {
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
  },
  closeTh: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    textAlign: 'left',
    fontSize: '11px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    whiteSpace: 'nowrap',
  },
  closeTr: {
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: 'pointer',
    transition: 'background 0.12s',
    '&:last-child': { borderBottom: 'none' },
    '&:hover': { backgroundColor: tokens.colorNeutralBackground2 },
  },
  closeTd: {
    padding: `0 ${tokens.spacingHorizontalM}`,
    verticalAlign: 'middle',
    fontSize: tokens.fontSizeBase300,
    height: '38px',
    fontVariantNumeric: 'tabular-nums',
  },
  closeCcName: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  closeInlineBar: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  closeInlineBarTrack: {
    width: '40px',
    height: '3px',
    borderRadius: '2px',
    backgroundColor: tokens.colorNeutralBackground4,
    overflow: 'hidden',
    display: 'inline-block',
    verticalAlign: 'middle',
  },

  sectionTitleGroup: {
    display: 'flex',
    flexDirection: 'column',
  },
  sectionSubtitle: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
    marginTop: '2px',
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

// ─── component ────────────────────────────────────────────────────────────────

export function FinanceDashboard({ demandLines, periods }: Props) {
  const styles = useStyles();
  const navigate = useNavigate();
  const { selectedPeriodId, selectedPeriod } = usePeriod();
  const { showApiError } = useToast();

  const [costs, setCosts]               = useState<ConsolidatedCostResponse | null>(null);
  const [costsLoading, setCostsLoading] = useState(false);
  const [actualRows, setActualRows]     = useState<FinanceActualRow[]>([]);
  const [dataLoading, setDataLoading]   = useState(false);

  // Resolve current period: prefer context, fall back to earliest open period from props
  const currentPeriod = useMemo(
    () => selectedPeriod
      ?? [...periods]
          .filter(p => p.status === 'open')
          .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)[0]
      ?? null,
    [selectedPeriod, periods],
  );

  // Fetch consolidated costs (KPI strip)
  useEffect(() => {
    setCostsLoading(true);
    getConsolidatedCosts()
      .then(setCosts)
      .catch(err => showApiError(err as Error, 'Failed to load cost data'))
      .finally(() => setCostsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch actuals for period close tracker
  useEffect(() => {
    if (!currentPeriod) return;
    setDataLoading(true);
    const params = new URLSearchParams({
      year:  String(currentPeriod.year),
      month: String(currentPeriod.month),
    });
    apiClient.get<FinanceActualRow[]>(`/finance/actuals-dashboard?${params.toString()}`)
      .then(rows => setActualRows(rows))
      .catch(err => showApiError(err as Error, 'Failed to load actuals data'))
      .finally(() => setDataLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPeriod?.id, selectedPeriodId]);

  // ── Section 1: KPI Strip ──────────────────────────────────────────────────────

  const costRows = costs?.data ?? [];

  const currentPeriodRows = useMemo(
    () => currentPeriod
      ? costRows.filter(r => r.year === currentPeriod.year && r.month === currentPeriod.month)
      : [],
    [costRows, currentPeriod],
  );
  const periodPlannedLabor    = useMemo(() => currentPeriodRows.reduce((s, r) => s + r.demand_cost, 0), [currentPeriodRows]);
  const periodActualLabor     = useMemo(() => currentPeriodRows.reduce((s, r) => s + r.actuals_cost, 0), [currentPeriodRows]);
  const periodOoP             = useMemo(() => currentPeriodRows.reduce((s, r) => s + r.externals_cost / 100, 0), [currentPeriodRows]);
  const periodEquipment       = useMemo(() => currentPeriodRows.reduce((s, r) => s + r.equipment_cost / 100, 0), [currentPeriodRows]);
  const periodActualVsPlanPct = periodPlannedLabor > 0 ? (periodActualLabor / periodPlannedLabor) * 100 : 0;
  const totalPeriod           = periodPlannedLabor + periodOoP + periodEquipment;

  // ── Section 2: Period Close Tracker ──────────────────────────────────────────

  // Demand employees per CC (employees with active demand for this period)
  const pd = useMemo(
    () => currentPeriod ? demandLines.filter(d => d.period_id === currentPeriod.id) : [],
    [demandLines, currentPeriod],
  );

  const demandPerCC = useMemo(() => {
    const map = new Map<string, { ccName: string; employees: Set<string> }>();
    pd.forEach(d => {
      if (!d.resource_id || !d.cost_center_id) return;
      const ex = map.get(d.cost_center_id);
      if (ex) ex.employees.add(d.resource_id);
      else map.set(d.cost_center_id, { ccName: d.cost_center_name ?? d.cost_center_id, employees: new Set([d.resource_id]) });
    });
    return map;
  }, [pd]);

  const closePerCC = useMemo(() => {
    const map = new Map<string, {
      ccName: string;
      submittedEmps: Set<string>;
      totalLines: number;
      approvedLines: number;
      pendingLines: number;
      pendingApprovers: Set<string>;
    }>();
    actualRows.forEach(r => {
      const isApproved = r.approval_status?.toUpperCase() === 'APPROVED';
      const isPending  = r.approval_status?.toUpperCase() === 'PENDING';
      const ex = map.get(r.cost_center_id);
      if (ex) {
        ex.submittedEmps.add(r.employee_email);
        ex.totalLines++;
        if (isApproved) ex.approvedLines++;
        if (isPending)  { ex.pendingLines++; if (r.current_approver_name) ex.pendingApprovers.add(r.current_approver_name); }
      } else {
        map.set(r.cost_center_id, {
          ccName: r.cost_center_name,
          submittedEmps: new Set([r.employee_email]),
          totalLines: 1,
          approvedLines: isApproved ? 1 : 0,
          pendingLines:  isPending  ? 1 : 0,
          pendingApprovers: new Set(isPending && r.current_approver_name ? [r.current_approver_name] : []),
        });
      }
    });
    return map;
  }, [actualRows]);

  const closeCCRows = useMemo(() => {
    const allCCIds = new Set([...demandPerCC.keys(), ...closePerCC.keys()]);
    return Array.from(allCCIds).map(ccId => {
      const demand = demandPerCC.get(ccId);
      const close  = closePerCC.get(ccId);
      const ccName        = demand?.ccName ?? close?.ccName ?? ccId;
      const totalEmps     = demand?.employees.size ?? 0;
      const submittedEmps = close?.submittedEmps.size ?? 0;
      const missing       = Math.max(0, totalEmps - submittedEmps);
      const totalLines    = close?.totalLines ?? 0;
      const approvedLines = close?.approvedLines ?? 0;
      const pendingLines  = close?.pendingLines ?? 0;

      // Sort: most missing first, then pending, then complete, then not started
      const sortKey = missing > 0 ? 0 : pendingLines > 0 ? 1 : submittedEmps > 0 ? 2 : 3;

      return { ccId, ccName, totalEmps, submittedEmps, missing, totalLines, approvedLines, pendingLines, sortKey };
    }).sort((a, b) => a.sortKey - b.sortKey);
  }, [demandPerCC, closePerCC]);

  // Global KPI totals
  const globalTotalEmps = useMemo(() => {
    const s = new Set<string>();
    pd.filter(d => d.resource_id).forEach(d => s.add(d.resource_id!));
    return s.size;
  }, [pd]);
  const globalSubmittedEmps = useMemo(() => {
    const s = new Set<string>();
    actualRows.forEach(r => s.add(r.employee_email));
    return s.size;
  }, [actualRows]);
  const globalApprovedLines = useMemo(
    () => actualRows.filter(r => r.approval_status?.toUpperCase() === 'APPROVED').length,
    [actualRows],
  );
  const globalTotalLines  = actualRows.length;
  const globalMissing     = Math.max(0, globalTotalEmps - globalSubmittedEmps);
  const globalBlockedMgrs = useMemo(() => {
    const s = new Set<string>();
    actualRows
      .filter(r => r.approval_status?.toUpperCase() === 'PENDING' && r.current_approver_name)
      .forEach(r => s.add(r.current_approver_name!));
    return s.size;
  }, [actualRows]);

  // ── Render ────────────────────────────────────────────────────────────────────

  const periodLabel = currentPeriod
    ? `${MONTH_SHORT[currentPeriod.month - 1]} ${currentPeriod.year}`
    : '—';

  return (
    <div className={styles.sections}>

      {/* ── Section 1: KPI Strip ── */}
      <div className={styles.kpiStrip}>

        {/* Planned Labor */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Planned Labor</div>
          <div className={styles.kpiValue} style={{ color: tokens.colorNeutralForeground1 }}>
            {costsLoading ? '—' : formatDKK(periodPlannedLabor)}
          </div>
          <div className={styles.kpiSub}>{periodLabel}</div>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: '100%', backgroundColor: tokens.colorBrandBackground }} />
          </div>
        </div>

        {/* Actual Labor */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Actual Labor</div>
          <div className={styles.kpiValue} style={{
            color: periodActualLabor === 0
              ? tokens.colorNeutralForeground3
              : periodActualVsPlanPct > 110 ? SEV_FG.bad : periodActualVsPlanPct > 105 ? SEV_FG.warn : SEV_FG.good,
          }}>
            {costsLoading ? '—' : formatDKK(periodActualLabor)}
          </div>
          <div className={styles.kpiSub} style={periodActualLabor > 0 ? {
            color: periodActualVsPlanPct > 110 ? SEV_FG.bad : periodActualVsPlanPct > 105 ? SEV_FG.warn : SEV_FG.good,
            fontWeight: tokens.fontWeightSemibold,
          } : {}}>
            {costsLoading ? '' : periodActualLabor === 0
              ? 'No actuals reported yet'
              : `${Math.round(periodActualVsPlanPct)}% of planned`}
          </div>
          {periodActualLabor > 0 && (
            <div className={styles.barTrack}>
              <div className={styles.barFill} style={{
                width: `${Math.min(periodActualVsPlanPct, 100)}%`,
                backgroundColor: periodActualVsPlanPct > 110 ? SEV_BAR.bad : periodActualVsPlanPct > 105 ? SEV_BAR.warn : SEV_BAR.good,
              }} />
            </div>
          )}
        </div>

        {/* OoP */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>OoP</div>
          <div className={styles.kpiValue} style={{ color: tokens.colorNeutralForeground1 }}>
            {costsLoading ? '—' : formatDKK(periodOoP)}
          </div>
          <div className={styles.kpiSub}>Out-of-pocket costs</div>
        </div>

        {/* Equipment */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Equipment</div>
          <div className={styles.kpiValue} style={{ color: tokens.colorNeutralForeground1 }}>
            {costsLoading ? '—' : formatDKK(periodEquipment)}
          </div>
          <div className={styles.kpiSub}>Equipment costs</div>
        </div>

        {/* Total Period */}
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Total Period</div>
          <div className={styles.kpiValue} style={{ color: tokens.colorNeutralForeground1 }}>
            {costsLoading ? '—' : formatDKK(totalPeriod)}
          </div>
          <div className={styles.kpiSub}>{periodLabel} · all categories</div>
          {!costsLoading && totalPeriod > 0 && (
            <div className={styles.barTrack}>
              {[
                { cost: periodPlannedLabor, color: SEV_BAR.good },
                { cost: periodOoP,          color: tokens.colorBrandBackground2 },
                { cost: periodEquipment,    color: SEV_BAR.warn },
              ].map((seg, i) => (
                <div key={i} className={styles.barFill} style={{
                  width: `${(seg.cost / totalPeriod) * 100}%`,
                  backgroundColor: seg.color,
                }} />
              ))}
            </div>
          )}
        </div>

      </div>

      {/* ── Section 2: Period Close Tracker ── */}
      <DashboardSection
        title={
          <div className={styles.closeHeader}>
            <div className={styles.closeTitleGroup}>
              <span>Period Close · {periodLabel}</span>
              <span className={styles.sectionSubtitle}>Actuals submission &amp; approval progress</span>
            </div>
            <div className={styles.closeMiniKpis}>

              {/* SUBMITTED */}
              <div className={styles.closeMiniKpi}>
                <span className={styles.closeMiniKpiLabel}>Submitted</span>
                <span className={styles.closeMiniKpiValue} style={{ color: SEV_FG.good }}>
                  {globalSubmittedEmps}/{globalTotalEmps}
                </span>
                <div className={styles.closeMiniBar}>
                  <div style={{
                    height: '100%',
                    width: globalTotalEmps > 0 ? `${(globalSubmittedEmps / globalTotalEmps) * 100}%` : '0%',
                    backgroundColor: SEV_BAR.good,
                    borderRadius: '2px',
                  }} />
                </div>
                <span className={styles.closeMiniBarUnit}>employees</span>
              </div>

              {/* APPROVED */}
              <div className={styles.closeMiniKpi}>
                <span className={styles.closeMiniKpiLabel}>Approved</span>
                <span className={styles.closeMiniKpiValue} style={{
                  color: globalApprovedLines === globalTotalLines && globalTotalLines > 0 ? SEV_FG.good : tokens.colorNeutralForeground1,
                }}>
                  {globalApprovedLines}/{globalTotalLines}
                </span>
                <div className={styles.closeMiniBar}>
                  <div style={{
                    height: '100%',
                    width: globalTotalLines > 0 ? `${(globalApprovedLines / globalTotalLines) * 100}%` : '0%',
                    backgroundColor: SEV_BAR.good,
                    borderRadius: '2px',
                  }} />
                </div>
                <span className={styles.closeMiniBarUnit}>lines</span>
              </div>

              {/* MISSING */}
              <div className={styles.closeMiniKpi}>
                <span className={styles.closeMiniKpiLabel}>Missing</span>
                <span className={styles.closeMiniKpiValue} style={{ color: globalMissing > 0 ? SEV_FG.bad : SEV_FG.good }}>
                  {globalMissing}
                </span>
                <div className={styles.closeMiniBar}>
                  <div style={{
                    height: '100%',
                    width: globalTotalEmps > 0 ? `${(globalMissing / globalTotalEmps) * 100}%` : '0%',
                    backgroundColor: globalMissing > 0 ? SEV_BAR.bad : SEV_BAR.good,
                    borderRadius: '2px',
                  }} />
                </div>
                <span className={styles.closeMiniBarUnit}>employees</span>
              </div>

              {/* BLOCKED BY */}
              <div className={styles.closeMiniKpi}>
                <span className={styles.closeMiniKpiLabel}>Blocked By</span>
                <span className={styles.closeMiniKpiValue} style={{ color: globalBlockedMgrs > 0 ? SEV_FG.purple : SEV_FG.good }}>
                  {globalBlockedMgrs}
                </span>
                <div className={styles.closeMiniBar}>
                  <div style={{
                    height: '100%',
                    width: globalBlockedMgrs > 0 ? '100%' : '0%',
                    backgroundColor: globalBlockedMgrs > 0 ? SEV_BAR.purple : SEV_BAR.good,
                    borderRadius: '2px',
                  }} />
                </div>
                <span className={styles.closeMiniBarUnit}>managers</span>
              </div>

            </div>
          </div>
        }
      >
        {dataLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: tokens.spacingVerticalL }}>
            <Spinner size="small" />
          </div>
        ) : closeCCRows.length === 0 ? (
          <div style={{ textAlign: 'center', color: tokens.colorNeutralForeground3, padding: `${tokens.spacingVerticalXL} 0` }}>
            No cost center data available
          </div>
        ) : (
          <table className={styles.closeTable}>
            <thead className={styles.closeThead}>
              <tr>
                <th style={{ width: '3px', padding: 0 }} />
                <th className={styles.closeTh}>Cost Center</th>
                <th className={styles.closeTh}>Submitted</th>
                <th className={styles.closeTh}>Approved</th>
                <th className={styles.closeTh}>Missing</th>
                <th className={styles.closeTh}>Status</th>
              </tr>
            </thead>
            <tbody>
              {closeCCRows.map(row => {
                const accentColor = row.missing > 0
                  ? SEV_BAR.bad
                  : row.pendingLines > 0
                    ? SEV_BAR.purple
                    : row.submittedEmps > 0
                      ? SEV_BAR.good
                      : tokens.colorNeutralBackground4;

                const statusText = row.submittedEmps === 0 && row.totalEmps === 0
                  ? 'Not started'
                  : row.submittedEmps === row.totalEmps && row.pendingLines === 0 && row.approvedLines === row.totalLines && row.totalLines > 0
                    ? 'Complete ✓'
                  : row.submittedEmps === row.totalEmps && row.totalEmps > 0 && row.pendingLines > 0
                    ? `${row.pendingLines} pending approval`
                  : row.missing > 0 && row.pendingLines > 0
                    ? `${row.missing} awaiting submission, ${row.pendingLines} pending`
                  : row.missing > 0
                    ? `${row.missing} awaiting submission`
                  : row.pendingLines > 0
                    ? `${row.pendingLines} pending approval`
                    : 'Not started';

                const statusColor = statusText === 'Complete ✓'
                  ? SEV_FG.good
                  : statusText === 'Not started'
                    ? tokens.colorNeutralForeground3
                    : row.missing > 0
                      ? SEV_FG.bad
                      : SEV_FG.purple;

                const submittedPct = row.totalEmps > 0 ? (row.submittedEmps / row.totalEmps) * 100 : 0;

                return (
                  <tr key={row.ccId} className={styles.closeTr} onClick={() => navigate('/actuals')}>
                    <td style={{ padding: 0, width: '3px', verticalAlign: 'middle' }}>
                      <div style={{ width: '3px', height: '38px', backgroundColor: accentColor, borderRadius: '0 2px 2px 0' }} />
                    </td>
                    <td className={styles.closeTd}>
                      <span className={styles.closeCcName}>{row.ccName}</span>
                    </td>
                    <td className={styles.closeTd}>
                      <div className={styles.closeInlineBar}>
                        <span style={{ color: row.submittedEmps === row.totalEmps && row.totalEmps > 0 ? SEV_FG.good : tokens.colorNeutralForeground1 }}>
                          {row.submittedEmps}/{row.totalEmps}
                          {row.submittedEmps === row.totalEmps && row.totalEmps > 0 ? ' ✓' : ''}
                        </span>
                        <span className={styles.closeInlineBarTrack}>
                          <span style={{ display: 'block', height: '100%', width: `${submittedPct}%`, backgroundColor: SEV_BAR.good, borderRadius: '2px' }} />
                        </span>
                      </div>
                    </td>
                    <td className={styles.closeTd}>
                      <span style={{ color: row.approvedLines === row.totalLines && row.totalLines > 0 ? SEV_FG.good : tokens.colorNeutralForeground1 }}>
                        {row.approvedLines}/{row.totalLines}
                      </span>
                    </td>
                    <td className={styles.closeTd}>
                      <span style={{
                        color: row.missing > 0 ? SEV_FG.bad : tokens.colorNeutralForeground3,
                        fontWeight: row.missing > 0 ? tokens.fontWeightSemibold : tokens.fontWeightRegular,
                      }}>
                        {row.missing > 0 ? row.missing : '—'}
                      </span>
                    </td>
                    <td className={styles.closeTd}>
                      <span style={{ color: statusColor, fontSize: '12px' }}>{statusText}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </DashboardSection>

      {/* ── Section 3: Finance Overview ── */}
      <DashboardSection
        title={
          <div>
            <div>Resource Allocation Overview</div>
            <div className={styles.financeSubtitle}>Full staffing and cost center detail</div>
          </div>
        }
      >
        <FinanceOverview scope="finance" />
      </DashboardSection>

    </div>
  );
}
