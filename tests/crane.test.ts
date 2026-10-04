import { describe, expect, it } from 'vitest';

import { type Vec, apply, approxEqualVec, bounds, vec } from '../src/geometry';
import {
  type PaperState,
  createPaper,
  facetCount,
  fold,
  foldedPoints,
  maxLayers,
} from '../src/paper';
import { PRESETS, presetToSequence } from '../src/presets';
import { hinges, placePanels, stepPose, tears } from '../src/rigid';
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

describe('crane animation', () => {
  it('swings the moving paper of every fold to one side, half way through', () => {
    let state = createPaper();
    for (const step of steps) {
      let before = state;
      for (const part of [step, ...(step.also ?? [])]) {
        const result = fold(before, part.line, part.side, part.options);
        const movedIds = new Set(result.movedIds);
        if (movedIds.size > 0) {
          const all = hinges(result.state);
          const pose = stepPose(result.state, 0.1, { previous: before, movedIds, progress: 0.5 });
          const panels = placePanels(result.state, all, pose);
          const byId = new Map(panels.map((p) => [p.facet.id, p]));
          // Every crease the fold crosses must leave the sheet whole: the two
          // facets of a hinge agree on where its ends are, to within the loop
          // error. The reverse folds of the neck and head are not rigid and
          // disagree by 0.17 half way; the petal folds once tore by 1.0.
          let worst = 0;
          for (const h of all) {
            const p = byId.get(h.p);
            const q = byId.get(h.q);
            if (!p || !q) continue;
            for (const end of [h.a, h.b]) {
              const i = p.facet.poly.findIndex((v) => approxEqualVec(v, end));
              const j = q.facet.poly.findIndex((v) => approxEqualVec(v, end));
              if (i < 0 || j < 0) continue;
              const a = p.points[i] as { x: number; y: number; z: number };
              const b = q.points[j] as { x: number; y: number; z: number };
              worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
            }
          }
          expect(worst, `${step.label ?? ''}: facets torn apart mid-swing`).toBeLessThan(0.2);
        }
        before = result.state;
      }
      state = applyStep(state, step as FoldStep).state;
    }
  });
});
