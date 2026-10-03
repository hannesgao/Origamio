import { describe, expect, it } from 'vitest';

import { line, vec } from '../src/geometry';
import { createPaper, facetCount } from '../src/paper';
import { type FoldStep } from '../src/sequence';
import { Timeline } from '../src/timeline';

const half: FoldStep = {
  line: line(vec(0.5, 0), vec(0.5, 1)),
  side: -1,
  options: {},
  label: 'Half',
};
const top: FoldStep = { line: line(vec(0, 0.5), vec(1, 0.5)), side: 1, options: {}, label: 'Top' };
const corner: FoldStep = {
  line: line(vec(0.2, 0), vec(0, 0.2)),
  side: 1,
  options: {},
  label: 'Corner',
};
/** Only moves paper when the sheet still reaches x > 0.9. */
const sliver: FoldStep = {
  line: line(vec(0.9, 0), vec(0.9, 1)),
  side: -1,
  options: {},
  label: 'Sliver',
};

const timeline = (steps: FoldStep[] = [half, top, corner]): Timeline => {
  const t = new Timeline(createPaper());
  t.load(steps);
  return t;
};

describe('timeline playback', () => {
  it('seeks, steps forward and back with cached states', () => {
    const t = timeline();
    expect(t.position).toBe(0);
    expect(facetCount(t.state)).toBe(1);
    t.seek(2);
    expect(facetCount(t.state)).toBe(4);
    expect(t.back()).toBe(true);
    expect(facetCount(t.state)).toBe(2);
    const result = t.forward();
    expect(result?.movedIds).toHaveLength(2);
    t.seek(99);
    expect(t.position).toBe(3);
    expect(t.pending).toHaveLength(0);
    expect(t.applied.map((s) => s.label)).toEqual(['Half', 'Top', 'Corner']);
  });

  it('knows which steps move nothing', () => {
    const t = timeline([half, sliver]);
    expect(t.effect(0)).toBe(true);
    expect(t.effect(1)).toBe(false);
  });
});

describe('timeline editing', () => {
  it('inserts at the playhead and keeps the later steps', () => {
    const t = timeline();
    t.seek(1);
    t.insert(t.position, sliver);
    expect(t.steps.map((s) => s.label)).toEqual(['Half', 'Sliver', 'Top', 'Corner']);
    expect(t.effect(1)).toBe(false);
    expect(t.position).toBe(1);
  });

  it('removes, duplicates and moves steps and recomputes what follows', () => {
    const t = timeline();
    t.seek(3);
    t.remove(0);
    expect(t.steps.map((s) => s.label)).toEqual(['Top', 'Corner']);
    expect(t.position).toBe(2);
    expect(facetCount(t.state)).toBe(4);
    t.duplicate(1);
    expect(t.steps.map((s) => s.label)).toEqual(['Top', 'Corner', 'Corner']);
    expect(t.effect(2)).toBe(false);
    t.move(2, 0);
    expect(t.steps.map((s) => s.label)).toEqual(['Corner', 'Top', 'Corner']);
    t.truncate(1);
    expect(t.steps.map((s) => s.label)).toEqual(['Corner']);
    expect(t.position).toBe(1);
  });

  it('renames without touching the geometry', () => {
    const t = timeline();
    t.seek(3);
    const before = t.state;
    t.rename(1, '  Top half down  ');
    expect(t.steps[1]?.label).toBe('Top half down');
    expect(t.state).toBe(before);
    t.rename(1, '');
    expect(t.steps[1]?.label).toBeUndefined();
  });

  it('undoes and redoes edits independently of the playhead', () => {
    const t = timeline();
    t.seek(2);
    t.remove(1);
    t.rename(0, 'First');
    expect(t.canUndoEdit).toBe(true);
    expect(t.undoEdit()).toBe(true);
    expect(t.steps[0]?.label).toBe('Half');
    expect(t.undoEdit()).toBe(true);
    expect(t.steps.map((s) => s.label)).toEqual(['Half', 'Top', 'Corner']);
    expect(t.position).toBe(2);
    expect(facetCount(t.state)).toBe(4);
    expect(t.undoEdit()).toBe(false);
    expect(t.redoEdit()).toBe(true);
    expect(t.steps.map((s) => s.label)).toEqual(['Half', 'Corner']);
    t.clear();
    expect(t.length).toBe(0);
    expect(t.undoEdit()).toBe(true);
    expect(t.length).toBe(2);
  });

  it('starts over on another sheet keeping the steps', () => {
    const t = timeline();
    t.seek(3);
    t.resetSheet(createPaper(1, 0.5));
    expect(t.position).toBe(0);
    expect(t.state.height).toBe(0.5);
    expect(t.length).toBe(3);
    t.seek(3);
    expect(t.state.height).toBe(0.5);
  });
});
