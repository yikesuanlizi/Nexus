import type {
  ContextProvider,
  ContextProviderResult,
  ProviderContext,
} from '../types.js';
import type {
  ArchitectureSummary,
  ProjectBrainCache,
  ProjectBrainEnricher,
  ProjectChangeDelta,
  RiskArea,
} from './projectBrainTypes.js';
import {
  hashArchitectureSummary,
  scanGitDelta,
  scanLocalProject,
} from './localProjectScanner.js';

export interface ProjectBrainProviderOptions {
  workspaceRoot: string;
  enrichers?: ProjectBrainEnricher[];
  rescanIntervalMs?: number;
  fullInjectionTokenBudget?: number;
  deltaInjectionTokenBudget?: number;
  riskOnlyTurnGap?: number;
  maxDeltaRounds?: number;
  reinjectEveryTurns?: number;
}

const DEFAULT_RESCAN_INTERVAL_MS = 30_000;
const DEFAULT_FULL_BUDGET = 2000;
const DEFAULT_DELTA_BUDGET = 800;
const DEFAULT_RISK_ONLY_TURN_GAP = 8;
const DEFAULT_MAX_DELTA_ROUNDS = 5;
const DEFAULT_REINJECT_EVERY_TURNS = 20;

export class ProjectBrainContextProvider implements ContextProvider {
  readonly name = 'project_brain';
  readonly priority = 15;
  readonly maxTokens: number;
  readonly phase = 'before_turn' as const;

  private readonly workspaceRoot: string;
  private readonly enrichers: ProjectBrainEnricher[];
  private readonly rescanIntervalMs: number;
  private readonly fullBudget: number;
  private readonly deltaBudget: number;
  private readonly riskOnlyGap: number;
  private readonly maxDeltaRounds: number;
  private readonly reinjectEveryTurns: number;

  private sharedArchitecture: {
    summary: ArchitectureSummary | null;
    hash: string;
    lastScannedAt: number;
    changeVersion: number;
  } = { summary: null, hash: '', lastScannedAt: 0, changeVersion: 0 };

  private architectureScanPromise: Promise<void> | null = null;

  private perThreadCache = new Map<string, ProjectBrainCache>();
  private workspaceRootKnown = true;

  constructor(options: ProjectBrainProviderOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.enrichers = options.enrichers ?? [];
    this.rescanIntervalMs = options.rescanIntervalMs ?? DEFAULT_RESCAN_INTERVAL_MS;
    this.fullBudget = options.fullInjectionTokenBudget ?? DEFAULT_FULL_BUDGET;
    this.deltaBudget = options.deltaInjectionTokenBudget ?? DEFAULT_DELTA_BUDGET;
    this.riskOnlyGap = options.riskOnlyTurnGap ?? DEFAULT_RISK_ONLY_TURN_GAP;
    this.maxDeltaRounds = options.maxDeltaRounds ?? DEFAULT_MAX_DELTA_ROUNDS;
    this.reinjectEveryTurns = options.reinjectEveryTurns ?? DEFAULT_REINJECT_EVERY_TURNS;
    this.maxTokens = this.fullBudget;
    if (!this.workspaceRoot) {
      this.workspaceRootKnown = false;
    }
  }

  addEnricher(enricher: ProjectBrainEnricher): void {
    this.enrichers.push(enricher);
  }

  private emptyCache(): ProjectBrainCache {
    return {
      injectedHash: '',
      injectedChangeVersion: 0,
      lastInjectedTurn: 0,
      threadTurnCount: 0,
      lastDelta: null,
      fullInjectedOnce: false,
    };
  }

