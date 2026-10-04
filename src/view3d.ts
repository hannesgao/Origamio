import {
  type Line,
  type Polygon,
  type Vec,
  area,
  applyToPolygon,
  lineNormal,
  projectOnto,
  reflection,
  signedDistance,
} from './geometry';
import { type Facet, type PaperState, currentPolygon, foldedPoints, isFlipped } from './paper';
import { type FoldAnimation, BACK_COLOR, FRONT_COLOR } from './render';

/** How the 3D view is turned: yaw spins the sheet on the table, pitch tilts it. Radians. */
export interface Orbit {
  readonly yaw: number;
  readonly pitch: number;
  readonly zoom: number;
}

export const DEFAULT_ORBIT: Orbit = { yaw: -0.55, pitch: 0.95, zoom: 1 };
export const MIN_PITCH = 0;
export const MAX_PITCH = Math.PI / 2;
export const MIN_ORBIT_ZOOM = 0.5;
export const MAX_ORBIT_ZOOM = 4;

export interface View3dOptions {
  readonly orbit: Orbit;
  /** Height of one layer, in sheet units. */
  readonly thickness: number;
  readonly animation?: FoldAnimation;
  /** Width / height of the frame; the view box takes the same shape. */
  readonly aspect?: number;
}

export interface View3d {
  readonly viewBox: string;
  readonly markup: string;
}

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface Solid {
  readonly facet: Facet;
  readonly points: readonly Vec3[];
  /** Unit normal of the facet's +z face, after any flap rotation. */
  readonly normal: Vec3;
  /** Whether that +z face is the back of the paper. */
  readonly flipped: boolean;
  readonly moving: boolean;
}

const fmt = (n: number): string => (Math.abs(n) < 1e-9 ? '0' : n.toFixed(4));
const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** Point `p` of the flat sheet at height `h`, rotated by `angle` about `axis` (which lies at z = 0). */
function liftAbout(axis: Line, p: Vec, h: number, angle: number): Vec3 {
  const foot = projectOnto(axis, p);
  const s = signedDistance(axis, p);
  const n = lineNormal(axis);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // In the plane spanned by the in-sheet normal n and the vertical: (s, h) rotates by angle.
  const s2 = s * cos - h * sin;
  const z2 = s * sin + h * cos;
  return { x: foot.x + n.x * s2, y: foot.y + n.y * s2, z: z2 };
}

/** Every facet as a polygon in space: layers stacked by `thickness`, the moving flap mid-flip. */
function solids(state: PaperState, thickness: number, animation?: FoldAnimation): Solid[] {
  const animating = animation !== undefined && animation.progress < 1;
  const angle = animating ? animation.progress * Math.PI : 0;
  const undo = animating ? reflection(animation.line) : null;
  const result: Solid[] = [];
  for (const facet of state.facets) {
    const h = facet.z * thickness;
    const moving = animating && animation.movedIds.has(facet.id);
    if (moving && undo && animation) {
      // The facet already carries its final position; rotate its pre-fold
      // position about the fold line instead, by the current angle.
      const before: Polygon = applyToPolygon(undo, currentPolygon(facet));
      const axis = animation.line;
      const points = before.map((p) => liftAbout(axis, p, h, angle));
      const n = lineNormal(axis);
      // The +z face of a flap rotated by `angle` tilts toward -n.
      const normal: Vec3 = {
        x: -n.x * Math.sin(angle),
        y: -n.y * Math.sin(angle),
        z: Math.cos(angle),
      };
      // The flap keeps its own face up until it has turned past the vertical.
      result.push({
        facet,
        points,
        normal,
        flipped: isFlipped(facet) !== angle > Math.PI / 2,
        moving,
      });
    } else {
      const poly = currentPolygon(facet);
      if (area(poly) <= 0) continue;
      result.push({
        facet,
        points: poly.map((p) => ({ x: p.x, y: p.y, z: h })),
        normal: { x: 0, y: 0, z: 1 },
        flipped: isFlipped(facet),
        moving: false,
      });
    }
  }
  return result;
}

function rotate(orbit: Orbit, centre: Vec3, p: Vec3): Vec3 {
  // Spin about the vertical (sheet normal), then tilt about the screen's x axis.
  const x = p.x - centre.x;
  const y = p.y - centre.y;
  const z = p.z - centre.z;
  const cy = Math.cos(orbit.yaw);
  const sy = Math.sin(orbit.yaw);
  const x1 = x * cy - y * sy;
  const y1 = x * sy + y * cy;
  const cp = Math.cos(orbit.pitch);
  const sp = Math.sin(orbit.pitch);
  // Pitch 0 looks straight down; pitch π/2 looks along the table.
  return { x: x1, y: y1 * cp + z * sp, z: -y1 * sp + z * cp };
}

/** Hex colour darkened or lightened by `factor` (1 keeps it). */
function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v * factor)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel((n >> 16) & 255)}${channel((n >> 8) & 255)}${channel(n & 255)}`;
}

/** Markup for the folded sheet as a stack of thin layers, seen from the orbit. */
export function render3d(state: PaperState, options: View3dOptions): View3d {
  const size = state.size;
  const extent = foldedPoints(state);
  const xs = extent.map((p) => p.x);
  const ys = extent.map((p) => p.y);
  const layers = state.facets.reduce((m, f) => Math.max(m, f.z), 0);
  const centre: Vec3 = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    z: (layers * options.thickness) / 2,
  };
  const light = norm3({ x: -0.35, y: 0.45, z: 0.82 });
  const drawn = solids(state, options.thickness, options.animation)
    .map((s) => {
      const points = s.points.map((p) => rotate(options.orbit, centre, p));
      const normal = norm3(rotate(options.orbit, { x: 0, y: 0, z: 0 }, s.normal));
      const depth = points.reduce((sum, p) => sum + p.z, 0) / points.length;
      return { ...s, points, normal, depth };
    })
    .sort((a, b) => a.depth - b.depth);
  const parts: string[] = [];
  for (const d of drawn) {
    // Which face we see depends on which way its +z face points after the turn.
    const seesTop = d.normal.z >= 0;
    const backShown = d.flipped === seesTop;
    const base = backShown ? BACK_COLOR : FRONT_COLOR;
    const lit = 0.62 + 0.38 * Math.abs(dot3(d.normal, light));
    const fill = shade(base, lit);
    const pts = d.points.map((p) => `${fmt(p.x)},${fmt(-p.y)}`).join(' ');
    const cls = `solid-facet ${backShown ? 'solid-back' : 'solid-front'}${d.moving ? ' facet-moving' : ''}`;
    parts.push(`<polygon class="${cls}" data-id="${d.facet.id}" points="${pts}" fill="${fill}" />`);
  }
  // Fit the sheet's diagonal, whatever the turn, so the view does not jump.
  const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const span = Math.max(size * 0.6, diagonal) * 1.15 + layers * options.thickness;
  const zoom = Math.max(MIN_ORBIT_ZOOM, Math.min(MAX_ORBIT_ZOOM, options.orbit.zoom));
  const h = span / 2 / zoom;
  const aspect = options.aspect ?? 1;
  const w = h * aspect;
  return {
    viewBox: `${fmt(-w)} ${fmt(-h)} ${fmt(2 * w)} ${fmt(2 * h)}`,
    markup: parts.join(''),
  };
}
