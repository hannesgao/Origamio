/**
 * The 3D card's renderer: the solved sheet drawn with three.js. Facets are
 * extruded to the paper's thickness, lit by a soft key light with a ground
 * shadow, creases and edges drawn as lines, and the facet under the pointer
 * found by ray casting. Everything geometric comes from `solvedScene`; this
 * module only turns it into GPU buffers and a camera.
 */
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShadowMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

import { type Vec3 } from './rigid';
import { type ViewFrame } from './sequence';
import {
  type Orbit,
  type SolvedScene,
  DEFAULT_FRAME,
  MAX_ORBIT_ZOOM,
  MIN_ORBIT_ZOOM,
  viewRotation,
} from './view3d';

export interface SceneStyle {
  /** Hex colours of the paper's two faces. */
  readonly front: string;
  readonly back: string;
  /** Line colour for creases and edges. */
  readonly ink: string;
  /** Thickness of the paper, in sheet units. */
  readonly thickness: number;
  /** Whether to draw the ground shadow. */
  readonly shadow: boolean;
  /** Perspective (near things larger) or orthographic (true lengths, as in a drawing). */
  readonly perspective: boolean;
}

/** Vertical field of view of the perspective camera, in degrees. */
export const FOV = 20;

/**
 * Where the camera stands and what it frames, for a model of the given reach
 * at the given zoom: the distance from the centre along the line of sight,
 * and the half-height of the picture at the centre. Both cameras use the
 * same values, so switching projection keeps the model the same size.
 */
export function cameraFrame(reach: number, zoom: number): { distance: number; half: number } {
  const z = Math.max(MIN_ORBIT_ZOOM, Math.min(MAX_ORBIT_ZOOM, zoom));
  const half = (reach * 1.15) / z;
  return { distance: half / Math.tan((FOV * Math.PI) / 360), half };
}

/** Per-face colour and a flat normal for every triangle; no index buffer. */
export interface Built {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colours: Float32Array;
  /** Facet id of every triangle, by triangle index. */
  readonly triangleFacet: number[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

export function buildMesh(
  scene: SolvedScene,
  style: SceneStyle,
  highlighted: ReadonlySet<number>,
): Built {
  const front = new Color(style.front);
  const back = new Color(style.back);
  const side = front.clone().lerp(back, 0.5).multiplyScalar(0.85);
  const lift = (c: Color): Color => c.clone().lerp(new Color('#ffffff'), 0.35);
  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const triangleFacet: number[] = [];
  const t = style.thickness / 2;
  const push = (a: Vec3, b: Vec3, c: Vec3, n: Vec3, colour: Color, facet: number): void => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
    colours.push(
      colour.r,
      colour.g,
      colour.b,
      colour.r,
      colour.g,
      colour.b,
      colour.r,
      colour.g,
      colour.b,
    );
    triangleFacet.push(facet);
  };
  for (const panel of scene.panels) {
    const id = panel.facet.id;
    const n = unit(panel.normal);
    const hit = highlighted.has(id);
    const top = hit ? lift(front) : front;
    const bottom = hit ? lift(back) : back;
    const rim = hit ? lift(side) : side;
    const up = panel.points.map((p) => add(p, mul(n, t)));
    const down = panel.points.map((p) => sub(p, mul(n, t)));
    const count = panel.points.length;
    // Fan triangulation of the convex polygon, front face up, back face down.
    for (let i = 1; i + 1 < count; i++) {
      push(up[0] as Vec3, up[i] as Vec3, up[i + 1] as Vec3, n, top, id);
      push(down[0] as Vec3, down[i + 1] as Vec3, down[i] as Vec3, mul(n, -1), bottom, id);
    }
    if (t > 0) {
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        const a = up[i] as Vec3;
        const b = up[j] as Vec3;
        const c = down[j] as Vec3;
        const d = down[i] as Vec3;
        const sn = unit(cross(sub(b, a), sub(d, a)));
        push(a, b, c, sn, rim, id);
        push(a, c, d, sn, rim, id);
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colours: new Float32Array(colours),
    triangleFacet,
  };
}

/** What the 3D card needs from its renderer; `createScene` picks the one that works here. */
export interface SheetScene {
  readonly canvas: HTMLCanvasElement;
  resize(): void;
  update(
    solved: SolvedScene,
    style: SceneStyle,
    orbit: Orbit,
    frame: ViewFrame | undefined,
    highlighted: ReadonlySet<number>,
  ): void;
  highlight(highlighted: ReadonlySet<number>): void;
  reorbit(orbit: Orbit, frame: ViewFrame | undefined): void;
  pick(clientX: number, clientY: number): number | null;
  dispose(): void;
}

/**
 * The 3D card without WebGL: a note in the frame instead of a picture, and
 * a canvas that is never shown so the card's pointer handlers have
 * something harmless to listen to.
 */
export class SceneUnavailable implements SheetScene {
  readonly canvas = document.createElement('canvas');

  constructor(container: HTMLElement, reason: string) {
    const note = document.createElement('p');
    note.className = 'view-note';
    note.textContent = reason;
    container.append(note);
  }

  // Nothing to draw, so every call is a no-op.
  resize(): void {
    return;
  }
  update(): void {
    return;
  }
  highlight(): void {
    return;
  }
  reorbit(): void {
    return;
  }
  pick(): number | null {
    return null;
  }
  dispose(): void {
    return;
  }
}

/** The WebGL renderer, or the note if this browser cannot give us a WebGL context. */
export function createScene(container: HTMLElement): SheetScene {
  try {
    return new Scene3d(container);
  } catch {
    return new SceneUnavailable(
      container,
      'The 3D view needs WebGL, which this browser does not provide. The other views still work.',
    );
  }
}

export class Scene3d implements SheetScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly perspectiveCamera = new PerspectiveCamera(FOV, 1, 0.01, 100);
  private readonly orthographicCamera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  private aspect = 1;
  private readonly key = new DirectionalLight(0xffffff, 1.6);
  private readonly mesh: Mesh;
  private readonly lines: LineSegments;
  private readonly ground: Mesh;
  private readonly raycaster = new Raycaster();
  private triangleFacet: number[] = [];
  private last: { scene: SolvedScene; style: SceneStyle } | null = null;
  readonly canvas: HTMLCanvasElement;

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'view solid-view';
    container.append(this.canvas);
    // A lost context (GPU reset, too many contexts) comes back on its own if
    // the default is prevented; then the last picture is drawn again.
    this.canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());
    this.canvas.addEventListener('webglcontextrestored', () => this.draw());

