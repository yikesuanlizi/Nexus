export {
  compactThread,
  getCompactionPressure,
  shouldCompact,
  resumeThread,
  forkThread,
  rollbackTurns,
} from './memory.js';
export type { CompactOptions, ResumeResult } from './memory.js';
export {
  LIGHT_MEMORY_KEY,
  deleteLightMemory,
  flushLightMemoryQueue,
  getLightMemoryState,
  listLightMemories,
  queueLightMemory,
  setLightMemoryEnabled,
} from './lightMemory.js';
export type { LightMemoryEntry, LightMemoryState, QueueLightMemoryOptions } from './lightMemory.js';
export {
  DEFAULT_MEMORY_SETTINGS,
  exportMemoryArtifacts,
  extractMemoryCandidates,
  getMemorySettings,
  mergeMemoryCandidate,
  normalizeMemorySettings,
  pruneColdMemories,
  searchColdMemories,
  setMemorySettings,
} from './coldMemory.js';
export type {
  ExtractMemoryCandidateInput,
  MemoryCandidate,
  MemorySearchResult,
  MemorySettings,
  PruneColdMemoryOptions,
  PruneColdMemoryResult,
  SearchColdMemoryOptions,
} from './coldMemory.js';

export {
  buildEpisodePromptBlock,
  createEpisodeRecord,
  DEFAULT_EPISODE_MEMORY_SETTINGS,
  demoteColdEpisodes,
  getEpisodeMemorySettings,
  getOpenEpisodeForThread,
  invalidateEpisodesByTurnRange,
  listEpisodeRecords,
  normalizeEpisodeMemorySettings,
  promoteEpisodeToWarm,
  pruneStaleEpisodes,
  recordEpisodeUsage,
  saveEpisodeRecord,
  sealEpisode,
  searchEpisodeRecords,
  setEpisodeMemorySettings,
  updateEpisodeFromTurn,
} from './episode.js';
export type {
  CreateEpisodeInput,
  EpisodeMemorySettings,
  InvalidatedEpisodes,
  PruneStaleEpisodeOptions,
} from './episode.js';

export {
  buildOrReuseWorkingSet,
  computeEpisodeIdentity,
  computeTaskFingerprint,
  emptyWorkingSetSnapshot,
  getThreadWorkingSetSnapshot,
  saveThreadWorkingSetSnapshot,
} from './workingSet.js';
export type { SwitchReason, WorkingSetResult } from './workingSet.js';

export { retrieveEpisodesForWorkingSet } from './episodeRetrieval.js';
export type { RetrievalContext } from './episodeRetrieval.js';

export const MEMORY_VERSION = '0.1.0';
