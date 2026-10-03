/**
 * SVG rendering of the folded sheet and the unfolded crease pattern. The
 * functions return SVG markup strings so they stay free of DOM state; the UI
 * assigns them to `innerHTML` of an `<svg>` element.
 */
import {
  type Line,
  type Mat,
  type Polygon,
  type Side,
  type Vec,
  add,
  applyToPolygon,
  area,
  bounds,
  clipPolygon,
  compose,
  lineDirection,
  partialFlip,
  reflection,
  scale,
  signedDistance,
} from './geometry';
import { type Facet, type PaperState, currentPolygon, isFlipped } from './paper';

/** Pixel size of the drawing area for one sheet unit. */
export const VIEW_SIZE = 400;
/** Padding around the sheet, in sheet units. */
export const VIEW_PADDING = 0.1;

/** Default face colours; the live ones are the --paper-front and --paper-back CSS variables. */
export const FRONT_COLOR = '#e8923a';
export const BACK_COLOR = '#7a3f12';
export const CREASE_COLOR = '#c0392b';
export const LINE_COLOR = '#1f6feb';

/**
 * An in-flight fold animation. `progress` goes from 0 (nothing moved yet) to
 * 1 (fully folded, identical to the plain state).
 */
export interface FoldAnimation {
  readonly movedIds: ReadonlySet<number>;
  readonly line: Line;
  readonly progress: number;
}

export interface FoldPreview {
  readonly line: Line;
  /** Which side would be flipped, when the user hovers one. */
  readonly side?: Side;
}

export interface FoldedViewOptions {
  readonly animation?: FoldAnimation;
  readonly preview?: FoldPreview;
}

const fmt = (n: number): string => (Math.abs(n) < 1e-12 ? '0' : n.toFixed(5));

/**
 * What part of the folded sheet is visible. `centre` is in model coordinates
 * (y up); `zoom` 1 shows the whole sheet with its padding, 2 shows half of it.
 */
export interface Camera {
  readonly centre: Vec;
  readonly zoom: number;
}

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 16;

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** The camera that shows the whole sheet, centred on it. */
export const defaultCamera = (width: number, height = width): Camera => ({
  centre: { x: width / 2, y: height / 2 },
  zoom: 1,
});

/** Side length of the visible square, in sheet units. */
export const visibleExtent = (size: number, camera: Camera): number =>
  (size * (1 + 2 * VIEW_PADDING)) / camera.zoom;

/** The viewBox for `camera`: a square in SVG user space (y down). */
export function cameraViewBox(size: number, camera: Camera): string {
  const extent = visibleExtent(size, camera);
  const x = camera.centre.x - extent / 2;
  const y = size - camera.centre.y - extent / 2;
  return `${fmt(x)} ${fmt(y)} ${fmt(extent)} ${fmt(extent)}`;
}

/**
 * A camera that frames `points` with the usual padding around them. Falls
 * back to the default camera when there is nothing to frame.
 */
export function fitCamera(size: number, points: readonly Vec[]): Camera {
  if (points.length === 0) return defaultCamera(size);
  const box = bounds(points);
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-6);
  const needed = span + 2 * VIEW_PADDING * size;
  return {
    centre: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
    zoom: clampZoom((size * (1 + 2 * VIEW_PADDING)) / needed),
  };
}

/** The viewBox that frames the whole unfolded sheet, in sheet units. */
export const viewBox = (width: number, height = width): string =>
  cameraViewBox(Math.max(width, height), defaultCamera(width, height));

/** SVG `points` attribute. The y axis is flipped so the model's +y points up. */
export const pointsAttr = (poly: Polygon, size: number): string =>
  poly.map((p) => `${fmt(p.x)},${fmt(size - p.y)}`).join(' ');

const facetFill = (flipped: boolean): string =>
  flipped ? 'var(--paper-back)' : 'var(--paper-front)';

function facetMarkup(
  id: number,
  poly: Polygon,
  flipped: boolean,
  size: number,
  extraClass = '',
): string {
  if (area(poly) <= 0) return '';
  return `<polygon class="facet ${flipped ? 'facet-back' : 'facet-front'} ${extraClass}" data-id="${id}" points="${pointsAttr(
    poly,
    size,
  )}" style="fill:${facetFill(flipped)}" />`;
}

