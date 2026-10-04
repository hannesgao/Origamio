import { describe, expect, it } from 'vitest';

import { line, perpendicularBisector, sideOf, vec } from '../src/geometry';
import { createPaper, facetCount, topLayers } from '../src/paper';
import { type FoldStep, applyStep, parseSequence, serializeSequence } from '../src/sequence';
import { tears } from '../src/rigid';
import { Timeline } from '../src/timeline';

const A = vec(0, 0);
const B = vec(1, 0);
const D = vec(0, 1);
const O = vec(0.5, 0.5);
const bring = (from: typeof A, to: typeof A, options = {}) => {
  const l = perpendicularBisector(from, to);
  return { line: l, side: sideOf(l, from), options };
};

/** Pre-crease a diagonal, then collapse to the square base, as grouped steps. */
const steps: FoldStep[] = [
  { ...bring(D, B), also: [bring(B, D, { layers: topLayers(1) })], label: 'Pre-crease' },
  {
    ...bring(B, A),
    also: [
      bring(D, A),
      { line: line(A, O), side: sideOf(line(A, O), vec(0, 0.5)), options: { region: [A, O, D] } },
      { line: line(A, O), side: sideOf(line(A, O), vec(0.5, 0)), options: { region: [A, O, D] } },
    ],
    label: 'Square base',
  },
];

describe('grouped steps', () => {
  it('applies every part of a step and reports the facets that moved', () => {
    const sheet = createPaper();
    const first = applyStep(sheet, steps[0] as FoldStep);
    // Fold and unfold: two facets, both back where they were, so nothing moved.
    expect(facetCount(first.state)).toBe(2);
    expect(first.movedIds).toHaveLength(0);
    const base = applyStep(first.state, steps[1] as FoldStep);
    expect(facetCount(base.state)).toBe(7);
    expect(base.movedIds.length).toBeGreaterThan(0);
    expect(tears(base.state)).toBe(0);
  });

  it('plays a grouped step as one timeline step', () => {
    const timeline = new Timeline(createPaper());
    timeline.load(steps);
    expect(timeline.length).toBe(2);
    timeline.seek(2);
    expect(facetCount(timeline.state)).toBe(7);
    expect(timeline.effect(0)).toBe(false);
    expect(timeline.effect(1)).toBe(true);
  });

  it('round-trips the extra parts through the file format', () => {
    const text = serializeSequence({ name: 'Base', steps });
    const parsed = parseSequence(text);
    expect(parsed.steps[1]?.also).toHaveLength(3);
    expect(parsed.steps[1]?.also?.[1]?.options.region).toHaveLength(3);
    expect(serializeSequence(parsed)).toBe(text);
    const again = applyStep(createPaper(), parsed.steps[1] as FoldStep);
    expect(facetCount(again.state)).toBe(6);
  });

  it('rejects a malformed part', () => {
    expect(() =>
      parseSequence({
        format: 'origamio-sequence',
        version: 1,
        name: 'x',
        steps: [
          {
            line: [
              [0, 0],
              [1, 1],
            ],
            side: 1,
            also: [{ side: 1 }],
          },
        ],
      }),
    ).toThrow(/also\[0\]\.line/);
  });
});
