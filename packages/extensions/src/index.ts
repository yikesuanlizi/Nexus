export {
  loadAgentsMd,
  LocalSkillRegistryCache,
  LocalSkillRegistry,
  LocalHookRegistry,
} from './extensions.js';
export type {
  SkillDefinition,
  SkillRegistry,
  HookEvent,
  HookContext,
  HookHandler,
  HookRegistry,
} from './extensions.js';

export {
  parseSkillManifest,
  discoverSkills,
  loadSkillModule,
  loadAllSkillModules,
  skillsToDefinitions,
  registerSkillsToRegistry,
  buildSkillsIndexBlock,
} from './skillRuntime.js';
export type {
  SkillKind,
  SkillManifest,
  SkillParameter,
  SkillExecutionContext,
  SkillPrepareResult,
  SkillVerifyResult,
  SkillRollbackReason,
  SkillExecutionResult,
  SkillPrepareFn,
  SkillVerifyFn,
  SkillRollbackFn,
  SkillExecuteFn,
  SkillModule,
  LoadedSkill,
  SkillLoadError,
  LoadSkillsResult,
} from './skillRuntime.js';

export const EXTENSIONS_VERSION = '0.2.0';
