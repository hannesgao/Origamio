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
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

import { isFlipped } from './paper';
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
/** Width of crease and edge lines on screen. */
const LINE_WIDTH_PX = 1.4;
/** How much darker a corner buried in the stack is drawn than one in the open. */
const BURIED_DARKENING = 0.38;
/**
 * Depth pushed per layer of rank, in clip space, so that layers the solver
 * leaves almost coincident are drawn in the order of the flat model instead
 * of fighting for the same depth: the layer nearer the viewer wins.
 */
const RANK_BIAS = 1.5e-4;
/** How far the camera moves towards its target framing on each update (1 is at once). */
const CAMERA_EASE = 0.3;

/**
 * Where the camera stands and what it frames, for a model of the given reach
 * at the given zoom: the distance from the centre along the line of sight,
 * and the half-height of the picture at the centre. Both cameras use the
 * same values, so switching projection keeps the model the same size.
 */
export function cameraFrame(
  reach: number,
  zoom: number,
  aspect = 1,
): { distance: number; half: number } {
  const z = Math.max(MIN_ORBIT_ZOOM, Math.min(MAX_ORBIT_ZOOM, zoom));
  // On a canvas taller than wide, the width is what has to hold the model.
  const half = (reach * 1.15) / z / Math.min(1, aspect);
  return { distance: half / Math.tan((FOV * Math.PI) / 360), half };
}

