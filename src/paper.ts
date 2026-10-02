/**
 * The paper model: a sheet is a set of facets. Every facet keeps its polygon
 * in the coordinates of the original, unfolded sheet plus an affine transform
 * (a product of reflections) that places it in the current folded state.
 */
import {
  AREA_EPS,
  IDENTITY,
  type Line,
  type Mat,
  type Polygon,
  type Side,
  type Vec,
  add,
  apply,
  applyToLine,
  applyToPolygon,
  area,
  centroid,
  chord,
  clipPolygon,
  compose,
  containsPoint,
  intersectConvex,
  invert,
  lineNormal,
  orientCCW,
  reflection,
  scale,
  sideOf,
} from './geometry';

export interface Facet {
  readonly id: number;
  /** Convex polygon in the coordinate system of the unfolded sheet. */
  readonly poly: Polygon;
  /** Maps unfolded coordinates to the current folded position. */
  readonly transform: Mat;
  /** Layer index; larger values are closer to the viewer. */
  readonly z: number;
}

/** A crease segment in unfolded-sheet coordinates. */
export interface Crease {
  readonly a: Vec;
  readonly b: Vec;
}

export type LayerSelection =
  { readonly kind: 'all' } | { readonly kind: 'top'; readonly count: number };

export const ALL_LAYERS: LayerSelection = { kind: 'all' };
export const topLayers = (count: number): LayerSelection => ({ kind: 'top', count });

export interface PaperState {
  readonly size: number;
  readonly facets: readonly Facet[];
  readonly creases: readonly Crease[];
  readonly foldCount: number;
  readonly nextId: number;
}

export interface FoldResult {
  readonly state: PaperState;
  /** Facets whose transform changed in this fold (useful for animation). */
  readonly movedIds: readonly number[];
  readonly line: Line;
}

/** A fresh square sheet with its lower-left corner at the origin. */
export function createPaper(size = 1): PaperState {
  const square: Polygon = [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ];
  return {
    size,
    facets: [{ id: 0, poly: square, transform: IDENTITY, z: 0 }],
    creases: [],
    foldCount: 0,
    nextId: 1,
  };
}

/** The facet polygon in the current (folded) coordinate system. */
export const currentPolygon = (facet: Facet): Polygon =>
  applyToPolygon(facet.transform, facet.poly);

/** Whether the facet currently shows its back side. */
export const isFlipped = (facet: Facet): boolean =>
  facet.transform.a * facet.transform.d - facet.transform.b * facet.transform.c < 0;

export const facetCount = (state: PaperState): number => state.facets.length;

const overlaps = (p: Polygon, q: Polygon): boolean => area(intersectConvex(p, q)) > AREA_EPS;

/**
 * Ids of the facets that belong to the top `count` layers. A facet is in the
 * top k layers when fewer than k distinct layers lie above it at its position.
 */
export function selectTopLayers(state: PaperState, count: number): Set<number> {
  const polys = new Map(state.facets.map((f) => [f.id, orientCCW(currentPolygon(f))]));
  const selected = new Set<number>();
  for (const f of state.facets) {
    const mine = polys.get(f.id) as Polygon;
    const above = new Set<number>();
    for (const g of state.facets) {
      if (g.z <= f.z || above.has(g.z)) continue;
      if (overlaps(mine, polys.get(g.id) as Polygon)) above.add(g.z);
    }
    if (above.size < count) selected.add(f.id);
  }
  return selected;
}

function selectFacets(state: PaperState, layers: LayerSelection): Set<number> {
  if (layers.kind === 'all') return new Set(state.facets.map((f) => f.id));
  return selectTopLayers(state, Math.max(0, Math.floor(layers.count)));
}

/**
 * Fold the sheet along `line` (given in the current folded coordinates).
 * The half-plane on `side` of the directed line is flipped over onto the
 * other half. Only facets selected by `layers` take part.
 */
