import { describe, expect, it } from 'vitest';

import { vec } from '../src/geometry';
import { FoldHistory, createPaper, facetsAt, layersAt } from '../src/paper';
import {
  LAYER_SHEAR,
  LAYER_SQUASH,
  LAYER_VIEW_ASPECT,
  VIEW_PADDING,
  projectLayer,
  renderLayers,
} from '../src/render';
import { foldLeftRight, foldTopBottom } from './presets';

const folded = (): FoldHistory => {
  const history = new FoldHistory(createPaper());
  for (const step of [foldLeftRight(), foldTopBottom()]) {
    history.fold(step.line, step.side, step.layers);
  }
  return history;
};

describe('facetsAt', () => {
  it('lists the facets under a point, bottom layer first', () => {
    const state = folded().state;
    const ids = facetsAt(state, vec(0.25, 0.25));
    expect(ids).toHaveLength(4);
    expect(layersAt(state, vec(0.25, 0.25))).toBe(4);
    const zs = ids.map((id) => state.facets.find((f) => f.id === id)?.z);
    expect([...zs].sort((a, b) => Number(a) - Number(b))).toEqual(zs);
    expect(facetsAt(state, vec(0.75, 0.75))).toEqual([]);
  });
});

describe('layer view', () => {
  it('projects model points obliquely and lifts higher layers', () => {
    expect(projectLayer(vec(0, 0), 0, 0.1, 1)).toEqual({ x: 0, y: LAYER_SQUASH });
    expect(projectLayer(vec(1, 1), 0, 0.1, 1)).toEqual({ x: 1 + LAYER_SHEAR, y: 0 });
    expect(projectLayer(vec(0, 0), 2, 0.1, 1).y).toBeCloseTo(LAYER_SQUASH - 0.2);
  });

  it('draws every facet with its id and frames them at the view aspect', () => {
    const view = renderLayers(folded().state, { lift: 0.05 });
    expect(view.markup.match(/<polygon /g)).toHaveLength(4);
    expect(view.markup).toContain('data-id="');
    const [, , w, h] = view.viewBox.split(' ').map(Number) as [number, number, number, number];
    expect(w / h).toBeCloseTo(LAYER_VIEW_ASPECT);
    const square = renderLayers(folded().state, { lift: 0.05, aspect: 1 });
    const [, , sw, sh] = square.viewBox.split(' ').map(Number) as [number, number, number, number];
    expect(sw / sh).toBeCloseTo(1);
    // The flat sheet projects to a parallelogram 1.5 wide and 0.5 high.
    const flat = renderLayers(createPaper(), { lift: 0.05 });
    const [x, y, fw, fh] = flat.viewBox.split(' ').map(Number) as [number, number, number, number];
    expect(fw).toBeCloseTo(1 + LAYER_SHEAR + 2 * VIEW_PADDING);
    expect(fh).toBeCloseTo(fw / LAYER_VIEW_ASPECT);
    expect(x).toBeCloseTo(-VIEW_PADDING);
    expect(y + fh / 2).toBeCloseTo(LAYER_SQUASH / 2);
  });
});
