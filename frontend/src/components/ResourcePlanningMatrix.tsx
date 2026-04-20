import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  Button,
  Spinner,
  tokens,
  makeStyles,
  Select,
} from '@fluentui/react-components';
import { Add24Regular, ChevronRight20Regular, ChevronDown20Regular } from '@fluentui/react-icons';
import { planningApi, DemandLine, SupplyLine } from '../api/planning';
import { lookupsApi, Project, CostCenter, Resource, Placeholder } from '../api/lookups';
import { Period } from '../types/index';

const RESOURCE_COL_WIDTH = 180;
const PROJECT_COL_WIDTH = 150;
const TYPE_COL_WIDTH = 70;
const PERIOD_COL_WIDTH = 88;
const RESOURCE_COL_PX = `${RESOURCE_COL_WIDTH}px`;
const PROJECT_COL_PX = `${PROJECT_COL_WIDTH}px`;
const TYPE_COL_PX = `${TYPE_COL_WIDTH}px`;
const PERIOD_COL_PX = `${PERIOD_COL_WIDTH}px`;
const TYPE_LEFT = RESOURCE_COL_WIDTH + PROJECT_COL_WIDTH;
const TYPE_LEFT_PX = `${TYPE_LEFT}px`;

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const ORANGE_BG = '#ffe8cc';
const ORANGE_FG = '#a83200';

function getDemandColor(dVal: number, sVal: number): { background: string; color: string } | undefined {
  if (dVal === 0) return undefined;
  const diff = sVal - dVal;
  if (diff < 0) return { background: tokens.colorPaletteRedBackground2, color: tokens.colorPaletteRedForeground2 };
  if (diff === 0) return { background: tokens.colorPaletteMarigoldBackground2, color: tokens.colorPaletteMarigoldForeground2 };
  return undefined;
}

function getSupplyColor(dVal: number, sVal: number): { background: string; color: string } | undefined {
  if (sVal === 0) return undefined;
  const diff = sVal - dVal;
  if (diff > 0) return { background: tokens.colorPaletteGreenBackground2, color: tokens.colorPaletteGreenForeground2 };
  if (diff === 0) return { background: tokens.colorPaletteMarigoldBackground2, color: tokens.colorPaletteMarigoldForeground2 };
  return { background: ORANGE_BG, color: ORANGE_FG };
}

