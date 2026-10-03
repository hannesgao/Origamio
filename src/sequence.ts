/**
 * Fold sequences as data. A sequence is a list of folds that can be replayed
 * on a fresh sheet: presets ship in this format, and anything folded by hand
 * can be exported to it. The JSON form is documented in the README.
 */
import { type Line, type Polygon, type Side, type Vec, distance, line, vec } from './geometry';
import {
  type FoldOptions,
  type LayerSelection,
  type Placement,
  ALL_LAYERS,
  bottomLayers,
  topLayers,
} from './paper';

export interface FoldStep {
  readonly line: Line;
  readonly side: Side;
  readonly options: FoldOptions;
  /** Short name shown on the timeline, such as "Petal fold". */
  readonly label?: string;
}

/** The sheet a sequence is folded from. Sides are in sheet units; the longer side is usually 1. */
export interface Paper {
  readonly width: number;
  readonly height: number;
}

export const DEFAULT_PAPER: Paper = { width: 1, height: 1 };

export interface Sequence {
  readonly name: string;
  readonly description?: string;
  /** Omitted in files means the unit square. */
  readonly paper?: Paper;
  readonly steps: readonly FoldStep[];
}

export const SEQUENCE_FORMAT = 'origamio-sequence';
export const SEQUENCE_VERSION = 1;

/** A point as `[x, y]`. */
export type PointJson = readonly [number, number];

export interface StepJson {
  /** Two points on the fold line, in the folded coordinates of that moment. */
  readonly line: readonly [PointJson, PointJson];
  /** Which side of the directed line flips over: +1 is to its left. */
  readonly side: 1 | -1;
  readonly layers?: 'all' | { readonly top: number } | { readonly bottom: number };
  readonly region?: readonly PointJson[];
  readonly window?: readonly PointJson[];
  readonly placement?: Placement;
  readonly label?: string;
}

export interface SequenceJson {
  readonly format: typeof SEQUENCE_FORMAT;
  readonly version: typeof SEQUENCE_VERSION;
  readonly name: string;
  readonly description?: string;
  readonly paper?: { readonly width: number; readonly height: number };
  readonly steps: readonly StepJson[];
}

/** Largest side length accepted for a sheet, in sheet units. */
export const MAX_PAPER_SIDE = 10;

const PLACEMENTS: readonly Placement[] = ['top', 'bottom', 'inside'];

const round = (n: number): number => Math.round(n * 1e6) / 1e6;
const pointJson = (p: Vec): PointJson => [round(p.x), round(p.y)];

function layersJson(layers: LayerSelection | undefined): StepJson['layers'] | undefined {
  if (!layers || layers.kind === 'all') return undefined;
  return layers.kind === 'top' ? { top: layers.count } : { bottom: layers.count };
}

export function stepToJson(step: FoldStep): StepJson {
  const { options } = step;
  const layers = layersJson(options.layers);
  return {
    line: [pointJson(step.line.a), pointJson(step.line.b)],
    side: step.side,
    ...(layers ? { layers } : {}),
    ...(options.region ? { region: options.region.map(pointJson) } : {}),
    ...(options.window ? { window: options.window.map(pointJson) } : {}),
    ...(options.placement && options.placement !== 'top' ? { placement: options.placement } : {}),
    ...(step.label ? { label: step.label } : {}),
  };
}

export function sequenceToJson(sequence: Sequence): SequenceJson {
  return {
    format: SEQUENCE_FORMAT,
    version: SEQUENCE_VERSION,
    name: sequence.name,
    ...(sequence.description ? { description: sequence.description } : {}),
    ...(sequence.paper
      ? { paper: { width: round(sequence.paper.width), height: round(sequence.paper.height) } }
      : {}),
    steps: sequence.steps.map(stepToJson),
  };
}

/** The JSON text of a sequence, indented for reading and diffing, points on one line. */
export const serializeSequence = (sequence: Sequence): string =>
  `${JSON.stringify(sequenceToJson(sequence), null, 2).replace(
    /\[\s*(-?[\d.e+-]+),\s*(-?[\d.e+-]+)\s*\]/g,
    '[$1, $2]',
  )}\n`;

// --- Parsing -------------------------------------------------------------------

export class SequenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SequenceError';
  }
}

