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
  clipPolygon,
  compose,
  lineDirection,
  partialFlip,
  reflection,
  scale,
} from './geometry';
import { type Facet, type PaperState, currentPolygon, isFlipped } from './paper';

/** Pixel size of the drawing area for one sheet unit. */
export const VIEW_SIZE = 400;
/** Padding around the sheet, in sheet units. */
export const VIEW_PADDING = 0.1;

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

/** The common viewBox used by both views, in sheet units. */
export const viewBox = (size: number): string =>
  `${-VIEW_PADDING * size} ${-VIEW_PADDING * size} ${size * (1 + 2 * VIEW_PADDING)} ${
    size * (1 + 2 * VIEW_PADDING)
  }`;

const fmt = (n: number): string => (Math.abs(n) < 1e-12 ? '0' : n.toFixed(5));

/** SVG `points` attribute. The y axis is flipped so the model's +y points up. */
export const pointsAttr = (poly: Polygon, size: number): string =>
  poly.map((p) => `${fmt(p.x)},${fmt(size - p.y)}`).join(' ');

const facetFill = (flipped: boolean): string => (flipped ? BACK_COLOR : FRONT_COLOR);

function facetMarkup(poly: Polygon, flipped: boolean, size: number, extraClass = ''): string {
  if (area(poly) <= 0) return '';
  return `<polygon class="facet ${flipped ? 'facet-back' : 'facet-front'} ${extraClass}" points="${pointsAttr(
    poly,
    size,
  )}" fill="${facetFill(flipped)}" />`;
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
    parts.push(facetMarkup(d.poly, d.flipped, size, d.moving ? 'facet-moving' : ''));
  }
  if (options.preview) parts.push(previewMarkup(options.preview, size));
  return parts.join('');
}

/** Markup for the unfolded sheet: every facet in sheet coordinates plus creases. */
export function renderUnfolded(state: PaperState): string {
  const size = state.size;
  const parts: string[] = [];
  parts.push(
    `<rect class="sheet-outline" x="0" y="0" width="${fmt(size)}" height="${fmt(size)}" />`,
  );
  for (const facet of state.facets) {
    parts.push(
      `<polygon class="unfolded-facet ${isFlipped(facet) ? 'unfolded-back' : ''}" points="${pointsAttr(
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

/** Convert a point from the SVG user space (y down) back to model space (y up). */
export const fromSvgPoint = (p: Vec, size: number): Vec => ({ x: p.x, y: size - p.y });

/** Convert a model point to SVG user space. */
export const toSvgPoint = (p: Vec, size: number): Vec => ({ x: p.x, y: size - p.y });
