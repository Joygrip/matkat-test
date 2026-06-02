import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  makeStyles,
  tokens,
  Badge,
  Button,
  Combobox,
  Option,
  Skeleton,
  SkeletonItem,
  Spinner,
} from '@fluentui/react-components';
import { Add16Regular, Edit16Regular } from '@fluentui/react-icons';
import { DashboardSection } from '../dashboard/DashboardSection';
import { actualsApi, ActualLine, ActualApprovalStatus } from '../../api/actuals';
import { planningApi, DemandLine, SupplyLine } from '../../api/planning';
import { useAppData } from '../../contexts/AppDataContext';
import { useToast } from '../../hooks/useToast';
import type { Period } from '../../types/index';
import { MONTH_SHORT } from '../../utils/format';

const DEMAND_COLOR = '#d97706';
const SUPPLY_COLOR = '#0d9488';
const ACTUALS_COLOR = '#1e3a5f';

const useStyles = makeStyles({
  emptyState: {
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
    padding: `${tokens.spacingVerticalXL} 0`,
    fontSize: tokens.fontSizeBase300,
  },
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
  addProjectRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    paddingTop: tokens.spacingVerticalS,
  },
});

export interface MyActualsMatrixProps {
  periods: Period[];
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

export function MyActualsMatrix({ periods }: MyActualsMatrixProps) {
  const styles = useStyles();
  const { showError } = useToast();
  const { myResource, appDataLoading, projects } = useAppData();

  const myResourceId = myResource?.resource_id ?? null;

  const [myDemandLines, setMyDemandLines] = useState<DemandLine[]>([]);
  const [mySupplyLines, setMySupplyLines] = useState<SupplyLine[]>([]);
  const [myActuals, setMyActuals] = useState<ActualLine[]>([]);
  const [myApprovalStatuses, setMyApprovalStatuses] = useState<Record<string, ActualApprovalStatus>>({});
  const [loading, setLoading] = useState(true);

  const [actualsEdits, setActualsEdits] = useState<Record<string, string>>({});
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [savedCells, setSavedCells] = useState<Set<string>>(new Set());
  const [resubmittedCells, setResubmittedCells] = useState<Set<string>>(new Set());
  const [additionalProjects, setAdditionalProjects] = useState<{ id: string; name: string }[]>([]);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [addProjectSearch, setAddProjectSearch] = useState('');

  useEffect(() => {
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
      actualsApi.getMyActuals(),
      actualsApi.getMyApprovalStatuses(),
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

  const matrixPeriods = useMemo(() => {
    return [...periods]
      .filter(p => p.status === 'open')
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
  }, [periods]);

  const earliestPeriod = matrixPeriods[0] ?? null;
  const periodName = earliestPeriod ? fmtPeriod(earliestPeriod) : '—';

  const matrixProjects = useMemo(() => {
    const map = new Map<string, string>();
    myDemandLines.forEach(d => {
      if (!map.has(d.project_id)) map.set(d.project_id, d.project_name ?? d.project_id);
    });
    myActuals.forEach(a => {
      if (!map.has(a.project_id)) {
        const project = projects.find(p => p.id === a.project_id);
        map.set(a.project_id, a.project_name ?? project?.name ?? a.project_id);
      }
    });
    additionalProjects.forEach(p => {
      if (!map.has(p.id)) map.set(p.id, p.name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [myDemandLines, myActuals, additionalProjects, projects]);

  // NOTE: For PM users, `projects` from useAppData() is scoped to PM-assigned projects
  // (AppDataContext uses listProjectsScoped for PM/Finance/Admin roles). PM's Add Project
  // picker shows only their assigned projects; Employee sees all active projects.
  const availableToAdd = useMemo(() => {
    const shownIds = new Set(matrixProjects.map(p => p.id));
    return projects.filter(p => p.is_active && !shownIds.has(p.id));
  }, [projects, matrixProjects]);

  const handleAddProject = useCallback((projectId: string, projectName: string) => {
    setAdditionalProjects(prev => [...prev, { id: projectId, name: projectName }]);
    setAddProjectOpen(false);
    setAddProjectSearch('');
  }, []);

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

  const actualsLookup = useMemo(() => {
    const lookup = new Map<string, ActualLine>();
    myActuals.forEach(a => lookup.set(`${a.project_id}:${a.period_id}`, a));
    return lookup;
  }, [myActuals]);

  const hasProjectSupply = useMemo(() => mySupplyLines.some(s => !!s.project_id), [mySupplyLines]);

  const saveActual = useCallback(async (projectId: string, period: Period, rawValue: string) => {
    const cellKey = `${projectId}:${period.id}`;
    const ftePct = parseFloat(rawValue);
    if (rawValue === '' || isNaN(ftePct)) {
      setActualsEdits(prev => { const n = { ...prev }; delete n[cellKey]; return n; });
      return;
    }
    if (ftePct < 5) {
      showError('Invalid FTE', 'FTE must be at least 5%');
      return;
    }
    if (!myResourceId) return;

    // Pre-validate: total actuals for this resource/period must not exceed 100%
    let attemptedTotal = ftePct;
    for (const a of myActuals) {
      if (a.period_id === period.id && a.project_id !== projectId) {
        attemptedTotal += a.actual_fte_percent;
      }
    }
    if (attemptedTotal > 100.0001) {
      const periodLabel = fmtPeriod(period);
      const rounded = Math.round(attemptedTotal * 10) / 10;
      showError('Save failed', `Total actuals for ${periodLabel} cannot exceed 100%. Current total would be ${rounded}%.`);
      setActualsEdits(prev => { const n = { ...prev }; delete n[cellKey]; return n; });
      return;
    }

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

      if (existing && approvalStatus === 'pending') {
        await actualsApi.updateActualLine(existing.id, { actual_fte_percent: ftePct });
      } else if (existing) {
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
      type ErrDetail = string | { message?: string };
      const e = err as { response?: { data?: { detail?: ErrDetail }; status?: number } };
      console.error('ACTUALS SAVE ERROR:', err, e?.response?.data, e?.response?.status);
      setActualsEdits(prev => { const n = { ...prev }; delete n[cellKey]; return n; });
      const detail = e?.response?.data?.detail;
      const msg = typeof detail === 'string' && detail
        ? detail
        : (detail && typeof detail === 'object' && detail.message)
          ? detail.message
          : 'Could not save actuals value.';
      showError('Save failed', msg);
    } finally {
      setSavingCells(prev => { const n = new Set(prev); n.delete(cellKey); return n; });
    }
  }, [myResourceId, myActuals, actualsLookup, myApprovalStatuses, showError]);

  if (loading) {
    return (
      <DashboardSection title="My Actuals">
        <Skeleton style={{ height: 200 }}><SkeletonItem /></Skeleton>
      </DashboardSection>
    );
  }

  return (
    <DashboardSection
      title="My Actuals"
      action={matrixProjects.length > 0 ? (
        <Badge appearance="filled" color="brand" shape="rounded">
          {matrixProjects.length} project{matrixProjects.length !== 1 ? 's' : ''}
        </Badge>
      ) : undefined}
    >
      {!myResourceId ? (
        <div className={styles.emptyState}>No resource record is linked to your account. Contact your administrator.</div>
      ) : matrixPeriods.length === 0 ? (
        <div className={styles.emptyState}>No open periods available.</div>
      ) : matrixProjects.length === 0 ? (
        <>
          <div className={styles.emptyState}>
            <div>No demand assignments found.</div>
            <div style={{ fontSize: tokens.fontSizeBase200, marginTop: tokens.spacingVerticalXS, color: tokens.colorNeutralForeground3 }}>
              You can still add a project and submit actuals for {periodName}.
            </div>
          </div>
          <div className={styles.addProjectRow}>
            {addProjectOpen ? (
              <>
                <Combobox
                  value={addProjectSearch}
                  onChange={e => setAddProjectSearch(e.target.value)}
                  selectedOptions={[]}
                  onOptionSelect={(_, data) => {
                    const project = availableToAdd.find(p => p.id === data.optionValue);
                    if (project) handleAddProject(project.id, project.name);
                  }}
                  placeholder="Search and select a project..."
                  style={{ minWidth: 260 }}
                >
                  {availableToAdd
                    .filter(p => !addProjectSearch || p.name.toLowerCase().includes(addProjectSearch.toLowerCase()))
                    .map(p => (
                      <Option key={p.id} value={p.id}>{p.name}</Option>
                    ))}
                </Combobox>
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={() => { setAddProjectOpen(false); setAddProjectSearch(''); }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                appearance="primary"
                icon={<Add16Regular />}
                size="small"
                disabled={availableToAdd.length === 0}
                onClick={() => setAddProjectOpen(true)}
              >
                Add Project
              </Button>
            )}
          </div>
        </>
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
                                    min="5"
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

          {/* Add Project row */}
          <div className={styles.addProjectRow}>
            {addProjectOpen ? (
              <>
                <Combobox
                  value={addProjectSearch}
                  onChange={e => setAddProjectSearch(e.target.value)}
                  selectedOptions={[]}
                  onOptionSelect={(_, data) => {
                    const project = availableToAdd.find(p => p.id === data.optionValue);
                    if (project) handleAddProject(project.id, project.name);
                  }}
                  placeholder="Search and select a project..."
                  style={{ minWidth: 260 }}
                >
                  {availableToAdd
                    .filter(p => !addProjectSearch || p.name.toLowerCase().includes(addProjectSearch.toLowerCase()))
                    .map(p => (
                      <Option key={p.id} value={p.id}>{p.name}</Option>
                    ))}
                </Combobox>
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={() => { setAddProjectOpen(false); setAddProjectSearch(''); }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                appearance="outline"
                icon={<Add16Regular />}
                size="small"
                disabled={availableToAdd.length === 0}
                onClick={() => setAddProjectOpen(true)}
                style={{ color: tokens.colorNeutralForeground3 }}
              >
                Add Project
              </Button>
            )}
          </div>

        </>
      )}
    </DashboardSection>
  );
}

