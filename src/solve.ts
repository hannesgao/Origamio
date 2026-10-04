/**
 * A small position-based solver that turns the rigid walk of `placePanels`
 * into a sheet that holds together: every facet keeps its shape, facets
 * joined at a crease share their edge, and each crease is pulled towards
 * its target dihedral angle. Where the targets contradict each other (the
 * wings and the body of a crane form a loop) the sheet settles on a
 * compromise, the way paper gives a little, instead of showing a gap.
 */
import {
  type Mat,
  type Polygon,
  type Vec,
  apply,
  centroid,
  cross,
  distance,
  intersectConvex,
  invert,
  signedArea,
  sub,
} from './geometry';
import { type Facet, type PaperState, currentPolygon, isFlipped } from './paper';
import {
  type Hinge,
  type Panel,
  type PoseOptions,
  type Vec3,
  anchorFacet,
  placePanels,
} from './rigid';

export interface SolveOptions extends PoseOptions {
  /** Gauss-Seidel sweeps over all constraints. */
  readonly iterations?: number;
  /** Stop early when no vertex moved more than this in a sweep, in sheet units. */
  readonly tolerance?: number;
  /** How hard creases pull towards their angle, 0 to 1. */
  readonly bendStiffness?: number;
  /**
   * Thickness of the paper, in sheet units. Where one facet lies on another
   * in the flat model it is kept at least this far above it, in that order;
   * zero still keeps the order.
   */
  readonly thickness?: number;
  /** Sweeps at the end with the creases free, so that facets are rigid and layers in order. */
  readonly settle?: number;
  /** Vertex positions to start from (a previous solution), by facet id and vertex index. */
  readonly warm?: ReadonlyMap<number, readonly Vec3[]>;
  /**
   * Keep the root facet (the one the rigid walk started from) exactly where
   * the walk put it, so the sheet does not drift or turn while it settles.
   * On by default.
   */
  readonly anchor?: boolean;
}

export interface Solved {
  readonly panels: Panel[];
  /** Largest remaining violation of a length or layer-order constraint, in sheet units. */
  readonly residual: number;
  /** Positions to warm-start the next solve from. */
  readonly positions: ReadonlyMap<number, readonly Vec3[]>;
}

interface Mesh {
  /** Every facet's polygon with hinge endpoints inserted as extra (collinear) vertices. */
  readonly polys: Map<number, Vec[]>;
  /** Index into `vertices` for each facet vertex. */
  readonly index: Map<number, number[]>;
  /** Rest length pairs within facets. */
  readonly lengths: { i: number; j: number; rest: number }[];
  /** Crease constraints: edge (i, j), one off-edge vertex on each side. */
  readonly bends: { i: number; j: number; k: number; l: number; hinge: Hinge }[];
  /** Layer constraints: where one facet lies directly on another in the flat model. */
  readonly overlaps: Overlap[];
  readonly count: number;
}

/**
 * A point of the sheet where facet `over` lies directly on facet `under`:
 * the same spot on each, as weights on three of the facet's mesh vertices
 * (a non-degenerate triangle of it, in the polygon's winding).
 */
interface Overlap {
  readonly underId: number;
  readonly overId: number;
  readonly under: readonly [number, number, number];
  readonly underW: readonly [number, number, number];
  readonly underFlipped: boolean;
  readonly over: readonly [number, number, number];
  readonly overW: readonly [number, number, number];
  readonly overFlipped: boolean;
}

/** The point as weights on a non-degenerate fan triangle of the polygon, if it lies inside. */
function onTriangle(
  poly: readonly Vec[],
  ids: readonly number[],
  p: Vec,
  tolerance: number,
): { tri: [number, number, number]; w: [number, number, number] } | null {
  const o = poly[0] as Vec;
  for (let k = 1; k + 1 < poly.length; k++) {
    const a = poly[k] as Vec;
    const b = poly[k + 1] as Vec;
    const area = cross(sub(a, o), sub(b, o));
    if (Math.abs(area) < tolerance * tolerance) continue;
    const w1 = cross(sub(p, o), sub(b, o)) / area;
    const w2 = cross(sub(a, o), sub(p, o)) / area;
    const w0 = 1 - w1 - w2;
    const slack = -1e-6;
    if (w0 < slack || w1 < slack || w2 < slack) continue;
    const clamp = (w: number): number => Math.max(0, w);
    const sum = clamp(w0) + clamp(w1) + clamp(w2);
    return {
      tri: [ids[0] as number, ids[k] as number, ids[k + 1] as number],
      w: [clamp(w0) / sum, clamp(w1) / sum, clamp(w2) / sum],
    };
  }
  return null;
}

