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
  scale,
  sideOf,
  sub,
  vec,
} from './geometry';
import { LIBRARY } from './library';
import { Timeline } from './timeline';
import {
  type FoldStep,
  type Paper,
  stepToJson,
  type Sequence,
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
  type FoldResult,
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
  BACK_COLOR,
  FRONT_COLOR,
  cameraViewBox,
  clampZoom,
  defaultCamera,
  fitCamera,
  fromSvgPoint,
  renderFolded,
  renderLayers,
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
const LAYOUTS: readonly { readonly id: Layout; readonly label: string; readonly title: string }[] =
  [
    { id: 'side-by-side', label: 'Side by side', title: 'All three views in a row' },
    { id: 'folded-large', label: 'Folded large', title: 'A big folded view, the others beside it' },
    { id: 'focus', label: 'Focus', title: 'Only the folded view' },
  ];
const LAYOUT_KEY = 'origamio.layout';
/** Panels that open from the icon rail on the left. */
type Panel = 'library' | 'paper' | 'step' | 'file' | 'keys';
const PANELS: readonly { readonly id: Panel; readonly label: string; readonly title: string }[] = [
  { id: 'library', label: 'Library', title: 'Presets to load onto the timeline' },
  { id: 'paper', label: 'Paper', title: 'Size of the sheet' },
  { id: 'step', label: 'Step', title: 'Edit the selected step' },
  { id: 'file', label: 'File', title: 'Name, import, export and clear' },
  { id: 'keys', label: 'Shortcuts', title: 'Keyboard shortcuts' },
];
const PANEL_KEY = 'origamio.panel';

/** Sheet shapes offered in the Paper panel; the longer side is always 1. */
const PAPER_PRESETS: readonly {
  readonly id: string;
  readonly label: string;
  readonly paper: { readonly width: number; readonly height: number };
}[] = [
  { id: 'square', label: 'Square 1:1', paper: { width: 1, height: 1 } },
  { id: 'a-series', label: 'A series 1:√2', paper: { width: 1, height: 0.7071 } },
  { id: '4-3', label: '4:3', paper: { width: 1, height: 0.75 } },
  { id: '3-2', label: '3:2', paper: { width: 1, height: 0.6667 } },
  { id: '16-9', label: '16:9', paper: { width: 1, height: 0.5625 } },
];

/** Face colour pairs offered in the Paper panel. */
const COLOUR_PRESETS: readonly {
  readonly id: string;
  readonly label: string;
  readonly front: string;
  readonly back: string;
}[] = [
  { id: 'orange', label: 'Orange and brown (default)', front: DEFAULT_FRONT, back: DEFAULT_BACK },
  { id: 'kami', label: 'Kami red and white', front: '#d7263d', back: '#f6f1e7' },
  { id: 'blue', label: 'Blue and white', front: '#2b5fb3', back: '#f2f5fb' },
  { id: 'green', label: 'Green and cream', front: '#3f8f5a', back: '#f3f0dc' },
  { id: 'kraft', label: 'Kraft', front: '#c9a26b', back: '#a67c48' },
  { id: 'gold', label: 'Black and gold', front: '#24201c', back: '#d4a53a' },
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
  if (preset) return `${preset.label} (${dims})`;
  if (portrait) return `${portrait.label} portrait (${dims})`;
  return `Custom (${dims})`;
};
const DRAWER_KEY = 'origamio.drawer';
/** Below this width the views sit behind tabs and the panel floats over the workspace. */
const NARROW_QUERY = '(max-width: 1339px)';
/** The view shown on its own: on narrow screens, and in the Focus layout. */
type ViewTab = 'folded' | 'unfolded' | 'layers';
const VIEW_TABS: readonly { readonly id: ViewTab; readonly label: string }[] = [
  { id: 'folded', label: 'Folded' },
  { id: 'unfolded', label: 'Unfolded' },
  { id: 'layers', label: 'Layers' },
];
const TAB_KEY = 'origamio.tab';
/** Which secondary view the tabbed card of the folded-large layout shows. */
type SecondaryTab = 'unfolded' | 'layers';
const SECONDARY_KEY = 'origamio.secondary';

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
type Tool = 'fold' | 'move';

/** An in-flight pan or pinch gesture on the folded view. */
type Navigation = { readonly kind: 'pan'; readonly pointerId: number } | { readonly kind: 'pinch' };

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'dragging'; readonly from: Vec; readonly to: Vec }
  | { readonly kind: 'choose-side'; readonly line: Line; readonly hover?: Side }
  | { readonly kind: 'animating'; readonly animation: FoldAnimation; readonly start: number };

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
}

