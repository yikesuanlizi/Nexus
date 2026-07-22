import type {
  Experience,
  ExperienceCandidate,
  ExperienceQuery,
  ExperienceStore,
} from './types.js';
import { evaluateCandidate, estimateSignalStrength, DEFAULT_EVALUATION_GATE_CONFIG, type EvaluationGateConfig } from './evaluationGate.js';
import { InMemoryExperienceStore } from './experienceStore.js';

export interface ExperienceEngineConfig {
  store?: ExperienceStore;
  gate?: Partial<EvaluationGateConfig>;
  enabled?: boolean;
  workspaceRoot?: string;
}

export interface FailureRecord {
  toolName?: string;
  errorMessage: string;
  symptoms?: string[];
  resolutionSteps: string[];
  resolution?: string;
  commands?: string[];
  workspaceRoot?: string;
  threadId?: string;
  iterations?: number;
}

export interface SuccessRecord {
  toolNames: string[];
  taskSummary: string;
  steps: string[];
  commands?: string[];
  workspaceRoot?: string;
  threadId?: string;
  reasoning?: string;
  attempts?: number;
}

export interface EnvironmentFactRecord {
  fact: string;
  toolNames?: string[];
  workspaceRoot?: string;
  threadId?: string;
}

const ERROR_CODE_PATTERNS: Array<{ pattern: RegExp; triggers: string[]; tags: string[] }> = [
  { pattern: /MODULE_NOT_FOUND|Cannot find module|cannot find module/i, triggers: ['missing dependency'], tags: ['deps', 'npm'] },
  { pattern: /EACCES|Permission denied|permission denied|EPERM/i, triggers: ['permission error'], tags: ['permissions'] },
  { pattern: /ECONNREFUSED|EAI_AGAIN|ENOTFOUND|getaddrinfo/i, triggers: ['connection refused'], tags: ['network'] },
  { pattern: /EADDRINUSE|address already in use|port \d+ (is )?in use/i, triggers: ['port in use'], tags: ['port-conflict'] },
  { pattern: /ENOSPC|no space left|disk full/i, triggers: ['disk full'], tags: ['disk'] },
  { pattern: /command not found|not recognized as.*command/i, triggers: ['command not found'], tags: ['path', 'install'] },
  { pattern: /version mismatch|incompatible|unsupported version|requires node/i, triggers: ['version mismatch'], tags: ['version'] },
  { pattern: /ENOENT|no such file|does not exist/i, triggers: ['file not found'], tags: ['path'] },
  { pattern: /ETIMEDOUT|timeout|timed out/i, triggers: ['timeout'], tags: ['network', 'timeout'] },
  { pattern: /OUT_OF_MEMORY|heap out|JavaScript heap out|OOM/i, triggers: ['out of memory'], tags: ['memory'] },
  { pattern: /SyntaxError|Unexpected token|Unexpected identifier/i, triggers: ['syntax error'], tags: ['syntax'] },
  { pattern: /TypeError|is not a function|cannot read propert|undefined is not/i, triggers: ['type error'], tags: ['types', 'null-check'] },
];

function classifyError(message: string): { triggers: string[]; tags: string[] } | null {
  for (const { pattern, triggers, tags } of ERROR_CODE_PATTERNS) {
    if (pattern.test(message)) {
      return { triggers, tags };
    }
  }
  return null;
}

export class ExperienceEngine {
  private readonly store: ExperienceStore;
  private readonly gateConfig: EvaluationGateConfig;
  private readonly enabled: boolean;
  private readonly workspaceRoot?: string;

  constructor(config: ExperienceEngineConfig = {}) {
    this.store = config.store ?? new InMemoryExperienceStore();
    this.gateConfig = { ...DEFAULT_EVALUATION_GATE_CONFIG, ...config.gate };
    this.enabled = config.enabled ?? true;
    this.workspaceRoot = config.workspaceRoot;
  }

  private async recordCandidate(candidate: ExperienceCandidate): Promise<Experience | null> {
    if (!this.enabled) return null;
    const evaluation = evaluateCandidate(candidate, this.gateConfig);
    if (!evaluation.shouldStore) {
      return null;
    }
    return this.store.record(candidate, evaluation);
  }

  async recordFailure(record: FailureRecord): Promise<Experience | null> {
    if (!this.enabled) return null;
    const classification = classifyError(record.errorMessage);
    const symptoms = record.symptoms && record.symptoms.length > 0
      ? record.symptoms
      : (classification?.triggers ?? ['tool failure']);
    const errorSnippet = record.errorMessage.slice(0, 500);
    const toolNames = record.toolName ? [record.toolName] : [];

    const candidate: ExperienceCandidate = {
      type: 'failure_pattern',
      situation: {
        symptoms,
        triggers: classification?.triggers ?? [],
        keywords: classification?.triggers,
        errorMessages: [errorSnippet],
        toolNames,
        context: record.toolName,
      },
      action: {
        steps: record.resolutionSteps,
        toolsUsed: toolNames,
        commands: record.commands,
      },
      outcome: {
        success: true,
        resolution: record.resolution ?? record.resolutionSteps[record.resolutionSteps.length - 1],
        errorEncountered: errorSnippet,
        attemptsBeforeSuccess: record.iterations ?? 1,
      },
      workspaceRoot: record.workspaceRoot ?? this.workspaceRoot,
      sourceThreadId: record.threadId,
      tags: classification?.tags ?? ['failure'],
      signalStrength: estimateSignalStrength({
        error: { message: record.errorMessage },
        toolCalls: toolNames.length,
        toolNames,
        iterationsBeforeResolution: record.iterations,
        explicitFailure: true,
        repeatedPattern: (record.iterations ?? 0) >= 2,
      }),
    };

    return this.recordCandidate(candidate);
  }

