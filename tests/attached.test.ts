import { describe, expect, it } from 'vitest';

import { line, perpendicularBisector, sideOf, vec } from '../src/geometry';
import { type PaperState, createPaper, facetCount, fold, topLayers } from '../src/paper';
import { tears } from '../src/rigid';
import { type FoldStep, applyStep, parseSequence, serializeSequence } from '../src/sequence';

const A = vec(0, 0);
const B = vec(1, 0);
const D = vec(0, 1);
const O = vec(0.5, 0.5);
const H = vec(0, 0.5);
const uv = (u: number, v: number) => vec((u - v) * Math.SQRT1_2, (u + v) * Math.SQRT1_2);
const bring = (state: PaperState, from: typeof A, to: typeof A, options = {}) => {
  const l = perpendicularBisector(from, to);
  return fold(state, l, sideOf(l, from), options);
};

/** The square base: both medians, then the squash that frees the nested flap. */
const squareBase = (): PaperState => {
  let s = createPaper();
  s = bring(s, B, A).state;
  s = bring(s, D, A).state;
  const axis = line(A, O);
  s = fold(s, axis, sideOf(axis, H), { region: [A, O, D] }).state;
  s = fold(s, axis, sideOf(axis, vec(0.5, 0)), { region: [A, O, D] }).state;
  return s;
};

describe('attached folds', () => {
  it('takes the layer joined to a flap along instead of tearing it', () => {
    const base = squareBase();
    // Folding only the top layer's corner tears it from the layer it is folded with...
    const torn = bring(base, H, uv(0.5, 0), { layers: topLayers(1) });
    expect(tears(torn.state)).toBe(1);
    expect(torn.takenAlong).toBe(0);
    // ...unless attached paper is taken along: then the two-layer flap folds as one.
    const whole = bring(base, H, uv(0.5, 0), { layers: topLayers(1), attached: true });
    expect(tears(whole.state)).toBe(0);
    expect(whole.takenAlong).toBe(1);
    const twoLayers = bring(base, H, uv(0.5, 0), { layers: topLayers(2) });
    expect(facetCount(whole.state)).toBe(facetCount(twoLayers.state));
  });

  it('leaves a fold alone that is already physical', () => {
    const result = bring(createPaper(), B, A, { attached: true });
    expect(result.takenAlong).toBe(0);
    expect(result.movedIds).toHaveLength(1);
  });

  it('round-trips the flag through the file format and counts along grouped parts', () => {
    const l = perpendicularBisector(H, uv(0.5, 0));
    const step: FoldStep = {
      line: perpendicularBisector(B, A),
      side: sideOf(perpendicularBisector(B, A), B),
      options: {},
      also: [{ line: l, side: sideOf(l, H), options: { layers: topLayers(1), attached: true } }],
    };
    const text = serializeSequence({ name: 'x', steps: [step] });
    expect(text).toContain('"attached": true');
    const parsed = parseSequence(text);
    expect(parsed.steps[0]?.also?.[0]?.options.attached).toBe(true);
    const applied = applyStep(createPaper(), parsed.steps[0] as FoldStep);
    expect(applied.takenAlong).toBeGreaterThanOrEqual(0);
  });
});