/** Whether `p` lies inside the polygon by more than `margin` (not on its edge). */
function wellInside(poly: Polygon, p: Vec, margin: number): boolean {
  if (poly.length < 3) return false;
  const sign = signedArea(poly) >= 0 ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Vec;
    const b = poly[(i + 1) % poly.length] as Vec;
    const len = distance(a, b);
    if (len < 1e-12) continue;
    if ((sign * cross(sub(b, a), sub(p, a))) / len <= margin) return false;
  }
  return true;
}

/**
 * Where facets lie on one another in the flat model: for every pair that
 * overlaps, the corners and centre of the overlap, each kept only where no
 * third facet lies between the two there, so that each layer is tied to
 * the one directly beneath it.
 */
function findOverlaps(state: PaperState, mesh: Omit<Mesh, 'overlaps'>): Overlap[] {
  const tolerance = 1e-6 * state.size;
  const facets = [...state.facets].sort((a, b) => a.z - b.z);
  const folded = facets.map((f) => currentPolygon(f));
  const inverse = facets.map((f) => invert(f.transform));
  const flipped = facets.map((f) => isFlipped(f));
  const overlaps: Overlap[] = [];
  for (let i = 0; i < facets.length; i++) {
    for (let j = i + 1; j < facets.length; j++) {
      const region = intersectConvex(folded[i] as Polygon, folded[j] as Polygon);
      if (Math.abs(signedArea(region)) < tolerance * tolerance * 100) continue;
      const under = facets[i] as Facet;
      const over = facets[j] as Facet;
      const samples = [...region, centroid(region)];
      for (const s of samples) {
        // A facet between the two at this spot ties each of them to itself instead.
        let between = false;
        for (let k = i + 1; k < j && !between; k++) {
          between = wellInside(folded[k] as Polygon, s, -tolerance);
        }
        if (between) continue;
        const onUnder = onTriangle(
          mesh.polys.get(under.id) as Vec[],
          mesh.index.get(under.id) as number[],
          apply(inverse[i] as Mat, s),
          tolerance,
        );
        const onOver = onTriangle(
          mesh.polys.get(over.id) as Vec[],
          mesh.index.get(over.id) as number[],
          apply(inverse[j] as Mat, s),
          tolerance,
        );
        if (!onUnder || !onOver) continue;
        // The same welded vertices on both sides (a shared crease): nothing to keep apart.
        const used = (t: readonly number[], w: readonly number[]): string =>
          t
            .filter((_, n) => (w[n] as number) > 1e-9)
            .sort((a, b) => a - b)
            .join(',');
        if (used(onUnder.tri, onUnder.w) === used(onOver.tri, onOver.w)) continue;
        overlaps.push({
          underId: under.id,
          overId: over.id,
          under: onUnder.tri,
          underW: onUnder.w,
          underFlipped: flipped[i] as boolean,
          over: onOver.tri,
          overW: onOver.w,
          overFlipped: flipped[j] as boolean,
        });
      }
    }
  }
  return overlaps;
}

/** How much softer a crease folded flat pulls than one folded to a given angle. */
const FLAT_CREASE_GIVE = 0.3;
/** Sweeps at the end with the creases free, so that facets are rigid and layers in order. */
const SETTLE_SWEEPS = 12;

