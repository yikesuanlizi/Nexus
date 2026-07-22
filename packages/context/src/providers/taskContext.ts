import type { ContextProvider, ProviderContext, TaskCognition, ContextProviderResult } from '../types.js';

export interface TaskContextProviderOptions {
  initialGoal?: string;
  initialConstraints?: string[];
  initialVerificationCriteria?: string[];
}

export class TaskContextProvider implements ContextProvider {
  readonly name = 'task';
  readonly priority = 5;
  readonly maxTokens = 600;
  readonly phase = 'before_turn' as const;

  private readonly defaultGoal?: string;
  private readonly defaultConstraints?: string[];
  private readonly defaultVerificationCriteria?: string[];

  constructor(options?: TaskContextProviderOptions) {
    this.defaultGoal = options?.initialGoal;
    this.defaultConstraints = options?.initialConstraints;
    this.defaultVerificationCriteria = options?.initialVerificationCriteria;
  }

  private initTaskCognition(userInput: string): TaskCognition {
    const hasDefaultGoal = this.defaultGoal && this.defaultGoal.trim().length > 0;
    return {
      goal: hasDefaultGoal ? this.defaultGoal! : this.extractGoalFromInput(userInput),
      constraints: this.defaultConstraints ?? [],
      assumptions: hasDefaultGoal ? ['Goal provided by harness, verify before acting'] : ['Initial goal inferred from user input, may need refinement'],
      knownFacts: [],
      unknowns: hasDefaultGoal ? ['Exact scope of changes needed', 'Potential side effects'] : ['Full intent and constraints'],
      risks: [],
      confidence: hasDefaultGoal ? 0.7 : 0.4,
      verificationCriteria: this.defaultVerificationCriteria ?? [],
    };
  }

  private extractGoalFromInput(input: string): string {
    const trimmed = input.trim();
    if (trimmed.length <= 200) return trimmed;
    return trimmed.slice(0, 197) + '...';
  }

  private formatTaskCognition(task: TaskCognition): string {
    const lines: string[] = ['<task_cognition>'];
    lines.push(`Goal: ${task.goal || '(not yet established)'}`);

    if (task.constraints.length > 0) {
      lines.push(`Constraints (${task.constraints.length}):`);
      for (const c of task.constraints.slice(0, 5)) lines.push(`  - ${c}`);
      if (task.constraints.length > 5) lines.push(`  - ... and ${task.constraints.length - 5} more`);
    }

    if (task.assumptions.length > 0) {
      lines.push(`Working assumptions:`);
      for (const a of task.assumptions.slice(0, 3)) lines.push(`  - ${a}`);
    }

    if (task.knownFacts.length > 0) {
      lines.push(`Confirmed facts:`);
      for (const f of task.knownFacts.slice(0, 5)) lines.push(`  - ${f}`);
    }

    if (task.unknowns.length > 0) {
      lines.push(`Open questions:`);
      for (const u of task.unknowns.slice(0, 3)) lines.push(`  - ${u}`);
    }

    if (task.risks.length > 0) {
      lines.push(`Identified risks:`);
      for (const r of task.risks.slice(0, 3)) lines.push(`  - [${r.severity}] ${r.description}`);
    }

    if (task.verificationCriteria.length > 0) {
      lines.push(`Verification criteria:`);
      for (const v of task.verificationCriteria.slice(0, 5)) lines.push(`  - ${v}`);
    }

    lines.push(`Confidence: ${Math.round(task.confidence * 100)}%`);
    lines.push('</task_cognition>');
    return lines.join('\n');
  }

  async provide(ctx: ProviderContext): Promise<ContextProviderResult> {
    const existingTask = ctx.agentContext.cognition.task;
    const hasGoal = existingTask.goal && existingTask.goal.length > 0;

    let taskCognition: TaskCognition;
    let cognitionChanged = false;

    if (!hasGoal) {
      taskCognition = this.initTaskCognition(ctx.userInput);
      cognitionChanged = true;
    } else {
      taskCognition = existingTask;
    }

    const content = this.formatTaskCognition(taskCognition);

    return {
      chunks: [{
        id: `task:${ctx.threadId}:${ctx.turnId}`,
        source: this.name,
        priority: this.priority,
        tokens: Math.ceil(content.length / 3.5),
        content,
      }],
      contextPatch: cognitionChanged ? { cognition: taskCognition } : undefined,
    };
  }
}
