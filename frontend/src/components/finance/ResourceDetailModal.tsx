import { useState, useEffect } from 'react';
import {
  makeStyles,
  tokens,
  Body2,
  Caption1,
  Subtitle2,
  Badge,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  Button,
  Spinner,
  Divider,
  Select,
  type DialogOpenChangeData,
  type DialogOpenChangeEvent,
} from '@fluentui/react-components';
import {
  PersonRegular,
  Dismiss24Regular,
  Edit24Regular,
  Delete24Regular,
  AddRegular,
  CheckmarkRegular,
  DismissRegular,
} from '@fluentui/react-icons';
import type { ResourceDetail } from '../../api/consolidation';
import { consolidationApi } from '../../api/consolidation';
import { planningApi, type DemandLine, type SupplyLine } from '../../api/planning';
import { lookupsApi, type Project } from '../../api/lookups';
import { useToast } from '../../hooks/useToast';
import { usePeriod } from '../../contexts/PeriodContext';
import { GapBadge } from './FinanceBadges';

export interface ResourceDetailModalProps {
  open: boolean;
  resourceId: string | null;
  resourceName: string;
  detail: ResourceDetail | null;
  loading: boolean;
  periodId: string | null;
  canEditDemand: boolean;  // Finance, PM
  canEditSupply: boolean;  // Finance, Manager
  isPM: boolean;           // PM: scoped projects + per-line project gate
  onClose: () => void;
  onDataChanged: () => void;
}

const useStyles = makeStyles({
  assignmentSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: tokens.spacingVerticalS,
  },
  sectionTitleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: tokens.spacingVerticalXS,
  },
  sectionTitleLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
  actionCell: {
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
    justifyContent: 'flex-end',
    minWidth: '80px',
  },
});

