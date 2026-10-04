import { describe, expect, it } from 'vitest';

import { FoldHistory, createPaper } from '../src/paper';
import { type StepAnimation, type Vec3, hingeOpening, hinges } from '../src/rigid';
import { buildMesh } from '../src/scene3d';
import { buildStamp } from '../src/ui';
import { solvedScene, viewRotation } from '../src/view3d';
import { foldLeftRight, foldLeftRightAgain, foldTopBottom, run } from './presets';

const zs = (points: readonly Vec3[]): number[] => points.map((p) => p.z);
const height = (points: readonly Vec3[]): number =>
  Math.max(...zs(points)) - Math.min(...zs(points));

/** A sheet folded in half once, with the animation of that step at `progress`. */
const halfFold = (progress: number, placement?: 'bottom'): [FoldHistory, StepAnimation] => {
  const history = new FoldHistory(createPaper());
  const previous = history.state;
  const step = foldLeftRight();
  const result = history.fold(step.line, step.side, placement ? { placement } : step.layers);
  if (!result) throw new Error('fold moved nothing');
  return [history, { previous, movedIds: new Set(result.movedIds), progress }];
};

describe('solvedScene', () => {
  it('places one panel per facet, flat, with only the sheet boundary as edges', () => {
    const scene = solvedScene(createPaper(), { opening: 0 });
    expect(scene.panels).toHaveLength(1);
    expect(height(scene.panels[0]?.points ?? [])).toBeLessThan(1e-9);
    expect(scene.edges).toHaveLength(4);
    expect(scene.reach).toBeGreaterThan(0.5);
  });

  it('opens the creases so the flap leaves the plane, and draws the crease once', () => {
    const history = new FoldHistory(createPaper());
    run(history, [foldLeftRight()]);
    const flat = solvedScene(history.state, { opening: 0 });
    const open = solvedScene(history.state, { opening: 0.3 });
    const flap = (s: typeof flat) => s.panels.find((p) => p.facet.z === 1);
    expect(height(flap(flat)?.points ?? [])).toBeLessThan(1e-3);
    expect(height(flap(open)?.points ?? [])).toBeGreaterThan(0.1);
    // Boundary: 3 outer edges of each half plus the crease, drawn once: 7.
    expect(open.edges).toHaveLength(7);
  });

  it('swings the new crease from flat to folded while a step plays', () => {
    const [history, animation] = halfFold(0.5);
    const mid = solvedScene(history.state, { opening: 0, animation });
    const moving = mid.panels.find((p) => animation.movedIds.has(p.facet.id));
    // Half way through, the flap stands up: its height is its full width.
    expect(height(moving?.points ?? [])).toBeGreaterThan(0.4);
    const [done, finished] = halfFold(1);
    const flat = solvedScene(done.state, { opening: 0, animation: finished });
    expect(flat.panels.every((p) => height(p.points) < 1e-3)).toBe(true);
  });

  it('swings a flap folded on the back under the sheet', () => {
    const [over, overAnimation] = halfFold(0.5);
    const [under, underAnimation] = halfFold(0.5, 'bottom');
    const top = (s: ReturnType<typeof solvedScene>, a: StepAnimation): number =>
      Math.max(...zs(s.panels.find((p) => a.movedIds.has(p.facet.id))?.points ?? []));
    expect(
      top(solvedScene(over.state, { opening: 0, animation: overAnimation }), overAnimation),
    ).toBeGreaterThan(0.3);
    expect(
      top(solvedScene(under.state, { opening: 0, animation: underAnimation }), underAnimation),
    ).toBeLessThan(1e-3);
  });
});

describe('viewRotation', () => {
  it('gives orthonormal rows and turns the picture with roll', () => {
    const plain = viewRotation({ yaw: 0.3, pitch: 0.7, roll: 0, zoom: 1 });
    const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
    for (const row of plain) expect(Math.hypot(row.x, row.y, row.z)).toBeCloseTo(1);
    expect(dot(plain[0], plain[1])).toBeCloseTo(0);
    expect(dot(plain[1], plain[2])).toBeCloseTo(0);
    // A quarter roll: what was screen right becomes screen up.
    const rolled = viewRotation({ yaw: 0.3, pitch: 0.7, roll: Math.PI / 2, zoom: 1 });
    expect(rolled[1].x).toBeCloseTo(plain[0].x);
    expect(rolled[1].y).toBeCloseTo(plain[0].y);
    expect(rolled[1].z).toBeCloseTo(plain[0].z);
    // Pitch 0 looks straight down at the sheet.
    const down = viewRotation({ yaw: 0, pitch: 0, roll: 0, zoom: 1 });
    expect(down[2]).toEqual({ x: 0, y: 0, z: 1 });
  });
});

describe('buildMesh', () => {
  const style = {
    front: '#e8923a',
    back: '#7a3f12',
    ink: '#000000',
    thickness: 0.01,
    shadow: true,
  };

  it('extrudes every facet into top, bottom and side triangles with its colours', () => {
    const scene = solvedScene(createPaper(), { opening: 0 });
    const built = buildMesh(scene, style, new Set());
    // A quad: 2 top + 2 bottom + 4 sides x 2 = 12 triangles.
    expect(built.triangleFacet).toHaveLength(12);
    expect(built.positions).toHaveLength(12 * 9);
    const topColour = [built.colours[0], built.colours[1], built.colours[2]];
    expect(topColour[0]).toBeGreaterThan(topColour[2] as number);
    const flat = buildMesh(scene, { ...style, thickness: 0 }, new Set());
    expect(flat.triangleFacet).toHaveLength(4);
  });

  it('lifts the colour of a highlighted facet', () => {
    const scene = solvedScene(createPaper(), { opening: 0 });
    const plain = buildMesh(scene, style, new Set());
    const lit = buildMesh(scene, style, new Set([0]));
    expect(lit.colours[0]).toBeGreaterThan(plain.colours[0] as number);
  });
});

describe('cover and the build stamp', () => {
  it('opens a crease in a thick stack less than one in a thin fold', () => {
    const thin = new FoldHistory(createPaper());
    run(thin, [foldLeftRight()]);
    const thick = new FoldHistory(createPaper());
    run(thick, [foldLeftRight(), foldTopBottom(), foldLeftRightAgain()]);
    const [single] = hinges(thin.state);
    if (!single) throw new Error('no hinge');
    expect(single.cover).toBe(2);
    expect(hingeOpening(single, 0.1)).toBeCloseTo(0.1);
    for (const h of hinges(thick.state)) {
      expect(h.cover).toBe(8);
      expect(hingeOpening(h, 0.1)).toBeCloseTo(0.025);
    }
  });

  it('stamps the build time in German local time to the minute', () => {
    expect(buildStamp('2026-10-03T21:03:45.000Z')).toBe('03.10.2026 23:03');
    expect(buildStamp('2026-01-15T10:30:00.000Z')).toBe('15.01.2026 11:30');
    expect(buildStamp('nonsense')).toBe('');
  });
});
