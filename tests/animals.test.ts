import { describe, expect, it } from 'vitest';

import { type Vec, apply, approxEqualVec, bounds, vec } from '../src/geometry';
import { type PaperState, createPaper, fold, foldedPoints } from '../src/paper';
import { PRESETS, presetToSequence } from '../src/presets';
import { tears } from '../src/rigid';
import { type FoldStep, applyStep } from '../src/sequence';

const preset = (id: string) => {
  const found = PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`${id} preset missing`);
  return presetToSequence(found);
};

/** Apply every step, checking that no fold of any step tears the sheet. */
const run = (id: string): PaperState => {
  const sequence = preset(id);
  let state = createPaper(sequence.paper?.width ?? 1, sequence.paper?.height ?? 1);
  for (const [i, step] of sequence.steps.entries()) {
    let between = state;
    for (const part of [step, ...(step.also ?? [])]) {
      between = fold(between, part.line, part.side, part.options).state;
      expect(tears(between), `${id} step ${i + 1} (${step.label ?? ''})`).toBe(0);
    }
    state = applyStep(state, step as FoldStep).state;
  }
  return state;
};

/** Folded position of a sheet corner. */
const cornerAt = (state: PaperState, corner: Vec): Vec => {
  const facet = state.facets.find((f) => f.poly.some((p) => approxEqualVec(p, corner)));
  if (!facet) throw new Error('corner lost');
  return apply(facet.transform, corner);
};

describe('jumping frog preset', () => {
  it('has a waterbomb head with its legs out, sides in and a pleated spring', () => {
    const sequence = preset('frog');
    expect(sequence.paper).toEqual(expect.objectContaining({ width: 1, height: 2 }));
    const state = run('frog');
    const box = bounds(foldedPoints(state));
    // Sides folded in to the middle half, the spring pleat raising the bottom to y = 0.5.
    expect(box.minX).toBeCloseTo(0.25);
    expect(box.maxX).toBeCloseTo(0.75);
    expect(box.minY).toBeCloseTo(0.5);
    // The head's apex is the top square's centre; the feet stick out past the sides.
    expect(box.maxY).toBeCloseTo(1.5);
    const foot = cornerAt(state, vec(0, 2));
    expect(foot.x).toBeLessThan(0.3);
    expect(foot.y).toBeGreaterThan(1);
  });
});
