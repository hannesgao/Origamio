// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { SceneUnavailable, createScene } from '../src/scene3d';

describe('createScene without WebGL', () => {
  it('puts a note in the frame and gives the card a harmless canvas', () => {
    // jsdom has no WebGL, so three.js cannot make a renderer here.
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const frame = document.createElement('div');
    const scene = createScene(frame);
    error.mockRestore();
    expect(scene).toBeInstanceOf(SceneUnavailable);
    expect(frame.querySelector('.view-note')?.textContent).toContain('WebGL');
    expect(frame.querySelector('canvas')).toBeNull();
    expect(scene.pick(0, 0)).toBeNull();
    expect(() => scene.reorbit({ yaw: 0, pitch: 0, roll: 0, zoom: 1 }, undefined)).not.toThrow();
  });
});
