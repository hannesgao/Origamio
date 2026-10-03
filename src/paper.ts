/**
 * The paper model: a sheet is a set of facets. Every facet keeps its polygon
 * in the coordinates of the original, unfolded sheet plus an affine transform
 * (a product of reflections) that places it in the current folded state.
 */
import {
  AREA_EPS,
  EPS,
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
  | { readonly kind: 'all' }
  | { readonly kind: 'top'; readonly count: number }
  | { readonly kind: 'bottom'; readonly count: number };

export const ALL_LAYERS: LayerSelection = { kind: 'all' };
export const topLayers = (count: number): LayerSelection => ({ kind: 'top', count });
export const bottomLayers = (count: number): LayerSelection => ({ kind: 'bottom', count });

/**
 * Where the moved facets land in the stack.
 * - `top`: on top of everything, order reversed (an ordinary valley fold seen
 *   from the front).
 * - `bottom`: beneath everything, order reversed (the same fold made on the
 *   back of the model).
 * - `inside`: between the layers they were cut from, order kept (an inside
 *   reverse fold: the tip is pushed in between its own two plies).
 */
export type Placement = 'top' | 'bottom' | 'inside';

export interface FoldOptions {
  readonly layers?: LayerSelection;
  /** Only facets whose unfolded polygon lies (by centroid) inside this convex region take part. */
  readonly region?: Polygon;
  /** Only facets whose folded polygon lies (by centroid) inside this convex window take part. */
  readonly window?: Polygon;
  readonly placement?: Placement;
}

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

/** Facets with fewer than `count` distinct layers below them. */
export function selectBottomLayers(state: PaperState, count: number): Set<number> {
  const polys = new Map(state.facets.map((f) => [f.id, orientCCW(currentPolygon(f))]));
  const selected = new Set<number>();
  for (const f of state.facets) {
    const mine = polys.get(f.id) as Polygon;
    const below = new Set<number>();
    for (const g of state.facets) {
      if (g.z >= f.z || below.has(g.z)) continue;
      if (overlaps(mine, polys.get(g.id) as Polygon)) below.add(g.z);
    }
    if (below.size < count) selected.add(f.id);
  }
  return selected;
}

function selectFacets(state: PaperState, options: FoldOptions): Set<number> {
  const layers = options.layers ?? ALL_LAYERS;
  let selected: Set<number>;
  if (layers.kind === 'all') selected = new Set(state.facets.map((f) => f.id));
  else if (layers.kind === 'top') {
    selected = selectTopLayers(state, Math.max(0, Math.floor(layers.count)));
  } else selected = selectBottomLayers(state, Math.max(0, Math.floor(layers.count)));
  const { region, window } = options;
  if (region || window) {
    for (const f of state.facets) {
      if (!selected.has(f.id)) continue;
      if (region && !containsPoint(region, centroid(f.poly))) selected.delete(f.id);
      else if (window && !containsPoint(window, centroid(currentPolygon(f)))) selected.delete(f.id);
    }
  }
  return selected;
}

/** Renumber the layers 0, 1, 2, … keeping their order. */
function compactLayers(facets: readonly Facet[]): Facet[] {
  const ranks = new Map<number, number>();
  for (const z of [...new Set(facets.map((f) => f.z))].sort((a, b) => a - b)) {
    ranks.set(z, ranks.size);
  }
  return facets.map((f) => ({ ...f, z: ranks.get(f.z) as number }));
}

/**
 * Fold the sheet along `line` (given in the current folded coordinates).
 * The half-plane on `side` of the directed line is flipped over onto the
 * other half. Only facets selected by `options` take part; a bare layer
 * selection is accepted as shorthand for `{ layers }`.
 */
export function fold(
  state: PaperState,
  line: Line,
  side: Side,
  options: LayerSelection | FoldOptions = ALL_LAYERS,
): FoldResult {
  const opts: FoldOptions = 'kind' in options ? { layers: options } : options;
  const selected = selectFacets(state, opts);
  const flip = reflection(line);
  // A probe point strictly on the moving side, in current coordinates.
  const probe = add(line.a, scale(lineNormal(line), side));

  const staying: Facet[] = [];
  const moving: Facet[] = [];
  /** Layers of the pieces that stayed behind when a selected facet was cut. */
  const cutLayers = new Set<number>();
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
      cutLayers.add(facet.z);
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

  const placement = opts.placement ?? 'top';
  const descending = [...new Set(moving.map((f) => f.z))].sort((a, b) => b - a);
  const newZ = new Map<number, number>();
  if (placement === 'inside' && cutLayers.size > 0) {
    // Keep the moved pieces in their order, just above the lowest layer they
    // were cut from, squeezed in before the next existing layer.
    const base = Math.min(...cutLayers);
    const ascending = [...descending].reverse();
    ascending.forEach((z, i) => newZ.set(z, base + (i + 1) / (ascending.length + 1)));
  } else if (placement === 'bottom') {
    // Flipped over beneath the stack: the old top of the group becomes its bottom.
    const bottomZ = staying.reduce((min, f) => Math.min(min, f.z), Infinity);
    const floor = Number.isFinite(bottomZ) ? bottomZ : 0;
    descending.forEach((z, i) => newZ.set(z, floor - descending.length + i));
  } else {
    // Flipped over on top of everything else with the layer order reversed.
    const topZ = staying.reduce((max, f) => Math.max(max, f.z), -1);
    descending.forEach((z, i) => newZ.set(z, topZ + 1 + i));
  }
  const relocated = moving.map((f) => ({ ...f, z: newZ.get(f.z) as number }));

  const facets = compactLayers([...staying, ...relocated].sort((a, b) => a.z - b.z || a.id - b.id));
  return {
    state: { ...state, facets, creases, foldCount: state.foldCount + 1, nextId },
    movedIds: relocated.map((f) => f.id),
    line,
  };
}

/** Number of facets stacked at a point of the folded sheet. */
/** Ids of the facets whose folded polygon contains `point`, bottom layer first. */
export function facetsAt(state: PaperState, point: Vec): number[] {
  return [...state.facets]
    .filter((f) => containsPoint(currentPolygon(f), point))
    .sort((a, b) => a.z - b.z)
    .map((f) => f.id);
}

export function layersAt(state: PaperState, point: Vec): number {
  return facetsAt(state, point).length;
}

/** Does the point lie strictly inside the convex polygon (counter-clockwise)? */
function strictlyInside(poly: Polygon, p: Vec, eps: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Vec;
    const b = poly[(i + 1) % poly.length] as Vec;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < EPS) continue;
    if ((ex * (p.y - a.y) - ey * (p.x - a.x)) / len <= eps) return false;
  }
  return true;
}

