import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  makeStyles,
  tokens,
  Badge,
  Button,
  Skeleton,
  SkeletonItem,
  Spinner,
} from '@fluentui/react-components';
import { Edit16Regular } from '@fluentui/react-icons';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { DashboardKPIStrip, KPIStripItem } from '../shared/DashboardKPIStrip';
import { DashboardSection } from './DashboardSection';
import { actualsApi, ActualLine, ActualApprovalStatus } from '../../api/actuals';
import { planningApi, DemandLine, SupplyLine } from '../../api/planning';
import { useAppData } from '../../contexts/AppDataContext';
import { useToast } from '../../hooks/useToast';
import type { Period, MeResponse } from '../../types/index';
import { MONTH_SHORT } from '../../utils/format';

const DEMAND_COLOR = '#d97706';
const SUPPLY_COLOR = '#0d9488';
const ACTUALS_COLOR = '#1e3a5f';

const useStyles = makeStyles({
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  emptyState: {
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
    padding: `${tokens.spacingVerticalXL} 0`,
    fontSize: tokens.fontSizeBase300,
  },
  chartWrap: { width: '100%' },
  matrixScroll: { overflowX: 'auto' },
  matrixTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  matrixTh: {
    padding: '8px 12px',
    textAlign: 'right',
    fontWeight: tokens.fontWeightSemibold,
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    whiteSpace: 'nowrap',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  matrixThProject: {
    textAlign: 'left',
    position: 'sticky',
    left: '0',
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: '1',
  },
  matrixThType: {
    textAlign: 'left',
    position: 'sticky',
    left: '140px',
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: '1',
    minWidth: '90px',
  },
  matrixThCurrent: {
    backgroundColor: 'rgba(13, 148, 136, 0.06)',
  },
  matrixTd: {
    padding: '3px 12px',
    textAlign: 'right',
    fontFamily: 'monospace',
    verticalAlign: 'middle',
    height: '28px',
  },
  matrixTdProject: {
    padding: '0 8px 0 12px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    whiteSpace: 'nowrap',
    position: 'sticky',
    left: '0',
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: '1',
    verticalAlign: 'top',
    paddingTop: '8px',
    minWidth: '140px',
    maxWidth: '180px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  matrixTdType: {
    padding: '3px 8px',
    verticalAlign: 'middle',
    height: '28px',
    position: 'sticky',
    left: '140px',
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: '1',
    whiteSpace: 'nowrap',
  },
  matrixTdCurrent: {
    backgroundColor: 'rgba(13, 148, 136, 0.06)',
  },
  matrixTdActualsCurrent: {
    backgroundColor: 'rgba(30, 58, 95, 0.06)',
  },
  matrixTdTypeCurrent: {
    backgroundColor: 'rgba(13, 148, 136, 0.06)',
  },
  matrixTdTypeActualsCurrent: {
    backgroundColor: 'rgba(30, 58, 95, 0.06)',
  },
  matrixGroupBorder: {
    borderTop: `2px solid ${tokens.colorNeutralStroke1}`,
  },
  matrixTotalRow: {
    borderTop: `2px solid ${tokens.colorNeutralStroke1}`,
  },
  matrixTotalTdProject: {
    padding: '8px 12px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    fontSize: '11px',
    letterSpacing: '0.5px',
    position: 'sticky',
    left: '0',
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: '1',
  },
  matrixTotalTdType: {
    position: 'sticky',
    left: '140px',
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: '1',
  },
  matrixTotalTd: {
    padding: '6px 12px',
    textAlign: 'right',
    fontFamily: 'monospace',
    fontWeight: tokens.fontWeightSemibold,
    verticalAlign: 'middle',
    lineHeight: '1.5',
  },
  demandVal: { color: DEMAND_COLOR, fontWeight: tokens.fontWeightSemibold },
  supplyVal: { color: SUPPLY_COLOR },
  actualsVal: { color: ACTUALS_COLOR },
  emptyCell: { color: tokens.colorNeutralForeground4 },
  typeLabel: {
    fontSize: '10px',
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    display: 'flex',
    alignItems: 'center',
    gap: '3px',
  },
  actualsInput: {
    width: '58px',
    fontFamily: 'monospace',
    fontSize: '13px',
    textAlign: 'right',
    border: `1px dashed ${tokens.colorNeutralStroke1}`,
    borderRadius: '3px',
    padding: '1px 4px',
    outline: 'none',
    backgroundColor: 'transparent',
    color: ACTUALS_COLOR,
    ':focus': {
      border: `1px solid ${ACTUALS_COLOR}`,
      backgroundColor: '#fff',
    },
  },
  submitRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    paddingTop: tokens.spacingVerticalM,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    marginTop: tokens.spacingVerticalS,
  },
});

interface Props {
  periods: Period[];
  user: MeResponse;
}

