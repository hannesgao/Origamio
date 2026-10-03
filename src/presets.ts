/**
 * Scripted fold sequences. Every step is a fold line in the current folded
 * coordinates, a point on the side that moves, and the selection and
 * placement options of `fold`. Coordinates are for a unit sheet with its
 * lower-left corner at the origin.
 */
import { type Line, type Polygon, type Vec, line, vec } from './geometry';
import { type LayerSelection, type Placement, topLayers } from './paper';

export interface PresetStep {
  readonly line: Line;
  readonly movingPoint: Vec;
  readonly layers?: LayerSelection;
  readonly region?: Polygon;
  readonly window?: Polygon;
  readonly placement?: Placement;
}

export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly steps: readonly PresetStep[];
}

type StepOptions = Omit<PresetStep, 'line' | 'movingPoint'>;

const step = (a: Vec, b: Vec, movingPoint: Vec, options: StepOptions = {}): PresetStep => ({
  line: line(a, b),
  movingPoint,
  ...options,
});

const halfLeftRight = step(vec(0.5, 0), vec(0.5, 1), vec(1, 0.5));
const halfTopBottom = step(vec(0, 0.5), vec(1, 0.5), vec(0.25, 1));
const quarterLeftRight = step(vec(0.25, 0), vec(0.25, 1), vec(0.5, 0.25));

// --- Crane -------------------------------------------------------------------
//
// The sheet corners are A (0,0), B (1,0), C (1,1), D (0,1) and O is the
// centre. The preliminary base folds all four quadrants onto the lower-left
// one, so the base is the square O-E-A-H with E (0.5,0) and H (0,0.5) and its
// centre line is the diagonal from A to O. Points along that diagonal are
// written in (u, v) coordinates: u along the centre line from A, v across it
// towards H.

const SQRT_HALF = Math.SQRT1_2;
const TAN_22_5 = Math.SQRT2 - 1;

/** Sheet coordinates of a point given along (u) and across (v) the centre line. */
const uv = (u: number, v: number): Vec => vec((u - v) * SQRT_HALF, (u + v) * SQRT_HALF);

/** The point at `distance` from `origin` in the direction `angle` (radians). */
const towards = (origin: Vec, angle: number, distance: number): Vec =>
  vec(origin.x + Math.cos(angle) * distance, origin.y + Math.sin(angle) * distance);

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [
  vec(x0, y0),
  vec(x1, y0),
  vec(x1, y1),
  vec(x0, y1),
];

const A = vec(0, 0);
const C = vec(1, 1);
const D = vec(0, 1);
const E = vec(0.5, 0);
const H = vec(0, 0.5);

/** Quadrants of the unfolded sheet; Q1 holds corner A, Q4 corner D. */
const Q1 = rect(0, 0, 0.5, 0.5);
const Q4 = rect(0, 0.5, 0.5, 1);

/** The kite creases of the petal fold: through A at 22.5° from each lower edge. */
const kiteRight = (): [Vec, Vec] => [A, towards(A, Math.PI / 8, 1)];
const kiteLeft = (): [Vec, Vec] => [A, towards(A, (3 * Math.PI) / 8, 1)];
/** The petal crease: where the kite creases meet the upper edges of the base. */
const petalLine = (): [Vec, Vec] => [vec(0.5, TAN_22_5 / 2), vec(TAN_22_5 / 2, 0.5)];

/** Petal fold one layer of the preliminary base into a point: two kite folds, then lift. */
const petal = (region: Polygon, placement: Placement): PresetStep[] => [
  step(...kiteRight(), E, { region, placement }),
  step(...kiteLeft(), H, { region, placement }),
  step(...petalLine(), A, { region, placement }),
];

/** A point `distance` from `origin` along the (u, v) direction `angle`. */
const alongUv = (origin: Vec, angle: number, distance: number): Vec => {
  const o = uv(0, 0);
  const d = uv(Math.cos(angle), Math.sin(angle));
  return vec(origin.x + (d.x - o.x) * distance, origin.y + (d.y - o.y) * distance);
};

/**
 * Narrow a petal point: fold each of its two edges to the centre line with a
 * crease from the tip. The edges run from the tip at ±22.5°, so the creases
 * run at ±11.25°.
 */
const narrowPoint = (region: Polygon, placement: Placement): PresetStep[] => {
  const tip = uv(1, 0);
  return [
    step(tip, alongUv(tip, Math.PI + Math.PI / 16, 1), uv(0.5, -TAN_22_5 / 2), {
      region,
      placement,
    }),
    step(tip, alongUv(tip, Math.PI - Math.PI / 16, 1), uv(0.5, TAN_22_5 / 2), {
      region,
      placement,
    }),
  ];
};

