import React, { useState, useEffect, useCallback } from 'react';
import {
  makeStyles,
  tokens,
  Button,
  Input,
  Label,
  Spinner,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Select,
  Body2,
  Caption1,
} from '@fluentui/react-components';
import { AddRegular, EditRegular, DeleteRegular, DocumentTableRegular } from '@fluentui/react-icons';
import { projectCostsApi, ExternalLine } from '../../api/projectCosts';
import type { ExternalResource } from '../../api/projectCosts';
import { useHasRole } from '../../auth/AuthProvider';
import { useToast } from '../../hooks/useToast';
import type { Project } from '../../api/lookups';

interface Props {
  periodId: string;
  projectId: string;
  projects: Project[];
}

const formatDKK = (cents: number) =>
  new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 }).format(
    cents / 100,
  );

const useStyles = makeStyles({
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: tokens.spacingVerticalM,
  },
  tableWrap: {
    width: '100%',
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  th: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: 'left',
  },
  thRight: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: 'right',
  },
  td: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    textAlign: 'left',
    verticalAlign: 'middle',
  },
  tdRight: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    textAlign: 'right',
    verticalAlign: 'middle',
  },
  tdActions: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    textAlign: 'right',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
  },
  trHover: {
    '&:hover': { backgroundColor: tokens.colorNeutralBackground2 },
  },
  totalTd: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    borderTop: `2px solid ${tokens.colorNeutralStroke2}`,
    borderBottom: 'none',
    fontWeight: tokens.fontWeightBold,
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: 'left',
  },
  totalTdRight: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    borderTop: `2px solid ${tokens.colorNeutralStroke2}`,
    borderBottom: 'none',
    fontWeight: tokens.fontWeightBold,
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: 'right',
  },
  actions: {
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
    justifyContent: 'flex-end',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    marginBottom: tokens.spacingVerticalM,
  },
  computedTotal: {
    marginTop: tokens.spacingVerticalXS,
    color: tokens.colorNeutralForeground2,
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    padding: tokens.spacingVerticalXXL,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: tokens.spacingVerticalXXL,
    color: tokens.colorNeutralForeground3,
    gap: tokens.spacingVerticalS,
  },
  muted: {
    color: tokens.colorNeutralForeground3,
  },
});

const OTHER = '__other__';
const emptyForm = { project_id: '', resource_id: '', notes: '', hours: '', rate: '' };

