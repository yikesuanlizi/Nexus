export {
  compactThread,
  getCompactionPressure,
  shouldCompact,
  resumeThread,
  forkThread,
  rollbackTurns,
} from './memory.js';
export type { CompactOptions, ResumeResult } from './memory.js';

export const MEMORY_VERSION = '0.1.0';
