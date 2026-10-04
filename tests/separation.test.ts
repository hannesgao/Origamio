import { describe, expect, it } from 'vitest';

import { vec } from '../src/geometry';
import { type PaperState, createPaper, fold, isFlipped } from '../src/paper';
import { PRESETS, presetToSequence } from '../src/presets';
import { type Vec3, hinges, stepPose } from '../src/rigid';
import { type FoldStep, applyStep } from '../src/sequence';
import { solveSheet, solverInternals } from '../src/solve';

const craneState = (): PaperState => {
  const crane = PRESETS.find((p) => p.id === 'crane');
  if (!crane) throw new Error('crane preset missing');
  let state = createPaper();
  for (const step of presetToSequence(crane).steps)
    state = applyStep(state, step as FoldStep).state;
  return state;
};

/** The sheet's up direction at a facet, in the flat-folded state. */
const upOf = (normal: Vec3, flipped: boolean): Vec3 =>
  flipped ? { x: -normal.x, y: -normal.y, z: -normal.z } : normal;

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const centre = (points: readonly Vec3[]): Vec3 => {
  const s = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }), {
    x: 0,
    y: 0,
    z: 0,
  });
  return { x: s.x / points.length, y: s.y / points.length, z: s.z / points.length };
};

describe('layers kept apart', () => {
  it('lifts the folded-over half of a sheet by the paper thickness', () => {
    const state = fold(createPaper(), { a: vec(0.5, 0), b: vec(0.5, 1) }, 1).state;
    const all = hinges(state);
    const thickness = 0.01;
    const solved = solveSheet(state, all, { thickness, angleOf: (h) => h.angle });
    const [lower, upper] = [...solved.panels].sort((a, b) => a.facet.z - b.facet.z);
    if (!lower || !upper) throw new Error('two panels expected');
    const up = upOf(lower.normal, isFlipped(lower.facet));
    const gap = dot(up, centre(upper.points)) - dot(up, centre(lower.points));
    // The halves share the crease, so the gap grows from zero there to the thickness away from it.
    expect(gap).toBeGreaterThan(thickness * 0.2);
    expect(gap).toBeLessThan(thickness * 1.5);
  });

  it('finds an overlap only between layers that touch, never across a shared crease', () => {
    const state = fold(createPaper(), { a: vec(0.5, 0), b: vec(0.5, 1) }, 1).state;
    const mesh = solverInternals.buildMesh(state, hinges(state));
    expect(mesh.overlaps.length).toBeGreaterThan(0);
    for (const o of mesh.overlaps) expect(o.underId).not.toBe(o.overId);
  });

  it('keeps the layers of the crane in order to within the loop error', () => {
    const state = craneState();
    const all = hinges(state);
    const thickness = 0.0005;
    const solved = solveSheet(state, all, { ...stepPose(state, 0), thickness, iterations: 80 });
    const mesh = solverInternals.buildMesh(state, all);
    const byId = new Map(solved.panels.map((p) => [p.facet.id, p]));
    const gaps: number[] = [];
    for (const o of mesh.overlaps) {
      const under = byId.get(o.underId);
      const over = byId.get(o.overId);
      if (!under || !over) throw new Error('panel missing');
      // The solver measures along the mean of both layers' up directions.
      const u1 = upOf(under.normal, isFlipped(under.facet));
      const u2 = upOf(over.normal, isFlipped(over.facet));
      const sum = { x: u1.x + u2.x, y: u1.y + u2.y, z: u1.z + u2.z };
      const len = Math.hypot(sum.x, sum.y, sum.z) || 1;
      const up = { x: sum.x / len, y: sum.y / len, z: sum.z / len };
      const at = (id: number, tri: readonly number[], w: readonly number[]): Vec3 => {
        const pts = solved.positions.get(id);
        const ids = mesh.index.get(id);
        if (!pts || !ids) throw new Error('positions missing');
        let p = { x: 0, y: 0, z: 0 };
        tri.forEach((vi, n) => {
          const q = pts[ids.indexOf(vi)];
          const weight = w[n] as number;
          if (!q) throw new Error('vertex missing');
          p = { x: p.x + q.x * weight, y: p.y + q.y * weight, z: p.z + q.z * weight };
        });
        return p;
      };
      gaps.push(dot(up, at(o.overId, o.over, o.overW)) - dot(up, at(o.underId, o.under, o.underW)));
    }
    expect(gaps.length).toBeGreaterThan(100);
    // The wings and body form a loop that rigid facets cannot close exactly;
    // no layer may pass through another by more than that loop error.
    const worst = Math.min(...gaps);
    // Order is hard: no layer passes through another beyond the solver's tolerance.
    expect(worst).toBeGreaterThan(-4e-4);
    expect(gaps.filter((g) => g < -1e-4).length).toBeLessThan(gaps.length * 0.05);
    // On average the stack is spread by the thickness rather than squashed.
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    expect(mean).toBeGreaterThan(thickness * 0.2);
  });

  it('is fast enough to solve the crane on every frame', () => {
    const state = craneState();
    const all = hinges(state);
    solveSheet(state, all, { ...stepPose(state, 0.1), thickness: 0.0005, iterations: 80 });
    const t0 = performance.now();
    for (let n = 0; n < 5; n++)
      solveSheet(state, all, { ...stepPose(state, 0.1), thickness: 0.0005, iterations: 80 });
    const ms = (performance.now() - t0) / 5;
    process.stdout.write(
      `crane solve ${ms.toFixed(1)} ms, overlaps ${solverInternals.buildMesh(state, all).overlaps.length}\n`,
    );
    expect(ms).toBeLessThan(200);
  });
});
