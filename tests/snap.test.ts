import { describe, expect, it } from 'vitest';

import { approxEqualVec, perpendicularBisector, sideOf, vec } from '../src/geometry';
import { FoldHistory, createPaper } from '../src/paper';
import { snapTargets, snapTo } from '../src/snap';
import { foldLeftRight, run } from './presets';

const has = (points: readonly { point: { x: number; y: number } }[], p: { x: number; y: number }) =>
  points.some((t) => approxEqualVec(t.point, p));

describe('snap targets', () => {
  it('lists the corners and edge midpoints of a flat sheet once each', () => {
    const targets = snapTargets(createPaper());
    expect(targets.points.filter((t) => t.kind === 'vertex')).toHaveLength(4);
    expect(targets.points.filter((t) => t.kind === 'midpoint')).toHaveLength(4);
    expect(targets.edges).toHaveLength(4);
    expect(has(targets.points, vec(0.5, 0))).toBe(true);
    expect(has(targets.points, vec(1, 1))).toBe(true);
  });

  it('shares the corners of stacked layers', () => {
    const history = new FoldHistory(createPaper());
    run(history, [foldLeftRight()]);
    const targets = snapTargets(history.state);
    // Two layers on the left half: 4 corners, 4 midpoints of the outline, plus
    // the midpoint of the crease edge is the same as the outline midpoint.
    expect(targets.points.filter((t) => t.kind === 'vertex')).toHaveLength(4);
    expect(targets.points.filter((t) => t.kind === 'midpoint')).toHaveLength(4);
    expect(targets.edges).toHaveLength(4);
  });
});

describe('snapTo', () => {
  const targets = snapTargets(createPaper());

  it('prefers a corner over a midpoint and both over an edge', () => {
    expect(snapTo(targets, vec(0.02, 0.03), 0.1)).toEqual({ point: vec(0, 0), kind: 'vertex' });
    expect(snapTo(targets, vec(0.48, 0.03), 0.1)).toEqual({
      point: vec(0.5, 0),
      kind: 'midpoint',
    });
    const onEdge = snapTo(targets, vec(0.3, 0.02), 0.1);
    expect(onEdge?.kind).toBe('edge');
    expect(approxEqualVec(onEdge?.point ?? vec(9, 9), vec(0.3, 0))).toBe(true);
  });

  it('returns null when nothing is within the radius', () => {
    expect(snapTo(targets, vec(0.5, 0.5), 0.1)).toBeNull();
  });
});

describe('edge crossings', () => {
  it('lists where edges of different layers cross, once', () => {
    // Fold the bottom-left corner onto the middle of the top edge: the flap
    // sticks out past the left edge and its edges cross the sheet's outline.
    const history = new FoldHistory(createPaper());
    const a = vec(0, 0);
    const b = vec(0.5, 1);
    const bisector = perpendicularBisector(a, b);
    history.fold(bisector, sideOf(bisector, a));
    const targets = snapTargets(history.state);
    const crossings = targets.points.filter((t) => t.kind === 'intersection');
    // The flipped flap's far edge crosses the top edge of the sheet once.
    expect(crossings.length).toBeGreaterThanOrEqual(1);
    for (const c of crossings) {
      expect(
        targets.points.some((t) => t.kind === 'vertex' && approxEqualVec(t.point, c.point)),
      ).toBe(false);
    }
  });
});
