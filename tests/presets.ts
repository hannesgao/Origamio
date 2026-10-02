import { type Line, type Side, line, sideOf, vec } from '../src/geometry';
import { type LayerSelection, ALL_LAYERS, FoldHistory } from '../src/paper';

export interface FoldStep {
  readonly line: Line;
  readonly side: Side;
  readonly layers: LayerSelection;
}

/** A fold whose moving side is the one containing `movingPoint`. */
export const step = (
  a: [number, number],
  b: [number, number],
  movingPoint: [number, number],
  layers: LayerSelection = ALL_LAYERS,
): FoldStep => {
  const l = line(vec(a[0], a[1]), vec(b[0], b[1]));
  return { line: l, side: sideOf(l, vec(movingPoint[0], movingPoint[1])), layers };
};

/** Fold the right half over to the left: sheet becomes [0, 1/2] × [0, 1]. */
export const foldLeftRight = (): FoldStep => step([0.5, 0], [0.5, 1], [1, 0.5]);
/** Fold the top half down: sheet becomes [0, 1/2] × [0, 1/2]. */
export const foldTopBottom = (): FoldStep => step([0, 0.5], [1, 0.5], [0.25, 1]);
/** Fold the (already halved) sheet left over right again: [0, 1/4] × [0, 1/2]. */
export const foldLeftRightAgain = (): FoldStep => step([0.25, 0], [0.25, 1], [0.5, 0.25]);

/** After two half folds the sheet occupies [0, 1/2]²; these fold one of its corners. */
export const cornerFolds = {
  /** The loose corner at (0, 0), where the four original corners stack. */
  loose: (layers: LayerSelection = ALL_LAYERS): FoldStep =>
    step([0.2, 0], [0, 0.2], [0, 0], layers),
  /** The corner at (1/2, 1/2) where both folded edges meet (the sheet centre). */
  twoFoldedEdges: (layers: LayerSelection = ALL_LAYERS): FoldStep =>
    step([0.5, 0.3], [0.3, 0.5], [0.5, 0.5], layers),
  /** The corner at (1/2, 0) with one folded edge and one open edge. */
  oneFoldedEdge: (layers: LayerSelection = ALL_LAYERS): FoldStep =>
    step([0.3, 0], [0.5, 0.2], [0.5, 0], layers),
};

export function run(history: FoldHistory, steps: readonly FoldStep[]): void {
  for (const s of steps) history.fold(s.line, s.side, s.layers);
}
