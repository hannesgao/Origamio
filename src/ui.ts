/**
 * The interactive application: toolbar, the folded view with drag-to-fold
 * interaction, the live unfolded view, statistics, undo/reset and presets.
 */
import { type Line, type Side, type Vec, distance, line, sideOf, vec } from './geometry';
import {
  type FoldResult,
  type LayerSelection,
  type PaperState,
  ALL_LAYERS,
  FoldHistory,
  createPaper,
  facetCount,
  layersAt,
  maxLayers,
  topLayers,
} from './paper';
import {
  type FoldAnimation,
  BACK_COLOR,
  FRONT_COLOR,
  fromSvgPoint,
  renderFolded,
  renderUnfolded,
  viewBox,
} from './render';

export const ANIMATION_MS = 800;
/** Drags shorter than this (in sheet units) are ignored. */
const MIN_DRAG = 0.02;

export interface PresetStep {
  readonly line: Line;
  readonly movingPoint: Vec;
  readonly layers?: LayerSelection;
}

export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly steps: readonly PresetStep[];
}

const stepOf = (a: Vec, b: Vec, movingPoint: Vec, layers?: LayerSelection): PresetStep =>
  layers ? { line: line(a, b), movingPoint, layers } : { line: line(a, b), movingPoint };

const halfLeftRight = stepOf(vec(0.5, 0), vec(0.5, 1), vec(1, 0.5));
const halfTopBottom = stepOf(vec(0, 0.5), vec(1, 0.5), vec(0.25, 1));
const quarterLeftRight = stepOf(vec(0.25, 0), vec(0.25, 1), vec(0.5, 0.25));

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
    steps: [halfLeftRight, halfTopBottom, stepOf(vec(0.2, 0), vec(0, 0.2), vec(0, 0))],
  },
  {
    id: 'corner-two-edges',
    label: 'Halves + centre corner',
    title: 'Fold in half twice, then fold the corner where both folded edges meet',
    steps: [halfLeftRight, halfTopBottom, stepOf(vec(0.5, 0.3), vec(0.3, 0.5), vec(0.5, 0.5))],
  },
  {
    id: 'corner-one-edge',
    label: 'Halves + single-edge corner',
    title: 'Fold in half twice, then fold a corner that has only one folded edge',
    steps: [halfLeftRight, halfTopBottom, stepOf(vec(0.3, 0), vec(0.5, 0.2), vec(0.5, 0))],
  },
];

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
}

export function createApp(root: HTMLElement): App {
  const history = new FoldHistory(createPaper());
  let phase: Phase = { kind: 'idle' };
  let queue: Promise<void> = Promise.resolve();

  // --- DOM -----------------------------------------------------------------
  const foldedSvg = svgElement(history.state.size, 'view folded-view');
  const unfoldedSvg = svgElement(history.state.size, 'view unfolded-view');

  const layerAll = el('input', { type: 'radio', name: 'layers', value: 'all', checked: '' });
  const layerTop = el('input', { type: 'radio', name: 'layers', value: 'top' });
  const layerCount = el('input', {
    type: 'number',
    min: '1',
    step: '1',
    value: '1',
    'aria-label': 'Number of top layers to fold',
  });

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
    el('button', { type: 'button', class: 'preset', 'data-preset': preset.id }, [
      el('span', { class: 'preset-label' }, [preset.label]),
      el('span', { class: 'preset-desc' }, [preset.title]),
    ]),
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

  const stat = (value: HTMLElement, label: string): HTMLElement =>
    el('div', { class: 'stat' }, [value, el('span', { class: 'stat-label' }, [label])]);

  const card = (title: string, caption: string, body: HTMLElement, extraClass = ''): HTMLElement =>
    el('section', { class: `card ${extraClass}`.trim() }, [
      el('div', { class: 'card-head' }, [
        el('h2', {}, [title]),
        el('span', { class: 'caption' }, [caption]),
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
      el('div', { class: 'actions' }, [undoButton, resetButton]),
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
          'Drag to draw a fold line',
          el('div', {}, [el('div', { class: 'view-frame' }, [foldedSvg]), statusBar]),
          'view-card',
        ),
        card(
          'Unfolded',
          'Crease pattern, live',
          el('div', {}, [el('div', { class: 'view-frame' }, [unfoldedSvg]), legend]),
          'view-card',
        ),
      ]),
    ]),
  );

  // --- Rendering -------------------------------------------------------------
  const selectedLayers = (): LayerSelection => {
    if (layerAll.checked) return ALL_LAYERS;
    const n = Math.max(1, Math.floor(Number(layerCount.value) || 1));
    return topLayers(n);
  };

  const hintFor = (p: Phase): string => {
    switch (p.kind) {
      case 'idle':
        return 'Drag on the folded sheet to draw a fold line.';
      case 'dragging':
        return 'Release to set the fold line.';
      case 'choose-side':
        return 'Click the side that should flip over (Esc to cancel).';
      case 'animating':
        return 'Folding…';
    }
  };

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
    foldedSvg.innerHTML = renderFolded(state, options);
    unfoldedSvg.innerHTML = renderUnfolded(state);
    statFolds.textContent = String(state.foldCount);
    statLayers.textContent = String(maxLayers(state));
    statFacets.textContent = String(facetCount(state));
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

  const foldAnimated = (l: Line, side: Side, layers: LayerSelection): Promise<void> => {
    const result = history.fold(l, side, layers);
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
      render();
      for (const step of preset.steps) {
        const side = sideOf(step.line, step.movingPoint);
        await foldAnimated(step.line, side, step.layers ?? ALL_LAYERS);
      }
    });

  // --- Pointer interaction ---------------------------------------------------
  const toModel = (event: PointerEvent): Vec => {
    const rect = foldedSvg.getBoundingClientRect();
    const [vx, vy, vw, vh] = viewBox(history.state.size).split(' ').map(Number) as [
      number,
      number,
      number,
      number,
    ];
    const x = vx + ((event.clientX - rect.left) / rect.width) * vw;
    const y = vy + ((event.clientY - rect.top) / rect.height) * vh;
    return fromSvgPoint(vec(x, y), history.state.size);
  };

  foldedSvg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const p = toModel(event);
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
    const p = toModel(event);
    statCursor.textContent = String(layersAt(history.state, p));
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

  foldedSvg.addEventListener('pointerup', (event) => {
    if (phase.kind !== 'dragging') return;
    const to = toModel(event);
    if (distance(phase.from, to) < MIN_DRAG) {
      phase = { kind: 'idle' };
    } else {
      phase = { kind: 'choose-side', line: line(phase.from, to) };
    }
    render();
  });

  foldedSvg.addEventListener('pointerleave', () => {
    statCursor.textContent = '–';
    if (phase.kind === 'choose-side' && phase.hover !== undefined) {
      phase = { kind: 'choose-side', line: phase.line };
      render();
    }
  });

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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !inField) {
      event.preventDefault();
      undo();
    }
  });

  render();

  return {
    root,
    history,
    get state() {
      return history.state;
    },
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
