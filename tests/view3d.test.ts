import { describe, expect, it } from 'vitest';

import { FoldHistory, createPaper } from '../src/paper';
import { DEFAULT_ORBIT, render3d } from '../src/view3d';
import { foldLeftRight, run } from './presets';

const polygons = (markup: string): string[] => markup.match(/<polygon[^>]*>/g) ?? [];

describe('render3d', () => {
  it('draws one polygon per facet with the front colour when seen from above', () => {
    const view = render3d(createPaper(), { orbit: { yaw: 0, pitch: 0, zoom: 1 }, thickness: 0.01 });
    const polys = polygons(view.markup);
    expect(polys).toHaveLength(1);
    expect(polys[0]).toContain('solid-front');
    expect(view.viewBox.split(' ')).toHaveLength(4);
  });

  it('shows the back of the paper from below and paints flipped layers as back', () => {
    const history = new FoldHistory(createPaper());
    run(history, [foldLeftRight()]);
    const fromAbove = render3d(history.state, { orbit: DEFAULT_ORBIT, thickness: 0.01 });
    const above = polygons(fromAbove.markup);
    expect(above).toHaveLength(2);
    expect(above.filter((p) => p.includes('solid-back'))).toHaveLength(1);
    // Turned past the horizon the stack is seen from below: faces swap.
    const fromBelow = render3d(history.state, {
      orbit: { yaw: 0, pitch: Math.PI, zoom: 1 },
      thickness: 0.01,
    });
    const below = polygons(fromBelow.markup);
    expect(below.filter((p) => p.includes('solid-back'))).toHaveLength(1);
    // The nearer layer is drawn last: from above that is the flipped flap
    // (its back up); from below it is the bottom layer, showing its back too.
    expect(above[1]).toContain('solid-back');
    expect(below[0]).toContain('solid-front');
    expect(below[1]).toContain('solid-back');
  });

  it('lifts the moving flap off the table mid-flip', () => {
    const history = new FoldHistory(createPaper());
    const step = foldLeftRight();
    const result = history.fold(step.line, step.side, step.layers);
    expect(result).not.toBeNull();
    if (!result) return;
    const animation = { movedIds: new Set(result.movedIds), line: result.line, progress: 0.5 };
    const view = render3d(history.state, {
      orbit: { yaw: 0, pitch: Math.PI / 2, zoom: 1 },
      thickness: 0.01,
      animation,
    });
    const polys = polygons(view.markup);
    expect(polys.some((p) => p.includes('facet-moving'))).toBe(true);
    // Seen edge-on at pitch π/2, the flap standing up spans a visible height.
    const moving = polys.find((p) => p.includes('facet-moving')) ?? '';
    const ys = [...moving.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.4);
  });
});
