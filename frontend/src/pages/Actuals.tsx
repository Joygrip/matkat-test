/**
 * Actuals Page — unified entry, signing, and approval workflow
 *
 * Employee: enter and sign their own actuals (flat table)
 * Manager / Finance / Admin: CC sidebar, KPI cards, approve/reject workflow (ActualsTab)
 */
import React, { useState, useEffect } from 'react';
import {
  Title1,
  Body1,
  Card,
  CardHeader,
  Button,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Spinner,
  Badge,
  tokens,
  makeStyles,
  Input,
  Select,
  Combobox,
  Option,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  MessageBar,
  MessageBarBody,
  Textarea,
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
} from '@fluentui/react-components';
import {
  Add24Regular,
  Delete24Regular,
  CheckmarkCircle24Regular,
  ClipboardTaskRegular,
  ArrowUndo24Regular,
} from '@fluentui/react-icons';
import { actualsApi, ActualLine, ActualApprovalStatus, CreateActualLine } from '../api/actuals';
import { lookupsApi, Project, Resource } from '../api/lookups';
import { usePeriod } from '../contexts/PeriodContext';
import { planningApi, DemandLine, SupplyLine } from '../api/planning';
import { useToast } from '../hooks/useToast';
import { formatApiError } from '../utils/errors';
import { config } from '../config';
import { ApiError } from '../types';
import { EmptyState } from '../components/EmptyState';
import { useAuth, useHasRole } from '../auth/AuthProvider';
import { apiClient } from '../api/client';
import { ActualsTab, FinanceActualRow } from '../components/finance/ActualsTab';
import { SearchableFilter } from '../components/SearchableFilter';

const useStyles = makeStyles({
  container: {
    padding: tokens.spacingHorizontalXXL,
    maxWidth: '1600px',
    margin: '0 auto',
    minHeight: 'calc(100vh - 80px)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: tokens.spacingVerticalXXL,
    paddingBottom: tokens.spacingVerticalL,
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
  },
  card: {
    marginBottom: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    transition: 'all 0.2s ease',
    '&:hover': {
      boxShadow: tokens.shadow8,
    },
  },
  table: {
    width: '100%',
    '& thead': {
      backgroundColor: tokens.colorNeutralBackground2,
      position: 'sticky' as const,
      top: 0,
      zIndex: 1,
    },
    '& th': {
      fontWeight: tokens.fontWeightSemibold,
      fontSize: tokens.fontSizeBase300,
      color: tokens.colorNeutralForeground2,
      padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
      backgroundColor: tokens.colorNeutralBackground2,
    },
    '& td': {
      padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
      borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    },
    '& tbody tr': {
      transition: 'background-color 0.15s ease',
      '&:hover': {
        backgroundColor: tokens.colorNeutralBackground1,
      },
    },
  },
  formRow: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    alignItems: 'flex-end',
    marginBottom: tokens.spacingVerticalM,
  },
  formField: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalM,
  },
  formLabel: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    marginBottom: tokens.spacingVerticalXXS,
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    padding: tokens.spacingVerticalXXL,
  },
  overLimitRow: {
    backgroundColor: tokens.colorPaletteRedBackground1,
    '&:hover': {
      backgroundColor: tokens.colorPaletteRedBackground2,
    },
  },
  planningSummary: {
    padding: tokens.spacingHorizontalL,
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: tokens.spacingHorizontalM,
  },
  summaryCard: {
    display: 'flex',
    flexDirection: 'column' as const,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    transition: 'all 0.2s ease',
    cursor: 'pointer',
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: tokens.shadow8,
    },
  },
  summaryProjectRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    padding: tokens.spacingVerticalXS,
    borderRadius: tokens.borderRadiusMedium,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  summaryValue: {
    display: 'block',
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightBold,
    lineHeight: '1.1',
    marginBottom: tokens.spacingVerticalXS,
  },
  summaryLabel: {
    display: 'block',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: tokens.spacingVerticalXS,
  },
  summarySubtitle: {
    display: 'block',
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightRegular,
    marginTop: tokens.spacingVerticalXS,
    paddingTop: tokens.spacingVerticalXS,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  filterLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
});

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];


