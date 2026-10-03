/**
 * The editable timeline: every step of a sequence, a playhead, and the folded
 * state after each step. States are derived by replaying the steps from the
 * flat sheet and cached, so seeking is instant and every edit (insert, remove,
 * move, rename) simply invalidates the cache from the edited index on.
 * Edits are undoable independently of the playhead.
 */
import { type FoldResult, type PaperState, fold } from './paper';
import { type FoldStep } from './sequence';

interface Snapshot {
  readonly steps: readonly FoldStep[];
  readonly position: number;
}

const MAX_EDIT_HISTORY = 100;

export class Timeline {
  private list: FoldStep[] = [];
  private pos = 0;
  private states: PaperState[];
  /** Whether replaying step i moved anything; unknown until replayed. */
  private moved: (boolean | undefined)[] = [];
  private readonly undoStack: Snapshot[] = [];
  private readonly redoStack: Snapshot[] = [];

  constructor(sheet: PaperState) {
    this.states = [sheet];
  }

  // --- Reading ---------------------------------------------------------------

  get steps(): readonly FoldStep[] {
    return this.list;
  }

  get length(): number {
    return this.list.length;
  }

  /** Number of applied steps: the playhead sits after step `position`. */
  get position(): number {
    return this.pos;
  }

  get applied(): readonly FoldStep[] {
    return this.list.slice(0, this.pos);
  }

  get pending(): readonly FoldStep[] {
    return this.list.slice(this.pos);
  }

  /** The next step to apply, if any. */
  get next(): FoldStep | undefined {
    return this.list[this.pos];
  }

  /** The folded sheet at the playhead. */
  get state(): PaperState {
    return this.states[this.pos] as PaperState;
  }

  /** The flat sheet every replay starts from. */
  get sheet(): PaperState {
    return this.states[0] as PaperState;
  }

  /** Did step `index` move any paper when it was replayed? Unknown before replay. */
  effect(index: number): boolean | undefined {
    return this.moved[index];
  }

  get canUndoEdit(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedoEdit(): boolean {
    return this.redoStack.length > 0;
  }

  // --- Playback --------------------------------------------------------------

  /** Compute and cache the states up to `index` (clamped to the length). */
  ensure(index: number): void {
    const upTo = Math.min(index, this.list.length);
    for (let k = this.states.length; k <= upTo; k++) {
      const step = this.list[k - 1] as FoldStep;
      const result = fold(this.states[k - 1] as PaperState, step.line, step.side, step.options);
      this.moved[k - 1] = result.movedIds.length > 0;
      this.states[k] = result.state;
    }
  }

  /** Move the playhead without animation. */
  seek(index: number): void {
    const target = Math.max(0, Math.min(this.list.length, index));
    this.ensure(target);
    this.pos = target;
  }

  /** Apply the next step and return its result, or null at the end. */
  forward(): FoldResult | null {
    const step = this.list[this.pos];
    if (!step) return null;
    const result = fold(this.state, step.line, step.side, step.options);
    this.moved[this.pos] = result.movedIds.length > 0;
    this.states[this.pos + 1] = result.state;
    this.pos++;
    return result;
  }

  back(): boolean {
    if (this.pos === 0) return false;
    this.pos--;
    return true;
  }

  /** Replace every step (a loaded sequence); edits before this are forgotten. */
  load(steps: readonly FoldStep[]): void {
    this.list = [...steps];
    this.pos = 0;
    this.invalidate(0);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.ensure(this.list.length);
  }

  /** Start from another flat sheet, keeping the steps; the playhead rewinds. */
  resetSheet(sheet: PaperState): void {
    this.states = [sheet];
    this.moved = [];
    this.pos = 0;
    this.ensure(this.list.length);
  }

  // --- Editing ---------------------------------------------------------------

  private invalidate(from: number): void {
    this.states.length = Math.min(this.states.length, from + 1);
    this.moved.length = Math.min(this.moved.length, from);
  }

  private edit(from: number, mutate: () => void): void {
    this.undoStack.push({ steps: this.list.slice(), position: this.pos });
    if (this.undoStack.length > MAX_EDIT_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
    mutate();
    this.invalidate(from);
    this.pos = Math.min(this.pos, this.list.length);
    this.ensure(this.list.length);
  }

  /** Insert a step before index `index` (so `insert(position, step)` inserts at the playhead). */
  insert(index: number, step: FoldStep): void {
    const at = Math.max(0, Math.min(this.list.length, index));
    this.edit(at, () => this.list.splice(at, 0, step));
  }

  remove(index: number): void {
    if (index < 0 || index >= this.list.length) return;
    this.edit(index, () => this.list.splice(index, 1));
  }

  duplicate(index: number): void {
    const step = this.list[index];
    if (!step) return;
    this.edit(index + 1, () => this.list.splice(index + 1, 0, { ...step }));
  }

  /** Move step `from` so that it becomes step `to`. */
  move(from: number, to: number): void {
    const target = Math.max(0, Math.min(this.list.length - 1, to));
    if (from < 0 || from >= this.list.length || from === target) return;
    this.edit(Math.min(from, target), () => {
      const [step] = this.list.splice(from, 1);
      this.list.splice(target, 0, step as FoldStep);
    });
  }

  rename(index: number, label: string): void {
    const step = this.list[index];
    if (!step) return;
    const trimmed = label.trim();
    const renamed: FoldStep = {
      line: step.line,
      side: step.side,
      options: step.options,
      ...(trimmed ? { label: trimmed } : {}),
    };
    // A label never changes the geometry, so the cache survives.
    this.undoStack.push({ steps: this.list.slice(), position: this.pos });
    this.redoStack.length = 0;
    this.list[index] = renamed;
  }

  /** Remove step `index` and everything after it. */
  truncate(index: number): void {
    if (index < 0 || index >= this.list.length) return;
    this.edit(index, () => this.list.splice(index));
  }

  clear(): void {
    this.edit(0, () => this.list.splice(0));
  }

  undoEdit(): boolean {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return false;
    this.redoStack.push({ steps: this.list.slice(), position: this.pos });
    this.restore(snapshot);
    return true;
  }

  redoEdit(): boolean {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return false;
    this.undoStack.push({ steps: this.list.slice(), position: this.pos });
    this.restore(snapshot);
    return true;
  }

  private restore(snapshot: Snapshot): void {
    const from = this.list.findIndex((s, i) => s !== snapshot.steps[i]);
    this.list = [...snapshot.steps];
    this.invalidate(from < 0 ? Math.min(this.list.length, this.states.length - 1) : from);
    this.pos = Math.min(snapshot.position, this.list.length);
    this.ensure(this.list.length);
  }
}
