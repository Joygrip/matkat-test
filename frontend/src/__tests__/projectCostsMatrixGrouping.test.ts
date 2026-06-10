import { describe, it, expect } from 'vitest';
import { buildProjectLines, periodTotal } from '../components/project-costs/buildMatrixLines';

const PROJ = 'proj-1';
const P_JAN = 'period-jan';
const P_FEB = 'period-feb';
const OPEN = new Set([P_JAN, P_FEB]);

// ── Helpers ────────────────────────────────────────────────────────────────────

function oop(id: string, desc: string, period: string, cost: number) {
  return { id, project_id: PROJ, period_id: period, description: desc, cost };
}

function equip(id: string, desc: string, period: string, cost: number) {
  return { id, project_id: PROJ, period_id: period, description: desc, cost };
}

// ── Normal case: different descriptions, different periods ─────────────────────

describe('normal OoP rows (no duplicates)', () => {
  it('creates one MatrixLine per description', () => {
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Travel', P_JAN, 30000),
      oop('r2', 'Hotels', P_JAN, 50000),
    ], [], [], OPEN);
    const oopLines = lines.filter(l => l.type === 'oop');
    expect(oopLines).toHaveLength(2);
  });

  it('merges same-description different-period rows into one MatrixLine', () => {
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Travel', P_JAN, 10000),
      oop('r2', 'Travel', P_FEB, 20000),
    ], [], [], OPEN);
    const oopLines = lines.filter(l => l.type === 'oop');
    expect(oopLines).toHaveLength(1);
    expect(oopLines[0].costsByPeriod.size).toBe(2);
    expect(oopLines[0].costsByPeriod.get(P_JAN)?.cost).toBe(10000);
    expect(oopLines[0].costsByPeriod.get(P_FEB)?.cost).toBe(20000);
  });
});

// ── Duplicate rows: same description + same period ────────────────────────────

describe('duplicate OoP rows (same description + same period)', () => {
  it('produces two separate MatrixLines, not one aggregated cell', () => {
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Paste Characterisation', P_JAN, 30000),
      oop('r2', 'Paste Characterisation', P_JAN, 30000),
    ], [], [], OPEN);
    const oopLines = lines.filter(l => l.type === 'oop');
    expect(oopLines).toHaveLength(2);
  });

  it('primary line keeps first row; overflow line is keyed by backend id', () => {
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Paste Characterisation', P_JAN, 30000),
      oop('r2', 'Paste Characterisation', P_JAN, 30000),
    ], [], [], OPEN);
    const oopLines = lines.filter(l => l.type === 'oop');
    const primary = oopLines.find(l => l.lineKey === 'oop::Paste%20Characterisation');
    const overflow = oopLines.find(l => l.lineKey === 'oop:r2');
    expect(primary).toBeDefined();
    expect(overflow).toBeDefined();
    expect(primary!.costsByPeriod.get(P_JAN)?.id).toBe('r1');
    expect(overflow!.costsByPeriod.get(P_JAN)?.id).toBe('r2');
  });

  it('both duplicate rows have independent costs (not summed)', () => {
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Paste Characterisation', P_JAN, 30000),
      oop('r2', 'Paste Characterisation', P_JAN, 30000),
    ], [], [], OPEN);
    const oopLines = lines.filter(l => l.type === 'oop');
    const costs = oopLines.map(l => l.costsByPeriod.get(P_JAN)?.cost);
    expect(costs).toContain(30000);
    expect(costs).toContain(30000);
    // Both are 30000, NOT 60000
    expect(costs.every(c => c === 30000)).toBe(true);
  });

  it('all lineKeys are unique (stable React keys)', () => {
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Paste Characterisation', P_JAN, 30000),
      oop('r2', 'Paste Characterisation', P_JAN, 30000),
      oop('r3', 'Paste Characterisation', P_JAN, 30000),
    ], [], [], OPEN);
    const keys = lines.filter(l => l.type === 'oop').map(l => l.lineKey);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});

// ── Equipment duplicates ───────────────────────────────────────────────────────

describe('duplicate Equipment rows', () => {
  it('produces two separate MatrixLines for same description + period', () => {
    const lines = buildProjectLines(PROJ, [], [
      equip('e1', 'Server', P_JAN, 50000),
      equip('e2', 'Server', P_JAN, 50000),
    ], [], OPEN);
    const equipLines = lines.filter(l => l.type === 'equip');
    expect(equipLines).toHaveLength(2);
    expect(equipLines.find(l => l.lineKey === 'equip:e2')).toBeDefined();
  });
});

// ── Project totals include all duplicate rows ─────────────────────────────────

