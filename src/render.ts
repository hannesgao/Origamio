/**
 * SVG rendering of the folded sheet and the unfolded crease pattern. The
 * functions return SVG markup strings so they stay free of DOM state; the UI
 * assigns them to `innerHTML` of an `<svg>` element.
 */
import {
  type Line,
  type Polygon,
  type Side,
  type Vec,
  add,
  area,
  bounds,
  clipPolygon,
  lineDirection,
  scale,
} from './geometry';
import { type Facet, type PaperState, currentPolygon, isFlipped } from './paper';
import { type StepAnimation, hinges, placePanels, stepPose } from './rigid';

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
export type FoldAnimation = StepAnimation;

export interface FoldPreview {
  readonly line: Line;
  /** Which side would be flipped, when the user hovers one. */
  readonly side?: Side;
}

/** Snap markers drawn over the folded sheet while a fold line is drawn. */
export interface SnapMarkers {
  /** Every point the endpoints can snap to; drawn faintly. */
  readonly targets: readonly Vec[];
  /** The point the pointer is snapped to right now. */
  readonly active?: Vec;
  /** The first endpoint, once it is set. */
  readonly anchor?: Vec;
  /** Marker radius in model units (so that it is constant on screen). */
  readonly radius: number;
}

export interface FoldedViewOptions {
  readonly animation?: FoldAnimation;
  readonly preview?: FoldPreview;
  readonly snap?: SnapMarkers;
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
export function cameraViewBox(size: number, camera: Camera, aspect = 1): string {
  // The shorter side of the frame shows the padded sheet at zoom 1; the
  // longer side shows more, so a wide frame never crops the sheet.
  const extent = visibleExtent(size, camera);
  const width = aspect >= 1 ? extent * aspect : extent;
  const height = aspect >= 1 ? extent : extent / aspect;
  const x = camera.centre.x - width / 2;
  const y = size - camera.centre.y - height / 2;
  return `${fmt(x)} ${fmt(y)} ${fmt(width)} ${fmt(height)}`;
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
  const reach = size * 16;
  return [add(line.a, scale(d, -reach)), add(line.a, scale(d, reach))];
}

/** The view rectangle, slightly larger than the sheet. */
function viewRect(size: number): Polygon {
  // Generous: frames can be wide and zoomed out, so shade well past the sheet.
  const lo = -4 * size;
  const hi = 5 * size;
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

function snapMarkup(snap: SnapMarkers, size: number): string {
  const circle = (p: Vec, radius: number, cls: string): string =>
    `<circle class="${cls}" cx="${fmt(p.x)}" cy="${fmt(size - p.y)}" r="${fmt(radius)}" />`;
  const parts = snap.targets.map((p) => circle(p, snap.radius, 'snap-target'));
  if (snap.anchor) parts.push(circle(snap.anchor, snap.radius * 1.6, 'snap-anchor'));
  if (snap.active) parts.push(circle(snap.active, snap.radius * 2.2, 'snap-active'));
  return parts.join('');
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
  // Mid-step the sheet is the rigid model with the step's creases part way
  // round, seen from straight above: nearer panels are drawn later.
  const panels = placePanels(state, hinges(state), stepPose(state, 0, animation));
  return panels
    .map((panel) => ({
      facet: panel.facet,
      poly: panel.points.map((p) => ({ x: p.x, y: p.y })),
      flipped: panel.normal.z < 0,
      moving: animation.movedIds.has(panel.facet.id),
      height: panel.points.reduce((sum, p) => sum + p.z, 0) / panel.points.length,
    }))
    .sort((a, b) => a.height - b.height || a.facet.z - b.facet.z);
}

/** Markup for the folded sheet, bottom layer first. */
export function renderFolded(state: PaperState, options: FoldedViewOptions = {}): string {
  const size = state.size;
  const parts: string[] = [];
  for (const d of drawnFacets(state, options.animation)) {
    parts.push(facetMarkup(d.facet.id, d.poly, d.flipped, size, d.moving ? 'facet-moving' : ''));
  }
  if (options.preview) parts.push(previewMarkup(options.preview, size));
  if (options.snap) parts.push(snapMarkup(options.snap, size));
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

export const fromSvgPoint = (p: Vec, size: number): Vec => ({ x: p.x, y: size - p.y });

/** Convert a model point to SVG user space. */
export const toSvgPoint = (p: Vec, size: number): Vec => ({ x: p.x, y: size - p.y });