/** Inside reverse fold of a point lying along the centre line beyond u = `at`. */
const reverseFold = (at: number, angle: number, region: Polygon): PresetStep => {
  const pivot = uv(at, 0);
  return step(pivot, alongUv(pivot, angle, 1), uv(1, 0), { region, placement: 'inside' });
};

const deg = (d: number): number => (d * Math.PI) / 180;

/** Pre-crease a line: fold everything over, then fold the top layer back. */
const crease = (a: Vec, b: Vec, movingPoint: Vec, movedTo: Vec): PresetStep[] => [
  step(a, b, movingPoint),
  step(a, b, movedTo, { layers: topLayers(1) }),
];

function craneSteps(): PresetStep[] {
  // Neck and tail rise in a V from just above the points' base at the F line.
  const neckBase = 0.62;
  const neckAngle = deg(70);
  const neckStart = uv(neckBase, 0);
  // Where the head crease meets the neck, and the window that keeps the fold
  // on the neck: everything above the body (v > 0.03) is the neck or the tail,
  // and the tail is excluded by its region.
  const headAt = alongUv(neckStart, neckAngle, 0.27);
  const headCrease = alongUv(headAt, neckAngle - deg(45), 1);
  const neckWindow: Polygon = [uv(0.5, 0.03), uv(1.3, 0.03), uv(1.3, 0.6), uv(0.5, 0.6)];
  const wingPivot = uv(0.5, 0);
  const wingCrease = alongUv(wingPivot, deg(45), 1);
  // Only the layers below the spine are wings; the neck and tail rise above it.
  const wingWindow: Polygon = [uv(-0.2, -1), uv(1.2, -1), uv(1.2, 0.001), uv(-0.2, 0.001)];

  return [
    // Pre-crease both diagonals.
    ...crease(A, C, D, vec(1, 0)),
    ...crease(vec(1, 0), D, A, C),
    // Preliminary base: fold in half twice along the medians.
    halfLeftRight,
    halfTopBottom,
    // Bird base: petal fold the front layer (quadrant of D) and the back layer (quadrant of A).
    ...petal(Q4, 'top'),
    ...petal(Q1, 'bottom'),
    // Narrow both points: fold their edges to the centre line.
    ...narrowPoint(Q4, 'top'),
    ...narrowPoint(Q1, 'bottom'),
    // Fold the model in half along its centre line.
    step(A, vec(1, 1), H),
    // Neck and tail: inside reverse folds of the two points.
    reverseFold(neckBase, neckAngle / 2, Q4),
    reverseFold(neckBase, deg(55), Q1),
    // Head: reverse fold the tip of the neck forward.
    step(headAt, headCrease, alongUv(headAt, neckAngle, 1), {
      region: Q4,
      window: neckWindow,
      placement: 'inside',
    }),
    // Wings down.
    step(wingPivot, wingCrease, A, { window: wingWindow }),
  ];
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'three-halves',
    label: 'Fold in half ×3',
    title: 'Left over right, top over bottom, left over right again',
    steps: [halfLeftRight, halfTopBottom, quarterLeftRight],
  },
  {
    id: 'corner-loose',
    label: 'Halves + loose corner',
    title: 'Fold in half twice, then fold the loose corner where the four sheet corners stack',
    steps: [halfLeftRight, halfTopBottom, step(vec(0.2, 0), vec(0, 0.2), vec(0, 0))],
  },
  {
    id: 'corner-two-edges',
    label: 'Halves + centre corner',
    title: 'Fold in half twice, then fold the corner where both folded edges meet',
    steps: [halfLeftRight, halfTopBottom, step(vec(0.5, 0.3), vec(0.3, 0.5), vec(0.5, 0.5))],
  },
  {
    id: 'corner-one-edge',
    label: 'Halves + single-edge corner',
    title: 'Fold in half twice, then fold a corner that has only one folded edge',
    steps: [halfLeftRight, halfTopBottom, step(vec(0.3, 0), vec(0.5, 0.2), vec(0.5, 0))],
  },
  {
    id: 'crane',
    label: 'Crane',
    title:
      'Diagonals, preliminary base, bird base, narrow the points, close the model, reverse fold neck, tail and head, wings down',
    steps: craneSteps(),
  },
];
