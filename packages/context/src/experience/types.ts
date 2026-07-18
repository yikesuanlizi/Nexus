export type ExperienceType =
  | 'failure_pattern'
  | 'successful_workflow'
  | 'gotcha'
  | 'environment_fact'
  | 'tool_usage_pattern';

export interface ExperienceSituation {
  taskType?: string;
  symptoms: string[];
  context?: string;
  triggers: string[];
  keywords?: string[];
  errorMessages?: string[];
  toolNames?: string[];
  filePatterns?: string[];
}

export interface ExperienceAction {
  steps: string[];
  toolsUsed?: string[];
  reasoning?: string;
  commands?: string[];
}

export interface ExperienceOutcome {
  success: boolean;
  resolution?: string;
  errorEncountered?: string;
  timeSavedSeconds?: number;
  attemptsBeforeSuccess?: number;
}

export interface Experience {
  id: string;
  type: ExperienceType;
  situation: ExperienceSituation;
  action: ExperienceAction;
  outcome: ExperienceOutcome;
  confidence: number;
  timesReinforced: number;
  workspaceRoot?: string;
  sourceThreadId?: string;
  tags: string[];
  createdAt: number;
  lastUsedAt?: number;
  useCount: number;
}

export interface ExperienceCandidate {
  type: ExperienceType;
  situation: ExperienceSituation;
  action: ExperienceAction;
  outcome: ExperienceOutcome;
  workspaceRoot?: string;
  sourceThreadId?: string;
  tags?: string[];
  signalStrength: number;
}

export interface EvaluationResult {
  shouldStore: boolean;
  reason: string;
  confidence: number;
  suggestedTags?: string[];
}

export interface ExperienceQuery {
  workspaceRoot?: string;
  type?: ExperienceType;
  toolNames?: string[];
  errorMessages?: string[];
  taskKeywords?: string[];
  minConfidence?: number;
  limit?: number;
}

export interface ExperienceStore {
  record(candidate: ExperienceCandidate, evaluation: EvaluationResult): Promise<Experience>;
  reinforce(id: string): Promise<void>;
  query(query: ExperienceQuery): Promise<Experience[]>;
  getAll(workspaceRoot?: string): Promise<Experience[]>;
  remove(id: string): Promise<void>;
  prune(maxEntries?: number): Promise<number>;
}