const useStyles = makeStyles({
  wrapper: { overflowX: 'auto', width: '100%' },
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
  thResource: {
    position: 'sticky' as const,
    left: 0,
    zIndex: 4,
    textAlign: 'left' as const,
    minWidth: RESOURCE_COL_PX,
  },
  thProject: {
    position: 'sticky' as const,
    left: RESOURCE_COL_PX,
    zIndex: 4,
    textAlign: 'left' as const,
    minWidth: PROJECT_COL_PX,
  },
  thType: {
    position: 'sticky' as const,
    left: TYPE_LEFT_PX,
    zIndex: 4,
    textAlign: 'left' as const,
    minWidth: TYPE_COL_PX,
  },
  summaryRow: {
    backgroundColor: tokens.colorNeutralBackground3,
    cursor: 'pointer',
    ':hover': { filter: 'brightness(0.97)' },
  },
  summaryFixed: {
    fontWeight: tokens.fontWeightSemibold,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    whiteSpace: 'nowrap' as const,
    position: 'sticky' as const,
    left: 0,
    backgroundColor: tokens.colorNeutralBackground3,
    zIndex: 1,
    minWidth: RESOURCE_COL_PX,
  },
  summaryProject: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    position: 'sticky' as const,
    left: RESOURCE_COL_PX,
    backgroundColor: tokens.colorNeutralBackground3,
    zIndex: 1,
    minWidth: PROJECT_COL_PX,
  },
  summaryType: {
    padding: `2px ${tokens.spacingHorizontalXS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    position: 'sticky' as const,
    left: TYPE_LEFT_PX,
    backgroundColor: tokens.colorNeutralBackground3,
    zIndex: 1,
    minWidth: TYPE_COL_PX,
  },
  summaryValueCell: {
    padding: `2px ${tokens.spacingHorizontalXS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    textAlign: 'center' as const,
    width: PERIOD_COL_PX,
    minWidth: PERIOD_COL_PX,
    verticalAlign: 'middle' as const,
  },
  typeCellDemand: {
    backgroundColor: '#e8f0ff',
    color: '#1a3a7a',
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase100,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    position: 'sticky' as const,
    left: TYPE_LEFT_PX,
    zIndex: 1,
    whiteSpace: 'nowrap' as const,
    minWidth: TYPE_COL_PX,
  },
  typeCellSupply: {
    backgroundColor: '#e8f8ee',
    color: '#0a4a1a',
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase100,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    position: 'sticky' as const,
    left: TYPE_LEFT_PX,
    zIndex: 1,
    whiteSpace: 'nowrap' as const,
    minWidth: TYPE_COL_PX,
  },
  resourceCell: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    whiteSpace: 'nowrap' as const,
    position: 'sticky' as const,
    left: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: 1,
    minWidth: RESOURCE_COL_PX,
    maxWidth: RESOURCE_COL_PX,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    verticalAlign: 'middle' as const,
  },
  projectCell: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    whiteSpace: 'nowrap' as const,
    position: 'sticky' as const,
    left: RESOURCE_COL_PX,
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: 1,
    minWidth: PROJECT_COL_PX,
    maxWidth: PROJECT_COL_PX,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    verticalAlign: 'middle' as const,
  },
  valueCell: {
    padding: '2px 2px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    textAlign: 'center' as const,
    width: PERIOD_COL_PX,
    minWidth: PERIOD_COL_PX,
  },
  cellInput: {
    width: '64px',
    textAlign: 'center' as const,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    borderRadius: tokens.borderRadiusSmall,
    padding: '2px 2px',
    fontSize: tokens.fontSizeBase200,
    outline: 'none',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  cellValue: {
    display: 'inline-block',
    minWidth: '42px',
    padding: '2px 4px',
    borderRadius: tokens.borderRadiusSmall,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase200,
    textAlign: 'center' as const,
    ':hover': { filter: 'brightness(0.92)' },
  },
  emptyCell: {
    color: tokens.colorNeutralForeground4,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase200,
    display: 'inline-block',
    minWidth: '42px',
    padding: '2px 4px',
    borderRadius: tokens.borderRadiusSmall,
    ':hover': { backgroundColor: tokens.colorNeutralBackground3 },
  },
  emptyCellReadonly: {
    color: tokens.colorNeutralForeground4,
    fontSize: tokens.fontSizeBase200,
    display: 'inline-block',
    minWidth: '42px',
    padding: '2px 4px',
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

interface MergedMatrixRow {
  key: string;
  resourceId: string | null;
  resourceName: string;
  placeholderId: string | null;
  projectId: string | null;
  projectName: string;
  isGeneral: boolean;
  isPlaceholder: boolean;
  demandByPeriod: Map<string, DemandLine>;
  supplyByPeriod: Map<string, SupplyLine>;
}

interface ResourceGroup {
  resourceKey: string;
  resourceName: string;
  rows: MergedMatrixRow[];
}

interface MatrixGroup {
  ccId: string;
  ccName: string;
  resourceGroups: ResourceGroup[];
}

interface LocalRow {
  key: string;
  resourceId: string | null;
  resourceName: string;
  placeholderId: string | null;
  projectId: string | null;
  projectName: string;
  isGeneral: boolean;
  isPlaceholder: boolean;
}

export interface ResourcePlanningMatrixProps {
  demandLines: DemandLine[];
  supplyLines: SupplyLine[];
  periods: Period[];
  projects: Project[];
  costCenters: CostCenter[];
  canEditDemand: boolean;
  canEditSupply: boolean;
  onReload: () => void;
}

function parseResOrPh(val: string): { resourceId?: string; placeholderId?: string } {
  if (val.startsWith('r:')) return { resourceId: val.slice(2) };
  if (val.startsWith('ph:')) return { placeholderId: val.slice(3) };
  return {};
}

function buildResourceGroups(rows: MergedMatrixRow[]): ResourceGroup[] {
  const map = new Map<string, ResourceGroup>();
  for (const row of rows) {
    const rKey = row.resourceId ? `r:${row.resourceId}` : `ph:${row.placeholderId}`;
    if (!map.has(rKey)) {
      map.set(rKey, { resourceKey: rKey, resourceName: row.resourceName, rows: [] });
    }
    map.get(rKey)!.rows.push(row);
  }
  const result = Array.from(map.values());
  result.sort((a, b) => a.resourceName.localeCompare(b.resourceName));
  result.forEach(g => g.rows.sort((a, b) => a.projectName.localeCompare(b.projectName)));
  return result;
}

export const ResourcePlanningMatrix: React.FC<ResourcePlanningMatrixProps> = ({
  demandLines,
  supplyLines,
  periods,
  projects,
  costCenters,
  canEditDemand,
  canEditSupply,
  onReload,
}) => {
  const styles = useStyles();

  const [expandedCCs, setExpandedCCs] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [addDemandCC, setAddDemandCC] = useState<string | null>(null);
  const [addSupplyCC, setAddSupplyCC] = useState<string | null>(null);
  const [addDemandForm, setAddDemandForm] = useState({ resOrPh: '', projectId: '' });
  const [addSupplyForm, setAddSupplyForm] = useState({ resourceId: '', projectId: '' });
  const [ccResources, setCcResources] = useState<Record<string, Resource[]>>({});
  const [ccPlaceholders, setCcPlaceholders] = useState<Record<string, Placeholder[]>>({});
  const [localDemandRows, setLocalDemandRows] = useState<Record<string, LocalRow[]>>({});
  const [localSupplyRows, setLocalSupplyRows] = useState<Record<string, LocalRow[]>>({});

  const groups = useMemo((): MatrixGroup[] => {
    const groupMap = new Map<string, { ccName: string; rowMap: Map<string, MergedMatrixRow> }>();

    const getOrCreate = (ccId: string, ccName: string) => {
      if (!groupMap.has(ccId)) groupMap.set(ccId, { ccName, rowMap: new Map() });
      return groupMap.get(ccId)!;
    };

    for (const line of demandLines) {
      if (!line.cost_center_id) continue;
      const g = getOrCreate(line.cost_center_id, line.cost_center_name || line.cost_center_id);
      const key = line.resource_id
        ? `r:${line.resource_id}|p:${line.project_id}`
        : `ph:${line.placeholder_id}|p:${line.project_id}`;
      if (!g.rowMap.has(key)) {
        g.rowMap.set(key, {
          key,
          resourceId: line.resource_id || null,
          resourceName: line.resource_name || line.resource_id || '—',
          placeholderId: line.placeholder_id || null,
          projectId: line.project_id,
          projectName: line.project_name || line.project_id,
          isGeneral: false,
          isPlaceholder: !!line.placeholder_id,
          demandByPeriod: new Map(),
          supplyByPeriod: new Map(),
        });
      }
      g.rowMap.get(key)!.demandByPeriod.set(line.period_id, line);
    }

    for (const line of supplyLines) {
      if (!line.cost_center_id) continue;
      const g = getOrCreate(line.cost_center_id, line.cost_center_name || line.cost_center_id);
      const isGeneral = !line.project_id;
      const key = `r:${line.resource_id}|p:${line.project_id || ''}`;
      if (!g.rowMap.has(key)) {
        g.rowMap.set(key, {
          key,
          resourceId: line.resource_id,
          resourceName: line.resource_name || line.resource_id,
          placeholderId: null,
          projectId: line.project_id || null,
          projectName: isGeneral ? 'General' : (line.project_name || line.project_id || '—'),
          isGeneral,
          isPlaceholder: false,
          demandByPeriod: new Map(),
          supplyByPeriod: new Map(),
        });
      }
      g.rowMap.get(key)!.supplyByPeriod.set(line.period_id, line);
    }

    for (const [ccId, rows] of Object.entries(localDemandRows)) {
      const ccName = costCenters.find(c => c.id === ccId)?.name || ccId;
      const g = getOrCreate(ccId, ccName);
      for (const row of rows) {
        if (!g.rowMap.has(row.key)) {
          g.rowMap.set(row.key, { ...row, demandByPeriod: new Map(), supplyByPeriod: new Map() });
        }
      }
    }

    for (const [ccId, rows] of Object.entries(localSupplyRows)) {
      const ccName = costCenters.find(c => c.id === ccId)?.name || ccId;
      const g = getOrCreate(ccId, ccName);
      for (const row of rows) {
        if (!g.rowMap.has(row.key)) {
          g.rowMap.set(row.key, { ...row, demandByPeriod: new Map(), supplyByPeriod: new Map() });
        }
      }
    }

    const result: MatrixGroup[] = Array.from(groupMap.entries()).map(([ccId, { ccName, rowMap }]) => ({
      ccId,
      ccName,
      resourceGroups: buildResourceGroups(Array.from(rowMap.values())),
    }));
    result.sort((a, b) => a.ccName.localeCompare(b.ccName));
    return result;
  }, [demandLines, supplyLines, costCenters, localDemandRows, localSupplyRows]);

  const loadCcData = useCallback(async (ccId: string) => {
    const promises: Promise<void>[] = [];
    if (!ccResources[ccId]) {
      promises.push(
        lookupsApi.listResources(ccId).then(r => setCcResources(prev => ({ ...prev, [ccId]: r })))
      );
    }
    if (!ccPlaceholders[ccId]) {
      promises.push(
        lookupsApi.listPlaceholders(ccId).then(p => setCcPlaceholders(prev => ({ ...prev, [ccId]: p })))
      );
    }
    await Promise.all(promises);
  }, [ccResources, ccPlaceholders]);

  const handleExpandCC = useCallback(async (ccId: string) => {
    setExpandedCCs(prev => {
      const next = new Set(prev);
      if (next.has(ccId)) { next.delete(ccId); return next; }
      next.add(ccId);
      return next;
    });
    await loadCcData(ccId);
  }, [loadCcData]);

  const saveDemandCell = useCallback(async (
    cellKey: string,
    existingLine: DemandLine | undefined,
    row: MergedMatrixRow,
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
          project_id: row.projectId || '',
          resource_id: row.resourceId || undefined,
          placeholder_id: row.placeholderId || undefined,
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

  const saveSupplyCell = useCallback(async (
    cellKey: string,
    existingLine: SupplyLine | undefined,
    row: MergedMatrixRow,
    period: Period,
    newValue: number,
  ) => {
    setSavingCells(prev => new Set(prev).add(cellKey));
    try {
      if (existingLine && newValue === 0) {
        await planningApi.deleteSupplyLine(existingLine.id);
      } else if (existingLine) {
        await planningApi.updateSupplyLine(existingLine.id, { fte_percent: newValue });
      } else if (newValue > 0) {
        await planningApi.createSupplyLine({
          period_id: period.id,
          resource_id: row.resourceId || '',
          project_id: row.projectId || undefined,
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

  const handleAddDemandLine = useCallback(async (ccId: string, allRows: MergedMatrixRow[]) => {
    const { resOrPh, projectId } = addDemandForm;
    if (!resOrPh || !projectId) return;

    const parsed = parseResOrPh(resOrPh);
    const resourceId = parsed.resourceId || null;
    const placeholderId = parsed.placeholderId || null;
    let resourceName = '—';
    if (resourceId) {
      resourceName = ccResources[ccId]?.find(r => r.id === resourceId)?.display_name || resourceId;
    } else if (placeholderId) {
      resourceName = ccPlaceholders[ccId]?.find(p => p.id === placeholderId)?.name || placeholderId;
    }
    const projectName = projects.find(p => p.id === projectId)?.name || projectId;
    const key = resourceId ? `r:${resourceId}|p:${projectId}` : `ph:${placeholderId}|p:${projectId}`;

    if (!allRows.find(r => r.key === key)) {
      const newRow: LocalRow = {
        key, resourceId, resourceName, placeholderId,
        projectId, projectName, isGeneral: false, isPlaceholder: !!placeholderId,
      };
      setLocalDemandRows(prev => ({ ...prev, [ccId]: [...(prev[ccId] ?? []), newRow] }));
    }
    setAddDemandCC(null);
    setAddDemandForm({ resOrPh: '', projectId: '' });
  }, [addDemandForm, ccResources, ccPlaceholders, projects]);

  const handleAddSupplyLine = useCallback(async (ccId: string, allRows: MergedMatrixRow[]) => {
    const { resourceId, projectId } = addSupplyForm;
    if (!resourceId) return;

    const isGeneral = !projectId;
    const resourceName = ccResources[ccId]?.find(r => r.id === resourceId)?.display_name || resourceId;
    const projectName = isGeneral ? 'General' : (projects.find(p => p.id === projectId)?.name || projectId);
    const key = `r:${resourceId}|p:${projectId}`;

    if (!allRows.find(r => r.key === key)) {
      const newRow: LocalRow = {
        key, resourceId, resourceName, placeholderId: null,
        projectId: projectId || null, projectName, isGeneral, isPlaceholder: false,
      };
      setLocalSupplyRows(prev => ({ ...prev, [ccId]: [...(prev[ccId] ?? []), newRow] }));
    }
    setAddSupplyCC(null);
    setAddSupplyForm({ resourceId: '', projectId: '' });
  }, [addSupplyForm, ccResources, projects]);

  const totalCols = 3 + periods.length;

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={`${styles.th} ${styles.thResource}`} style={{ textAlign: 'left' }}>
              Resource
            </th>
            <th className={`${styles.th} ${styles.thProject}`} style={{ textAlign: 'left' }}>
              Project
            </th>
            <th className={`${styles.th} ${styles.thType}`} style={{ textAlign: 'left' }}>
              D / S
            </th>
            {periods.map(p => (
              <th
                key={p.id}
                className={styles.th}
                style={{ width: PERIOD_COL_PX, minWidth: PERIOD_COL_PX }}
              >
                {MONTH_SHORT[p.month - 1]} {p.year}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(group => {
            const isExpanded = expandedCCs.has(group.ccId);
            const allRows = group.resourceGroups.flatMap(rg => rg.rows);

            // Per-period totals for summary and total rows
            const periodTotals = periods.map(p => {
              let dSum = 0, sSum = 0;
              for (const row of allRows) {
                dSum += row.demandByPeriod.get(p.id)?.fte_percent ?? 0;
                sSum += row.supplyByPeriod.get(p.id)?.fte_percent ?? 0;
              }
              return { dSum, sSum };
            });

            return (
              <React.Fragment key={group.ccId}>
                {/* CC summary row (collapsed view) */}
                <tr
                  className={styles.summaryRow}
                  onClick={() => handleExpandCC(group.ccId)}
                >
                  <td className={styles.summaryFixed}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {isExpanded ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
                      {group.ccName}
                    </span>
                  </td>
                  <td className={styles.summaryProject} />
                  <td className={styles.summaryType} />
                  {periodTotals.map(({ dSum, sSum }, i) => (
                    <td key={periods[i].id} className={styles.summaryValueCell}>
                      <div style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        ...(getDemandColor(dSum, sSum) ?? { color: tokens.colorNeutralForeground3 }),
                      }}>
                        D: {dSum > 0 ? `${dSum}%` : '—'}
                      </div>
                      <div style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        ...(getSupplyColor(dSum, sSum) ?? { color: tokens.colorNeutralForeground3 }),
                      }}>
                        S: {sSum > 0 ? `${sSum}%` : '—'}
                      </div>
                    </td>
                  ))}
                </tr>

                {isExpanded && (
                  <>
                    {/* Resource groups → data rows (2 per MatrixRow: demand + supply) */}
                    {group.resourceGroups.map(rg => (
                      rg.rows.map((row, rowIdx) => {
                        const totalRowSpan = rg.rows.length * 2;
                        return (
                          <React.Fragment key={row.key}>
                            {/* Demand row */}
                            <tr>
                              {rowIdx === 0 && (
                                <td
                                  className={styles.resourceCell}
                                  rowSpan={totalRowSpan}
                                  title={row.resourceName}
                                  style={row.isPlaceholder ? { fontStyle: 'italic' } : undefined}
                                >
                                  {row.resourceName}
                                  {row.isPlaceholder && (
                                    <span style={{
                                      display: 'block',
                                      fontSize: tokens.fontSizeBase100,
                                      color: tokens.colorNeutralForeground3,
                                    }}>
                                      [TBD]
                                    </span>
                                  )}
                                </td>
                              )}
                              <td
                                className={styles.projectCell}
                                rowSpan={2}
                                title={row.projectName}
                                style={row.isGeneral ? { fontStyle: 'italic' } : undefined}
                              >
                                {row.projectName}
                                {row.isGeneral && ' *'}
                              </td>
                              <td className={styles.typeCellDemand}>Demand</td>
                              {periods.map(period => {
                                const dLine = row.demandByPeriod.get(period.id);
                                const sLine = row.supplyByPeriod.get(period.id);
                                const dVal = dLine?.fte_percent ?? 0;
                                const sVal = sLine?.fte_percent ?? 0;
                                const cellKey = `d-${row.key}-${period.id}`;
                                const canEdit = canEditDemand && !row.isGeneral;
                                return (
                                  <td key={period.id} className={styles.valueCell}>
                                    <CellEditor
                                      value={dVal}
                                      colorStyle={getDemandColor(dVal, sVal)}
                                      isEditing={editingCell === cellKey}
                                      isSaving={savingCells.has(cellKey)}
                                      canEdit={canEdit}
                                      onStartEdit={() => canEdit && setEditingCell(cellKey)}
                                      onCancel={() => setEditingCell(null)}
                                      onSave={val => saveDemandCell(cellKey, dLine, row, period, val)}
                                      styles={styles}
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                            {/* Supply row */}
                            <tr>
                              {/* resource and project cells spanned by rowSpan above */}
                              <td className={styles.typeCellSupply}>Supply</td>
                              {periods.map(period => {
                                const dLine = row.demandByPeriod.get(period.id);
                                const sLine = row.supplyByPeriod.get(period.id);
                                const dVal = dLine?.fte_percent ?? 0;
                                const sVal = sLine?.fte_percent ?? 0;
                                const cellKey = `s-${row.key}-${period.id}`;
                                const canEdit = canEditSupply && !row.isPlaceholder;
                                return (
                                  <td key={period.id} className={styles.valueCell}>
                                    <CellEditor
                                      value={sVal}
                                      colorStyle={getSupplyColor(dVal, sVal)}
                                      isEditing={editingCell === cellKey}
                                      isSaving={savingCells.has(cellKey)}
                                      canEdit={canEdit}
                                      onStartEdit={() => canEdit && setEditingCell(cellKey)}
                                      onCancel={() => setEditingCell(null)}
                                      onSave={val => saveSupplyCell(cellKey, sLine, row, period, val)}
                                      styles={styles}
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          </React.Fragment>
                        );
                      })
                    ))}

                    {/* Add demand line */}
                    {canEditDemand && (
                      <tr className={styles.addLineRow}>
                        <td
                          className={styles.addLineCell}
                          colSpan={totalCols}
                          style={{ position: 'sticky', left: 0 }}
                        >
                          {addDemandCC === group.ccId ? (
                            <div className={styles.addLineForm}>
                              <Select
                                value={addDemandForm.resOrPh}
                                onChange={(_, d) => setAddDemandForm(f => ({ ...f, resOrPh: d.value }))}
                                style={{ minWidth: 200 }}
                              >
                                <option value="">Resource / Placeholder…</option>
                                {(ccResources[group.ccId] ?? []).length > 0 && (
                                  <optgroup label="Resources">
                                    {(ccResources[group.ccId] ?? []).map(r => (
                                      <option key={`r:${r.id}`} value={`r:${r.id}`}>{r.display_name}</option>
                                    ))}
                                  </optgroup>
                                )}
                                {(ccPlaceholders[group.ccId] ?? []).length > 0 && (
                                  <optgroup label="Placeholders">
                                    {(ccPlaceholders[group.ccId] ?? []).map(ph => (
                                      <option key={`ph:${ph.id}`} value={`ph:${ph.id}`}>{ph.name}</option>
                                    ))}
                                  </optgroup>
                                )}
                              </Select>
                              <Select
                                value={addDemandForm.projectId}
                                onChange={(_, d) => setAddDemandForm(f => ({ ...f, projectId: d.value }))}
                                style={{ minWidth: 160 }}
                              >
                                <option value="">Project…</option>
                                {projects.map(p => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </Select>
                              <Button
                                size="small"
                                appearance="primary"
                                onClick={() => handleAddDemandLine(group.ccId, allRows)}
                                disabled={!addDemandForm.resOrPh || !addDemandForm.projectId}
                              >
                                Add
                              </Button>
                              <Button
                                size="small"
                                appearance="subtle"
                                onClick={() => { setAddDemandCC(null); setAddDemandForm({ resOrPh: '', projectId: '' }); }}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="small"
                              appearance="subtle"
                              icon={<Add24Regular />}
                              onClick={async e => {
                                e.stopPropagation();
                                setAddDemandCC(group.ccId);
                                setAddDemandForm({ resOrPh: '', projectId: '' });
                                await loadCcData(group.ccId);
                              }}
                            >
                              Add demand line
                            </Button>
                          )}
                        </td>
                      </tr>
                    )}

                    {/* Add supply line */}
                    {canEditSupply && (
                      <tr className={styles.addLineRow}>
                        <td
                          className={styles.addLineCell}
                          colSpan={totalCols}
                          style={{ position: 'sticky', left: 0 }}
                        >
                          {addSupplyCC === group.ccId ? (
                            <div className={styles.addLineForm}>
                              <Select
                                value={addSupplyForm.resourceId}
                                onChange={(_, d) => setAddSupplyForm(f => ({ ...f, resourceId: d.value }))}
                                style={{ minWidth: 200 }}
                              >
                                <option value="">Resource…</option>
                                {(ccResources[group.ccId] ?? []).map(r => (
                                  <option key={r.id} value={r.id}>{r.display_name}</option>
                                ))}
                              </Select>
                              <Select
                                value={addSupplyForm.projectId}
                                onChange={(_, d) => setAddSupplyForm(f => ({ ...f, projectId: d.value }))}
                                style={{ minWidth: 180 }}
                              >
                                <option value="">— General availability —</option>
                                {projects.map(p => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </Select>
                              <Button
                                size="small"
                                appearance="primary"
                                onClick={() => handleAddSupplyLine(group.ccId, allRows)}
                                disabled={!addSupplyForm.resourceId}
                              >
                                Add
                              </Button>
                              <Button
                                size="small"
                                appearance="subtle"
                                onClick={() => { setAddSupplyCC(null); setAddSupplyForm({ resourceId: '', projectId: '' }); }}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="small"
                              appearance="subtle"
                              icon={<Add24Regular />}
                              onClick={async e => {
                                e.stopPropagation();
                                setAddSupplyCC(group.ccId);
                                setAddSupplyForm({ resourceId: '', projectId: '' });
                                await loadCcData(group.ccId);
                              }}
                            >
                              Add supply line
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

          {groups.length === 0 && (
            <tr>
              <td
                colSpan={totalCols}
                style={{
                  padding: tokens.spacingVerticalXXL,
                  textAlign: 'center',
                  color: tokens.colorNeutralForeground3,
                }}
              >
                No planning lines for the selected filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

interface CellEditorProps {
  value: number;
  colorStyle?: { background: string; color: string };
  isEditing: boolean;
  isSaving: boolean;
  canEdit: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (value: number) => void;
  styles: ReturnType<typeof useStyles>;
}

const CellEditor: React.FC<CellEditorProps> = ({
  value,
  colorStyle,
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
    setInputVal(value > 0 ? String(value) : '');
    onStartEdit();
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    const num = inputVal === '' ? 0 : parseInt(inputVal, 10);
    if (isNaN(num)) { onCancel(); return; }
    onSave(num);
  };

  if (isSaving) return <Spinner size="extra-tiny" />;

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

  if (value > 0) {
    return (
      <span
        className={styles.cellValue}
        style={colorStyle ?? { backgroundColor: 'transparent' }}
        onClick={canEdit ? handleStartEdit : undefined}
        title={canEdit ? 'Click to edit' : undefined}
      >
        {value}%
      </span>
    );
  }

  if (canEdit) {
    return (
      <span className={styles.emptyCell} onClick={handleStartEdit} title="Click to add">
        —
      </span>
    );
  }

  return <span className={styles.emptyCellReadonly}>—</span>;
};

export default ResourcePlanningMatrix;
