import type { EvaluationResult, ExperienceCandidate, ExperienceType } from './types.js';

export interface EvaluationGateConfig {
  minSignalStrength: number;
  minActionSteps: number;
  requireOutcome: boolean;
  banVagueSymptoms: boolean;
  minConfidence: number;
  requireActionable: boolean;
}

export const DEFAULT_EVALUATION_GATE_CONFIG: EvaluationGateConfig = {
  minSignalStrength: 0.4,
  minActionSteps: 1,
  requireOutcome: true,
  banVagueSymptoms: true,
  minConfidence: 0.5,
  requireActionable: true,
};

const VAGUE_PATTERNS = [
  /^fix(ed)? (it|the issue|the problem|the bug)$/i,
  /^something (is|was) wrong/i,
  /^it (doesn't|didn't|does not) work/i,
  /^error$/i,
  /^issue$/i,
  /^problem$/i,
  /^tried (everything|many things)/i,
];

const GENERIC_ACTIONS = [
  /^fix(ed)? it$/i,
  /^tried again$/i,
  /^did something$/i,
  /^retry$/i,
  /^restart(ed)?$/i,
];

const ACTIONABLE_FAILURE_KEYWORDS = [
  'switch to', 'changed to', 'installed', 'downgraded', 'upgraded',
  'set', 'added', 'removed', 'replaced', 'configured', 'ran',
  'deleted', 'renamed', 'moved', 'disabled', 'enabled',
  'npm install', 'pnpm add', 'pip install', 'cargo add', 'go get',
  'node_modules', 'clear cache', 'use node', 'use python',
  'export ', 'chmod', 'kill', 'pkill', 'docker', 'git reset',
  'port ', 'kill port', 'change port',
];

const ACTIONABLE_SUCCESS_KEYWORDS = [
  'first', 'then', 'finally', 'step', 'added', 'created', 'wrote',
  'implemented', 'used', 'called', 'ran ', 'executed', 'applied',
  'refactored', 'extracted', 'moved', 'renamed',
];

function isVagueSymptom(symptom: string): boolean {
  const trimmed = symptom.trim();
  if (trimmed.length < 5) return true;
  return VAGUE_PATTERNS.some((p) => p.test(trimmed));
}

function isGenericAction(step: string): boolean {
  const trimmed = step.trim();
  if (trimmed.length < 5) return true;
  return GENERIC_ACTIONS.some((p) => p.test(trimmed));
}

function hasActionableSteps(steps: string[], outcome: { success: boolean }): boolean {
  if (steps.length === 0) return false;
  const specificSteps = steps.filter((s) => !isGenericAction(s));
  if (specificSteps.length === 0) return false;
  const keywords = outcome.success ? ACTIONABLE_SUCCESS_KEYWORDS : ACTIONABLE_FAILURE_KEYWORDS;
  return specificSteps.some((step) => keywords.some((kw) => step.toLowerCase().includes(kw)));
}

function classifyErrorSignals(symptoms: string[], errorMessages?: string[]): number {
  let score = 0;
  const all = [...symptoms, ...(errorMessages ?? [])];
  for (const s of all) {
    const lower = s.toLowerCase();
    if (/(econnrefused|econnreset|enotfound|etimedout|eai_)/.test(lower)) score += 0.5;
    if (/permission (denied|refused)|eacces|epermission/.test(lower)) score += 0.5;
    if (/module not found|cannot find module|enomod/.test(lower)) score += 0.6;
    if (/syntaxerror|unexpected token|expected/.test(lower)) score += 0.4;
    if (/typeerror|cannot read propert|undefined is not/.test(lower)) score += 0.4;
    if (/port \d+ (is )?in use|eaddrinuse/.test(lower)) score += 0.7;
    if (/version mismatch|incompatible|unsupported/.test(lower)) score += 0.5;
    if (/command not found|not recognized/.test(lower)) score += 0.5;
    if (/disk (is )?full|enospc/.test(lower)) score += 0.6;
    if (/out of memory|heap out|oom/.test(lower)) score += 0.5;
  }
  return Math.min(1, score);
}

