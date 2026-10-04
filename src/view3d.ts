import { type PaperState, foldedPoints } from './paper';
import { BACK_COLOR, FRONT_COLOR } from './render';
import { type Hinge, type StepAnimation, type Vec3, hinges, placePanels, stepPose } from './rigid';

export type { StepAnimation } from './rigid';

/** How the 3D view is turned: yaw spins the sheet on the table, pitch tilts it. Radians. */
export interface Orbit {
  readonly yaw: number;
  readonly pitch: number;
  /** Turn of the picture about the line of sight; the named views use it. */
  readonly roll: number;
  readonly zoom: number;
}

export const DEFAULT_ORBIT: Orbit = { yaw: -0.55, pitch: 0.95, roll: 0, zoom: 1 };

/**
 * Fixed views, named for a model whose spine runs along the sheet's
 * diagonal, like the crane: the side view looks at the sheet face-on with
 * the spine level, the top view looks across the spine along the sheet
 * (wings spread, body edge-on), the front view looks along the spine with
 * the picture turned so the body stands upright.
 */
export const NAMED_VIEWS: readonly {
  readonly id: string;
  readonly label: string;
  readonly orbit: Orbit;
}[] = [
  {
    id: 'front',
    label: 'Front',
    orbit: { yaw: Math.PI / 4, pitch: Math.PI / 2, roll: Math.PI / 2, zoom: 1 },
  },
  { id: 'side', label: 'Side', orbit: { yaw: -Math.PI / 4, pitch: 0, roll: 0, zoom: 1 } },
  { id: 'top', label: 'Top', orbit: { yaw: -Math.PI / 4, pitch: Math.PI / 2, roll: 0, zoom: 1 } },
];
export const MIN_ORBIT_ZOOM = 0.5;
export const MAX_ORBIT_ZOOM = 4;

/** Crease openings offered as presets, in degrees; any other value can be typed. */
export const OPENING_STEPS: readonly number[] = [0, 3, 6, 10, 15, 30];
export const DEFAULT_OPENING = 6;
export const MAX_OPENING = 90;

/** An angle brought back into (-π, π]. */
export const wrapAngle = (a: number): number => {
  const twoPi = 2 * Math.PI;
  let r = a % twoPi;
  if (r <= -Math.PI) r += twoPi;
  if (r > Math.PI) r -= twoPi;
  return r;
};

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
  const x2 = x1;
  const y2 = y1 * cp + z * sp;
  const z2 = -y1 * sp + z * cp;
  // Roll turns the picture about the line of sight.
  const cr = Math.cos(orbit.roll);
  const sr = Math.sin(orbit.roll);
  return { x: x2 * cr - y2 * sr, y: x2 * sr + y2 * cr, z: z2 };
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
/** The hinge along a facet's edge, if the edge lies on one. */
function hingeAlong(
  byFacet: Map<number, Hinge[]>,
  facetId: number,
  a: Vec3,
  b: Vec3,
): Hinge | null {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  for (const h of byFacet.get(facetId) ?? []) {
    const dx = h.b.x - h.a.x;
    const dy = h.b.y - h.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const off = Math.abs((dx * (mid.y - h.a.y) - dy * (mid.x - h.a.x)) / len);
    const along = (dx * (mid.x - h.a.x) + dy * (mid.y - h.a.y)) / len;
    if (off < 1e-6 && along > -1e-6 && along < len + 1e-6) return h;
  }
  return null;
}

/** Paper grain and a soft edge, defined once per drawing. */
const DEFS =
  '<defs>' +
  '<filter id="paper-grain" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">' +
  '<feTurbulence type="fractalNoise" baseFrequency="700" numOctaves="2" seed="7" result="noise" />' +
  // Grey noise at low opacity, kept to the paper itself.
  '<feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.12 0" result="grey" />' +
  '<feComposite in="grey" in2="SourceAlpha" operator="in" result="grain" />' +
  '<feBlend in="SourceGraphic" in2="grain" mode="multiply" />' +
  '</filter>' +
  '</defs>';

export function render3d(state: PaperState, options: View3dOptions): View3d {
  const size = state.size;
  const all = hinges(state);
  const pose = stepPose(state, options.opening, options.animation);
  const panels = placePanels(state, all, pose);
  const animation = options.animation;
  // Hinges by facet, to tell a real fold from a flat seam between facets.
  const byFacet = new Map<number, Hinge[]>();
  for (const h of all) {
    for (const id of [h.p, h.q]) {
      const list = byFacet.get(id);
      if (list) list.push(h);
      else byFacet.set(id, [h]);
    }
  }
  const angleOf = pose.angleOf ?? ((h: Hinge): number => h.shown);

  // While a step plays the sheet may reach further than its end state does.
  const extent = animation
    ? [...foldedPoints(state), ...foldedPoints(animation.previous)]
    : foldedPoints(state);
  const xs = extent.map((p) => p.x);
  const ys = extent.map((p) => p.y);
  const centre: Vec3 = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    z: 0,
  };
  const light = norm3({ x: -0.35, y: 0.45, z: 0.82 });
  // An edge is drawn only where the paper actually bends or ends; seams
  // between facets lying flat against each other stay invisible.
  const BEND = (2 * Math.PI) / 180;
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
  const parts: string[] = [DEFS, '<g filter="url(#paper-grain)">'];
  for (const d of drawn) {
    // The front face is seen when its normal points at the viewer.
    const seesFront = d.normal.z >= 0;
    const base = seesFront ? FRONT_COLOR : BACK_COLOR;
    // Mostly ambient light with a soft key light, so facets read as one sheet.
    const lit = 0.74 + 0.26 * Math.abs(dot3(d.normal, light));
    const fill = shade(base, lit);
    const pts = d.points.map((p) => `${fmt(p.x)},${fmt(-p.y)}`).join(' ');
    const cls = `solid-facet ${seesFront ? 'solid-front' : 'solid-back'}${d.moving ? ' facet-moving' : ''}`;
    parts.push(`<polygon class="${cls}" data-id="${d.facet.id}" points="${pts}" fill="${fill}" />`);
    // Edges: the sheet's boundary, and creases that are bent in this pose.
    const poly = d.facet.poly;
    const segments: string[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i] as { x: number; y: number };
      const b = poly[(i + 1) % poly.length] as { x: number; y: number };
      const hinge = hingeAlong(byFacet, d.facet.id, { ...a, z: 0 }, { ...b, z: 0 });
      // A seam between facets lying in one plane is not drawn; a fold is.
      if (hinge !== null && Math.abs(angleOf(hinge)) < BEND) continue;
      const pa = d.points[i] as Vec3;
      const pb = d.points[(i + 1) % poly.length] as Vec3;
      segments.push(`M${fmt(pa.x)},${fmt(-pa.y)}L${fmt(pb.x)},${fmt(-pb.y)}`);
    }
    if (segments.length > 0) parts.push(`<path class="solid-edge" d="${segments.join('')}" />`);
  }
  parts.push('</g>');
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
