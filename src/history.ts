/** Linear undo/redo of whole-document snapshots. */
export class History<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];

  constructor(private readonly limit = 200) {}

  /** Record the state a change is about to replace. */
  push(state: T): void {
    this.undoStack.push(state);
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo(current: T): T | null {
    const prev = this.undoStack.pop();

    if (prev === undefined) {
      return null;
    }
    this.redoStack.push(current);

    return prev;
  }

  redo(current: T): T | null {
    const next = this.redoStack.pop();

    if (next === undefined) {
      return null;
    }
    this.undoStack.push(current);

    return next;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