function extractTags(candidate: ExperienceCandidate): string[] {
  const tags = new Set<string>();
  tags.add(candidate.type);
  if (candidate.outcome.success) tags.add('success');
  else tags.add('failure');
  for (const tool of candidate.action.toolsUsed ?? []) {
    if (tool.length <= 30) tags.add(`tool:${tool}`);
  }
  for (const err of candidate.situation.errorMessages ?? []) {
    const match = err.match(/^(E[A-Z_]+|Error)/i);
    if (match) tags.add(`err:${match[1].toLowerCase()}`);
  }
  return [...tags];
}

export function evaluateCandidate(
  candidate: ExperienceCandidate,
  config: EvaluationGateConfig = DEFAULT_EVALUATION_GATE_CONFIG,
): EvaluationResult {
  const reject = (reason: string, confidence: number = 0): EvaluationResult => ({
    shouldStore: false,
    reason,
    confidence,
  });

  if (candidate.signalStrength < config.minSignalStrength) {
    return reject(`signal strength too low: ${candidate.signalStrength.toFixed(2)} < ${config.minSignalStrength}`);
  }

  if (!candidate.situation.symptoms || candidate.situation.symptoms.length === 0) {
    return reject('no symptoms provided');
  }

  if (config.banVagueSymptoms && candidate.situation.symptoms.every(isVagueSymptom)) {
    return reject('all symptoms are too vague to be actionable');
  }

  if (candidate.action.steps.length < config.minActionSteps) {
    return reject(`need at least ${config.minActionSteps} action step(s)`);
  }

  if (config.requireOutcome && candidate.outcome.success === undefined) {
    return reject('outcome.success is required');
  }

  if (config.requireActionable && !hasActionableSteps(candidate.action.steps, candidate.outcome)) {
    return reject('action steps are not specific enough (need concrete commands/tools/keywords)');
  }

  let confidence = candidate.signalStrength;

  if (candidate.outcome.success) {
    confidence = Math.min(1, confidence * 0.9 + 0.1);
  } else {
    confidence = Math.min(1, confidence * 0.95 + 0.05);
  }

  const errorSignal = classifyErrorSignals(candidate.situation.symptoms, candidate.situation.errorMessages);
  if (candidate.type === 'failure_pattern' && errorSignal > 0) {
    confidence = Math.min(1, confidence + errorSignal * 0.2);
  }

  if (candidate.type === 'environment_fact') {
    confidence = Math.max(confidence, 0.7);
  }

  if (candidate.action.toolsUsed && candidate.action.toolsUsed.length > 0) {
    confidence = Math.min(1, confidence + 0.05);
  }

  if (candidate.action.reasoning && candidate.action.reasoning.length > 20) {
    confidence = Math.min(1, confidence + 0.05);
  }

  if (candidate.outcome.attemptsBeforeSuccess && candidate.outcome.attemptsBeforeSuccess > 1) {
    confidence = Math.min(1, confidence + 0.1);
  }

  if (confidence < config.minConfidence) {
    return reject(`computed confidence ${confidence.toFixed(2)} below threshold ${config.minConfidence}`, confidence);
  }

  return {
    shouldStore: true,
    reason: 'passed all gates',
    confidence,
    suggestedTags: extractTags(candidate),
  };
}

export function estimateSignalStrength(
  options: {
    error?: { message?: string; name?: string };
    toolCalls?: number;
    toolNames?: string[];
    iterationsBeforeResolution?: number;
    explicitFailure?: boolean;
    explicitSuccess?: boolean;
    repeatedPattern?: boolean;
    userFrustration?: boolean;
  },
): number {
  let score = 0.2;
  if (options.error) score += 0.3;
  if (options.error?.message && options.error.message.length > 20) score += 0.1;
  if (options.toolCalls && options.toolCalls >= 3) score += 0.1;
  if (options.toolNames && options.toolNames.length >= 2) score += 0.1;
  if (options.iterationsBeforeResolution && options.iterationsBeforeResolution >= 2) score += 0.15;
  if (options.explicitFailure) score += 0.2;
  if (options.explicitSuccess && options.toolCalls && options.toolCalls >= 2) score += 0.1;
  if (options.repeatedPattern) score += 0.2;
  if (options.userFrustration) score += 0.1;
  return Math.min(1, score);
}

export function isExperienceType(value: string): value is ExperienceType {
  return ['failure_pattern', 'successful_workflow', 'gotcha', 'environment_fact', 'tool_usage_pattern'].includes(value);
}
