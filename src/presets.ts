/**
 * Scripted fold sequences. Every step is a fold line in the current folded
 * coordinates, a point on the side that moves, and the selection and
 * placement options of `fold`. Coordinates are for a unit sheet with its
 * lower-left corner at the origin.
 */
import {
  type Line,
  type Polygon,
  type Vec,
  line,
  perpendicularBisector,
  sideOf,
  vec,
} from './geometry';
import { type LayerSelection, type Placement, bottomLayers, topLayers } from './paper';
import { type FoldPart, type FoldStep, type Sequence } from './sequence';

export interface PresetStep {
  readonly line: Line;
  readonly movingPoint: Vec;
  /** For a point-to-point step: where `movingPoint` lands. Documentation only. */
  readonly landsOn?: Vec;
  readonly layers?: LayerSelection;
  readonly region?: Polygon;
  readonly window?: Polygon;
  readonly placement?: Placement;
  /** Take attached paper along so the step never tears the sheet. */
  readonly attached?: boolean;
  /** Fold angle for display in degrees; below 180 the 3D view keeps the crease open. */
  readonly angle?: number;
  /** Further folds made in the same step, after this one. */
  readonly also?: readonly PresetStep[];
  readonly label?: string;
}

export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly steps: readonly PresetStep[];
}

/** A preset as replayable data: the moving point becomes a side. */
export function presetToSequence(preset: Preset): Sequence {
  const part = (s: PresetStep): FoldPart => {
    const { line: l, movingPoint, landsOn, label, also, angle, ...options } = s;
    void landsOn;
    void label;
    void also;
    void angle;
    return { line: l, side: sideOf(l, movingPoint), options };
  };
  const steps: FoldStep[] = preset.steps.map((s) => {
    const first = part(s);
    const options = s.angle !== undefined ? { ...first.options, angle: s.angle } : first.options;
    return {
      ...first,
      options,
      ...(s.also && s.also.length > 0 ? { also: s.also.map(part) } : {}),
      ...(s.label ? { label: s.label } : {}),
    };
  });
  return { name: preset.label, description: preset.title, steps };
}

/** A step made of several folds at once: the first carries the label. */
const group = (label: string, first: PresetStep, ...rest: PresetStep[]): PresetStep => ({
  ...first,
  also: rest,
  label,
});

type StepOptions = Omit<PresetStep, 'line' | 'movingPoint'>;

const step = (a: Vec, b: Vec, movingPoint: Vec, options: StepOptions = {}): PresetStep => ({
  line: line(a, b),
  movingPoint,
  ...options,
});

/**
 * A fold written the way instructions are: bring `from` onto `to`. The crease
 * is the perpendicular bisector of the two points and the side holding `from`
 * moves, exactly what the Point tool does on the sheet.
 */
const bring = (from: Vec, to: Vec, options: StepOptions = {}): PresetStep => ({
  line: perpendicularBisector(from, to),
  movingPoint: from,
  landsOn: to,
  ...options,
});

const halfLeftRight = bring(vec(1, 0), vec(0, 0), { label: 'Right half over' });
const halfTopBottom = bring(vec(0, 1), vec(0, 0), { label: 'Top half down' });
const quarterLeftRight = bring(vec(0.5, 0), vec(0, 0), { label: 'Right half over' });

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

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [
  vec(x0, y0),
  vec(x1, y0),
  vec(x1, y1),
  vec(x0, y1),
];

const A = vec(0, 0);
const B = vec(1, 0);
const C = vec(1, 1);
const D = vec(0, 1);
const E = vec(0.5, 0);
const H = vec(0, 0.5);
/** The far corner of the preliminary base, one sheet length up the centre line from A. */
const O = uv(1, 0);

/** Quadrants of the unfolded sheet; Q4 holds corner D, Q2 corner B. */
const Q4 = rect(0, 0.5, 0.5, 1);
const Q2 = rect(0.5, 0, 1, 0.5);

const deg = (d: number): number => (d * Math.PI) / 180;

/** A point `distance` from `origin` along the (u, v) direction `angle`. */
const alongUv = (origin: Vec, angle: number, distance: number): Vec => {
  const o = uv(0, 0);
  const d = uv(Math.cos(angle), Math.sin(angle));
  return vec(origin.x + (d.x - o.x) * distance, origin.y + (d.y - o.y) * distance);
};

/**
 * Petal fold one page of the square base into a point, all at once: fold
 * both lower edges of the two-layer flaps to the centre line (the edge
 * midpoints E and H land half way up it), then lift the bottom corner A to
 * the top corner O. `front` works the top page, `back` the bottom one.
 */
const petal = (side: 'front' | 'back'): PresetStep => {
  const flap = side === 'front' ? topLayers(2) : bottomLayers(2);
  const placement: Placement = side === 'front' ? 'top' : 'bottom';
  const page = side === 'front' ? Q4 : Q2;
  return group(
    side === 'front' ? 'Petal fold front' : 'Petal fold back',
    bring(E, uv(0.5, 0), { layers: flap, placement }),
    bring(H, uv(0.5, 0), { layers: flap, placement }),
    bring(A, O, { region: page, placement }),
  );
};

/**
 * Narrow a petal point: fold each of its two edges to the centre line, both
 * in one step. A point half way along an edge lies at ±22.5° from the tip;
 * it lands on the centre line at the same distance from the tip.
 */
