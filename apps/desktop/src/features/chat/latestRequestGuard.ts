export interface LatestRequestGuard {
  begin(): { generation: number; signal: AbortSignal };
  isCurrent(candidate: number): boolean;
  dispose(): void;
}

export function createLatestRequestGuard(): LatestRequestGuard {
  let generation = 0;
  let controller: AbortController | null = null;
  return {
    begin() {
      controller?.abort();
      controller = new AbortController();
      generation += 1;
      return { generation, signal: controller.signal };
    },
    isCurrent(candidate: number) {
      return candidate === generation && controller?.signal.aborted === false;
    },
    dispose() {
      controller?.abort();
      controller = null;
      generation += 1;
    },
  };
}
