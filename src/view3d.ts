import { type PaperState, foldedPoints } from './paper';
import { BACK_COLOR, FRONT_COLOR } from './render';
import { type StepAnimation, type Vec3, hinges, placePanels, stepPose } from './rigid';

export type { StepAnimation } from './rigid';

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
  /** How far every folded crease is opened from flat, in radians. */
  readonly opening: number;
  readonly animation?: StepAnimation;
  /** Width / height of the frame; the view box takes the same shape. */
  readonly aspect?: number;
}

export interface View3d {
  readonly viewBox: string;
  readonly markup: string;
}

const fmt = (n: number): string => (Math.abs(n) < 1e-9 ? '0' : n.toFixed(4));
const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

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

/**
 * Markup for the folded sheet as rigid panels joined at their creases, each
 * crease opened a little so the paper reads as folded rather than stacked,
 * seen from the orbit.
 */
export function render3d(state: PaperState, options: View3dOptions): View3d {
  const size = state.size;
  const panels = placePanels(
    state,
    hinges(state),
    stepPose(state, options.opening, options.animation),
  );
  const animation = options.animation;

  const extent = foldedPoints(state);
  const xs = extent.map((p) => p.x);
  const ys = extent.map((p) => p.y);
  const centre: Vec3 = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    z: 0,
  };
  const light = norm3({ x: -0.35, y: 0.45, z: 0.82 });
  // Coincident panels are ordered by layer: higher layers are nearer when the
  // sheet is seen from the front, lower ones when it is seen from behind.
  const fromFront = rotate(options.orbit, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }).z >= 0;
  const drawn = panels
    .map((panel) => {
      const points = panel.points.map((p) => rotate(options.orbit, centre, p));
      const normal = norm3(rotate(options.orbit, { x: 0, y: 0, z: 0 }, panel.normal));
      const depth = points.reduce((sum, p) => sum + p.z, 0) / points.length;
      const moving = animation ? animation.movedIds.has(panel.facet.id) : false;
      return { facet: panel.facet, points, normal, depth, moving };
    })
    // Far panels first; coincident ones in layer order.
    .sort(
      (a, b) => a.depth - b.depth || (fromFront ? a.facet.z - b.facet.z : b.facet.z - a.facet.z),
    );
  const parts: string[] = [];
  for (const d of drawn) {
    // The front face is seen when its normal points at the viewer.
    const seesFront = d.normal.z >= 0;
    const base = seesFront ? FRONT_COLOR : BACK_COLOR;
    const lit = 0.62 + 0.38 * Math.abs(dot3(d.normal, light));
    const fill = shade(base, lit);
    const pts = d.points.map((p) => `${fmt(p.x)},${fmt(-p.y)}`).join(' ');
    const cls = `solid-facet ${seesFront ? 'solid-front' : 'solid-back'}${d.moving ? ' facet-moving' : ''}`;
    parts.push(`<polygon class="${cls}" data-id="${d.facet.id}" points="${pts}" fill="${fill}" />`);
  }
  // Fit the sheet's diagonal, whatever the turn, so the view does not jump.
  const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const span = Math.max(size * 0.6, diagonal) * 1.15;
  const zoom = Math.max(MIN_ORBIT_ZOOM, Math.min(MAX_ORBIT_ZOOM, options.orbit.zoom));
  const h = span / 2 / zoom;
  const aspect = options.aspect ?? 1;
  const w = h * aspect;
  return {
    viewBox: `${fmt(-w)} ${fmt(-h)} ${fmt(2 * w)} ${fmt(2 * h)}`,
    markup: parts.join(''),
  };
}