const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const len3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const norm3 = (a: Vec3): Vec3 => {
  const l = len3(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** Insert `p` into the polygon if it lies on an edge and is not a vertex yet. */
function insertOnEdge(poly: Vec[], p: Vec, tolerance: number): void {
  if (poly.some((v) => distance(v, p) < tolerance)) return;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Vec;
    const b = poly[(i + 1) % poly.length] as Vec;
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const len = Math.hypot(ab.x, ab.y);
    if (len < tolerance) continue;
    const t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (len * len);
    if (t <= 0 || t >= 1) continue;
    const foot = { x: a.x + ab.x * t, y: a.y + ab.y * t };
    if (distance(foot, p) < tolerance) {
      poly.splice(i + 1, 0, p);
      return;
    }
  }
}

class Welds {
  private readonly parent: number[] = [];
  make(): number {
    this.parent.push(this.parent.length);
    return this.parent.length - 1;
  }
  find(i: number): number {
    let r = i;
    while (this.parent[r] !== r) r = this.parent[r] as number;
    let c = i;
    while (this.parent[c] !== r) {
      const next = this.parent[c] as number;
      this.parent[c] = r;
      c = next;
    }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

// States are immutable, so a mesh built for one can be kept with it.
const meshCache = new WeakMap<PaperState, { hinges: readonly Hinge[]; mesh: Mesh }>();

/** The constraint mesh of a sheet: facets with hinge endpoints as vertices, welded along hinges. */
function buildMesh(state: PaperState, hinges: readonly Hinge[]): Mesh {
  const cached = meshCache.get(state);
  if (cached && cached.hinges === hinges) return cached.mesh;
  const mesh = buildMeshUncached(state, hinges);
  meshCache.set(state, { hinges, mesh });
  return mesh;
}

function buildMeshUncached(state: PaperState, hinges: readonly Hinge[]): Mesh {
  const tolerance = 1e-6 * state.size;
  const polys = new Map<number, Vec[]>();
  for (const f of state.facets)
    polys.set(
      f.id,
      f.poly.map((p) => ({ ...p })),
    );
  for (const h of hinges) {
    for (const id of [h.p, h.q]) {
      const poly = polys.get(id);
      if (!poly) continue;
      insertOnEdge(poly, h.a, tolerance);
      insertOnEdge(poly, h.b, tolerance);
    }
  }
  const welds = new Welds();
  const index = new Map<number, number[]>();
  for (const [id, poly] of polys)
    index.set(
      id,
      poly.map(() => welds.make()),
    );
  const vertexAt = (id: number, p: Vec): number => {
    const poly = polys.get(id) as Vec[];
    const ids = index.get(id) as number[];
    const i = poly.findIndex((v) => distance(v, p) < tolerance);
    return i >= 0 ? (ids[i] as number) : -1;
  };
  for (const h of hinges) {
    for (const end of [h.a, h.b]) {
      const vp = vertexAt(h.p, end);
      const vq = vertexAt(h.q, end);
      if (vp >= 0 && vq >= 0) welds.union(vp, vq);
    }
  }
  // Compact vertex ids.
  const compact = new Map<number, number>();
  for (const ids of index.values()) {
    for (let i = 0; i < ids.length; i++) {
      const root = welds.find(ids[i] as number);
      let c = compact.get(root);
      if (c === undefined) {
        c = compact.size;
        compact.set(root, c);
      }
      ids[i] = c;
    }
  }
  const lengths: Mesh['lengths'] = [];
  for (const [id, poly] of polys) {
    const ids = index.get(id) as number[];
    for (let i = 0; i < poly.length; i++) {
      for (let j = i + 1; j < poly.length; j++) {
        const a = ids[i] as number;
        const b = ids[j] as number;
        if (a === b) continue;
        lengths.push({ i: a, j: b, rest: distance(poly[i] as Vec, poly[j] as Vec) });
      }
    }
  }
  const bends: Mesh['bends'] = [];
  const offEdge = (id: number, a: Vec, b: Vec): number => {
    const poly = polys.get(id) as Vec[];
    const ids = index.get(id) as number[];
    let best = -1;
    let bestDist = 0;
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const len = Math.hypot(ab.x, ab.y) || 1;
    poly.forEach((v, i) => {
      const d = Math.abs((ab.x * (v.y - a.y) - ab.y * (v.x - a.x)) / len);
      if (d > bestDist) {
        bestDist = d;
        best = ids[i] as number;
      }
    });
    return best;
  };
  for (const h of hinges) {
    const i = vertexAt(h.p, h.a);
    const j = vertexAt(h.p, h.b);
    const k = offEdge(h.p, h.a, h.b);
    const l = offEdge(h.q, h.a, h.b);
    if (i < 0 || j < 0 || k < 0 || l < 0 || i === j) continue;
    bends.push({ i, j, k, l, hinge: h });
  }
  const partial = { polys, index, lengths, bends, count: compact.size };
  return { ...partial, overlaps: findOverlaps(state, partial) };
}

/**
 * Keep the point where `over` lies on `under` at least `thickness` above
 * it, along the stack's up direction there. Returns the correction applied.
 */
function separationConstraint(
  pos: Vec3[],
  c: Overlap,
  thickness: number,
  pinned: ReadonlySet<number>,
): number {
  const at = (tri: readonly [number, number, number], w: readonly [number, number, number]): Vec3 =>
    add3(
      add3(mul3(pos[tri[0]] as Vec3, w[0]), mul3(pos[tri[1]] as Vec3, w[1])),
      mul3(pos[tri[2]] as Vec3, w[2]),
    );
  const upOf = (tri: readonly [number, number, number], flipped: boolean): Vec3 => {
    const o = pos[tri[0]] as Vec3;
    const n = cross3(sub3(pos[tri[1]] as Vec3, o), sub3(pos[tri[2]] as Vec3, o));
    return flipped ? mul3(n, -1) : n;
  };
  const p = at(c.under, c.underW);
  const q = at(c.over, c.overW);
  let up = add3(norm3(upOf(c.under, c.underFlipped)), norm3(upOf(c.over, c.overFlipped)));
  if (len3(up) < 1e-9) up = upOf(c.under, c.underFlipped);
  up = norm3(up);
  const gap = dot3(sub3(q, p), up) - thickness;
  if (gap >= 0) return 0;
  let sum = 0;
  for (let n = 0; n < 3; n++) {
    const wu = c.underW[n] as number;
    const wo = c.overW[n] as number;
    if (!pinned.has(c.under[n] as number)) sum += wu * wu;
    if (!pinned.has(c.over[n] as number)) sum += wo * wo;
  }
  if (sum < 1e-12) return 0;
  const lambda = -gap / sum;
  for (let n = 0; n < 3; n++) {
    const o = c.over[n] as number;
    const u = c.under[n] as number;
    if (!pinned.has(o)) pos[o] = add3(pos[o] as Vec3, mul3(up, lambda * (c.overW[n] as number)));
    if (!pinned.has(u)) pos[u] = sub3(pos[u] as Vec3, mul3(up, lambda * (c.underW[n] as number)));
  }
  return -gap;
}

/**
 * Solve the sheet for the given hinge angles. Starts from the rigid walk (or
 * a warm start) and relaxes lengths and crease angles together.
 */
export function solveSheet(
  state: PaperState,
  hinges: readonly Hinge[],
  options: SolveOptions = {},
): Solved {
  const mesh = buildMesh(state, hinges);
  const angleOf = options.angleOf ?? ((h: Hinge): number => h.shown);
  const iterations = options.iterations ?? 60;
  const tolerance = options.tolerance ?? 1e-5 * state.size;
  const bendStiffness = options.bendStiffness ?? 0.5;
  const thickness = options.thickness ?? 0;
  const settle = options.settle ?? SETTLE_SWEEPS;
  const inFlight = options.moved;

  // Initial positions: the rigid walk, averaged where welded vertices disagree.
  const start = placePanels(state, hinges, options);
  const byId = new Map(start.map((p) => [p.facet.id, p]));
  // The anchored facet: the walk's root, or the lowest largest facet it chose.
  const rootId = options.rootId ?? anchorFacet(state)?.id;
  const pinned = new Set<number>();
  if (options.anchor !== false && rootId !== undefined) {
    for (const vi of mesh.index.get(rootId) ?? []) pinned.add(vi);
  }
  const pos: Vec3[] = Array.from({ length: mesh.count }, () => ({ x: 0, y: 0, z: 0 }));
  const weight = new Array<number>(mesh.count).fill(0);
  for (const [id, poly] of mesh.polys) {
    const ids = mesh.index.get(id) as number[];
    const warm = options.warm?.get(id);
    const panel = byId.get(id);
    poly.forEach((v, i) => {
      const vi = ids[i] as number;
      let p: Vec3 | undefined = warm?.[i];
      if (!p && panel) p = pointOnPanel(panel, v);
      if (!p) return;
      pos[vi] = add3(pos[vi] as Vec3, p);
      weight[vi] = (weight[vi] as number) + 1;
    });
  }
  for (let i = 0; i < mesh.count; i++) {
    const w = weight[i] as number;
    if (w > 0) pos[i] = mul3(pos[i] as Vec3, 1 / w);
  }

  const lengthSweep = (): number => {
    let moved = 0;
    for (const c of mesh.lengths) {
      const a = pos[c.i] as Vec3;
      const b = pos[c.j] as Vec3;
      const d = sub3(b, a);
      const l = len3(d);
      if (l < 1e-12) continue;
      const wa = pinned.has(c.i) ? 0 : 1;
      const wb = pinned.has(c.j) ? 0 : 1;
      if (wa + wb === 0) continue;
      const corr = mul3(d, (l - c.rest) / l / (wa + wb));
      pos[c.i] = add3(a, mul3(corr, wa));
      pos[c.j] = sub3(b, mul3(corr, wb));
      moved = Math.max(moved, len3(corr));
    }
    return moved;
  };
  const separationSweep = (): number => {
    let moved = 0;
    for (const c of mesh.overlaps) {
      // A flap in flight has no settled order against the rest of the sheet.
      if (inFlight && inFlight.has(c.underId) !== inFlight.has(c.overId)) continue;
      moved = Math.max(moved, separationConstraint(pos, c, thickness, pinned));
    }
    return moved;
  };

  // Creases pull towards their angles while lengths and layer order are kept;
  // a crease folded flat is a soft preference (its opening is a guess), a
  // crease given an angle is firmer.
  for (let sweep = 0; sweep < iterations; sweep++) {
    let moved = lengthSweep();
    for (const c of mesh.bends) {
      const shown = angleOf(c.hinge);
      const target = Math.PI - Math.abs(shown);
      const firm = Math.abs(c.hinge.shown) < Math.PI - 1e-9;
      const stiffness = firm ? bendStiffness : bendStiffness * FLAT_CREASE_GIVE;
      moved = Math.max(moved, bendConstraint(pos, c.i, c.j, c.k, c.l, target, stiffness, pinned));
    }
    moved = Math.max(moved, separationSweep());
    if (moved < tolerance) break;
  }
  // Then let the sheet settle with its creases free: facets rigid, layers in order.
  let residual = 0;
  for (let sweep = 0; sweep < settle; sweep++) {
    residual = Math.max(lengthSweep(), separationSweep());
    if (residual < tolerance) break;
  }

  const positions = new Map<number, Vec3[]>();
  const panels: Panel[] = [];
  for (const f of state.facets) {
    const poly = mesh.polys.get(f.id) as Vec[];
    const ids = mesh.index.get(f.id) as number[];
    const solved = ids.map((vi) => pos[vi] as Vec3);
    positions.set(f.id, solved);
    // Report the facet's own corners (not the inserted hinge endpoints).
    const points = f.poly.map((corner) => {
      const i = poly.findIndex((v) => distance(v, corner) < 1e-9);
      return solved[i >= 0 ? i : 0] as Vec3;
    });
    panels.push({ facet: f, points, normal: facetNormal(points) });
  }
  return { panels, residual, positions };
}

/** Where a point of the facet's unfolded polygon sits on the placed panel. */
function pointOnPanel(panel: Panel, p: Vec): Vec3 {
  const poly = panel.facet.poly;
  // Barycentric-free: express p in the frame of the first corner and two edges.
  const o = poly[0] as Vec;
  const u = { x: (poly[1] as Vec).x - o.x, y: (poly[1] as Vec).y - o.y };
  const c = centroid(poly);
  const v = { x: c.x - o.x, y: c.y - o.y };
  const det = u.x * v.y - u.y * v.x;
  const O = panel.points[0] as Vec3;
  const U = sub3(panel.points[1] as Vec3, O);
  const C = panel.points.reduce((s, q) => add3(s, q), { x: 0, y: 0, z: 0 });
  const V = sub3(mul3(C, 1 / panel.points.length), O);
  if (Math.abs(det) < 1e-12) return O;
  const d = { x: p.x - o.x, y: p.y - o.y };
  const s = (d.x * v.y - d.y * v.x) / det;
  const t = (u.x * d.y - u.y * d.x) / det;
  return add3(O, add3(mul3(U, s), mul3(V, t)));
}

function facetNormal(points: readonly Vec3[]): Vec3 {
  let n: Vec3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Vec3;
    const b = points[(i + 1) % points.length] as Vec3;
    n = add3(n, cross3(a, b));
  }
  return norm3(n);
}

/**
 * The bending constraint of Müller et al. (2007) on the edge (i, j) with
 * off-edge vertices k and l: the angle between the two triangle normals is
 * driven towards `target` (π when the two lie flat in one plane, 0 when
 * folded onto each other). Returns the largest correction applied.
 */
function bendConstraint(
  pos: Vec3[],
  i: number,
  j: number,
  k: number,
  l: number,
  target: number,
  stiffness: number,
  pinned: ReadonlySet<number>,
): number {
  const p1 = pos[i] as Vec3;
  const p2 = sub3(pos[j] as Vec3, p1);
  const p3 = sub3(pos[k] as Vec3, p1);
  const p4 = sub3(pos[l] as Vec3, p1);
  const n1raw = cross3(p2, p3);
  const n2raw = cross3(p2, p4);
  const l1 = len3(n1raw);
  const l2 = len3(n2raw);
  if (l1 < 1e-12 || l2 < 1e-12) return 0;
  const n1 = mul3(n1raw, 1 / l1);
  const n2 = mul3(n2raw, 1 / l2);
  const d = Math.max(-1, Math.min(1, dot3(n1, n2)));
  const q3 = mul3(add3(cross3(p2, n2), mul3(cross3(n1, p2), d)), 1 / l1);
  const q4 = mul3(add3(cross3(p2, n1), mul3(cross3(n2, p2), d)), 1 / l2);
  const q2 = add3(
    mul3(add3(cross3(p3, n2), mul3(cross3(n1, p3), d)), -1 / l1),
    mul3(add3(cross3(p4, n1), mul3(cross3(n2, p4), d)), -1 / l2),
  );
  const q1 = mul3(add3(add3(q2, q3), q4), -1);
  const w = [i, j, k, l].map((v) => (pinned.has(v) ? 0 : 1)) as [number, number, number, number];
  const sum = w[0] * dot3(q1, q1) + w[1] * dot3(q2, q2) + w[2] * dot3(q3, q3) + w[3] * dot3(q4, q4);
  if (sum < 1e-12) return 0;
  const sinD = Math.sqrt(Math.max(0, 1 - d * d));
  if (sinD < 1e-9) {
    // Normals (anti)parallel: the gradient vanishes; nudge the off-edge vertex instead.
    const want = Math.cos(target);
    if (Math.abs(want - d) < 1e-6) return 0;
    const push = mul3(n1, (want > d ? -1 : 1) * 1e-3 * stiffness);
    if (pinned.has(l)) return 0;
    pos[l] = add3(pos[l] as Vec3, push);
    return len3(push);
  }
  const scale = (-(Math.acos(d) - target) * sinD) / sum;
  const s = stiffness * scale;
  pos[i] = add3(pos[i] as Vec3, mul3(q1, s * w[0]));
  pos[j] = add3(pos[j] as Vec3, mul3(q2, s * w[1]));
  pos[k] = add3(pos[k] as Vec3, mul3(q3, s * w[2]));
  pos[l] = add3(pos[l] as Vec3, mul3(q4, s * w[3]));
  return Math.abs(s) * Math.sqrt(sum);
}

export const solverInternals = { buildMesh };
export type { Facet };