/** A segment of `line` long enough to cross the whole view. */
function longSegment(line: Line, size: number): readonly [Vec, Vec] {
  const d = lineDirection(line);
  const reach = size * 4;
  return [add(line.a, scale(d, -reach)), add(line.a, scale(d, reach))];
}

/** The view rectangle, slightly larger than the sheet. */
function viewRect(size: number): Polygon {
  const lo = -VIEW_PADDING * size;
  const hi = size * (1 + VIEW_PADDING);
  return [
    { x: lo, y: lo },
    { x: hi, y: lo },
    { x: hi, y: hi },
    { x: lo, y: hi },
  ];
}

function previewMarkup(preview: FoldPreview, size: number): string {
  const [p, q] = longSegment(preview.line, size);
  let shade = '';
  if (preview.side !== undefined) {
    const split = clipPolygon(viewRect(size), preview.line);
    const half = preview.side > 0 ? split.positive : split.negative;
    if (half.length >= 3) {
      shade = `<polygon class="preview-side" points="${pointsAttr(half, size)}" />`;
    }
  }
  return (
    shade +
    `<line class="preview-line" x1="${fmt(p.x)}" y1="${fmt(size - p.y)}" x2="${fmt(q.x)}" y2="${fmt(
      size - q.y,
    )}" />`
  );
}

interface DrawnFacet {
  readonly facet: Facet;
  readonly poly: Polygon;
  readonly flipped: boolean;
  readonly moving: boolean;
}

function drawnFacets(state: PaperState, animation?: FoldAnimation): DrawnFacet[] {
  if (!animation || animation.progress >= 1) {
    return state.facets.map((facet) => ({
      facet,
      poly: currentPolygon(facet),
      flipped: isFlipped(facet),
      moving: false,
    }));
  }
  // Moved facets already carry their final transform R ∘ T. To show them part
  // way through the flip we draw them with M(θ) ∘ R ∘ (R ∘ T) = M(θ) ∘ T.
  const angle = animation.progress * Math.PI;
  const undo = reflection(animation.line);
  const lift: Mat = compose(partialFlip(animation.line, angle), undo);
  const liftDet = lift.a * lift.d - lift.b * lift.c;
  const stationary: DrawnFacet[] = [];
  const moving: DrawnFacet[] = [];
  for (const facet of state.facets) {
    if (animation.movedIds.has(facet.id)) {
      const poly = applyToPolygon(lift, currentPolygon(facet));
      moving.push({ facet, poly, flipped: isFlipped(facet) !== liftDet < 0, moving: true });
    } else {
      stationary.push({
        facet,
        poly: currentPolygon(facet),
        flipped: isFlipped(facet),
        moving: false,
      });
    }
  }
  // While the flap is still rising its original layer order is visible from
  // above; once it passes the vertical the order is reversed.
  if (animation.progress < 0.5) moving.reverse();
  return [...stationary, ...moving];
}

/** Markup for the folded sheet, bottom layer first. */
export function renderFolded(state: PaperState, options: FoldedViewOptions = {}): string {
  const size = state.size;
  const parts: string[] = [];
  for (const d of drawnFacets(state, options.animation)) {
    parts.push(facetMarkup(d.facet.id, d.poly, d.flipped, size, d.moving ? 'facet-moving' : ''));
  }
  if (options.preview) parts.push(previewMarkup(options.preview, size));
  return parts.join('');
}

/** Markup for the unfolded sheet: every facet in sheet coordinates plus creases. */
export function renderUnfolded(state: PaperState): string {
  const size = state.size;
  const parts: string[] = [];
  parts.push(
    `<rect class="sheet-outline" x="0" y="${fmt(size - state.height)}" width="${fmt(state.width)}" height="${fmt(state.height)}" />`,
  );
  for (const facet of state.facets) {
    parts.push(
      `<polygon class="unfolded-facet ${isFlipped(facet) ? 'unfolded-back' : ''}" data-id="${facet.id}" points="${pointsAttr(
        facet.poly,
        size,
      )}" />`,
    );
  }
  for (const crease of state.creases) {
    parts.push(
      `<line class="crease" x1="${fmt(crease.a.x)}" y1="${fmt(size - crease.a.y)}" x2="${fmt(
        crease.b.x,
      )}" y2="${fmt(size - crease.b.y)}" />`,
    );
  }
  return parts.join('');
}

// --- Layer view --------------------------------------------------------------