    this.scene.add(new AmbientLight(0xffffff, 0.55));
    const sky = new HemisphereLight(0xfff4e6, 0x8a6a4a, 0.5);
    this.scene.add(sky);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0005;
    this.key.shadow.radius = 4;
    this.scene.add(this.key);
    this.scene.add(this.key.target);

    const material = new MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.92,
      metalness: 0,
    });
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);

    this.lines = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ color: 0x2a211a, transparent: true, opacity: 0.55 }),
    );
    this.scene.add(this.lines);

    this.ground = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity: 0.22 }));
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  }

  /** Match the canvas to its container's size. */
  resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    this.renderer.setSize(width, height, false);
    this.aspect = width / height;
    this.perspectiveCamera.aspect = this.aspect;
    this.perspectiveCamera.updateProjectionMatrix();
  }

  /** The camera the last style asked for. */
  private get camera(): PerspectiveCamera | OrthographicCamera {
    return this.last?.style.perspective === false
      ? this.orthographicCamera
      : this.perspectiveCamera;
  }

  /** Rebuild the sheet from a solved scene and draw it from the orbit. */
  update(
    solved: SolvedScene,
    style: SceneStyle,
    orbit: Orbit,
    frame: ViewFrame | undefined,
    highlighted: ReadonlySet<number>,
  ): void {
    this.last = { scene: solved, style };
    const built = buildMesh(solved, style, highlighted);
    this.triangleFacet = built.triangleFacet;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(built.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(built.normals, 3));
    geometry.setAttribute('color', new BufferAttribute(built.colours, 3));
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;

    const lineGeometry = new BufferGeometry();
    const linePositions = new Float32Array(solved.edges.length * 6);
    solved.edges.forEach((e, i) => {
      linePositions.set([e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z], i * 6);
    });
    lineGeometry.setAttribute('position', new BufferAttribute(linePositions, 3));
    this.lines.geometry.dispose();
    this.lines.geometry = lineGeometry;
    (this.lines.material as LineBasicMaterial).color = new Color(style.ink);

    this.placeCamera(solved, orbit);
    this.placeGround(solved, frame, orbit, style.shadow);
    this.draw();
  }

  /** Recolour the last sheet with a new set of highlighted facets. */
  highlight(highlighted: ReadonlySet<number>): void {
    if (!this.last) return;
    const built = buildMesh(this.last.scene, this.last.style, highlighted);
    const attribute = this.mesh.geometry.getAttribute('color');
    if (attribute instanceof BufferAttribute && attribute.count * 3 === built.colours.length) {
      attribute.set(built.colours);
      attribute.needsUpdate = true;
      this.draw();
    }
  }

  /** Redraw the last sheet from a new orbit (dragging, zooming, named views). */
  reorbit(orbit: Orbit, frame: ViewFrame | undefined): void {
    if (!this.last) return;
    this.placeCamera(this.last.scene, orbit);
    this.placeGround(this.last.scene, frame, orbit, this.last.style.shadow);
    this.draw();
  }

  private placeCamera(solved: SolvedScene, orbit: Orbit): void {
    const [right, up, toward] = viewRotation(orbit);
    const { distance, half } = cameraFrame(solved.reach, orbit.zoom);
    const c = solved.centre;
    const camera = this.camera;
    camera.position.set(
      c.x + toward.x * distance,
      c.y + toward.y * distance,
      c.z + toward.z * distance,
    );
    camera.up.set(up.x, up.y, up.z);
    camera.lookAt(c.x, c.y, c.z);
    camera.near = Math.max(0.001, distance - solved.reach * 2.5);
    camera.far = distance + solved.reach * 4;
    if (camera instanceof OrthographicCamera) {
      camera.left = -half * this.aspect;
      camera.right = half * this.aspect;
      camera.top = half;
      camera.bottom = -half;
    }
    camera.updateProjectionMatrix();
    // The key light sits up and to the viewer's left, slightly in front.
    const lightDir = unit(add(add(mul(toward, 0.8), mul(up, 1.0)), mul(right, -0.6)));
    const span = solved.reach * 3;
    this.key.position.set(
      c.x + lightDir.x * span,
      c.y + lightDir.y * span,
      c.z + lightDir.z * span,
    );
    this.key.target.position.set(c.x, c.y, c.z);
    const shadowCamera = this.key.shadow.camera;
    shadowCamera.left = -solved.reach * 1.6;
    shadowCamera.right = solved.reach * 1.6;
    shadowCamera.top = solved.reach * 1.6;
    shadowCamera.bottom = -solved.reach * 1.6;
    shadowCamera.near = span - solved.reach * 2;
    shadowCamera.far = span + solved.reach * 2;
    shadowCamera.updateProjectionMatrix();
  }

  /**
   * The ground lies under the model, perpendicular to the frame's `top`, just
   * below its lowest point. It is hidden when the view looks along `top`,
   * where the shadow would sit behind the model.
   */
  private placeGround(
    solved: SolvedScene,
    frame: ViewFrame | undefined,
    orbit: Orbit,
    shadow: boolean,
  ): void {
    const f = frame ?? DEFAULT_FRAME;
    const topDir = unit({ x: f.top.x, y: f.top.y, z: 0 });
    let lowest = Infinity;
    for (const panel of solved.panels) {
      for (const p of panel.points) {
        lowest = Math.min(lowest, p.x * topDir.x + p.y * topDir.y + p.z * topDir.z);
      }
    }
    if (!Number.isFinite(lowest)) lowest = 0;
    const c = solved.centre;
    const along = c.x * topDir.x + c.y * topDir.y + c.z * topDir.z;
    const drop = along - lowest + solved.reach * 0.02;
    this.ground.position.set(c.x - topDir.x * drop, c.y - topDir.y * drop, c.z - topDir.z * drop);
    this.ground.lookAt(
      this.ground.position.x + topDir.x,
      this.ground.position.y + topDir.y,
      this.ground.position.z + topDir.z,
    );
    this.ground.scale.set(solved.reach * 6, solved.reach * 6, 1);
    const [, , toward] = viewRotation(orbit);
    const alongTop = Math.abs(toward.x * topDir.x + toward.y * topDir.y + toward.z * topDir.z);
    this.ground.visible = shadow && alongTop < 0.85;
  }

  private draw(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** The facet under a client-space point, or null. */
  pick(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const pointer = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.mesh, false);
    const first = hits[0];
    const face = first?.faceIndex;
    if (face === undefined || face === null) return null;
    return this.triangleFacet[face] ?? null;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.lines.geometry.dispose();
    this.renderer.dispose();
  }
}

/** Keeps TypeScript aware of the vector type for consumers. */
export type { Vector3 };
