/**
 * The 3D view's solver as a service: the same solve as `solvedScene`, run in
 * a Web Worker when the browser has one so that the interface stays
 * responsive while a sheet settles, and inline otherwise (tests, old
 * browsers). Requests carry the sheet itself; derived data (hinges, the
 * constraint mesh) is cached by the sheet's id, and the contact memory of
 * a step animation lives for that animation.
 */
import { type PaperState } from './paper';
import { type ContactMemory } from './rigid';
import { type SolvedScene, solvedScene } from './view3d';

export interface SolveRequest {
  /** Identifies the sheet across requests, so what was derived from it can be reused. */
  readonly stateId: string;
  readonly state: PaperState;
  /** Opening of flat creases, in radians. */
  readonly opening: number;
  /** Paper thickness, in sheet units. */
  readonly thickness: number;
  readonly animation?: {
    /** One id per step animation; its contact memory lives as long as it does. */
    readonly id: number;
    readonly previousId: string;
    readonly previous: PaperState;
    readonly movedIds: readonly number[];
    readonly progress: number;
  };
}

export interface SheetSolver {
  solve(request: SolveRequest): Promise<SolvedScene>;
  dispose(): void;
}

/** How many sheets the core keeps derived data for. */
const KEPT_STATES = 12;

/**
 * The solve itself, with the caches. Both the worker and the inline solver
 * are this; the worker just answers messages with it.
 */
export class SolveCore {
  /** The first copy of each sheet seen, by id: the caches key on the object. */
  private readonly states = new Map<string, PaperState>();
  private animation: { id: number; contact: ContactMemory } | null = null;

  solve(request: SolveRequest): SolvedScene {
    const state = this.remember(request.stateId, request.state);
    const animation = request.animation;
    if (!animation)
      return solvedScene(state, { opening: request.opening, thickness: request.thickness });
    const previous = this.remember(animation.previousId, animation.previous);
    if (this.animation?.id !== animation.id) {
      this.animation = {
        id: animation.id,
        contact: { before: previous, sides: new Map(), seeded: false },
      };
    }
    return solvedScene(state, {
      opening: request.opening,
      thickness: request.thickness,
      animation: {
        previous,
        movedIds: new Set(animation.movedIds),
        progress: animation.progress,
        contact: this.animation.contact,
      },
    });
  }

  private remember(id: string, state: PaperState): PaperState {
    const known = this.states.get(id);
    if (known) {
      // Most recently used last.
      this.states.delete(id);
      this.states.set(id, known);
      return known;
    }
    this.states.set(id, state);
    if (this.states.size > KEPT_STATES) {
      const oldest = this.states.keys().next().value;
      if (oldest !== undefined) this.states.delete(oldest);
    }
    return state;
  }
}

export interface WorkerReply {
  readonly seq: number;
  readonly scene?: SolvedScene;
  readonly error?: string;
}

/** The solver on this thread. */
export class InlineSolver implements SheetSolver {
  private readonly core = new SolveCore();

  solve(request: SolveRequest): Promise<SolvedScene> {
    return Promise.resolve(this.core.solve(request));
  }

  dispose(): void {
    return;
  }
}

/** The solver in a Web Worker; falls back to the thread if the worker fails. */
export class WorkerSolver implements SheetSolver {
  private readonly worker: Worker;
  private readonly waiting = new Map<
    number,
    { resolve: (scene: SolvedScene) => void; reject: (error: Error) => void }
  >();
  private seq = 0;

  constructor(worker: Worker) {
    this.worker = worker;
    worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      const pending = this.waiting.get(reply.seq);
      if (!pending) return;
      this.waiting.delete(reply.seq);
      if (reply.scene) pending.resolve(reply.scene);
      else pending.reject(new Error(reply.error ?? 'solve failed'));
    });
    worker.addEventListener('error', (event) => {
      const error = new Error(event.message || 'solver worker failed');
      for (const pending of this.waiting.values()) pending.reject(error);
      this.waiting.clear();
    });
  }

  solve(request: SolveRequest): Promise<SolvedScene> {
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(seq, { resolve, reject });
      this.worker.postMessage({ seq, request });
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.waiting.clear();
  }
}

/** The solver that works here: a worker when the browser offers one, else inline. */
export function createSheetSolver(): SheetSolver {
  if (typeof Worker === 'undefined') return new InlineSolver();
  try {
    const worker = new Worker(new URL('./solve.worker.ts', import.meta.url), { type: 'module' });
    return new WorkerSolver(worker);
  } catch {
    return new InlineSolver();
  }
}