  private cacheFor(threadId: string): ProjectBrainCache {
    let c = this.perThreadCache.get(threadId);
    if (!c) {
      c = this.emptyCache();
      this.perThreadCache.set(threadId, c);
    }
    return c;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  private async ensureArchitectureScanned(signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    if (this.sharedArchitecture.summary && now - this.sharedArchitecture.lastScannedAt < this.rescanIntervalMs) {
      return;
    }
    if (this.architectureScanPromise) {
      await this.architectureScanPromise;
      return;
    }
    this.architectureScanPromise = this.doArchitectureScan(signal);
    try {
      await this.architectureScanPromise;
    } finally {
      this.architectureScanPromise = null;
    }
  }

  private async doArchitectureScan(signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    if (this.sharedArchitecture.summary && now - this.sharedArchitecture.lastScannedAt < this.rescanIntervalMs) {
      return;
    }
    const local = scanLocalProject(this.workspaceRoot);
    if (!local) {
      this.sharedArchitecture = { summary: null, hash: '', lastScannedAt: 0, changeVersion: 0 };
      return;
    }

    let merged: ArchitectureSummary = { ...local };
    for (const enricher of this.enrichers) {
      if (signal?.aborted) break;
      try {
        if (enricher.getArchitecture) {
          const enrichment = await enricher.getArchitecture(this.workspaceRoot, signal);
          if (enrichment) {
            merged = {
              ...merged,
              ...enrichment,
              techStack: [...new Set([...(merged.techStack ?? []), ...(enrichment.techStack ?? [])])],
              modules: enrichment.modules ? enrichment.modules : merged.modules,
              entryPoints: enrichment.entryPoints ? enrichment.entryPoints : merged.entryPoints,
              keyPatterns: [...new Set([...(merged.keyPatterns ?? []), ...(enrichment.keyPatterns ?? [])])],
            };
          }
        }
      } catch (err) {
        console.warn(`[project-brain] enricher "${enricher.name}" getArchitecture failed:`, err instanceof Error ? err.message : err);
      }
    }

    const newHash = hashArchitectureSummary(merged);
    const changed = newHash !== this.sharedArchitecture.hash;
    this.sharedArchitecture = {
      summary: merged,
      hash: newHash,
      lastScannedAt: Date.now(),
      changeVersion: changed ? this.sharedArchitecture.changeVersion + 1 : this.sharedArchitecture.changeVersion,
    };
  }

  private async getDeltaForThread(cache: ProjectBrainCache, signal?: AbortSignal): Promise<ProjectChangeDelta> {
    let delta: ProjectChangeDelta = scanGitDelta(this.workspaceRoot);
    for (const enricher of this.enrichers) {
      if (signal?.aborted) break;
      try {
        if (enricher.getChangeDelta) {
          const enrichDelta = await enricher.getChangeDelta(this.workspaceRoot, cache.injectedHash, signal);
          if (enrichDelta) {
            delta = {
              changedFiles: [...new Set([...delta.changedFiles, ...(enrichDelta.changedFiles ?? [])])],
              addedFiles: [...new Set([...delta.addedFiles, ...(enrichDelta.addedFiles ?? [])])],
              deletedFiles: [...new Set([...delta.deletedFiles, ...(enrichDelta.deletedFiles ?? [])])],
              riskAreas: mergeRiskAreas(delta.riskAreas, enrichDelta.riskAreas ?? []),
              recentCommits: enrichDelta.recentCommits ?? delta.recentCommits,
            };
          }
        }
        if (enricher.getRiskAreas) {
          const moreRisks = await enricher.getRiskAreas(this.workspaceRoot, delta.changedFiles, signal);
          if (moreRisks) {
            delta.riskAreas = mergeRiskAreas(delta.riskAreas, moreRisks);
          }
        }
      } catch (err) {
        console.warn(`[project-brain] enricher "${enricher.name}" getChangeDelta failed:`, err instanceof Error ? err.message : err);
      }
    }
    return delta;
  }

  private decideInjectionMode(
    cache: ProjectBrainCache,
    threadTurn: number,
    userInput: string,
    delta: ProjectChangeDelta
  ): 'full' | 'delta' | 'risk_only' | 'skip' {
    if (!this.sharedArchitecture.summary) return 'skip';

    if (!cache.fullInjectedOnce || cache.injectedHash !== this.sharedArchitecture.hash) {
      return 'full';
    }

    const turnsSinceInjected = threadTurn - cache.lastInjectedTurn;
    if (turnsSinceInjected >= this.reinjectEveryTurns) return 'full';

    const hasChanges = delta.changedFiles.length > 0
      || delta.addedFiles.length > 0
      || delta.deletedFiles.length > 0
      || delta.riskAreas.length > 0
      || this.sharedArchitecture.changeVersion !== cache.injectedChangeVersion;

    const input = userInput.toLowerCase();
    const riskTrigger = /delete|remove|drop|truncate|migrate|refactor|breaking|deploy|publish|release/i.test(input);

    if (riskTrigger && delta.riskAreas.length > 0) {
      return 'risk_only';
    }

    if (hasChanges) {
      return 'delta';
    }

    if (turnsSinceInjected >= this.riskOnlyGap) {
      return 'risk_only';
    }

    return 'skip';
  }

  resetThread(threadId: string): void {
    this.perThreadCache.delete(threadId);
  }

  invalidateArchitecture(): void {
    this.sharedArchitecture = { summary: null, hash: '', lastScannedAt: 0, changeVersion: this.sharedArchitecture.changeVersion + 1 };
    this.architectureScanPromise = null;
  }

  private formatFullArchitecture(arch: ArchitectureSummary): string {
    const lines: string[] = ['<project_brain>'];
    lines.push(`Language: ${arch.language}`);
    if (arch.framework) lines.push(`Framework: ${arch.framework}`);
    if (arch.buildSystem) lines.push(`Build: ${arch.buildSystem}`);
    if (arch.testFramework) lines.push(`Tests: ${arch.testFramework}`);
    if (arch.techStack.length > 0) {
      lines.push(`Tech stack: ${arch.techStack.join(', ')}`);
    }
    if (arch.entryPoints.length > 0) {
      lines.push(`Entry points: ${arch.entryPoints.slice(0, 5).join(', ')}`);
    }
    if (arch.keyPatterns.length > 0) {
      lines.push(`Project traits: ${arch.keyPatterns.join(', ')}`);
    }
    if (arch.modules.length > 0) {
      lines.push('Modules:');
      const shown = arch.modules.slice(0, 15);
      for (const m of shown) {
        const purpose = m.purpose ? ` (${m.purpose})` : '';
        lines.push(`  - ${m.name}  [${m.path}]${purpose}`);
      }
      if (arch.modules.length > 15) {
        lines.push(`  - ... and ${arch.modules.length - 15} more`);
      }
    }
    lines.push('</project_brain>');
    return lines.join('\n');
  }

  private formatDelta(delta: ProjectChangeDelta): string {
    const lines: string[] = ['<project_brain_delta>'];
    if (delta.changedFiles.length > 0) {
      lines.push(`Changed (${delta.changedFiles.length}): ${delta.changedFiles.slice(0, 8).join(', ')}`);
    }
    if (delta.addedFiles.length > 0) {
      lines.push(`Added (${delta.addedFiles.length}): ${delta.addedFiles.slice(0, 5).join(', ')}`);
    }
    if (delta.deletedFiles.length > 0) {
      lines.push(`Deleted (${delta.deletedFiles.length}): ${delta.deletedFiles.slice(0, 5).join(', ')}`);
    }
    if (delta.riskAreas.length > 0) {
      lines.push('Risk areas:');
      for (const r of delta.riskAreas.slice(0, 3)) {
        lines.push(`  - [${r.severity}] ${r.area}: ${r.reason}`);
      }
    }
    lines.push('</project_brain_delta>');
    return lines.join('\n');
  }

  private formatRiskOnly(delta: ProjectChangeDelta): string {
    if (delta.riskAreas.length === 0) return '';
    const lines: string[] = ['<project_brain_risks>'];
    for (const r of delta.riskAreas.slice(0, 3)) {
      lines.push(`  - [${r.severity}] ${r.area}: ${r.reason}`);
    }
    lines.push('</project_brain_risks>');
    return lines.join('\n');
  }

  async provide(ctx: ProviderContext, signal?: AbortSignal): Promise<ContextProviderResult> {
    if (!this.workspaceRootKnown) {
      return [];
    }

    const threadCache = this.cacheFor(ctx.threadId);
    threadCache.threadTurnCount += 1;
    const currentThreadTurn = threadCache.threadTurnCount;

    try {
      await this.ensureArchitectureScanned(signal);
    } catch {
      return [];
    }

    if (!this.sharedArchitecture.summary) return [];

    const delta = await this.getDeltaForThread(threadCache, signal);
    threadCache.lastDelta = delta;

    const mode = this.decideInjectionMode(threadCache, currentThreadTurn, ctx.userInput, delta);
    if (mode === 'skip') return [];

    let content = '';
    let tokenBudget = 0;
    let closingTag = '';
    if (mode === 'full') {
      content = this.formatFullArchitecture(this.sharedArchitecture.summary);
      tokenBudget = this.fullBudget;
      threadCache.fullInjectedOnce = true;
      threadCache.injectedHash = this.sharedArchitecture.hash;
      threadCache.injectedChangeVersion = this.sharedArchitecture.changeVersion;
    } else if (mode === 'delta') {
      content = this.formatDelta(delta);
      tokenBudget = this.deltaBudget;
      closingTag = '</project_brain_delta>';
    } else {
      content = this.formatRiskOnly(delta);
      tokenBudget = 400;
      closingTag = '</project_brain_risks>';
    }

    if (!content) return [];

    let tokens = this.estimateTokens(content);
    if (tokens > tokenBudget) {
      content = content.slice(0, Math.floor(tokenBudget * 3.5)) + '\n...[truncated]' + closingTag;
      tokens = this.estimateTokens(content);
    }

    threadCache.lastInjectedTurn = currentThreadTurn;

    const chunks = [{
      id: `project_brain:${this.sharedArchitecture.hash}:${this.sharedArchitecture.changeVersion}:${mode}`,
      source: this.name,
      priority: this.priority,
      tokens,
      content,
      metadata: {
        mode,
        changeVersion: this.sharedArchitecture.changeVersion,
        architectureHash: this.sharedArchitecture.hash,
        changedFiles: delta.changedFiles.length,
        riskCount: delta.riskAreas.length,
        threadId: ctx.threadId,
      },
    }];

    const projectCtx = {
      architecture: mode === 'full' ? content : undefined,
      architectureHash: this.sharedArchitecture.hash,
      techStack: this.sharedArchitecture.summary.techStack,
      framework: this.sharedArchitecture.summary.framework,
      language: this.sharedArchitecture.summary.language,
      modules: this.sharedArchitecture.summary.modules.map((m) => ({ name: m.name, path: m.path, purpose: m.purpose })),
      entryPoints: this.sharedArchitecture.summary.entryPoints,
      changedFiles: delta.changedFiles,
      changeVersion: this.sharedArchitecture.changeVersion,
      riskyAreas: delta.riskAreas.map((r) => ({ area: r.area, reason: r.reason, severity: r.severity })),
      lastInjectedTurn: currentThreadTurn,
      lastScannedAt: this.sharedArchitecture.lastScannedAt,
      fullInjectedOnce: threadCache.fullInjectedOnce,
    };

    return {
      chunks,
      contextPatch: {
        world: { project: projectCtx },
      },
    };
  }
}

function mergeRiskAreas(existing: RiskArea[], incoming: RiskArea[]): RiskArea[] {
  const seen = new Set<string>();
  const result: RiskArea[] = [];
  for (const r of [...existing, ...incoming]) {
    const key = `${r.area}:${r.reason.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(r);
  }
  return result.slice(0, 8);
}
