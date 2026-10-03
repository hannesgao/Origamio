import { describe, expect, it } from 'vitest';

import {
  type Vec,
  approxEqual,
  approxEqualVec,
  distance,
  line,
  sideOf,
  vec,
} from '../src/geometry';
import {
  type Crease,
  FoldHistory,
  createPaper,
  facetCount,
  foldedPoints,
  layersAt,
  maxLayers,
  topLayers,
} from '../src/paper';
import { cornerFolds, foldLeftRight, foldLeftRightAgain, foldTopBottom, run } from './presets';

const twoHalfFolds = () => {
  const history = new FoldHistory(createPaper());
  run(history, [foldLeftRight(), foldTopBottom()]);
  return history;
};

const creaseTouches = (crease: Crease, point: Vec, radius: number): boolean =>
  distance(crease.a, point) <= radius && distance(crease.b, point) <= radius;

describe('fold', () => {
  it('folding in half three times gives 8 facets and 8 layers', () => {
    const history = new FoldHistory(createPaper());
    run(history, [foldLeftRight(), foldTopBottom(), foldLeftRightAgain()]);
    expect(facetCount(history.state)).toBe(8);
    expect(maxLayers(history.state)).toBe(8);
    expect(history.state.foldCount).toBe(3);
    expect(layersAt(history.state, vec(0.1, 0.1))).toBe(8);
  });

  it('folding the loose corner after two half folds creases all four sheet corners', () => {
    const history = twoHalfFolds();
    run(history, [cornerFolds.loose()]);
    const state = history.state;
    expect(facetCount(state)).toBe(8);
    // One crease from the first fold, two from the second, four from the corner.
    expect(state.creases).toHaveLength(1 + 2 + 4);

    const corners = [vec(0, 0), vec(1, 0), vec(1, 1), vec(0, 1)];
    for (const corner of corners) {
      const near = state.creases.filter((c) => creaseTouches(c, corner, 0.25));
      expect(near, `crease near corner (${corner.x}, ${corner.y})`).toHaveLength(1);
    }
  });

  it('folding the corner where both folded edges meet creases a rhombus around the centre', () => {
    const history = twoHalfFolds();
    run(history, [cornerFolds.twoFoldedEdges()]);
    const state = history.state;
    expect(facetCount(state)).toBe(8);

    const centre = vec(0.5, 0.5);
    const creases = state.creases.slice(3);
    expect(creases).toHaveLength(4);
    const endpoints = creases.flatMap((c) => [c.a, c.b]);
    const d = distance(endpoints[0] as Vec, centre);
    const expectedVertices = [
      vec(0.5 + d, 0.5),
      vec(0.5 - d, 0.5),
      vec(0.5, 0.5 + d),
      vec(0.5, 0.5 - d),
    ];
    // Every crease endpoint is one of the four rhombus vertices, each used twice.
    for (const v of expectedVertices) {
      const hits = endpoints.filter((p) => approxEqualVec(p, v));
      expect(hits).toHaveLength(2);
    }
    // All four sides are equal, so the quadrilateral is a rhombus.
    const sideLength = distance(creases[0]?.a as Vec, creases[0]?.b as Vec);
    for (const c of creases) {
      expect(approxEqual(distance(c.a, c.b), sideLength)).toBe(true);
    }
  });

  it('folding only the top layer of the loose corner gives 5 facets', () => {
    const history = twoHalfFolds();
    run(history, [cornerFolds.loose(topLayers(1))]);
    expect(facetCount(history.state)).toBe(5);
    // The flipped corner lands on top of the four layers below it...
    expect(maxLayers(history.state)).toBe(5);
    // ...while the corner it came from now only has the three lower layers.
    expect(layersAt(history.state, vec(0.02, 0.02))).toBe(3);
  });

  it('undo restores exactly the state before the fold', () => {
    const history = twoHalfFolds();
    const before = history.state;
    const snapshot = structuredClone(before);

    run(history, [cornerFolds.oneFoldedEdge()]);
    expect(history.state).not.toBe(before);
    expect(facetCount(history.state)).toBe(8);

    expect(history.undo()).not.toBeNull();
    const after = history.state;
    expect(after).toBe(before);
    expect(after).toEqual(snapshot);
    expect(history.state.foldCount).toBe(2);
  });

  it('a fold that misses the sheet changes nothing', () => {
    const history = new FoldHistory(createPaper());
    const l = line(vec(2, 0), vec(2, 1));
    const result = history.fold(l, sideOf(l, vec(3, 0)));
    expect(result).toBeNull();
    expect(history.canUndo).toBe(false);
  });
});

describe('rectangular sheets', () => {
  it('creates a sheet of any size with the longer side as its scale', () => {
    const paper = createPaper(1, 0.75);
    expect(paper.width).toBe(1);
    expect(paper.height).toBe(0.75);
    expect(paper.size).toBe(1);
    expect(paper.facets[0]?.poly).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0.75 },
      { x: 0, y: 0.75 },
    ]);
    const tall = createPaper(0.5, 2);
    expect(tall.size).toBe(2);
  });

  it('folds a rectangle like a square', () => {
    const history = new FoldHistory(createPaper(1, 0.5));
    const step = foldLeftRight();
    const result = history.fold(step.line, step.side, step.layers);
    expect(result?.movedIds).toHaveLength(1);
    expect(facetCount(history.state)).toBe(2);
    expect(maxLayers(history.state)).toBe(2);
    expect(foldedPoints(history.state).every((p) => p.x <= 0.5 + 1e-9 && p.y <= 0.5 + 1e-9)).toBe(
      true,
    );
  });
});