/** Intersection point of two segments, or null when they are parallel or do not meet. */
function segmentsMeet(a: Vec, b: Vec, c: Vec, d: Vec): Vec | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const q = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * q.y - r.y * q.x;
  if (Math.abs(denom) < EPS) return null;
  const w = { x: c.x - a.x, y: c.y - a.y };
  const t = (w.x * q.y - w.y * q.x) / denom;
  const u = (w.x * r.y - w.y * r.x) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

/**
 * The largest number of facets stacked over any point of the folded sheet.
 *
 * The depth is constant on every cell of the arrangement of facet edges, and
 * the deepest cell has a vertex. At every arrangement vertex the cells around
 * it are separated by the edges through it, so probing a little way along the
 * bisector of each pair of neighbouring edge directions visits every cell.
 */
export function maxLayers(state: PaperState): number {
  const polys = state.facets.map((f) => orientCCW(currentPolygon(f)));
  const probeDistance = state.size * 1e-6;
  const depthAt = (p: Vec): number => {
    let depth = 0;
    for (const poly of polys) if (strictlyInside(poly, p, probeDistance / 4)) depth++;
    return depth;
  };

  const segments: [Vec, Vec][] = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      segments.push([poly[i] as Vec, poly[(i + 1) % poly.length] as Vec]);
    }
  }
  const vertices: Vec[] = [];
  const key = (p: Vec): string => `${Math.round(p.x / EPS)}:${Math.round(p.y / EPS)}`;
  const seen = new Set<string>();
  const addVertex = (p: Vec): void => {
    const k = key(p);
    if (seen.has(k)) return;
    seen.add(k);
    vertices.push(p);
  };
  for (const [a, b] of segments) {
    addVertex(a);
    addVertex(b);
  }
  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i] as [Vec, Vec];
    for (let j = i + 1; j < segments.length; j++) {
      const [c, d] = segments[j] as [Vec, Vec];
      const p = segmentsMeet(a, b, c, d);
      if (p) addVertex(p);
    }
  }

  let best = 0;
  for (const poly of polys) best = Math.max(best, depthAt(centroid(poly)));
  const onSegment = (p: Vec, a: Vec, b: Vec): boolean => {
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) > 1e-9 * state.size) return false;
    const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
    return dot >= -EPS && dot <= (b.x - a.x) ** 2 + (b.y - a.y) ** 2 + EPS;
  };
  for (const v of vertices) {
    const angles: number[] = [];
    for (const [a, b] of segments) {
      if (!onSegment(v, a, b)) continue;
      const near = (q: Vec): boolean => Math.hypot(q.x - v.x, q.y - v.y) < probeDistance;
      if (!near(b)) angles.push(Math.atan2(b.y - v.y, b.x - v.x));
      if (!near(a)) angles.push(Math.atan2(a.y - v.y, a.x - v.x));
    }
    if (angles.length === 0) continue;
    angles.sort((x, y) => x - y);
    const distinct = angles.filter((t, i) => i === 0 || t - (angles[i - 1] as number) > 1e-9);
    for (let i = 0; i < distinct.length; i++) {
      const t0 = distinct[i] as number;
      const t1 =
        i + 1 < distinct.length
          ? (distinct[i + 1] as number)
          : (distinct[0] as number) + 2 * Math.PI;
      const mid = (t0 + t1) / 2;
      const p = { x: v.x + Math.cos(mid) * probeDistance, y: v.y + Math.sin(mid) * probeDistance };
      best = Math.max(best, depthAt(p));
    }
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
  fold(
    line: Line,
    side: Side,
    options: LayerSelection | FoldOptions = ALL_LAYERS,
  ): FoldResult | null {
    const result = fold(this.state, line, side, options);
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
