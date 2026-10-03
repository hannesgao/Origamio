import { describe, expect, it } from 'vitest';

import { type Polygon, line, sideOf, vec } from '../src/geometry';
import {
  FoldHistory,
  bottomLayers,
  createPaper,
  currentPolygon,
  facetsAt,
  maxLayers,
  selectBottomLayers,
  topLayers,
} from '../src/paper';
import { foldLeftRight, foldTopBottom } from './presets';

/** Two half folds: the four quadrants stacked on the lower-left one, Q1 at the bottom. */
const base = (): FoldHistory => {
  const history = new FoldHistory(createPaper());
  for (const s of [foldLeftRight(), foldTopBottom()]) history.fold(s.line, s.side, s.layers);
  return history;
};
const quadrant = (x: number, y: number): Polygon => [
  vec(x, y),
  vec(x + 0.5, y),
  vec(x + 0.5, y + 0.5),
  vec(x, y + 0.5),
];
const cornerFold = line(vec(0.2, 0), vec(0, 0.2));
/** The side of `cornerFold` that holds the sheet corner at the origin. */
const cornerSide = sideOf(cornerFold, vec(0, 0));
const zOf = (history: FoldHistory, id: number): number =>
  history.state.facets.find((f) => f.id === id)?.z ?? NaN;

describe('fold options', () => {
  it('selects bottom layers as the mirror image of top layers', () => {
    const history = base();
    const bottom = selectBottomLayers(history.state, 1);
    expect(bottom.size).toBe(1);
    const [id] = [...bottom] as [number];
    expect(zOf(history, id)).toBe(0);
    const result = history.fold(cornerFold, cornerSide, { layers: bottomLayers(1) });
    expect(result?.movedIds).toHaveLength(1);
    expect(base().fold(cornerFold, cornerSide, topLayers(1))?.movedIds).toHaveLength(1);
  });

  it('restricts a fold to facets inside an unfolded region or a folded window', () => {
    const history = base();
    // The quadrant of corner D (upper left) is the top layer after two half folds.
    const result = history.fold(cornerFold, cornerSide, { region: quadrant(0, 0.5) });
    expect(result?.movedIds).toHaveLength(1);
    const moved = history.state.facets.find((f) => f.id === result?.movedIds[0]);
    expect(moved?.poly.every((p) => p.y >= 0.5 - 1e-9)).toBe(true);
    // A window away from the corner selects nothing to cut.
    expect(history.fold(cornerFold, cornerSide, { window: quadrant(0.6, 0.6) })).toBeNull();
  });

  it('places moved facets beneath the stack for a fold made on the back', () => {
    const history = base();
    const result = history.fold(cornerFold, cornerSide, {
      layers: bottomLayers(1),
      placement: 'bottom',
    });
    const [id] = result?.movedIds as [number];
    expect(zOf(history, id)).toBe(0);
    // The corner piece now lies on the triangle between the crease and (0.2, 0.2).
    expect(facetsAt(history.state, vec(0.15, 0.15))).toHaveLength(5);
    expect(facetsAt(history.state, vec(0.05, 0.05))).toHaveLength(3);
    // Layers stay compact: 0 … n-1.
    const zs = [...new Set(history.state.facets.map((f) => f.z))].sort((a, b) => a - b);
    expect(zs).toEqual(zs.map((_, i) => i));
  });

  it('keeps an inside reverse fold between its own plies', () => {
    // Fold the sheet in half (two plies joined at x = 0.5), then push the
    // right-hand tip of both plies in between them.
    const history = new FoldHistory(createPaper());
    const half = line(vec(0.5, 0), vec(0.5, 1));
    history.fold(half, sideOf(half, vec(1, 0.5)));
    const before = history.state.facets.map((f) => f.id);
    const tip = line(vec(0.1, 0), vec(0.1, 1));
    const result = history.fold(tip, sideOf(tip, vec(0, 0.5)), { placement: 'inside' });
    expect(result?.movedIds).toHaveLength(2);
    const stayed = history.state.facets.filter((f) => before.includes(f.id)).map((f) => f.z);
    const moved = result?.movedIds.map((id) => zOf(history, id)) ?? [];
    expect(Math.min(...moved)).toBeGreaterThan(Math.min(...stayed));
    expect(Math.max(...moved)).toBeLessThan(Math.max(...stayed));
    expect(maxLayers(history.state)).toBe(4);
    expect(history.state.facets.every((f) => currentPolygon(f).length >= 3)).toBe(true);
  });
});
