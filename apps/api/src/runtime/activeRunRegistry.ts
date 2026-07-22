export interface ActiveRunHandle {
  runId: string;
  threadId: string;
  turnId: string;
  interrupt(): Promise<void> | void;
}

export class ActiveRunRegistry {
  private handles = new Map<string, ActiveRunHandle>();

  register(handle: ActiveRunHandle): () => void {
    this.handles.set(handle.runId, handle);
    return () => this.handles.delete(handle.runId);
  }

  get(runId: string): ActiveRunHandle | null {
    return this.handles.get(runId) ?? null;
  }

  finish(runId: string): void {
    this.handles.delete(runId);
  }

  has(runId: string): boolean {
    return this.handles.has(runId);
  }

  listActiveRunIds(): string[] {
    return Array.from(this.handles.keys());
  }

  clear(): void {
    this.handles.clear();
  }
}
