import type { Server } from 'node:http';
import type { ThreadStore } from '@nexus/storage';
import { shutdownAllDingtalkClients } from '../routes/botRoute.js';

export async function markRunningTurnsInterrupted(store: ThreadStore, now = new Date().toISOString()): Promise<number> {
  const threads = await store.listThreads();
  let changed = 0;
  for (const thread of threads) {
    const turns = await store.getTurns(thread.threadId);
    for (const turn of turns) {
      if (turn.status !== 'running') continue;
      await store.saveTurn({
        ...turn,
        status: 'interrupted',
        completedAt: now,
      });
      changed += 1;
    }
  }
  return changed;
}

export function installGracefulShutdown(options: {
  server: Server;
  store: ThreadStore;
  timeoutMs?: number;
  signals?: NodeJS.Signals[];
  onExit?: (code: number) => void;
  log?: (message: string) => void;
}): void {
  const signals = options.signals ?? ['SIGINT', 'SIGTERM'];
  let shuttingDown = false;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const onExit = options.onExit ?? ((code) => process.exit(code));
  const log = options.log ?? ((message) => console.log(message));

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[shutdown] ${signal} received, closing Nexus API`);
    const timer = setTimeout(() => onExit(1), timeoutMs);
    try {
      const interrupted = await markRunningTurnsInterrupted(options.store);
      if (interrupted > 0) {
        log(`[shutdown] Marked ${interrupted} running turn(s) as interrupted`);
      }
      shutdownAllDingtalkClients();
      await new Promise<void>((resolve) => {
        options.server.close(() => resolve());
      });
      clearTimeout(timer);
      onExit(0);
    } catch (error) {
      clearTimeout(timer);
      log(`[shutdown] ${error instanceof Error ? error.message : String(error)}`);
      onExit(1);
    }
  };

  for (const signal of signals) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }
}