describe('period totals with duplicates', () => {
  it('sums both duplicate OoP rows', () => {
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Paste Characterisation', P_JAN, 30000),
      oop('r2', 'Paste Characterisation', P_JAN, 30000),
    ], [], [], OPEN);
    expect(periodTotal(lines, P_JAN)).toBe(60000);
  });

  it('period total drops after one duplicate is removed', () => {
    // Simulate deleting r2: rebuild with only r1
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Paste Characterisation', P_JAN, 30000),
    ], [], [], OPEN);
    expect(periodTotal(lines, P_JAN)).toBe(30000);
  });

  it('mixed OoP and Equipment totals are summed with correct sign', () => {
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Travel', P_JAN, 10000),
      oop('r2', 'Credit', P_JAN, -2500),
    ], [
      equip('e1', 'Server', P_JAN, 6000),
      equip('e2', 'Correction', P_JAN, -1000),
    ], [], OPEN);
    expect(periodTotal(lines, P_JAN)).toBe(10000 - 2500 + 6000 - 1000);
  });
});

// ── Negative values ────────────────────────────────────────────────────────────

describe('negative OoP / Equipment values', () => {
  it('negative OoP cost is stored as-is (not abs or zeroed)', () => {
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Credit note', P_JAN, -5000),
    ], [], [], OPEN);
    expect(lines[0].costsByPeriod.get(P_JAN)?.cost).toBe(-5000);
  });

  it('negative Equipment cost is stored as-is', () => {
    const lines = buildProjectLines(PROJ, [], [
      equip('e1', 'Correction', P_JAN, -7500),
    ], [], OPEN);
    expect(lines[0].costsByPeriod.get(P_JAN)?.cost).toBe(-7500);
  });
});

// ── Rows outside open periods are excluded ────────────────────────────────────

describe('period filtering', () => {
  it('excludes rows for closed periods', () => {
    const OPEN_ONLY = new Set([P_JAN]); // P_FEB is closed
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Travel', P_JAN, 10000),
      oop('r2', 'Travel', P_FEB, 20000),
    ], [], [], OPEN_ONLY);
    const oopLines = lines.filter(l => l.type === 'oop');
    expect(oopLines).toHaveLength(1);
    expect(oopLines[0].costsByPeriod.has(P_FEB)).toBe(false);
  });
});

// ── Local (unsaved) lines ─────────────────────────────────────────────────────

describe('local lines', () => {
  it('adds local line when no backend row exists for that description', () => {
    const lines = buildProjectLines(PROJ, [], [], [
      { projectId: PROJ, type: 'oop', description: 'New item' },
    ], OPEN);
    expect(lines.find(l => l.isLocal && l.description === 'New item')).toBeDefined();
  });

  it('does not add local line if backend row already exists for that description', () => {
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Travel', P_JAN, 10000),
    ], [], [
      { projectId: PROJ, type: 'oop', description: 'Travel' },
    ], OPEN);
    const travelLines = lines.filter(l => l.description === 'Travel');
    // only the backend line, no duplicate local
    expect(travelLines.every(l => !l.isLocal)).toBe(true);
  });
});

// ── Sorting ───────────────────────────────────────────────────────────────────

describe('line sort order', () => {
  it('OoP lines appear before Equipment lines', () => {
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Travel', P_JAN, 100),
    ], [
      equip('e1', 'Server', P_JAN, 200),
    ], [], OPEN);
    expect(lines[0].type).toBe('oop');
    expect(lines[1].type).toBe('equip');
  });
});

// ── Rename isolation: each visible MatrixLine owns only its own backend row IDs ─
//
// handleRenameSubmit (post-fix) finds line by lineKey, then iterates
// line.costsByPeriod to get the cell IDs to update.  These tests verify that
// the costsByPeriod of each MatrixLine contains ONLY the backend row IDs that
// belong to that visible line — so a rename on the overflow row never touches
// the primary row's backend rows, and vice versa.

function cellIds(lines: ReturnType<typeof buildProjectLines>, lineKey: string): string[] {
  const line = lines.find(l => l.lineKey === lineKey);
  if (!line) return [];
  return [...line.costsByPeriod.values()].map(c => c.id);
}