export const Actuals: React.FC = () => {
  const styles = useStyles();
  const { showSuccess, showError, showApiError } = useToast();
  const { user } = useAuth();
  const canSeeStats = useHasRole('Finance', 'Manager', 'Admin');

  const { selectedPeriodId, selectedPeriod: ctxPeriod } = usePeriod();

  const isEmployee = user?.role === 'Employee';
  const isManager = user?.role === 'Manager';

  // ── Employee-view state ──────────────────────────────────────────────────────

  const [actuals, setActuals] = useState<ActualLine[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overLimitIds, setOverLimitIds] = useState<string[]>([]);
  const [demandLines, setDemandLines] = useState<DemandLine[]>([]);
  const [supplyLines, setSupplyLines] = useState<SupplyLine[]>([]);

  // Form state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [resourceSearch, setResourceSearch] = useState('');
  const [dialogProxyReason, setDialogProxyReason] = useState('');

  const [formData, setFormData] = useState<Omit<CreateActualLine, 'year' | 'month' | 'planned_fte_percent'>>({
    period_id: '',
    resource_id: '',
    project_id: '',
    actual_fte_percent: 50,
  });
  const [myResourceId, setMyResourceId] = useState<string | null>(null);
  const [myResourceLoading, setMyResourceLoading] = useState(false);

  // Edit dialog state
  const [editActual, setEditActual] = useState<ActualLine | null>(null);
  const [editFte, setEditFte] = useState<number | undefined>(undefined);
  const [editPlannedFte, setEditPlannedFte] = useState<number | undefined>(undefined);
  const [editProjectId, setEditProjectId] = useState<string | undefined>(undefined);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const [approvalStatuses, setApprovalStatuses] = useState<Record<string, ActualApprovalStatus>>({});

  const [linesDrawerOpen, setLinesDrawerOpen] = useState(false);
  const [linesDrawerType, setLinesDrawerType] = useState<'demand' | 'supply' | 'project'>('demand');
  const [linesDrawerProjectId, setLinesDrawerProjectId] = useState<string | null>(null);

  // ── Non-employee (Manager / Finance / Admin) view state ──────────────────────

  const [actualsData, setActualsData] = useState<FinanceActualRow[]>([]);
  const [actualsLoading, setActualsLoading] = useState(false);
  const [actualsError, setActualsError] = useState<string | null>(null);
  const [actualsProjectId, setActualsProjectId] = useState<string>('');


  // year/month for chart (derived from finance actuals or period context)
  const periodFromActuals = actualsData.length > 0
    ? { year: actualsData[0].year, month: actualsData[0].month }
    : null;
  const year = periodFromActuals?.year ?? ctxPeriod?.year ?? 0;
  const month = periodFromActuals?.month ?? ctxPeriod?.month ?? 0;

  // ── Initial data load (projects + resources for Add Actual dialog) ───────────

  useEffect(() => {
    loadInitialData();
  }, []);

  // Load current user's resource ID (employees: identity; managers: detect self-entry)
  useEffect(() => {
    if (isEmployee || isManager) {
      setMyResourceLoading(true);
      actualsApi.getMyResource()
        .then(data => setMyResourceId(data.resource_id))
        .catch(() => setMyResourceId(null))
        .finally(() => setMyResourceLoading(false));
    }
  }, [isEmployee, isManager]);

  // Employee: load own actuals when period or resource changes
  useEffect(() => {
    if (isEmployee && selectedPeriodId) {
      loadMyActuals();
    }
  }, [selectedPeriodId, myResourceId, isEmployee]);

  // Non-employee: load finance actuals dashboard when period or filters change
  useEffect(() => {
    if (!isEmployee && selectedPeriodId && ctxPeriod) {
      loadFinanceActuals();
    }
  }, [selectedPeriodId, isEmployee, actualsProjectId]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [projectsData, resourcesData] = await Promise.all([
        lookupsApi.listProjects(),
        isManager ? lookupsApi.listResourcesScoped() : lookupsApi.listResources(),
      ]);
      setProjects(projectsData);
      setResources(resourcesData);
    } catch (err: unknown) {
      setError(formatApiError(err, 'Failed to load data'));
    } finally {
      setLoading(false);
    }
  };

  const loadMyActuals = async () => {
    try {
      const data = await actualsApi.getMyActuals(ctxPeriod?.year, ctxPeriod?.month);
      setActuals(data);
      setOverLimitIds([]);

      actualsApi.getApprovalStatuses(ctxPeriod?.year, ctxPeriod?.month)
        .then(statuses => setApprovalStatuses(statuses))
        .catch(() => { /* non-blocking */ });

      if (isEmployee && selectedPeriodId && myResourceId) {
        try {
          const [demands, supplies] = await Promise.all([
            planningApi.getDemandLines(selectedPeriodId, { resourceId: myResourceId }).catch(() => []),
            planningApi.getSupplyLines(selectedPeriodId, { resourceId: myResourceId }).catch(() => []),
          ]);
          setDemandLines(demands || []);
          setSupplyLines(supplies || []);
        } catch (err) {
          console.error('Failed to load demand/supply lines:', err);
          setDemandLines([]);
          setSupplyLines([]);
        }
      } else if (isEmployee && (selectedPeriodId || myResourceId)) {
        setDemandLines([]);
        setSupplyLines([]);
      }
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to load actuals');
    }
  };

  const loadFinanceActuals = async () => {
    if (!ctxPeriod) return;
    setActualsLoading(true);
    setActualsError(null);
    try {
      const params = new URLSearchParams();
      params.append('year', String(ctxPeriod.year));
      params.append('month', String(ctxPeriod.month));
      if (actualsProjectId) params.append('project_id', actualsProjectId);

      const result = await apiClient.get<FinanceActualRow[]>(
        `/finance/actuals-dashboard?${params.toString()}`
      );
      setActualsData(result);
    } catch {
      setActualsError('Failed to load actuals data');
    } finally {
      setActualsLoading(false);
    }
  };

  // ── Employee actions ─────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!selectedPeriodId || !ctxPeriod) {
      showError('No period selected', 'Please select a period first.');
      return;
    }
    const resourceId = isEmployee && myResourceId ? myResourceId : formData.resource_id;
    if (!resourceId) {
      showError('Missing resource', 'Please select a resource.');
      return;
    }
    if (!formData.project_id) {
      showError('Missing project', 'Please select a project.');
      return;
    }
    const isManagerEnteringForOther = isManager && resourceId !== myResourceId;
    if (isManagerEnteringForOther && !dialogProxyReason.trim()) {
      showError('Reason required', 'Please provide a reason for entering actuals on behalf of this employee.');
      return;
    }
    try {
      await actualsApi.createActualLine({
        period_id: selectedPeriodId,
        resource_id: resourceId,
        project_id: formData.project_id,
        year: ctxPeriod.year,
        month: ctxPeriod.month,
        actual_fte_percent: formData.actual_fte_percent,
        ...(isManagerEnteringForOther ? { proxy_sign_reason: dialogProxyReason.trim() } : {}),
      });
      showSuccess('Actual line created');
      setIsDialogOpen(false);
      if (isEmployee) {
        loadMyActuals();
      } else {
        loadFinanceActuals();
      }
      setFormData({
        period_id: selectedPeriodId,
        resource_id: '',
        project_id: '',
        actual_fte_percent: 50,
      });
      setResourceSearch('');
      setDialogProxyReason('');
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'ACTUALS_OVER_100') {
        const offending = err.extras?.offending_line_ids;
        if (Array.isArray(offending)) {
          setOverLimitIds(offending.filter((id): id is string => typeof id === 'string'));
        }
      }
      showApiError(err as Error, 'Create actual line');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this actual line?')) return;
    try {
      await actualsApi.deleteActualLine(id);
      showSuccess('Actual line deleted');
      loadMyActuals();
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to delete actual line');
    }
  };

  const handleUnsign = async (actualId: string) => {
    if (!window.confirm('Remove your signature? You will be able to edit and re-submit this actual for approval.')) return;
    try {
      await actualsApi.unsignActual(actualId);
      showSuccess('Signature removed. You can now edit and re-submit.');
      await reloadMyActuals();
    } catch (err) {
      showApiError(err as Error, 'Failed to unsign actual');
    }
  };

  const reloadMyActuals = async () => {
    try {
      setLoading(true);
      const data = await actualsApi.getMyActuals(ctxPeriod?.year, ctxPeriod?.month);
      setActuals(data);
      setOverLimitIds([]);
      actualsApi.getApprovalStatuses(ctxPeriod?.year, ctxPeriod?.month)
        .then(statuses => setApprovalStatuses(statuses))
        .catch(() => { /* non-blocking */ });
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to load actuals');
    } finally {
      setLoading(false);
    }
  };

  const openEditDialog = (actual: ActualLine) => {
    setEditActual(actual);
    setEditFte(actual.actual_fte_percent);
    setEditPlannedFte(actual.planned_fte_percent ?? undefined);
    setEditProjectId(actual.project_id);
    setIsEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    if (!editActual) return;
    try {
      await actualsApi.updateActualLine(editActual.id, {
        actual_fte_percent: editFte,
        planned_fte_percent: editPlannedFte,
        project_id: editProjectId,
      });
      showSuccess('Actual line updated');
      setIsEditDialogOpen(false);
      setEditActual(null);
      await reloadMyActuals();
    } catch (err) {
      showApiError(err as Error, 'Failed to update actual line');
    }
  };

  const getProjectName = (id: string) => projects.find(p => p.id === id)?.name || 'Unknown';
  const getResourceName = (id: string) => resources.find(r => r.id === id)?.display_name || 'Unknown';

  const currentPeriod = ctxPeriod;
  const isLocked = currentPeriod?.status === 'locked';
  const hasRejectedActuals = isEmployee && Object.values(approvalStatuses).some(s => s.status === 'rejected');

  if (loading) {
    return (
      <div className={styles.loading}>
        <Spinner size="large" label="Loading..." />
      </div>
    );
  }

  return (
    <div className={styles.container}>

      {/* ── Header: alerts, Add Actual button, and (non-employee) filters ── */}
      <div className={styles.header}>
        <div style={{ display: 'flex', gap: tokens.spacingHorizontalM, alignItems: 'center', flexWrap: 'wrap' }}>
          {isLocked && (
            <MessageBar intent="warning" style={{ flex: '1 1 100%' }}>
              <MessageBarBody>
                This period is locked. Select an open period in the dropdown above, or ask Finance to unlock this period.
              </MessageBarBody>
            </MessageBar>
          )}
          {hasRejectedActuals && !isLocked && (
            <MessageBar intent="error" style={{ flex: '1 1 100%' }}>
              <MessageBarBody>
                One or more of your actuals were rejected. Click <strong>Unsign</strong> on the rejected line to make corrections and re-submit for approval.
              </MessageBarBody>
            </MessageBar>
          )}
          {!isLocked && (
            <Dialog
              open={isDialogOpen}
              onOpenChange={(_, data) => {
                setIsDialogOpen(data.open);
                if (data.open && isEmployee && myResourceId) {
                  setFormData(prev => ({ ...prev, resource_id: myResourceId }));
                }
                if (!data.open) {
                  setResourceSearch('');
                  setDialogProxyReason('');
                }
              }}
            >
              <DialogTrigger>
                <Button appearance="primary" icon={<Add24Regular />}>
                  Add Actual
                </Button>
              </DialogTrigger>
              <DialogSurface>
                <DialogBody>
                  <DialogTitle>Add Actual Line</DialogTitle>
                  <DialogContent>
                    {currentPeriod && (
                      <div className={styles.formField} style={{ marginBottom: tokens.spacingVerticalM }}>
                        <label>Period</label>
                        <Body1 style={{ padding: tokens.spacingVerticalS, color: tokens.colorNeutralForeground3 }}>
                          {monthNames[currentPeriod.month - 1]} {currentPeriod.year} ({currentPeriod.status})
                        </Body1>
                      </div>
                    )}

                    <div className={styles.formField}>
                      <label>Resource</label>
                      {isEmployee ? (
                        myResourceLoading ? (
                          <Body1 style={{ padding: tokens.spacingVerticalS, color: tokens.colorNeutralForeground3 }}>
                            Identifying your resource...
                          </Body1>
                        ) : myResourceId ? (
                          <Body1 style={{ padding: tokens.spacingVerticalS, color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold }}>
                            {resources.find(r => r.id === myResourceId)?.display_name || 'You'}
                          </Body1>
                        ) : (
                          <>
                            <Body1 style={{ padding: tokens.spacingVerticalS, color: tokens.colorPaletteRedForeground1 }}>
                              No resource linked to your account. Contact your administrator.
                            </Body1>
                            {config.devAuthBypass && (
                              <Body1 style={{ padding: tokens.spacingVerticalS, color: tokens.colorNeutralForeground3, fontSize: '12px' }}>
                                In dev: use Dev Login and sign in as an Employee (e.g. Dev User or Alice Developer), or run Seed to create linked users.
                              </Body1>
                            )}
                          </>
                        )
                      ) : (
                        <Combobox
                          value={resourceSearch}
                          onChange={(e) => {
                            setResourceSearch(e.target.value);
                            setFormData(prev => ({ ...prev, resource_id: '' }));
                          }}
                          selectedOptions={formData.resource_id ? [formData.resource_id] : []}
                          onOptionSelect={(_, data) => {
                            setFormData(prev => ({ ...prev, resource_id: data.optionValue ?? '' }));
                            setResourceSearch(data.optionText ?? '');
                          }}
                          placeholder="Search resource..."
                          freeform={false}
                        >
                          {resources
                            .filter(r => !resourceSearch || r.display_name.toLowerCase().includes(resourceSearch.toLowerCase()))
                            .map(r => (
                              <Option key={r.id} value={r.id}>{r.display_name}</Option>
                            ))}
                        </Combobox>
                      )}
                    </div>

                    {isManager && formData.resource_id && formData.resource_id !== myResourceId && (
                      <div className={styles.formField}>
                        <label className={styles.formLabel}>Reason for entering actuals on behalf of employee (required)</label>
                        <Textarea
                          value={dialogProxyReason}
                          onChange={(_, data) => setDialogProxyReason(data.value)}
                          placeholder="e.g., Employee on extended leave"
                        />
                      </div>
                    )}

                    <div className={styles.formField} style={{ marginTop: tokens.spacingVerticalM }}>
                      <label>Project</label>
                      <Select
                        value={formData.project_id}
                        onChange={(_, data) => setFormData({ ...formData, project_id: data.value })}
                      >
                        <option value="">Select project...</option>
                        {projects.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </Select>
                    </div>

                    <div className={styles.formField} style={{ marginTop: tokens.spacingVerticalM }}>
                      <label>Actual FTE %</label>
                      <Input
                        type="number"
                        min={5}
                        max={100}
                        step={5}
                        value={String(formData.actual_fte_percent)}
                        onChange={(_, data) => setFormData({ ...formData, actual_fte_percent: parseInt(data.value) })}
                      />
                      <Body1 style={{ marginTop: tokens.spacingVerticalXS, color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 }}>
                        Planned FTE will be automatically calculated from demand lines for this project.
                      </Body1>
                    </div>

                    <MessageBar intent="warning" style={{ marginTop: tokens.spacingVerticalM }}>
                      <MessageBarBody>Total actuals per resource cannot exceed 100%</MessageBarBody>
                    </MessageBar>
                  </DialogContent>
                  <DialogActions>
                    <Button onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                    <Button
                      appearance="primary"
                      onClick={handleCreate}
                      disabled={
                        (isEmployee && !myResourceId) ||
                        (!isEmployee && !formData.resource_id) ||
                        !formData.project_id ||
                        (isManager && !!formData.resource_id && formData.resource_id !== myResourceId && !dialogProxyReason.trim())
                      }
                    >
                      Create
                    </Button>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>
          )}
        </div>

        {/* Filters — visible to Manager / Finance / Admin */}
        {!isEmployee && (
          <div style={{ display: 'flex', gap: tokens.spacingHorizontalL, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS }}>
              <span className={styles.filterLabel}>Project</span>
              <SearchableFilter
                options={projects.map(p => ({ id: p.id, label: p.name }))}
                value={actualsProjectId}
                onChange={setActualsProjectId}
                placeholder="Search projects..."
                allLabel="All projects"
                style={{ minWidth: 180 }}
              />
            </div>
          </div>
        )}
      </div>

      {isLocked && (
        <MessageBar intent="warning" style={{ marginBottom: tokens.spacingVerticalM }}>
          <MessageBarBody>Period is locked. Editing is disabled.</MessageBarBody>
        </MessageBar>
      )}

      {error && (
        <MessageBar intent="error" style={{ marginBottom: tokens.spacingVerticalM }}>
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {/* ── Employee view ──────────────────────────────────────────────────── */}

      {isEmployee && (
        <>
          {/* Demand and Supply Summary */}
          {selectedPeriodId && (demandLines.length > 0 || supplyLines.length > 0) && (
            <Card className={styles.card} style={{ marginBottom: tokens.spacingVerticalL }}>
              <CardHeader header={<Title1>Planning Summary</Title1>} />
              <div className={styles.planningSummary}>
                <div className={styles.summaryGrid}>
                  <div
                    className={styles.summaryCard}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setLinesDrawerType('demand'); setLinesDrawerProjectId(null); setLinesDrawerOpen(true); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setLinesDrawerType('demand'); setLinesDrawerProjectId(null); setLinesDrawerOpen(true); } }}
                  >
                    <div className={styles.summaryLabel}>Total Demand</div>
                    <div className={styles.summaryValue} style={{ color: tokens.colorPaletteBlueForeground2 }}>
                      {demandLines.reduce((sum, d) => sum + (d.fte_percent || 0), 0)}%
                    </div>
                    <div className={styles.summarySubtitle}>
                      {demandLines.length} demand line{demandLines.length !== 1 ? 's' : ''} across {new Set(demandLines.map(d => d.project_id)).size} project{new Set(demandLines.map(d => d.project_id)).size !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div
                    className={styles.summaryCard}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setLinesDrawerType('supply'); setLinesDrawerProjectId(null); setLinesDrawerOpen(true); }}
                    onKeyDown={(e) => e.key === 'Enter' && (setLinesDrawerType('supply'), setLinesDrawerProjectId(null), setLinesDrawerOpen(true))}
                  >
                    <div className={styles.summaryLabel}>Total Supply</div>
                    <div className={styles.summaryValue} style={{ color: tokens.colorPaletteGreenForeground1 }}>
                      {supplyLines.reduce((sum, s) => sum + (s.fte_percent || 0), 0)}%
                    </div>
                    <div className={styles.summarySubtitle}>
                      {supplyLines.length} supply line{supplyLines.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Lines Detail Drawer */}
          <Drawer
            open={linesDrawerOpen}
            onOpenChange={(_, data) => setLinesDrawerOpen(data.open)}
            position="end"
          >
            <DrawerHeader>
              <DrawerHeaderTitle>
                {linesDrawerType === 'demand' && 'Demand Lines'}
                {linesDrawerType === 'supply' && 'Supply Lines'}
                {linesDrawerType === 'project' && `Demand: ${projects.find(p => p.id === linesDrawerProjectId)?.name || 'Project'}`}
              </DrawerHeaderTitle>
            </DrawerHeader>
            <DrawerBody>
              {linesDrawerType === 'demand' && (
                <Table className={styles.table}>
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell>Project</TableHeaderCell>
                      <TableHeaderCell>Resource</TableHeaderCell>
                      <TableHeaderCell>FTE %</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {demandLines.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>{d.project_name ?? projects.find(p => p.id === d.project_id)?.name ?? d.project_id}</TableCell>
                        <TableCell>{d.resource_name ?? d.placeholder_name ?? '-'}</TableCell>
                        <TableCell>{d.fte_percent ?? 0}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {linesDrawerType === 'supply' && (
                <Table className={styles.table}>
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell>Project</TableHeaderCell>
                      <TableHeaderCell>Resource</TableHeaderCell>
                      <TableHeaderCell>FTE %</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {supplyLines.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{s.project_name ?? projects.find(p => p.id === s.project_id)?.name ?? s.project_id ?? '-'}</TableCell>
                        <TableCell>{s.resource_name ?? resources.find(r => r.id === s.resource_id)?.display_name ?? s.resource_id}</TableCell>
                        <TableCell>{s.fte_percent ?? 0}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {linesDrawerType === 'project' && linesDrawerProjectId && (
                <Table className={styles.table}>
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell>Project</TableHeaderCell>
                      <TableHeaderCell>Resource</TableHeaderCell>
                      <TableHeaderCell>FTE %</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {demandLines.filter(d => d.project_id === linesDrawerProjectId).map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>{d.project_name ?? projects.find(p => p.id === d.project_id)?.name ?? d.project_id}</TableCell>
                        <TableCell>{d.resource_name ?? d.placeholder_name ?? '-'}</TableCell>
                        <TableCell>{d.fte_percent ?? 0}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </DrawerBody>
          </Drawer>

          {/* Employee flat table */}
          <Card className={styles.card}>
            <CardHeader header={<Body1><strong>Actual Lines ({actuals.length})</strong></Body1>} />
            <Table className={styles.table}>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Resource</TableHeaderCell>
                  <TableHeaderCell>Project</TableHeaderCell>
                  <TableHeaderCell>Period</TableHeaderCell>
                  <TableHeaderCell>Planned</TableHeaderCell>
                  <TableHeaderCell>Actual</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actuals.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} style={{ padding: tokens.spacingVerticalXXL }}>
                      <EmptyState
                        icon={<ClipboardTaskRegular style={{ fontSize: 48 }} />}
                        title="No actuals"
                        message="No actual lines found for this period. Create one to start logging time."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  actuals.map(a => (
                    <TableRow
                      key={a.id}
                      className={overLimitIds.includes(a.id) ? styles.overLimitRow : undefined}
                    >
                      <TableCell>{a.resource_name ?? getResourceName(a.resource_id)}</TableCell>
                      <TableCell>{a.project_name ?? getProjectName(a.project_id)}</TableCell>
                      <TableCell>{a.year}-{String(a.month).padStart(2, '0')}</TableCell>
                      <TableCell>
                        {a.planned_fte_percent !== null && a.planned_fte_percent !== undefined
                          ? `${a.planned_fte_percent}%`
                          : <span style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>No plan</span>}
                      </TableCell>
                      <TableCell>
                        <Badge appearance="filled" color="informative">{a.actual_fte_percent}%</Badge>
                      </TableCell>
                      <TableCell>
                        {a.employee_signed_at ? (() => {
                          const apStatus = approvalStatuses[a.id];
                          if (apStatus?.status === 'approved') {
                            return <Badge appearance="filled" color="success" icon={<CheckmarkCircle24Regular />}>Approved</Badge>;
                          }
                          if (apStatus?.status === 'rejected') {
                            return (
                              <Badge
                                appearance="filled"
                                color="danger"
                                title={apStatus.rejection_comment ?? 'Rejected by approver'}
                              >
                                Rejected
                              </Badge>
                            );
                          }
                          if (apStatus?.status === 'pending') {
                            return <Badge appearance="filled" color="warning">Pending Approval</Badge>;
                          }
                          return <Badge appearance="filled" color="warning">Pending Approval</Badge>;
                        })() : (
                          <Badge appearance="outline" color="warning">Unsigned</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div style={{ display: 'flex', gap: tokens.spacingHorizontalXS }}>
                          {!isLocked && approvalStatuses[a.id]?.status !== 'approved' && (
                            <Button
                              icon={<ClipboardTaskRegular />}
                              appearance="subtle"
                              title="Edit"
                              onClick={() => openEditDialog(a)}
                            />
                          )}
                          {a.employee_signed_at && approvalStatuses[a.id]?.status === 'rejected' && !isLocked && (
                            <Button
                              icon={<ArrowUndo24Regular />}
                              appearance="subtle"
                              title="Unsign — remove signature to edit and re-submit"
                              style={{ color: tokens.colorPaletteRedForeground1 }}
                              onClick={() => handleUnsign(a.id)}
                            />
                          )}
                          {!isLocked && approvalStatuses[a.id]?.status !== 'approved' && (
                            <Button
                              icon={<Delete24Regular />}
                              appearance="subtle"
                              onClick={() => handleDelete(a.id)}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {/* ── Manager / Finance / Admin view: KPI cards + CC sidebar + approval table + chart ── */}

      {!isEmployee && (
        <ActualsTab
          actualsData={actualsData}
          actualsLoading={actualsLoading}
          actualsError={actualsError}
          projects={projects}
          actualsProjectId={actualsProjectId}
          year={year}
          month={month}
          canSeeStats={canSeeStats}
          onActualsReload={loadFinanceActuals}
        />
      )}

      {/* ── Edit dialog (employee only) ────────────────────────────────────── */}

      <Dialog open={isEditDialogOpen} onOpenChange={(_e: unknown, data: { open: boolean }) => setIsEditDialogOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Edit Actual Line</DialogTitle>
            <DialogContent>
              <div className={styles.formField}>
                <label>Project</label>
                <Select
                  value={editProjectId}
                  onChange={(_, data) => setEditProjectId(data.value)}
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </div>
              <div className={styles.formField}>
                <label>Planned FTE (%)</label>
                <Input
                  type="number"
                  value={editPlannedFte !== undefined ? String(editPlannedFte) : ''}
                  onChange={(_, data) => setEditPlannedFte(data.value ? Number(data.value) : undefined)}
                  min={0}
                  max={100}
                  step={5}
                  placeholder="Optional"
                />
              </div>
              <div className={styles.formField}>
                <label>Actual FTE (%)</label>
                <Input
                  type="number"
                  value={editFte !== undefined ? String(editFte) : ''}
                  onChange={(_, data) => setEditFte(data.value ? Number(data.value) : undefined)}
                  min={0}
                  max={100}
                  step={5}
                  required
                />
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
              <Button appearance="primary" onClick={handleEditSave}>Save</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

    </div>
  );
};

export default Actuals;
