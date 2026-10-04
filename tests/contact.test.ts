import { describe, expect, it } from 'vitest';

import { type Line, line, sideOf, vec } from '../src/geometry';
import { type PaperState, bottomLayers, createPaper, fold } from '../src/paper';
import { type ContactMemory, type Vec3, hinges, stepPose } from '../src/rigid';
import { solveSheet } from '../src/solve';

/** The right half folded over the left, then the bottom layer's left quarter tucked in between. */
const tuck = (): { before: PaperState; after: PaperState; movedIds: Set<number> } => {
  const half: Line = line(vec(0.5, 0), vec(0.5, 1));
  const before = fold(createPaper(), half, sideOf(half, vec(1, 0.5))).state;
  const quarter: Line = line(vec(0.25, 0), vec(0.25, 1));
  const result = fold(before, quarter, sideOf(quarter, vec(0, 0.5)), {
    layers: bottomLayers(1),
    placement: 'inside',
  });
  return { before, after: result.state, movedIds: new Set(result.movedIds) };
};

/** Height of the solved top layer at the far left edge, and of the moving flap's far corner. */
const heights = (contact?: ContactMemory): { top: number; flap: number } => {
  const { before, after, movedIds } = tuck();
  const all = hinges(after);
  let solved = solveSheet(after, all, { ...stepPose(after, 0), iterations: 40 });
  for (const progress of [0.05, 0.1, 0.2, 0.3, 0.4, 0.5]) {
    const animation = { previous: before, movedIds, progress, ...(contact ? { contact } : {}) };
    solved = solveSheet(after, all, { ...stepPose(after, 0, animation), iterations: 40 });
  }
  const moving = solved.panels.filter((p) => movedIds.has(p.facet.id));
  const stillTop = solved.panels
    .filter((p) => !movedIds.has(p.facet.id))
    .sort((a, b) => b.facet.z - a.facet.z)[0];
  if (!stillTop || moving.length === 0) throw new Error('panels missing');
  const leftmost = (points: readonly Vec3[]): Vec3 =>
    [...points].sort((a, b) => a.x - b.x)[0] as Vec3;
  const flapTip = moving.flatMap((p) => p.points).sort((a, b) => b.z - a.z)[0] as Vec3;
  return { top: leftmost(stillTop.points).z, flap: flapTip.z };
};

describe('contact while a step plays', () => {
  it('lets a flap pass through the layer above it without contact', () => {
    const { top, flap } = heights();
    expect(top).toBeLessThan(0.02);
    expect(flap).toBeGreaterThan(0.1);
  });

  it('holds the flap under the layer it set off beneath', () => {
    const memory: ContactMemory = { before: tuck().before, sides: new Map(), seeded: false };
    const { top, flap } = heights(memory);
    expect(memory.seeded).toBe(true);
    expect(memory.sides.size).toBeGreaterThan(0);
    // The layer above is the anchor here, so it cannot lift; the flap is held beneath it.
    expect(flap).toBeLessThanOrEqual(top + 0.02);
    expect(flap).toBeLessThan(0.05);
  });
});
