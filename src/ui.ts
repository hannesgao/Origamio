/**
 * The interactive application: toolbar, the folded view with drag-to-fold
 * interaction, the live unfolded view, statistics, undo/reset and presets.
 */
import {
  type Line,
  type Side,
  type Vec,
  add,
  distance,
  line,
  perpendicularBisector,
  scale,
  sideOf,
  sub,
  vec,
} from './geometry';
import { type Language, LANGUAGES, language, setLanguage, t } from './i18n';
import { type en } from './i18n/en';
import { LIBRARY } from './library';
import { type SceneStyle, createScene } from './scene3d';
import { type Snap, type SnapTargets, snapTargets, snapTo } from './snap';
import {
  type Orbit,
  DEFAULT_OPENING,
  DEFAULT_THICKNESS_MM,
  MAX_THICKNESS_MM,
  SHEET_MM,
  THICKNESS_STEPS_MM,
  DEFAULT_ORBIT,
  MAX_OPENING,
  type NamedView,
  namedViews,
  OPENING_STEPS,
  MAX_ORBIT_ZOOM,
  MIN_ORBIT_ZOOM,
  autoFrame,
  wrapAngle,
} from './view3d';
import { type SolveRequest, createSheetSolver } from './solver';
import { Timeline } from './timeline';
import {
  type FoldStep,
  type Paper,
  stepToJson,
  type Sequence,
  type ViewFrame,
  DEFAULT_BACK,
  DEFAULT_FRONT,
  DEFAULT_PAPER,
  MAX_PAPER_SIDE,
  isHexColour,
  SequenceError,
  parseSequence,
  serializeSequence,
} from './sequence';
import {
  type FoldOptions,
  type LayerSelection,
  type PaperState,
  ALL_LAYERS,
  createPaper,
  facetCount,
  facetsAt,
  fold,
  foldedPoints,
  maxLayers,
  topLayers,
  bottomLayers,
  type Placement,
} from './paper';
import {
  type Camera,
  type FoldAnimation,
  type SnapMarkers,
  BACK_COLOR,
  FRONT_COLOR,
  cameraViewBox,
  clampZoom,
  defaultCamera,
  fitCamera,
  fromSvgPoint,
  renderFolded,
  renderUnfolded,
  viewBox,
} from './render';

export const ANIMATION_MS = 800;
/** Pause between two steps when playing, at speed 1. */
const STEP_GAP_MS = 250;
/** Width of one step on the timeline track, in CSS pixels. */
const CLIP_WIDTH = 104;
const SPEEDS: readonly number[] = [0.25, 0.5, 1, 2, 4];
const SPEED_KEY = 'origamio.speed';
/** Drags shorter than this (in sheet units) are ignored. */
const MIN_DRAG = 0.02;

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const child of children) node.append(child);
  return node;
}

function svgElement(width: number, height: number, className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox(width, height));
  svg.setAttribute('class', className);
  return svg;
}

const FIT_ICON =
  '<path d="M3 7V4a1 1 0 0 1 1-1h3M13 3h3a1 1 0 0 1 1 1v3M17 13v3a1 1 0 0 1-1 1h-3M7 17H4a1 1 0 0 1-1-1v-3" />' +
  '<rect x="7" y="7" width="6" height="6" rx="1" />';
const FULL_ICON = '<rect x="3" y="3" width="14" height="14" rx="2" />';
/** A slab seen in perspective: the far edge shorter than the near one. */
const PERSPECTIVE_ICON = '<path d="M7.5 4.5h5l3.5 11h-12Z" /><path d="M8.3 8.5h3.4" />';
/** A sheet with a fold line across it. */
const LINE_ICON =
  '<rect x="3.5" y="3.5" width="13" height="13" rx="1.5" /><path d="M3.5 16.5 16.5 3.5" />';
/** One point brought onto another. */
const POINT_ICON =
  '<circle cx="5.5" cy="14.5" r="1.7" /><circle cx="14.5" cy="5.5" r="1.7" /><path d="M7 13c1.5-3.5 3.5-5.5 6-6.5" /><path d="m10.5 6.8 2.5-.3-.3 2.5" />';
/** Four-way arrows. */
const MOVE_ICON =
  '<path d="M10 3v14M3 10h14" /><path d="m7.5 5.5 2.5-2.5 2.5 2.5M7.5 14.5l2.5 2.5 2.5-2.5M5.5 7.5 3 10l2.5 2.5M14.5 7.5 17 10l-2.5 2.5" />';
/** Layers of a stack. */
const LAYERS_ICON =
  '<path d="m3 7 7-3.5L17 7l-7 3.5z" /><path d="m3 10.5 7 3.5 7-3.5M3 14l7 3.5 7-3.5" />';
/** A box seen from the front, the side, the top, and at an angle. */
const VIEW_ICONS: Record<NamedView['id'], string> = {
  front: '<rect x="3.5" y="6.5" width="10" height="10" rx="1" /><path d="M6.5 6.5v-3h10v10h-3" />',
  side: '<path d="M3.5 3.5h7v13h-7z" /><path d="m10.5 3.5 6 3v13l-6-3" />',
  top: '<path d="m3.5 7.5 6.5-4 6.5 4-6.5 4z" /><path d="M3.5 7.5v6l6.5 4v-6m6.5-4v6l-6.5 4" />',
  isometric:
    '<path d="m10 3 6.5 3.75v6.5L10 17l-6.5-3.75v-6.5z" /><path d="M10 10.25 16.5 6.75M10 10.25V17M10 10.25 3.5 6.75" />',
};
/** A turn back to the start. */
const RESET_ICON = '<path d="M4.5 10a5.5 5.5 0 1 0 1.8-4.1" /><path d="M4.5 3.5v3h3" />';
const LAYOUT_ICONS: Record<Layout, string> = {
  'side-by-side':
    '<rect x="2.5" y="4" width="4.5" height="12" rx="1" /><rect x="8.5" y="4" width="4.5" height="12" rx="1" /><rect x="14.5" y="4" width="3" height="12" rx="1" />',
  'folded-large':
    '<rect x="2.5" y="4" width="9" height="12" rx="1" /><rect x="13" y="4" width="4.5" height="5" rx="1" /><rect x="13" y="11" width="4.5" height="5" rx="1" />',
  focus: '<rect x="2.5" y="4" width="15" height="12" rx="1" />',
};
const RAIL_ICONS = {
  step: '<path d="M4 15.5 14.5 5a1.5 1.5 0 0 1 2.1 2.1L6.1 17.6 3 18Z" /><path d="M12.5 7l2.1 2.1" />',
  paper:
    '<path d="M4 3.5h8l4 4v9A1.5 1.5 0 0 1 14.5 18h-9A1.5 1.5 0 0 1 4 16.5Z" /><path d="M12 3.5v4h4" />',
  library:
    '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H9v14H5.5A1.5 1.5 0 0 1 4 15.5Z" /><path d="M11 3h3.5A1.5 1.5 0 0 1 16 4.5v11a1.5 1.5 0 0 1-1.5 1.5H11Z" /><path d="M6 7h1.5M12.5 7H14" />',
  file: '<path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H8l2 2h5.5A1.5 1.5 0 0 1 17 7.5v7A1.5 1.5 0 0 1 15.5 16h-11A1.5 1.5 0 0 1 3 14.5Z" />',
  keys: '<rect x="2.5" y="5" width="15" height="10" rx="1.5" /><path d="M6 8h1M9 8h1M12 8h1M15 8h.01M6 11h1M9 11h1M12 11h1M15 11h.01M7 13.5h6" />',
};
const CLOSE_ICON = '<path d="m5 5 10 10M15 5 5 15" />';
const TRANSPORT_ICONS = {
  start: '<path d="M5 4v12" /><path d="M15 4 7.5 10 15 16Z" />',
  back: '<path d="M14 4 6.5 10 14 16Z" />',
  play: '<path d="M6 4l10 6-10 6Z" />',
  pause: '<path d="M6 4v12" /><path d="M14 4v12" />',
  forward: '<path d="M6 4l7.5 6L6 16Z" />',
  end: '<path d="M15 4v12" /><path d="M5 4l7.5 6L5 16Z" />',
};
const IMPORT_ICON = '<path d="M10 3v10" /><path d="m6 9 4 4 4-4" /><path d="M4 16h12" />';
const EXPORT_ICON = '<path d="M10 13V3" /><path d="m6 7 4-4 4 4" /><path d="M4 16h12" />';
const NEW_ICON = '<path d="M10 4v12" /><path d="M4 10h12" />';
const COLLAPSE_ICON = '<path d="m5 8 5 5 5-5" />';
const SNAP_ICON =
  '<path d="M6 3v7a4 4 0 0 0 8 0V3" /><path d="M4 3h4M12 3h4" /><path d="M4 8h4M12 8h4" />';
const SNAP_KEY = 'origamio.snap';
/** Each language by its own name, so that a visitor finds theirs whatever the page is in. */
const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  zh: '中文',
  ja: '日本語',
  de: 'Deutsch',
};
/** How close the pointer must be to a corner, midpoint or edge, in CSS pixels. */
const SNAP_PIXELS = 10;

/** The build time as shown in the status bar: German local time, to the minute. */
export function buildStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}
const GITHUB_ICON =
  '<path d="M10 2.5a7.5 7.5 0 0 0-2.37 14.62c.37.07.51-.16.51-.36v-1.3c-2.09.45-2.53-1-2.53-1-.34-.87-.83-1.1-.83-1.1-.68-.46.05-.45.05-.45.75.05 1.15.77 1.15.77.67 1.14 1.75.81 2.18.62.07-.48.26-.81.47-1-1.67-.19-3.42-.83-3.42-3.7 0-.82.29-1.49.77-2.01-.08-.19-.33-.95.07-1.98 0 0 .63-.2 2.06.77a7.2 7.2 0 0 1 3.76 0c1.43-.97 2.06-.77 2.06-.77.4 1.03.15 1.79.07 1.98.48.52.77 1.19.77 2.01 0 2.88-1.75 3.51-3.43 3.7.27.23.51.69.51 1.39v2.06c0 .2.14.44.52.36A7.5 7.5 0 0 0 10 2.5Z" fill="currentColor" stroke="none" />';
const MORE_ICON =
  '<circle cx="5" cy="10" r="1.4" /><circle cx="10" cy="10" r="1.4" /><circle cx="15" cy="10" r="1.4" />';

/** A small inline icon drawn with strokes in the current text colour. */
function icon(paths: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths;
  return svg;
}

/** The logo: a square sheet with one corner folded over to show its back. */
function brandMark(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('class', 'brand-mark');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    `<rect width="32" height="32" rx="7" fill="${FRONT_COLOR}" />` +
    `<path d="M4 28 28 4v20a4 4 0 0 1-4 4Z" fill="${BACK_COLOR}" />`;
  return svg;
}

/** How the view cards share the workspace. */
type Layout = 'side-by-side' | 'folded-large' | 'focus';
const LAYOUTS: readonly Layout[] = ['side-by-side', 'folded-large', 'focus'];
const LAYOUT_KEY = 'origamio.layout';
/** Panels that open from the icon rail on the left. */
type Panel = 'library' | 'paper' | 'step' | 'file' | 'keys';
const PANELS: readonly Panel[] = ['library', 'paper', 'step', 'file', 'keys'];
const PANEL_KEY = 'origamio.panel';

/** Sheet shapes offered in the Paper panel; the longer side is always 1. */
const PAPER_PRESETS: readonly {
  readonly id: string;
  readonly label: () => string;
  readonly paper: { readonly width: number; readonly height: number };
}[] = [
  { id: 'square', label: () => t.paper.square, paper: { width: 1, height: 1 } },
  { id: 'a-series', label: () => t.paper.aSeries, paper: { width: 1, height: 0.7071 } },
  { id: '4-3', label: () => '4:3', paper: { width: 1, height: 0.75 } },
  { id: '3-2', label: () => '3:2', paper: { width: 1, height: 0.6667 } },
  { id: '16-9', label: () => '16:9', paper: { width: 1, height: 0.5625 } },
];

/** Face colour pairs offered in the Paper panel. */
const COLOUR_PRESETS: readonly {
  readonly id: keyof typeof en.paper.colours;
  readonly front: string;
  readonly back: string;
}[] = [
  { id: 'orange', front: DEFAULT_FRONT, back: DEFAULT_BACK },
  { id: 'kami', front: '#d7263d', back: '#f6f1e7' },
  { id: 'blue', front: '#2b5fb3', back: '#f2f5fb' },
  { id: 'green', front: '#3f8f5a', back: '#f3f0dc' },
  { id: 'kraft', front: '#c9a26b', back: '#a67c48' },
  { id: 'gold', front: '#24201c', back: '#d4a53a' },
];

/** Same size, colours aside. */
const sameSize = (a: Paper, b: Paper): boolean =>
  Math.abs(a.width - b.width) < 1e-6 && Math.abs(a.height - b.height) < 1e-6;
type Faces = Pick<Paper, 'front' | 'back'>;
const sameColours = (a: Faces, b: Faces): boolean =>
  a.front.toLowerCase() === b.front.toLowerCase() && a.back.toLowerCase() === b.back.toLowerCase();
const samePaper = (a: Paper, b: Paper): boolean => sameSize(a, b) && sameColours(a, b);