export function fold(
  state: PaperState,
  line: Line,
  side: Side,
  layers: LayerSelection = ALL_LAYERS,
): FoldResult {
  const selected = selectFacets(state, layers);
  const flip = reflection(line);
  // A probe point strictly on the moving side, in current coordinates.
  const probe = add(line.a, scale(lineNormal(line), side));

  const staying: Facet[] = [];
  const moving: Facet[] = [];
  const creases = [...state.creases];
  let nextId = state.nextId;

  for (const facet of state.facets) {
    if (!selected.has(facet.id)) {
      staying.push(facet);
      continue;
    }
    const toLocal = invert(facet.transform);
    const localLine = applyToLine(toLocal, line);
    const movingSide = sideOf(localLine, apply(toLocal, probe));
    const split = clipPolygon(facet.poly, localLine);
    const movingPoly = movingSide > 0 ? split.positive : split.negative;
    const stayingPoly = movingSide > 0 ? split.negative : split.positive;

    if (movingPoly.length === 0) {
      staying.push(facet);
    } else if (stayingPoly.length === 0) {
      moving.push({ ...facet, transform: compose(flip, facet.transform) });
    } else {
      staying.push({ ...facet, poly: stayingPoly });
      moving.push({
        id: nextId++,
        poly: movingPoly,
        transform: compose(flip, facet.transform),
        z: facet.z,
      });
      const segment = chord(facet.poly, localLine);
      if (segment) creases.push({ a: segment[0], b: segment[1] });
    }
  }

  if (moving.length === 0) {
    return { state, movedIds: [], line };
  }

  // Moved facets land on top of everything else with their layer order reversed.
  const topZ = staying.reduce((max, f) => Math.max(max, f.z), -1);
  const movedLayers = [...new Set(moving.map((f) => f.z))].sort((a, b) => b - a);
  const newZ = new Map(movedLayers.map((z, i) => [z, topZ + 1 + i]));
  const relocated = moving.map((f) => ({ ...f, z: newZ.get(f.z) as number }));

  const facets = [...staying, ...relocated].sort((a, b) => a.z - b.z || a.id - b.id);
  return {
    state: { ...state, facets, creases, foldCount: state.foldCount + 1, nextId },
    movedIds: relocated.map((f) => f.id),
    line,
  };
}

/** Number of facets stacked at a point of the folded sheet. */
export function layersAt(state: PaperState, point: Vec): number {
  let count = 0;
  for (const f of state.facets) {
    if (containsPoint(currentPolygon(f), point)) count++;
  }
  return count;
}

/** The largest number of facets stacked over any point of the folded sheet. */
export function maxLayers(state: PaperState): number {
  const polys = state.facets.map((f) => orientCCW(currentPolygon(f)));
  const n = polys.length;
  let best = 0;
  const search = (region: Polygon, start: number, depth: number): void => {
    if (depth > best) best = depth;
    for (let i = start; i < n; i++) {
      if (depth + (n - i) <= best) return;
      const inter = intersectConvex(region, polys[i] as Polygon);
      if (area(inter) > AREA_EPS) search(inter, i + 1, depth + 1);
    }
  };
  for (let i = 0; i < n; i++) {
    if (1 + (n - i - 1) <= best) break;
    search(polys[i] as Polygon, i + 1, 1);
  }
  return best;
}

/** Bounding box of the folded sheet, in current coordinates. */
export function foldedPoints(state: PaperState): Vec[] {
  return state.facets.flatMap((f) => [...currentPolygon(f)]);
}

/** Centre of the folded sheet (average of facet centroids weighted by area). */
export function foldedCentre(state: PaperState): Vec {
  let total = 0;
  let sum: Vec = { x: 0, y: 0 };
  for (const f of state.facets) {
    const poly = currentPolygon(f);
    const w = area(poly);
    sum = add(sum, scale(centroid(poly), w));
    total += w;
  }
  return total > 0 ? scale(sum, 1 / total) : sum;
}

/**
 * An undoable sequence of paper states. States are immutable, so undo simply
 * returns to the previous object.
 */
export class FoldHistory {
  private readonly states: PaperState[];

  constructor(initial: PaperState = createPaper()) {
    this.states = [initial];
  }

  get state(): PaperState {
    return this.states[this.states.length - 1] as PaperState;
  }

  get initial(): PaperState {
    return this.states[0] as PaperState;
  }

  get canUndo(): boolean {
    return this.states.length > 1;
  }

  /** Apply a fold; returns the result, or `null` when the fold changed nothing. */
  fold(line: Line, side: Side, layers: LayerSelection = ALL_LAYERS): FoldResult | null {
    const result = fold(this.state, line, side, layers);
    if (result.movedIds.length === 0) return null;
    this.states.push(result.state);
    return result;
  }

  undo(): PaperState {
    if (this.states.length > 1) this.states.pop();
    return this.state;
  }

  reset(): PaperState {
    this.states.length = 1;
    return this.state;
  }
}
