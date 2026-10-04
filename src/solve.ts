/**
 * A small position-based solver that turns the rigid walk of `placePanels`
 * into a sheet that holds together: every facet keeps its shape, facets
 * joined at a crease share their edge, and each crease is pulled towards
 * its target dihedral angle. Where the targets contradict each other (the
 * wings and the body of a crane form a loop) the sheet settles on a
 * compromise, the way paper gives a little, instead of showing a gap.
 */
import { type Vec, centroid, distance } from './geometry';
import { type Facet, type PaperState } from './paper';
import { type Hinge, type Panel, type PoseOptions, type Vec3, placePanels } from './rigid';

export interface SolveOptions extends PoseOptions {
  /** Gauss-Seidel sweeps over all constraints. */
  readonly iterations?: number;
  /** Stop early when no vertex moved more than this in a sweep, in sheet units. */
  readonly tolerance?: number;
  /** How hard creases pull towards their angle, 0 to 1. */
  readonly bendStiffness?: number;
  /** Vertex positions to start from (a previous solution), by facet id and vertex index. */
  readonly warm?: ReadonlyMap<number, readonly Vec3[]>;
}

export interface Solved {
  readonly panels: Panel[];
  /** Largest remaining violation of a shared-edge or length constraint, in sheet units. */
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
  readonly count: number;
}

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

/** The constraint mesh of a sheet: facets with hinge endpoints as vertices, welded along hinges. */
function buildMesh(state: PaperState, hinges: readonly Hinge[]): Mesh {
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
  return { polys, index, lengths, bends, count: compact.size };
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

  // Initial positions: the rigid walk, averaged where welded vertices disagree.
  const start = placePanels(state, hinges, options);
  const byId = new Map(start.map((p) => [p.facet.id, p]));
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

  let residual = 0;
  for (let sweep = 0; sweep < iterations; sweep++) {
    let moved = 0;
    for (const c of mesh.lengths) {
      const a = pos[c.i] as Vec3;
      const b = pos[c.j] as Vec3;
      const d = sub3(b, a);
      const l = len3(d);
      if (l < 1e-12) continue;
      const corr = mul3(d, ((l - c.rest) / l) * 0.5);
      pos[c.i] = add3(a, corr);
      pos[c.j] = sub3(b, corr);
      moved = Math.max(moved, len3(corr));
    }
    for (const c of mesh.bends) {
      const target = Math.PI - Math.abs(angleOf(c.hinge));
      moved = Math.max(moved, bendConstraint(pos, c.i, c.j, c.k, c.l, target, bendStiffness));
    }
    residual = moved;
    if (moved < tolerance) break;
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
  const sum = dot3(q1, q1) + dot3(q2, q2) + dot3(q3, q3) + dot3(q4, q4);
  if (sum < 1e-12) return 0;
  const sinD = Math.sqrt(Math.max(0, 1 - d * d));
  if (sinD < 1e-9) {
    // Normals (anti)parallel: the gradient vanishes; nudge the off-edge vertex instead.
    const want = Math.cos(target);
    if (Math.abs(want - d) < 1e-6) return 0;
    const push = mul3(n1, (want > d ? -1 : 1) * 1e-3 * stiffness);
    pos[l] = add3(pos[l] as Vec3, push);
    return len3(push);
  }
  const scale = (-(Math.acos(d) - target) * sinD) / sum;
  const s = stiffness * scale;
  pos[i] = add3(pos[i] as Vec3, mul3(q1, s));
  pos[j] = add3(pos[j] as Vec3, mul3(q2, s));
  pos[k] = add3(pos[k] as Vec3, mul3(q3, s));
  pos[l] = add3(pos[l] as Vec3, mul3(q4, s));
  return Math.abs(s) * Math.sqrt(sum);
}

export const solverInternals = { buildMesh };
export type { Facet };