/** Oblique projection of the layer view: model +y recedes up and to the right. */
export const LAYER_SHEAR = 0.5;
export const LAYER_SQUASH = 0.5;
/** Screen units per sheet unit of height, for a flap standing up mid-fold. */
export const LAYER_HEIGHT = 0.6;
/** Default width to height ratio of the layer view; the viewBox is padded to match. */
export const LAYER_VIEW_ASPECT = 2;

/**
 * Project a folded point onto the layer view. `rank` is the position of the
 * facet's layer in the stack (0 at the bottom) and `lift` the vertical gap
 * between layers, in sheet units. Returns SVG user space (y down).
 */
export function projectLayer(p: Vec, rank: number, lift: number, size: number): Vec {
  return { x: p.x + LAYER_SHEAR * p.y, y: (size - p.y) * LAYER_SQUASH - rank * lift };
}

export interface LayerViewOptions {
  readonly lift: number;
  /** Width to height ratio of the frame; defaults to LAYER_VIEW_ASPECT. */
  readonly aspect?: number;
  readonly animation?: FoldAnimation;
}

export interface LayerView {
  readonly markup: string;
  /** Frames every drawn facet with the usual padding, at the frame's aspect ratio. */
  readonly viewBox: string;
}

/** Positions of the distinct layers in the stack, bottom first. */
function layerRanks(state: PaperState): Map<number, number> {
  const ranks = new Map<number, number>();
  for (const z of [...new Set(state.facets.map((f) => f.z))].sort((a, b) => a - b)) {
    ranks.set(z, ranks.size);
  }
  return ranks;
}

/** The folded stack seen obliquely, with every layer lifted by `lift`. */
export function renderLayers(state: PaperState, options: LayerViewOptions): LayerView {
  const size = state.size;
  const ranks = layerRanks(state);
  const rankOf = (facet: Facet): number => ranks.get(facet.z) ?? 0;
  const drawn = drawnFacets(state, options.animation)
    .filter((d) => area(d.poly) > 0)
    .sort((a, b) => rankOf(a.facet) - rankOf(b.facet));
  const parts: string[] = [];
  const screenPoints: Vec[] = [];
  const animation = options.animation;
  for (const d of drawn) {
    const rank = rankOf(d.facet);
    let screen = d.poly.map((p) => projectLayer(p, rank, options.lift, size));
    if (d.moving && animation && animation.progress < 1) {
      // The flap really rotates out of the plane: raise each vertex by its
      // height above the sheet, d·sin(angle) with d its distance from the
      // fold line before the fold. The vertices of `d.poly` are the partially
      // flipped images of `currentPolygon(d.facet)` in the same order.
      const angle = animation.progress * Math.PI;
      const original = currentPolygon(d.facet);
      screen = screen.map((p, i) => {
        const source = original[i];
        const height = source
          ? Math.abs(signedDistance(animation.line, source)) * Math.sin(angle)
          : 0;
        return { x: p.x, y: p.y - height * LAYER_HEIGHT };
      });
    }
    screenPoints.push(...screen);
    const classes = ['layer-facet', d.flipped ? 'facet-back' : 'facet-front'];
    if (d.moving) classes.push('facet-moving');
    parts.push(
      `<polygon class="${classes.join(' ')}" data-id="${d.facet.id}" points="${screen
        .map((p) => `${fmt(p.x)},${fmt(p.y)}`)
        .join(' ')}" style="fill:${facetFill(d.flipped)}" />`,
    );
  }
  const box =
    screenPoints.length > 0
      ? bounds(screenPoints)
      : { minX: 0, minY: 0, maxX: size * (1 + LAYER_SHEAR), maxY: size * LAYER_SQUASH };
  const pad = VIEW_PADDING * size;
  let w = box.maxX - box.minX + 2 * pad;
  let h = box.maxY - box.minY + 2 * pad;
  const aspect = options.aspect ?? LAYER_VIEW_ASPECT;
  if (w < aspect * h) w = aspect * h;
  else h = w / aspect;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return {
    markup: parts.join(''),
    viewBox: `${fmt(cx - w / 2)} ${fmt(cy - h / 2)} ${fmt(w)} ${fmt(h)}`,
  };
}

/** Convert a point from the SVG user space (y down) back to model space (y up). */
export const fromSvgPoint = (p: Vec, size: number): Vec => ({ x: p.x, y: size - p.y });

/** Convert a model point to SVG user space. */
export const toSvgPoint = (p: Vec, size: number): Vec => ({ x: p.x, y: size - p.y });
