import { describe, expect, it } from 'vitest';

import { approxEqualVec, vec } from '../src/geometry';
import { createPaper } from '../src/paper';
import { PRESETS, presetToSequence } from '../src/presets';
import { type Vec3, hinges, stepPose } from '../src/rigid';
import { type FoldStep, applyStep, parseSequence, serializeSequence } from '../src/sequence';
import { solveSheet } from '../src/solve';
import { DEFAULT_FRAME, namedViews } from '../src/view3d';

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

describe('named views', () => {
  it('builds four orthonormal, right-handed views from a frame', () => {
    const views = namedViews({ front: vec(1, 1), top: vec(-1, 1) });
    expect(views.map((v) => v.label)).toEqual(['Front view', 'Side view', 'Top view', 'Isometric']);
    expect(views.map((v) => v.short)).toEqual(['Front', 'Side', 'Top', 'Iso']);
    for (const view of views) {
      const basis = view.orbit.basis;
      if (!basis) throw new Error('named views carry a basis');
      const [r, u, d] = basis;
      for (const row of basis) expect(len(row)).toBeCloseTo(1);
      expect(dot(r, u)).toBeCloseTo(0);
      expect(dot(u, d)).toBeCloseTo(0);
      expect(dot(r, d)).toBeCloseTo(0);
      // Right x up points towards the viewer.
      const cross = {
        x: r.y * u.z - r.z * u.y,
        y: r.z * u.x - r.x * u.z,
        z: r.x * u.y - r.y * u.x,
      };
      expect(dot(cross, d)).toBeCloseTo(1);
    }
    // The front view looks at the face: the face direction points at the viewer, the back is up.
    const front = views[0]?.orbit.basis;
    expect(front && dot(front[2], { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 })).toBeCloseTo(1);
    expect(front && dot(front[1], { x: -Math.SQRT1_2, y: Math.SQRT1_2, z: 0 })).toBeCloseTo(1);
    // The side view shows the profile with the face to the left.
    const side = views[1]?.orbit.basis;
    expect(side && dot(side[0], { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 })).toBeCloseTo(-1);
  });

  it('falls back to the sheet axes and keeps a non-orthogonal top usable', () => {
    const plain = namedViews(DEFAULT_FRAME);
    expect(plain[0]?.orbit.basis?.[2]).toEqual({ x: 1, y: 0, z: 0 });
    const skew = namedViews({ front: vec(1, 0), top: vec(1, 1) });
    const up = skew[0]?.orbit.basis?.[1];
    expect(up && approxEqualVec({ x: up.x, y: up.y }, vec(0, 1))).toBe(true);
  });
});

describe('view frame in files', () => {
  it('round-trips and is validated', () => {
    const crane = PRESETS.find((p) => p.id === 'crane');
    if (!crane) throw new Error('crane missing');
    const sequence = presetToSequence(crane);
    expect(sequence.view).toBeDefined();
    const text = serializeSequence(sequence);
    expect(text).toContain('"view"');
    const parsed = parseSequence(text);
    expect(parsed.view?.front.x).toBeCloseTo(Math.SQRT1_2);
    expect(parsed.view?.top.y).toBeCloseTo(Math.SQRT1_2);
    // The wing step's two folds each carry their angle.
    const wings = parsed.steps[parsed.steps.length - 1];
    expect(wings?.options.angle).toBe(100);
    expect(wings?.also?.[0]?.options.angle).toBe(100);
    const base = JSON.parse(text) as Record<string, unknown>;
    expect(() => parseSequence({ ...base, view: { front: [0, 0], top: [0, 1] } })).toThrow(
      /non-zero/,
    );
    expect(() => parseSequence({ ...base, view: { front: [1, 0], top: [2, 0] } })).toThrow(
      /parallel/,
    );
  });
});

describe('the solved crane', () => {
  it('spreads its wings to both sides of the body and above the back', () => {
    const crane = PRESETS.find((p) => p.id === 'crane');
    if (!crane) throw new Error('crane missing');
    let state = createPaper();
    for (const step of presetToSequence(crane).steps)
      state = applyStep(state, step as FoldStep).state;
    const solved = solveSheet(state, hinges(state), { ...stepPose(state, 0.1), iterations: 120 });
    const tip = (c: { x: number; y: number }): Vec3 => {
      for (const p of solved.panels) {
        const i = p.facet.poly.findIndex((v) => approxEqualVec(v, c));
        if (i >= 0) return p.points[i] as Vec3;
      }
      throw new Error('corner lost');
    };
    const a = tip(vec(0, 0));
    const c = tip(vec(1, 1));
    // One wing tip on each side of the body's plane (the sheet's plane, z = 0).
    expect(Math.sign(a.z) * Math.sign(c.z)).toBe(-1);
    expect(Math.abs(a.z)).toBeGreaterThan(0.2);
    expect(Math.abs(c.z)).toBeGreaterThan(0.2);
    // Both rise above the back (the +v side) rather than hanging below it.
    const v = (p: Vec3): number => (p.y - p.x) * Math.SQRT1_2;
    expect(v(a)).toBeGreaterThan(0);
    expect(v(c)).toBeGreaterThan(0);
  });
});
