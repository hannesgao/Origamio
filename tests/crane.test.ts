import { describe, expect, it } from 'vitest';

import { type Vec, apply, approxEqualVec, bounds, vec } from '../src/geometry';
import { type PaperState, createPaper, facetCount, foldedPoints, maxLayers } from '../src/paper';
import { PRESETS, presetToSequence } from '../src/presets';
import { tears } from '../src/rigid';
import { type FoldStep, applyStep } from '../src/sequence';

const crane = PRESETS.find((p) => p.id === 'crane');
if (!crane) throw new Error('crane preset missing');
const steps = presetToSequence(crane).steps;
const CORNERS = { A: vec(0, 0), B: vec(1, 0), C: vec(1, 1), D: vec(0, 1) };

/** Folded position of a sheet corner, in (u, v) along and across the centre line. */
const cornerUv = (state: PaperState, corner: Vec): [number, number] => {
  const facet = state.facets.find((f) => f.poly.some((p) => approxEqualVec(p, corner)));
  if (!facet) throw new Error('corner lost');
  const p = apply(facet.transform, corner);
  return [(p.x + p.y) / Math.SQRT2, (p.y - p.x) / Math.SQRT2];
};

/** Apply the first `count` steps (all of them by default), checking each moves paper. */
const run = (count = steps.length): PaperState => {
  let state = createPaper();
  for (const step of steps.slice(0, count)) {
    const result = applyStep(state, step as FoldStep);
    // A pre-crease folds and unfolds, so its net movement is nil; every other step moves paper.
    if (step.label !== 'Pre-crease') expect(result.movedIds.length).toBeGreaterThan(0);
    state = result.state;
  }
  return state;
};

describe('crane preset', () => {
  it('is a sequence real paper can take: no step pulls neighbouring facets apart', () => {
    for (let count = 1; count <= steps.length; count++) {
      expect(tears(run(count)), `after step ${count}`).toBe(0);
    }
    const base = run(3);
    // All four corners meet at the open end of the square base.
    for (const corner of Object.values(CORNERS)) {
      const [u, v] = cornerUv(base, corner);
      expect(u).toBeCloseTo(0);
      expect(v).toBeCloseTo(0);
    }
    expect(maxLayers(base)).toBe(4);
  });

  it('reaches the bird base after the two petal folds', () => {
    const state = run(5);
    // The front page's corner D and the back page's corner B point up the centre
    // line, one base length from the bottom; the wing corners A and C stay below.
    const [uD] = cornerUv(state, CORNERS.D);
    const [uB] = cornerUv(state, CORNERS.B);
    const [uA] = cornerUv(state, CORNERS.A);
    const [uC] = cornerUv(state, CORNERS.C);
    expect(uD).toBeCloseTo(1);
    expect(uB).toBeCloseTo(1);
    expect(uA).toBeCloseTo(0);
    expect(uC).toBeCloseTo(0);
    const box = bounds(foldedPoints(state));
    expect(box.maxX).toBeCloseTo(Math.SQRT1_2);
  });

  it('moves paper at every step and ends as a crane with spread wings', () => {
    const state = run();
    expect(state.foldCount).toBeGreaterThan(steps.length);
    // Neck (D) and tail (B) rise above the body, the head bends forward and
    // down from the neck, both wing tips (A, C) hang below the spine.
    const [uD, vD] = cornerUv(state, CORNERS.D);
    const [uB, vB] = cornerUv(state, CORNERS.B);
    const [uA, vA] = cornerUv(state, CORNERS.A);
    const [uC, vC] = cornerUv(state, CORNERS.C);
    expect(Math.abs(vD)).toBeGreaterThan(0.15);
    expect(Math.abs(vB)).toBeGreaterThan(0.3);
    expect(uD).toBeGreaterThan(uB);
    expect(Math.abs(vA)).toBeGreaterThan(0.4);
    expect(uA).toBeCloseTo(uC);
    expect(vA).toBeCloseTo(vC);
    expect(facetCount(state)).toBeGreaterThan(40);
    // The last step keeps its creases open so the wings stand off the body.
    expect(steps[steps.length - 1]?.options.angle).toBe(100);
  });

  it('counts the layers of the finished crane quickly', () => {
    const state = run();
    const start = performance.now();
    const layers = maxLayers(state);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(layers).toBeGreaterThan(20);
  });
});
