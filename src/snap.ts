import { type Line, type Vec, add, cross, distance, dot, scale, sub } from './geometry';
import { type PaperState, currentPolygon } from './paper';

/** Where a fold line endpoint can snap to on the folded sheet. */
export type SnapKind = 'vertex' | 'intersection' | 'midpoint' | 'edge';

export interface SnapTarget {
  readonly point: Vec;
  readonly kind: SnapKind;
}

/** Snap candidates of a folded sheet: its distinct vertices, edge midpoints and edges. */
export interface SnapTargets {
  readonly points: readonly SnapTarget[];
  readonly edges: readonly Line[];
}

export interface Snap {
  readonly point: Vec;
  readonly kind: SnapKind;
}

const key = (p: Vec): string => `${p.x.toFixed(7)},${p.y.toFixed(7)}`;
const edgeKey = (a: Vec, b: Vec): string => {
  const [p, q] = key(a) < key(b) ? [a, b] : [b, a];
  return `${key(p)}|${key(q)}`;
};

/** Where two segments properly cross (not at an endpoint), if they do. */
function crossing(p: Line, q: Line): Vec | null {
  const r = sub(p.b, p.a);
  const s = sub(q.b, q.a);
  const denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-12) return null;
  const w = sub(q.a, p.a);
  const t = cross(w, s) / denominator;
  const u = cross(w, r) / denominator;
  const inside = (k: number): boolean => k > 1e-7 && k < 1 - 1e-7;
  return inside(t) && inside(u) ? add(p.a, scale(r, t)) : null;
}

/**
 * The distinct corners, crossings of edges from different layers, edge
 * midpoints and edges of every facet in its current (folded) position.
 * Layers lying on top of each other share their corners, so each point and
 * edge is listed once.
 */
export function snapTargets(state: PaperState): SnapTargets {
  const vertices = new Map<string, Vec>();
  const edges = new Map<string, Line>();
  for (const facet of state.facets) {
    const poly = currentPolygon(facet);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i] as Vec;
      const b = poly[(i + 1) % poly.length] as Vec;
      vertices.set(key(a), a);
      if (distance(a, b) > 1e-9) edges.set(edgeKey(a, b), { a, b });
    }
  }
  const points: SnapTarget[] = [...vertices.values()].map((point) => ({ point, kind: 'vertex' }));
  const seen = new Set(vertices.keys());
  const edgeList = [...edges.values()];
  for (let i = 0; i < edgeList.length; i++) {
    for (let j = i + 1; j < edgeList.length; j++) {
      const point = crossing(edgeList[i] as Line, edgeList[j] as Line);
      if (!point) continue;
      const k = key(point);
      if (seen.has(k)) continue;
      seen.add(k);
      points.push({ point, kind: 'intersection' });
    }
  }
  for (const edge of edges.values()) {
    const mid = scale(add(edge.a, edge.b), 0.5);
    const k = key(mid);
    if (seen.has(k)) continue;
    seen.add(k);
    points.push({ point: mid, kind: 'midpoint' });
  }
  return { points, edges: edgeList };
}

/** The point of segment `edge` closest to `p`. */
function closestOnSegment(edge: Line, p: Vec): Vec {
  const d = sub(edge.b, edge.a);
  const len2 = dot(d, d);
  if (len2 === 0) return edge.a;
  const t = Math.min(1, Math.max(0, dot(sub(p, edge.a), d) / len2));
  return add(edge.a, scale(d, t));
}

/**
 * Snap `p` to the nearest target within `radius`: corners win over edge
 * crossings, those over midpoints, and all of them over a point somewhere
 * along an edge. Returns null when nothing is close enough.
 */
export function snapTo(targets: SnapTargets, p: Vec, radius: number): Snap | null {
  let best: Snap | null = null;
  let bestDistance = radius;
  for (const kind of ['vertex', 'intersection', 'midpoint'] as const) {
    for (const target of targets.points) {
      if (target.kind !== kind) continue;
      const d = distance(target.point, p);
      if (d <= bestDistance) {
        best = { point: target.point, kind };
        bestDistance = d;
      }
    }
    if (best) return best;
  }
  for (const edge of targets.edges) {
    const q = closestOnSegment(edge, p);
    const d = distance(q, p);
    if (d <= bestDistance) {
      best = { point: q, kind: 'edge' };
      bestDistance = d;
    }
  }
  return best;
}
