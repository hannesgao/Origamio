import { describe, expect, it } from 'vitest';

import { line, vec } from '../src/geometry';
import { FoldHistory, createPaper, topLayers } from '../src/paper';
import {
  type FoldStep,
  SequenceError,
  parseSequence,
  sequenceToJson,
  serializeSequence,
  stepToJson,
} from '../src/sequence';

const half: FoldStep = { line: line(vec(0.5, 0), vec(0.5, 1)), side: -1, options: {} };
const corner: FoldStep = {
  line: line(vec(0.2, 0), vec(0, 0.2)),
  side: 1,
  options: {
    layers: topLayers(2),
    region: [vec(0, 0), vec(0.5, 0), vec(0.5, 0.5), vec(0, 0.5)],
    placement: 'inside',
  },
  label: 'Tuck the corner',
};

describe('sequence JSON', () => {
  it('serialises a step compactly and omits defaults', () => {
    expect(stepToJson(half)).toEqual({
      line: [
        [0.5, 0],
        [0.5, 1],
      ],
      side: -1,
    });
    expect(stepToJson(corner)).toEqual({
      line: [
        [0.2, 0],
        [0, 0.2],
      ],
      side: 1,
      layers: { top: 2 },
      region: [
        [0, 0],
        [0.5, 0],
        [0.5, 0.5],
        [0, 0.5],
      ],
      placement: 'inside',
      label: 'Tuck the corner',
    });
  });

  it('round-trips through text', () => {
    const sequence = { name: 'Test', description: 'Two folds', steps: [half, corner] };
    const text = serializeSequence(sequence);
    expect(text).toContain('"line": [\n        [0.5, 0],\n        [0.5, 1]\n      ]');
    const parsed = parseSequence(text);
    expect(parsed).toEqual(sequence);
    expect(sequenceToJson(parsed)).toEqual(sequenceToJson(sequence));
  });

  it('replays the same way as the original folds', () => {
    const original = new FoldHistory(createPaper());
    original.fold(half.line, half.side, half.options);
    original.fold(corner.line, corner.side, corner.options, corner.label);
    const replayed = new FoldHistory(createPaper());
    for (const s of parseSequence(serializeSequence({ name: 'r', steps: original.steps })).steps) {
      replayed.fold(s.line, s.side, s.options, s.label);
    }
    expect(replayed.state.facets.map((f) => [f.poly, f.transform, f.z])).toEqual(
      original.state.facets.map((f) => [f.poly, f.transform, f.z]),
    );
    expect(replayed.steps[1]?.label).toBe('Tuck the corner');
  });

  it('rejects malformed input with the path of the problem', () => {
    const base = { format: 'origamio-sequence', version: 1, name: 'x', steps: [] };
    const bad = (patch: object, message: string): void => {
      expect(() => parseSequence({ ...base, ...patch })).toThrow(message);
    };
    expect(() => parseSequence('{')).toThrow(SequenceError);
    bad({ format: 'other' }, 'sequence.format');
    bad({ version: 2 }, 'sequence.version');
    bad({ name: ' ' }, 'sequence.name');
    bad({ steps: {} }, 'sequence.steps');
    bad({ steps: [{ line: [[0, 0]], side: 1 }] }, 'steps[0].line');
    bad(
      {
        steps: [
          {
            line: [
              [0, 0],
              [0, 0],
            ],
            side: 1,
          },
        ],
      },
      'coincide',
    );
    bad(
      {
        steps: [
          {
            line: [
              [0, 0],
              [1, 1],
            ],
            side: 0,
          },
        ],
      },
      'steps[0].side',
    );
    bad(
      {
        steps: [
          {
            line: [
              [0, 0],
              [1, 1],
            ],
            side: 1,
            layers: { top: 0 },
          },
        ],
      },
      'steps[0].layers',
    );
    bad(
      {
        steps: [
          {
            line: [
              [0, 0],
              [1, 1],
            ],
            side: 1,
            region: [[0, 0]],
          },
        ],
      },
      'steps[0].region',
    );
    bad(
      {
        steps: [
          {
            line: [
              [0, 0],
              [1, 1],
            ],
            side: 1,
            placement: 'under',
          },
        ],
      },
      'placement',
    );
    bad(
      {
        steps: [
          {
            line: [
              [0, 0],
              [1, 1],
            ],
            side: 1,
            label: 3,
          },
        ],
      },
      'steps[0].label',
    );
  });
});

describe('fold history steps', () => {
  it('records folds, hands them back on undo and forgets them on reset', () => {
    const history = new FoldHistory(createPaper());
    history.fold(half.line, half.side, half.options, 'Half');
    history.fold(corner.line, corner.side, corner.options);
    expect(history.steps.map((s) => s.label)).toEqual(['Half', undefined]);
    const undone = history.undo();
    expect(undone?.options.placement).toBe('inside');
    expect(history.steps).toHaveLength(1);
    history.reset();
    expect(history.steps).toHaveLength(0);
    expect(history.undo()).toBeNull();
  });
});