function fmtPeriod(p: Period) { return `${MONTH_SHORT[p.month - 1]} ${p.year}`; }

function ApprovalDot({ status }: { status?: string }) {
  if (!status) return null;
  const cfg =
    status === 'approved' ? { color: '#16a34a', title: 'Approved' } :
    status === 'pending'  ? { color: '#d97706', title: 'Pending approval' } :
    status === 'rejected' ? { color: '#dc2626', title: 'Rejected' } :
    null;
  if (!cfg) return null;
  return (
    <span
      title={cfg.title}
      style={{
        display: 'inline-block',
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        backgroundColor: cfg.color,
        marginLeft: '4px',
        verticalAlign: 'middle',
        flexShrink: 0,
      }}
    />
  );
}

export function EmployeeView({ periods }: Props) {
  const styles = useStyles();
  const { showSuccess, showError } = useToast();
  const { myResource, appDataLoading } = useAppData();

  // Derived from context — no per-component fetch needed
  const myResourceId = myResource?.resource_id ?? null;

  const [myDemandLines, setMyDemandLines] = useState<DemandLine[]>([]);
  const [mySupplyLines, setMySupplyLines] = useState<SupplyLine[]>([]);
  const [myActuals, setMyActuals] = useState<ActualLine[]>([]);
  const [myApprovalStatuses, setMyApprovalStatuses] = useState<Record<string, ActualApprovalStatus>>({});
  const [loading, setLoading] = useState(true);

  // Inline edit state for actuals cells — key: `${projectId}:${periodId}`
  const [actualsEdits, setActualsEdits] = useState<Record<string, string>>({});
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [savedCells, setSavedCells] = useState<Set<string>>(new Set());
  const [resubmittedCells, setResubmittedCells] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const openPeriods = useMemo(
    () => [...periods]
      .filter(p => p.status === 'open')
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month),
    [periods],
  );
  const earliestPeriod = openPeriods[0] ?? null;

  useEffect(() => {
    // Wait for context to resolve before fetching volatile data
    if (!periods.length || appDataLoading) { setLoading(appDataLoading); return; }

    const resource_id = myResource?.resource_id ?? null;
    setLoading(true);
    Promise.all([
      resource_id
        ? planningApi.getDemandLines(undefined, { resourceId: resource_id })
        : Promise.resolve([] as DemandLine[]),
      resource_id
        ? planningApi.getSupplyLines(undefined, { resourceId: resource_id })
        : Promise.resolve([] as SupplyLine[]),
      actualsApi.getMyActuals(),          // all periods
      actualsApi.getMyApprovalStatuses(), // all periods
    ])
      .then(([demand, supply, actuals, statuses]) => {
        setMyDemandLines(demand as DemandLine[]);
        setMySupplyLines(supply as SupplyLine[]);
        setMyActuals(actuals as ActualLine[]);
        setMyApprovalStatuses(statuses);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [periods.length, appDataLoading, myResource?.resource_id]);

  const periodName = earliestPeriod ? fmtPeriod(earliestPeriod) : '—';

  // ── Matrix period list (open + locked that have demand) ──────────────────

  const matrixPeriods = useMemo(() => {
    const idsWithDemand = new Set(myDemandLines.map(d => d.period_id));
    return [...periods]
      .filter(p => p.status === 'open' && idsWithDemand.has(p.id))
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
  }, [periods, myDemandLines]);

  const matrixProjects = useMemo(() => {
    const map = new Map<string, string>();
    myDemandLines.forEach(d => {
      if (!map.has(d.project_id)) map.set(d.project_id, d.project_name ?? d.project_id);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [myDemandLines]);

  // ── Lookups ───────────────────────────────────────────────────────────────

  const demandLookup = useMemo(() => {
    const lookup = new Map<string, Map<string, number>>();
    myDemandLines.forEach(d => {
      if (!lookup.has(d.project_id)) lookup.set(d.project_id, new Map());
      lookup.get(d.project_id)!.set(d.period_id, (lookup.get(d.project_id)!.get(d.period_id) ?? 0) + d.fte_percent);
    });
    return lookup;
  }, [myDemandLines]);

  const supplyLookup = useMemo(() => {
    const lookup = new Map<string, Map<string, number>>();
    mySupplyLines.forEach(s => {
      const key = s.project_id ?? '__total__';
      if (!lookup.has(key)) lookup.set(key, new Map());
      lookup.get(key)!.set(s.period_id, (lookup.get(key)!.get(s.period_id) ?? 0) + s.fte_percent);
    });
    return lookup;
  }, [mySupplyLines]);

  // keyed by `${project_id}:${period_id}`
  const actualsLookup = useMemo(() => {
    const lookup = new Map<string, ActualLine>();
    myActuals.forEach(a => lookup.set(`${a.project_id}:${a.period_id}`, a));
    return lookup;
  }, [myActuals]);

  const hasProjectSupply = useMemo(() => mySupplyLines.some(s => !!s.project_id), [mySupplyLines]);

  // ── KPI computations ──────────────────────────────────────────────────────

  const myDemandThisPeriod = useMemo(() => {
    if (!earliestPeriod) return 0;
    return Math.round(
      myDemandLines.filter(d => d.period_id === earliestPeriod.id).reduce((s, d) => s + d.fte_percent, 0) * 10,
    ) / 10;
  }, [myDemandLines, earliestPeriod]);

  const mySupplyThisPeriod = useMemo(() => {
    if (!earliestPeriod) return 0;
    return Math.round(
      mySupplyLines.filter(s => s.period_id === earliestPeriod.id).reduce((s, ln) => s + ln.fte_percent, 0) * 10,
    ) / 10;
  }, [mySupplyLines, earliestPeriod]);

  const demandProjectCount = useMemo(() => {
    if (!earliestPeriod) return 0;
    return new Set(myDemandLines.filter(d => d.period_id === earliestPeriod.id).map(d => d.project_id)).size;
  }, [myDemandLines, earliestPeriod]);

  const actualsStats = useMemo(() => {
    const demandProjectIds = new Set(
      myDemandLines.filter(d => d.period_id === earliestPeriod?.id).map(d => d.project_id),
    );
    const total = demandProjectIds.size;
    const submitted = [...demandProjectIds].filter(pid =>
      myActuals.some(a => a.project_id === pid && a.period_id === earliestPeriod?.id),
    ).length;
    return { total, submitted };
  }, [myDemandLines, myActuals, earliestPeriod]);

  const approvalStats = useMemo(() => {
    const currentPeriodActualIds = new Set(
      myActuals.filter(a => earliestPeriod && a.period_id === earliestPeriod.id).map(a => a.id)
    );
    const statuses = Object.entries(myApprovalStatuses)
      .filter(([id]) => currentPeriodActualIds.has(id))
      .map(([, s]) => s);
    return {
      approved: statuses.filter(s => s.status === 'approved').length,
      pending:  statuses.filter(s => s.status === 'pending').length,
      rejected: statuses.filter(s => s.status === 'rejected').length,
      total:    statuses.length,
    };
  }, [myApprovalStatuses, myActuals, earliestPeriod]);

  const gap = Math.round((myDemandThisPeriod - mySupplyThisPeriod) * 10) / 10;

  const kpiItems: KPIStripItem[] = useMemo(() => {
    const coverPct = myDemandThisPeriod > 0
      ? Math.round((mySupplyThisPeriod / myDemandThisPeriod) * 100)
      : 100;

    const actualsAllSubmitted = actualsStats.total > 0 && actualsStats.submitted === actualsStats.total;
    const actualsSev = actualsAllSubmitted ? 'good' : actualsStats.submitted === 0 ? 'bad' : 'warn';

    const approvalSev = approvalStats.rejected > 0 ? 'bad'
      : approvalStats.pending > 0 ? 'pending'
      : approvalStats.approved > 0 ? 'good'
      : 'default';

    const gapSev = Math.abs(gap) < 1 ? 'good' : gap > 0 ? 'bad' : 'warn';
    const gapSubtitle = Math.abs(gap) < 1 ? 'Balanced' : gap > 0 ? 'Understaffed' : 'Over-allocated';

    return [
      {
        label: 'My Demand',
        value: `${myDemandThisPeriod}%`,
        subtitle: `across ${demandProjectCount} project${demandProjectCount !== 1 ? 's' : ''}`,
      },
      {
        label: 'My Supply',
        value: `${mySupplyThisPeriod}%`,
        subtitle: `${coverPct}% of demand covered`,
      },
      {
        label: 'Actuals Submitted',
        value: `${actualsStats.submitted} / ${actualsStats.total} lines`,
        subtitle: periodName,
        severity: actualsSev,
        bar: actualsStats.total > 0 ? {
          fill: (actualsStats.submitted / actualsStats.total) * 100,
          fillSev: actualsSev,
        } : undefined,
      },
      {
        label: 'Approval Status',
        value: approvalStats.total > 0
          ? <span style={{ fontSize: '17px', letterSpacing: '-0.3px' }}>
              {approvalStats.approved} approved · {approvalStats.pending} pending · {approvalStats.rejected} rejected
            </span>
          : 'None',
        subtitle: approvalStats.total > 0
          ? approvalStats.rejected > 0 ? 'Has rejections'
          : approvalStats.pending > 0 ? 'Awaiting approval'
          : 'All approved'
          : 'No lines submitted',
        severity: approvalSev,
      },
      {
        label: 'My Gap',
        value: gap === 0 ? '0%' : `${gap > 0 ? '+' : ''}${gap}%`,
        subtitle: gapSubtitle,
        severity: gapSev,
      },
    ] satisfies KPIStripItem[];
  }, [myDemandThisPeriod, mySupplyThisPeriod, demandProjectCount, actualsStats, approvalStats, gap, periodName]);

  // ── Inline actuals save ───────────────────────────────────────────────────

  const saveActual = useCallback(async (projectId: string, period: Period, rawValue: string) => {
    const cellKey = `${projectId}:${period.id}`;
    const ftePct = parseFloat(rawValue);
    if (rawValue === '' || isNaN(ftePct) || ftePct < 0) {
      setActualsEdits(prev => { const n = { ...prev }; delete n[cellKey]; return n; });
      return;
    }
    if (!myResourceId) return;

    const existing = actualsLookup.get(cellKey);
    const approvalStatus = existing ? myApprovalStatuses[existing.id]?.status : undefined;

    setSavingCells(prev => new Set(prev).add(cellKey));
    try {
      if (existing && approvalStatus === 'rejected') {
        try {
          await actualsApi.resubmitActual(existing.id, ftePct);
        } catch {
          showError('Resubmit failed', 'Could not resubmit — please try again or contact your manager');
          return;
        }

        const [updatedActuals, statuses] = await Promise.all([
          actualsApi.getMyActuals(),
          actualsApi.getMyApprovalStatuses(),
        ]);
        setMyActuals(updatedActuals);
        setMyApprovalStatuses(statuses);
        setActualsEdits(prev => { const n = { ...prev }; delete n[cellKey]; return n; });
        setResubmittedCells(prev => new Set(prev).add(cellKey));
        setTimeout(() => setResubmittedCells(prev => { const n = new Set(prev); n.delete(cellKey); return n; }), 3000);
        return;
      }

      // Non-rejected paths
      if (existing && approvalStatus === 'pending') {
        // Already pending — just update value, signature stays
        await actualsApi.updateActualLine(existing.id, { actual_fte_percent: ftePct });
      } else if (existing) {
        // Existing but unsigned — update then sign
        const updated = await actualsApi.updateActualLine(existing.id, { actual_fte_percent: ftePct });
        try {
          await actualsApi.signActuals(updated.id);
        } catch (signErr) {
          type SignErrShape = { detail?: string | { message?: string }; response?: { data?: { detail?: string | { message?: string } } }; message?: string };
          const se = signErr as SignErrShape;
          const detail = se?.detail ?? se?.response?.data?.detail;
          const msg = (typeof detail === 'string' ? detail : detail?.message ?? se?.message ?? '');
          if (!msg.toLowerCase().includes('already signed')) throw signErr;
        }
      } else {
        // New entry — create then sign; handle 409 (already exists) and already-signed gracefully
        let newLine: ActualLine;
        try {
          newLine = await actualsApi.createActualLine({
            period_id: period.id,
            resource_id: myResourceId,
            project_id: projectId,
            year: period.year,
            month: period.month,
            actual_fte_percent: ftePct,
          });
        } catch (createErr) {
          const ce = createErr as { response?: { status?: number }; status?: number };
          if ((ce?.response?.status ?? ce?.status) === 409) {
            // Backend has the record but local lookup is stale — fetch and update
            const allActuals = await actualsApi.getMyActuals();
            const existingLine = allActuals.find(
              a => a.resource_id === myResourceId && a.period_id === period.id && a.project_id === projectId
            );
            if (!existingLine) throw createErr;
            newLine = await actualsApi.updateActualLine(existingLine.id, { actual_fte_percent: ftePct });
          } else {
            throw createErr;
          }
        }
        try {
          await actualsApi.signActuals(newLine!.id);
        } catch (signErr) {
          type SignErrShape = { detail?: string | { message?: string }; response?: { data?: { detail?: string | { message?: string } } }; message?: string };
          const se = signErr as SignErrShape;
          const detail = se?.detail ?? se?.response?.data?.detail;
          const msg = (typeof detail === 'string' ? detail : detail?.message ?? se?.message ?? '');
          if (!msg.toLowerCase().includes('already signed')) throw signErr;
        }
      }

      // Always refresh after any modification so the lookup stays in sync
      const [refreshedActuals, refreshedStatuses] = await Promise.all([
        actualsApi.getMyActuals(),
        actualsApi.getMyApprovalStatuses(),
      ]);
      setMyActuals(refreshedActuals);
      setMyApprovalStatuses(refreshedStatuses);
      setActualsEdits(prev => { const n = { ...prev }; delete n[cellKey]; return n; });
      setSavedCells(prev => new Set(prev).add(cellKey));
      setTimeout(() => setSavedCells(prev => { const n = new Set(prev); n.delete(cellKey); return n; }), 2000);
    } catch (err) {
      const e = err as { response?: { data?: unknown; status?: number } };
      console.error('ACTUALS SAVE ERROR:', err, e?.response?.data, e?.response?.status);
      showError('Save failed', 'Could not save actuals value. Please try again.');
    } finally {
      setSavingCells(prev => { const n = new Set(prev); n.delete(cellKey); return n; });
    }
  }, [myResourceId, actualsLookup, myApprovalStatuses, showError]);

  // ── Submit (sign) actuals for current period ──────────────────────────────

  const unsignedCurrentActuals = useMemo(() =>
    earliestPeriod
      ? myActuals.filter(a => a.period_id === earliestPeriod.id && !a.employee_signed_at)
      : [],
    [myActuals, earliestPeriod],
  );

  const hasRejectedActuals = useMemo(() =>
    earliestPeriod
      ? myActuals.some(a => a.period_id === earliestPeriod.id && myApprovalStatuses[a.id]?.status === 'rejected')
      : false,
    [myActuals, earliestPeriod, myApprovalStatuses],
  );

  const submitActuals = useCallback(async () => {
    if (!earliestPeriod || unsignedCurrentActuals.length === 0) return;
    setSubmitting(true);
    try {
      await Promise.all(unsignedCurrentActuals.map(a => actualsApi.signActuals(a.id)));
      const [actuals, statuses] = await Promise.all([
        actualsApi.getMyActuals(),
        actualsApi.getMyApprovalStatuses(),
      ]);
      setMyActuals(actuals);
      setMyApprovalStatuses(statuses);
      showSuccess('Actuals submitted', `Your actuals for ${periodName} are pending approval.`);
    } catch {
      showError('Submit failed', 'Could not submit actuals. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [earliestPeriod, unsignedCurrentActuals, periodName, showSuccess, showError]);

  // ── Chart data ────────────────────────────────────────────────────────────

  const chartData = useMemo(() => {
    return matrixPeriods.map(p => {
      const demand = Math.round(
        myDemandLines.filter(d => d.period_id === p.id).reduce((s, d) => s + d.fte_percent, 0) * 10,
      ) / 10;
      const supply = Math.round(
        mySupplyLines.filter(s => s.period_id === p.id).reduce((s, ln) => s + ln.fte_percent, 0) * 10,
      ) / 10;
      const periodActuals = myActuals.filter(a => a.period_id === p.id);
      const actualsTotal = periodActuals.length > 0
        ? Math.round(periodActuals.reduce((s, a) => s + a.actual_fte_percent, 0) * 10) / 10
        : undefined;
      const base = Math.min(demand, supply);
      return {
        label: fmtPeriod(p),
        demand,
        supply,
        actuals: actualsTotal,
        base,
        gap_under: demand > supply ? Math.round((demand - supply) * 10) / 10 : 0,
        gap_over:  supply > demand ? Math.round((supply - demand) * 10) / 10 : 0,
      };
    });
  }, [matrixPeriods, myDemandLines, mySupplyLines, myActuals]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL }}>
        <Skeleton style={{ height: 88 }}><SkeletonItem /></Skeleton>
        <Skeleton style={{ height: 260 }}><SkeletonItem /></Skeleton>
        <Skeleton style={{ height: 200 }}><SkeletonItem /></Skeleton>
      </div>
    );
  }

  return (
    <div className={styles.sections}>
      {/* 5-card KPI row */}
      <DashboardKPIStrip items={kpiItems} />

      {/* Resource planning chart */}
      <DashboardSection title="My Resource Planning Overview">
        {chartData.length === 0 || !myResourceId ? (
          <div className={styles.emptyState}>No planning data available</div>
        ) : (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} unit="%" />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload.find(p => p.dataKey === 'demand')?.value as number | undefined;
                    const s = payload.find(p => p.dataKey === 'supply')?.value as number | undefined;
                    const a = payload.find(p => p.dataKey === 'actuals')?.value as number | undefined;
                    const g = (d ?? 0) - (s ?? 0);
                    const gAbs = Math.abs(Math.round(g * 10) / 10);
                    return (
                      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}>
                        <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{label}</p>
                        {d !== undefined && <p style={{ margin: '2px 0', color: DEMAND_COLOR }}>My Demand: {d}%</p>}
                        {s !== undefined && <p style={{ margin: '2px 0', color: SUPPLY_COLOR }}>My Supply: {s}%</p>}
                        {a !== undefined && <p style={{ margin: '2px 0', color: ACTUALS_COLOR }}>My Actuals: {a}%</p>}
                        {gAbs > 0 && (
                          <p style={{ margin: '4px 0 0', color: g > 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
                            {g > 0 ? `Understaffed: ${gAbs}%` : `Overstaffed: ${gAbs}%`}
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                <Legend
                  formatter={v => v === 'demand' ? 'My Demand' : v === 'supply' ? 'My Supply' : 'My Actuals'}
                />
                <ReferenceLine y={100} stroke="#d1d5db" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="base"      stackId="gap" fill="transparent"           stroke="none" legendType="none" tooltipType="none" isAnimationActive={false} />
                <Area type="monotone" dataKey="gap_under" stackId="gap" fill="rgba(217,119,6,0.08)"  stroke="none" legendType="none" isAnimationActive={false} />
                <Area type="monotone" dataKey="gap_over"  stackId="gap" fill="rgba(13,148,136,0.08)" stroke="none" legendType="none" isAnimationActive={false} />
                <Line type="monotone" dataKey="demand"  stroke={DEMAND_COLOR}  strokeWidth={2.5} dot={false} name="demand"  unit="%" />
                <Line type="monotone" dataKey="supply"  stroke={SUPPLY_COLOR}  strokeWidth={2.5} dot={false} name="supply"  unit="%" />
                <Line type="monotone" dataKey="actuals" stroke={ACTUALS_COLOR} strokeWidth={2.5} dot={{ fill: ACTUALS_COLOR, r: 4 }} connectNulls={false} name="actuals" unit="%" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </DashboardSection>

      {/* Demand assignments matrix with actuals */}
      <DashboardSection
        title="My Demand Assignments"
        action={matrixProjects.length > 0 ? (
          <Badge appearance="filled" color="brand" shape="rounded">
            {matrixProjects.length} project{matrixProjects.length !== 1 ? 's' : ''}
          </Badge>
        ) : undefined}
      >
        {matrixProjects.length === 0 ? (
          <div className={styles.emptyState}>No demand assignments found</div>
        ) : (
          <>
            <div className={styles.matrixScroll}>
              <table className={styles.matrixTable}>
                <thead>
                  <tr>
                    <th className={`${styles.matrixTh} ${styles.matrixThProject}`} style={{ minWidth: 140 }}>Project</th>
                    <th className={`${styles.matrixTh} ${styles.matrixThType}`}>Type</th>
                    {matrixPeriods.map(p => (
                      <th
                        key={p.id}
                        className={`${styles.matrixTh}${p.id === earliestPeriod?.id ? ` ${styles.matrixThCurrent}` : ''}`}
                      >
                        {fmtPeriod(p)}{p.id === earliestPeriod?.id ? ' ●' : ''}
                      </th>
                    ))}
                    <th className={styles.matrixTh}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrixProjects.map((proj, projIdx) => {
                    const demandTotal = matrixPeriods.reduce(
                      (sum, p) => sum + (demandLookup.get(proj.id)?.get(p.id) ?? 0), 0,
                    );

                    return (
                      <>
                        {/* ── DEMAND row ── */}
                        <tr key={`${proj.id}-demand`} className={projIdx > 0 ? styles.matrixGroupBorder : undefined}>
                          <td
                            rowSpan={3}
                            className={styles.matrixTdProject}
                            title={proj.name}
                          >
                            {proj.name}
                          </td>
                          <td className={`${styles.matrixTdType}`}>
                            <span className={styles.typeLabel} style={{ color: DEMAND_COLOR }}>
                              Demand
                            </span>
                          </td>
                          {matrixPeriods.map(p => {
                            const dVal = demandLookup.get(proj.id)?.get(p.id);
                            const isCurrent = p.id === earliestPeriod?.id;
                            return (
                              <td key={p.id} className={`${styles.matrixTd}${isCurrent ? ` ${styles.matrixTdCurrent}` : ''}`}>
                                {dVal !== undefined
                                  ? <span className={styles.demandVal}>{Math.round(dVal)}%</span>
                                  : <span className={styles.emptyCell}>—</span>}
                              </td>
                            );
                          })}
                          <td className={styles.matrixTd}>
                            <span className={styles.demandVal}>{Math.round(demandTotal)}%</span>
                          </td>
                        </tr>

                        {/* ── SUPPLY row ── */}
                        <tr key={`${proj.id}-supply`}>
                          <td className={styles.matrixTdType}>
                            <span className={styles.typeLabel} style={{ color: SUPPLY_COLOR }}>
                              Supply
                            </span>
                          </td>
                          {matrixPeriods.map(p => {
                            const sVal = hasProjectSupply ? supplyLookup.get(proj.id)?.get(p.id) : undefined;
                            const isCurrent = p.id === earliestPeriod?.id;
                            return (
                              <td key={p.id} className={`${styles.matrixTd}${isCurrent ? ` ${styles.matrixTdCurrent}` : ''}`}>
                                {sVal !== undefined
                                  ? <span className={styles.supplyVal}>{Math.round(sVal)}%</span>
                                  : <span className={styles.emptyCell}>—</span>}
                              </td>
                            );
                          })}
                          <td className={styles.matrixTd}>
                            {hasProjectSupply && (() => {
                              const supplyTotal = matrixPeriods.reduce(
                                (sum, p) => sum + (supplyLookup.get(proj.id)?.get(p.id) ?? 0), 0,
                              );
                              return <span className={styles.supplyVal}>{Math.round(supplyTotal)}%</span>;
                            })()}
                          </td>
                        </tr>

                        {/* ── ACTUALS row ── */}
                        <tr key={`${proj.id}-actuals`}>
                          <td
                            className={styles.matrixTdType}
                            style={{
                              backgroundColor: 'rgba(30, 58, 95, 0.05)',
                              boxShadow: `inset 3px 0 0 ${ACTUALS_COLOR}`,
                            }}
                          >
                            <span className={styles.typeLabel} style={{ color: ACTUALS_COLOR }}>
                              <Edit16Regular style={{ fontSize: 11 }} />
                              Actuals
                            </span>
                          </td>
                          {matrixPeriods.map(p => {
                            const cellKey = `${proj.id}:${p.id}`;
                            const actual = actualsLookup.get(cellKey);
                            const isCurrent = p.id === earliestPeriod?.id;
                            const approvalStatus = actual ? myApprovalStatuses[actual.id] : undefined;
                            const isSaving = savingCells.has(cellKey);
                            const isSaved = savedCells.has(cellKey);
                            const isResubmitted = resubmittedCells.has(cellKey);
                            const approvalStatusStr = approvalStatus?.status;
                            const isApproved = approvalStatusStr === 'approved';
                            const isPending = approvalStatusStr === 'pending';
                            const isRejected = approvalStatusStr === 'rejected';
                            const canEdit = isCurrent && !isApproved;

                            if (canEdit) {
                              const editVal = actualsEdits[cellKey] ?? (actual?.actual_fte_percent?.toString() ?? '');
                              const cellBg = isPending ? 'rgba(91, 72, 146, 0.10)'
                                           : isRejected ? 'rgba(246, 218, 215, 0.15)'
                                           : 'rgba(30, 58, 95, 0.06)';
                              const borderLeft = isPending ? '2px solid #5b4892'
                                              : isRejected ? '2px solid #a32f2a'
                                              : undefined;
                              const tooltipText = isPending ? 'Click to edit — pending approval'
                                               : isRejected ? 'Rejected — click to edit and resubmit'
                                               : actual ? undefined
                                               : 'Click to enter actuals';
                              return (
                                <td
                                  key={p.id}
                                  className={styles.matrixTd}
                                  style={{ backgroundColor: cellBg, borderLeft, position: 'relative' }}
                                >
                                  <span title={tooltipText} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                                    {isPending && <span style={{ fontSize: 10, color: '#5b4892', lineHeight: 1 }}>✏</span>}
                                    {isRejected && <span style={{ fontSize: 10, color: '#a32f2a', lineHeight: 1 }}>⚠</span>}
                                    {isSaving ? (
                                      <Spinner size="extra-tiny" />
                                    ) : isResubmitted && !actualsEdits[cellKey] ? (
                                      <span style={{ color: '#5b4892', fontSize: 11 }}>✓ Resubmitted</span>
                                    ) : isSaved && !actualsEdits[cellKey] ? (
                                      <span style={{ color: '#16a34a', fontSize: 11 }}>✓</span>
                                    ) : null}
                                    <input
                                      className={styles.actualsInput}
                                      type="number"
                                      min="0"
                                      max="200"
                                      step="5"
                                      value={editVal}
                                      placeholder="—"
                                      onChange={e => setActualsEdits(prev => ({ ...prev, [cellKey]: e.target.value }))}
                                      onBlur={() => saveActual(proj.id, p, actualsEdits[cellKey] ?? editVal)}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                          (e.target as HTMLInputElement).blur();
                                        }
                                      }}
                                      style={{
                                        borderColor: !editVal && !actual ? `${ACTUALS_COLOR}55` : undefined,
                                        borderStyle: !editVal && !actual ? 'dashed' : undefined,
                                      }}
                                    />
                                    <span style={{ color: ACTUALS_COLOR, fontSize: 12 }}>%</span>
                                  </span>
                                </td>
                              );
                            } else if (isCurrent && isApproved) {
                              // Approved — read-only, no editing allowed
                              return (
                                <td
                                  key={p.id}
                                  className={styles.matrixTd}
                                  style={{ backgroundColor: 'rgba(227, 239, 231, 0.25)', cursor: 'default' }}
                                >
                                  <span title="Approved — cannot be edited" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }}>
                                    {actual !== undefined ? (
                                      <span className={styles.actualsVal}>{actual.actual_fte_percent}%</span>
                                    ) : (
                                      <span className={styles.emptyCell}>—</span>
                                    )}
                                    <span style={{ color: '#16a34a', fontSize: 12 }}>✓</span>
                                  </span>
                                </td>
                              );
                            } else {
                              // Future open period — read-only
                              return (
                                <td key={p.id} className={styles.matrixTd} style={{ cursor: 'default' }}>
                                  {actual !== undefined ? (
                                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }}>
                                      <span className={styles.actualsVal}>{actual.actual_fte_percent}%</span>
                                      {approvalStatusStr && <ApprovalDot status={approvalStatusStr} />}
                                    </span>
                                  ) : (
                                    <span className={styles.emptyCell}>—</span>
                                  )}
                                </td>
                              );
                            }
                          })}
                          <td className={styles.matrixTd} style={{ backgroundColor: 'rgba(30, 58, 95, 0.03)' }}>
                            {/* Actuals total across all periods for this project */}
                            {(() => {
                              const aTotal = matrixPeriods.reduce((sum, p) => {
                                const a = actualsLookup.get(`${proj.id}:${p.id}`);
                                return sum + (a?.actual_fte_percent ?? 0);
                              }, 0);
                              return aTotal > 0
                                ? <span className={styles.actualsVal}>{Math.round(aTotal * 10) / 10}%</span>
                                : <span className={styles.emptyCell}>—</span>;
                            })()}
                          </td>
                        </tr>
                      </>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className={styles.matrixTotalRow}>
                    <td className={styles.matrixTotalTdProject}>Total</td>
                    <td className={styles.matrixTotalTdType} />
                    {matrixPeriods.map(p => {
                      const dTotal = matrixProjects.reduce(
                        (sum, proj) => sum + (demandLookup.get(proj.id)?.get(p.id) ?? 0), 0,
                      );
                      const sTotal = matrixProjects.reduce(
                        (sum, proj) => sum + (supplyLookup.get(proj.id)?.get(p.id) ?? 0), 0,
                      );
                      const aTotal = matrixProjects.reduce((sum, proj) => {
                        const a = actualsLookup.get(`${proj.id}:${p.id}`);
                        return sum + (a?.actual_fte_percent ?? 0);
                      }, 0);
                      const isCurrent = p.id === earliestPeriod?.id;
                      return (
                        <td
                          key={p.id}
                          className={`${styles.matrixTotalTd}${isCurrent ? ` ${styles.matrixTdCurrent}` : ''}`}
                        >
                          {dTotal > 0 && <div style={{ color: DEMAND_COLOR, fontSize: 11 }}>D: {Math.round(dTotal)}%</div>}
                          {sTotal > 0 && <div style={{ color: SUPPLY_COLOR, fontSize: 11 }}>S: {Math.round(sTotal)}%</div>}
                          {aTotal > 0 && <div style={{ color: ACTUALS_COLOR, fontSize: 11 }}>A: {Math.round(aTotal)}%</div>}
                          {dTotal === 0 && <span className={styles.emptyCell}>—</span>}
                        </td>
                      );
                    })}
                    <td className={styles.matrixTotalTd}>
                      {(() => {
                        const grandD = matrixProjects.reduce(
                          (sum, proj) => sum + matrixPeriods.reduce(
                            (s, p) => s + (demandLookup.get(proj.id)?.get(p.id) ?? 0), 0,
                          ), 0,
                        );
                        const grandA = matrixProjects.reduce(
                          (sum, proj) => sum + matrixPeriods.reduce((s, p) => {
                            const a = actualsLookup.get(`${proj.id}:${p.id}`);
                            return s + (a?.actual_fte_percent ?? 0);
                          }, 0), 0,
                        );
                        return (
                          <>
                            <div style={{ color: DEMAND_COLOR, fontSize: 11 }}>D: {Math.round(grandD)}%</div>
                            {grandA > 0 && <div style={{ color: ACTUALS_COLOR, fontSize: 11 }}>A: {Math.round(grandA)}%</div>}
                          </>
                        );
                      })()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Submit actuals button */}
            {earliestPeriod && (
              <div className={styles.submitRow}>
                <Button
                  appearance="primary"
                  disabled={(unsignedCurrentActuals.length === 0 && !hasRejectedActuals) || submitting}
                  onClick={submitActuals}
                  icon={submitting ? <Spinner size="tiny" /> : undefined}
                  style={{ backgroundColor: ACTUALS_COLOR, border: 'none' }}
                >
                  {hasRejectedActuals ? 'Resubmit Actuals' : 'Submit Actuals'} for {periodName}
                </Button>
                <span style={{ fontSize: 12, color: tokens.colorNeutralForeground3 }}>
                  {unsignedCurrentActuals.length === 0 && !hasRejectedActuals
                    ? actualsStats.submitted === 0
                      ? 'Enter actuals in the matrix above to submit'
                      : 'All actuals submitted — awaiting approval'
                    : hasRejectedActuals
                      ? 'Some actuals were rejected — edit above and resubmit'
                      : `${unsignedCurrentActuals.length} line${unsignedCurrentActuals.length !== 1 ? 's' : ''} ready to submit`}
                </span>
              </div>
            )}
          </>
        )}
      </DashboardSection>
    </div>
  );
}