const describePaper = (paper: Paper): string => {
  const preset = PAPER_PRESETS.find((p) => sameSize({ ...paper, ...p.paper }, paper));
  const portrait = PAPER_PRESETS.find((p) =>
    sameSize({ ...paper, width: p.paper.height, height: p.paper.width }, paper),
  );
  const dims = `${+paper.width.toFixed(4)} × ${+paper.height.toFixed(4)}`;
  if (preset) return `${preset.label()} (${dims})`;
  if (portrait) return `${t.paper.portrait(portrait.label())} (${dims})`;
  return `${t.paper.custom} (${dims})`;
};
const DRAWER_KEY = 'origamio.drawer';
/** Below this width the views sit behind tabs and the panel floats over the workspace. */
const NARROW_QUERY = '(max-width: 1339px)';
/** The view shown on its own: on narrow screens, and in the Focus layout. */
type ViewTab = 'folded' | 'unfolded' | 'solid';
const VIEW_TABS: readonly ViewTab[] = ['folded', 'unfolded', 'solid'];
const TAB_KEY = 'origamio.tab';
/** Which secondary view the tabbed card of the folded-large layout shows. */
type SecondaryTab = 'unfolded' | 'solid';
const SECONDARY_TABS: readonly SecondaryTab[] = ['unfolded', 'solid'];
const SECONDARY_KEY = 'origamio.secondary';
const PERSPECTIVE_KEY = 'origamio.perspective';

/** Read a remembered preference; storage may be unavailable or blocked. */
function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the preference simply does not persist.
  }
}

/** What a left-button drag on the folded sheet does. */
/** What a drag on the folded sheet does: draw the fold line, bring a point onto another, or pan. */
type Tool = 'fold' | 'point' | 'move';

/** An in-flight pan or pinch gesture on the folded view. */
type Navigation = { readonly kind: 'pan'; readonly pointerId: number } | { readonly kind: 'pinch' };

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'dragging'; readonly from: Vec; readonly to: Vec; readonly snap?: Snap }
  | { readonly kind: 'choose-side'; readonly line: Line; readonly hover?: Side }
  | {
      readonly kind: 'animating';
      readonly animation: FoldAnimation;
      /** The sheet being shown: after the part of the step that is playing. */
      readonly state: PaperState;
      readonly start: number;
    };

export interface App {
  readonly root: HTMLElement;
  readonly timeline: Timeline;
  /** Apply a fold immediately (no animation). Returns false when nothing moved. */
  fold(line: Line, side: Side, layers?: LayerSelection): boolean;
  /** Replace the sheet and the timeline with `sequence`; plays it when asked. */
  loadSequence(sequence: Sequence, play?: boolean): Promise<void>;
  /** Every step on the timeline, applied and pending, as a sequence. */
  exportSequence(): Sequence;
  /** Steps on the timeline that have not been applied yet. */
  readonly pending: readonly FoldStep[];
  deleteStep(index: number): void;
  moveStep(from: number, to: number): void;
  renameStep(index: number, label: string): void;
  undoEdit(): void;
  redoEdit(): void;
  /** The sheet being folded. */
  readonly paper: Paper;
  setPaper(paper: Paper): void;
  setColours(front: string, back: string): void;
  stepForward(): Promise<void>;
  stepBack(): void;
  jumpTo(index: number): void;
  play(): void;
  pause(): void;
  undo(): void;
  reset(): void;
  readonly state: PaperState;
  readonly camera: Camera;
  fitView(): void;
  fullView(): void;
  /** Take the app off the page: listeners on the document and window, the scene, the solver. */
  dispose(): void;
}