export function ResourceDetailModal({
  open,
  resourceId,
  resourceName,
  detail,
  loading,
  periodId,
  canEditDemand,
  canEditSupply,
  isPM,
  onClose,
  onDataChanged,
}: ResourceDetailModalProps) {
  const styles = useStyles();
  const { showSuccess, showApiError } = useToast();
  const { periods } = usePeriod();
  const selectedPeriod = periods.find(p => p.id === periodId);

  // Planning lines (editable, with IDs)
  const [demandLines, setDemandLines] = useState<DemandLine[]>([]);
  const [supplyLines, setSupplyLines] = useState<SupplyLine[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);

  // Refreshable summary detail
  const [localDetail, setLocalDetail] = useState<ResourceDetail | null>(null);

  // Inline edit state — demand
  const [editingDemandId, setEditingDemandId] = useState<string | null>(null);
  const [addingDemand, setAddingDemand] = useState(false);
  const [demandForm, setDemandForm] = useState({ project_id: '', fte_percent: 50 });

  // Inline edit state — supply
  const [editingSupplyId, setEditingSupplyId] = useState<string | null>(null);
  const [addingSupply, setAddingSupply] = useState(false);
  const [supplyForm, setSupplyForm] = useState({ project_id: '', fte_percent: 100 });

  const [saving, setSaving] = useState(false);

  // Sync incoming detail into local state
  useEffect(() => {
    setLocalDetail(detail);
  }, [detail]);

  // Load editable planning lines when modal opens
  useEffect(() => {
    if (!open) {
      setEditingDemandId(null);
      setEditingSupplyId(null);
      setAddingDemand(false);
      setAddingSupply(false);
      setDemandLines([]);
      setSupplyLines([]);
      return;
    }
    if ((canEditDemand || canEditSupply) && periodId && resourceId) {
      loadLines();
      if (projects.length === 0) loadProjects();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canEditDemand, canEditSupply, periodId, resourceId]);

  const loadLines = async () => {
    if (!periodId || !resourceId) return;
    setLinesLoading(true);
    try {
      const [dl, sl] = await Promise.all([
        planningApi.getDemandLines(periodId, { resourceId }),
        planningApi.getSupplyLines(periodId, { resourceId }),
      ]);
      setDemandLines(dl);
      setSupplyLines(sl);
    } finally {
      setLinesLoading(false);
    }
  };

  const loadProjects = async () => {
    try {
      // PM gets only their scoped projects (backend enforces ownership)
      const ps = isPM ? await lookupsApi.listProjectsScoped() : await lookupsApi.listProjects();
      setProjects(ps);
    } catch {}
  };

  const refreshSummary = async () => {
    if (!periodId || !resourceId) return;
    try {
      const d = await consolidationApi.getResourceDetail(periodId, resourceId);
      setLocalDetail(d);
    } catch {}
  };

  // --- Demand handlers ---
  const startEditDemand = (line: DemandLine) => {
    setEditingDemandId(line.id);
    setAddingDemand(false);
    setDemandForm({ project_id: line.project_id, fte_percent: line.fte_percent });
  };

  const startAddDemand = () => {
    setAddingDemand(true);
    setEditingDemandId(null);
    setDemandForm({ project_id: '', fte_percent: 50 });
  };

  const cancelDemandEdit = () => {
    setEditingDemandId(null);
    setAddingDemand(false);
  };

  const saveDemand = async (lineId: string | null) => {
    if (!demandForm.project_id || !periodId || !resourceId) return;
    if (!lineId && (!selectedPeriod?.year || !selectedPeriod?.month)) return;
    setSaving(true);
    try {
      if (lineId) {
        await planningApi.updateDemandLine(lineId, {
          project_id: demandForm.project_id,
          fte_percent: demandForm.fte_percent,
        });
        showSuccess('Demand line updated');
      } else {
        await planningApi.createDemandLine({
          period_id: periodId,
          project_id: demandForm.project_id,
          resource_id: resourceId,
          fte_percent: demandForm.fte_percent,
          year: selectedPeriod!.year,
          month: selectedPeriod!.month,
        });
        showSuccess('Demand line added');
      }
      setEditingDemandId(null);
      setAddingDemand(false);
      await loadLines();
      await refreshSummary();
      onDataChanged();
    } catch (e: unknown) {
      showApiError(e as Error);
    } finally {
      setSaving(false);
    }
  };

  const deleteDemand = async (lineId: string) => {
    setSaving(true);
    try {
      await planningApi.deleteDemandLine(lineId);
      showSuccess('Demand line removed');
      await loadLines();
      await refreshSummary();
      onDataChanged();
    } catch (e: unknown) {
      showApiError(e as Error);
    } finally {
      setSaving(false);
    }
  };

  // --- Supply handlers ---
  const startEditSupply = (line: SupplyLine) => {
    setEditingSupplyId(line.id);
    setAddingSupply(false);
    setSupplyForm({ project_id: line.project_id ?? '', fte_percent: line.fte_percent });
  };

  const startAddSupply = () => {
    setAddingSupply(true);
    setEditingSupplyId(null);
    setSupplyForm({ project_id: '', fte_percent: 100 });
  };

  const cancelSupplyEdit = () => {
    setEditingSupplyId(null);
    setAddingSupply(false);
  };

  const saveSupply = async (lineId: string | null) => {
    if (!periodId || !resourceId) return;
    if (!lineId && (!selectedPeriod?.year || !selectedPeriod?.month)) return;
    setSaving(true);
    try {
      if (lineId) {
        await planningApi.updateSupplyLine(lineId, {
          project_id: supplyForm.project_id || undefined,
          fte_percent: supplyForm.fte_percent,
        });
        showSuccess('Supply line updated');
      } else {
        await planningApi.createSupplyLine({
          period_id: periodId,
          resource_id: resourceId,
          project_id: supplyForm.project_id || undefined,
          fte_percent: supplyForm.fte_percent,
          year: selectedPeriod!.year,
          month: selectedPeriod!.month,
        });
        showSuccess('Supply line added');
      }
      setEditingSupplyId(null);
      setAddingSupply(false);
      await loadLines();
      await refreshSummary();
      onDataChanged();
    } catch (e: unknown) {
      showApiError(e as Error);
    } finally {
      setSaving(false);
    }
  };

  const deleteSupply = async (lineId: string) => {
    setSaving(true);
    try {
      await planningApi.deleteSupplyLine(lineId);
      showSuccess('Supply line removed');
      await loadLines();
      await refreshSummary();
      onDataChanged();
    } catch (e: unknown) {
      showApiError(e as Error);
    } finally {
      setSaving(false);
    }
  };

  const activeDetail = localDetail ?? detail;
  const anyCanEdit = canEditDemand || canEditSupply;
  // When role can edit and lines are loaded, use planning lines for count/display
  const showEditableLines = anyCanEdit && !linesLoading;
  // For PM: set of project IDs they own — gates edit/delete buttons and filters visible lines
  const editableProjectIds = isPM ? new Set(projects.map(p => p.id)) : null;
  // PM only sees demand lines for their own projects
  const visibleDemandLines = editableProjectIds
    ? demandLines.filter(l => editableProjectIds.has(l.project_id))
    : demandLines;
  const visibleReadOnlyDemandLines = editableProjectIds && activeDetail
    ? activeDetail.demand_lines.filter(l => l.project_id && editableProjectIds.has(l.project_id))
    : activeDetail?.demand_lines ?? [];
  const demandCount = showEditableLines ? visibleDemandLines.length : visibleReadOnlyDemandLines.length;
  const supplyCount = showEditableLines ? supplyLines.length : (activeDetail?.supply_lines.length ?? 0);


  return (
    <Dialog open={open} onOpenChange={(_ev: DialogOpenChangeEvent, data: DialogOpenChangeData) => { if (!data.open) onClose(); }}>
      <DialogSurface style={{ minWidth: 600, maxWidth: 780 }}>
        <DialogBody>
          <DialogTitle
            action={
              <Button appearance="subtle" icon={<Dismiss24Regular />} onClick={onClose} />
            }
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS }}>
              <PersonRegular />
              {resourceName}
            </span>
          </DialogTitle>
          <DialogContent>
            {loading && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: tokens.spacingVerticalXL }}>
                <Spinner label="Loading assignments..." />
              </div>
            )}
            {!loading && activeDetail && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL }}>
                {/* Summary row */}
                <div style={{ display: 'flex', gap: tokens.spacingHorizontalXL }}>
                  <Body2>Demand: <strong>{activeDetail.total_demand_fte}%</strong></Body2>
                  <Body2>Supply: <strong>{activeDetail.total_supply_fte}%</strong></Body2>
                  <GapBadge gap={activeDetail.gap_fte} />
                </div>

                <Divider />

                {/* Demand assignments */}
                <div className={styles.assignmentSection}>
                  <div className={styles.sectionTitleRow}>
                    <div className={styles.sectionTitleLeft}>
                      <Subtitle2>Demand assignments</Subtitle2>
                      <Badge appearance="outline" size="small">{demandCount}</Badge>
                    </div>
                    {canEditDemand && (
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<AddRegular />}
                        onClick={startAddDemand}
                        disabled={addingDemand || saving}
                      >
                        Add
                      </Button>
                    )}
                  </div>

                  {linesLoading && canEditDemand ? (
                    <Spinner size="tiny" label="Loading..." />
                  ) : (
                    <>
                      {(showEditableLines ? visibleDemandLines.length === 0 : visibleReadOnlyDemandLines.length === 0) && !addingDemand ? (
                        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>No demand assignments.</Caption1>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHeaderCell>Project</TableHeaderCell>
                              <TableHeaderCell style={{ width: 90 }}>FTE %</TableHeaderCell>
                              {canEditDemand && <TableHeaderCell style={{ width: 100 }} />}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {showEditableLines
                              ? visibleDemandLines.map(line => (
                                  <TableRow key={line.id}>
                                    {editingDemandId === line.id ? (
                                      <>
                                        <TableCell>
                                          <Select
                                            value={demandForm.project_id}
                                            onChange={(e) => setDemandForm(f => ({ ...f, project_id: e.target.value }))}
                                            style={{ width: '100%' }}
                                          >
                                            <option value="">— select project —</option>
                                            {projects.map(p => (
                                              <option key={p.id} value={p.id}>{p.name}</option>
                                            ))}
                                          </Select>
                                        </TableCell>
                                        <TableCell>
                                          <input
                                            type="number"
                                            min={5}
                                            max={100}
                                            step={5}
                                            value={demandForm.fte_percent}
                                            onChange={(e) => setDemandForm(f => ({ ...f, fte_percent: Math.min(100, Math.max(5, parseInt(e.target.value) || 5)) }))}
                                            style={{ width: '70px' }}
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <div className={styles.actionCell}>
                                            <Button size="small" appearance="primary" icon={<CheckmarkRegular />} onClick={() => saveDemand(line.id)} disabled={saving || !demandForm.project_id} />
                                            <Button size="small" appearance="subtle" icon={<DismissRegular />} onClick={cancelDemandEdit} disabled={saving} />
                                          </div>
                                        </TableCell>
                                      </>
                                    ) : (
                                      <>
                                        <TableCell>{line.project_name ?? '—'}</TableCell>
                                        <TableCell>{line.fte_percent}%</TableCell>
                                        {canEditDemand && (
                                          <TableCell>
                                            <div className={styles.actionCell}>
                                              <Button size="small" appearance="subtle" icon={<Edit24Regular />} onClick={() => startEditDemand(line)} disabled={saving || !!editingDemandId || addingDemand} title="Edit" />
                                              <Button size="small" appearance="subtle" icon={<Delete24Regular />} onClick={() => deleteDemand(line.id)} disabled={saving || !!editingDemandId || addingDemand} title="Delete" />
                                            </div>
                                          </TableCell>
                                        )}
                                      </>
                                    )}
                                  </TableRow>
                                ))
                              : visibleReadOnlyDemandLines.map((line, i) => (
                                  <TableRow key={i}>
                                    <TableCell>{line.project_name ?? '—'}</TableCell>
                                    <TableCell>{line.fte_percent}%</TableCell>
                                  </TableRow>
                                ))
                            }
                            {addingDemand && (
                              <TableRow>
                                <TableCell>
                                  <Select
                                    value={demandForm.project_id}
                                    onChange={(e) => setDemandForm(f => ({ ...f, project_id: e.target.value }))}
                                    style={{ width: '100%' }}
                                  >
                                    <option value="">— select project —</option>
                                    {projects.map(p => (
                                      <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                  </Select>
                                </TableCell>
                                <TableCell>
                                  <input
                                    type="number"
                                    min={5}
                                    max={100}
                                    step={5}
                                    value={demandForm.fte_percent}
                                    onChange={(e) => setDemandForm(f => ({ ...f, fte_percent: Math.min(100, Math.max(5, parseInt(e.target.value) || 5)) }))}
                                    style={{ width: '70px' }}
                                  />
                                </TableCell>
                                <TableCell>
                                  <div className={styles.actionCell}>
                                    <Button size="small" appearance="primary" icon={<CheckmarkRegular />} onClick={() => saveDemand(null)} disabled={saving || !demandForm.project_id} />
                                    <Button size="small" appearance="subtle" icon={<DismissRegular />} onClick={cancelDemandEdit} disabled={saving} />
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      )}
                    </>
                  )}
                </div>

                <Divider />

                {/* Supply assignments */}
                <div className={styles.assignmentSection}>
                  <div className={styles.sectionTitleRow}>
                    <div className={styles.sectionTitleLeft}>
                      <Subtitle2>Supply assignments</Subtitle2>
                      <Badge appearance="outline" size="small">{supplyCount}</Badge>
                    </div>
                    {canEditSupply && (
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<AddRegular />}
                        onClick={startAddSupply}
                        disabled={addingSupply || saving}
                      >
                        Add
                      </Button>
                    )}
                  </div>

                  {linesLoading && canEditSupply ? (
                    <Spinner size="tiny" label="Loading..." />
                  ) : (
                    <>
                      {(showEditableLines ? supplyLines.length === 0 : activeDetail.supply_lines.length === 0) && !addingSupply ? (
                        <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>No supply assignments.</Caption1>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHeaderCell>Project</TableHeaderCell>
                              <TableHeaderCell style={{ width: 90 }}>FTE %</TableHeaderCell>
                              {canEditSupply && <TableHeaderCell style={{ width: 100 }} />}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {showEditableLines
                              ? supplyLines.map(line => (
                                  <TableRow key={line.id}>
                                    {editingSupplyId === line.id ? (
                                      <>
                                        <TableCell>
                                          <Select
                                            value={supplyForm.project_id}
                                            onChange={(e) => setSupplyForm(f => ({ ...f, project_id: e.target.value }))}
                                            style={{ width: '100%' }}
                                          >
                                            <option value="">None (general availability)</option>
                                            {projects.map(p => (
                                              <option key={p.id} value={p.id}>{p.name}</option>
                                            ))}
                                          </Select>
                                        </TableCell>
                                        <TableCell>
                                          <input
                                            type="number"
                                            min={5}
                                            max={100}
                                            step={5}
                                            value={supplyForm.fte_percent}
                                            onChange={(e) => setSupplyForm(f => ({ ...f, fte_percent: Math.min(100, Math.max(5, parseInt(e.target.value) || 5)) }))}
                                            style={{ width: '70px' }}
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <div className={styles.actionCell}>
                                            <Button size="small" appearance="primary" icon={<CheckmarkRegular />} onClick={() => saveSupply(line.id)} disabled={saving} />
                                            <Button size="small" appearance="subtle" icon={<DismissRegular />} onClick={cancelSupplyEdit} disabled={saving} />
                                          </div>
                                        </TableCell>
                                      </>
                                    ) : (
                                      <>
                                        <TableCell>
                                          {line.project_name ?? <em style={{ color: tokens.colorNeutralForeground3 }}>General availability</em>}
                                        </TableCell>
                                        <TableCell>{line.fte_percent}%</TableCell>
                                        {canEditSupply && (
                                          <TableCell>
                                            <div className={styles.actionCell}>
                                              <Button size="small" appearance="subtle" icon={<Edit24Regular />} onClick={() => startEditSupply(line)} disabled={saving || !!editingSupplyId || addingSupply} title="Edit" />
                                              <Button size="small" appearance="subtle" icon={<Delete24Regular />} onClick={() => deleteSupply(line.id)} disabled={saving || !!editingSupplyId || addingSupply} title="Delete" />
                                            </div>
                                          </TableCell>
                                        )}
                                      </>
                                    )}
                                  </TableRow>
                                ))
                              : activeDetail.supply_lines.map((line, i) => (
                                  <TableRow key={i}>
                                    <TableCell>
                                      {line.project_name ?? <em style={{ color: tokens.colorNeutralForeground3 }}>General availability</em>}
                                    </TableCell>
                                    <TableCell>{line.fte_percent}%</TableCell>
                                  </TableRow>
                                ))
                            }
                            {addingSupply && (
                              <TableRow>
                                <TableCell>
                                  <Select
                                    value={supplyForm.project_id}
                                    onChange={(e) => setSupplyForm(f => ({ ...f, project_id: e.target.value }))}
                                    style={{ width: '100%' }}
                                  >
                                    <option value="">None (general availability)</option>
                                    {projects.map(p => (
                                      <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                  </Select>
                                </TableCell>
                                <TableCell>
                                  <input
                                    type="number"
                                    min={5}
                                    max={100}
                                    step={5}
                                    value={supplyForm.fte_percent}
                                    onChange={(e) => setSupplyForm(f => ({ ...f, fte_percent: Math.min(100, Math.max(5, parseInt(e.target.value) || 5)) }))}
                                    style={{ width: '70px' }}
                                  />
                                </TableCell>
                                <TableCell>
                                  <div className={styles.actionCell}>
                                    <Button size="small" appearance="primary" icon={<CheckmarkRegular />} onClick={() => saveSupply(null)} disabled={saving} />
                                    <Button size="small" appearance="subtle" icon={<DismissRegular />} onClick={cancelSupplyEdit} disabled={saving} />
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