export const ExternalsPanel: React.FC<Props> = ({ periodId, projectId, projects }) => {
  const styles = useStyles();
  const { showSuccess, showError, showApiError } = useToast();
  const canEdit = useHasRole('Admin', 'Finance', 'PM');

  const [lines, setLines] = useState<ExternalLine[]>([]);
  const [externalResources, setExternalResources] = useState<ExternalResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<ExternalLine | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  // Load external resources list once
  useEffect(() => {
    projectCostsApi.listExternalResources().then(setExternalResources).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!periodId) return;
    setLoading(true);
    try {
      const data = await projectCostsApi.listExternals({
        period_id: periodId,
        project_id: projectId || undefined,
      });
      setLines(data);
    } catch (err) {
      showApiError(err as Error, 'loading externals');
    } finally {
      setLoading(false);
    }
  }, [periodId, projectId, showApiError]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditingLine(null);
    setForm({
      ...emptyForm,
      project_id: projectId || (projects[0]?.id ?? ''),
      resource_id: externalResources[0]?.id ?? OTHER,
    });
    setDialogOpen(true);
  };

  const openEdit = (line: ExternalLine) => {
    setEditingLine(line);
    setForm({
      project_id: line.project_id,
      resource_id: line.resource_id ?? OTHER,
      notes: line.notes ?? '',
      hours: String(line.hours),
      rate: String(line.rate / 100),
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingLine(null);
  };

  const computedTotal = () => {
    const h = parseFloat(form.hours);
    const r = parseFloat(form.rate);
    if (!isNaN(h) && !isNaN(r) && h > 0 && r > 0) {
      return formatDKK(Math.round(h * r * 100));
    }
    return null;
  };

  const handleSave = async () => {
    const hours = parseInt(form.hours, 10);
    const rate = Math.round(parseFloat(form.rate) * 100);
    if (!form.project_id) return showError('Project is required');
    if (!form.resource_id) return showError('External resource is required');
    if (form.resource_id === OTHER && !form.notes.trim()) return showError('Name / Description is required for "Other"');
    if (isNaN(hours) || hours < 1) return showError('Hours must be at least 1');
    if (isNaN(rate) || rate < 1) return showError('Rate must be a positive number');

    const isOther = form.resource_id === OTHER;
    setSaving(true);
    try {
      if (editingLine) {
        await projectCostsApi.updateExternal(editingLine.id, {
          resource_id: isOther ? undefined : (form.resource_id || undefined),
          notes: form.notes || undefined,
          hours,
          rate,
        });
        showSuccess('External line updated');
      } else {
        await projectCostsApi.createExternal({
          project_id: form.project_id,
          period_id: periodId,
          resource_id: isOther ? undefined : form.resource_id,
          notes: form.notes || undefined,
          hours,
          rate,
        });
        showSuccess('External line added');
      }
      closeDialog();
      load();
    } catch (err) {
      showApiError(err as Error, 'saving external line');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (line: ExternalLine) => {
    const name = line.resource_name ?? line.notes ?? 'this line';
    if (!confirm(`Delete line for "${name}"?`)) return;
    try {
      await projectCostsApi.deleteExternal(line.id);
      showSuccess('External line deleted');
      load();
    } catch (err) {
      showApiError(err as Error, 'deleting external line');
    }
  };

  const grandTotal = lines.reduce((s, l) => s + l.total_cost, 0);

  if (loading) return <div className={styles.loading}><Spinner /></div>;

  return (
    <div>
      <div className={styles.toolbar}>
        <Body2 className={styles.muted}>{lines.length} line{lines.length !== 1 ? 's' : ''}</Body2>
        {canEdit && (
          <Button appearance="primary" icon={<AddRegular />} onClick={openCreate}>
            Add External
          </Button>
        )}
      </div>

      {lines.length === 0 ? (
        <div className={styles.emptyState}>
          <DocumentTableRegular style={{ fontSize: 48 }} />
          <Body2>No external lines for this period.</Body2>
          {canEdit && <Caption1>Click "Add External" to record an external resource cost.</Caption1>}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Project</th>
                <th className={styles.th}>External Resource</th>
                <th className={styles.th}>Notes</th>
                <th className={styles.thRight}>Hours</th>
                <th className={styles.thRight}>Rate (DKK/hr)</th>
                <th className={styles.thRight}>Total</th>
                {canEdit && <th className={styles.thRight} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className={styles.trHover}>
                  <td className={styles.td}>{line.project_name ?? line.project_id}</td>
                  <td className={styles.td}>{line.resource_name ?? (line.notes ? <em>{line.notes}</em> : <span className={styles.muted}>—</span>)}</td>
                  <td className={styles.td}>{line.resource_name && line.notes ? <span>{line.notes}</span> : <span className={styles.muted}>—</span>}</td>
                  <td className={styles.tdRight}>{line.hours}</td>
                  <td className={styles.tdRight}>{formatDKK(line.rate)}</td>
                  <td className={styles.tdRight}>{formatDKK(line.total_cost)}</td>
                  {canEdit && (
                    <td className={styles.tdActions}>
                      <div className={styles.actions}>
                        <Button appearance="subtle" icon={<EditRegular />} size="small" onClick={() => openEdit(line)} />
                        <Button appearance="subtle" icon={<DeleteRegular />} size="small" onClick={() => handleDelete(line)} />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              <tr>
                <td className={styles.totalTd} colSpan={5}>Total Externals</td>
                <td className={styles.totalTdRight}>{formatDKK(grandTotal)}</td>
                {canEdit && <td className={styles.totalTd} />}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(_, d) => { if (!d.open) closeDialog(); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{editingLine ? 'Edit External Line' : 'Add External Line'}</DialogTitle>
            <DialogContent>
              {!editingLine && (
                <div className={styles.field}>
                  <Label required>Project</Label>
                  <Select
                    value={form.project_id}
                    onChange={(_, d) => setForm((f) => ({ ...f, project_id: d.value }))}
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </div>
              )}
              <div className={styles.field}>
                <Label required>External Resource</Label>
                <Select
                  value={form.resource_id}
                  onChange={(_, d) => setForm((f) => ({ ...f, resource_id: d.value }))}
                >
                  <option value="">— select resource —</option>
                  {externalResources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.display_name}{r.initials ? ` (${r.initials})` : ''}
                    </option>
                  ))}
                  <option value={OTHER}>Other (free text)</option>
                </Select>
              </div>
              {form.resource_id === OTHER ? (
                <div className={styles.field}>
                  <Label required>Name / Description</Label>
                  <Input
                    placeholder="e.g. Freelance developer, Agency XYZ"
                    value={form.notes}
                    onChange={(_, d) => setForm((f) => ({ ...f, notes: d.value }))}
                  />
                </div>
              ) : (
              <div className={styles.field}>
                <Label>Notes</Label>
                <Input
                  placeholder="Optional notes"
                  value={form.notes}
                  onChange={(_, d) => setForm((f) => ({ ...f, notes: d.value }))}
                />
              </div>
              )}
              <div className={styles.field}>
                <Label required>Hours</Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={form.hours}
                  onChange={(_, d) => setForm((f) => ({ ...f, hours: d.value }))}
                />
              </div>
              <div className={styles.field}>
                <Label required>Rate (DKK/hr)</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.rate}
                  onChange={(_, d) => setForm((f) => ({ ...f, rate: d.value }))}
                />
                {computedTotal() && (
                  <Caption1 className={styles.computedTotal}>Total: {computedTotal()}</Caption1>
                )}
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={closeDialog} disabled={saving}>Cancel</Button>
              <Button appearance="primary" onClick={handleSave} disabled={saving}>
                {saving ? <Spinner size="tiny" /> : 'Save'}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
};
