export { createContextEngine } from './contextEngine.js';
export type { ContextEngine } from './contextEngine.js';

export {
  createInitialAgentContext,
  mergeCognitionUpdate,
} from './types.js';
export type {
  AgentContext,
  AssembledContext,
  CognitionLayer,
  ContextChunk,
  ContextEngineConfig,
  ContextPhase,
  ContextPatch,
  ContextProvider,
  ContextProviderResult,
  EnvironmentContext,
  MemoryLayer,
  ProjectContext,
  ProviderContext,
  ProviderOutput,
  RiskAssessment,
  TaskCognition,
  WorldLayer,
} from './types.js';

export { EnvironmentContextProvider } from './providers/environmentContext.js';
export type { EnvironmentContextProviderOptions } from './providers/environmentContext.js';
export { TaskContextProvider } from './providers/taskContext.js';
export type { TaskContextProviderOptions } from './providers/taskContext.js';
export { ProjectBrainContextProvider } from './providers/projectBrainContext.js';
export type { ProjectBrainProviderOptions } from './providers/projectBrainContext.js';
export { ExperienceContextProvider } from './providers/experienceContext.js';
export type { ExperienceContextProviderOptions } from './providers/experienceContext.js';
export { scanLocalProject, scanGitDelta, hashArchitectureSummary } from './providers/localProjectScanner.js';
export type {
  ArchitectureSummary,
  InjectionMode,
  ModuleInfo,
  ProjectBrainCache,
  ProjectBrainEnricher,
  ProjectChangeDelta,
  RiskArea,
} from './providers/projectBrainTypes.js';

export { ExperienceEngine } from './experience/index.js';
export type {
  Experience,
  ExperienceCandidate,
  ExperienceQuery,
  ExperienceStore,
  ExperienceType,
  ExperienceSituation,
  ExperienceAction,
  ExperienceOutcome,
  EvaluationResult,
  FailureRecord,
  SuccessRecord,
  EnvironmentFactRecord,
  ExperienceEngineConfig,
} from './experience/index.js';
export { InMemoryExperienceStore, JsonExperienceStore } from './experience/index.js';
export { evaluateCandidate, classifyErrorMessage } from './experience/index.js';