  async recordSuccess(record: SuccessRecord): Promise<Experience | null> {
    if (!this.enabled) return null;
    if (record.steps.length < 1) return null;

    const candidate: ExperienceCandidate = {
      type: 'successful_workflow',
      situation: {
        symptoms: [record.taskSummary.slice(0, 200)],
        triggers: record.toolNames,
        toolNames: record.toolNames,
        context: record.taskSummary.slice(0, 300),
      },
      action: {
        steps: record.steps,
        toolsUsed: record.toolNames,
        commands: record.commands,
        reasoning: record.reasoning,
      },
      outcome: {
        success: true,
        resolution: record.steps[record.steps.length - 1],
        attemptsBeforeSuccess: record.attempts ?? 1,
      },
      workspaceRoot: record.workspaceRoot ?? this.workspaceRoot,
      sourceThreadId: record.threadId,
      signalStrength: estimateSignalStrength({
        toolCalls: record.toolNames.length,
        toolNames: record.toolNames,
        iterationsBeforeResolution: record.attempts,
        explicitSuccess: true,
      }),
    };

    return this.recordCandidate(candidate);
  }

  async recordGotcha(record: {
    symptom: string;
    trigger?: string;
    workaround: string;
    workspaceRoot?: string;
    threadId?: string;
  }): Promise<Experience | null> {
    if (!this.enabled) return null;
    const candidate: ExperienceCandidate = {
      type: 'gotcha',
      situation: {
        symptoms: [record.symptom],
        triggers: record.trigger ? [record.trigger] : [],
      },
      action: {
        steps: [record.workaround],
      },
      outcome: { success: true, resolution: record.workaround },
      workspaceRoot: record.workspaceRoot ?? this.workspaceRoot,
      sourceThreadId: record.threadId,
      tags: ['gotcha'],
      signalStrength: 0.65,
    };
    return this.recordCandidate(candidate);
  }

  async recordEnvironmentFact(record: EnvironmentFactRecord): Promise<Experience | null> {
    if (!this.enabled) return null;
    const candidate: ExperienceCandidate = {
      type: 'environment_fact',
      situation: {
        symptoms: ['environment fact discovered'],
        triggers: record.toolNames ?? [],
        toolNames: record.toolNames,
      },
      action: {
        steps: [record.fact],
        toolsUsed: record.toolNames,
      },
      outcome: { success: true },
      workspaceRoot: record.workspaceRoot ?? this.workspaceRoot,
      sourceThreadId: record.threadId,
      tags: ['environment'],
      signalStrength: 0.6,
    };
    return this.recordCandidate(candidate);
  }

  async recordToolPattern(record: {
    toolName: string;
    correctUsage: string;
    commonMistake?: string;
    workspaceRoot?: string;
    threadId?: string;
  }): Promise<Experience | null> {
    if (!this.enabled) return null;
    const steps = [record.correctUsage];
    if (record.commonMistake) steps.unshift(`Common mistake: ${record.commonMistake}`);
    const candidate: ExperienceCandidate = {
      type: 'tool_usage_pattern',
      situation: {
        symptoms: [record.commonMistake ? `pitfall with ${record.toolName}` : `using ${record.toolName}`],
        triggers: [record.toolName],
        toolNames: [record.toolName],
      },
      action: { steps, toolsUsed: [record.toolName] },
      outcome: { success: true, resolution: record.correctUsage },
      workspaceRoot: record.workspaceRoot ?? this.workspaceRoot,
      sourceThreadId: record.threadId,
      tags: ['tool-usage', record.toolName],
      signalStrength: 0.55,
    };
    return this.recordCandidate(candidate);
  }

  async findRelevant(query: ExperienceQuery): Promise<Experience[]> {
    return this.store.query({ limit: 5, minConfidence: 0.5, ...query });
  }

  async findByError(errorMessage: string, workspaceRoot?: string): Promise<Experience[]> {
    const classification = classifyError(errorMessage);
    if (!classification) return [];
    const triggers = classification.triggers;
    return this.store.query({
      workspaceRoot: workspaceRoot ?? this.workspaceRoot,
      type: 'failure_pattern',
      taskKeywords: triggers,
      minConfidence: 0.5,
      limit: 3,
    });
  }

  formatExperiencesForPrompt(exps: Experience[]): string {
    if (exps.length === 0) return '';
    const lines = ['<relevant_experiences>'];
    for (const exp of exps) {
      const tag = exp.type === 'failure_pattern' ? 'failure' : exp.type;
      lines.push(`<${tag} confidence="${Math.round(exp.confidence * 100)}%">`);
      if (exp.situation.symptoms.length > 0) {
        lines.push(`Situation: ${exp.situation.symptoms.join('; ')}`);
      }
      if (exp.action.steps.length > 0) {
        lines.push(`Action: ${exp.action.steps.join(' → ')}`);
      }
      if (exp.outcome.resolution) {
        lines.push(`Outcome: ${exp.outcome.success ? '✓' : '✗'} ${exp.outcome.resolution}`);
      }
      lines.push(`</${tag}>`);
    }
    lines.push('</relevant_experiences>');
    return lines.join('\n');
  }

  getStore(): ExperienceStore {
    return this.store;
  }

  getEnabled(): boolean {
    return this.enabled;
  }

  async prune(maxEntries: number = 500): Promise<number> {
    return this.store.prune(maxEntries);
  }
}

export function classifyErrorMessage(message: string) {
  return classifyError(message);
}