describe('rename isolation — OoP', () => {
  it('renaming overflow row (oop:r2) only touches backend row r2', () => {
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Paste Characterisation', P_JAN, 30000),
      oop('r2', 'Paste Characterisation', P_JAN, 30000),
    ], [], [], OPEN);
    const ids = cellIds(lines, 'oop:r2');
    expect(ids).toEqual(['r2']);
    expect(ids).not.toContain('r1');
  });

  it('renaming primary row (oop::<desc>) only touches backend rows in that line', () => {
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Paste Characterisation', P_JAN, 30000),
      oop('r2', 'Paste Characterisation', P_JAN, 30000),
    ], [], [], OPEN);
    const ids = cellIds(lines, 'oop::Paste%20Characterisation');
    expect(ids).toEqual(['r1']);
    expect(ids).not.toContain('r2');
  });

  it('primary and overflow cell IDs are disjoint (no cross-contamination)', () => {
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Paste Characterisation', P_JAN, 30000),
      oop('r2', 'Paste Characterisation', P_JAN, 30000),
    ], [], [], OPEN);
    const primaryIds = new Set(cellIds(lines, 'oop::Paste%20Characterisation'));
    const overflowIds = new Set(cellIds(lines, 'oop:r2'));
    const intersection = [...primaryIds].filter(id => overflowIds.has(id));
    expect(intersection).toHaveLength(0);
  });

  it('primary with multi-period cells: rename only touches its own period cells', () => {
    // r1=Jan, r3=Feb on primary; r2=Jan on overflow
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Travel', P_JAN, 10000),
      oop('r2', 'Travel', P_JAN, 10000), // duplicate → overflow
      oop('r3', 'Travel', P_FEB, 20000), // different period → goes to primary
    ], [], [], OPEN);
    const primaryIds = cellIds(lines, 'oop::Travel');
    const overflowIds = cellIds(lines, 'oop:r2');
    expect(primaryIds).toContain('r1');
    expect(primaryIds).toContain('r3');
    expect(primaryIds).not.toContain('r2');
    expect(overflowIds).toEqual(['r2']);
  });
});

describe('rename isolation — Equipment', () => {
  it('renaming overflow Equipment row only touches that backend row', () => {
    const lines = buildProjectLines(PROJ, [], [
      equip('e1', 'Server', P_JAN, 50000),
      equip('e2', 'Server', P_JAN, 50000),
    ], [], OPEN);
    const ids = cellIds(lines, 'equip:e2');
    expect(ids).toEqual(['e2']);
    expect(ids).not.toContain('e1');
  });

  it('renaming primary Equipment row does not touch overflow row', () => {
    const lines = buildProjectLines(PROJ, [], [
      equip('e1', 'Server', P_JAN, 50000),
      equip('e2', 'Server', P_JAN, 50000),
    ], [], OPEN);
    const ids = cellIds(lines, 'equip::Server');
    expect(ids).toEqual(['e1']);
    expect(ids).not.toContain('e2');
  });
});

// ── Delete isolation ───────────────────────────────────────────────────────────
//
// handleDeleteLine finds line by lineKey, iterates costsByPeriod, calls
// deleteExternal/deleteEquipment for each cell.id.  These tests verify that
// a delete on an overflow line only presents one ID for deletion, and that a
// delete on a primary line presents only that line's IDs.

describe('delete isolation — OoP', () => {
  it('deleting overflow row presents only that row id for deletion', () => {
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Paste Characterisation', P_JAN, 30000),
      oop('r2', 'Paste Characterisation', P_JAN, 30000),
    ], [], [], OPEN);
    const ids = cellIds(lines, 'oop:r2');
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe('r2');
  });

  it('deleting primary row does not include overflow row id', () => {
    const lines = buildProjectLines(PROJ, [
      oop('r1', 'Paste Characterisation', P_JAN, 30000),
      oop('r2', 'Paste Characterisation', P_JAN, 30000),
    ], [], [], OPEN);
    const ids = cellIds(lines, 'oop::Paste%20Characterisation');
    expect(ids).not.toContain('r2');
  });

  it('total drops by exactly the deleted row cost after simulated delete', () => {
    // Before: two rows at 300.000 each
    const before = buildProjectLines(PROJ, [
      oop('r1', 'Paste Characterisation', P_JAN, 30000),
      oop('r2', 'Paste Characterisation', P_JAN, 30000),
    ], [], [], OPEN);
    expect(periodTotal(before, P_JAN)).toBe(60000);

    // After deleting r2 (overflow row): rebuild without r2
    const after = buildProjectLines(PROJ, [
      oop('r1', 'Paste Characterisation', P_JAN, 30000),
    ], [], [], OPEN);
    expect(periodTotal(after, P_JAN)).toBe(30000);
  });
});

describe('delete isolation — Equipment', () => {
  it('deleting overflow Equipment row presents only that row id', () => {
    const lines = buildProjectLines(PROJ, [], [
      equip('e1', 'Server', P_JAN, 50000),
      equip('e2', 'Server', P_JAN, 50000),
    ], [], OPEN);
    const ids = cellIds(lines, 'equip:e2');
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe('e2');
  });

  it('deleting primary Equipment row does not include overflow row id', () => {
    const lines = buildProjectLines(PROJ, [], [
      equip('e1', 'Server', P_JAN, 50000),
      equip('e2', 'Server', P_JAN, 50000),
    ], [], OPEN);
    const ids = cellIds(lines, 'equip::Server');
    expect(ids).not.toContain('e2');
  });
});