const fail = (where: string, what: string): never => {
  throw new SequenceError(`${where}: ${what}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parsePoint(value: unknown, where: string): Vec {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    return fail(where, 'expected a point as [x, y]');
  }
  return vec(value[0] as number, value[1] as number);
}

function parsePolygon(value: unknown, where: string): Polygon {
  if (!Array.isArray(value) || value.length < 3) {
    return fail(where, 'expected a polygon with at least three points');
  }
  return value.map((p, i) => parsePoint(p, `${where}[${i}]`));
}

function parseLayers(value: unknown, where: string): LayerSelection {
  if (value === undefined || value === 'all') return ALL_LAYERS;
  if (isRecord(value)) {
    const count = value['top'] ?? value['bottom'];
    const kind = 'top' in value ? 'top' : 'bottom' in value ? 'bottom' : null;
    if (kind && typeof count === 'number' && Number.isInteger(count) && count >= 1) {
      return kind === 'top' ? topLayers(count) : bottomLayers(count);
    }
  }
  return fail(where, 'expected "all", { "top": n } or { "bottom": n } with n ≥ 1');
}

export function parseStep(value: unknown, where = 'step'): FoldStep {
  if (!isRecord(value)) return fail(where, 'expected an object');
  const lineValue = value['line'];
  if (!Array.isArray(lineValue) || lineValue.length !== 2) {
    return fail(`${where}.line`, 'expected two points');
  }
  const a = parsePoint(lineValue[0], `${where}.line[0]`);
  const b = parsePoint(lineValue[1], `${where}.line[1]`);
  if (distance(a, b) < 1e-9) return fail(`${where}.line`, 'the two points coincide');
  const side = value['side'];
  if (side !== 1 && side !== -1) return fail(`${where}.side`, 'expected 1 or -1');
  const options: {
    layers?: LayerSelection;
    region?: Polygon;
    window?: Polygon;
    placement?: Placement;
  } = {};
  const layers = parseLayers(value['layers'], `${where}.layers`);
  if (layers.kind !== 'all') options.layers = layers;
  if (value['region'] !== undefined) {
    options.region = parsePolygon(value['region'], `${where}.region`);
  }
  if (value['window'] !== undefined) {
    options.window = parsePolygon(value['window'], `${where}.window`);
  }
  const placement = value['placement'];
  if (placement !== undefined) {
    if (!PLACEMENTS.includes(placement as Placement)) {
      return fail(`${where}.placement`, `expected one of ${PLACEMENTS.join(', ')}`);
    }
    if (placement !== 'top') options.placement = placement as Placement;
  }
  const label = value['label'];
  if (label !== undefined && typeof label !== 'string') {
    return fail(`${where}.label`, 'expected a string');
  }
  return {
    line: line(a, b),
    side,
    options,
    ...(typeof label === 'string' && label ? { label } : {}),
  };
}

/** Parse a sequence from its JSON form (an object or JSON text); throws SequenceError. */
export function parseSequence(input: unknown): Sequence {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (error) {
      return fail('sequence', `not valid JSON (${(error as Error).message})`);
    }
  }
  if (!isRecord(value)) return fail('sequence', 'expected an object');
  if (value['format'] !== SEQUENCE_FORMAT) {
    return fail('sequence.format', `expected "${SEQUENCE_FORMAT}"`);
  }
  if (value['version'] !== SEQUENCE_VERSION) {
    return fail('sequence.version', `expected ${SEQUENCE_VERSION}`);
  }
  const name = value['name'];
  if (typeof name !== 'string' || !name.trim()) return fail('sequence.name', 'expected a name');
  const description = value['description'];
  if (description !== undefined && typeof description !== 'string') {
    return fail('sequence.description', 'expected a string');
  }
  const steps = value['steps'];
  if (!Array.isArray(steps)) return fail('sequence.steps', 'expected an array');
  const paperValue = value['paper'];
  let paper: Paper | undefined;
  if (paperValue !== undefined) {
    if (!isRecord(paperValue)) return fail('sequence.paper', 'expected { width, height }');
    const width = paperValue['width'];
    const height = paperValue['height'];
    const side = (n: unknown): n is number =>
      typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= MAX_PAPER_SIDE;
    if (!side(width) || !side(height)) {
      return fail('sequence.paper', `expected sides between 0 and ${MAX_PAPER_SIDE}`);
    }
    paper = { width, height };
  }
  return {
    name: name.trim(),
    ...(typeof description === 'string' && description ? { description } : {}),
    ...(paper ? { paper } : {}),
    steps: steps.map((s, i) => parseStep(s, `steps[${i}]`)),
  };
}
