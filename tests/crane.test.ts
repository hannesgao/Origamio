import { describe, expect, it } from 'vitest';

import { type Vec, apply, approxEqualVec, bounds, sideOf, vec } from '../src/geometry';
import { FoldHistory, createPaper, facetCount, foldedPoints, maxLayers } from '../src/paper';
import { PRESETS } from '../src/presets';

const crane = PRESETS.find((p) => p.id === 'crane');
const CORNERS = { A: vec(0, 0), B: vec(1, 0), C: vec(1, 1), D: vec(0, 1) };

/** Folded position of a sheet corner, in (u, v) along and across the centre line. */
const cornerUv = (history: FoldHistory, corner: Vec): [number, number] => {
  const facet = history.state.facets.find((f) => f.poly.some((p) => approxEqualVec(p, corner)));
  if (!facet) throw new Error('corner lost');
  const p = apply(facet.transform, corner);
  return [(p.x + p.y) / Math.SQRT2, (p.y - p.x) / Math.SQRT2];
};

const runCrane = (): FoldHistory => {
  const history = new FoldHistory(createPaper());
  for (const { line: l, movingPoint, ...options } of crane?.steps ?? []) {
    const result = history.fold(l, sideOf(l, movingPoint), options);
    expect(result).not.toBeNull();
  }
  return history;
};

describe('crane preset', () => {
  it('reaches the bird base after the two petal folds', () => {
    const history = new FoldHistory(createPaper());
    for (const { line: l, movingPoint, ...options } of crane?.steps.slice(0, 12) ?? []) {
      history.fold(l, sideOf(l, movingPoint), options);
    }
    // Both petal tips (corners A and D) point up the centre line, one sheet
    // length from the bottom; the other two corners stay at the bottom.
    const [uA] = cornerUv(history, CORNERS.A);
    const [uD] = cornerUv(history, CORNERS.D);
    const [uB] = cornerUv(history, CORNERS.B);
    expect(uA).toBeCloseTo(1);
    expect(uD).toBeCloseTo(1);
    expect(uB).toBeCloseTo(0);
    const box = bounds(foldedPoints(history.state));
    expect(box.maxX).toBeCloseTo(Math.SQRT1_2);
  });

  it('moves paper at every step and ends as a flat crane', () => {
    const history = runCrane();
    expect(history.state.foldCount).toBe(crane?.steps.length);
    // Neck (D) and tail (A) rise above the body, the head bends forward and
    // down from the neck, both wing tips (B, C) hang below the spine.
    const [uD, vD] = cornerUv(history, CORNERS.D);
    const [uA, vA] = cornerUv(history, CORNERS.A);
    const [uB, vB] = cornerUv(history, CORNERS.B);
    const [uC, vC] = cornerUv(history, CORNERS.C);
    expect(vD).toBeGreaterThan(0.15);
    expect(vA).toBeGreaterThan(0.3);
    expect(uD).toBeGreaterThan(uA);
    expect(vB).toBeLessThan(-0.4);
    expect(uB).toBeCloseTo(uC);
    expect(vB).toBeCloseTo(vC);
    expect(facetCount(history.state)).toBeGreaterThan(50);
  });

  it('counts the layers of the finished crane quickly', () => {
    const history = runCrane();
    const start = performance.now();
    const layers = maxLayers(history.state);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(layers).toBeGreaterThan(20);
  });
});
