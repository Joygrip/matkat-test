import React, { useState, useEffect, useCallback } from 'react';
import {
  makeStyles,
  tokens,
  Button,
  Input,
  Label,
  Spinner,
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
import { AddRegular, EditRegular, DeleteRegular, DocumentTableRegular, ArrowDownloadRegular } from '@fluentui/react-icons';
import { projectCostsApi, ExternalLine } from '../../api/projectCosts';
import { useHasRole } from '../../auth/AuthProvider';
import { useToast } from '../../hooks/useToast';
import type { Project } from '../../api/lookups';
import { formatDKKFromCents } from '../../utils/format';

interface Props {
  periodId: string;
  projectId: string;
  projects: Project[];
}

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

const emptyForm = { project_id: '', description: '', notes: '', cost: '' };

export const ExternalsPanel: React.FC<Props> = ({ periodId, projectId, projects }) => {
  const styles = useStyles();
  const { showSuccess, showError, showApiError } = useToast();
  const canEdit = useHasRole('Admin', 'Finance', 'PM');

  const [lines, setLines] = useState<ExternalLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<ExternalLine | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

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
    });
    setDialogOpen(true);
  };

  const openEdit = (line: ExternalLine) => {
    setEditingLine(line);
    setForm({
      project_id: line.project_id,
      description: line.description ?? '',
      notes: line.notes ?? '',
      cost: String(line.cost / 100),
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingLine(null);
  };

  const handleSave = async () => {
    const cost = Math.round(parseFloat(form.cost) * 100);
    if (!form.project_id) return showError('Project is required');
    if (!form.description.trim()) return showError('Name / Description is required');
    if (isNaN(cost) || cost < 1) return showError('Cost must be a positive number');

    setSaving(true);
    try {
      if (editingLine) {
        await projectCostsApi.updateExternal(editingLine.id, {
          description: form.description,
          notes: form.notes || undefined,
          cost,
        });
        showSuccess('External line updated');
      } else {
        await projectCostsApi.createExternal({
          project_id: form.project_id,
          period_id: periodId,
          description: form.description,
          notes: form.notes || undefined,
          cost,
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
    const name = line.resource_name ?? line.description ?? 'this line';
    if (!confirm(`Delete line for "${name}"?`)) return;
    try {
      await projectCostsApi.deleteExternal(line.id);
      showSuccess('External line deleted');
      load();
    } catch (err) {
      showApiError(err as Error, 'deleting external line');
    }
  };

  const grandTotal = lines.reduce((s, l) => s + l.cost, 0);

  const downloadCsv = () => {
    const header = ['Project', 'OoP Resource', 'Notes', 'Cost (DKK)'];
    const escape = (v: string | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = lines.map((l) => [
      escape(l.project_name ?? l.project_id),
      escape(l.resource_name ?? l.description ?? ''),
      escape(l.notes ?? ''),
      (l.cost / 100).toFixed(2),
    ]);
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project_costs_oop.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className={styles.loading}><Spinner /></div>;

  return (
    <div>
      <div className={styles.toolbar}>
        <Body2 className={styles.muted}>{lines.length} line{lines.length !== 1 ? 's' : ''}</Body2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {lines.length > 0 && (
            <Button appearance="outline" icon={<ArrowDownloadRegular />} onClick={downloadCsv}>
              Download CSV
            </Button>
          )}
          {canEdit && (
            <Button appearance="primary" icon={<AddRegular />} onClick={openCreate}>
              Add OoP
            </Button>
          )}
        </div>
      </div>

      {lines.length === 0 ? (
        <div className={styles.emptyState}>
          <DocumentTableRegular style={{ fontSize: 48 }} />
          <Body2>No OoP lines for this period.</Body2>
          {canEdit && <Caption1>Click "Add OoP" to record an OoP resource cost.</Caption1>}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Project</th>
                <th className={styles.th}>OoP Resource</th>
                <th className={styles.th}>Notes</th>
                <th className={styles.thRight}>Cost</th>
                {canEdit && <th className={styles.thRight} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className={styles.trHover}>
                  <td className={styles.td}>{line.project_name ?? line.project_id}</td>
                  <td className={styles.td}>{line.resource_name ?? (line.description ? <em>{line.description}</em> : <span className={styles.muted}>—</span>)}</td>
                  <td className={styles.td}>{line.notes ? <span>{line.notes}</span> : <span className={styles.muted}>—</span>}</td>
                  <td className={styles.tdRight}>{formatDKKFromCents(line.cost)}</td>
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
                <td className={styles.totalTd} colSpan={3}>Total OoP</td>
                <td className={styles.totalTdRight}>{formatDKKFromCents(grandTotal)}</td>
                {canEdit && <td className={styles.totalTd} />}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(_, d) => { if (!d.open) closeDialog(); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{editingLine ? 'Edit OoP Line' : 'Add OoP Line'}</DialogTitle>
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
                <Label required>Name / Description</Label>
                <Input
                  placeholder="e.g. Freelance developer, Agency XYZ"
                  value={form.description}
                  onChange={(_, d) => setForm((f) => ({ ...f, description: d.value }))}
                />
              </div>
              <div className={styles.field}>
                <Label>Notes</Label>
                <Input
                  placeholder="Optional additional notes"
                  value={form.notes}
                  onChange={(_, d) => setForm((f) => ({ ...f, notes: d.value }))}
                />
              </div>
              <div className={styles.field}>
                <Label required>Cost (DKK)</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.cost}
                  onChange={(_, d) => setForm((f) => ({ ...f, cost: d.value }))}
                />
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
