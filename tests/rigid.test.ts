import { describe, expect, it } from 'vitest';

import { approxEqualVec, vec } from '../src/geometry';
import { FoldHistory, createPaper, currentPolygon } from '../src/paper';
import { PRESETS, presetToSequence } from '../src/presets';
import { applyStep } from '../src/sequence';
import { type Hinge, hinges, placePanels } from '../src/rigid';
import { foldLeftRight, foldLeftRightAgain, run } from './presets';

const runPreset = (id: string): FoldHistory => {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`no preset ${id}`);
  const history = new FoldHistory(createPaper());
  let state = history.state;
  for (const step of presetToSequence(preset).steps) state = applyStep(state, step).state;
  // A history whose current sheet is the preset's result.
  return { state } as FoldHistory;
};

describe('hinges', () => {
  it('finds the single crease of one fold as a valley seen from the front', () => {
    const history = new FoldHistory(createPaper());
    run(history, [foldLeftRight()]);
    const all = hinges(history.state);
    expect(all).toHaveLength(1);
    const [h] = all as [Hinge];
    // The crease runs along x = 0.5 over the whole height.
    expect(Math.min(h.a.y, h.b.y)).toBeCloseTo(0);
    expect(Math.max(h.a.y, h.b.y)).toBeCloseTo(1);
    expect(h.a.x).toBeCloseTo(0.5);
    // The flap lies on top of the base facet, toward its front face.
    const base = history.state.facets.find((f) => f.z === 0);
    const flap = history.state.facets.find((f) => f.z === 1);
    expect(base && flap).toBeTruthy();
    const angleTowardFlap = h.p === base?.id ? h.angle : -h.angle;
    expect(angleTowardFlap).toBeCloseTo(Math.PI);
  });

  it('gives a crease that was folded and unfolded again an angle of zero', () => {
    // The crane's first step pre-creases a diagonal: fold over, fold back.
    const crane = PRESETS.find((p) => p.id === 'crane');
    if (!crane) throw new Error('crane preset missing');
    const [first] = presetToSequence(crane).steps;
    if (!first) throw new Error('crane steps missing');
    const pre = applyStep(createPaper(), first).state;
    const all = hinges(pre);
    expect(all).toHaveLength(1);
    expect(all[0]?.angle).toBe(0);
  });
});

describe('placePanels', () => {
  const flatAgain = (history: FoldHistory): void => {
    const state = history.state;
    const panels = placePanels(state, hinges(state));
    expect(panels).toHaveLength(state.facets.length);
    for (const panel of panels) {
      const flat = currentPolygon(panel.facet);
      panel.points.forEach((p, i) => {
        expect(Math.abs(p.z)).toBeLessThan(1e-6);
        expect(approxEqualVec(vec(p.x, p.y), flat[i] as (typeof flat)[number], 1e-6)).toBe(true);
      });
    }
  };

  it('reproduces the flat-folded sheet with the flat-folded angles', () => {
    flatAgain(runPreset('three-halves'));
    flatAgain(runPreset('corner-two-edges'));
    flatAgain(runPreset('corner-loose'));
  });

  it('reproduces the finished crane, all 76 facets', () => {
    flatAgain(runPreset('crane'));
  });

  it('keeps neighbours attached along their crease when the creases are opened', () => {
    // A sheet folded in half twice the same way is a chain of strips, so
    // every hinge is used by the walk and stays closed whatever the angles.
    const history = new FoldHistory(createPaper());
    run(history, [foldLeftRight(), foldLeftRightAgain()]);
    const state = history.state;
    const all = hinges(state);
    const opened = placePanels(state, all, {
      angleOf: (h) => (h.angle === 0 ? 0 : Math.sign(h.angle) * (Math.PI - 0.4)),
    });
    expect(opened.some((p) => p.points.some((q) => Math.abs(q.z) > 0.05))).toBe(true);
    // The two facets of every hinge still meet along the crease.
    const byId = new Map(opened.map((p) => [p.facet.id, p]));
    for (const h of all) {
      const p = byId.get(h.p);
      const q = byId.get(h.q);
      if (!p || !q) throw new Error('panel missing');
      const nearest = (panel: typeof p, point: { x: number; y: number }): number => {
        const i = panel.facet.poly.findIndex((v) => approxEqualVec(v, point, 1e-6));
        return i;
      };
      // A hinge endpoint that is a vertex of both facets must coincide in space.
      for (const end of [h.a, h.b]) {
        const i = nearest(p, end);
        const j = nearest(q, end);
        if (i < 0 || j < 0) continue;
        const a = p.points[i] as { x: number; y: number; z: number };
        const b = q.points[j] as { x: number; y: number; z: number };
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(1e-6);
      }
    }
  });
});
