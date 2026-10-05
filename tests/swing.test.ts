import { describe, expect, it } from 'vitest';

import { approxEqualVec } from '../src/geometry';
import { type PaperState, createPaper, fold } from '../src/paper';
import { PRESETS, presetToSequence } from '../src/presets';
import {
  type ContactMemory,
  type Panel,
  type Vec3,
  hinges,
  placePanels,
  stepPose,
} from '../src/rigid';
import { type FoldStep, applyStep } from '../src/sequence';
import { solveSheet } from '../src/solve';
import { solvedScene } from '../src/view3d';

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

/** How deep segment pq passes through triangle abc, or 0 when it misses or only grazes it. */
function through(p: Vec3, q: Vec3, a: Vec3, b: Vec3, c: Vec3, margin: number): number {
  const n = cross(sub(b, a), sub(c, a));
  const nl = len(n);
  if (nl < 1e-12) return 0;
  const unit = { x: n.x / nl, y: n.y / nl, z: n.z / nl };
  const dp = dot(sub(p, a), unit);
  const dq = dot(sub(q, a), unit);
  if (dp * dq >= 0 || Math.min(Math.abs(dp), Math.abs(dq)) < margin) return 0;
  const t = dp / (dp - dq);
  const x = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t };
  for (const [u, v] of [
    [a, b],
    [b, c],
    [c, a],
  ] as const) {
    const e = sub(v, u);
    if (dot(cross(e, sub(x, u)), unit) / len(e) < margin) return 0;
  }
  return Math.min(Math.abs(dp), Math.abs(dq));
}

/** The deepest pass of any facet edge through any other facet. */
function penetration(panels: readonly Panel[], margin: number): number {
  let worst = 0;
  for (const p of panels) {
    for (const q of panels) {
      if (p.facet.id === q.facet.id) continue;
      const edge = p.points;
      const tri = q.points;
      for (let i = 0; i < edge.length; i++) {
        const a = edge[i] as Vec3;
        const b = edge[(i + 1) % edge.length] as Vec3;
        for (let k = 1; k + 1 < tri.length; k++) {
          worst = Math.max(
            worst,
            through(a, b, tri[0] as Vec3, tri[k] as Vec3, tri[k + 1] as Vec3, margin),
          );
        }
      }
    }
  }
  return worst;
}

/** The sheet before a crane step's fold, and the fold applied, by step number and fold number. */
function craneFold(
  stepNumber: number,
  partNumber: number,
): { before: PaperState; after: PaperState; movedIds: Set<number> } {
  const crane = PRESETS.find((p) => p.id === 'crane');
  if (!crane) throw new Error('crane preset missing');
  const steps = presetToSequence(crane).steps;
  let state = createPaper();
  for (let i = 0; i < stepNumber - 1; i++) state = applyStep(state, steps[i] as FoldStep).state;
  const step = steps[stepNumber - 1] as FoldStep;
  const parts = [step, ...(step.also ?? [])];
  let before = state;
  let result = fold(before, step.line, step.side, step.options);
  for (let k = 1; k < partNumber; k++) {
    const part = parts[k] as FoldStep;
    before = result.state;
    result = fold(before, part.line, part.side, part.options);
  }
  return { before, after: result.state, movedIds: new Set(result.movedIds) };
}

const OPENING = (6 * Math.PI) / 180;
const THICKNESS = 0.07 / 150;

describe('a step in flight stays whole', () => {
  // The folds of the crane that once tore, jammed or passed through layers:
  // the petal lift, the point narrowed, the neck reverse folded, a wing spread.
  const folds: [string, number, number][] = [
    ['petal lift', 4, 3],
    ['narrow point', 6, 1],
    ['reverse fold neck', 9, 1],
    ['spread wing', 12, 1],
  ];
  for (const [name, stepNumber, partNumber] of folds) {
    it(`solves the ${name} half way without layers passing through each other`, () => {
      const { before, after, movedIds } = craneFold(stepNumber, partNumber);
      const contact: ContactMemory = { before, sides: new Map(), seeded: false };
      // Sides are learnt on the first frame and kept.
      solvedScene(after, {
        opening: OPENING,
        thickness: THICKNESS,
        animation: { previous: before, movedIds, progress: 0.1, contact },
      });
      const scene = solvedScene(after, {
        opening: OPENING,
        thickness: THICKNESS,
        animation: { previous: before, movedIds, progress: 0.5, contact },
      });
      expect(penetration(scene.panels, 0.01)).toBe(0);
      // The solved sheet stays close to the rigid swing: the contacts hold
      // layers apart, they do not drag the sheet about.
      const walk = placePanels(
        after,
        hinges(after),
        stepPose(after, OPENING, { previous: before, movedIds, progress: 0.5 }),
      );
      let drift = 0;
      scene.panels.forEach((panel, i) => {
        const placed = walk[i] as Panel;
        panel.points.forEach((p, j) => {
          drift = Math.max(drift, len(sub(p, placed.points[j] as Vec3)));
        });
      });
      expect(drift).toBeLessThan(0.1);
    });
  }

  it('releases the creases an inside reverse fold cannot swing on, so it walks without tears', () => {
    const { before, after, movedIds } = craneFold(9, 1);
    const pose = stepPose(after, 0, { previous: before, movedIds, progress: 0.5 });
    expect(pose.released?.size).toBe(1);
    const all = hinges(after);
    const byId = new Map(placePanels(after, all, pose).map((p) => [p.facet.id, p]));
    let worst = 0;
    for (const h of all) {
      const p = byId.get(h.p);
      const q = byId.get(h.q);
      if (!p || !q) continue;
      for (const end of [h.a, h.b]) {
        const i = p.facet.poly.findIndex((v) => approxEqualVec(v, end));
        const j = q.facet.poly.findIndex((v) => approxEqualVec(v, end));
        if (i < 0 || j < 0) continue;
        worst = Math.max(worst, len(sub(p.points[i] as Vec3, q.points[j] as Vec3)));
      }
    }
    expect(worst).toBeLessThan(0.03);
  });

  it('settles a stack from any anchor, including one in the middle of it', () => {
    const { after } = craneFold(7, 2);
    const all = hinges(after);
    for (const root of after.facets) {
      const solved = solveSheet(after, all, {
        ...stepPose(after, OPENING),
        rootId: root.id,
        iterations: 80,
        thickness: THICKNESS,
      });
      expect(solved.residual, `anchor ${root.id}`).toBeLessThan(1e-3);
    }
  });
});
