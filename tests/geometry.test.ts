import { describe, expect, it } from 'vitest';

import {
  IDENTITY,
  apply,
  approxEqual,
  approxEqualVec,
  area,
  chord,
  clipPolygon,
  compose,
  intersectConvex,
  invert,
  line,
  partialFlip,
  perpendicularBisector,
  reflection,
  sideOf,
  signedDistance,
  vec,
} from '../src/geometry';

const square = [vec(0, 0), vec(1, 0), vec(1, 1), vec(0, 1)];

describe('reflection', () => {
  it('mirrors points across the line and is its own inverse', () => {
    const r = reflection(line(vec(0.5, 0), vec(0.5, 1)));
    expect(approxEqualVec(apply(r, vec(0.2, 0.7)), vec(0.8, 0.7))).toBe(true);
    const twice = compose(r, r);
    expect(approxEqualVec(apply(twice, vec(0.3, 0.9)), vec(0.3, 0.9))).toBe(true);
    const inv = invert(r);
    expect(approxEqualVec(apply(inv, vec(0.8, 0.7)), vec(0.2, 0.7))).toBe(true);
  });

  it('partialFlip interpolates between identity and reflection', () => {
    const l = line(vec(0, 0), vec(1, 1));
    expect(partialFlip(l, 0)).toEqual(IDENTITY);
    const half = partialFlip(l, Math.PI / 2);
    // At 90° every point collapses onto the line.
    expect(approxEqualVec(apply(half, vec(1, 0)), vec(0.5, 0.5))).toBe(true);
    const full = partialFlip(l, Math.PI);
    expect(approxEqualVec(apply(full, vec(1, 0)), vec(0, 1))).toBe(true);
  });
});

describe('clipPolygon', () => {
  it('splits a square into two halves', () => {
    const { positive, negative } = clipPolygon(square, line(vec(0.5, 0), vec(0.5, 1)));
    expect(area(positive)).toBeCloseTo(0.5);
    expect(area(negative)).toBeCloseTo(0.5);
  });

  it('returns an empty part when the line misses the polygon', () => {
    const { positive, negative } = clipPolygon(square, line(vec(2, 0), vec(2, 1)));
    expect(positive).toHaveLength(4);
    expect(negative).toHaveLength(0);
  });

  it('computes the chord of a line through a polygon', () => {
    const c = chord(square, line(vec(0.25, 0), vec(0, 0.25)));
    expect(c).not.toBeNull();
    // Endpoints are ordered along the line direction.
    expect(c?.map((p) => [p.x, p.y])).toEqual([
      [0.25, 0],
      [0, 0.25],
    ]);
  });
});

describe('intersectConvex', () => {
  it('intersects overlapping squares', () => {
    const shifted = square.map((p) => vec(p.x + 0.5, p.y + 0.5));
    expect(area(intersectConvex(square, shifted))).toBeCloseTo(0.25);
    expect(area(intersectConvex(square, [...shifted].reverse()))).toBeCloseTo(0.25);
  });

  it('is empty for disjoint polygons', () => {
    const far = square.map((p) => vec(p.x + 2, p.y));
    expect(intersectConvex(square, far)).toHaveLength(0);
  });
});

describe('perpendicularBisector', () => {
  it('is equally far from both points and folds one onto the other', () => {
    const a = vec(0, 0);
    const b = vec(1, 1);
    const l = perpendicularBisector(a, b);
    expect(approxEqual(Math.abs(signedDistance(l, a)), Math.abs(signedDistance(l, b)))).toBe(true);
    expect(sideOf(l, a)).not.toBe(sideOf(l, b));
    expect(approxEqualVec(apply(reflection(l), a), b)).toBe(true);
  });
});
