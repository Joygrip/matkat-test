// Pure grouping logic for ProjectCostsMatrix, extracted so it can be unit-tested
// without rendering the full component.

export interface PeriodCell {
  id: string;
  cost: number;
}

export interface MatrixLine {
  lineKey: string;
  description: string;
  type: 'oop' | 'equip';
  isLocal: boolean;
  costsByPeriod: Map<string, PeriodCell>;
}

export interface RawCostRow {
  id: string;
  project_id: string;
  period_id: string;
  description: string | null;
  cost: number;
}

export interface LocalLine {
  projectId: string;
  type: 'oop' | 'equip';
  description: string;
}

/**
 * Build the flat list of MatrixLines for one project.
 *
 * Each unique (description) → one primary MatrixLine (key = oop::<desc> or equip::<desc>).
 * When two backend rows share the same description AND the same period_id a
 * "duplicate" would arise — instead of aggregating them into a hidden "multi" cell,
 * we create a separate overflow MatrixLine keyed by backend row id (oop:<id>).
 * This keeps every row independently editable/deletable.
 */
export function buildProjectLines(
  projId: string,
  extLines: RawCostRow[],
  equipLines: RawCostRow[],
  localLines: LocalLine[],
  openPeriodIds: Set<string>,
): MatrixLine[] {
  const lines: MatrixLine[] = [];

  const oopPrimaryByDesc = new Map<string, MatrixLine>();
  for (const l of extLines) {
    if (l.project_id !== projId || !openPeriodIds.has(l.period_id)) continue;
    const desc = l.description ?? '—';
    const primaryKey = `oop::${encodeURIComponent(desc)}`;
    let primary = oopPrimaryByDesc.get(desc);
    if (!primary) {
      primary = { lineKey: primaryKey, description: desc, type: 'oop', isLocal: false, costsByPeriod: new Map() };
      oopPrimaryByDesc.set(desc, primary);
      lines.push(primary);
    }
    if (!primary.costsByPeriod.has(l.period_id)) {
      primary.costsByPeriod.set(l.period_id, { id: l.id, cost: l.cost });
    } else {
      lines.push({
        lineKey: `oop:${l.id}`,
        description: desc,
        type: 'oop',
        isLocal: false,
        costsByPeriod: new Map([[l.period_id, { id: l.id, cost: l.cost }]]),
      });
    }
  }

  const equipPrimaryByDesc = new Map<string, MatrixLine>();
  for (const l of equipLines) {
    if (l.project_id !== projId || !openPeriodIds.has(l.period_id)) continue;
    const desc = l.description ?? '—';
    const primaryKey = `equip::${encodeURIComponent(desc)}`;
    let primary = equipPrimaryByDesc.get(desc);
    if (!primary) {
      primary = { lineKey: primaryKey, description: desc, type: 'equip', isLocal: false, costsByPeriod: new Map() };
      equipPrimaryByDesc.set(desc, primary);
      lines.push(primary);
    }
    if (!primary.costsByPeriod.has(l.period_id)) {
      primary.costsByPeriod.set(l.period_id, { id: l.id, cost: l.cost });
    } else {
      lines.push({
        lineKey: `equip:${l.id}`,
        description: desc,
        type: 'equip',
        isLocal: false,
        costsByPeriod: new Map([[l.period_id, { id: l.id, cost: l.cost }]]),
      });
    }
  }

  for (const local of localLines) {
    if (local.projectId !== projId) continue;
    const lk = `${local.type}::${encodeURIComponent(local.description)}`;
    if (!lines.find(l => l.lineKey === lk)) {
      lines.push({ lineKey: lk, description: local.description, type: local.type, isLocal: true, costsByPeriod: new Map() });
    }
  }

  lines.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'oop' ? -1 : 1;
    return a.description.localeCompare(b.description);
  });

  return lines;
}

/** Sum all MatrixLine costs for a given period. */
export function periodTotal(lines: MatrixLine[], periodId: string): number {
  return lines.reduce((s, l) => s + (l.costsByPeriod.get(periodId)?.cost ?? 0), 0);
}
