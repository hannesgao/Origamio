import { describe, expect, it } from 'vitest';

import { vec } from '../src/geometry';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  VIEW_PADDING,
  cameraViewBox,
  clampZoom,
  defaultCamera,
  fitCamera,
  viewBox,
  visibleExtent,
} from '../src/render';

const parse = (box: string): number[] => box.split(' ').map(Number);

describe('camera', () => {
  it('shows the whole padded sheet by default', () => {
    expect(cameraViewBox(1, defaultCamera(1))).toBe(viewBox(1));
    expect(parse(viewBox(1))).toEqual([-VIEW_PADDING, -VIEW_PADDING, 1.2, 1.2]);
  });

  it('halves the visible extent when zooming in twice', () => {
    const camera = { centre: vec(0.25, 0.25), zoom: 2 };
    expect(visibleExtent(1, camera)).toBeCloseTo(0.6);
    const [x, y, w, h] = parse(cameraViewBox(1, camera));
    expect(w).toBeCloseTo(0.6);
    expect(h).toBeCloseTo(0.6);
    // Centre (0.25, 0.25) in model space is (0.25, 0.75) in SVG space (y down).
    expect(x).toBeCloseTo(0.25 - 0.3);
    expect(y).toBeCloseTo(0.75 - 0.3);
  });

  it('frames the given points with the usual padding', () => {
    // The left half of the sheet: fitting it doubles the zoom around its centre.
    const camera = fitCamera(1, [vec(0, 0), vec(0.5, 0), vec(0.5, 1), vec(0, 1)]);
    expect(camera.centre).toEqual(vec(0.25, 0.5));
    expect(camera.zoom).toBeCloseTo(1.2 / (1 + 2 * VIEW_PADDING));
    const quarter = fitCamera(1, [vec(0, 0), vec(0.25, 0), vec(0.25, 0.25), vec(0, 0.25)]);
    expect(quarter.zoom).toBeCloseTo(1.2 / 0.45);
  });

  it('falls back to the default camera for no points and clamps the zoom', () => {
    expect(fitCamera(1, [])).toEqual(defaultCamera(1));
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(1e9)).toBe(MAX_ZOOM);
    // A single point still gets the padding around it, so the zoom stays finite.
    expect(fitCamera(1, [vec(0.5, 0.5)]).zoom).toBeCloseTo(1.2 / (2 * VIEW_PADDING));
  });
});
