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
import { type Preset, PRESETS } from './presets';
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
  runPreset(preset: Preset): Promise<void>;
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
  const presetButtons = PRESETS.map((preset) =>
    el(
      'button',
      { type: 'button', class: 'preset', 'data-preset': preset.id, title: preset.title },
      [
        el('span', { class: 'preset-label' }, [preset.label]),
        el('span', { class: 'preset-desc' }, [preset.title]),
      ],
    ),
  );

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
      ]),
    ]),
  );

  // --- Layout ----------------------------------------------------------------
  const applyLayout = (): void => {
    root.dataset['layout'] = layout;
    root.dataset['sidebar'] = sidebarHidden ? 'hidden' : 'shown';
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
      case 'idle':
        return tool === 'move'
          ? 'Drag to pan and scroll to zoom. Switch back to Fold to add creases.'
          : 'Drag on the folded sheet to draw a fold line. Scroll to zoom, hold Space to pan.';
      case 'dragging':
        return 'Release to set the fold line.';
      case 'choose-side':
        return 'Click the side that should flip over (Esc to cancel).';
      case 'animating':
        return 'Folding…';
    }
  };

  /** The state whose statistics are on screen; they are not recomputed per animation frame. */
  let statsFor: PaperState | null = null;

  const render = (): void => {
    const state = history.state;
    let options = {};
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

  // --- Folding ---------------------------------------------------------------
  const animate = (result: FoldResult): Promise<void> =>
    new Promise((resolve) => {
      const movedIds = new Set(result.movedIds);
      const start = performance.now();
      const tick = (now: number): void => {
        const progress = Math.min(1, (now - start) / ANIMATION_MS);
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

  const runPreset = (preset: Preset): Promise<void> =>
    enqueue(async () => {
      history.reset();
      phase = { kind: 'idle' };
      // Presets start from the flat sheet, so show all of it like Reset does.
      camera = defaultCamera(history.state.size);
      render();
      for (const { line: l, movingPoint, ...options } of preset.steps) {
        await foldAnimated(l, sideOf(l, movingPoint), options);
      }
    });

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

  toolFold.addEventListener('click', () => setTool('fold'));
  toolMove.addEventListener('click', () => setTool('move'));
  fitButton.addEventListener('click', fitView);
  fullButton.addEventListener('click', fullView);

  // --- Buttons ---------------------------------------------------------------
  const undo = (): void => {
    if (phase.kind === 'animating') return;
    history.undo();
    phase = { kind: 'idle' };
    render();
  };
  const reset = (): void => {
    if (phase.kind === 'animating') return;
    history.reset();
    phase = { kind: 'idle' };
    camera = defaultCamera(history.state.size);
    render();
  };
  undoButton.addEventListener('click', undo);
  resetButton.addEventListener('click', reset);
  presetButtons.forEach((button, i) => {
    button.addEventListener('click', () => {
      void runPreset(PRESETS[i] as Preset);
    });
  });
  layerTop.addEventListener('change', () => layerCount.focus());
  layerCount.addEventListener('input', () => {
    layerTop.checked = true;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (phase.kind === 'choose-side' || phase.kind === 'dragging')) {
      phase = { kind: 'idle' };
      render();
      return;
    }
    const inField = event.target instanceof HTMLInputElement;
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
      const result = history.fold(l, side, layers);
      phase = { kind: 'idle' };
      render();
      return result !== null;
    },
    runPreset,
    undo,
    reset,
  };
}
