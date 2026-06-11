import type { ThreadId, TurnId, ItemId, Checkpoint } from '@nexus/protocol';

// Re-export for convenience
export type { Checkpoint };
export type { CheckpointLine } from '@nexus/protocol';

// ─── TurnSummary ────────────────────────────────────────────────────────────
/**
 * Per-turn runtime accumulation.
 * Tracks what happened during the current (or most recent) turn
 * without requiring a full item replay.
 */
export interface TurnSummary {
  /** ISO-8601 when the turn started. */
  startedAt: string | null;
  /** Set of command ids that have started execution. */
  commandExecutionsStarted: Set<string>;
  /** Last error encountered during this turn, if any. */
  lastError: TurnError | null;
}

export interface TurnError {
  message: string;
  /** Item that caused the error, if applicable. */
  itemId?: ItemId;
  /** ISO-8601 timestamp. */
  timestamp: string;
}

// ─── ThreadState ────────────────────────────────────────────────────────────
/**
 * Per-thread runtime state.
 *
 * Lives in memory (not persisted). On resume, rebuilt from storage.
 * The `status` field is the authoritative state for the thread's execution.
 */
export type ThreadStatus = 'idle' | 'running' | 'interrupted' | 'completed' | 'failed';

export interface ThreadState {
  /** Current execution status. */
  status: ThreadStatus;
  /** The turn currently executing, if any. */
  activeTurnId: TurnId | null;
  /** AbortController for the active turn — set to cancel. */
  cancelController: AbortController | null;
  /**
   * Monotonic generation counter — increments each time a new turn starts.
   * Listener generation marker for checkpoint freshness.
   */
  generation: number;
  /** Queue of pending interrupt request IDs. */
  pendingInterrupts: string[];
  /** Pending rollback request, if any. */
  pendingRollback: TurnId | null;
  /** Accumulated summary of the current/last turn. */
  turnSummary: TurnSummary;
  /** Last checkpoint written to JSONL. */
  lastCheckpoint: Checkpoint | null;
  /** Last terminal turn ID (completed or failed). */
  lastTerminalTurnId: TurnId | null;
}

/** Create a fresh ThreadState. */
export function createThreadState(): ThreadState {
  return {
    status: 'idle',
    activeTurnId: null,
    cancelController: null,
    generation: 0,
    pendingInterrupts: [],
    pendingRollback: null,
    turnSummary: createTurnSummary(),
    lastCheckpoint: null,
    lastTerminalTurnId: null,
  };
}

export function createTurnSummary(): TurnSummary {
  return {
    startedAt: null,
    commandExecutionsStarted: new Set(),
    lastError: null,
  };
}

// ─── ThreadStateManager ─────────────────────────────────────────────────────
/**
 * Manages per-thread runtime state. Single source of truth for thread
 * execution status, active turns, and checkpoint tracking.
 *
 * Process-local thread state manager.
 */
export class ThreadStateManager {
  private states: Map<ThreadId, ThreadState> = new Map();

  /** Get or create state for a thread. */
  get(threadId: ThreadId): ThreadState {
    let state = this.states.get(threadId);
    if (!state) {
      state = createThreadState();
      this.states.set(threadId, state);
    }
    return state;
  }

  /** Replace state entirely (e.g. on resume from storage). */
  set(threadId: ThreadId, state: ThreadState): void {
    this.states.set(threadId, state);
  }

  /** Remove state (thread archived / evicted). */
  remove(threadId: ThreadId): void {
    this.states.delete(threadId);
  }

  /** Check if a thread has an active running turn. */
  isRunning(threadId: ThreadId): boolean {
    return this.get(threadId).status === 'running';
  }

  /** Transition to running and set up cancel controller. */
  startTurn(threadId: ThreadId, turnId: TurnId): AbortController {
    const state = this.get(threadId);
    // Cancel any previous controller
    if (state.cancelController) {
      state.cancelController.abort();
    }
    state.status = 'running';
    state.activeTurnId = turnId;
    state.generation += 1;
    state.cancelController = new AbortController();
    state.turnSummary = createTurnSummary();
    state.turnSummary.startedAt = new Date().toISOString();
    return state.cancelController;
  }

  /** Transition to completed. */
  completeTurn(threadId: ThreadId, turnId: TurnId): void {
    const state = this.get(threadId);
    if (state.activeTurnId === turnId) {
      state.status = 'completed';
      state.activeTurnId = null;
      state.lastTerminalTurnId = turnId;
      state.cancelController = null;
    }
  }

  /** Transition to interrupted after the running task has observed cancellation. */
  completeInterruptedTurn(threadId: ThreadId, turnId: TurnId): void {
    const state = this.get(threadId);
    if (state.activeTurnId === turnId) {
      state.status = 'interrupted';
      state.activeTurnId = null;
      state.lastTerminalTurnId = turnId;
      state.cancelController = null;
    }
  }

  /** Transition to failed. */
  failTurn(threadId: ThreadId, turnId: TurnId, error: TurnError): void {
    const state = this.get(threadId);
    if (state.activeTurnId === turnId) {
      state.status = 'failed';
      state.activeTurnId = null;
      state.lastTerminalTurnId = turnId;
      state.turnSummary.lastError = error;
      state.cancelController = null;
    }
  }

  /** Transition to interrupted (turn was cancelled mid-flight). */
  interruptTurn(threadId: ThreadId, turnId: TurnId, requestId: string): void {
    const state = this.get(threadId);
    if (state.activeTurnId === turnId) {
      state.status = 'interrupted';
      state.pendingInterrupts.push(requestId);
      if (state.cancelController) {
        state.cancelController.abort();
      }
    }
  }

  /** Clear pending interrupts after they've been handled. */
  clearPendingInterrupts(threadId: ThreadId): void {
    this.get(threadId).pendingInterrupts = [];
  }

  /** Record a command execution start in the turn summary. */
  noteCommandStarted(threadId: ThreadId, commandId: string): void {
    this.get(threadId).turnSummary.commandExecutionsStarted.add(commandId);
  }

  /** Write a checkpoint for the current turn. */
  setCheckpoint(threadId: ThreadId, checkpoint: Checkpoint): void {
    this.get(threadId).lastCheckpoint = checkpoint;
  }

  /** Delete the state for a thread. */
  delete(threadId: ThreadId): void {
    const state = this.states.get(threadId);
    if (state?.cancelController) {
      state.cancelController.abort();
    }
    this.states.delete(threadId);
  }

  /** Delete all states (shutdown). */
  deleteAll(): void {
    for (const [, state] of this.states) {
      if (state.cancelController) {
        state.cancelController.abort();
      }
    }
    this.states.clear();
  }

  // ─── Singleton ──────────────────────────────────────────────────────────
  private static _instance: ThreadStateManager | null = null;

  /** Get or create the process-level singleton. */
  static instance(): ThreadStateManager {
    if (!ThreadStateManager._instance) {
      ThreadStateManager._instance = new ThreadStateManager();
    }
    return ThreadStateManager._instance;
  }

  /** Reset the singleton (for tests). */
  static resetInstance(): void {
    if (ThreadStateManager._instance) {
      ThreadStateManager._instance.deleteAll();
      ThreadStateManager._instance = null;
    }
  }
}