export function createApp(root: HTMLElement): App {
  let paper: Paper = DEFAULT_PAPER;
  const timeline = new Timeline(createPaper(paper.width, paper.height));
  /** The clip picked on the track (0-based step index), if any. */
  let selected: number | null = null;
  let phase: Phase = { kind: 'idle' };
  let queue: Promise<void> = Promise.resolve();
  // The 3D view is solved off the main thread when possible; sheets are
  // named so the solver can reuse what it derived from them.
  const solver = createSheetSolver();
  const stateIds = new WeakMap<PaperState, string>();
  let stateSerial = 0;
  const idOf = (state: PaperState): string => {
    let id = stateIds.get(state);
    if (id === undefined) {
      id = String(++stateSerial);
      stateIds.set(state, id);
    }
    return id;
  };
  let animationSerial = 0;
  let solveInFlight = false;
  let solvePending: SolveRequest | null = null;
  let lastSolved = '';
  let lastStyled = '';
  const solveKey = (r: SolveRequest): string =>
    `${r.stateId}|${r.opening}|${r.thickness}|${r.animation ? `${r.animation.id}:${r.animation.progress}` : ''}`;
  const styleKey = (): string => `${JSON.stringify(sceneStyle())}|${highlighted ?? ''}`;
  /** Solve the latest request only: while one runs, newer ones replace each other. */
  const requestSolve = (request: SolveRequest): void => {
    if (solveInFlight) {
      solvePending = request;
      return;
    }
    const key = solveKey(request);
    // The same sheet in the same pose: only the colours, thickness or
    // projection can have changed, and those need no solve.
    if (key === lastSolved) {
      const style = styleKey();
      if (style === lastStyled) return;
      lastStyled = style;
      scene.restyle(sceneStyle(), highlighted);
      return;
    }
    solveInFlight = true;
    solver
      .solve(request)
      .then(
        (solid) => {
          lastSolved = key;
          lastStyled = styleKey();
          scene.update(solid, sceneStyle(), orbit, frameOf(timeline.state), highlighted);
        },
        (error: unknown) => {
          console.error('3D solve failed', error);
        },
      )
      .finally(() => {
        solveInFlight = false;
        if (solvePending) {
          const next = solvePending;
          solvePending = null;
          requestSolve(next);
        }
      });
  };
  let camera: Camera = defaultCamera(paper.width, paper.height);
  let tool: Tool = 'fold';
  /** Fold line endpoints snap to corners, midpoints and edges unless Alt is held. */
  let snapEnabled = remembered(SNAP_KEY) !== 'off';
  /** The snap under the pointer while nothing is being drawn; shown as a ring. */
  let hoverSnap: Snap | null = null;
  let spaceHeld = false;
  const rememberedLayout = remembered(LAYOUT_KEY);
  let layout: Layout = LAYOUTS.some((l) => l === rememberedLayout)
    ? (rememberedLayout as Layout)
    : 'folded-large';
  const rememberedPanel = remembered(PANEL_KEY);
  let openPanel: Panel | null = PANELS.some((p) => p === rememberedPanel)
    ? (rememberedPanel as Panel)
    : null;
  let drawerOpen = remembered(DRAWER_KEY) !== 'closed';
  const rememberedSecondary = remembered(SECONDARY_KEY);
  let secondaryTab: SecondaryTab = SECONDARY_TABS.some((tab) => tab === rememberedSecondary)
    ? (rememberedSecondary as SecondaryTab)
    : 'unfolded';
  /** How the 3D view is turned; dragging on it changes this. */
  let orbit: Orbit = DEFAULT_ORBIT;
  /** How the loaded model stands, for the fixed views; undefined means the sheet's axes. */
  let viewFrame: ViewFrame | undefined;
  // A model that does not say how it stands gets a frame from its shape, per sheet.
  let autoFrameFor: { state: PaperState; frame: ViewFrame } | null = null;
  const frameOf = (state: PaperState): ViewFrame => {
    if (viewFrame) return viewFrame;
    if (autoFrameFor?.state !== state) autoFrameFor = { state, frame: autoFrame(state) };
    return autoFrameFor.frame;
  };
  const rememberedTab = remembered(TAB_KEY);
  let activeTab: ViewTab = VIEW_TABS.some((tab) => tab === rememberedTab)
    ? (rememberedTab as ViewTab)
    : 'folded';
  const rememberedSpeed = Number(remembered(SPEED_KEY));
  let speed = SPEEDS.includes(rememberedSpeed) ? rememberedSpeed : 1;
  let playing = false;
  /** Index of the step whose line is being redrawn on the folded sheet. */
  let redrawing: number | null = null;
  let sequenceName = t.file.defaultName;
  let timelineMessage = '';
  let timelineError = false;
  // Listeners on the document and the window go when the app is disposed.
  const alive = new AbortController();
  const signal = alive.signal;
  let navigation: Navigation | null = null;
  /** Last known position of every pointer that is down on the folded view. */
  const pointers = new Map<number, Vec>();

  // --- DOM -----------------------------------------------------------------
  const foldedSvg = svgElement(paper.width, paper.height, 'view folded-view');
  const unfoldedSvg = svgElement(paper.width, paper.height, 'view unfolded-view');
  const views = [foldedSvg, unfoldedSvg];

  const layerAll = el('input', { type: 'radio', name: 'layers', value: 'all', checked: '' });
  const layerTop = el('input', { type: 'radio', name: 'layers', value: 'top' });
  const layerCount = el('input', {
    type: 'number',
    min: '1',
    step: '1',
    value: '1',
    'aria-label': t.folded.layerCount,
  });

  const layoutButtons = LAYOUTS.map((id) =>
    el(
      'button',
      { type: 'button', title: t.layouts[id].title, 'aria-pressed': 'false', 'data-layout': id },
      [icon(LAYOUT_ICONS[id]), el('span', { class: 'btn-label' }, [t.layouts[id].label])],
    ),
  );
  const layoutSwitch = el(
    'div',
    { class: 'tool-toggle layout-switch', role: 'group', 'aria-label': t.layouts.group },
    layoutButtons,
  );
  // The language, by its own name; a change rebuilds the page in the new words.
  const languageSelect = el('select', { class: 'lang-select ctl', 'aria-label': t.language });
  for (const lang of LANGUAGES) {
    const option = el('option', { value: lang }, [LANGUAGE_NAMES[lang]]);
    if (lang === language()) option.selected = true;
    languageSelect.append(option);
  }

  /** A shipped sequence's name and description, in the visitor's language. */
  const presetText = (id: string, sequence: Sequence): { name: string; description: string } => {
    const known = t.presets[id];
    return {
      name: known?.name ?? sequence.name,
      description: known?.description ?? sequence.description ?? '',
    };
  };
  const presetButtons = LIBRARY.map(({ id, sequence }) => {
    const text = presetText(id, sequence);
    return el(
      'button',
      { type: 'button', class: 'preset', 'data-preset': id, title: text.description },
      [
        el('span', { class: 'preset-label' }, [text.name]),
        el('span', { class: 'preset-desc' }, [text.description]),
      ],
    );
  });

  // --- Transport and track (the dock at the bottom) --------------------------
  const transport = (name: keyof typeof TRANSPORT_ICONS, title: string): HTMLButtonElement =>
    el('button', { type: 'button', class: 'btn transport', title }, [icon(TRANSPORT_ICONS[name])]);
  const startButton = transport('start', t.transport.start);
  const backButton = transport('back', t.transport.back);
  const playButton = transport('play', t.transport.play);
  const forwardButton = transport('forward', t.transport.forward);
  const endButton = transport('end', t.transport.end);
  const speedSelect = el('select', { class: 'tl-speed ctl', 'aria-label': t.transport.speedLabel });
  for (const value of SPEEDS) {
    const option = el('option', { value: String(value) }, [`${value}×`]);
    if (value === speed) option.selected = true;
    speedSelect.append(option);
  }
  // Only shown on phones, where the status bar is hidden and the transport is fixed.
  const positionReadout = el('span', { class: 'timeline-position ctl' }, ['00 / 00']);
  const drawerToggle = el(
    'button',
    {
      type: 'button',
      class: 'btn collapse drawer-toggle',
      'aria-expanded': 'true',
      title: t.transport.hideTrack,
    },
    [icon(COLLAPSE_ICON), el('span', { class: 'btn-label' }, [t.transport.track])],
  );
  // The track: a ruler with one tick per step, the step clips, and a playhead
  // that sits on the boundary after the last applied step.
  const ruler = el('div', { class: 'tl-ruler' });
  const track = el('div', { class: 'tl-track', role: 'list', 'aria-label': t.transport.steps });
  const playhead = el('div', { class: 'tl-playhead' }, [el('div', { class: 'tl-playhead-head' })]);
  const lanes = el('div', { class: 'tl-lanes' }, [ruler, track, playhead]);
  const scroller = el('div', { class: 'tl-scroll' }, [lanes]);
  const drawer = el('div', { class: 'drawer' }, [scroller]);
  const timelineHead = el('div', { class: 'card-head timeline-head' }, [
    el('h2', {}, [t.transport.timeline]),
    el('div', { class: 'card-tools timeline-tools' }, [
      el('div', { class: 'transport-group' }, [
        startButton,
        backButton,
        playButton,
        forwardButton,
        endButton,
      ]),
      el('label', { class: 'tl-speed-label' }, [
        el('span', { class: 'btn-label' }, [t.transport.speed]),
        speedSelect,
      ]),
      positionReadout,
      drawerToggle,
    ]),
  ]);
  const timelineCard = el('section', { class: 'card timeline-card' }, [timelineHead, drawer]);

  // --- File panel contents -----------------------------------------------------
  const nameInput = el('input', {
    type: 'text',
    class: 'name-input ctl',
    value: sequenceName,
    'aria-label': t.file.sequenceName,
    placeholder: t.file.sequenceName,
  });
  // The same name, editable in the header; the two inputs mirror each other.
  const projectName = el('input', {
    type: 'text',
    class: 'project-name',
    value: sequenceName,
    'aria-label': t.file.sequenceName,
    placeholder: t.file.untitled,
    spellcheck: 'false',
  });
  const setName = (name: string): void => {
    sequenceName = name;
    if (nameInput.value !== name) nameInput.value = name;
    if (projectName.value !== name) projectName.value = name;
    const shown = name.trim();
    document.title = shown ? `${shown} · Origamio` : 'Origamio';
  };
  const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: '' });
  const importButton = el(
    'button',
    { type: 'button', class: 'btn panel-action', title: t.file.importTitle },
    [icon(IMPORT_ICON), el('span', {}, [t.file.import])],
  );
  const exportButton = el(
    'button',
    { type: 'button', class: 'btn panel-action', title: t.file.exportTitle },
    [icon(EXPORT_ICON), el('span', {}, [t.file.export])],
  );
  const newButton = el(
    'button',
    { type: 'button', class: 'btn panel-action', title: t.file.newTitle },
    [icon(NEW_ICON), el('span', {}, [t.file.newSheet])],
  );
  const filePanel = el('div', { class: 'panel-section' }, [
    el('label', { class: 'field' }, [
      el('span', { class: 'field-label' }, [t.file.name]),
      nameInput,
    ]),
    el('div', { class: 'panel-actions' }, [exportButton, importButton, newButton]),
    el('p', { class: 'help' }, [t.file.help]),
  ]);

  // --- Paper panel ---------------------------------------------------------------
  const paperButtons = PAPER_PRESETS.map((preset) =>
    el(
      'button',
      {
        type: 'button',
        class: 'preset paper-preset',
        'data-paper': preset.id,
        'aria-pressed': 'false',
      },
      [el('span', { class: 'preset-label' }, [preset.label()])],
    ),
  );
  const paperWidth = el('input', {
    type: 'number',
    class: 'ctl',
    min: '0.1',
    max: String(MAX_PAPER_SIDE),
    step: '0.01',
    value: '1',
    'aria-label': t.paper.width,
  });
  const paperHeight = el('input', {
    type: 'number',
    class: 'ctl',
    min: '0.1',
    max: String(MAX_PAPER_SIDE),
    step: '0.01',
    value: '1',
    'aria-label': t.paper.height,
  });
  const paperApply = el('button', { type: 'button', class: 'btn panel-action' }, [t.paper.useSize]);
  const paperSwap = el(
    'button',
    { type: 'button', class: 'btn panel-action', title: t.paper.rotateTitle },
    [t.paper.rotate],
  );
  const paperCurrent = el('p', { class: 'help paper-current' }, ['']);
  const colourButtons = COLOUR_PRESETS.map((preset) =>
    el('button', {
      type: 'button',
      class: 'colour-preset',
      title: t.paper.colours[preset.id],
      'aria-label': t.paper.colours[preset.id],
      'aria-pressed': 'false',
      'data-colours': preset.id,
      style: `--swatch-front: ${preset.front}; --swatch-back: ${preset.back}`,
    }),
  );
  const frontInput = el('input', {
    type: 'color',
    value: DEFAULT_FRONT,
    'aria-label': t.paper.frontColour,
  });
  const backInput = el('input', {
    type: 'color',
    value: DEFAULT_BACK,
    'aria-label': t.paper.backColour,
  });
  const paperPanel = el('div', { class: 'panel-section' }, [
    paperCurrent,
    el('div', { class: 'preset-list' }, paperButtons),
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label' }, [t.paper.customField]),
      el('div', { class: 'size-row' }, [
        paperWidth,
        el('span', {}, ['×']),
        paperHeight,
        paperApply,
      ]),
    ]),
    paperSwap,
    el('p', { class: 'help' }, [t.paper.rewindHelp]),
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label' }, [t.paper.coloursField]),
      el('div', { class: 'colour-presets' }, colourButtons),
      el('div', { class: 'colour-row' }, [
        el('label', { class: 'colour-field' }, [frontInput, t.paper.front]),
        el('label', { class: 'colour-field' }, [backInput, t.paper.back]),
      ]),
    ]),
    el('p', { class: 'help' }, [t.paper.savedHelp]),
  ]);

  // --- Step panel (filled by renderStepPanel) ------------------------------------
  const stepPanel = el('div', { class: 'panel-section step-panel' });

  const keysTable = el(
    'table',
    { class: 'keys' },
    t.keys.map(([key, what]) =>
      el('tr', {}, [el('th', {}, [el('kbd', {}, [key])]), el('td', {}, [what])]),
    ),
  );
  const keysPanel = el('div', { class: 'panel-section' }, [keysTable]);

  // --- Status bar --------------------------------------------------------------
  const statusSheet = el('span', { class: 'status-item' }, [
    el('span', { class: 'status-swatches', 'aria-hidden': 'true' }, [
      el('i', { class: 'swatch swatch-front' }),
      el('i', { class: 'swatch swatch-back' }),
    ]),
    el('span', { class: 'status-sheet' }),
  ]);
  const statusSteps = el('span', { class: 'status-item status-steps' });
  const statusMessage = el('span', { class: 'status-message', role: 'status' });

  // --- Folded view controls ----------------------------------------------------
  const statFolds = el('span', { class: 'stat-value' }, ['0']);
  const statLayers = el('span', { class: 'stat-value' }, ['1']);
  const statFacets = el('span', { class: 'stat-value' }, ['1']);
  const statCursor = el('span', { class: 'stat-value' }, ['–']);
  const statCreases = el('span', { class: 'stat-value' }, ['0']);
  const hint = el('span', { class: 'status-text' });
  const statsRow = el('div', { class: 'card-stats' });
  const statusBar = el('div', { class: 'status-bar' }, [el('span', { class: 'status-dot' }), hint]);

  /** A tool button: an icon and a keyword (the keyword gives way on a narrow card). */
  const toolButton = (
    attributes: Record<string, string>,
    iconPaths: string,
    label: string,
  ): HTMLButtonElement =>
    el('button', { type: 'button', ...attributes }, [
      icon(iconPaths),
      el('span', { class: 'btn-label' }, [label]),
    ]);
  const toolFold = toolButton(
    { 'aria-pressed': 'true', title: t.folded.lineTitle },
    LINE_ICON,
    t.folded.line,
  );
  const toolPoint = toolButton(
    { 'aria-pressed': 'false', title: t.folded.pointTitle },
    POINT_ICON,
    t.folded.point,
  );
  const toolMove = toolButton(
    { 'aria-pressed': 'false', title: t.folded.moveTitle },
    MOVE_ICON,
    t.folded.move,
  );
  const fitButton = el('button', { type: 'button', class: 'btn fit', title: t.folded.fitTitle }, [
    icon(FIT_ICON),
    el('span', { class: 'btn-label' }, [t.folded.fit]),
  ]);
  const fullButton = el(
    'button',
    { type: 'button', class: 'btn full', title: t.folded.fullTitle },
    [icon(FULL_ICON), el('span', { class: 'btn-label' }, [t.folded.full])],
  );
  const zoomReadout = el('span', { class: 'zoom', title: t.folded.zoomTitle }, ['100%']);
  const snapButton = el(
    'button',
    {
      type: 'button',
      class: 'btn snap',
      'aria-pressed': String(snapEnabled),
      title: t.folded.snapTitle,
    },
    [icon(SNAP_ICON), el('span', { class: 'btn-label' }, [t.folded.snap])],
  );
  // On a narrow card the view buttons fold into this menu.
  const moreButton = el(
    'button',
    { type: 'button', class: 'btn more-toggle', title: t.folded.more, 'aria-haspopup': 'menu' },
    [icon(MORE_ICON)],
  );
  const layerControl = el(
    'fieldset',
    { class: 'segmented segmented-compact', title: t.folded.layersTitle },
    [
      el('span', { class: 'seg-icon' }, [icon(LAYERS_ICON)]),
      el('label', { class: 'seg' }, [layerAll, el('span', {}, [t.folded.all])]),
      el('label', { class: 'seg' }, [layerTop, el('span', {}, [t.folded.top]), layerCount]),
    ],
  );
  const viewTools = el('div', { class: 'card-tools' }, [
    el('div', { class: 'tool-toggle', role: 'group', 'aria-label': t.folded.dragTool }, [
      toolFold,
      toolPoint,
      toolMove,
    ]),
    layerControl,
    snapButton,
    fitButton,
    fullButton,
    moreButton,
  ]);

  const tabButtons = VIEW_TABS.map((tab) =>
    el('button', { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-tab': tab }, [
      t.tabs[tab],
    ]),
  );
  const viewTabs = el(
    'div',
    { class: 'view-tabs tool-toggle', role: 'tablist', 'aria-label': t.tabs.view },
    tabButtons,
  );

  // The folded-large layout shows one secondary view at a time; each card
  // carries a copy of the tab strip so the visible one can switch.
  const secondaryStrip = (): HTMLElement =>
    el(
      'div',
      { class: 'tool-toggle secondary-tabs', role: 'tablist', 'aria-label': t.tabs.secondary },
      SECONDARY_TABS.map((tab) =>
        el(
          'button',
          { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-secondary': tab },
          [t.tabs[tab]],
        ),
      ),
    );
  const unfoldedStrip = secondaryStrip();
  const solidStrip = secondaryStrip();
  const unfoldedTools = el('div', { class: 'card-tools' }, [unfoldedStrip]);
  const orbitReset = el('button', { type: 'button', class: 'btn', title: t.solid.resetTitle }, [
    icon(RESET_ICON),
    el('span', { class: 'btn-label' }, [t.solid.reset]),
  ]);
  // The fixed views, from how the loaded sequence says its model stands.
  let fixedViews: NamedView[] = namedViews(viewFrame);
  const viewButtons = fixedViews.map((view) =>
    el(
      'button',
      {
        type: 'button',
        'aria-pressed': 'false',
        'data-view': view.id,
        title: t.solid.views[view.id].title,
      },
      [
        icon(VIEW_ICONS[view.id]),
        el('span', { class: 'btn-label' }, [t.solid.views[view.id].short]),
      ],
    ),
  );
  // Perspective shows depth; off, the fixed views become true drawings.
  let perspective = remembered(PERSPECTIVE_KEY) !== 'off';
  const perspectiveButton = el(
    'button',
    {
      type: 'button',
      class: 'btn',
      'aria-pressed': String(perspective),
      title: t.solid.perspectiveTitle,
    },
    [icon(PERSPECTIVE_ICON), el('span', { class: 'btn-label' }, [t.solid.perspective])],
  );
  const solidTools = el('div', { class: 'card-tools' }, [
    solidStrip,
    el(
      'div',
      { class: 'tool-toggle', role: 'group', 'aria-label': t.solid.namedViews },
      viewButtons,
    ),
    perspectiveButton,
    orbitReset,
  ]);
  // Paper thickness in millimetres for a 15 cm sheet: a few presets, or any value typed.
  let thicknessMm = DEFAULT_THICKNESS_MM;
  const thicknessButtons = THICKNESS_STEPS_MM.map((mm) =>
    el(
      'button',
      {
        type: 'button',
        class: 'chip',
        'aria-pressed': String(mm === thicknessMm),
        title: t.solid.thicknessChip(mm, SHEET_MM / 10),
      },
      [mm === 0 ? '0' : String(mm)],
    ),
  );
  const thicknessInput = el('input', {
    type: 'number',
    class: 'chip-input',
    min: '0',
    max: String(MAX_THICKNESS_MM),
    step: '0.01',
    value: String(thicknessMm),
    'aria-label': t.solid.thicknessLabel,
    title: t.solid.thicknessTitle(MAX_THICKNESS_MM),
  });
  const thicknessControl = el(
    'span',
    { class: 'chips', role: 'group', 'aria-label': t.solid.thicknessGroup },
    [...thicknessButtons, thicknessInput, el('span', { class: 'chip-unit' }, [t.solid.mm])],
  );
  /** What the 3D card draws with: the sheet's colours, the ink, thickness and shadow. */
  const sceneStyle = (): SceneStyle => ({
    front: paper.front,
    back: paper.back,
    ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#2a211a',
    thickness: thicknessMm / SHEET_MM,
    shadow: true,
    perspective,
  });
  // How far every crease is opened from flat, in degrees: a few presets, or any value typed.
  let opening = DEFAULT_OPENING;
  const openingButtons = OPENING_STEPS.map((degrees) =>
    el(
      'button',
      {
        type: 'button',
        class: 'chip',
        'aria-pressed': String(degrees === opening),
        title: t.solid.openingChip(degrees),
      },
      [`${degrees}°`],
    ),
  );
  const openingInput = el('input', {
    type: 'number',
    class: 'chip-input',
    min: '0',
    max: String(MAX_OPENING),
    step: '0.5',
    value: String(opening),
    'aria-label': t.solid.openingLabel,
    title: t.solid.openingTitle(MAX_OPENING),
  });
  const openingControl = el(
    'span',
    { class: 'chips', role: 'group', 'aria-label': t.solid.openingGroup },
    [...openingButtons, openingInput, el('span', { class: 'chip-unit' }, ['°'])],
  );

  const stat = (value: HTMLElement, label: string): HTMLElement =>
    el('div', { class: 'stat' }, [value, el('span', { class: 'stat-label' }, [label])]);
  statsRow.append(
    stat(statFolds, t.folded.stats.folds),
    stat(statLayers, t.folded.stats.layers),
    stat(statFacets, t.folded.stats.facets),
    stat(statCursor, t.folded.stats.underCursor),
  );
  const creaseStats = el('div', { class: 'card-stats' }, [
    stat(statCreases, t.folded.stats.creases),
  ]);

  /**
   * Every view card has the same anatomy: a head with the title and its
   * statistics, one row of tools, the canvas, and a foot of one line for
   * parameters and hints, so that equal canvases give equal cards.
   */
  const card = (
    title: string,
    stats: HTMLElement,
    tools: HTMLElement,
    frame: HTMLElement,
    foot: readonly HTMLElement[],
    extraClass = '',
  ): HTMLElement =>
    el('section', { class: `card view-card ${extraClass}`.trim() }, [
      el('div', { class: 'card-head' }, [el('h2', {}, [title]), stats]),
      el('div', { class: 'card-toolbar' }, [tools]),
      el('div', { class: 'card-body' }, [frame]),
      el('div', { class: 'card-foot' }, [el('div', { class: 'foot-line' }, [...foot])]),
    ]);

  const legend = el('div', { class: 'legend' }, [
    el('span', {}, [el('i', { class: 'swatch swatch-front' }), t.unfolded.frontUp]),
    el('span', {}, [el('i', { class: 'swatch swatch-back' }), t.unfolded.backUp]),
    el('span', {}, [el('i', { class: 'swatch swatch-crease' }), t.unfolded.crease]),
  ]);

  const foldedFrame = el('div', { class: 'view-frame' }, [foldedSvg]);
  const unfoldedFrame = el('div', { class: 'view-frame' }, [unfoldedSvg]);
  const solidFrame = el('div', { class: 'view-frame' });
  // The 3D card draws with WebGL into a canvas inside its frame.
  const scene = createScene(solidFrame);
  const solidCanvas = scene.canvas;
  const foldedCard = card(
    t.folded.title,
    statsRow,
    viewTools,
    foldedFrame,
    [statusBar, el('span', { class: 'foot-end' }, [zoomReadout])],
    'folded-card',
  );
  const unfoldedCard = card(
    t.unfolded.title,
    creaseStats,
    unfoldedTools,
    unfoldedFrame,
    [legend, el('span', { class: 'foot-end caption' }, [t.unfolded.caption])],
    'unfolded-card',
  );
  const solidCard = card(
    t.solid.title,
    el('div', { class: 'card-stats' }),
    solidTools,
    solidFrame,
    [
      el('span', { class: 'range-label' }, [
        el('span', { class: 'range-name' }, [t.solid.open]),
        openingControl,
      ]),
      el('span', { class: 'range-label' }, [
        el('span', { class: 'range-name' }, [t.solid.paper]),
        thicknessControl,
      ]),
      el('span', { class: 'foot-end caption' }, [t.solid.dragToTurn]),
    ],
    'solid-card',
  );
  const viewsGrid = el('main', { class: 'views' }, [foldedCard, unfoldedCard, solidCard]);
  const workspace = el('div', { class: 'workspace' }, [viewsGrid, timelineCard]);

  // --- Rail and panel ------------------------------------------------------------
  const railButtons = PANELS.map((id) =>
    el(
      'button',
      {
        type: 'button',
        class: 'rail-button',
        'aria-pressed': 'false',
        'data-panel': id,
        title: t.panels[id].title,
      },
      [icon(RAIL_ICONS[id])],
    ),
  );
  const rail = el('nav', { class: 'rail', 'aria-label': t.panels.nav }, railButtons);
  const panelTitle = el('h2', {}, ['']);
  const panelClose = el(
    'button',
    { type: 'button', class: 'btn panel-close', title: t.panels.close },
    [icon(CLOSE_ICON)],
  );
  const panelBody = el('div', { class: 'panel-body' });
  const panel = el('aside', { class: 'panel', hidden: '' }, [
    el('div', { class: 'panel-head' }, [panelTitle, panelClose]),
    panelBody,
  ]);
  const panelContents: Record<Panel, HTMLElement> = {
    paper: paperPanel,
    step: stepPanel,
    library: el('div', { class: 'groups' }, [
      el('details', { class: 'group', open: '' }, [
        el('summary', {}, [icon(COLLAPSE_ICON), t.panels.presets]),
        el('div', { class: 'preset-list' }, presetButtons),
      ]),
    ]),
    file: filePanel,
    keys: keysPanel,
  };

  root.replaceChildren(
    el('header', { class: 'topbar' }, [
      el('div', { class: 'brand' }, [brandMark(), el('h1', {}, ['Origamio'])]),
      projectName,
      el('div', { class: 'actions' }, [languageSelect, layoutSwitch]),
    ]),
    el('div', { class: 'body' }, [rail, panel, workspace]),
    el('footer', { class: 'statusbar' }, [
      statusSheet,
      statusSteps,
      statusMessage,
      el('span', { class: 'credits' }, [
        el('span', { class: 'credit' }, [t.credits.copyright]),
        el(
          'a',
          {
            class: 'credit',
            href: 'https://github.com/hannesgao/Origamio/blob/main/LICENSE',
            target: '_blank',
            rel: 'noopener',
            title: t.credits.licenceTitle,
          },
          [t.credits.licence],
        ),
        el('span', { class: 'credit credit-version' }, [`v${__APP_VERSION__}`]),
        el('span', { class: 'credit credit-build', title: t.credits.built(__BUILD_TIME__) }, [
          buildStamp(__BUILD_TIME__),
        ]),
        el(
          'a',
          {
            class: 'credit',
            href: 'https://github.com/hannesgao/Origamio',
            target: '_blank',
            rel: 'noopener',
            title: t.credits.githubTitle,
          },
          [icon(GITHUB_ICON), t.credits.github],
        ),
      ]),
    ]),
    importInput,
  );

  // --- Layout ----------------------------------------------------------------
  const narrowQuery = window.matchMedia(NARROW_QUERY);

  /**
   * Size every visible view frame so that the cards fill the workspace height
   * without scrolling. The chrome of a card (head, status line, padding) is
   * measured, the rest of the height goes to the frame, and the frame never
   * grows wider than its card.
   */
  const fitViewsInner = (): void => {
    const gap = parseFloat(getComputedStyle(viewsGrid).rowGap) || 0;
    const workspaceStyle = getComputedStyle(workspace);
    const padding =
      (parseFloat(workspaceStyle.paddingTop) || 0) +
      (parseFloat(workspaceStyle.paddingBottom) || 0);
    const timelineHeight = timelineCard.offsetParent === null ? 0 : timelineCard.offsetHeight + gap;
    const height = workspace.clientHeight - padding - timelineHeight;
    const chrome = (cardEl: HTMLElement, frame: HTMLElement): number =>
      cardEl.offsetHeight - frame.offsetHeight;
    /** Content width of the frame's container (its padding excluded). */
    const widthOf = (frame: HTMLElement): number => {
      const parent = frame.parentElement;
      if (!parent) return 0;
      const style = getComputedStyle(parent);
      return (
        parent.clientWidth -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0)
      );
    };
    /** The main canvas fills its card: as wide as the card, as tall as the budget allows. */
    const fill = (frame: HTMLElement, budget: number): number => {
      const width = Math.floor(widthOf(frame));
      const height = Math.floor(Math.max(160, budget));
      frame.style.width = `${width}px`;
      frame.style.height = `${height}px`;
      frame.closest('.view-card')?.setAttribute('style', `--canvas: ${width}px`);
      return height;
    };
    const place = (frame: HTMLElement, side: number, wide: boolean): number => {
      const bounded = Math.max(96, side);
      const width = wide
        ? Math.min(widthOf(frame), 2 * bounded)
        : Math.min(widthOf(frame), bounded);
      frame.style.width = `${Math.floor(width)}px`;
      frame.style.removeProperty('height');
      // Head and foot of the card line up with the canvas edges.
      frame.closest('.view-card')?.setAttribute('style', `--canvas: ${Math.floor(width)}px`);
      return wide ? Math.floor(width) / 2 : Math.floor(width);
    };
    const tabsHeight = viewTabs.isConnected ? viewTabs.offsetHeight + gap : 0;
    const single = narrowQuery.matches || layout === 'focus';
    if (single) {
      if (foldedCard.offsetParent !== null) {
        fill(foldedFrame, height - tabsHeight - chrome(foldedCard, foldedFrame));
      }
      for (const [cardEl, frame, wide] of [
        [unfoldedCard, unfoldedFrame, false],
        [solidCard, solidFrame, false],
      ] as const) {
        if (cardEl.offsetParent === null) continue;
        place(frame, height - tabsHeight - chrome(cardEl, frame), wide);
      }
      return;
    }
    const chromeFolded = chrome(foldedCard, foldedFrame);
    if (layout === 'side-by-side') {
      // Equal canvases: the smallest of the three budgets wins for all.
      const side = Math.min(
        height - chromeFolded,
        widthOf(foldedFrame),
        widthOf(unfoldedFrame),
        widthOf(solidFrame),
      );
      place(foldedFrame, side, false);
      place(unfoldedFrame, side, false);
      place(solidFrame, side, false);
      return;
    }
    // folded-large: the main canvas fills its column; the tabbed secondary card
    // beside it fills its own column and is exactly as tall.
    const big = fill(foldedFrame, height - chromeFolded);
    const column = big + chromeFolded;
    const [cardEl, frame] =
      secondaryTab === 'solid' ? [solidCard, solidFrame] : [unfoldedCard, unfoldedFrame];
    fill(frame, column - chrome(cardEl, frame));
  };

  /** Size the frames, then let the 3D canvas follow its frame. */
  const fitViews = (): void => {
    fitViewsInner();
    scene.resize();
    scene.reorbit(orbit, frameOf(timeline.state));
  };

  let fitFrame = 0;
  const scheduleFit = (): void => {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => {
      fitViews();
      render();
    });
  };

  const applyLayout = (): void => {
    root.dataset['layout'] = layout;
    root.dataset['tab'] = activeTab;
    root.dataset['secondary'] = secondaryTab;
    for (const strip of [unfoldedStrip, solidStrip]) {
      for (const button of strip.querySelectorAll('button')) {
        button.setAttribute('aria-selected', String(button.dataset['secondary'] === secondaryTab));
      }
    }
    root.dataset['panel'] = openPanel ?? 'closed';
    root.dataset['drawer'] = drawerOpen ? 'open' : 'closed';
    const wantTabs = layout === 'focus' || narrowQuery.matches;
    if (wantTabs && !viewTabs.isConnected) viewsGrid.prepend(viewTabs);
    if (!wantTabs && viewTabs.isConnected) viewTabs.remove();
    tabButtons.forEach((button, i) => {
      button.setAttribute('aria-selected', String(VIEW_TABS[i] === activeTab));
    });
    drawerToggle.setAttribute('aria-expanded', String(drawerOpen));
    drawerToggle.title = drawerOpen ? t.transport.hideTrack : t.transport.showTrack;
    drawer.hidden = !drawerOpen;
    layoutButtons.forEach((button, i) => {
      button.setAttribute('aria-pressed', String(LAYOUTS[i] === layout));
    });
    railButtons.forEach((button, i) => {
      button.setAttribute('aria-pressed', String(PANELS[i] === openPanel));
    });
    paperCurrent.textContent = t.paper.current(describePaper(paper));
    const sheetLabel = statusSheet.querySelector('.status-sheet');
    if (sheetLabel) sheetLabel.textContent = describePaper(paper);
    paperButtons.forEach((button, i) => {
      const preset = PAPER_PRESETS[i];
      button.setAttribute(
        'aria-pressed',
        String(preset !== undefined && sameSize({ ...paper, ...preset.paper }, paper)),
      );
    });
    colourButtons.forEach((button, i) => {
      const preset = COLOUR_PRESETS[i];
      button.setAttribute(
        'aria-pressed',
        String(preset !== undefined && sameColours(preset, paper)),
      );
    });
    frontInput.value = paper.front;
    backInput.value = paper.back;
    // On the document root, so that the tokens derived from them (unfolded
    // facets, legend swatches) pick the live colours up.
    document.documentElement.style.setProperty('--paper-front', paper.front);
    document.documentElement.style.setProperty('--paper-back', paper.back);
    panel.hidden = openPanel === null;
    if (openPanel) {
      panelTitle.textContent = t.panels[openPanel].label;
      panelBody.replaceChildren(panelContents[openPanel]);
    }
    scheduleFit();
  };

  const setLayout = (next: Layout): void => {
    layout = next;
    remember(LAYOUT_KEY, next);
    applyLayout();
  };

  const setTab = (next: ViewTab): void => {
    activeTab = next;
    remember(TAB_KEY, next);
    applyLayout();
  };

  const setSecondary = (next: SecondaryTab): void => {
    secondaryTab = next;
    remember(SECONDARY_KEY, next);
    applyLayout();
  };

  const toggleDrawer = (): void => {
    drawerOpen = !drawerOpen;
    remember(DRAWER_KEY, drawerOpen ? 'open' : 'closed');
    applyLayout();
  };

  const setPanel = (next: Panel | null): void => {
    openPanel = next;
    remember(PANEL_KEY, next ?? '');
    applyLayout();
  };

  // --- Rendering -------------------------------------------------------------

  /** Facets picked out by the pointer, shown with an accent outline in every view. */
  let highlighted: ReadonlySet<number> = new Set();

  const applyHighlight = (): void => {
    for (const svg of views) {
      for (const node of svg.querySelectorAll('[data-id]')) {
        node.classList.toggle('facet-hit', highlighted.has(Number(node.getAttribute('data-id'))));
      }
    }
    scene.highlight(highlighted);
  };

  const setHighlight = (ids: readonly number[]): void => {
    if (ids.length === highlighted.size && ids.every((id) => highlighted.has(id))) return;
    highlighted = new Set(ids);
    applyHighlight();
  };

  const selectedLayers = (): LayerSelection => {
    if (layerAll.checked) return ALL_LAYERS;
    const n = Math.max(1, Math.floor(Number(layerCount.value) || 1));
    return topLayers(n);
  };

  const hintFor = (p: Phase): string => {
    switch (p.kind) {
      case 'idle': {
        if (redrawing !== null) {
          return tool === 'point'
            ? t.hints.redrawPoint(redrawing + 1)
            : t.hints.redrawLine(redrawing + 1);
        }
        const next = timeline.next;
        if (next) return t.hints.next(describeStep(next));
        if (tool === 'move') return t.hints.move;
        if (tool === 'point') return t.hints.point;
        return t.hints.line;
      }
      case 'dragging': {
        const release = tool === 'point' ? t.hints.releasePoint : t.hints.releaseLine;
        switch (p.snap?.kind) {
          case 'vertex':
            return t.hints.snappedCorner(release);
          case 'intersection':
            return t.hints.snappedCrossing(release);
          case 'midpoint':
            return t.hints.snappedMidpoint(release);
          case 'edge':
            return t.hints.snappedEdge(release);
          default:
            return release;
        }
      }
      case 'choose-side':
        return redrawing !== null ? t.hints.chooseSideRedraw(redrawing + 1) : t.hints.chooseSide;
      case 'animating':
        return playing ? t.hints.playing : t.hints.folding;
    }
  };

  /** The state whose statistics are on screen; they are not recomputed per animation frame. */
  let statsFor: PaperState | null = null;

  const render = (): void => {
    const state = phase.kind === 'animating' ? phase.state : timeline.state;
    let options = {};
    const next = timeline.next;
    // The step that would be applied next shows as its line only; shading is
    // for choosing a side by hand.
    if (phase.kind === 'idle' && next && !playing) {
      options = { preview: { line: next.line } };
    }
    if (phase.kind === 'dragging') {
      if (distance(phase.from, phase.to) >= MIN_DRAG) {
        if (tool === 'point') {
          // The fold that brings `from` onto `to`, with the side that moves shaded.
          const bisector = perpendicularBisector(phase.from, phase.to);
          options = { preview: { line: bisector, side: sideOf(bisector, phase.from) } };
        } else {
          options = { preview: { line: line(phase.from, phase.to) } };
        }
      }
    } else if (phase.kind === 'choose-side') {
      options =
        phase.hover === undefined
          ? { preview: { line: phase.line } }
          : { preview: { line: phase.line, side: phase.hover } };
    } else if (phase.kind === 'animating') {
      options = { animation: phase.animation };
    }
    const foldedRect = foldedSvg.getBoundingClientRect();
    const foldedAspect =
      foldedRect.width > 0 && foldedRect.height > 0 ? foldedRect.width / foldedRect.height : 1;
    foldedSvg.setAttribute('viewBox', cameraViewBox(state.size, camera, foldedAspect));
    zoomReadout.textContent = `${Math.round(camera.zoom * 100)}%`;
    snapButton.setAttribute('aria-pressed', String(snapEnabled));
    // Snap markers: every target while a line is drawn, just the ring on hover.
    if (snapEnabled && tool !== 'move' && (phase.kind === 'dragging' || hoverSnap)) {
      const radius = 2.5 * unitsPerPixel();
      const markers: SnapMarkers =
        phase.kind === 'dragging'
          ? {
              targets: snapCache().points.map((t) => t.point),
              anchor: phase.from,
              radius,
              ...(phase.snap ? { active: phase.snap.point } : {}),
            }
          : { targets: [], radius, ...(hoverSnap ? { active: hoverSnap.point } : {}) };
      options = { ...options, snap: markers };
    }
    foldedSvg.dataset['tool'] = tool;
    toolFold.setAttribute('aria-pressed', String(tool === 'fold'));
    toolPoint.setAttribute('aria-pressed', String(tool === 'point'));
    toolMove.setAttribute('aria-pressed', String(tool === 'move'));
    foldedSvg.innerHTML = renderFolded(state, options);
    unfoldedSvg.innerHTML = renderUnfolded(state);
    renderTimeline();
    renderStepPanel();
    statCreases.textContent = String(state.creases.length);
    // The 3D view: the sheet solved as paper, the step in progress swinging its creases.
    requestSolve({
      stateId: idOf(state),
      state,
      opening: (opening * Math.PI) / 180,
      thickness: sceneStyle().thickness,
      ...(phase.kind === 'animating'
        ? {
            animation: {
              id: animationSerial,
              previousId: idOf(phase.animation.previous),
              previous: phase.animation.previous,
              movedIds: [...phase.animation.movedIds],
              progress: phase.animation.progress,
            },
          }
        : {}),
    });
    applyHighlight();
    if (statsFor !== state) {
      statsFor = state;
      statFolds.textContent = String(state.foldCount);
      statLayers.textContent = String(maxLayers(state));
      statFacets.textContent = String(facetCount(state));
    }
    for (const button of presetButtons) button.disabled = phase.kind === 'animating';
    foldedSvg.dataset['phase'] = phase.kind;
    statusBar.dataset['phase'] = phase.kind;
    hint.textContent = hintFor(phase);
  };

  // --- Timeline --------------------------------------------------------------
  /** A step's name as shown: a shipped sequence's names are translated, a typed one is kept. */
  const shownLabel = (label: string): string => t.stepLabels[label] ?? label;
  /** The name to store for what was typed: the stored name when the shown name was left as it was. */
  const typedLabel = (step: FoldStep, typed: string): string =>
    step.label !== undefined && typed.trim() === shownLabel(step.label) ? step.label : typed;
  const describeStep = (step: FoldStep): string => {
    if (step.label) return shownLabel(step.label);
    const { layers, placement } = step.options;
    const which =
      !layers || layers.kind === 'all'
        ? t.step.foldAll
        : layers.kind === 'top'
          ? t.step.foldTop(layers.count)
          : t.step.foldBottom(layers.count);
    return placement && placement !== 'top'
      ? t.step.placed(which, t.step.placements[placement])
      : which;
  };

  let timelineSignature = '';
  const two = (n: number): string => String(n).padStart(2, '0');

  /** Keep the playhead in view, scrolling the track when needed. */
  const revealPlayhead = (): void => {
    const x = timeline.position * CLIP_WIDTH;
    const { scrollLeft, clientWidth } = scroller;
    if (x < scrollLeft + 24) scroller.scrollLeft = Math.max(0, x - clientWidth / 3);
    else if (x > scrollLeft + clientWidth - 24) scroller.scrollLeft = x - (2 * clientWidth) / 3;
  };

  const renderTimeline = (): void => {
    const { position, length } = timeline;
    const busy = phase.kind === 'animating';
    startButton.disabled = busy || position === 0;
    backButton.disabled = busy || position === 0;
    forwardButton.disabled = busy || position >= length;
    endButton.disabled = busy || position >= length;
    playButton.disabled = position >= length && !playing;
    playButton.innerHTML = '';
    playButton.append(icon(playing ? TRANSPORT_ICONS.pause : TRANSPORT_ICONS.play));
    playButton.title = playing ? t.transport.pause : t.transport.play;
    playButton.classList.toggle('is-playing', playing);
    exportButton.disabled = length === 0;
    positionReadout.textContent = `${two(position)} / ${two(length)}`;
    statusSteps.textContent =
      length === 0 ? t.status.noSteps : t.status.stepOf(two(position), two(length));
    statusMessage.textContent = timelineMessage;
    statusMessage.classList.toggle('is-error', timelineError);
    timelineCard.classList.toggle('is-playing', playing);

    // The playhead moves every frame while a step animates.
    const progress = phase.kind === 'animating' ? phase.animation.progress : 1;
    const head = (position - 1 + progress) * CLIP_WIDTH;
    playhead.style.left = `${Math.max(0, head)}px`;

    const signature = `${position}|${selected}|${timeline.steps
      .map((step, i) => `${describeStep(step)}:${timeline.effect(i)}`)
      .join('|')}`;
    if (signature === timelineSignature) return;
    timelineSignature = signature;
    lanes.style.width = `${Math.max(1, length) * CLIP_WIDTH + CLIP_WIDTH / 2}px`;
    const ticks: HTMLElement[] = [];
    for (let i = 0; i <= length; i++) {
      ticks.push(el('span', { class: 'tl-tick', style: `left: ${i * CLIP_WIDTH}px` }, [two(i)]));
    }
    ruler.replaceChildren(...ticks);
    const clips = timeline.steps.map((step, i) => {
      const number = i + 1;
      const classes = ['tl-clip', number <= position ? 'done' : 'pending'];
      if (number === position) classes.push('current');
      if (i === selected) classes.push('selected');
      const dead = timeline.effect(i) === false;
      if (dead) classes.push('no-effect');
      return el(
        'div',
        {
          class: classes.join(' '),
          role: 'listitem',
          'data-index': String(number),
          title: dead
            ? t.transport.clipDead(describeStep(step))
            : t.transport.clipTitle(describeStep(step)),
          style: `left: ${i * CLIP_WIDTH}px; width: ${CLIP_WIDTH - 4}px`,
        },
        [el('span', { class: 'tl-label' }, [describeStep(step)])],
      );
    });
    // A rename in progress goes with the clips it was typed into.
    renaming = null;
    track.replaceChildren(...clips);
    revealPlayhead();
  };

  /** Show a message in the status bar; an error is shown as one. */
  const say = (message: string, error = false): void => {
    timelineMessage = message;
    timelineError = error;
    renderTimeline();
  };

  // --- Step inspector ----------------------------------------------------------
  let stepSignature = '';
  const numberField = (
    value: number,
    onChange: (n: number) => void,
    label: string,
  ): HTMLInputElement => {
    const input = el('input', {
      type: 'number',
      step: '0.01',
      class: 'ctl',
      value: String(+value.toFixed(4)),
      'aria-label': label,
    });
    input.addEventListener('change', () => {
      const n = Number(input.value);
      if (Number.isFinite(n)) onChange(n);
    });
    return input;
  };

  const renderStepPanel = (): void => {
    const index = selected;
    const step = index === null ? undefined : timeline.steps[index];
    const signature =
      step && index !== null
        ? `${index}|${timeline.length}|${JSON.stringify(stepToJson(step))}|${timeline.effect(index)}|${redrawing}`
        : `none|${timeline.length}`;
    if (signature === stepSignature) return;
    stepSignature = signature;
    if (!step || index === null) {
      stepPanel.replaceChildren(
        el('p', { class: 'help' }, [
          timeline.length === 0 ? t.inspector.emptyNoSteps : t.inspector.emptySelect,
        ]),
      );
      return;
    }
    const at = index;
    const update = (
      patch: Partial<Pick<FoldStep, 'line' | 'side' | 'options'>>,
      what: string,
    ): void => {
      if (phase.kind === 'animating') return;
      playing = false;
      timeline.update(at, patch);
      afterEdit(t.inspector.changed(what, at + 1), at);
    };
    const options = step.options;
    const layers = options.layers ?? ALL_LAYERS;

    const nameField = el('input', {
      type: 'text',
      class: 'ctl',
      value: step.label ? shownLabel(step.label) : '',
      placeholder: describeStep({ line: step.line, side: step.side, options }),
      'aria-label': t.inspector.stepName,
    });
    nameField.addEventListener('change', () => renameStep(at, typedLabel(step, nameField.value)));

    const layerKind = el('select', { class: 'ctl', 'aria-label': t.inspector.layers });
    for (const [value, text] of [
      ['all', t.inspector.layersAll],
      ['top', t.inspector.layersTop],
      ['bottom', t.inspector.layersBottom],
    ] as const) {
      const option = el('option', { value }, [text]);
      if (value === layers.kind) option.selected = true;
      layerKind.append(option);
    }
    const layerN = el('input', {
      type: 'number',
      min: '1',
      step: '1',
      class: 'ctl',
      value: String(layers.kind === 'all' ? 1 : layers.count),
      'aria-label': t.inspector.layerCount,
    });
    layerN.disabled = layers.kind === 'all';
    const applyLayers = (): void => {
      const kind = layerKind.value;
      const count = Math.max(1, Math.floor(Number(layerN.value) || 1));
      const next: LayerSelection =
        kind === 'top' ? topLayers(count) : kind === 'bottom' ? bottomLayers(count) : ALL_LAYERS;
      const rest: FoldOptions = { ...options };
      delete (rest as { layers?: LayerSelection }).layers;
      update(
        { options: next.kind === 'all' ? rest : { ...rest, layers: next } },
        t.inspector.what.layers,
      );
    };
    layerKind.addEventListener('change', applyLayers);
    layerN.addEventListener('change', applyLayers);

    const placement = el('select', { class: 'ctl', 'aria-label': t.inspector.placement });
    for (const [value, text] of [
      ['top', t.inspector.placementTop],
      ['bottom', t.inspector.placementBottom],
      ['inside', t.inspector.placementInside],
    ] as const) {
      const option = el('option', { value }, [text]);
      if (value === (options.placement ?? 'top')) option.selected = true;
      placement.append(option);
    }
    placement.addEventListener('change', () => {
      const rest: FoldOptions = { ...options };
      delete (rest as { placement?: Placement }).placement;
      const value = placement.value;
      update(
        { options: value === 'top' ? rest : { ...rest, placement: value as Placement } },
        t.inspector.what.placement,
      );
    });

    const flipButton = el('button', { type: 'button', class: 'btn panel-action' }, [
      t.inspector.flip,
    ]);
    flipButton.addEventListener('click', () =>
      update({ side: step.side === 1 ? -1 : 1 }, t.inspector.what.side),
    );
    const redrawButton = el('button', { type: 'button', class: 'btn panel-action' }, [
      redrawing === at ? t.inspector.redrawing : t.inspector.redraw,
    ]);
    redrawButton.addEventListener('click', () => startRedraw(at));
    const setLine = (which: 'a' | 'b', axis: 'x' | 'y', n: number): void => {
      const a = { ...step.line.a };
      const b = { ...step.line.b };
      (which === 'a' ? a : b)[axis] = n;
      if (distance(a, b) < 1e-6) {
        say(t.inspector.coincide, true);
        return;
      }
      update({ line: line(a, b) }, t.inspector.what.line);
    };
    const lineRow = (which: 'a' | 'b'): HTMLElement =>
      el('div', { class: 'size-row line-row' }, [
        el('span', { class: 'field-label' }, [which === 'a' ? t.inspector.from : t.inspector.to]),
        numberField(step.line[which].x, (n) => setLine(which, 'x', n), `${which} x`),
        numberField(step.line[which].y, (n) => setLine(which, 'y', n), `${which} y`),
      ]);

    const limits: HTMLElement[] = [];
    for (const [key, text] of [
      ['region', t.inspector.regionLimit],
      ['window', t.inspector.windowLimit],
    ] as const) {
      const polygon = options[key];
      if (!polygon) continue;
      const remove = el('button', { type: 'button', class: 'btn' }, [t.inspector.remove]);
      remove.addEventListener('click', () => {
        const { region, window, ...others } = options;
        const rest: FoldOptions =
          key === 'region'
            ? { ...others, ...(window ? { window } : {}) }
            : { ...others, ...(region ? { region } : {}) };
        update(
          { options: rest },
          key === 'region' ? t.inspector.what.region : t.inspector.what.window,
        );
      });
      limits.push(
        el('div', { class: 'limit-row' }, [
          el('span', {}, [t.inspector.points(text, polygon.length)]),
          remove,
        ]),
      );
    }

    const effect = timeline.effect(at);
    stepPanel.replaceChildren(
      el('p', { class: 'help step-title' }, [
        t.inspector.title(at + 1, timeline.length),
        effect === false ? t.inspector.movesNothing : '',
      ]),
      ...(step.also && step.also.length > 0
        ? [el('p', { class: 'help' }, [t.inspector.moreFolds(step.also.length)])]
        : []),
      el('label', { class: 'field' }, [
        el('span', { class: 'field-label' }, [t.inspector.name]),
        nameField,
      ]),
      el('div', { class: 'field' }, [
        el('span', { class: 'field-label' }, [t.inspector.layers]),
        el('div', { class: 'size-row layers-row' }, [layerKind, layerN]),
      ]),
      el('label', { class: 'field' }, [
        el('span', { class: 'field-label' }, [t.inspector.placement]),
        placement,
      ]),
      el('div', { class: 'field' }, [
        el('span', { class: 'field-label' }, [
          t.inspector.foldLine(step.side === 1 ? 'left' : 'right'),
        ]),
        lineRow('a'),
        lineRow('b'),
        el('div', { class: 'panel-actions' }, [flipButton, redrawButton]),
      ]),
      ...(limits.length > 0
        ? [
            el('div', { class: 'field' }, [
              el('span', { class: 'field-label' }, [t.inspector.limits]),
              ...limits,
            ]),
          ]
        : []),
      el('p', { class: 'help' }, [t.inspector.replayHelp]),
    );
  };

  /** Rewind to just before step `index` and take the next drawn line as its new line. */
  const startRedraw = (index: number): void => {
    if (phase.kind === 'animating') return;
    playing = false;
    redrawing = index;
    timeline.seek(index);
    phase = { kind: 'idle' };
    stepSignature = '';
    render();
    say(t.messages.drawNewLine(index + 1));
  };

  const cancelRedraw = (): void => {
    if (redrawing === null) return;
    redrawing = null;
    stepSignature = '';
    render();
  };

  // --- Folding ---------------------------------------------------------------
  /** One fold of a step played on its own, from the sheet before it to the sheet after. */
  const animatePart = (before: PaperState, after: PaperState, movedIds: Set<number>, ms: number) =>
    new Promise<void>((resolve) => {
      const start = performance.now();
      // One id per fold: the solver keeps what it learns about contacts for that long.
      animationSerial++;
      const tick = (now: number): void => {
        const progress = Math.min(1, ((now - start) * speed) / ms);
        phase = {
          kind: 'animating',
          animation: { previous: before, movedIds, progress },
          state: after,
          start,
        };
        render();
        if (progress < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });

  /**
   * Play the step just applied (it sits before the playhead), one fold at a
   * time: a pre-crease folds and unfolds, a petal fold forms crease by
   * crease. A fold that moves nothing is skipped; a step that moves nothing
   * at all resolves at once.
   */
  const animate = async (): Promise<void> => {
    const step = timeline.steps[timeline.position - 1];
    const previous = timeline.previous;
    if (!step || !previous) return;
    const parts = [step, ...(step.also ?? [])];
    const ms = parts.length > 1 ? ANIMATION_MS * 0.7 : ANIMATION_MS;
    let before = previous;
    for (const part of parts) {
      const result = fold(before, part.line, part.side, part.options);
      if (result.movedIds.length > 0) {
        await animatePart(before, result.state, new Set(result.movedIds), ms);
      }
      before = result.state;
    }
    phase = { kind: 'idle' };
    render();
  };

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task, task);
    return queue;
  };

  /** How many later steps lost their effect; reported after an edit. */
  const deadAfter = (from: number): number =>
    timeline.steps.filter((_, i) => i >= from && timeline.effect(i) === false).length;

  const afterEdit = (message: string, from = 0): void => {
    const dead = deadAfter(from);
    redrawing = null;
    phase = { kind: 'idle' };
    render();
    say(dead > 0 ? t.messages.laterDead(message, dead) : message);
  };

  /** A fold made by hand: inserted at the playhead, the later steps stay. */
  const insertFold = (
    l: Line,
    side: Side,
    options: LayerSelection | FoldOptions,
  ): Promise<void> => {
    // Folds made by hand take attached paper along, so they never tear the sheet.
    const opts: FoldOptions = {
      ...('kind' in options ? { layers: options } : options),
      attached: true,
    };
    const step: FoldStep = { line: l, side, options: opts };
    const probe = fold(timeline.state, l, side, opts);
    if (probe.movedIds.length === 0) {
      phase = { kind: 'idle' };
      render();
      say(t.messages.movesNothing);
      return Promise.resolve();
    }
    const at = timeline.position;
    timeline.insert(at, step);
    const result = timeline.forward();
    selected = at;
    const along = result && result.takenAlong > 0 ? t.messages.tookAlong(result.takenAlong) : '';
    return (result ? animate() : Promise.resolve()).then(() =>
      afterEdit(`${t.messages.inserted(at + 1)}${along}`, at + 1),
    );
  };

  /** Apply the next step; animated unless `instant`. */
  const applyNext = async (instant = false): Promise<void> => {
    const result = timeline.forward();
    if (result && !instant) await animate();
  };

  const stepForward = (): Promise<void> =>
    enqueue(async () => {
      if (timeline.position >= timeline.length) return;
      redrawing = null;
      await applyNext();
      render();
    });

  const stepBack = (): void => {
    if (phase.kind === 'animating') return;
    playing = false;
    redrawing = null;
    timeline.back();
    phase = { kind: 'idle' };
    render();
  };

  /** Go to the state after `index` steps without animation. */
  const jumpTo = (index: number): void => {
    if (phase.kind === 'animating') return;
    playing = false;
    redrawing = null;
    timeline.seek(index);
    phase = { kind: 'idle' };
    render();
  };

  const pause = (): void => {
    playing = false;
    renderTimeline();
  };

  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const play = (): void => {
    if (playing || timeline.position >= timeline.length) return;
    playing = true;
    renderTimeline();
    void enqueue(async () => {
      while (playing && timeline.position < timeline.length) {
        await applyNext();
        if (playing && timeline.position < timeline.length) await wait(STEP_GAP_MS / speed);
      }
      playing = false;
      render();
    });
  };

  const loadSequence = (sequence: Sequence, autoplay = false): Promise<void> => {
    playing = false;
    return enqueue(async () => {
      const wanted = sequence.paper ?? DEFAULT_PAPER;
      const paperChanged = !sameSize(wanted, paper);
      if (!samePaper(wanted, paper)) setPaper(wanted, false);
      timeline.load(sequence.steps);
      redrawing = null;
      selected = null;
      setName(sequence.name);
      setViewFrame(sequence.view);
      timelineMessage = '';
      phase = { kind: 'idle' };
      // Sequences start from the flat sheet, so show all of it like Reset does.
      camera = defaultCamera(timeline.state.width, timeline.state.height);
      render();
      if (paperChanged) say(t.messages.sheetSetFor(describePaper(paper), sequence.name));
      if (autoplay) play();
    });
  };

  /** Change the face colours; nothing on the timeline moves. */
  const setColours = (front: string, back: string): void => {
    paper = { ...paper, front: front.toLowerCase(), back: back.toLowerCase() };
    applyLayout();
    // The flat views take the colours from CSS; the 3D view is drawn with them.
    render();
  };

  /** Replace the sheet, keeping every step on the timeline; the playhead rewinds. */
  const setPaper = (next: Paper, announce = true): void => {
    if (phase.kind === 'animating') return;
    if (sameSize(next, paper)) {
      setColours(next.front, next.back);
      return;
    }
    playing = false;
    paper = { ...next };
    timeline.resetSheet(createPaper(paper.width, paper.height));
    for (const svg of [unfoldedSvg]) {
      svg.setAttribute('viewBox', viewBox(paper.width, paper.height));
    }
    camera = defaultCamera(paper.width, paper.height);
    phase = { kind: 'idle' };
    paperWidth.value = String(+paper.width.toFixed(4));
    paperHeight.value = String(+paper.height.toFixed(4));
    applyLayout();
    if (announce) say(t.messages.sheetNow(describePaper(paper), timeline.length));
  };

  const exportSequence = (): Sequence => ({
    name: sequenceName.trim() || t.file.defaultName,
    paper,
    ...(viewFrame ? { view: viewFrame } : {}),
    steps: [...timeline.steps],
  });

  const downloadSequence = (): void => {
    const sequence = exportSequence();
    const blob = new Blob([serializeSequence(sequence)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const slug = sequence.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const anchor = el('a', { href: url, download: `${slug || 'sequence'}.json` });
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(t.messages.saved(sequence.steps.length));
  };

  const importFile = async (file: File): Promise<void> => {
    try {
      const sequence = parseSequence(await file.text());
      await loadSequence(sequence);
      say(t.messages.loaded(sequence.name, sequence.steps.length, describePaper(paper)));
    } catch (error) {
      const reason = error instanceof SequenceError ? error.message : t.messages.unreadable;
      say(t.messages.couldNotLoad(file.name, reason), true);
    }
  };

  // --- Editing the timeline ----------------------------------------------------
  const deleteStep = (index: number): void => {
    if (phase.kind === 'animating' || index < 0 || index >= timeline.length) return;
    playing = false;
    timeline.remove(index);
    selected = null;
    afterEdit(t.messages.deleted(index + 1), index);
  };

  const duplicateStep = (index: number): void => {
    if (phase.kind === 'animating') return;
    timeline.duplicate(index);
    selected = index + 1;
    afterEdit(t.messages.duplicated(index + 1), index + 1);
  };

  const moveStep = (from: number, to: number): void => {
    if (phase.kind === 'animating' || from === to) return;
    playing = false;
    timeline.move(from, to);
    selected = Math.max(0, Math.min(timeline.length - 1, to));
    afterEdit(t.messages.moved(from + 1, selected + 1), Math.min(from, selected));
  };

  const renameStep = (index: number, label: string): void => {
    timeline.rename(index, label);
    timelineSignature = '';
    render();
  };

  const truncateAfter = (index: number): void => {
    if (phase.kind === 'animating') return;
    playing = false;
    const count = timeline.length - index - 1;
    timeline.truncate(index + 1);
    afterEdit(t.messages.removedAfter(count, index + 1));
  };

  const undoEdit = (): void => {
    if (phase.kind === 'animating') return;
    playing = false;
    if (!timeline.undoEdit()) {
      say(t.messages.nothingToUndo);
      return;
    }
    if (selected !== null && selected >= timeline.length) selected = null;
    afterEdit(t.messages.undid);
  };

  const redoEdit = (): void => {
    if (phase.kind === 'animating') return;
    playing = false;
    if (!timeline.redoEdit()) {
      say(t.messages.nothingToRedo);
      return;
    }
    if (selected !== null && selected >= timeline.length) selected = null;
    afterEdit(t.messages.redid);
  };

  // Inline rename: the clip's label turns into a text field.
  let renaming: number | null = null;
  const startRename = (index: number): void => {
    const step = timeline.steps[index];
    const clipEl = track.querySelector(`.tl-clip[data-index="${index + 1}"]`);
    const labelEl = clipEl?.querySelector('.tl-label');
    if (!step || !clipEl || !labelEl || renaming !== null) return;
    renaming = index;
    const input = el('input', {
      type: 'text',
      class: 'tl-rename',
      value: step.label ? shownLabel(step.label) : '',
      placeholder: describeStep({ line: step.line, side: step.side, options: step.options }),
      'aria-label': t.transport.renameLabel(index + 1),
    });
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      done = true;
      // The track may have been rebuilt without this field: nothing to commit then.
      if (!input.isConnected) return;
      renaming = null;
      if (commit) renameStep(index, typedLabel(step, input.value));
      else {
        timelineSignature = '';
        renderTimeline();
      }
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(true);
      else if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
    labelEl.replaceWith(input);
    input.focus();
    input.select();
  };

  // Context menu on a clip.
  const menu = el('div', { class: 'tl-menu', role: 'menu', hidden: '' });
  const closeMenu = (): void => {
    menu.hidden = true;
  };
  type MenuItem = [string, () => void, boolean?];
  const showMenu = (items: MenuItem[], x: number, y: number): void => {
    menu.replaceChildren(
      ...items.map(([label, action, disabled]) => {
        const item = el('button', { type: 'button', role: 'menuitem' }, [label]);
        if (disabled) item.disabled = true;
        item.addEventListener('click', () => {
          closeMenu();
          action();
        });
        return item;
      }),
    );
    menu.hidden = false;
    const width = 180;
    menu.style.left = `${Math.min(x, window.innerWidth - width - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - items.length * 34 - 8)}px`;
  };
  const openMenu = (index: number, x: number, y: number): void => {
    const items: MenuItem[] = [
      [t.menu.rename, () => startRename(index)],
      [
        t.menu.edit,
        () => {
          selected = index;
          setPanel('step');
        },
      ],
      [t.menu.goTo, () => jumpTo(index + 1)],
      [t.menu.duplicate, () => duplicateStep(index)],
      [t.menu.moveLeft, () => moveStep(index, index - 1), index === 0],
      [t.menu.moveRight, () => moveStep(index, index + 1), index >= timeline.length - 1],
      [t.menu.delete, () => deleteStep(index)],
      [t.menu.deleteAfter, () => truncateAfter(index), index >= timeline.length - 1],
    ];
    showMenu(items, x, y);
  };
  moreButton.addEventListener('click', () => {
    if (!menu.hidden) {
      closeMenu();
      return;
    }
    const rect = moreButton.getBoundingClientRect();
    showMenu(
      [
        [snapEnabled ? t.menu.snapOn : t.menu.snapOff, () => setSnapEnabled(!snapEnabled)],
        [t.menu.fit, fitView],
        [t.menu.full, fullView],
        [t.menu.zoom(zoomReadout.textContent ?? ''), () => undefined, true],
      ],
      rect.right - 180,
      rect.bottom + 4,
    );
  });
  root.append(menu);
  document.addEventListener(
    'pointerdown',
    (event) => {
      const inside =
        event.target instanceof Node &&
        (menu.contains(event.target) || moreButton.contains(event.target));
      if (!menu.hidden && !inside) closeMenu();
    },
    { signal },
  );

  // --- Pointer interaction ---------------------------------------------------
  /** Sheet units per CSS pixel at the current zoom. */
  const unitsPerPixel = (): number => {
    const [, , vw] = (foldedSvg.getAttribute('viewBox') ?? '0 0 1 1').split(' ').map(Number);
    return (vw ?? 1) / foldedSvg.getBoundingClientRect().width;
  };

  const toModel = (client: Vec): Vec => {
    const rect = foldedSvg.getBoundingClientRect();
    const [vx, vy, vw, vh] = (
      foldedSvg.getAttribute('viewBox') ?? viewBox(timeline.state.width, timeline.state.height)
    )
      .split(' ')
      .map(Number) as [number, number, number, number];
    const x = vx + ((client.x - rect.left) / rect.width) * vw;
    const y = vy + ((client.y - rect.top) / rect.height) * vh;
    return fromSvgPoint(vec(x, y), timeline.state.size);
  };

  const clientPoint = (event: PointerEvent | WheelEvent): Vec => vec(event.clientX, event.clientY);

  // Snap targets are derived from the folded state; cached until it changes.
  let snapCacheFor: PaperState | null = null;
  let snapCached: SnapTargets = { points: [], edges: [] };
  const snapCache = (): SnapTargets => {
    if (snapCacheFor !== timeline.state) {
      snapCacheFor = timeline.state;
      snapCached = snapTargets(timeline.state);
    }
    return snapCached;
  };
  /** The snap for a model point, or null when snapping is off or nothing is near. */
  const snapFor = (p: Vec, event: { readonly altKey: boolean }): Snap | null =>
    snapEnabled !== event.altKey ? snapTo(snapCache(), p, SNAP_PIXELS * unitsPerPixel()) : null;
  const setSnapEnabled = (on: boolean): void => {
    snapEnabled = on;
    remember(SNAP_KEY, on ? 'on' : 'off');
    hoverSnap = null;
    render();
  };

  const setCamera = (next: Camera): void => {
    camera = { centre: next.centre, zoom: clampZoom(next.zoom) };
    render();
  };

  /** Move the view by a pointer displacement given in CSS pixels. */
  const panBy = (dx: number, dy: number): void => {
    const k = unitsPerPixel();
    setCamera({ centre: add(camera.centre, vec(-dx * k, dy * k)), zoom: camera.zoom });
  };

  /** Zoom by `factor` while keeping the model point under `client` fixed. */
  const zoomAt = (client: Vec, factor: number): void => {
    const zoom = clampZoom(camera.zoom * factor);
    const applied = zoom / camera.zoom;
    if (applied === 1) return;
    const anchor = toModel(client);
    const centre = add(anchor, scale(sub(camera.centre, anchor), 1 / applied));
    setCamera({ centre, zoom });
  };

  const fitView = (): void =>
    setCamera(fitCamera(timeline.state.size, foldedPoints(timeline.state)));
  const fullView = (): void =>
    setCamera(defaultCamera(timeline.state.width, timeline.state.height));

  const setTool = (next: Tool): void => {
    tool = next;
    if (phase.kind === 'dragging' || phase.kind === 'choose-side') phase = { kind: 'idle' };
    render();
  };

  const endNavigation = (): void => {
    navigation = null;
    pointers.clear();
    foldedSvg.classList.remove('is-panning');
  };

  /** Apply a fold chosen on the sheet: redraw the step being redrawn, or insert at the playhead. */
  const commitFold = (l: Line, side: Side): void => {
    playing = false;
    if (redrawing !== null) {
      const at = redrawing;
      redrawing = null;
      timeline.update(at, { line: l, side });
      timeline.seek(at + 1);
      selected = at;
      stepSignature = '';
      afterEdit(t.messages.lineRedrawn(at + 1), at);
      return;
    }
    // A fold made by hand is inserted at the playhead; later steps stay.
    void enqueue(() => insertFold(l, side, selectedLayers()));
  };

  foldedSvg.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, clientPoint(event));
    if (pointers.size === 2) {
      // A second finger: whatever the first one was doing becomes a pinch.
      if (phase.kind === 'dragging') phase = { kind: 'idle' };
      navigation = { kind: 'pinch' };
      foldedSvg.setPointerCapture(event.pointerId);
      render();
      return;
    }
    const wantsPan = event.button === 1 || (event.button === 0 && (tool === 'move' || spaceHeld));
    if (wantsPan) {
      event.preventDefault();
      navigation = { kind: 'pan', pointerId: event.pointerId };
      foldedSvg.setPointerCapture(event.pointerId);
      foldedSvg.classList.add('is-panning');
      return;
    }
    if (event.button !== 0) return;
    const p = toModel(clientPoint(event));
    if (phase.kind === 'choose-side') {
      commitFold(phase.line, sideOf(phase.line, p));
      return;
    }
    if (phase.kind !== 'idle') return;
    foldedSvg.setPointerCapture(event.pointerId);
    const start = snapFor(p, event)?.point ?? p;
    hoverSnap = null;
    phase = { kind: 'dragging', from: start, to: start };
    render();
  });

  foldedSvg.addEventListener('pointermove', (event) => {
    const client = clientPoint(event);
    const previous = pointers.get(event.pointerId);
    if (previous) pointers.set(event.pointerId, client);

    if (navigation?.kind === 'pan' && navigation.pointerId === event.pointerId && previous) {
      panBy(client.x - previous.x, client.y - previous.y);
      return;
    }
    if (navigation?.kind === 'pinch' && previous && pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [Vec, Vec];
      const other = a === client ? b : a;
      const before = distance(previous, other);
      const after = distance(client, other);
      const mid = scale(add(client, other), 0.5);
      const midBefore = scale(add(previous, other), 0.5);
      panBy(mid.x - midBefore.x, mid.y - midBefore.y);
      if (before > 0) zoomAt(mid, after / before);
      return;
    }

    const p = toModel(client);
    const under = facetsAt(timeline.state, p);
    statCursor.textContent = String(under.length);
    setHighlight(under);
    if (phase.kind === 'dragging') {
      const snap = snapFor(p, event);
      phase = {
        kind: 'dragging',
        from: phase.from,
        to: snap?.point ?? p,
        ...(snap ? { snap } : {}),
      };
      render();
    } else if (phase.kind === 'idle' && tool !== 'move' && !spaceHeld) {
      const snap = snapFor(p, event);
      const same =
        snap === hoverSnap ||
        (snap !== null && hoverSnap !== null && distance(snap.point, hoverSnap.point) < 1e-9);
      if (!same) {
        hoverSnap = snap;
        render();
      }
    } else if (phase.kind === 'choose-side') {
      const hover = sideOf(phase.line, p);
      if (hover !== phase.hover) {
        phase = { kind: 'choose-side', line: phase.line, hover };
        render();
      }
    }
  });

  const pointerEnd = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    if (navigation) {
      if (pointers.size === 0) endNavigation();
      else if (navigation.kind === 'pinch' && pointers.size === 1) {
        // Lifting one finger of a pinch continues as a pan with the other.
        const [remaining] = [...pointers.keys()] as [number];
        navigation = { kind: 'pan', pointerId: remaining };
      }
      return;
    }
    if (phase.kind !== 'dragging') return;
    const raw = toModel(clientPoint(event));
    const to = snapFor(raw, event)?.point ?? raw;
    if (distance(phase.from, to) < MIN_DRAG) {
      phase = { kind: 'idle' };
    } else if (tool === 'point') {
      // Point onto point: the fold is fully determined, so it is applied at once.
      const bisector = perpendicularBisector(phase.from, to);
      const from = phase.from;
      phase = { kind: 'idle' };
      commitFold(bisector, sideOf(bisector, from));
    } else {
      phase = { kind: 'choose-side', line: line(phase.from, to) };
    }
    render();
  };
  foldedSvg.addEventListener('pointerup', pointerEnd);
  foldedSvg.addEventListener('pointercancel', (event) => {
    pointers.delete(event.pointerId);
    if (navigation && pointers.size === 0) endNavigation();
    if (phase.kind === 'dragging') {
      phase = { kind: 'idle' };
      render();
    }
  });

  foldedSvg.addEventListener('pointerleave', () => {
    statCursor.textContent = '–';
    setHighlight([]);
    if (hoverSnap) {
      hoverSnap = null;
      render();
    }
    if (phase.kind === 'choose-side' && phase.hover !== undefined) {
      phase = { kind: 'choose-side', line: phase.line };
      render();
    }
  });

  foldedSvg.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      // Pixel deltas from trackpads are small; line deltas from mouse wheels are not.
      const delta =
        event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? event.deltaY : event.deltaY * 16;
      zoomAt(clientPoint(event), Math.exp(-delta * 0.0025));
    },
    { passive: false },
  );

  foldedSvg.addEventListener('dblclick', (event) => {
    if (tool === 'move' || spaceHeld) {
      event.preventDefault();
      fitView();
    }
  });

  for (const svg of [unfoldedSvg]) {
    svg.addEventListener('pointermove', (event) => {
      const hit = event.target instanceof Element ? event.target.closest('[data-id]') : null;
      setHighlight(hit ? [Number(hit.getAttribute('data-id'))] : []);
    });
    svg.addEventListener('pointerleave', () => setHighlight([]));
  }
  const setOpening = (degrees: number): void => {
    opening = Math.max(0, Math.min(MAX_OPENING, Number.isFinite(degrees) ? degrees : 0));
    openingButtons.forEach((button, i) =>
      button.setAttribute('aria-pressed', String(OPENING_STEPS[i] === opening)),
    );
    if (Number(openingInput.value) !== opening) openingInput.value = String(opening);
    render();
  };
  openingButtons.forEach((button, i) =>
    button.addEventListener('click', () => setOpening(OPENING_STEPS[i] ?? DEFAULT_OPENING)),
  );
  openingInput.addEventListener('input', () => setOpening(Number(openingInput.value)));
  openingInput.addEventListener('change', () => setOpening(Number(openingInput.value)));
  const setThickness = (mm: number): void => {
    thicknessMm = Math.max(0, Math.min(MAX_THICKNESS_MM, Number.isFinite(mm) ? mm : 0));
    thicknessButtons.forEach((button, i) =>
      button.setAttribute('aria-pressed', String(THICKNESS_STEPS_MM[i] === thicknessMm)),
    );
    if (Number(thicknessInput.value) !== thicknessMm) thicknessInput.value = String(thicknessMm);
    render();
  };
  thicknessButtons.forEach((button, i) =>
    button.addEventListener('click', () =>
      setThickness(THICKNESS_STEPS_MM[i] ?? DEFAULT_THICKNESS_MM),
    ),
  );
  thicknessInput.addEventListener('input', () => setThickness(Number(thicknessInput.value)));
  thicknessInput.addEventListener('change', () => setThickness(Number(thicknessInput.value)));
  perspectiveButton.addEventListener('click', () => {
    perspective = !perspective;
    perspectiveButton.setAttribute('aria-pressed', String(perspective));
    remember(PERSPECTIVE_KEY, perspective ? 'on' : 'off');
    render();
  });

  // Turning the 3D view: drag spins and tilts, the wheel zooms, a double click resets.
  let orbitDrag: { readonly pointerId: number; last: Vec } | null = null;
  const setOrbit = (next: Orbit): void => {
    // Any turn is allowed, including looking from underneath; angles stay bounded.
    orbit = {
      ...(next.basis ? { basis: next.basis } : {}),
      yaw: wrapAngle(next.yaw),
      pitch: wrapAngle(next.pitch),
      roll: wrapAngle(next.roll),
      zoom: Math.max(MIN_ORBIT_ZOOM, Math.min(MAX_ORBIT_ZOOM, next.zoom)),
    };
    const same = (a: number, b: number): boolean => Math.abs(wrapAngle(a - b)) < 1e-6;
    const sameBasis = (a: Orbit['basis'], b: Orbit['basis']): boolean =>
      a === b ||
      (a !== undefined &&
        b !== undefined &&
        a.every((row, i) => {
          const other = b[i];
          return (
            other !== undefined &&
            Math.abs(row.x - other.x) < 1e-9 &&
            Math.abs(row.y - other.y) < 1e-9 &&
            Math.abs(row.z - other.z) < 1e-9
          );
        }));
    viewButtons.forEach((button, i) => {
      const view = fixedViews[i]?.orbit;
      button.setAttribute(
        'aria-pressed',
        String(
          view !== undefined &&
            sameBasis(view.basis, orbit.basis) &&
            same(view.yaw, orbit.yaw) &&
            same(view.pitch, orbit.pitch) &&
            same(view.roll, orbit.roll),
        ),
      );
    });
    scene.reorbit(orbit, frameOf(timeline.state));
  };
  /** Recompute the fixed views for the loaded model's frame. */
  const setViewFrame = (frame: ViewFrame | undefined): void => {
    viewFrame = frame;
    fixedViews = namedViews(frameOf(timeline.state));
    setOrbit(DEFAULT_ORBIT);
  };
  viewButtons.forEach((button, i) =>
    button.addEventListener('click', () => {
      // A frame from the shape follows the sheet as it is folded.
      if (!viewFrame) fixedViews = namedViews(frameOf(timeline.state));
      const view = fixedViews[i];
      if (view) setOrbit({ ...view.orbit, zoom: orbit.zoom });
    }),
  );
  solidCanvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    orbitDrag = { pointerId: event.pointerId, last: clientPoint(event) };
    solidCanvas.setPointerCapture(event.pointerId);
    solidCanvas.classList.add('is-turning');
  });
  solidCanvas.addEventListener('pointermove', (event) => {
    if (!orbitDrag || orbitDrag.pointerId !== event.pointerId) {
      // Not turning: the facet under the pointer lights up in every view.
      const id = scene.pick(event.clientX, event.clientY);
      setHighlight(id === null ? [] : [id]);
      return;
    }
    const now = clientPoint(event);
    const dx = now.x - orbitDrag.last.x;
    const dy = now.y - orbitDrag.last.y;
    orbitDrag.last = now;
    setOrbit({ ...orbit, yaw: orbit.yaw + dx * 0.01, pitch: orbit.pitch + dy * 0.01 });
  });
  solidCanvas.addEventListener('pointerleave', () => setHighlight([]));
  const endOrbit = (event: PointerEvent): void => {
    if (orbitDrag?.pointerId !== event.pointerId) return;
    orbitDrag = null;
    solidCanvas.classList.remove('is-turning');
  };
  solidCanvas.addEventListener('pointerup', endOrbit);
  solidCanvas.addEventListener('pointercancel', endOrbit);
  solidCanvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      setOrbit({ ...orbit, zoom: orbit.zoom * Math.exp(-event.deltaY * 0.0015) });
    },
    { passive: false },
  );
  solidCanvas.addEventListener('dblclick', () => setOrbit(DEFAULT_ORBIT));
  orbitReset.addEventListener('click', () => setOrbit(DEFAULT_ORBIT));
  window.addEventListener('resize', scheduleFit, { signal });

  layoutButtons.forEach((button, i) => {
    button.addEventListener('click', () => setLayout(LAYOUTS[i] ?? 'side-by-side'));
  });
  languageSelect.addEventListener('change', () => {
    const next = languageSelect.value as Language;
    if (LANGUAGES.includes(next)) void setLanguage(next);
  });
  drawerToggle.addEventListener('click', toggleDrawer);
  railButtons.forEach((button, i) => {
    const id = PANELS[i] ?? null;
    button.addEventListener('click', () => setPanel(openPanel === id ? null : id));
  });
  panelClose.addEventListener('click', () => setPanel(null));
  paperButtons.forEach((button, i) => {
    button.addEventListener('click', () => {
      const preset = PAPER_PRESETS[i];
      if (preset) setPaper({ ...paper, ...preset.paper });
    });
  });
  colourButtons.forEach((button, i) => {
    button.addEventListener('click', () => {
      const preset = COLOUR_PRESETS[i];
      if (preset) setColours(preset.front, preset.back);
    });
  });
  frontInput.addEventListener('input', () => {
    if (isHexColour(frontInput.value)) setColours(frontInput.value, paper.back);
  });
  backInput.addEventListener('input', () => {
    if (isHexColour(backInput.value)) setColours(paper.front, backInput.value);
  });
  const customPaper = (): Paper | null => {
    const width = Number(paperWidth.value);
    const height = Number(paperHeight.value);
    const ok = (n: number): boolean => Number.isFinite(n) && n > 0 && n <= MAX_PAPER_SIDE;
    if (!ok(width) || !ok(height)) {
      say(t.messages.badSize(MAX_PAPER_SIDE), true);
      return null;
    }
    return { ...paper, width, height };
  };
  paperApply.addEventListener('click', () => {
    const next = customPaper();
    if (next) setPaper(next);
  });
  paperSwap.addEventListener('click', () =>
    setPaper({ ...paper, width: paper.height, height: paper.width }),
  );
  narrowQuery.addEventListener('change', applyLayout, { signal });
  // The 3D view takes its ink from the theme; follow the system when it switches.
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => render(), { signal });
  const resizeObserver = new ResizeObserver(scheduleFit);
  resizeObserver.observe(workspace);
  for (const strip of [unfoldedStrip, solidStrip]) {
    for (const button of strip.querySelectorAll('button')) {
      button.addEventListener('click', () => {
        const next = button.dataset['secondary'];
        if (next === 'unfolded' || next === 'solid') setSecondary(next);
      });
    }
  }
  tabButtons.forEach((button, i) => {
    button.addEventListener('click', () => setTab(VIEW_TABS[i] ?? 'folded'));
  });

  toolFold.addEventListener('click', () => setTool('fold'));
  toolPoint.addEventListener('click', () => setTool('point'));
  toolMove.addEventListener('click', () => setTool('move'));
  snapButton.addEventListener('click', () => setSnapEnabled(!snapEnabled));
  fitButton.addEventListener('click', fitView);
  fullButton.addEventListener('click', fullView);

  // --- Buttons ---------------------------------------------------------------
  /** Undo takes back the last edit of the timeline (Ctrl+Z); ← steps back. */
  const undo = (): void => undoEdit();
  /** Reset returns to the flat sheet but keeps every step on the timeline. */
  const reset = (): void => {
    if (phase.kind === 'animating') return;
    jumpTo(0);
    camera = defaultCamera(timeline.state.width, timeline.state.height);
    render();
  };
  const clear = (): void => {
    if (phase.kind === 'animating') return;
    playing = false;
    timeline.clear();
    redrawing = null;
    selected = null;
    setName(t.file.defaultName);
    setViewFrame(undefined);
    timelineMessage = '';
    phase = { kind: 'idle' };
    camera = defaultCamera(timeline.state.width, timeline.state.height);
    render();
  };
  presetButtons.forEach((button, i) => {
    button.addEventListener('click', () => {
      const entry = LIBRARY[i];
      if (entry) {
        // Loaded under its name in the visitor's language; the file keeps its own.
        const text = presetText(entry.id, entry.sequence);
        void loadSequence({ ...entry.sequence, name: text.name }).then(() =>
          say(
            t.messages.loadedPreset(text.name, entry.sequence.steps.length, describePaper(paper)),
          ),
        );
      }
    });
  });
  startButton.addEventListener('click', () => jumpTo(0));
  backButton.addEventListener('click', stepBack);
  forwardButton.addEventListener('click', () => void stepForward());
  endButton.addEventListener('click', () => jumpTo(timeline.length));
  playButton.addEventListener('click', () => (playing ? pause() : play()));
  speedSelect.addEventListener('change', () => {
    speed = Number(speedSelect.value) || 1;
    remember(SPEED_KEY, String(speed));
  });

  // Scrubbing: drag anywhere on the ruler or the track to move the playhead
  // from boundary to boundary; a click on a clip goes to the end of that step.
  // Scrubbing on the ruler or track moves the playhead; on a clip, a press is a
  // click (go there and select) and a drag moves the clip.
  let scrubbing = false;
  let drag: { index: number; startX: number; moving: boolean; target: number } | null = null;
  const dropMarker = el('div', { class: 'tl-drop', hidden: '' });
  lanes.append(dropMarker);
  const boundaryAt = (clientX: number): number => {
    const left = lanes.getBoundingClientRect().left;
    return Math.max(0, Math.min(timeline.length, Math.round((clientX - left) / CLIP_WIDTH)));
  };
  scroller.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || phase.kind === 'animating' || renaming !== null) return;
    const clipHit = event.target instanceof Element ? event.target.closest('.tl-clip') : null;
    scroller.setPointerCapture(event.pointerId);
    if (clipHit) {
      const index = Number(clipHit.getAttribute('data-index')) - 1;
      drag = { index, startX: event.clientX, moving: false, target: index };
      return;
    }
    scrubbing = true;
    scroller.classList.add('is-scrubbing');
    jumpTo(boundaryAt(event.clientX));
  });
  scroller.addEventListener('pointermove', (event) => {
    if (phase.kind === 'animating') return;
    if (drag) {
      if (!drag.moving && Math.abs(event.clientX - drag.startX) > 6) {
        drag.moving = true;
        track.querySelector(`.tl-clip[data-index="${drag.index + 1}"]`)?.classList.add('dragging');
        dropMarker.hidden = false;
      }
      if (drag.moving) {
        const clipEl = track.querySelector<HTMLElement>(`.tl-clip[data-index="${drag.index + 1}"]`);
        if (clipEl) clipEl.style.transform = `translateX(${event.clientX - drag.startX}px)`;
        const boundary = boundaryAt(
          event.clientX - CLIP_WIDTH / 2 + (event.clientX - drag.startX > 0 ? CLIP_WIDTH : 0),
        );
        drag.target = Math.max(
          0,
          Math.min(timeline.length - 1, boundary > drag.index ? boundary - 1 : boundary),
        );
        const markerAt = drag.target > drag.index ? drag.target + 1 : drag.target;
        dropMarker.style.left = `${markerAt * CLIP_WIDTH}px`;
      }
      return;
    }
    if (!scrubbing) return;
    const index = boundaryAt(event.clientX);
    if (index !== timeline.position) jumpTo(index);
  });
  const endScrub = (event: PointerEvent): void => {
    scrubbing = false;
    scroller.classList.remove('is-scrubbing');
    if (!drag) return;
    const { index, moving, target } = drag;
    drag = null;
    dropMarker.hidden = true;
    track
      .querySelector<HTMLElement>(`.tl-clip[data-index="${index + 1}"]`)
      ?.style.removeProperty('transform');
    if (event.type === 'pointercancel') return;
    if (moving) moveStep(index, target);
    else {
      selected = index;
      jumpTo(index + 1);
    }
  };
  scroller.addEventListener('pointerup', endScrub);
  scroller.addEventListener('pointercancel', endScrub);
  scroller.addEventListener('dblclick', (event) => {
    // Pointer capture retargets the click events to the scroller, so look up
    // the clip under the pointer by position.
    const clipHit = document.elementFromPoint(event.clientX, event.clientY)?.closest('.tl-clip');
    if (clipHit) startRename(Number(clipHit.getAttribute('data-index')) - 1);
  });
  scroller.addEventListener('contextmenu', (event) => {
    const clipHit = event.target instanceof Element ? event.target.closest('.tl-clip') : null;
    if (!clipHit) return;
    event.preventDefault();
    selected = Number(clipHit.getAttribute('data-index')) - 1;
    renderTimeline();
    openMenu(selected, event.clientX, event.clientY);
  });
  nameInput.addEventListener('input', () => setName(nameInput.value));
  projectName.addEventListener('input', () => setName(projectName.value));
  projectName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === 'Escape') projectName.blur();
  });
  exportButton.addEventListener('click', downloadSequence);
  newButton.addEventListener('click', clear);
  importButton.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (file) void importFile(file);
    importInput.value = '';
  });
  layerTop.addEventListener('change', () => layerCount.focus());
  layerCount.addEventListener('input', () => {
    layerTop.checked = true;
  });

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        if (!menu.hidden) closeMenu();
        else if (redrawing !== null && phase.kind === 'idle') cancelRedraw();
        else if (playing) pause();
        else if (phase.kind === 'choose-side' || phase.kind === 'dragging')
          phase = { kind: 'idle' };
        else if (openPanel) setPanel(null);
        render();
        return;
      }
      const inField =
        event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
      if (inField) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z' && event.shiftKey) {
        event.preventDefault();
        redoEdit();
      } else if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redoEdit();
      } else if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
      } else if (
        !modifier &&
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selected !== null
      ) {
        event.preventDefault();
        deleteStep(selected);
      } else if (!modifier && event.key === 'F2' && selected !== null) {
        event.preventDefault();
        startRename(selected);
      } else if (!modifier && !event.altKey && event.key === ' ') {
        // A button focused by a mouse click would be re-activated on key up;
        // keyboard users (focus-visible) keep the native behaviour.
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement && active.matches(':focus-visible')) return;
        // Links, disclosure summaries and fields keep their own use of Space.
        if (active instanceof HTMLElement && active.matches('a[href], summary, textarea, input'))
          return;
        if (active instanceof HTMLButtonElement) active.blur();
        if (!event.repeat) {
          spaceHeld = true;
          foldedSvg.dataset['space'] = 'held';
        }
        event.preventDefault();
      } else if (!modifier && !event.altKey && event.key.toLowerCase() === 'p') {
        if (playing) pause();
        else play();
      } else if (!modifier && !event.altKey && event.key === 'Home') {
        event.preventDefault();
        jumpTo(0);
      } else if (!modifier && !event.altKey && event.key === 'End') {
        event.preventDefault();
        jumpTo(timeline.length);
      } else if (!modifier && !event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        void stepForward();
      } else if (!modifier && !event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        stepBack();
      } else if (!modifier && !event.altKey && event.key.toLowerCase() === 'f') {
        fitView();
      } else if (!modifier && !event.altKey && event.key === '0') {
        fullView();
      }
    },
    { signal },
  );
  document.addEventListener(
    'keyup',
    (event) => {
      if (event.key === ' ') {
        spaceHeld = false;
        delete foldedSvg.dataset['space'];
      }
    },
    { signal },
  );
  window.addEventListener(
    'blur',
    () => {
      spaceHeld = false;
      delete foldedSvg.dataset['space'];
      endNavigation();
    },
    { signal },
  );
  const dispose = (): void => {
    alive.abort();
    resizeObserver.disconnect();
    cancelAnimationFrame(fitFrame);
    playing = false;
    scene.dispose();
    solver.dispose();
  };

  applyLayout();
  render();
  requestAnimationFrame(render);

  return {
    root,
    timeline,
    get state() {
      return timeline.state;
    },
    get camera() {
      return camera;
    },
    fitView,
    fullView,
    fold(l, side, layers = ALL_LAYERS) {
      const probe = fold(timeline.state, l, side, layers);
      if (probe.movedIds.length === 0) return false;
      timeline.insert(timeline.position, { line: l, side, options: { layers } });
      timeline.forward();
      phase = { kind: 'idle' };
      render();
      return true;
    },
    loadSequence,
    exportSequence,
    get pending() {
      return timeline.pending;
    },
    deleteStep,
    moveStep,
    renameStep,
    undoEdit,
    redoEdit,
    get paper() {
      return paper;
    },
    setPaper,
    setColours,
    stepForward,
    stepBack,
    jumpTo,
    play,
    pause,
    undo,
    reset,
    dispose,
  };
}