/** Per-face colour and a flat normal for every triangle; no index buffer. */
export interface Built {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colours: Float32Array;
  /** Per vertex: the facet's rank in its stack, and the stack's up direction. */
  readonly ranks: Float32Array;
  readonly ups: Float32Array;
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
  const ranks: number[] = [];
  const ups: number[] = [];
  const triangleFacet: number[] = [];
  let rank = 0;
  let stackUpDir: Vec3 = { x: 0, y: 0, z: 1 };
  const t = style.thickness / 2;
  // Each corner carries its own colour: the base darkened by how buried it is.
  const shaded = (colour: Color, shade: number): Color =>
    colour.clone().multiplyScalar(1 - BURIED_DARKENING * shade);
  const push = (
    a: Vec3,
    b: Vec3,
    c: Vec3,
    [na, nb, nc]: readonly [Vec3, Vec3, Vec3],
    ca: Color,
    cb: Color,
    cc: Color,
    facet: number,
  ): void => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    normals.push(na.x, na.y, na.z, nb.x, nb.y, nb.z, nc.x, nc.y, nc.z);
    colours.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
    ranks.push(rank, rank, rank);
    const u = stackUpDir;
    ups.push(u.x, u.y, u.z, u.x, u.y, u.z, u.x, u.y, u.z);
    triangleFacet.push(facet);
  };
  for (const panel of scene.panels) {
    const id = panel.facet.id;
    const n = unit(panel.normal);
    rank = scene.rank[id] ?? 0;
    // The stack grows along the sheet's front normal, or against it for a flipped facet.
    stackUpDir = isFlipped(panel.facet) ? mul(n, -1) : n;
    // A facet may bend a little: each corner takes the normal of its own
    // corner triangle, and the ring blends towards the facet's mean.
    const count0 = panel.points.length;
    const cornerNormal = panel.points.map((p, i) => {
      const prev = panel.points[(i + count0 - 1) % count0] as Vec3;
      const next = panel.points[(i + 1) % count0] as Vec3;
      const local = cross(sub(next, p), sub(prev, p));
      const l = Math.hypot(local.x, local.y, local.z);
      return l < 1e-12 ? n : unit(local);
    });
    const hit = highlighted.has(id);
    const top = hit ? lift(front) : front;
    const bottom = hit ? lift(back) : back;
    const rim = hit ? lift(side) : side;
    const shade = scene.shade[id];
    const topAt = (i: number): Color => shaded(top, shade?.top[i] ?? 0);
    const bottomAt = (i: number): Color => shaded(bottom, shade?.bottom[i] ?? 0);
    const innerTopAt = (i: number): Color => shaded(top, shade?.innerTop[i] ?? 0);
    const innerBottomAt = (i: number): Color => shaded(bottom, shade?.innerBottom[i] ?? 0);
    const rimAt = (i: number): Color =>
      shaded(rim, ((shade?.top[i] ?? 0) + (shade?.bottom[i] ?? 0)) / 2);
    const up = panel.points.map((p, i) => add(p, mul(cornerNormal[i] as Vec3, t)));
    const down = panel.points.map((p, i) => sub(p, mul(cornerNormal[i] as Vec3, t)));
    const count = panel.points.length;
    // The inner ring sits where the shade says, between each corner and the centre.
    const centre = mul(
      panel.points.reduce((s, p) => add(s, p), { x: 0, y: 0, z: 0 }),
      1 / count,
    );
    const ring = panel.points.map((p, i) => add(p, mul(sub(centre, p), shade?.inner[i] ?? 0)));
    const ringNormal = ring.map((_, i) => {
      const k = shade?.inner[i] ?? 0;
      return unit(add(mul(cornerNormal[i] as Vec3, 1 - k), mul(n, k)));
    });
    const ringUp = ring.map((p, i) => add(p, mul(ringNormal[i] as Vec3, t)));
    const ringDown = ring.map((p, i) => sub(p, mul(ringNormal[i] as Vec3, t)));
    const flip = (v: Vec3): Vec3 => mul(v, -1);
    // A band of quads from the corners to the ring, then a fan over the ring:
    // front face up, back face down.
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const [a, b, c, e] = [up[i] as Vec3, up[j] as Vec3, ringUp[j] as Vec3, ringUp[i] as Vec3];
      const [na, nb, nc] = [
        cornerNormal[i] as Vec3,
        cornerNormal[j] as Vec3,
        ringNormal[j] as Vec3,
      ];
      const ne = ringNormal[i] as Vec3;
      push(a, b, c, [na, nb, nc], topAt(i), topAt(j), innerTopAt(j), id);
      push(a, c, e, [na, nc, ne], topAt(i), innerTopAt(j), innerTopAt(i), id);
      const [f, g, h, k] = [
        down[i] as Vec3,
        down[j] as Vec3,
        ringDown[j] as Vec3,
        ringDown[i] as Vec3,
      ];
      push(f, h, g, [flip(na), flip(nc), flip(nb)], bottomAt(i), innerBottomAt(j), bottomAt(j), id);
      push(
        f,
        k,
        h,
        [flip(na), flip(ne), flip(nc)],
        bottomAt(i),
        innerBottomAt(i),
        innerBottomAt(j),
        id,
      );
    }
    for (let i = 1; i + 1 < count; i++) {
      const [a, b, c] = [ringUp[0] as Vec3, ringUp[i] as Vec3, ringUp[i + 1] as Vec3];
      const [n0, ni, nj] = [
        ringNormal[0] as Vec3,
        ringNormal[i] as Vec3,
        ringNormal[i + 1] as Vec3,
      ];
      push(a, b, c, [n0, ni, nj], innerTopAt(0), innerTopAt(i), innerTopAt(i + 1), id);
      const [f, g, h] = [ringDown[0] as Vec3, ringDown[i + 1] as Vec3, ringDown[i] as Vec3];
      push(
        f,
        g,
        h,
        [flip(n0), flip(nj), flip(ni)],
        innerBottomAt(0),
        innerBottomAt(i + 1),
        innerBottomAt(i),
        id,
      );
    }
    if (t > 0) {
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        const a = up[i] as Vec3;
        const b = up[j] as Vec3;
        const c = down[j] as Vec3;
        const d = down[i] as Vec3;
        const sn = unit(cross(sub(b, a), sub(d, a)));
        push(a, b, c, [sn, sn, sn], rimAt(i), rimAt(j), rimAt(j), id);
        push(a, c, d, [sn, sn, sn], rimAt(i), rimAt(j), rimAt(i), id);
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colours: new Float32Array(colours),
    ranks: new Float32Array(ranks),
    ups: new Float32Array(ups),
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
  /** Redraw the last sheet with new colours, thickness or projection; nothing is solved again. */
  restyle(style: SceneStyle, highlighted: ReadonlySet<number>): void;
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
  restyle(): void {
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
  private readonly lines: LineSegments2;
  private readonly lineMaterial: LineMaterial;
  private readonly ground: Mesh;
  private pixelRatio = 1;
  private readonly raycaster = new Raycaster();
  private triangleFacet: number[] = [];
  private last: {
    scene: SolvedScene;
    style: SceneStyle;
    orbit: Orbit;
    frame: ViewFrame | undefined;
  } | null = null;
  /** What the camera frames: the last settled pose, held still while a step plays. */
  private steady: { centre: Vec3; reach: number } | null = null;
  private easing = 0;
  private groundPlaced = false;
  readonly canvas: HTMLCanvasElement;

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(this.pixelRatio);
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
      flatShading: false,
      roughness: 0.92,
      metalness: 0,
      // Faces sit a touch behind the lines drawn on them, so the two never flicker.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    // Layers nearly coincident are ordered by their rank in the stack: the
    // vertex shader pushes each vertex away from the viewer by its rank when
    // the stack's top faces away, and towards the viewer when it faces them.
    material.onBeforeCompile = (shader) => {
      shader.uniforms['rankBias'] = { value: RANK_BIAS };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float stackRank;\nattribute vec3 stackUp;\nuniform float rankBias;',
        )
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\n' +
            'vec3 upView = normalize(normalMatrix * stackUp);\n' +
            'float facing = dot(upView, normalize(-mvPosition.xyz));\n' +
            'gl_Position.z += (facing > 0.0 ? -1.0 : 1.0) * stackRank * rankBias * gl_Position.w;',
        );
    };
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);

    // Lines with a width in pixels, the same on any screen.
    this.lineMaterial = new LineMaterial({
      color: 0x2a211a,
      linewidth: LINE_WIDTH_PX,
      transparent: true,
      opacity: 0.6,
      worldUnits: false,
    });
    this.lines = new LineSegments2(new LineSegmentsGeometry(), this.lineMaterial);
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
    this.lineMaterial.resolution.set(width * this.pixelRatio, height * this.pixelRatio);
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
    this.last = { scene: solved, style, orbit, frame };
    const built = buildMesh(solved, style, highlighted);
    this.triangleFacet = built.triangleFacet;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(built.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(built.normals, 3));
    geometry.setAttribute('color', new BufferAttribute(built.colours, 3));
    geometry.setAttribute('stackRank', new BufferAttribute(built.ranks, 1));
    geometry.setAttribute('stackUp', new BufferAttribute(built.ups, 3));
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;

    const linePositions = new Float32Array(solved.edges.length * 6);
    solved.edges.forEach((e, i) => {
      linePositions.set([e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z], i * 6);
    });
    const lineGeometry = new LineSegmentsGeometry();
    if (solved.edges.length > 0) lineGeometry.setPositions(linePositions);
    this.lines.geometry.dispose();
    this.lines.geometry = lineGeometry;
    this.lines.visible = solved.edges.length > 0;
    this.lineMaterial.color = new Color(style.ink);

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

  restyle(style: SceneStyle, highlighted: ReadonlySet<number>): void {
    if (!this.last) return;
    this.update(this.last.scene, style, this.last.orbit, this.last.frame, highlighted);
  }

  /** Redraw the last sheet from a new orbit (dragging, zooming, named views). */
  reorbit(orbit: Orbit, frame: ViewFrame | undefined): void {
    if (!this.last) return;
    // Remembered, so that a later restyle keeps the view the user turned to.
    this.last = { ...this.last, orbit, frame };
    this.placeCamera(this.last.scene, orbit);
    this.placeGround(this.last.scene, frame, orbit, this.last.style.shadow);
    this.draw();
  }

  private placeCamera(solved: SolvedScene, orbit: Orbit): void {
    const [right, up, toward] = viewRotation(orbit);
    // The camera frames the settled pose and eases towards it; while a step
    // plays it keeps the centre and backs off only as far as the swinging
    // paper needs, so the picture never jumps.
    const target = solved.settled
      ? { centre: solved.centre, reach: solved.reach }
      : {
          centre: this.steady?.centre ?? solved.centre,
          reach: Math.max(this.steady?.reach ?? 0, solved.reach),
        };
    if (!this.steady) {
      this.steady = target;
    } else {
      const k = CAMERA_EASE;
      const gap = Math.hypot(
        target.centre.x - this.steady.centre.x,
        target.centre.y - this.steady.centre.y,
        target.centre.z - this.steady.centre.z,
        target.reach - this.steady.reach,
      );
      if (gap < 1e-3 * target.reach) {
        this.steady = target;
      } else {
        this.steady = {
          centre: {
            x: this.steady.centre.x + (target.centre.x - this.steady.centre.x) * k,
            y: this.steady.centre.y + (target.centre.y - this.steady.centre.y) * k,
            z: this.steady.centre.z + (target.centre.z - this.steady.centre.z) * k,
          },
          reach: this.steady.reach + (target.reach - this.steady.reach) * k,
        };
        // Keep easing on the next frame, until the camera has arrived.
        this.easeOn();
      }
    }
    const { distance, half } = cameraFrame(this.steady.reach, orbit.zoom, this.aspect);
    const c = this.steady.centre;
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
    const reach = this.steady.reach;
    const span = reach * 3;
    this.key.position.set(
      c.x + lightDir.x * span,
      c.y + lightDir.y * span,
      c.z + lightDir.z * span,
    );
    this.key.target.position.set(c.x, c.y, c.z);
    const shadowCamera = this.key.shadow.camera;
    shadowCamera.left = -reach * 1.6;
    shadowCamera.right = reach * 1.6;
    shadowCamera.top = reach * 1.6;
    shadowCamera.bottom = -reach * 1.6;
    shadowCamera.near = span - reach * 2;
    shadowCamera.far = span + reach * 2;
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
    // The ground stays where the settled pose put it while a step plays.
    if (!solved.settled && this.groundPlaced) return;
    this.groundPlaced = true;
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

  /** Another frame of camera easing, unless one is already due. */
  private easeOn(): void {
    if (this.easing) return;
    this.easing = requestAnimationFrame(() => {
      this.easing = 0;
      if (this.last) this.reorbit(this.last.orbit, this.last.frame);
    });
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
    cancelAnimationFrame(this.easing);
    this.mesh.geometry.dispose();
    this.lines.geometry.dispose();
    this.renderer.dispose();
  }
}

/** Keeps TypeScript aware of the vector type for consumers. */
export type { Vector3 };
