import { describe, expect, it } from 'vitest';

import { line, sideOf, vec } from '../src/geometry';
import { createPaper, fold } from '../src/paper';
import { hinges, stepPose } from '../src/rigid';
import { InlineSolver, SolveCore, WorkerSolver, createSheetSolver } from '../src/solver';

describe('the solver service', () => {
  it('solves inline where there is no Worker', async () => {
    const solver = createSheetSolver();
    expect(solver).toBeInstanceOf(InlineSolver);
    const state = fold(createPaper(), { a: vec(0.5, 0), b: vec(0.5, 1) }, 1).state;
    const scene = await solver.solve({ stateId: 'a', state, opening: 0.1, thickness: 0 });
    expect(scene.panels).toHaveLength(2);
    expect(scene.reach).toBeGreaterThan(0);
    solver.dispose();
  });

  it('keeps one contact memory per step animation', () => {
    const core = new SolveCore();
    const before = fold(createPaper(), { a: vec(0.5, 0), b: vec(0.5, 1) }, 1).state;
    const result = fold(before, { a: vec(0.25, 0), b: vec(0.25, 1) }, -1);
    const state = result.state;
    const movedIds = [...result.movedIds];
    const frame = (id: number, progress: number) =>
      core.solve({
        stateId: 's',
        state: structuredClone(state),
        opening: 0,
        thickness: 0,
        animation: { id, previousId: 'p', previous: structuredClone(before), movedIds, progress },
      });
    expect(frame(1, 0.2).panels).toHaveLength(state.facets.length);
    expect(frame(1, 0.6).panels).toHaveLength(state.facets.length);
    expect(frame(2, 0.2).panels).toHaveLength(state.facets.length);
  });
});

describe('the solver keeps its anchor', () => {
  it('holds the same facet still across sheets as long as it exists and stays put', () => {
    const core = new SolveCore();
    const half = fold(createPaper(), { a: vec(0.5, 0), b: vec(0.5, 1) }, 1).state;
    const first = core.solve({ stateId: 'a', state: half, opening: 0.1, thickness: 0 });
    expect(first.anchorId).toBeDefined();
    const quarter = fold(half, { a: vec(0.25, 0), b: vec(0.25, 1) }, -1);
    const second = core.solve({ stateId: 'b', state: quarter.state, opening: 0.1, thickness: 0 });
    const survives = quarter.state.facets.some((f) => f.id === first.anchorId);
    if (survives) expect(second.anchorId).toBe(first.anchorId);
    else expect(second.anchorId).not.toBe(first.anchorId);
  });
});

describe('opening across a step', () => {
  it('starts from the cover a crease had before the step', () => {
    const half = fold(createPaper(), { a: vec(0.5, 0), b: vec(0.5, 1) }, 1).state;
    const topDown = fold(
      half,
      line(vec(0, 0.5), vec(1, 0.5)),
      sideOf(line(vec(0, 0.5), vec(1, 0.5)), vec(0.25, 1)),
    );
    const state = topDown.state;
    const all = hinges(state);
    const first = all.find((h) => Math.abs(h.a.x - 0.5) < 1e-9 && Math.abs(h.b.x - 0.5) < 1e-9);
    if (!first) throw new Error('first crease missing');
    expect(first.cover).toBe(4);
    const opening = 0.4;
    const animation = { previous: half, movedIds: new Set(topDown.movedIds), progress: 0 };
    const atStart = stepPose(state, opening, animation).angleOf?.(first) ?? 0;
    const atEnd = stepPose(state, opening).angleOf?.(first) ?? 0;
    // Two layers at the start: opened by the full amount; four at the end: by half.
    expect(Math.PI - Math.abs(atStart)).toBeCloseTo(opening);
    expect(Math.PI - Math.abs(atEnd)).toBeCloseTo(opening / 2);
  });
});

describe('the worker solver', () => {
  it('solves on this thread once the worker has failed', async () => {
    class FakeWorker extends EventTarget {
      posted = 0;
      postMessage(): void {
        this.posted++;
      }
      terminate(): void {
        return;
      }
    }
    const fake = new FakeWorker();
    const solver = new WorkerSolver(fake as unknown as Worker);
    const state = fold(createPaper(), { a: vec(0.5, 0), b: vec(0.5, 1) }, 1).state;
    const request = { stateId: 'a', state, opening: 0.1, thickness: 0 };
    const first = solver.solve(request);
    fake.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow('solver worker failed');
    const scene = await solver.solve(request);
    expect(scene.panels).toHaveLength(2);
    expect(fake.posted).toBe(1);
  });
});
