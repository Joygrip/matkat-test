/**
 * Actuals Entry Page
 * 
 * Employee: Enter and sign actuals
 * RO: View and proxy sign for absent employees
 */
import React, { useState, useEffect, useMemo } from 'react';
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
  Skeleton,
  SkeletonItem,
  Badge,
  tokens,
  makeStyles,
  Input,
  Select,
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
  ProgressBar,
} from '@fluentui/react-components';
import { 
  Add24Regular, 
  Delete24Regular, 
  Signature24Regular,
  CheckmarkCircle24Regular,
  ClipboardTaskRegular,
} from '@fluentui/react-icons';
import { actualsApi, ActualLine, CreateActualLine } from '../api/actuals';
import { lookupsApi, Project, Resource } from '../api/lookups';
import { usePeriod } from '../contexts/PeriodContext';
import { planningApi, DemandLine, SupplyLine } from '../api/planning';
import { useToast } from '../hooks/useToast';
import { formatApiError } from '../utils/errors';
import { config } from '../config';
import { ApiError } from '../types';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../auth/AuthProvider';

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
    alignItems: 'center',
    marginBottom: tokens.spacingVerticalL,
    paddingBottom: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  headerContent: {
    flex: 1,
  },
  pageTitle: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
    marginBottom: tokens.spacingVerticalXXS,
    lineHeight: '1.2',
  },
  pageSubtitle: {
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
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
  totalBar: {
    padding: tokens.spacingVerticalL,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    marginBottom: tokens.spacingVerticalM,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    transition: 'all 0.2s ease',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground2,
    },
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalL,
  },
  summaryCard: {
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    transition: 'all 0.2s ease',
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: tokens.shadow8,
    },
  },
  summaryCardClickable: {
    cursor: 'pointer',
    '&:hover': {
      borderColor: tokens.colorBrandStroke1,
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  summaryValue: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightBold,
    lineHeight: '1',
    marginBottom: tokens.spacingVerticalXS,
  },
  summaryLabel: {
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightSemibold,
    marginBottom: tokens.spacingVerticalXS,
  },
  toolbar: {
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
    backgroundColor: tokens.colorNeutralBackground1,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    marginBottom: tokens.spacingVerticalL,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    flexWrap: 'wrap' as const,
  },
  toolbarLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  scoreboardRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalL,
    flexWrap: 'wrap' as const,
  },
  scoreboardItem: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    '&:hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  scoreboardItemActive: {
    borderColor: tokens.colorBrandStroke1,
    backgroundColor: tokens.colorNeutralBackground1Selected,
  },
  scoreboardValue: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  scoreboardLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  workQueueLayout: {
    display: 'grid',
    gridTemplateColumns: '35% 1fr',
    gap: tokens.spacingHorizontalL,
    minHeight: 400,
  },
  workQueueLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingRight: tokens.spacingHorizontalL,
  },
  workQueueSearch: {
    minWidth: 0,
  },
  workQueueList: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    overflowY: 'auto' as const,
  },
  workQueueRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    '&:hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  workQueueRowSelected: {
    borderColor: tokens.colorBrandStroke1,
    backgroundColor: tokens.colorNeutralBackground1Selected,
  },
  sortableTable: {
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
      cursor: 'pointer',
      userSelect: 'none',
      '&:hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
    },
    '& td': {
      padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
      borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    },
    '& tbody tr': {
      transition: 'background-color 0.15s ease',
      '&:hover': { backgroundColor: tokens.colorNeutralBackground1 },
    },
  },
});

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const Actuals: React.FC = () => {
  const styles = useStyles();
  const { showSuccess, showError, showApiError } = useToast();
  const { user } = useAuth();
  
  const { selectedPeriodId, selectedPeriod: ctxPeriod } = usePeriod();

  const [actuals, setActuals] = useState<ActualLine[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overLimitIds, setOverLimitIds] = useState<string[]>([]);
  const [demandLines, setDemandLines] = useState<DemandLine[]>([]);
  const [supplyLines, setSupplyLines] = useState<SupplyLine[]>([]);
  
  const isEmployee = user?.role === 'Employee';
  const isRO = user?.role === 'RO';
  
  // Form state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSignDialogOpen, setIsSignDialogOpen] = useState(false);
  const [selectedActual, setSelectedActual] = useState<ActualLine | null>(null);
  const [proxyReason, setProxyReason] = useState('');
  const [isProxySign, setIsProxySign] = useState(false);
  
  const [formData, setFormData] = useState<Omit<CreateActualLine, 'year' | 'month' | 'planned_fte_percent'>>({
    period_id: '',
    resource_id: '',
    project_id: '',
    actual_fte_percent: 50,
  });
  const [myResourceId, setMyResourceId] = useState<string | null>(null);
  const [myResourceLoading, setMyResourceLoading] = useState(false);
  
  // Add state for edit dialog
  const [editActual, setEditActual] = useState<ActualLine | null>(null);
  const [editFte, setEditFte] = useState<number | undefined>(undefined);
  const [editPlannedFte, setEditPlannedFte] = useState<number | undefined>(undefined);
  const [editProjectId, setEditProjectId] = useState<string | undefined>(undefined);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const [planningLinesModal, setPlanningLinesModal] = useState<'demand' | 'supply' | null>(null);

  // Toolbar and filter state (RO view)
  const [selectedResourceFilter, setSelectedResourceFilter] = useState<string | null>(null);
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'resource' | 'project' | 'period' | 'actual'>('resource');
  const [sortAsc, setSortAsc] = useState(true);
  
  useEffect(() => {
    loadInitialData();
  }, []);
  
  // Load employee's resource ID (no dropdown for employee—identity from login)
  useEffect(() => {
    if (isEmployee) {
      setMyResourceLoading(true);
      actualsApi.getMyResource()
        .then(data => setMyResourceId(data.resource_id))
        .catch(() => setMyResourceId(null))
        .finally(() => setMyResourceLoading(false));
    }
  }, [isEmployee]);
  
  useEffect(() => {
    if (selectedPeriodId) {
      loadActuals();
    }
  }, [selectedPeriodId, myResourceId]);
  
  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [projectsData, resourcesData] = await Promise.all([
        lookupsApi.listProjects(),
        lookupsApi.listResources(),
      ]);
      
      setProjects(projectsData);
      setResources(resourcesData);
    } catch (err: unknown) {
      setError(formatApiError(err, 'Failed to load data'));
    } finally {
      setLoading(false);
    }
  };
  
  const loadActuals = async () => {
    try {
      // Employee role uses /actuals/my to see their own lines (filtered by year/month if period selected)
      // Other roles (RO, Finance, Admin) use /actuals?year=X&month=Y to see all lines
      const data = isEmployee 
        ? await actualsApi.getMyActuals(ctxPeriod?.year, ctxPeriod?.month)
        : await actualsApi.getActualLines(undefined, ctxPeriod?.year, ctxPeriod?.month);
      setActuals(data);
      setOverLimitIds([]);
      
      // For employees, also load demand and supply lines for their resource (filter by myResourceId)
      if (isEmployee && selectedPeriodId && myResourceId) {
        try {
          const filters = { resourceId: myResourceId };
          const [demands, supplies] = await Promise.all([
            planningApi.getDemandLines(selectedPeriodId, filters).catch(() => []),
            planningApi.getSupplyLines(selectedPeriodId, filters).catch(() => []),
          ]);
          setDemandLines(demands || []);
          setSupplyLines(supplies || []);
        } catch (err) {
          console.error('Failed to load demand/supply lines:', err);
          setDemandLines([]);
          setSupplyLines([]);
        }
      }
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to load actuals');
    }
  };
  
  const handleCreate = async () => {
    if (!selectedPeriodId || !ctxPeriod) {
      showError('No period selected', 'Please select a period first.');
      return;
    }
    // For employees, use their own resource
    const resourceId = isEmployee && myResourceId ? myResourceId : formData.resource_id;
    if (!resourceId) {
      showError('Missing resource', 'Please select a resource.');
      return;
    }
    if (!formData.project_id) {
      showError('Missing project', 'Please select a project.');
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
        // planned_fte_percent is omitted - backend will calculate it automatically
      });
      showSuccess('Actual line created');
      setIsDialogOpen(false);
      loadActuals();
      
      // Reset form
      setFormData({
        period_id: selectedPeriodId,
        resource_id: '',
        project_id: '',
        actual_fte_percent: 50,
      });
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
      loadActuals();
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to delete actual line');
    }
  };
  
  const handleSign = async () => {
    if (!selectedActual) return;
    
    try {
      if (isProxySign) {
        if (!proxyReason.trim()) {
          showError('Reason is required for proxy signing');
          return;
        }
        await actualsApi.proxySignActuals(selectedActual.id, proxyReason);
        showSuccess('Proxy signed successfully');
      } else {
        await actualsApi.signActuals(selectedActual.id);
        showSuccess('Signed successfully');
      }
      
      setIsSignDialogOpen(false);
      setSelectedActual(null);
      setProxyReason('');
      setIsProxySign(false);
      loadActuals();
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to sign actuals');
    }
  };
  
  const openSignDialog = (actual: ActualLine, proxy: boolean = false) => {
    setSelectedActual(actual);
    setIsProxySign(proxy);
    setIsSignDialogOpen(true);
  };
  
  // New function to reload actuals after edit/save
  const reloadActuals = async () => {
    try {
      setLoading(true);
      const data = isEmployee 
        ? await actualsApi.getMyActuals(ctxPeriod?.year, ctxPeriod?.month)
        : await actualsApi.getActualLines(undefined, ctxPeriod?.year, ctxPeriod?.month);
      setActuals(data);
      setOverLimitIds([]);
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
      await reloadActuals();
    } catch (err) {
      showApiError(err as Error, 'Failed to update actual line');
    }
  };
  
  const getProjectName = (id: string) => projects.find(p => p.id === id)?.name || 'Unknown';
  const getResourceName = (id: string) => resources.find(r => r.id === id)?.display_name || 'Unknown';
  
  const currentPeriod = ctxPeriod;
  const isLocked = currentPeriod?.status === 'locked';

  const filteredActuals = useMemo(() => {
    let out = actuals;
    if (selectedResourceFilter) {
      out = out.filter(a => a.resource_id === selectedResourceFilter);
    }
    if (selectedProjectFilter) {
      out = out.filter(a => a.project_id === selectedProjectFilter);
    }
    return out;
  }, [actuals, selectedResourceFilter, selectedProjectFilter]);

  const sortedActuals = useMemo(() => {
    const getRes = (id: string) => resources.find(r => r.id === id)?.display_name || 'Unknown';
    const getProj = (id: string) => projects.find(p => p.id === id)?.name || 'Unknown';
    return [...filteredActuals].sort((a, b) => {
      const dir = sortAsc ? 1 : -1;
      switch (sortBy) {
        case 'resource':
          return ((a.resource_name ?? getRes(a.resource_id)) || '').localeCompare((b.resource_name ?? getRes(b.resource_id)) || '') * dir;
        case 'project':
          return ((a.project_name ?? getProj(a.project_id)) || '').localeCompare((b.project_name ?? getProj(b.project_id)) || '') * dir;
        case 'period':
          return ((a.year * 12 + a.month) - (b.year * 12 + b.month)) * dir;
        case 'actual':
          return (a.actual_fte_percent - b.actual_fte_percent) * dir;
        default:
          return 0;
      }
    });
  }, [filteredActuals, sortBy, sortAsc, resources, projects]);

  const handleSort = (key: 'resource' | 'project' | 'period' | 'actual') => {
    if (sortBy === key) setSortAsc(prev => !prev);
    else { setSortBy(key); setSortAsc(true); }
  };
  const sortIndicator = (key: string) => (sortBy === key ? (sortAsc ? ' \u25B2' : ' \u25BC') : '');
  
  // Calculate total by resource
  const totalsByResource: Record<string, number> = {};
  actuals.forEach(a => {
    if (!totalsByResource[a.resource_id]) {
      totalsByResource[a.resource_id] = 0;
    }
    totalsByResource[a.resource_id] += a.actual_fte_percent;
  });
  
  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerContent}>
            <Skeleton style={{ width: 200, height: 28, marginBottom: 4 }}><SkeletonItem /></Skeleton>
            <Skeleton style={{ width: 280, height: 16 }}><SkeletonItem /></Skeleton>
          </div>
        </div>
        <div className={styles.toolbar}>
          <Skeleton style={{ width: 120, height: 24 }}><SkeletonItem /></Skeleton>
          <Skeleton style={{ width: 100, height: 24 }}><SkeletonItem /></Skeleton>
        </div>
        <Skeleton style={{ height: 80, marginBottom: 16 }}><SkeletonItem /></Skeleton>
        <Skeleton style={{ height: 300 }}><SkeletonItem /></Skeleton>
      </div>
    );
  }
  
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.pageTitle}>Actuals Entry</h1>
          <p className={styles.pageSubtitle}>Record actual time spent on projects</p>
        </div>
        
        <div style={{ display: 'flex', gap: tokens.spacingHorizontalM, alignItems: 'center', flexWrap: 'wrap' }}>
          {isLocked && (
            <MessageBar intent="warning" style={{ flex: '1 1 100%' }}>
              <MessageBarBody>
                This period is locked. Select an open period in the dropdown above, or ask Finance to unlock this period.
              </MessageBarBody>
            </MessageBar>
          )}
          {!isLocked && (
            <Dialog 
              open={isDialogOpen} 
              onOpenChange={(_, data) => {
                setIsDialogOpen(data.open);
                // Auto-set resource for employees when dialog opens
                if (data.open && isEmployee && myResourceId) {
                  setFormData(prev => ({ ...prev, resource_id: myResourceId }));
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
                        <Select
                          value={formData.resource_id}
                          onChange={(_, data) => setFormData({ ...formData, resource_id: data.value })}
                        >
                          <option value="">Select resource...</option>
                          {resources.map(r => (
                            <option key={r.id} value={r.id}>{r.display_name}</option>
                          ))}
                        </Select>
                      )}
                    </div>
                    
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
                        !formData.project_id
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
      </div>

      {/* Sticky toolbar */}
      <div className={styles.toolbar}>
        <span className={styles.toolbarLabel}>Period</span>
        <Body1 style={{ fontWeight: tokens.fontWeightSemibold }}>
          {currentPeriod ? `${monthNames[currentPeriod.month - 1]} ${currentPeriod.year}` : '—'}
        </Body1>
        {!isEmployee && (
          <>
            <span className={styles.toolbarLabel}>Resource</span>
            <Select
              value={selectedResourceFilter ?? ''}
              onChange={(_, d) => setSelectedResourceFilter(d.value || null)}
              style={{ minWidth: 160 }}
            >
              <option value="">All resources</option>
              {resources.map(r => (
                <option key={r.id} value={r.id}>{r.display_name}</option>
              ))}
            </Select>
            <span className={styles.toolbarLabel}>Project</span>
            <Select
              value={selectedProjectFilter ?? ''}
              onChange={(_, d) => setSelectedProjectFilter(d.value || null)}
              style={{ minWidth: 160 }}
            >
              <option value="">All projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
            {(selectedResourceFilter || selectedProjectFilter) && (
              <Button
                appearance="subtle"
                size="small"
                onClick={() => {
                  setSelectedResourceFilter(null);
                  setSelectedProjectFilter(null);
                }}
              >
                Clear filters
              </Button>
            )}
          </>
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
      
      {/* Demand and Supply Summary for Employees */}
      {isEmployee && selectedPeriodId && (demandLines.length > 0 || supplyLines.length > 0) && (
        <Card className={styles.card} style={{ marginBottom: tokens.spacingVerticalL }}>
          <CardHeader header={<Title1>Planning Summary</Title1>} />
          <div className={styles.planningSummary}>
            <div className={styles.summaryGrid}>
              <div
                className={`${styles.summaryCard} ${styles.summaryCardClickable}`}
                onClick={() => demandLines.length > 0 && setPlanningLinesModal('demand')}
                role={demandLines.length > 0 ? 'button' : undefined}
                tabIndex={demandLines.length > 0 ? 0 : undefined}
                onKeyDown={demandLines.length > 0 ? (e) => e.key === 'Enter' && setPlanningLinesModal('demand') : undefined}
              >
                <Body1 className={styles.summaryLabel}>Total Demand</Body1>
                <Body1 className={styles.summaryValue} style={{ color: tokens.colorPaletteBlueForeground2 }}>
                  {demandLines.reduce((sum, d) => sum + (d.fte_percent || 0), 0)}%
                </Body1>
                <Body1 style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                  {demandLines.length} demand line{demandLines.length !== 1 ? 's' : ''} across {new Set(demandLines.map(d => d.project_id)).size} project{new Set(demandLines.map(d => d.project_id)).size !== 1 ? 's' : ''}
                </Body1>
              </div>
              <div
                className={`${styles.summaryCard} ${styles.summaryCardClickable}`}
                onClick={() => supplyLines.length > 0 && setPlanningLinesModal('supply')}
                role={supplyLines.length > 0 ? 'button' : undefined}
                tabIndex={supplyLines.length > 0 ? 0 : undefined}
                onKeyDown={supplyLines.length > 0 ? (e) => e.key === 'Enter' && setPlanningLinesModal('supply') : undefined}
              >
                <Body1 className={styles.summaryLabel}>Total Supply</Body1>
                <Body1 className={styles.summaryValue} style={{ color: tokens.colorPaletteGreenForeground1 }}>
                  {supplyLines.reduce((sum, s) => sum + (s.fte_percent || 0), 0)}%
                </Body1>
                <Body1 style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                  {supplyLines.length} supply line{supplyLines.length !== 1 ? 's' : ''}
                </Body1>
              </div>
            </div>
          </div>
        </Card>
      )}
      
      {/* Resource totals scoreboard */}
      {Object.keys(totalsByResource).length > 0 && (
        <div style={{ marginBottom: tokens.spacingVerticalL }}>
          <div className={styles.toolbarLabel} style={{ marginBottom: tokens.spacingVerticalS }}>Resource Totals</div>
          <div className={styles.scoreboardRow}>
            {Object.entries(totalsByResource).map(([resourceId, total]) => (
              <div
                key={resourceId}
                className={`${styles.scoreboardItem} ${selectedResourceFilter === resourceId ? styles.scoreboardItemActive : ''}`}
                style={total > 100 ? { borderColor: tokens.colorPaletteRedBorder1 } : total === 100 ? { borderColor: tokens.colorPaletteGreenBorder1 } : undefined}
                onClick={() => isRO && setSelectedResourceFilter(prev => prev === resourceId ? null : resourceId)}
                role={isRO ? 'button' : undefined}
                tabIndex={isRO ? 0 : undefined}
                onKeyDown={isRO ? (e) => e.key === 'Enter' && setSelectedResourceFilter(prev => prev === resourceId ? null : resourceId) : undefined}
              >
                <span className={styles.scoreboardValue}>
                  {total}% / 100%
                </span>
                <span className={styles.scoreboardLabel}>{getResourceName(resourceId)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      
      <Card className={styles.card}>
        <CardHeader header={<Body1><strong>Actual Lines ({sortedActuals.length})</strong></Body1>} />
        
        <Table className={styles.sortableTable}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell onClick={() => handleSort('resource')}>Resource{sortIndicator('resource')}</TableHeaderCell>
              <TableHeaderCell onClick={() => handleSort('project')}>Project{sortIndicator('project')}</TableHeaderCell>
              <TableHeaderCell onClick={() => handleSort('period')}>Period{sortIndicator('period')}</TableHeaderCell>
              <TableHeaderCell>Planned</TableHeaderCell>
              <TableHeaderCell onClick={() => handleSort('actual')}>Actual{sortIndicator('actual')}</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedActuals.length === 0 ? (
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
              sortedActuals.map(a => (
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
                    {a.employee_signed_at ? (
                      <Badge appearance="filled" color="success" icon={<CheckmarkCircle24Regular />}>
                        {a.is_proxy_signed ? 'Proxy Signed' : 'Signed'}
                      </Badge>
                    ) : (
                      <Badge appearance="outline" color="warning">Unsigned</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div style={{ display: 'flex', gap: tokens.spacingHorizontalXS }}>
                      {!a.employee_signed_at && !isLocked && isEmployee && (
                        <Button
                          icon={<ClipboardTaskRegular />}
                          appearance="subtle"
                          title="Edit"
                          onClick={() => openEditDialog(a)}
                        />
                      )}
                      {/* Employee can sign their own actuals */}
                      {isEmployee && (
                        <Button
                          icon={<Signature24Regular />}
                          appearance="subtle"
                          title="Sign"
                          onClick={() => openSignDialog(a, false)}
                        />
                      )}
                      {/* RO can proxy-sign for absent employees */}
                      {isRO && (
                        <Button
                          icon={<Signature24Regular />}
                          appearance="subtle"
                          title="Proxy Sign (RO)"
                          onClick={() => openSignDialog(a, true)}
                        />
                      )}
                      {!a.employee_signed_at && !isLocked && (
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
      
      {/* Sign Dialog */}
      <Dialog open={isSignDialogOpen} onOpenChange={(_e: unknown, data: { open: boolean }) => setIsSignDialogOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{isProxySign ? 'Proxy Sign Actuals' : 'Sign Actuals'}</DialogTitle>
            <DialogContent>
              {isProxySign ? (
                <>
                  <MessageBar intent="warning" style={{ marginBottom: tokens.spacingVerticalM }}>
                    <MessageBarBody>
                      You are signing on behalf of an absent employee. This action will be audited.
                    </MessageBarBody>
                  </MessageBar>
                  <div className={styles.formField}>
                    <label>Reason for proxy signing (required)</label>
                    <Textarea
                      value={proxyReason}
                      onChange={(_, data) => setProxyReason(data.value)}
                      placeholder="e.g., Employee on extended leave"
                    />
                  </div>
                </>
              ) : (
                <Body1>
                  Confirm that the actuals are accurate and ready for approval.
                </Body1>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setIsSignDialogOpen(false)}>Cancel</Button>
              <Button appearance="primary" onClick={handleSign}>
                {isProxySign ? 'Proxy Sign' : 'Sign'}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      
      {/* Edit Dialog */}
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

      {/* Planning Lines Modal (Demand / Supply) */}
      <Dialog open={planningLinesModal !== null} onOpenChange={(_, data) => !data.open && setPlanningLinesModal(null)}>
        <DialogSurface style={{ maxWidth: 560 }}>
          <DialogBody>
            <DialogTitle>
              {planningLinesModal === 'demand' ? 'Demand Lines Assigned to You' : 'Supply Lines Assigned to You'}
            </DialogTitle>
            <DialogContent>
              {planningLinesModal === 'demand' && (
                <Table className={styles.sortableTable}>
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell>Project</TableHeaderCell>
                      <TableHeaderCell>Resource / Placeholder</TableHeaderCell>
                      <TableHeaderCell>FTE %</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {demandLines.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>{d.project_name ?? getProjectName(d.project_id)}</TableCell>
                        <TableCell>{d.resource_name ?? d.placeholder_name ?? '—'}</TableCell>
                        <TableCell>{d.fte_percent}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {planningLinesModal === 'supply' && (
                <Table className={styles.sortableTable}>
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell>Project</TableHeaderCell>
                      <TableHeaderCell>FTE %</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {supplyLines.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{s.project_name ?? getProjectName(s.project_id ?? '') ?? '—'}</TableCell>
                        <TableCell>{s.fte_percent}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPlanningLinesModal(null)}>Close</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
};

export default Actuals;
