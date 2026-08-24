export interface ActiveRunHandle {
  runId: string;
  threadId: string;
  turnId: string;
  interrupt(): Promise<void> | void;
  resolveDecision?(response: { requestId: string; action: 'way_one' | 'way_two' | 'custom_input' | 'cancel' | 'confirm'; optionId?: string; customInput?: string }): Promise<{ accepted: boolean; resumed: boolean }>;
}

export class ActiveRunRegistry {
  private handles = new Map<string, ActiveRunHandle>();
  private topLevelReservations = new Set<string>();

  /** Reserve a top-level task slot before constructing/running an AgentLoop. */
  tryReserveTopLevel(reservationId: string, maxActiveTasks: number): boolean {
    if (this.topLevelReservations.has(reservationId)) return true;
    const limit = Number.isFinite(maxActiveTasks) ? Math.max(1, Math.floor(maxActiveTasks)) : 4;
    if (this.topLevelReservations.size >= limit) return false;
    this.topLevelReservations.add(reservationId);
    return true;
  }

  releaseTopLevel(reservationId: string): void {
    this.topLevelReservations.delete(reservationId);
  }

  activeTopLevelCount(): number {
    return this.topLevelReservations.size;
  }

  register(handle: ActiveRunHandle): () => void {
    this.handles.set(handle.runId, handle);
    return () => this.handles.delete(handle.runId);
  }

  get(runId: string): ActiveRunHandle | null {
    return this.handles.get(runId) ?? null;
  }

  getByThreadId(threadId: string): ActiveRunHandle | null {
    for (const handle of this.handles.values()) {
      if (handle.threadId === threadId) return handle;
    }
    return null;
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
    this.topLevelReservations.clear();
  }
}
