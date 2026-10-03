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
import {
  type FoldStep,
  type Sequence,
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
  FoldHistory,
  createPaper,
  facetCount,
  facetsAt,
  foldedPoints,
  maxLayers,
  topLayers,
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
  visibleExtent,
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

function svgElement(size: number, className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox(size));
  svg.setAttribute('class', className);
  return svg;
}

const UNDO_ICON = '<path d="M7.5 5.5 4 9l3.5 3.5" /><path d="M4 9h7.5a4 4 0 0 1 0 8H9" />';
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
const SIDEBAR_ICON = '<rect x="2.5" y="4" width="15" height="12" rx="1.5" /><path d="M7.5 4v12" />';
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
const RESET_ICON = '<path d="M4.5 10a5.5 5.5 0 1 0 1.6-3.9" /><path d="M4.5 3.5V7H8" />';

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
const SIDEBAR_KEY = 'origamio.sidebar';
const TIMELINE_KEY = 'origamio.timeline';

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
  readonly history: FoldHistory;
  /** Apply a fold immediately (no animation). Returns false when nothing moved. */
  fold(line: Line, side: Side, layers?: LayerSelection): boolean;
  /** Replace the sheet and the timeline with `sequence`; plays it when asked. */
  loadSequence(sequence: Sequence, play?: boolean): Promise<void>;
  /** Every step on the timeline, applied and pending, as a sequence. */
  exportSequence(): Sequence;
  /** Steps on the timeline that have not been applied yet. */
  readonly pending: readonly FoldStep[];
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
  const history = new FoldHistory(createPaper());
  let phase: Phase = { kind: 'idle' };
  let queue: Promise<void> = Promise.resolve();
  let camera: Camera = defaultCamera(history.state.size);
  let tool: Tool = 'fold';
  let spaceHeld = false;
  const rememberedLayout = remembered(LAYOUT_KEY);
  let layout: Layout = LAYOUTS.some((l) => l.id === rememberedLayout)
    ? (rememberedLayout as Layout)
    : 'side-by-side';
  let sidebarHidden = remembered(SIDEBAR_KEY) === 'hidden';
  let timelineCollapsed = remembered(TIMELINE_KEY) === 'collapsed';
  const rememberedSpeed = Number(remembered(SPEED_KEY));
  let speed = SPEEDS.includes(rememberedSpeed) ? rememberedSpeed : 1;
  /** Steps of the loaded sequence still to apply; undone folds come back here. */
  let pending: FoldStep[] = [];
  let playing = false;
  let sequenceName = 'My sequence';
  let timelineMessage = '';
  let navigation: Navigation | null = null;
  /** Last known position of every pointer that is down on the folded view. */
  const pointers = new Map<number, Vec>();

  // --- DOM -----------------------------------------------------------------
  const foldedSvg = svgElement(history.state.size, 'view folded-view');
  const unfoldedSvg = svgElement(history.state.size, 'view unfolded-view');
  const layersSvg = svgElement(history.state.size, 'view layers-view');
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
  const sidebarButton = el(
    'button',
    { type: 'button', class: 'btn', 'aria-pressed': 'true', title: 'Show or hide the controls' },
    [icon(SIDEBAR_ICON), el('span', { class: 'btn-label' }, ['Controls'])],
  );
  const layoutSwitch = el(
    'div',
    { class: 'tool-toggle layout-switch', role: 'group', 'aria-label': 'Layout' },
    layoutButtons,
  );

  const undoButton = el('button', { type: 'button', class: 'btn', title: 'Undo the last fold' }, [
    icon(UNDO_ICON),
    'Undo',
    el('kbd', {}, ['Ctrl Z']),
  ]);
  const resetButton = el(
    'button',
    { type: 'button', class: 'btn', title: 'Back to the flat sheet' },
    [icon(RESET_ICON), 'Reset'],
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

  // --- Timeline DOM ----------------------------------------------------------
  const transport = (name: keyof typeof TRANSPORT_ICONS, title: string): HTMLButtonElement =>
    el('button', { type: 'button', class: 'btn btn-sm transport', title }, [
      icon(TRANSPORT_ICONS[name]),
    ]);
  const startButton = transport('start', 'Back to the flat sheet (Home)');
  const backButton = transport('back', 'One step back (←)');
  const playButton = transport('play', 'Play the remaining steps (P)');
  const forwardButton = transport('forward', 'One step forward (→)');
  const endButton = transport('end', 'Apply all remaining steps at once (End)');
  const speedSelect = el('select', { class: 'tl-speed', 'aria-label': 'Playback speed' });
  for (const value of SPEEDS) {
    const option = el('option', { value: String(value) }, [`${value}×`]);
    if (value === speed) option.selected = true;
    speedSelect.append(option);
  }
  const positionReadout = el('span', { class: 'timeline-position' }, ['00 / 00']);
  const timelineStatus = el('span', { class: 'timeline-message', role: 'status' });
  const nameInput = el('input', {
    type: 'text',
    class: 'name-input',
    value: sequenceName,
    'aria-label': 'Sequence name',
    placeholder: 'Sequence name',
  });
  const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: '' });
  const importButton = el(
    'button',
    { type: 'button', class: 'btn btn-sm', title: 'Load a sequence from a JSON file' },
    [icon(IMPORT_ICON), el('span', { class: 'btn-label' }, ['Import'])],
  );
  const exportButton = el(
    'button',
    { type: 'button', class: 'btn btn-sm', title: 'Save the timeline as a JSON file' },
    [icon(EXPORT_ICON), el('span', { class: 'btn-label' }, ['Export'])],
  );
  const newButton = el(
    'button',
    { type: 'button', class: 'btn btn-sm', title: 'Clear the sheet and the timeline' },
    [icon(NEW_ICON), el('span', { class: 'btn-label' }, ['New'])],
  );
  const collapseButton = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm collapse',
      'aria-expanded': 'true',
      title: 'Collapse the timeline',
    },
    [icon(COLLAPSE_ICON)],
  );
  // The track: a ruler with one tick per step, the step clips, and a playhead
  // that sits on the boundary after the last applied step.
  const ruler = el('div', { class: 'tl-ruler' });
  const track = el('div', { class: 'tl-track', role: 'list', 'aria-label': 'Fold steps' });
  const playhead = el('div', { class: 'tl-playhead' }, [el('div', { class: 'tl-playhead-head' })]);
  const lanes = el('div', { class: 'tl-lanes' }, [ruler, track, playhead]);
  const scroller = el('div', { class: 'tl-scroll' }, [lanes]);
  const timelineCard = el('section', { class: 'card timeline-card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', {}, ['Timeline']),
      el('div', { class: 'card-tools' }, [
        nameInput,
        importButton,
        exportButton,
        newButton,
        collapseButton,
      ]),
    ]),
    el('div', { class: 'card-body' }, [
      el('div', { class: 'transport-bar' }, [
        el('div', { class: 'transport-group' }, [
          startButton,
          backButton,
          playButton,
          forwardButton,
          endButton,
        ]),
        el('label', { class: 'tl-speed-label' }, ['Speed', speedSelect]),
        positionReadout,
        timelineStatus,
      ]),
      scroller,
      importInput,
    ]),
  ]);

  const statFolds = el('span', { class: 'stat-value' }, ['0']);
  const statLayers = el('span', { class: 'stat-value' }, ['1']);
  const statFacets = el('span', { class: 'stat-value' }, ['1']);
  const statCursor = el('span', { class: 'stat-value' }, ['–']);
  const hint = el('span', { class: 'status-text' });
  const statusBar = el('div', { class: 'status-bar', role: 'status', 'aria-live': 'polite' }, [
    el('span', { class: 'status-dot' }),
    hint,
  ]);

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
    { type: 'button', class: 'btn btn-sm', title: 'Fit the folded sheet into view (F)' },
    [icon(FIT_ICON), el('span', { class: 'btn-label' }, ['Fit'])],
  );
  const fullButton = el(
    'button',
    { type: 'button', class: 'btn btn-sm', title: 'Show the whole sheet (0)' },
    [icon(FULL_ICON), el('span', { class: 'btn-label' }, ['Full'])],
  );
  const zoomReadout = el('span', { class: 'zoom', title: 'Zoom; scroll on the sheet to change' }, [
    '100%',
  ]);
  const viewTools = el('div', { class: 'card-tools' }, [
    el('div', { class: 'tool-toggle', role: 'group', 'aria-label': 'Drag tool' }, [
      toolFold,
      toolMove,
    ]),
    fitButton,
    fullButton,
    zoomReadout,
  ]);

  const liftInput = el('input', {
    type: 'range',
    min: '0',
    max: '0.2',
    step: '0.005',
    value: '0.06',
    'aria-label': 'Gap between layers',
  });
  const layerTools = el('div', { class: 'card-tools' }, [
    el('label', { class: 'range-label' }, ['Gap', liftInput]),
  ]);

  const stat = (value: HTMLElement, label: string): HTMLElement =>
    el('div', { class: 'stat' }, [value, el('span', { class: 'stat-label' }, [label])]);

  const card = (
    title: string,
    caption: string | HTMLElement,
    body: HTMLElement,
    extraClass = '',
  ): HTMLElement =>
    el('section', { class: `card ${extraClass}`.trim() }, [
      el('div', { class: 'card-head' }, [
        el('h2', {}, [title]),
        typeof caption === 'string' ? el('span', { class: 'caption' }, [caption]) : caption,
      ]),
      el('div', { class: 'card-body' }, [body]),
    ]);

  const legend = el('div', { class: 'legend' }, [
    el('span', {}, [el('i', { class: 'swatch swatch-front' }), 'Front side up']),
    el('span', {}, [el('i', { class: 'swatch swatch-back' }), 'Back side up']),
    el('span', {}, [el('i', { class: 'swatch swatch-crease' }), 'Crease']),
  ]);

  root.replaceChildren(
    el('header', { class: 'topbar' }, [
      el('div', { class: 'brand' }, [
        brandMark(),
        el('div', {}, [
          el('h1', {}, ['Origamio']),
          el('p', {}, ['Fold a square sheet along any line and watch the creases appear.']),
        ]),
      ]),
      el('div', { class: 'actions' }, [layoutSwitch, sidebarButton, undoButton, resetButton]),
    ]),
    el('div', { class: 'workspace' }, [
      el('aside', { class: 'sidebar' }, [
        card(
          'Layers to fold',
          '',
          el('div', {}, [
            el('fieldset', { class: 'segmented' }, [
              el('label', { class: 'seg' }, [layerAll, el('span', {}, ['All layers'])]),
              el('label', { class: 'seg' }, [layerTop, el('span', {}, ['Top']), layerCount]),
            ]),
            el('p', { class: 'help' }, [
              'Applies to the next fold you draw. A facet counts as a top layer when fewer than ',
              'that many layers lie above it.',
            ]),
          ]),
        ),
        card('Presets', '', el('div', { class: 'preset-list' }, presetButtons)),
        card(
          'Statistics',
          '',
          el('div', { class: 'stats' }, [
            stat(statFolds, 'Folds'),
            stat(statLayers, 'Max layers'),
            stat(statFacets, 'Facets unfolded'),
            stat(statCursor, 'Layers under cursor'),
          ]),
        ),
      ]),
      el('main', { class: 'views' }, [
        card(
          'Folded',
          viewTools,
          el('div', {}, [el('div', { class: 'view-frame' }, [foldedSvg]), statusBar]),
          'view-card folded-card',
        ),
        card(
          'Unfolded',
          'Crease pattern, live',
          el('div', {}, [el('div', { class: 'view-frame' }, [unfoldedSvg]), legend]),
          'view-card',
        ),
        card(
          'Layers',
          layerTools,
          el('div', {}, [
            el('div', { class: 'view-frame view-frame-wide' }, [layersSvg]),
            el('p', { class: 'help view-help' }, [
              'The stack seen from the front, each layer lifted a little. Point at a facet in ',
              'any view to find it in the others.',
            ]),
          ]),
          'view-card view-card-wide',
        ),
        timelineCard,
      ]),
    ]),
  );

  // --- Layout ----------------------------------------------------------------
  const applyLayout = (): void => {
    root.dataset['layout'] = layout;
    root.dataset['sidebar'] = sidebarHidden ? 'hidden' : 'shown';
    root.dataset['timeline'] = timelineCollapsed ? 'collapsed' : 'shown';
    collapseButton.setAttribute('aria-expanded', String(!timelineCollapsed));
    collapseButton.title = timelineCollapsed ? 'Expand the timeline' : 'Collapse the timeline';
    layoutButtons.forEach((button, i) => {
      button.setAttribute('aria-pressed', String(LAYOUTS[i]?.id === layout));
    });
    sidebarButton.setAttribute('aria-pressed', String(!sidebarHidden));
  };

  const setLayout = (next: Layout): void => {
    layout = next;
    remember(LAYOUT_KEY, next);
    applyLayout();
    render();
  };

  const toggleTimeline = (): void => {
    timelineCollapsed = !timelineCollapsed;
    remember(TIMELINE_KEY, timelineCollapsed ? 'collapsed' : 'shown');
    applyLayout();
    render();
  };

  const toggleSidebar = (): void => {
    sidebarHidden = !sidebarHidden;
    remember(SIDEBAR_KEY, sidebarHidden ? 'hidden' : 'shown');
    applyLayout();
    render();
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
        const next = pending[0];
        if (next) return `Next: ${describeStep(next)}. Press → to apply it or play (P).`;
        return tool === 'move'
          ? 'Drag to pan, scroll to zoom. Switch back to Fold to add creases.'
          : 'Drag to draw a fold line. Scroll to zoom, hold Space to pan.';
      }
      case 'dragging':
        return 'Release to set the fold line.';
      case 'choose-side':
        return 'Click the side that should flip over (Esc to cancel).';
      case 'animating':
        return playing ? 'Playing… (P or Esc to pause after this step)' : 'Folding…';
    }
  };

  /** The state whose statistics are on screen; they are not recomputed per animation frame. */
  let statsFor: PaperState | null = null;

  const render = (): void => {
    const state = history.state;
    let options = {};
    const next = pending[0];
    if (phase.kind === 'idle' && next && !playing) {
      options = { preview: { line: next.line, side: next.side } };
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
    foldedSvg.setAttribute('viewBox', cameraViewBox(state.size, camera));
    zoomReadout.textContent = `${Math.round(camera.zoom * 100)}%`;
    foldedSvg.dataset['tool'] = tool;
    toolFold.setAttribute('aria-pressed', String(tool === 'fold'));
    toolMove.setAttribute('aria-pressed', String(tool === 'move'));
    foldedSvg.innerHTML = renderFolded(state, options);
    unfoldedSvg.innerHTML = renderUnfolded(state);
    renderTimeline();
    // The layer view is framed at the aspect ratio its frame actually has.
    const rect = layersSvg.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : undefined;
    const layerOptions = {
      lift: layerLift(),
      ...(aspect === undefined ? {} : { aspect }),
      ...(phase.kind === 'animating' ? { animation: phase.animation } : {}),
    };
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
    undoButton.disabled = !history.canUndo || phase.kind === 'animating';
    resetButton.disabled = phase.kind === 'animating';
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
    const x = history.steps.length * CLIP_WIDTH;
    const { scrollLeft, clientWidth } = scroller;
    if (x < scrollLeft + 24) scroller.scrollLeft = Math.max(0, x - clientWidth / 3);
    else if (x > scrollLeft + clientWidth - 24) scroller.scrollLeft = x - (2 * clientWidth) / 3;
  };

  const renderTimeline = (): void => {
    const applied = history.steps;
    const total = applied.length + pending.length;
    const busy = phase.kind === 'animating';
    startButton.disabled = busy || applied.length === 0;
    backButton.disabled = busy || applied.length === 0;
    forwardButton.disabled = busy || pending.length === 0;
    endButton.disabled = busy || pending.length === 0;
    playButton.disabled = pending.length === 0 && !playing;
    playButton.innerHTML = '';
    playButton.append(icon(playing ? TRANSPORT_ICONS.pause : TRANSPORT_ICONS.play));
    playButton.title = playing ? 'Pause after this step (P)' : 'Play the remaining steps (P)';
    playButton.classList.toggle('is-playing', playing);
    exportButton.disabled = total === 0;
    positionReadout.textContent = `${two(applied.length)} / ${two(total)}`;
    timelineStatus.textContent = timelineMessage;
    timelineStatus.classList.toggle('is-error', timelineMessage.startsWith('Could not'));
    timelineCard.classList.toggle('is-playing', playing);

    // The playhead moves every frame while a step animates.
    const progress = phase.kind === 'animating' ? phase.animation.progress : 1;
    const head = (applied.length - 1 + progress) * CLIP_WIDTH;
    playhead.style.left = `${Math.max(0, head)}px`;

    const signature = `${applied.length}|${pending.length}|${applied
      .map(describeStep)
      .join()}|${pending.map(describeStep).join()}`;
    if (signature === timelineSignature) return;
    timelineSignature = signature;
    lanes.style.width = `${Math.max(1, total) * CLIP_WIDTH + CLIP_WIDTH / 2}px`;
    const ticks: HTMLElement[] = [];
    for (let i = 0; i <= total; i++) {
      ticks.push(el('span', { class: 'tl-tick', style: `left: ${i * CLIP_WIDTH}px` }, [two(i)]));
    }
    ruler.replaceChildren(...ticks);
    const clips: HTMLElement[] = [];
    const clip = (index: number, step: FoldStep, state: string): HTMLElement =>
      el(
        'div',
        {
          class: `tl-clip ${state}`,
          role: 'listitem',
          'data-index': String(index),
          title: `${describeStep(step)} — click to go to step ${index}`,
          style: `left: ${(index - 1) * CLIP_WIDTH}px; width: ${CLIP_WIDTH - 4}px`,
        },
        [el('b', {}, [two(index)]), el('span', {}, [describeStep(step)])],
      );
    applied.forEach((step, i) => {
      clips.push(clip(i + 1, step, i + 1 === applied.length ? 'done current' : 'done'));
    });
    pending.forEach((step, i) => {
      clips.push(clip(applied.length + i + 1, step, 'pending'));
    });
    track.replaceChildren(...clips);
    revealPlayhead();
  };

  const say = (message: string): void => {
    timelineMessage = message;
    renderTimeline();
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

  const foldAnimated = (
    l: Line,
    side: Side,
    options: LayerSelection | FoldOptions,
  ): Promise<void> => {
    const result = history.fold(l, side, options);
    if (!result) {
      phase = { kind: 'idle' };
      render();
      return Promise.resolve();
    }
    return animate(result);
  };

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task, task);
    return queue;
  };

  /** Apply the next pending step; animated unless `instant`. */
  const applyNext = async (instant = false): Promise<void> => {
    const step = pending.shift();
    if (!step) return;
    if (instant) {
      history.fold(step.line, step.side, step.options, step.label);
      return;
    }
    const result = history.fold(step.line, step.side, step.options, step.label);
    if (result) await animate(result);
  };

  const stepForward = (): Promise<void> =>
    enqueue(async () => {
      if (pending.length === 0) return;
      await applyNext();
      render();
    });

  const stepBack = (): void => {
    if (phase.kind === 'animating') return;
    const undone = history.undo();
    if (undone) pending.unshift(undone);
    phase = { kind: 'idle' };
    render();
  };

  /** Go to the state after `index` steps without animation. */
  const jumpTo = (index: number): void => {
    if (phase.kind === 'animating') return;
    playing = false;
    while (history.steps.length > index) {
      const undone = history.undo();
      if (!undone) break;
      pending.unshift(undone);
    }
    while (history.steps.length < index && pending.length > 0) {
      const step = pending.shift() as FoldStep;
      history.fold(step.line, step.side, step.options, step.label);
    }
    phase = { kind: 'idle' };
    render();
  };

  const pause = (): void => {
    playing = false;
    renderTimeline();
  };

  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const play = (): void => {
    if (playing || pending.length === 0) return;
    playing = true;
    renderTimeline();
    void enqueue(async () => {
      while (playing && pending.length > 0) {
        await applyNext();
        if (playing && pending.length > 0) await wait(STEP_GAP_MS / speed);
      }
      playing = false;
      render();
    });
  };

  const loadSequence = (sequence: Sequence, autoplay = false): Promise<void> => {
    playing = false;
    return enqueue(async () => {
      history.reset();
      pending = [...sequence.steps];
      sequenceName = sequence.name;
      nameInput.value = sequence.name;
      timelineMessage = '';
      phase = { kind: 'idle' };
      // Sequences start from the flat sheet, so show all of it like Reset does.
      camera = defaultCamera(history.state.size);
      render();
      if (autoplay) play();
    });
  };

  const exportSequence = (): Sequence => ({
    name: sequenceName.trim() || 'My sequence',
    steps: [...history.steps, ...pending],
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
      say(`Loaded "${sequence.name}": ${sequence.steps.length} steps. Press play.`);
    } catch (error) {
      const reason = error instanceof SequenceError ? error.message : 'unreadable file';
      say(`Could not load ${file.name}: ${reason}`);
    }
  };

  // --- Pointer interaction ---------------------------------------------------
  /** Sheet units per CSS pixel at the current zoom. */
  const unitsPerPixel = (): number =>
    visibleExtent(history.state.size, camera) / foldedSvg.getBoundingClientRect().width;

  const toModel = (client: Vec): Vec => {
    const rect = foldedSvg.getBoundingClientRect();
    const [vx, vy, vw, vh] = (foldedSvg.getAttribute('viewBox') ?? viewBox(history.state.size))
      .split(' ')
      .map(Number) as [number, number, number, number];
    const x = vx + ((client.x - rect.left) / rect.width) * vw;
    const y = vy + ((client.y - rect.top) / rect.height) * vh;
    return fromSvgPoint(vec(x, y), history.state.size);
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

  const fitView = (): void => setCamera(fitCamera(history.state.size, foldedPoints(history.state)));
  const fullView = (): void => setCamera(defaultCamera(history.state.size));

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
      // A fold made by hand starts a new branch: pending steps are dropped.
      pending = [];
      playing = false;
      void enqueue(() => foldAnimated(l, side, selectedLayers()));
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
    const under = facetsAt(history.state, p);
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
  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(render);
  });

  layoutButtons.forEach((button, i) => {
    button.addEventListener('click', () => setLayout(LAYOUTS[i]?.id ?? 'side-by-side'));
  });
  sidebarButton.addEventListener('click', toggleSidebar);
  collapseButton.addEventListener('click', toggleTimeline);

  toolFold.addEventListener('click', () => setTool('fold'));
  toolMove.addEventListener('click', () => setTool('move'));
  fitButton.addEventListener('click', fitView);
  fullButton.addEventListener('click', fullView);

  // --- Buttons ---------------------------------------------------------------
  /** Undo is a step back: the fold stays on the timeline and can be replayed. */
  const undo = (): void => stepBack();
  /** Reset returns to the flat sheet but keeps every step on the timeline. */
  const reset = (): void => {
    if (phase.kind === 'animating') return;
    jumpTo(0);
    camera = defaultCamera(history.state.size);
    render();
  };
  const clear = (): void => {
    if (phase.kind === 'animating') return;
    playing = false;
    history.reset();
    pending = [];
    sequenceName = 'My sequence';
    nameInput.value = sequenceName;
    timelineMessage = '';
    phase = { kind: 'idle' };
    camera = defaultCamera(history.state.size);
    render();
  };
  undoButton.addEventListener('click', undo);
  resetButton.addEventListener('click', reset);
  presetButtons.forEach((button, i) => {
    button.addEventListener('click', () => {
      const entry = LIBRARY[i];
      if (entry) {
        void loadSequence(entry.sequence).then(() =>
          say(
            `Loaded "${entry.sequence.name}": ${entry.sequence.steps.length} steps. Step with → or play.`,
          ),
        );
      }
    });
  });
  startButton.addEventListener('click', () => jumpTo(0));
  backButton.addEventListener('click', stepBack);
  forwardButton.addEventListener('click', () => void stepForward());
  endButton.addEventListener('click', () => jumpTo(history.steps.length + pending.length));
  playButton.addEventListener('click', () => (playing ? pause() : play()));
  speedSelect.addEventListener('change', () => {
    speed = Number(speedSelect.value) || 1;
    remember(SPEED_KEY, String(speed));
  });

  // Scrubbing: drag anywhere on the ruler or the track to move the playhead
  // from boundary to boundary; a click on a clip goes to the end of that step.
  let scrubbing = false;
  const boundaryAt = (clientX: number): number => {
    const left = lanes.getBoundingClientRect().left;
    const total = history.steps.length + pending.length;
    return Math.max(0, Math.min(total, Math.round((clientX - left) / CLIP_WIDTH)));
  };
  scroller.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || phase.kind === 'animating') return;
    const clipHit = event.target instanceof Element ? event.target.closest('.tl-clip') : null;
    scrubbing = true;
    scroller.setPointerCapture(event.pointerId);
    scroller.classList.add('is-scrubbing');
    if (clipHit && !event.shiftKey) jumpTo(Number(clipHit.getAttribute('data-index')));
    else jumpTo(boundaryAt(event.clientX));
  });
  scroller.addEventListener('pointermove', (event) => {
    if (!scrubbing || phase.kind === 'animating') return;
    const index = boundaryAt(event.clientX);
    if (index !== history.steps.length) jumpTo(index);
  });
  const endScrub = (): void => {
    scrubbing = false;
    scroller.classList.remove('is-scrubbing');
  };
  scroller.addEventListener('pointerup', endScrub);
  scroller.addEventListener('pointercancel', endScrub);
  nameInput.addEventListener('input', () => {
    sequenceName = nameInput.value;
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
      if (playing) pause();
      if (phase.kind === 'choose-side' || phase.kind === 'dragging') phase = { kind: 'idle' };
      render();
      return;
    }
    const inField =
      event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
    if (inField) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
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
      jumpTo(history.steps.length + pending.length);
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
    history,
    get state() {
      return history.state;
    },
    get camera() {
      return camera;
    },
    fitView,
    fullView,
    fold(l, side, layers = ALL_LAYERS) {
      pending = [];
      const result = history.fold(l, side, layers);
      phase = { kind: 'idle' };
      render();
      return result !== null;
    },
    loadSequence,
    exportSequence,
    get pending() {
      return pending;
    },
    stepForward,
    stepBack,
    jumpTo,
    play,
    pause,
    undo,
    reset,
  };
}
