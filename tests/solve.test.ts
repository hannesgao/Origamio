import { describe, expect, it } from 'vitest';

import { FoldHistory, createPaper } from '../src/paper';
import { PRESETS, presetToSequence } from '../src/presets';
import { type Vec3, hinges, stepPose } from '../src/rigid';
import { type FoldStep, applyStep } from '../src/sequence';
import { solveSheet } from '../src/solve';
import { foldLeftRight, foldLeftRightAgain, foldTopBottom, run } from './presets';

const len = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('solveSheet', () => {
  it('holds a single fold at its target angle with rigid facets', () => {
    const history = new FoldHistory(createPaper());
    const step = foldLeftRight();
    history.fold(step.line, step.side, { angle: 100 });
    const state = history.state;
    const solved = solveSheet(state, hinges(state), stepPose(state, 0));
    expect(solved.panels).toHaveLength(2);
    // Each facet keeps its shape...
    for (const panel of solved.panels) {
      const poly = panel.facet.poly;
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length;
        const a = poly[i] as { x: number; y: number };
        const b = poly[j] as { x: number; y: number };
        const rest = Math.hypot(a.x - b.x, a.y - b.y);
        expect(len(panel.points[i] as Vec3, panel.points[j] as Vec3)).toBeCloseTo(rest, 3);
      }
    }
    // ...and the crease holds 100 degrees: a flat sheet has parallel normals,
    // one folded flat opposite ones, so the normals are 100 degrees apart.
    const [a, b] = solved.panels as [(typeof solved.panels)[0], (typeof solved.panels)[0]];
    const cos = a.normal.x * b.normal.x + a.normal.y * b.normal.y + a.normal.z * b.normal.z;
    expect((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI).toBeCloseTo(100, 0);
  });

  it('closes the loops of a sheet folded in half three times when opened', () => {
    const history = new FoldHistory(createPaper());
    run(history, [foldLeftRight(), foldTopBottom(), foldLeftRightAgain()]);
    const state = history.state;
    const all = hinges(state);
    const solved = solveSheet(state, all, { ...stepPose(state, 0.3), iterations: 200 });
    // Every hinge's endpoints coincide on both facets.
    const byId = new Map(solved.panels.map((p) => [p.facet.id, p]));
    let worst = 0;
    for (const h of all) {
      const p = byId.get(h.p);
      const q = byId.get(h.q);
      if (!p || !q) continue;
      for (const end of [h.a, h.b]) {
        const i = p.facet.poly.findIndex((v) => Math.hypot(v.x - end.x, v.y - end.y) < 1e-9);
        const j = q.facet.poly.findIndex((v) => Math.hypot(v.x - end.x, v.y - end.y) < 1e-9);
        if (i < 0 || j < 0) continue;
        worst = Math.max(worst, len(p.points[i] as Vec3, q.points[j] as Vec3));
      }
    }
    expect(worst).toBeLessThan(1e-3);
    expect(solved.residual).toBeLessThan(1e-3);
  });

  it('solves the crane with its facets intact', () => {
    const crane = PRESETS.find((p) => p.id === 'crane');
    if (!crane) throw new Error('crane missing');
    let state = createPaper();
    for (const step of presetToSequence(crane).steps)
      state = applyStep(state, step as FoldStep).state;
    const all = hinges(state);
    const started = performance.now();
    const solved = solveSheet(state, all, { ...stepPose(state, 0.1), iterations: 120 });
    const took = performance.now() - started;
    expect(took).toBeLessThan(2000);
    let worstLength = 0;
    for (const panel of solved.panels) {
      const poly = panel.facet.poly;
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length;
        const a = poly[i] as { x: number; y: number };
        const b = poly[j] as { x: number; y: number };
        const rest = Math.hypot(a.x - b.x, a.y - b.y);
        worstLength = Math.max(
          worstLength,
          Math.abs(len(panel.points[i] as Vec3, panel.points[j] as Vec3) - rest),
        );
      }
    }
    expect(worstLength).toBeLessThan(5e-3);
  });
});
