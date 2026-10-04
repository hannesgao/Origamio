import { type PaperState, foldedPoints } from './paper';
import { type ViewFrame } from './sequence';
import { type Hinge, type Panel, type StepAnimation, type Vec3, hinges, stepPose } from './rigid';
import { solveSheet } from './solve';

export type { StepAnimation } from './rigid';

/** How the 3D view is turned: yaw spins the sheet on the table, pitch tilts it. Radians. */
export interface Orbit {
  /**
   * Optional fixed turn applied first: rows are the model-space directions
   * that map to screen right, screen up and towards the viewer. Named views
   * set it; dragging then adds yaw and pitch on top.
   */
  readonly basis?: readonly [Vec3, Vec3, Vec3];
  readonly yaw: number;
  readonly pitch: number;
  /** Turn of the picture about the line of sight. */
  readonly roll: number;
  readonly zoom: number;
}

export const DEFAULT_ORBIT: Orbit = { yaw: -0.55, pitch: 0.95, roll: 0, zoom: 1 };

/** The sheet's own axes, used when a sequence says nothing about how it stands. */
export const DEFAULT_FRAME: ViewFrame = { front: { x: 1, y: 0 }, top: { x: 0, y: 1 } };

export interface NamedView {
  readonly id: 'front' | 'side' | 'top' | 'isometric';
  /** The formal name of the view. */
  readonly label: string;
  /** What fits on a button. */
  readonly short: string;
  readonly orbit: Orbit;
}

const unit3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const mix3 = (a: Vec3, sa: number, b: Vec3, sb: number): Vec3 => ({
  x: a.x * sa + b.x * sb,
  y: a.y * sa + b.y * sb,
  z: a.z * sa + b.z * sb,
});

/**
 * The fixed views of a model, from how it stands: `front` points out of its
 * face, `top` up its back, both in the folded sheet's plane. The front view
 * looks at the face with the back up; the side view shows the profile with
 * the face to the left; the top view looks down the back with the face at
 * the top of the picture; the isometric view is the side view turned 45°
 * about the vertical.
 */
export function namedViews(frame: ViewFrame = DEFAULT_FRAME): NamedView[] {
  const f = unit3({ x: frame.front.x, y: frame.front.y, z: 0 });
  const tRaw = { x: frame.top.x, y: frame.top.y, z: 0 };
  const along = tRaw.x * f.x + tRaw.y * f.y;
  const t = unit3({ x: tRaw.x - f.x * along, y: tRaw.y - f.y * along, z: 0 });
  const n = cross3(f, t);
  const view = (
    id: NamedView['id'],
    label: string,
    short: string,
    right: Vec3,
    up: Vec3,
    toward: Vec3,
  ): NamedView => ({
    id,
    label,
    short,
    orbit: { basis: [right, up, toward], yaw: 0, pitch: 0, roll: 0, zoom: 1 },
  });
  const minus = (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z });
  const side = view('side', 'Side view', 'Side', minus(f), t, minus(n));
  const c = Math.SQRT1_2;
  return [
    view('front', 'Front view', 'Front', minus(n), t, f),
    side,
    view('top', 'Top view', 'Top', n, f, t),
    view(
      'isometric',
      'Isometric',
      'Iso',
      mix3(minus(f), c, minus(n), c),
      t,
      mix3(minus(n), c, f, c),
    ),
  ];
}

export const MIN_ORBIT_ZOOM = 0.5;
export const MAX_ORBIT_ZOOM = 4;

/** Paper thicknesses offered as presets, in millimetres of a 15 cm sheet. */
export const THICKNESS_STEPS_MM: readonly number[] = [0, 0.05, 0.07, 0.1, 0.2];
export const DEFAULT_THICKNESS_MM = 0.07;
export const MAX_THICKNESS_MM = 1;
/** The sheet the thickness presets are given for, in millimetres. */
export const SHEET_MM = 150;

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

export interface SceneOptions {
  /** How far every folded crease is opened from flat, in radians. */
  readonly opening: number;
  readonly animation?: StepAnimation;
}