export function createApp(root: HTMLElement): App {
  let paper: Paper = DEFAULT_PAPER;
  const timeline = new Timeline(createPaper(paper.width, paper.height));
  /** The clip picked on the track (0-based step index), if any. */
  let selected: number | null = null;
  let phase: Phase = { kind: 'idle' };
  let queue: Promise<void> = Promise.resolve();
  let camera: Camera = defaultCamera(paper.width, paper.height);
  let tool: Tool = 'fold';
  let spaceHeld = false;
  const rememberedLayout = remembered(LAYOUT_KEY);
  let layout: Layout = LAYOUTS.some((l) => l.id === rememberedLayout)
    ? (rememberedLayout as Layout)
    : 'folded-large';
  const rememberedPanel = remembered(PANEL_KEY);
  let openPanel: Panel | null = PANELS.some((p) => p.id === rememberedPanel)
    ? (rememberedPanel as Panel)
    : null;
  let drawerOpen = remembered(DRAWER_KEY) !== 'closed';
  let secondaryTab: SecondaryTab = remembered(SECONDARY_KEY) === 'layers' ? 'layers' : 'unfolded';
  const rememberedTab = remembered(TAB_KEY);
  let activeTab: ViewTab = VIEW_TABS.some((t) => t.id === rememberedTab)
    ? (rememberedTab as ViewTab)
    : 'folded';
  const rememberedSpeed = Number(remembered(SPEED_KEY));
  let speed = SPEEDS.includes(rememberedSpeed) ? rememberedSpeed : 1;
  let playing = false;
  /** Index of the step whose line is being redrawn on the folded sheet. */
  let redrawing: number | null = null;
  let sequenceName = 'My sequence';
  let timelineMessage = '';
  let navigation: Navigation | null = null;
  /** Last known position of every pointer that is down on the folded view. */
  const pointers = new Map<number, Vec>();

  // --- DOM -----------------------------------------------------------------
  const foldedSvg = svgElement(paper.width, paper.height, 'view folded-view');
  const unfoldedSvg = svgElement(paper.width, paper.height, 'view unfolded-view');
  const layersSvg = svgElement(paper.width, paper.height, 'view layers-view');
  const views = [foldedSvg, unfoldedSvg, layersSvg];

  const layerAll = el('input', { type: 'radio', name: 'layers', value: 'all', checked: '' });
  const layerTop = el('input', { type: 'radio', name: 'layers', value: 'top' });
  const layerCount = el('input', {
    type: 'number',
    min: '1',
    step: '1',
    value: '1',
    'aria-label': 'Number of top layers to fold',
  });

  const layoutButtons = LAYOUTS.map((l) =>
    el('button', { type: 'button', title: l.title, 'aria-pressed': 'false', 'data-layout': l.id }, [
      icon(LAYOUT_ICONS[l.id]),
      el('span', { class: 'btn-label' }, [l.label]),
    ]),
  );
  const layoutSwitch = el(
    'div',
    { class: 'tool-toggle layout-switch', role: 'group', 'aria-label': 'Layout' },
    layoutButtons,
  );

  const presetButtons = LIBRARY.map(({ id, sequence }) =>
    el(
      'button',
      { type: 'button', class: 'preset', 'data-preset': id, title: sequence.description ?? '' },
      [
        el('span', { class: 'preset-label' }, [sequence.name]),
        el('span', { class: 'preset-desc' }, [sequence.description ?? '']),
      ],
    ),
  );

  // --- Transport and track (the dock at the bottom) --------------------------
  const transport = (name: keyof typeof TRANSPORT_ICONS, title: string): HTMLButtonElement =>
    el('button', { type: 'button', class: 'btn transport', title }, [icon(TRANSPORT_ICONS[name])]);
  const startButton = transport('start', 'Back to the flat sheet (Home)');
  const backButton = transport('back', 'One step back (←)');
  const playButton = transport('play', 'Play the remaining steps (P)');
  const forwardButton = transport('forward', 'One step forward (→)');
  const endButton = transport('end', 'Apply all remaining steps at once (End)');
  const speedSelect = el('select', { class: 'tl-speed ctl', 'aria-label': 'Playback speed' });
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
      title: 'Hide the track',
    },
    [icon(COLLAPSE_ICON), el('span', { class: 'btn-label' }, ['Track'])],
  );
  // The track: a ruler with one tick per step, the step clips, and a playhead
  // that sits on the boundary after the last applied step.
  const ruler = el('div', { class: 'tl-ruler' });
  const track = el('div', { class: 'tl-track', role: 'list', 'aria-label': 'Fold steps' });
  const playhead = el('div', { class: 'tl-playhead' }, [el('div', { class: 'tl-playhead-head' })]);
  const lanes = el('div', { class: 'tl-lanes' }, [ruler, track, playhead]);
  const scroller = el('div', { class: 'tl-scroll' }, [lanes]);
  const drawer = el('div', { class: 'drawer' }, [scroller]);
  const timelineHead = el('div', { class: 'card-head timeline-head' }, [
    el('h2', {}, ['Timeline']),
    el('div', { class: 'card-tools timeline-tools' }, [
      el('div', { class: 'transport-group' }, [
        startButton,
        backButton,
        playButton,
        forwardButton,
        endButton,
      ]),
      el('label', { class: 'tl-speed-label' }, [
        el('span', { class: 'btn-label' }, ['Speed']),
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
    'aria-label': 'Sequence name',
    placeholder: 'Sequence name',
  });
  // The same name, editable in the header; the two inputs mirror each other.
  const projectName = el('input', {
    type: 'text',
    class: 'project-name',
    value: sequenceName,
    'aria-label': 'Sequence name',
    placeholder: 'Untitled sequence',
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
    { type: 'button', class: 'btn panel-action', title: 'Load a sequence from a JSON file' },
    [icon(IMPORT_ICON), el('span', {}, ['Import file…'])],
  );
  const exportButton = el(
    'button',
    { type: 'button', class: 'btn panel-action', title: 'Save the timeline as a JSON file' },
    [icon(EXPORT_ICON), el('span', {}, ['Export file'])],
  );
  const newButton = el(
    'button',
    { type: 'button', class: 'btn panel-action', title: 'Clear the sheet and the timeline' },
    [icon(NEW_ICON), el('span', {}, ['New sheet'])],
  );
  const filePanel = el('div', { class: 'panel-section' }, [
    el('label', { class: 'field' }, [el('span', { class: 'field-label' }, ['Name']), nameInput]),
    el('div', { class: 'panel-actions' }, [exportButton, importButton, newButton]),
    el('p', { class: 'help' }, [
      'A file holds every step on the timeline, applied and pending, in the origamio-sequence ',
      'JSON format described in the README.',
    ]),
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
      [el('span', { class: 'preset-label' }, [preset.label])],
    ),
  );
  const paperWidth = el('input', {
    type: 'number',
    class: 'ctl',
    min: '0.1',
    max: String(MAX_PAPER_SIDE),
    step: '0.01',
    value: '1',
    'aria-label': 'Sheet width',
  });
  const paperHeight = el('input', {
    type: 'number',
    class: 'ctl',
    min: '0.1',
    max: String(MAX_PAPER_SIDE),
    step: '0.01',
    value: '1',
    'aria-label': 'Sheet height',
  });
  const paperApply = el('button', { type: 'button', class: 'btn panel-action' }, ['Use this size']);
  const paperSwap = el(
    'button',
    { type: 'button', class: 'btn panel-action', title: 'Swap width and height' },
    ['Rotate (portrait / landscape)'],
  );
  const paperCurrent = el('p', { class: 'help paper-current' }, ['']);
  const colourButtons = COLOUR_PRESETS.map((preset) =>
    el('button', {
      type: 'button',
      class: 'colour-preset',
      title: preset.label,
      'aria-label': preset.label,
      'aria-pressed': 'false',
      'data-colours': preset.id,
      style: `--swatch-front: ${preset.front}; --swatch-back: ${preset.back}`,
    }),
  );
  const frontInput = el('input', {
    type: 'color',
    value: DEFAULT_FRONT,
    'aria-label': 'Front colour',
  });
  const backInput = el('input', {
    type: 'color',
    value: DEFAULT_BACK,
    'aria-label': 'Back colour',
  });
  const paperPanel = el('div', { class: 'panel-section' }, [
    paperCurrent,
    el('div', { class: 'preset-list' }, paperButtons),
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label' }, ['Custom (width × height, longer side 1 is usual)']),
      el('div', { class: 'size-row' }, [
        paperWidth,
        el('span', {}, ['×']),
        paperHeight,
        paperApply,
      ]),
    ]),
    paperSwap,
    el('p', { class: 'help' }, [
      'Changing the size rewinds to the flat sheet and keeps every step on the timeline, so ',
      'play to see them on the new sheet.',
    ]),
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label' }, ['Colours (front / back)']),
      el('div', { class: 'colour-presets' }, colourButtons),
      el('div', { class: 'colour-row' }, [
        el('label', { class: 'colour-field' }, [frontInput, 'Front']),
        el('label', { class: 'colour-field' }, [backInput, 'Back']),
      ]),
    ]),
    el('p', { class: 'help' }, ['Size and colours are saved in exported files.']),
  ]);

  // --- Step panel (filled by renderStepPanel) ------------------------------------
  const stepPanel = el('div', { class: 'panel-section step-panel' });

  const keysTable = el(
    'table',
    { class: 'keys' },
    (
      [
        ['Drag', 'Draw a fold line, then click the side that flips'],
        ['Esc', 'Cancel the line, or pause playback'],
        ['← / →', 'One step back or forward'],
        ['P', 'Play or pause'],
        ['Home / End', 'Flat sheet or last step'],
        ['Ctrl+Z', 'Undo (one step back)'],
        ['Scroll', 'Zoom around the pointer'],
        ['Space + drag', 'Pan the folded view'],
        ['F / 0', 'Fit the sheet or show it whole'],
      ] as const
    ).map(([key, what]) =>
      el('tr', {}, [el('th', {}, [el('kbd', {}, [key])]), el('td', {}, [what])]),
    ),
  );
  const keysPanel = el('div', { class: 'panel-section' }, [
    keysTable,
    el('p', { class: 'about' }, [
      el('span', {}, ['© 2026 Hannes Gao']),
      el('span', {}, ['MIT License']),
      el('span', {}, [`v${__APP_VERSION__}`]),
      el(
        'a',
        { href: 'https://github.com/hannesgao/Origamio', target: '_blank', rel: 'noopener' },
        ['GitHub'],
      ),
    ]),
  ]);

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
  const hint = el('span', { class: 'status-text' });
  const statsRow = el('div', { class: 'stats-row' });
  const statusBar = el('div', { class: 'status-bar', role: 'status', 'aria-live': 'polite' }, [
    el('span', { class: 'status-dot' }),
    hint,
  ]);
  const creaseCount = el('span', {}, ['0 creases']);

  const toolFold = el(
    'button',
    { type: 'button', 'aria-pressed': 'true', title: 'Drag to draw a fold line' },
    ['Fold'],
  );
  const toolMove = el(
    'button',
    { type: 'button', 'aria-pressed': 'false', title: 'Drag to pan (or hold Space)' },
    ['Move'],
  );
  const fitButton = el(
    'button',
    { type: 'button', class: 'btn fit', title: 'Fit the folded sheet into view (F)' },
    [icon(FIT_ICON), el('span', { class: 'btn-label' }, ['Fit'])],
  );
  const fullButton = el(
    'button',
    { type: 'button', class: 'btn full', title: 'Show the whole sheet (0)' },
    [icon(FULL_ICON), el('span', { class: 'btn-label' }, ['Full'])],
  );
  const zoomReadout = el('span', { class: 'zoom', title: 'Zoom; scroll on the sheet to change' }, [
    '100%',
  ]);
  // On a narrow card the view buttons fold into this menu.
  const moreButton = el(
    'button',
    { type: 'button', class: 'btn more-toggle', title: 'More view tools', 'aria-haspopup': 'menu' },
    [icon(MORE_ICON)],
  );
  const layerControl = el(
    'fieldset',
    {
      class: 'segmented segmented-compact',
      title:
        'Layers moved by the next fold: all of them, or only the top n (a facet is in the top n when fewer than n layers lie above it)',
    },
    [
      el('label', { class: 'seg' }, [layerAll, el('span', {}, ['All'])]),
      el('label', { class: 'seg' }, [layerTop, el('span', {}, ['Top']), layerCount]),
    ],
  );
  const viewTools = el('div', { class: 'card-tools' }, [
    el('div', { class: 'tool-toggle', role: 'group', 'aria-label': 'Drag tool' }, [
      toolFold,
      toolMove,
    ]),
    layerControl,
    fitButton,
    fullButton,
    zoomReadout,
    moreButton,
  ]);

  const liftInput = el('input', {
    type: 'range',
    min: '0',
    max: '0.2',
    step: '0.005',
    value: '0.06',
    'aria-label': 'Gap between layers',
  });
  const tabButtons = VIEW_TABS.map((tab) =>
    el('button', { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-tab': tab.id }, [
      tab.label,
    ]),
  );
  const viewTabs = el(
    'div',
    { class: 'view-tabs tool-toggle', role: 'tablist', 'aria-label': 'View' },
    tabButtons,
  );

  // The folded-large layout shows one secondary view at a time; each card
  // carries a copy of the tab strip so the visible one can switch.
  const secondaryStrip = (): HTMLElement =>
    el(
      'div',
      { class: 'tool-toggle secondary-tabs', role: 'tablist', 'aria-label': 'Secondary view' },
      (['unfolded', 'layers'] as const).map((id) =>
        el(
          'button',
          { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-secondary': id },
          [id === 'unfolded' ? 'Unfolded' : 'Layers'],
        ),
      ),
    );
  const unfoldedStrip = secondaryStrip();
  const layersStrip = secondaryStrip();
  const unfoldedTools = el('div', { class: 'card-tools' }, [
    unfoldedStrip,
    el('span', { class: 'caption' }, ['Crease pattern, live']),
  ]);
  const layerTools = el('div', { class: 'card-tools' }, [
    layersStrip,
    el('span', { class: 'caption' }, ['Stack, lifted']),
  ]);

  const stat = (value: HTMLElement, label: string): HTMLElement =>
    el('div', { class: 'stat' }, [value, el('span', { class: 'stat-label' }, [label])]);
  statsRow.append(
    stat(statFolds, 'folds'),
    stat(statLayers, 'max layers'),
    stat(statFacets, 'facets'),
    stat(statCursor, 'under cursor'),
  );

  /**
   * Every view card has the same anatomy: a 44px head with the title and one
   * row of tools, the canvas, and a foot of exactly two lines, so that equal
   * canvases give equal cards.
   */
  const card = (
    title: string,
    tools: HTMLElement,
    frame: HTMLElement,
    foot: readonly [HTMLElement, HTMLElement],
    extraClass = '',
  ): HTMLElement =>
    el('section', { class: `card view-card ${extraClass}`.trim() }, [
      el('div', { class: 'card-head' }, [el('h2', {}, [title]), tools]),
      el('div', { class: 'card-body' }, [frame]),
      el('div', { class: 'card-foot' }, [
        el('div', { class: 'foot-line' }, [foot[0]]),
        el('div', { class: 'foot-line' }, [foot[1]]),
      ]),
    ]);

  const legend = el('div', { class: 'legend' }, [
    el('span', {}, [el('i', { class: 'swatch swatch-front' }), 'Front side up']),
    el('span', {}, [el('i', { class: 'swatch swatch-back' }), 'Back side up']),
    el('span', {}, [el('i', { class: 'swatch swatch-crease' }), 'Crease']),
  ]);

  const foldedFrame = el('div', { class: 'view-frame' }, [foldedSvg]);
  const unfoldedFrame = el('div', { class: 'view-frame' }, [unfoldedSvg]);
  const layersFrame = el('div', { class: 'view-frame view-frame-wide' }, [layersSvg]);
  const foldedCard = card('Folded', viewTools, foldedFrame, [statusBar, statsRow], 'folded-card');
  const unfoldedCard = card(
    'Unfolded',
    unfoldedTools,
    unfoldedFrame,
    [legend, creaseCount],
    'unfolded-card',
  );
  const layersCard = card(
    'Layers',
    layerTools,
    layersFrame,
    [
      el('span', {}, [
        'Front view, each layer lifted. ',
        el('span', { class: 'help-more' }, ['Point at a facet to find it.']),
      ]),
      el('label', { class: 'range-label' }, ['Gap', liftInput]),
    ],
    'layers-card',
  );
  const viewsGrid = el('main', { class: 'views' }, [foldedCard, unfoldedCard, layersCard]);
  const workspace = el('div', { class: 'workspace' }, [viewsGrid, timelineCard]);

  // --- Rail and panel ------------------------------------------------------------
  const railButtons = PANELS.map((panel) =>
    el(
      'button',
      {
        type: 'button',
        class: 'rail-button',
        'aria-pressed': 'false',
        'data-panel': panel.id,
        title: panel.label,
      },
      [icon(RAIL_ICONS[panel.id])],
    ),
  );
  const rail = el('nav', { class: 'rail', 'aria-label': 'Panels' }, railButtons);
  const panelTitle = el('h2', {}, ['']);
  const panelClose = el('button', { type: 'button', class: 'btn panel-close', title: 'Close' }, [
    icon(CLOSE_ICON),
  ]);
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
        el('summary', {}, [icon(COLLAPSE_ICON), 'Presets']),
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
      el('div', { class: 'actions' }, [layoutSwitch]),
    ]),
    el('div', { class: 'body' }, [rail, panel, workspace]),
    el('footer', { class: 'statusbar' }, [
      statusSheet,
      statusSteps,
      statusMessage,
      el(
        'a',
        {
          class: 'status-version',
          href: 'https://github.com/hannesgao/Origamio',
          target: '_blank',
          rel: 'noopener',
          title: 'Origamio on GitHub',
        },
        [`v${__APP_VERSION__}`],
      ),
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
  const fitViews = (): void => {
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
        [layersCard, layersFrame, true],
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
        widthOf(layersFrame),
      );
      place(foldedFrame, side, false);
      place(unfoldedFrame, side, false);
      place(layersFrame, side, false);
      return;
    }
    // folded-large: the main canvas fills its column; the tabbed secondary card
    // beside it fills its own column and is exactly as tall.
    const big = fill(foldedFrame, height - chromeFolded);
    const column = big + chromeFolded;
    const [cardEl, frame] =
      secondaryTab === 'layers' ? [layersCard, layersFrame] : [unfoldedCard, unfoldedFrame];
    fill(frame, column - chrome(cardEl, frame));
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
    for (const strip of [unfoldedStrip, layersStrip]) {
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
      button.setAttribute('aria-selected', String(VIEW_TABS[i]?.id === activeTab));
    });
    drawerToggle.setAttribute('aria-expanded', String(drawerOpen));
    drawerToggle.title = drawerOpen ? 'Hide the track' : 'Show the track';
    drawer.hidden = !drawerOpen;
    layoutButtons.forEach((button, i) => {
      button.setAttribute('aria-pressed', String(LAYOUTS[i]?.id === layout));
    });
    railButtons.forEach((button, i) => {
      button.setAttribute('aria-pressed', String(PANELS[i]?.id === openPanel));
    });
    paperCurrent.textContent = `Current sheet: ${describePaper(paper)}`;
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
      panelTitle.textContent = PANELS.find((p) => p.id === openPanel)?.label ?? '';
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
  const layerLift = (): number => Number(liftInput.value) || 0;

  /** Facets picked out by the pointer, shown with an accent outline in every view. */
  let highlighted: ReadonlySet<number> = new Set();

  const applyHighlight = (): void => {
    for (const svg of views) {
      for (const node of svg.querySelectorAll('[data-id]')) {
        node.classList.toggle('facet-hit', highlighted.has(Number(node.getAttribute('data-id'))));
      }
    }
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
          return `Redrawing step ${redrawing + 1}: drag the new fold line, then click the side that flips (Esc cancels).`;
        }
        const next = timeline.next;
        if (next) return `Next: ${describeStep(next)}. Press → to apply it or play (P).`;
        return tool === 'move'
          ? 'Drag to pan, scroll to zoom. Switch back to Fold to add creases.'
          : 'Drag to draw a fold line. Scroll to zoom, hold Space to pan.';
      }
      case 'dragging':
        return 'Release to set the fold line.';
      case 'choose-side':
        return redrawing !== null
          ? `Click the side that flips for step ${redrawing + 1} (Esc to cancel).`
          : 'Click the side that should flip over (Esc to cancel).';
      case 'animating':
        return playing ? 'Playing… (P or Esc to pause after this step)' : 'Folding…';
    }
  };

  /** The state whose statistics are on screen; they are not recomputed per animation frame. */
  let statsFor: PaperState | null = null;

  const render = (): void => {
    const state = timeline.state;
    let options = {};
    const next = timeline.next;
    // The step that would be applied next shows as its line only; shading is
    // for choosing a side by hand.
    if (phase.kind === 'idle' && next && !playing) {
      options = { preview: { line: next.line } };
    }
    if (phase.kind === 'dragging') {
      if (distance(phase.from, phase.to) >= MIN_DRAG) {
        options = { preview: { line: line(phase.from, phase.to) } };
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
    foldedSvg.dataset['tool'] = tool;
    toolFold.setAttribute('aria-pressed', String(tool === 'fold'));
    toolMove.setAttribute('aria-pressed', String(tool === 'move'));
    foldedSvg.innerHTML = renderFolded(state, options);
    unfoldedSvg.innerHTML = renderUnfolded(state);
    renderTimeline();
    renderStepPanel();
    // The layer view is framed at the aspect ratio its frame actually has.
    const rect = layersSvg.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : undefined;
    const layerOptions = {
      lift: layerLift(),
      ...(aspect === undefined ? {} : { aspect }),
      ...(phase.kind === 'animating' ? { animation: phase.animation } : {}),
    };
    creaseCount.textContent = `${state.creases.length} crease${state.creases.length === 1 ? '' : 's'}`;
    const layers = renderLayers(state, layerOptions);
    layersSvg.setAttribute('viewBox', layers.viewBox);
    layersSvg.innerHTML = layers.markup;
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
  const describeStep = (step: FoldStep): string => {
    if (step.label) return step.label;
    const { layers, placement } = step.options;
    const which =
      !layers || layers.kind === 'all'
        ? 'Fold all'
        : layers.kind === 'top'
          ? `Fold top ${layers.count}`
          : `Fold bottom ${layers.count}`;
    return placement && placement !== 'top' ? `${which} (${placement})` : which;
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
    playButton.title = playing ? 'Pause after this step (P)' : 'Play the remaining steps (P)';
    playButton.classList.toggle('is-playing', playing);
    exportButton.disabled = length === 0;
    positionReadout.textContent = `${two(position)} / ${two(length)}`;
    statusSteps.textContent = length === 0 ? 'No steps' : `Step ${two(position)} of ${two(length)}`;
    statusMessage.textContent = timelineMessage;
    statusMessage.classList.toggle('is-error', timelineMessage.startsWith('Could not'));
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
            ? `${describeStep(step)} — moves nothing on the sheet as it is at this point`
            : `${describeStep(step)} — click to go there, double-click to rename, drag to move`,
          style: `left: ${i * CLIP_WIDTH}px; width: ${CLIP_WIDTH - 4}px`,
        },
        [el('span', { class: 'tl-label' }, [describeStep(step)])],
      );
    });
    track.replaceChildren(...clips);
    revealPlayhead();
  };

  const say = (message: string): void => {
    timelineMessage = message;
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
          timeline.length === 0
            ? 'Fold something or load a preset, then select a step on the timeline.'
            : 'Select a step on the timeline (click a clip) to edit it here.',
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
      afterEdit(`${what} of step ${at + 1} changed.`, at);
    };
    const options = step.options;
    const layers = options.layers ?? ALL_LAYERS;

    const nameField = el('input', {
      type: 'text',
      class: 'ctl',
      value: step.label ?? '',
      placeholder: describeStep({ line: step.line, side: step.side, options }),
      'aria-label': 'Step name',
    });
    nameField.addEventListener('change', () => renameStep(at, nameField.value));

    const layerKind = el('select', { class: 'ctl', 'aria-label': 'Layers that move' });
    for (const [value, text] of [
      ['all', 'All layers'],
      ['top', 'Top n layers'],
      ['bottom', 'Bottom n layers'],
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
      'aria-label': 'Number of layers',
    });
    layerN.disabled = layers.kind === 'all';
    const applyLayers = (): void => {
      const kind = layerKind.value;
      const count = Math.max(1, Math.floor(Number(layerN.value) || 1));
      const next: LayerSelection =
        kind === 'top' ? topLayers(count) : kind === 'bottom' ? bottomLayers(count) : ALL_LAYERS;
      const rest: FoldOptions = { ...options };
      delete (rest as { layers?: LayerSelection }).layers;
      update({ options: next.kind === 'all' ? rest : { ...rest, layers: next } }, 'Layers');
    };
    layerKind.addEventListener('change', applyLayers);
    layerN.addEventListener('change', applyLayers);

    const placement = el('select', { class: 'ctl', 'aria-label': 'Where the moved paper lands' });
    for (const [value, text] of [
      ['top', 'On top (valley fold)'],
      ['bottom', 'Underneath (on the back)'],
      ['inside', 'Inside (reverse fold)'],
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
        'Placement',
      );
    });

    const flipButton = el('button', { type: 'button', class: 'btn panel-action' }, [
      'Flip which side moves',
    ]);
    flipButton.addEventListener('click', () => update({ side: step.side === 1 ? -1 : 1 }, 'Side'));
    const redrawButton = el('button', { type: 'button', class: 'btn panel-action' }, [
      redrawing === at ? 'Redrawing… (Esc cancels)' : 'Redraw the line on the folded sheet',
    ]);
    redrawButton.addEventListener('click', () => startRedraw(at));
    const setLine = (which: 'a' | 'b', axis: 'x' | 'y', n: number): void => {
      const a = { ...step.line.a };
      const b = { ...step.line.b };
      (which === 'a' ? a : b)[axis] = n;
      if (distance(a, b) < 1e-6) {
        say('Could not change the line: the two points would coincide.');
        return;
      }
      update({ line: line(a, b) }, 'Line');
    };
    const lineRow = (which: 'a' | 'b'): HTMLElement =>
      el('div', { class: 'size-row line-row' }, [
        el('span', { class: 'field-label' }, [which === 'a' ? 'From' : 'To']),
        numberField(step.line[which].x, (n) => setLine(which, 'x', n), `${which} x`),
        numberField(step.line[which].y, (n) => setLine(which, 'y', n), `${which} y`),
      ]);

    const limits: HTMLElement[] = [];
    for (const [key, text] of [
      ['region', 'Only facets inside a region of the unfolded sheet'],
      ['window', 'Only facets inside a window of the folded sheet'],
    ] as const) {
      const polygon = options[key];
      if (!polygon) continue;
      const remove = el('button', { type: 'button', class: 'btn' }, ['Remove']);
      remove.addEventListener('click', () => {
        const { region, window, ...others } = options;
        const rest: FoldOptions =
          key === 'region'
            ? { ...others, ...(window ? { window } : {}) }
            : { ...others, ...(region ? { region } : {}) };
        update({ options: rest }, key === 'region' ? 'Region' : 'Window');
      });
      limits.push(
        el('div', { class: 'limit-row' }, [
          el('span', {}, [`${text} (${polygon.length} points)`]),
          remove,
        ]),
      );
    }

    const effect = timeline.effect(at);
    stepPanel.replaceChildren(
      el('p', { class: 'help step-title' }, [
        `Step ${at + 1} of ${timeline.length}`,
        effect === false ? ' — moves nothing where it now sits' : '',
      ]),
      el('label', { class: 'field' }, [el('span', { class: 'field-label' }, ['Name']), nameField]),
      el('div', { class: 'field' }, [
        el('span', { class: 'field-label' }, ['Layers that move']),
        el('div', { class: 'size-row layers-row' }, [layerKind, layerN]),
      ]),
      el('label', { class: 'field' }, [
        el('span', { class: 'field-label' }, ['Where the moved paper lands']),
        placement,
      ]),
      el('div', { class: 'field' }, [
        el('span', { class: 'field-label' }, [
          `Fold line (folded coordinates at this step; the ${step.side === 1 ? 'left' : 'right'} side moves)`,
        ]),
        lineRow('a'),
        lineRow('b'),
        el('div', { class: 'panel-actions' }, [flipButton, redrawButton]),
      ]),
      ...(limits.length > 0
        ? [
            el('div', { class: 'field' }, [
              el('span', { class: 'field-label' }, ['Limits']),
              ...limits,
            ]),
          ]
        : []),
      el('p', { class: 'help' }, [
        'Every change replays the steps after this one; a step that then moves nothing is ',
        'marked on the timeline.',
      ]),
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
    say(`Draw the new line for step ${index + 1} on the folded sheet.`);
  };

  const cancelRedraw = (): void => {
    if (redrawing === null) return;
    redrawing = null;
    stepSignature = '';
    render();
  };

  // --- Folding ---------------------------------------------------------------
  const animate = (result: FoldResult): Promise<void> =>
    new Promise((resolve) => {
      const movedIds = new Set(result.movedIds);
      const start = performance.now();
      const tick = (now: number): void => {
        const progress = Math.min(1, ((now - start) * speed) / ANIMATION_MS);
        phase = {
          kind: 'animating',
          animation: { movedIds, line: result.line, progress },
          start,
        };
        render();
        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          phase = { kind: 'idle' };
          render();
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task, task);
    return queue;
  };

  /** How many later steps lost their effect; reported after an edit. */
  const deadAfter = (from: number): number =>
    timeline.steps.filter((_, i) => i >= from && timeline.effect(i) === false).length;

  const afterEdit = (message: string, from = 0): void => {
    const dead = deadAfter(from);
    phase = { kind: 'idle' };
    render();
    say(
      dead > 0
        ? `${message} ${dead} later step${dead === 1 ? ' now moves' : 's now move'} nothing.`
        : message,
    );
  };

  /** A fold made by hand: inserted at the playhead, the later steps stay. */
  const insertFold = (
    l: Line,
    side: Side,
    options: LayerSelection | FoldOptions,
  ): Promise<void> => {
    const opts: FoldOptions = 'kind' in options ? { layers: options } : options;
    const step: FoldStep = { line: l, side, options: opts };
    const probe = fold(timeline.state, l, side, opts);
    if (probe.movedIds.length === 0) {
      phase = { kind: 'idle' };
      render();
      say('That fold moves nothing.');
      return Promise.resolve();
    }
    const at = timeline.position;
    timeline.insert(at, step);
    const result = timeline.forward();
    selected = at;
    return (result ? animate(result) : Promise.resolve()).then(() =>
      afterEdit(`Inserted step ${at + 1}.`, at + 1),
    );
  };

  /** Apply the next step; animated unless `instant`. */
  const applyNext = async (instant = false): Promise<void> => {
    const result = timeline.forward();
    if (result && result.movedIds.length > 0 && !instant) await animate(result);
  };

  const stepForward = (): Promise<void> =>
    enqueue(async () => {
      if (timeline.position >= timeline.length) return;
      await applyNext();
      render();
    });

  const stepBack = (): void => {
    if (phase.kind === 'animating') return;
    timeline.back();
    phase = { kind: 'idle' };
    render();
  };

  /** Go to the state after `index` steps without animation. */
  const jumpTo = (index: number): void => {
    if (phase.kind === 'animating') return;
    playing = false;
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
      selected = null;
      setName(sequence.name);
      timelineMessage = '';
      phase = { kind: 'idle' };
      // Sequences start from the flat sheet, so show all of it like Reset does.
      camera = defaultCamera(timeline.state.width, timeline.state.height);
      render();
      if (paperChanged) say(`Sheet set to ${describePaper(paper)} for "${sequence.name}".`);
      if (autoplay) play();
    });
  };

  /** Change the face colours; nothing on the timeline moves. */
  const setColours = (front: string, back: string): void => {
    paper = { ...paper, front: front.toLowerCase(), back: back.toLowerCase() };
    applyLayout();
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
    for (const svg of [unfoldedSvg, layersSvg]) {
      svg.setAttribute('viewBox', viewBox(paper.width, paper.height));
    }
    camera = defaultCamera(paper.width, paper.height);
    phase = { kind: 'idle' };
    paperWidth.value = String(+paper.width.toFixed(4));
    paperHeight.value = String(+paper.height.toFixed(4));
    applyLayout();
    if (announce) say(`Sheet is now ${describePaper(paper)}; ${timeline.length} steps rewound.`);
  };

  const exportSequence = (): Sequence => ({
    name: sequenceName.trim() || 'My sequence',
    paper,
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
    say(`Saved ${sequence.steps.length} steps.`);
  };

  const importFile = async (file: File): Promise<void> => {
    try {
      const sequence = parseSequence(await file.text());
      await loadSequence(sequence);
      say(
        `Loaded "${sequence.name}": ${sequence.steps.length} steps on a ${describePaper(paper)} sheet. Press play.`,
      );
    } catch (error) {
      const reason = error instanceof SequenceError ? error.message : 'unreadable file';
      say(`Could not load ${file.name}: ${reason}`);
    }
  };

  // --- Editing the timeline ----------------------------------------------------
  const deleteStep = (index: number): void => {
    if (phase.kind === 'animating' || index < 0 || index >= timeline.length) return;
    playing = false;
    timeline.remove(index);
    selected = null;
    afterEdit(`Deleted step ${index + 1}.`, index);
  };

  const duplicateStep = (index: number): void => {
    if (phase.kind === 'animating') return;
    timeline.duplicate(index);
    selected = index + 1;
    afterEdit(`Duplicated step ${index + 1}.`, index + 1);
  };

  const moveStep = (from: number, to: number): void => {
    if (phase.kind === 'animating' || from === to) return;
    playing = false;
    timeline.move(from, to);
    selected = Math.max(0, Math.min(timeline.length - 1, to));
    afterEdit(`Moved step ${from + 1} to ${selected + 1}.`, Math.min(from, selected));
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
    afterEdit(`Removed ${count} step${count === 1 ? '' : 's'} after step ${index + 1}.`);
  };

  const undoEdit = (): void => {
    if (phase.kind === 'animating') return;
    playing = false;
    if (!timeline.undoEdit()) {
      say('Nothing to undo.');
      return;
    }
    if (selected !== null && selected >= timeline.length) selected = null;
    afterEdit('Undid the last edit.');
  };

  const redoEdit = (): void => {
    if (phase.kind === 'animating') return;
    playing = false;
    if (!timeline.redoEdit()) {
      say('Nothing to redo.');
      return;
    }
    if (selected !== null && selected >= timeline.length) selected = null;
    afterEdit('Redid the edit.');
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
      value: step.label ?? '',
      placeholder: describeStep({ line: step.line, side: step.side, options: step.options }),
      'aria-label': `Name of step ${index + 1}`,
    });
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      done = true;
      renaming = null;
      if (commit) renameStep(index, input.value);
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
      ['Rename', () => startRename(index)],
      [
        'Edit…',
        () => {
          selected = index;
          setPanel('step');
        },
      ],
      ['Go to this step', () => jumpTo(index + 1)],
      ['Duplicate', () => duplicateStep(index)],
      ['Move left', () => moveStep(index, index - 1), index === 0],
      ['Move right', () => moveStep(index, index + 1), index >= timeline.length - 1],
      ['Delete', () => deleteStep(index)],
      ['Delete steps after', () => truncateAfter(index), index >= timeline.length - 1],
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
        ['Fit the sheet (F)', fitView],
        ['Show the whole sheet (0)', fullView],
        [`Zoom ${zoomReadout.textContent ?? ''}`, () => undefined, true],
      ],
      rect.right - 180,
      rect.bottom + 4,
    );
  });
  root.append(menu);
  document.addEventListener('pointerdown', (event) => {
    const inside =
      event.target instanceof Node &&
      (menu.contains(event.target) || moreButton.contains(event.target));
    if (!menu.hidden && !inside) closeMenu();
  });

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
      const side = sideOf(phase.line, p);
      const l = phase.line;
      playing = false;
      if (redrawing !== null) {
        const at = redrawing;
        redrawing = null;
        timeline.update(at, { line: l, side });
        timeline.seek(at + 1);
        selected = at;
        stepSignature = '';
        afterEdit(`Line of step ${at + 1} redrawn.`, at);
        return;
      }
      // A fold made by hand is inserted at the playhead; later steps stay.
      void enqueue(() => insertFold(l, side, selectedLayers()));
      return;
    }
    if (phase.kind !== 'idle') return;
    foldedSvg.setPointerCapture(event.pointerId);
    phase = { kind: 'dragging', from: p, to: p };
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
      phase = { ...phase, to: p };
      render();
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
    const to = toModel(clientPoint(event));
    if (distance(phase.from, to) < MIN_DRAG) {
      phase = { kind: 'idle' };
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

  for (const svg of [unfoldedSvg, layersSvg]) {
    svg.addEventListener('pointermove', (event) => {
      const hit = event.target instanceof Element ? event.target.closest('[data-id]') : null;
      setHighlight(hit ? [Number(hit.getAttribute('data-id'))] : []);
    });
    svg.addEventListener('pointerleave', () => setHighlight([]));
  }
  liftInput.addEventListener('input', render);
  window.addEventListener('resize', scheduleFit);

  layoutButtons.forEach((button, i) => {
    button.addEventListener('click', () => setLayout(LAYOUTS[i]?.id ?? 'side-by-side'));
  });
  drawerToggle.addEventListener('click', toggleDrawer);
  railButtons.forEach((button, i) => {
    const id = PANELS[i]?.id ?? null;
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
      say(`Could not use that size: sides must be between 0 and ${MAX_PAPER_SIDE}.`);
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
  narrowQuery.addEventListener('change', applyLayout);
  new ResizeObserver(scheduleFit).observe(workspace);
  for (const strip of [unfoldedStrip, layersStrip]) {
    for (const button of strip.querySelectorAll('button')) {
      button.addEventListener('click', () => {
        const next = button.dataset['secondary'];
        if (next === 'unfolded' || next === 'layers') setSecondary(next);
      });
    }
  }
  tabButtons.forEach((button, i) => {
    button.addEventListener('click', () => setTab(VIEW_TABS[i]?.id ?? 'folded'));
  });

  toolFold.addEventListener('click', () => setTool('fold'));
  toolMove.addEventListener('click', () => setTool('move'));
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
    selected = null;
    setName('My sequence');
    timelineMessage = '';
    phase = { kind: 'idle' };
    camera = defaultCamera(timeline.state.width, timeline.state.height);
    render();
  };
  presetButtons.forEach((button, i) => {
    button.addEventListener('click', () => {
      const entry = LIBRARY[i];
      if (entry) {
        void loadSequence(entry.sequence).then(() =>
          say(
            `Loaded "${entry.sequence.name}": ${entry.sequence.steps.length} steps on a ${describePaper(paper)} sheet. Step with → or play.`,
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

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!menu.hidden) closeMenu();
      else if (redrawing !== null && phase.kind === 'idle') cancelRedraw();
      else if (playing) pause();
      else if (phase.kind === 'choose-side' || phase.kind === 'dragging') phase = { kind: 'idle' };
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
  });
  document.addEventListener('keyup', (event) => {
    if (event.key === ' ') {
      spaceHeld = false;
      delete foldedSvg.dataset['space'];
    }
  });
  window.addEventListener('blur', () => {
    spaceHeld = false;
    delete foldedSvg.dataset['space'];
    endNavigation();
  });

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
  };
}