const narrowPoint = (region: Polygon, placement: Placement, label: string): PresetStep => {
  const reach = 0.5 / Math.cos(deg(22.5));
  const onCentre = uv(1 - reach, 0);
  // The point is two layers joined at its base; folding its edge takes both.
  return group(
    label,
    bring(uv(0.5, -TAN_22_5 / 2), onCentre, { region, placement, attached: true }),
    bring(uv(0.5, TAN_22_5 / 2), onCentre, { region, placement, attached: true }),
  );
};

/**
 * Inside reverse fold of a point lying along the centre line beyond u = `at`:
 * its tip swings from the centre line to the direction `angle`.
 */
const reverseFold = (at: number, angle: number, region: Polygon, label: string): PresetStep => {
  const pivot = uv(at, 0);
  return bring(O, alongUv(pivot, angle, 1 - at), {
    region,
    placement: 'inside',
    attached: true,
    label,
  });
};

/** Pre-crease a line in one step: fold `from` onto `to`, then fold the top layer back. */
const crease = (from: Vec, to: Vec): PresetStep =>
  group('Pre-crease', bring(from, to), bring(to, from, { layers: topLayers(1) }));

/** The square base in one step: both medians, then the squash that frees the nested flap. */
const squareBase = (): PresetStep => {
  // The centre of the sheet; the axis of the base runs from A through it.
  const centre = vec(0.5, 0.5);
  const axis: [Vec, Vec] = [A, centre];
  // The left page: the triangle A-centre-D of the unfolded sheet, whose flap
  // sits inside the other after the second median fold and swings over and back.
  const leftPage: Polygon = [A, centre, D];
  return group(
    'Square base',
    halfLeftRight,
    halfTopBottom,
    step(...axis, H, { region: leftPage }),
    step(...axis, E, { region: leftPage }),
  );
};

function craneSteps(): PresetStep[] {
  // Neck and tail rise in a V from just above the points' base. The neck is
  // steep enough that its crease leaves the point above the shoulder; a
  // shallower one would run into the body.
  const neckBase = 0.62;
  const neckAngle = deg(85);
  const neckStart = uv(neckBase, 0);
  const neckLength = 1 - neckBase;
  // The neck tip, where the head crease sits on the neck, and the window that
  // keeps the head fold on the neck: everything above the body (v > 0.03) is
  // the neck or the tail, and the tail is excluded by its region.
  const neckTip = alongUv(neckStart, neckAngle, neckLength);
  const headAt = alongUv(neckStart, neckAngle, 0.27);
  const headLength = neckLength - 0.27;
  const neckWindow: Polygon = [uv(0.5, 0.03), uv(1.3, 0.03), uv(1.3, 0.6), uv(0.5, 0.6)];
  const wingPivot = uv(0.5, 0);
  // Only the layers below the spine are wings; the neck and tail rise above it.
  const wingWindow: Polygon = [uv(-0.2, -1), uv(1.2, -1), uv(1.2, 0.001), uv(-0.2, 0.001)];

  return [
    // Pre-crease both diagonals: corner to opposite corner, and back.
    crease(D, B),
    crease(C, A),
    // Square base: medians folded, then the squash that puts the four flaps side by side.
    squareBase(),
    // Bird base: petal fold the front page (corner D) and the back page (corner B).
    petal('front'),
    petal('back'),
    // Narrow both points: fold their edges to the centre line.
    narrowPoint(Q4, 'top', 'Narrow front point'),
    narrowPoint(Q2, 'bottom', 'Narrow back point'),
    // Fold the model in half along its centre line: H onto E.
    bring(H, E, { label: 'Close along centre' }),
    // Neck and tail: inside reverse folds that swing the two points up.
    reverseFold(neckBase, neckAngle, Q4, 'Reverse fold neck'),
    reverseFold(neckBase, deg(110), Q2, 'Reverse fold tail'),
    // Head: reverse fold the tip of the neck forward and down, a quarter turn.
    bring(neckTip, alongUv(headAt, neckAngle - deg(90), headLength), {
      region: Q4,
      window: neckWindow,
      placement: 'inside',
      attached: true,
      label: 'Reverse fold head',
    }),
    // Wings: the wing corner swings from the centre line down, and the crease
    // stays open at 100°, so in the 3D view the wings stand nearly square to
    // the body like a finished crane's.
    bring(A, alongUv(wingPivot, deg(-90), 0.5), {
      window: wingWindow,
      attached: true,
      angle: 100,
      label: 'Spread wings',
    }),
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
    steps: [
      halfLeftRight,
      halfTopBottom,
      step(vec(0.2, 0), vec(0, 0.2), vec(0, 0), { label: 'Loose corner' }),
    ],
  },
  {
    id: 'corner-two-edges',
    label: 'Halves + centre corner',
    title: 'Fold in half twice, then fold the corner where both folded edges meet',
    steps: [
      halfLeftRight,
      halfTopBottom,
      step(vec(0.5, 0.3), vec(0.3, 0.5), vec(0.5, 0.5), { label: 'Centre corner' }),
    ],
  },
  {
    id: 'corner-one-edge',
    label: 'Halves + single-edge corner',
    title: 'Fold in half twice, then fold a corner that has only one folded edge',
    steps: [
      halfLeftRight,
      halfTopBottom,
      step(vec(0.3, 0), vec(0.5, 0.2), vec(0.5, 0), { label: 'Single-edge corner' }),
    ],
  },
  {
    id: 'crane',
    label: 'Crane',
    title:
      'Diagonals, preliminary base, bird base, narrow the points, close the model, reverse fold neck, tail and head, wings down',
    steps: craneSteps(),
  },
];