/** A line to draw: the sheet's boundary or a crease that is bent in the current pose. */
export interface SceneEdge {
  readonly a: Vec3;
  readonly b: Vec3;
}

export interface SolvedScene {
  readonly panels: Panel[];
  readonly edges: SceneEdge[];
  /** Centre of the sheet's extent (in the sheet's plane) that views turn about. */
  readonly centre: Vec3;
  /** Farthest any solved point lies from the centre. */
  readonly reach: number;
}

/** The hinge along a facet's edge, if the edge lies on one. */
function hingeAlong(
  byFacet: Map<number, Hinge[]>,
  facetId: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
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

/**
 * The sheet solved as paper for the given opening (and step in progress):
 * every facet placed in space, plus the edges worth drawing. The 3D card
 * renders this; it is also what the tests look at.
 */
export function solvedScene(state: PaperState, options: SceneOptions): SolvedScene {
  const all = hinges(state);
  const pose = stepPose(state, options.opening, options.animation);
  // Solved from the rigid walk every time: a few milliseconds for a crane,
  // and a flat warm start would stall the crease constraints.
  const panels = solveSheet(state, all, { ...pose, iterations: 80 }).panels;
  const animation = options.animation;
  const byFacet = new Map<number, Hinge[]>();
  for (const h of all) {
    for (const id of [h.p, h.q]) {
      const list = byFacet.get(id);
      if (list) list.push(h);
      else byFacet.set(id, [h]);
    }
  }
  const angleOf = pose.angleOf ?? ((h: Hinge): number => h.shown);
  // An edge is drawn only where the paper actually bends or ends; seams
  // between facets lying flat against each other stay invisible.
  const BEND = (2 * Math.PI) / 180;
  const edges: SceneEdge[] = [];
  for (const panel of panels) {
    const poly = panel.facet.poly;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i] as { x: number; y: number };
      const b = poly[(i + 1) % poly.length] as { x: number; y: number };
      const hinge = hingeAlong(byFacet, panel.facet.id, a, b);
      if (hinge !== null && Math.abs(angleOf(hinge)) < BEND) continue;
      // Each crease is shared by two facets; draw it once, from the lower id.
      if (hinge !== null && hinge.p !== panel.facet.id && hinge.q !== panel.facet.id) continue;
      if (hinge !== null && Math.min(hinge.p, hinge.q) !== panel.facet.id) continue;
      edges.push({ a: panel.points[i] as Vec3, b: panel.points[(i + 1) % poly.length] as Vec3 });
    }
  }
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
  let reach = state.size * 0.3;
  for (const panel of panels) {
    for (const p of panel.points) {
      reach = Math.max(reach, Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z));
    }
  }
  return { panels, edges, centre, reach };
}

/**
 * The orbit as a rotation from model space to view space: rows are the
 * model-space directions that map to screen right, screen up and towards
 * the viewer (a named view's basis first, then yaw, pitch and roll).
 */
export function viewRotation(orbit: Orbit): readonly [Vec3, Vec3, Vec3] {
  const rotate = (p: Vec3): Vec3 => {
    let { x, y, z } = p;
    if (orbit.basis) {
      const [r, u, d] = orbit.basis;
      const bx = r.x * x + r.y * y + r.z * z;
      const by = u.x * x + u.y * y + u.z * z;
      const bz = d.x * x + d.y * y + d.z * z;
      x = bx;
      y = by;
      z = bz;
    }
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
    const cr = Math.cos(orbit.roll);
    const sr = Math.sin(orbit.roll);
    return { x: x2 * cr - y2 * sr, y: x2 * sr + y2 * cr, z: z2 };
  };
  // The rows of the rotation are the images of the model axes, transposed.
  const ex = rotate({ x: 1, y: 0, z: 0 });
  const ey = rotate({ x: 0, y: 1, z: 0 });
  const ez = rotate({ x: 0, y: 0, z: 1 });
  return [
    { x: ex.x, y: ey.x, z: ez.x },
    { x: ex.y, y: ey.y, z: ez.y },
    { x: ex.z, y: ey.z, z: ez.z },
  ];
}
