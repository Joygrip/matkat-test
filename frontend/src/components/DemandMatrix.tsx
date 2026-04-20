import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  Button,
  Spinner,
  tokens,
  makeStyles,
  Select,
} from '@fluentui/react-components';
import { Add24Regular, ChevronRight20Regular, ChevronDown20Regular } from '@fluentui/react-icons';
import { planningApi, DemandLine } from '../api/planning';
import { lookupsApi, Project, Resource, CostCenter } from '../api/lookups';
import { Period } from '../types';

const PERIOD_COL_WIDTH = 90; // used in inline styles (React auto-appends px)
const RESOURCE_COL_WIDTH = 200;
const PROJECT_COL_WIDTH = 160;
const PERIOD_COL_PX = '90px';
const RESOURCE_COL_PX = '200px';
const PROJECT_COL_PX = '160px';

const useStyles = makeStyles({
  wrapper: {
    overflowX: 'auto',
    width: '100%',
  },
  table: {
    borderCollapse: 'collapse',
    minWidth: '100%',
    fontSize: tokens.fontSizeBase200,
  },
  th: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: 'center' as const,
    whiteSpace: 'nowrap' as const,
    position: 'sticky' as const,
    top: 0,
    zIndex: 2,
  },
  thSticky: {
    position: 'sticky' as const,
    left: 0,
    zIndex: 3,
    textAlign: 'left' as const,
  },
  thProject: {
    position: 'sticky' as const,
    left: RESOURCE_COL_PX,
    zIndex: 3,
    textAlign: 'left' as const,
  },
  summaryRow: {
    backgroundColor: tokens.colorNeutralBackground3,
    cursor: 'pointer',
    ':hover': { filter: 'brightness(0.97)' },
  },
  summaryCell: {
    fontWeight: tokens.fontWeightSemibold,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap' as const,
    position: 'sticky' as const,
    left: 0,
    backgroundColor: tokens.colorNeutralBackground3,
    zIndex: 1,
  },
  summaryValueCell: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    textAlign: 'center' as const,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
    width: PERIOD_COL_PX,
  },
  subHeaderRow: {
    backgroundColor: tokens.colorNeutralBackground1,
  },
  subHeaderCell: {
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.4px',
    position: 'sticky' as const,
    left: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: 1,
  },
  subHeaderProjectCell: {
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.4px',
    position: 'sticky' as const,
    left: RESOURCE_COL_PX,
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: 1,
  },
  dataRow: {
    ':hover': { backgroundColor: tokens.colorNeutralBackground2 },
  },
  resourceCell: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    whiteSpace: 'nowrap' as const,
    position: 'sticky' as const,
    left: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: 1,
    minWidth: RESOURCE_COL_PX,
    maxWidth: RESOURCE_COL_PX,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
  },
  projectCell: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    whiteSpace: 'nowrap' as const,
    position: 'sticky' as const,
    left: RESOURCE_COL_PX,
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: 1,
    minWidth: PROJECT_COL_PX,
    maxWidth: PROJECT_COL_PX,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
  },
  valueCell: {
    padding: `2px ${tokens.spacingHorizontalXS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    textAlign: 'center' as const,
    width: PERIOD_COL_PX,
    minWidth: PERIOD_COL_PX,
  },
  cellInput: {
    width: '70px',
    textAlign: 'center' as const,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    borderRadius: tokens.borderRadiusSmall,
    padding: '2px 4px',
    fontSize: tokens.fontSizeBase200,
    outline: 'none',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  cellValue: {
    display: 'inline-block',
    minWidth: '40px',
    padding: '2px 6px',
    borderRadius: tokens.borderRadiusSmall,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase200,
    textAlign: 'center' as const,
    ':hover': { filter: 'brightness(0.94)' },
  },
  emptyCell: {
    color: tokens.colorNeutralForeground4,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase200,
    display: 'inline-block',
    minWidth: '40px',
    padding: '2px 6px',
    borderRadius: tokens.borderRadiusSmall,
    ':hover': { backgroundColor: tokens.colorNeutralBackground3 },
  },
  addLineRow: {
    backgroundColor: tokens.colorNeutralBackground1,
  },
  addLineCell: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  addLineForm: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    alignItems: 'center',
    flexWrap: 'wrap' as const,
  },
});

function getCellBg(fte: number): string {
  if (fte === 0) return 'transparent';
  if (fte < 80) return tokens.colorPaletteGreenBackground2;
  if (fte <= 100) return tokens.colorPaletteMarigoldBackground2;
  return tokens.colorPaletteRedBackground2;
}

function getCellFg(fte: number): string {
  if (fte === 0) return tokens.colorNeutralForeground3;
  if (fte < 80) return tokens.colorPaletteGreenForeground2;
  if (fte <= 100) return tokens.colorPaletteMarigoldForeground2;
  return tokens.colorPaletteRedForeground2;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface DemandMatrixProps {
  demandLines: DemandLine[];
  periods: Period[];
  projects: Project[];
  costCenters: CostCenter[];
  canEdit: boolean;
  onReload: () => void;
}

interface MatrixRow {
  resourceId: string;
  resourceName: string;
  projectId: string;
  projectName: string;
  lines: Map<string, DemandLine>; // periodId → DemandLine
}

interface MatrixGroup {
  ccId: string;
  ccName: string;
  rows: MatrixRow[];
}

export const DemandMatrix: React.FC<DemandMatrixProps> = ({
  demandLines,
  periods,
  projects,
  costCenters,
  canEdit,
  onReload,
}) => {
  const styles = useStyles();

  const [expandedCCs, setExpandedCCs] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [addLineCC, setAddLineCC] = useState<string | null>(null);
  const [addLineResource, setAddLineResource] = useState<string>('');
  const [addLineProject, setAddLineProject] = useState<string>('');
  const [ccResources, setCcResources] = useState<Record<string, Resource[]>>({});
  const [highlightRow, setHighlightRow] = useState<string | null>(null);

  // Local rows added via "Add line" before any demand lines exist for them
  const [localRows, setLocalRows] = useState<Record<string, MatrixRow[]>>({});

  const grouped = useMemo(() => {
    const map = new Map<string, MatrixGroup>();

    for (const line of demandLines) {
      if (!line.cost_center_id) continue;
      const ccId = line.cost_center_id;
      if (!map.has(ccId)) {
        map.set(ccId, { ccId, ccName: line.cost_center_name ?? ccId, rows: [] });
      }
      const cc = map.get(ccId)!;
      let row = cc.rows.find(r => r.resourceId === (line.resource_id ?? '') && r.projectId === line.project_id);
      if (!row) {
        row = {
          resourceId: line.resource_id ?? '',
          resourceName: line.resource_name ?? line.resource_id ?? '—',
          projectId: line.project_id,
          projectName: line.project_name ?? line.project_id,
          lines: new Map(),
        };
        cc.rows.push(row);
      }
      row.lines.set(line.period_id, line);
    }
    return map;
  }, [demandLines]);

  // Merge local rows into grouped
  const mergedGroups = useMemo((): MatrixGroup[] => {
    const result: MatrixGroup[] = [];
    const allCcIds = new Set([...grouped.keys(), ...Object.keys(localRows)]);

    for (const ccId of allCcIds) {
      const base = grouped.get(ccId);
      const extras = localRows[ccId] ?? [];
      const ccName = base?.ccName ?? costCenters.find(c => c.id === ccId)?.name ?? ccId;
      const rows = [...(base?.rows ?? [])];

      for (const extra of extras) {
        const exists = rows.find(r => r.resourceId === extra.resourceId && r.projectId === extra.projectId);
        if (!exists) rows.push(extra);
      }

      if (rows.length > 0) {
        result.push({ ccId, ccName, rows });
      }
    }

    result.sort((a, b) => a.ccName.localeCompare(b.ccName));
    return result;
  }, [grouped, localRows, costCenters]);

  const handleExpandCC = useCallback(async (ccId: string) => {
    setExpandedCCs(prev => {
      const next = new Set(prev);
      if (next.has(ccId)) { next.delete(ccId); return next; }
      next.add(ccId);
      return next;
    });
    if (!ccResources[ccId]) {
      const resources = await lookupsApi.listResources(ccId);
      setCcResources(prev => ({ ...prev, [ccId]: resources }));
    }
  }, [ccResources]);

  const saveCell = useCallback(async (
    cellKey: string,
    existingLine: DemandLine | undefined,
    resourceId: string,
    projectId: string,
    period: Period,
    newValue: number,
  ) => {
    setSavingCells(prev => new Set(prev).add(cellKey));
    try {
      if (existingLine && newValue === 0) {
        await planningApi.deleteDemandLine(existingLine.id);
      } else if (existingLine) {
        await planningApi.updateDemandLine(existingLine.id, { fte_percent: newValue });
      } else if (newValue > 0) {
        await planningApi.createDemandLine({
          period_id: period.id,
          project_id: projectId,
          resource_id: resourceId,
          fte_percent: newValue,
          year: period.year,
          month: period.month,
        });
      }
      onReload();
    } finally {
      setSavingCells(prev => { const s = new Set(prev); s.delete(cellKey); return s; });
      setEditingCell(null);
    }
  }, [onReload]);

  const handleAddLine = useCallback(async (ccId: string) => {
    if (!addLineResource || !addLineProject) return;

    const groupRows = mergedGroups.find(g => g.ccId === ccId)?.rows ?? [];
    const exists = groupRows.find(r => r.resourceId === addLineResource && r.projectId === addLineProject);
    if (exists) {
      const rowKey = `${addLineResource}_${addLineProject}`;
      setHighlightRow(rowKey);
      setTimeout(() => setHighlightRow(null), 1500);
    } else {
      const res = ccResources[ccId]?.find(r => r.id === addLineResource);
      const proj = projects.find(p => p.id === addLineProject);
      const newRow: MatrixRow = {
        resourceId: addLineResource,
        resourceName: res?.display_name ?? addLineResource,
        projectId: addLineProject,
        projectName: proj?.name ?? addLineProject,
        lines: new Map(),
      };
      setLocalRows(prev => ({ ...prev, [ccId]: [...(prev[ccId] ?? []), newRow] }));
    }

    setAddLineCC(null);
    setAddLineResource('');
    setAddLineProject('');
  }, [addLineResource, addLineProject, mergedGroups, ccResources, projects]);

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th
              className={`${styles.th} ${styles.thSticky}`}
              style={{ minWidth: RESOURCE_COL_WIDTH, textAlign: 'left' }}
            >
              Cost Center / Resource
            </th>
            <th
              className={`${styles.th} ${styles.thProject}`}
              style={{ minWidth: PROJECT_COL_WIDTH, textAlign: 'left', left: RESOURCE_COL_WIDTH }}
            >
              Project
            </th>
            {periods.map(p => (
              <th
                key={p.id}
                className={styles.th}
                style={{ width: PERIOD_COL_WIDTH, minWidth: PERIOD_COL_WIDTH }}
              >
                {MONTH_SHORT[p.month - 1]} {p.year}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mergedGroups.map(group => {
            const isExpanded = expandedCCs.has(group.ccId);

            // Compute per-period sums for summary row
            const periodSums = periods.map(p => {
              let sum = 0;
              for (const row of group.rows) {
                const line = row.lines.get(p.id);
                if (line) sum += line.fte_percent;
              }
              return sum;
            });

            return (
              <React.Fragment key={group.ccId}>
                {/* Summary row */}
                <tr
                  className={styles.summaryRow}
                  onClick={() => handleExpandCC(group.ccId)}
                  style={{ cursor: 'pointer' }}
                >
                  <td
                    className={styles.summaryCell}
                    colSpan={1}
                    style={{ minWidth: RESOURCE_COL_WIDTH }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {isExpanded ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
                      {group.ccName}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
                      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
                      fontWeight: tokens.fontWeightSemibold,
                      position: 'sticky',
                      left: RESOURCE_COL_WIDTH,
                      backgroundColor: tokens.colorNeutralBackground3,
                      zIndex: 1,
                      minWidth: PROJECT_COL_WIDTH,
                    }}
                  />
                  {periodSums.map((sum, i) => (
                    <td
                      key={periods[i].id}
                      className={styles.summaryValueCell}
                      style={{
                        backgroundColor: getCellBg(sum),
                        color: getCellFg(sum),
                      }}
                    >
                      {sum > 0 ? `${sum}%` : '—'}
                    </td>
                  ))}
                </tr>

                {isExpanded && (
                  <>
                    {/* Sub-header */}
                    <tr className={styles.subHeaderRow}>
                      <td className={styles.subHeaderCell} style={{ minWidth: RESOURCE_COL_WIDTH }}>
                        Resource
                      </td>
                      <td className={styles.subHeaderProjectCell} style={{ minWidth: PROJECT_COL_WIDTH, left: RESOURCE_COL_WIDTH }}>
                        Project
                      </td>
                      {periods.map(p => (
                        <td
                          key={p.id}
                          style={{
                            width: PERIOD_COL_WIDTH,
                            borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
                          }}
                        />
                      ))}
                    </tr>

                    {/* Data rows */}
                    {group.rows.map(row => {
                      const rowKey = `${row.resourceId}_${row.projectId}`;
                      const isHighlighted = highlightRow === rowKey;
                      return (
                        <tr
                          key={rowKey}
                          className={styles.dataRow}
                          style={isHighlighted ? { backgroundColor: tokens.colorBrandBackground2 } : undefined}
                        >
                          <td className={styles.resourceCell} title={row.resourceName}>
                            {row.resourceName}
                          </td>
                          <td className={styles.projectCell} title={row.projectName}>
                            {row.projectName}
                          </td>
                          {periods.map(period => {
                            const cellKey = `${rowKey}-${period.id}`;
                            const existingLine = row.lines.get(period.id);
                            const isEditing = editingCell === cellKey;
                            const isSaving = savingCells.has(cellKey);

                            return (
                              <td key={period.id} className={styles.valueCell}>
                                <CellEditor
                                  cellKey={cellKey}
                                  existingLine={existingLine}
                                  isEditing={isEditing}
                                  isSaving={isSaving}
                                  canEdit={canEdit}
                                  onStartEdit={() => canEdit && setEditingCell(cellKey)}
                                  onCancel={() => setEditingCell(null)}
                                  onSave={(val) =>
                                    saveCell(cellKey, existingLine, row.resourceId, row.projectId, period, val)
                                  }
                                  styles={styles}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}

                    {/* Add line row */}
                    {canEdit && (
                      <tr className={styles.addLineRow}>
                        <td
                          className={styles.addLineCell}
                          colSpan={2 + periods.length}
                          style={{ position: 'sticky', left: 0 }}
                        >
                          {addLineCC === group.ccId ? (
                            <div className={styles.addLineForm}>
                              <Select
                                value={addLineResource}
                                onChange={(_, d) => setAddLineResource(d.value)}
                                style={{ minWidth: 180 }}
                              >
                                <option value="">Resource…</option>
                                {(ccResources[group.ccId] ?? []).map(r => (
                                  <option key={r.id} value={r.id}>{r.display_name}</option>
                                ))}
                              </Select>
                              <Select
                                value={addLineProject}
                                onChange={(_, d) => setAddLineProject(d.value)}
                                style={{ minWidth: 180 }}
                              >
                                <option value="">Project…</option>
                                {projects.map(p => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </Select>
                              <Button
                                size="small"
                                appearance="primary"
                                onClick={() => handleAddLine(group.ccId)}
                                disabled={!addLineResource || !addLineProject}
                              >
                                Add
                              </Button>
                              <Button
                                size="small"
                                appearance="subtle"
                                onClick={() => {
                                  setAddLineCC(null);
                                  setAddLineResource('');
                                  setAddLineProject('');
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="small"
                              appearance="subtle"
                              icon={<Add24Regular />}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setAddLineCC(group.ccId);
                                setAddLineResource('');
                                setAddLineProject('');
                                // Ensure resources are loaded
                                if (!ccResources[group.ccId]) {
                                  const resources = await lookupsApi.listResources(group.ccId);
                                  setCcResources(prev => ({ ...prev, [group.ccId]: resources }));
                                }
                              }}
                            >
                              Add line
                            </Button>
                          )}
                        </td>
                      </tr>
                    )}

                  </>
                )}
              </React.Fragment>
            );
          })}

          {mergedGroups.length === 0 && (
            <tr>
              <td
                colSpan={2 + periods.length}
                style={{
                  padding: tokens.spacingVerticalXXL,
                  textAlign: 'center',
                  color: tokens.colorNeutralForeground3,
                }}
              >
                No demand lines for the selected filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

interface CellEditorProps {
  cellKey: string;
  existingLine: DemandLine | undefined;
  isEditing: boolean;
  isSaving: boolean;
  canEdit: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (value: number) => void;
  styles: ReturnType<typeof useStyles>;
}

const CellEditor: React.FC<CellEditorProps> = ({
  existingLine,
  isEditing,
  isSaving,
  canEdit,
  onStartEdit,
  onCancel,
  onSave,
  styles,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputVal, setInputVal] = useState('');

  const handleStartEdit = () => {
    setInputVal(existingLine ? String(existingLine.fte_percent) : '');
    onStartEdit();
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    const num = inputVal === '' ? 0 : parseInt(inputVal, 10);
    if (isNaN(num)) { onCancel(); return; }
    onSave(num);
  };

  if (isSaving) {
    return <Spinner size="extra-tiny" />;
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={0}
        max={200}
        step={5}
        value={inputVal}
        className={styles.cellInput}
        onChange={e => setInputVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={commit}
        autoFocus
      />
    );
  }

  if (existingLine) {
    const fte = existingLine.fte_percent;
    return (
      <span
        className={styles.cellValue}
        style={{ backgroundColor: getCellBg(fte), color: getCellFg(fte) }}
        onClick={handleStartEdit}
        title={canEdit ? 'Click to edit' : undefined}
      >
        {fte}%
      </span>
    );
  }

  return (
    <span
      className={styles.emptyCell}
      onClick={handleStartEdit}
      title={canEdit ? 'Click to add' : undefined}
    >
      —
    </span>
  );
};

export default DemandMatrix;
