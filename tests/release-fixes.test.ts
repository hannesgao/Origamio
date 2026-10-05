import { describe, expect, it } from 'vitest';

import { createPaper, fold } from '../src/paper';
import { parseSequence, serializeSequence } from '../src/sequence';
import { Timeline } from '../src/timeline';

const stepJson = {
  line: [
    [0.5, 0],
    [0.5, 1],
  ],
  side: 1,
};
const base = { format: 'origamio-sequence', version: 1, name: 'n', steps: [] as unknown[] };
const step = parseSequence({ ...base, steps: [stepJson] }).steps[0];
if (!step) throw new Error('step missing');

describe('sequence files', () => {
  it('keeps a label that looks like a point as the user wrote it', () => {
    const text = serializeSequence({
      name: 'n',
      steps: [{ ...step, label: '[ 3 ,4 ]' }],
    });
    expect(text).toContain('"label": "[ 3 ,4 ]"');
    expect(text).toContain('[0.5, 0]');
  });

  it('refuses files beyond the bounds a model can need', () => {
    expect(() =>
      parseSequence({ ...base, steps: Array.from({ length: 10001 }, () => stepJson) }),
    ).toThrow(/at most 10000 steps/);
    expect(() =>
      parseSequence({
        ...base,
        steps: [
          {
            line: [
              [1e7, 0],
              [0.5, 1],
            ],
            side: 1,
          },
        ],
      }),
    ).toThrow(/coordinates within/);
    expect(() =>
      parseSequence({
        ...base,
        steps: [{ ...stepJson, also: Array.from({ length: 257 }, () => stepJson) }],
      }),
    ).toThrow(/at most 256 folds/);
  });
});

describe('the timeline', () => {
  it('records a rename as an edit only when the name changes', () => {
    const timeline = new Timeline(createPaper());
    timeline.load([step]);
    timeline.rename(0, '  ');
    expect(timeline.canUndoEdit).toBe(false);
    timeline.rename(0, 'Half');
    expect(timeline.canUndoEdit).toBe(true);
    timeline.rename(0, 'Half ');
    timeline.undoEdit();
    expect(timeline.steps[0]?.label).toBeUndefined();
  });
});

describe('folding', () => {
  it('still folds a sheet in half', () => {
    expect(fold(createPaper(), step.line, step.side).state.facets).toHaveLength(2);
  });
});
