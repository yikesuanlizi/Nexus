import type {
  ContextProvider,
  ProviderContext,
  ContextProviderResult,
  ExperienceRef,
} from '../types.js';
import type { Experience } from '../experience/types.js';
import type { ExperienceEngine } from '../experience/experienceEngine.js';

export interface ExperienceContextProviderOptions {
  experienceEngine: ExperienceEngine;
  maxTokens?: number;
  limit?: number;
  minConfidence?: number;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of',
  'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over', 'under',
  'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'because', 'but', 'if', 'about', 'up', 'it', 'its', 'this', 'that', 'these',
  'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'they', 'them', 'their', 'what', 'which', 'who', 'whom',
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这',
]);

function extractKeywords(userInput: string, items: ProviderContext['items']): string[] {
  const keywords = new Set<string>();
  for (const word of userInput.split(/[\s,.!?;:()\[\]{}'"`<>/\\，。！？；：（）、]+/)) {
    const w = word.toLowerCase();
    if (w.length >= 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)) {
      keywords.add(w);
    }
  }
  for (const item of items.slice(-10)) {
    const isToolCall = item.type === 'tool_call' || item.type === 'collab_tool_call' || item.type === 'mcp_tool_call';
    if (isToolCall) {
      const toolItem = item as { toolName?: string; tool?: string; error?: { message?: string } };
      const name = toolItem.toolName ?? toolItem.tool;
      if (name) keywords.add(name.toLowerCase());
      const err = toolItem.error?.message;
      if (err) {
        const m = err.match(/\b(E[A-Z]+|ENOENT|EACCES|EADDRINUSE|MODULE_NOT_FOUND)\b/);
        if (m) keywords.add(m[1].toLowerCase());
      }
    }
  }
  return [...keywords];
}

function collectRecentFailedTools(items: ProviderContext['items']): Array<{ toolName: string; error: { message: string } }> {
  const failed: Array<{ toolName: string; error: { message: string } }> = [];
  for (const item of items.slice(-20)) {
    if (item.type !== 'tool_call' && item.type !== 'collab_tool_call' && item.type !== 'mcp_tool_call') continue;
    const toolItem = item as { toolName?: string; tool?: string; status?: string; error?: { message: string } };
    if (toolItem.status === 'failed' && toolItem.error?.message) {
      const toolName = toolItem.toolName ?? toolItem.tool ?? item.type;
      failed.push({ toolName, error: toolItem.error });
      if (failed.length >= 3) break;
    }
  }
  return failed;
}

function toExperienceRefs(exps: Experience[]): ExperienceRef[] {
  return exps.map((e) => ({
    id: e.id,
    type: e.type === 'failure_pattern'
      ? 'failure_pattern'
      : e.type === 'tool_usage_pattern'
        ? 'successful_workflow'
        : e.type === 'environment_fact'
          ? 'environment_fact'
          : 'successful_workflow',
    summary: e.situation.symptoms.join('; ') || e.outcome.resolution || e.id,
    confidence: e.confidence,
  }));
}

export class ExperienceContextProvider implements ContextProvider {
  readonly name = 'experience';
  readonly priority = 5;
  readonly maxTokens: number;
  readonly phase = 'before_turn' as const;

  private readonly engine: ExperienceEngine;
  private readonly limit: number;
  private readonly minConfidence: number;

  constructor(options: ExperienceContextProviderOptions) {
    this.engine = options.experienceEngine;
    this.maxTokens = options.maxTokens ?? 800;
    this.limit = options.limit ?? 4;
    this.minConfidence = options.minConfidence ?? 0.55;
  }

  async provide(ctx: ProviderContext): Promise<ContextProviderResult> {
    if (!this.engine.getEnabled()) {
      return { chunks: [] };
    }

    const workspaceRoot = ctx.agentContext.world.environment.cwd;
    const keywords = extractKeywords(ctx.userInput, ctx.items);
    const recentFailed = collectRecentFailedTools(ctx.items);

    let relevant: Experience[] = [];
    try {
      relevant = await this.engine.findRelevant({
        workspaceRoot,
        taskKeywords: keywords,
        limit: this.limit,
        minConfidence: this.minConfidence,
      });
    } catch {
      return { chunks: [] };
    }

    for (const failed of recentFailed) {
      try {
        const byError = await this.engine.findByError(failed.error.message, workspaceRoot);
        relevant = [...relevant, ...byError];
      } catch {
        // continue
      }
    }

    const deduped = new Map<string, Experience>();
    for (const e of relevant) {
      if (!deduped.has(e.id)) deduped.set(e.id, e);
    }
    const finalExps = [...deduped.values()];

    if (finalExps.length === 0) {
      return {
        chunks: [],
        contextPatch: { memory: { retrievedExperiences: [] } },
      };
    }

    const formatted = this.engine.formatExperiencesForPrompt(finalExps);
    const content = formatted;

    return {
      chunks: [{
        id: `experiences:${ctx.threadId}:${ctx.turnId}`,
        source: this.name,
        priority: this.priority,
        tokens: Math.ceil(content.length / 3.5),
        content,
      }],
      contextPatch: {
        memory: { retrievedExperiences: toExperienceRefs(finalExps) },
      },
    };
  }
}
