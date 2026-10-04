import { describe, expect, it } from 'vitest';

import { FoldHistory, createPaper } from '../src/paper';
import { DEFAULT_ORBIT, type StepAnimation, render3d } from '../src/view3d';
import { foldLeftRight, run } from './presets';

const polygons = (markup: string): string[] => markup.match(/<polygon[^>]*>/g) ?? [];
const ys = (polygon: string): number[] =>
  [...polygon.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
const edgeOn = { yaw: 0, pitch: Math.PI / 2, zoom: 1 };

/** A sheet folded in half once, with the animation of that step at `progress`. */
const halfFold = (progress: number, placement?: 'bottom'): [FoldHistory, StepAnimation] => {
  const history = new FoldHistory(createPaper());
  const previous = history.state;
  const step = foldLeftRight();
  const result = history.fold(step.line, step.side, placement ? { placement } : step.layers);
  if (!result) throw new Error('fold moved nothing');
  return [history, { previous, movedIds: new Set(result.movedIds), progress }];
};

describe('render3d', () => {
  it('draws one polygon per facet with the front colour when seen from above', () => {
    const view = render3d(createPaper(), { orbit: { yaw: 0, pitch: 0, zoom: 1 }, opening: 0 });
    const polys = polygons(view.markup);
    expect(polys).toHaveLength(1);
    expect(polys[0]).toContain('solid-front');
    expect(view.viewBox.split(' ')).toHaveLength(4);
  });

  it('shows the flap on top from above and the base from below', () => {
    const history = new FoldHistory(createPaper());
    run(history, [foldLeftRight()]);
    const above = polygons(render3d(history.state, { orbit: DEFAULT_ORBIT, opening: 0 }).markup);
    expect(above).toHaveLength(2);
    // The nearer panel is drawn last: from above that is the flipped flap, back up.
    expect(above[1]).toContain('solid-back');
    const below = polygons(
      render3d(history.state, { orbit: { yaw: 0, pitch: Math.PI, zoom: 1 }, opening: 0 }).markup,
    );
    // From behind the base is nearer, and its back is what we see.
    expect(below[1]).toContain('solid-back');
    expect(below[0]).toContain('solid-front');
  });

  it('opens the creases so the flap leaves the plane', () => {
    const history = new FoldHistory(createPaper());
    run(history, [foldLeftRight()]);
    const flat = polygons(render3d(history.state, { orbit: edgeOn, opening: 0 }).markup);
    const open = polygons(render3d(history.state, { orbit: edgeOn, opening: 0.3 }).markup);
    const height = (p: string): number => Math.max(...ys(p)) - Math.min(...ys(p));
    expect(height(flat[1] ?? '')).toBeLessThan(1e-3);
    expect(height(open[1] ?? '')).toBeGreaterThan(0.1);
  });

  it('swings the new crease from flat to folded while a step plays', () => {
    const [history, animation] = halfFold(0.5);
    const polys = polygons(
      render3d(history.state, { orbit: edgeOn, opening: 0, animation }).markup,
    );
    const moving = polys.find((p) => p.includes('facet-moving')) ?? '';
    // Half way through, the flap stands up: edge-on it spans its full width.
    expect(Math.max(...ys(moving)) - Math.min(...ys(moving))).toBeGreaterThan(0.4);
    const [done, finished] = halfFold(1);
    const flat = polygons(
      render3d(done.state, { orbit: edgeOn, opening: 0, animation: finished }).markup,
    );
    expect(flat.every((p) => Math.max(...ys(p)) - Math.min(...ys(p)) < 1e-3)).toBe(true);
  });

  it('swings a flap folded on the back under the sheet', () => {
    const [over, overAnimation] = halfFold(0.5);
    const [under, underAnimation] = halfFold(0.5, 'bottom');
    const top = (history: FoldHistory, animation: StepAnimation): number =>
      Math.min(
        ...ys(
          polygons(render3d(history.state, { orbit: edgeOn, opening: 0, animation }).markup).find(
            (p) => p.includes('facet-moving'),
          ) ?? '',
        ),
      );
    // Screen y grows downward: the flap going over reaches a smaller y than the one going under.
    expect(top(over, overAnimation)).toBeLessThan(top(under, underAnimation));
  });
});
