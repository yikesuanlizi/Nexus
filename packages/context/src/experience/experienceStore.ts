import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type {
  Experience,
  ExperienceCandidate,
  ExperienceQuery,
  ExperienceStore,
  EvaluationResult,
} from './types.js';

export function generateExperienceId(candidate: ExperienceCandidate): string {
  const key = [
    candidate.type,
    candidate.outcome.success ? 'success' : 'failure',
    ...(candidate.situation.triggers ?? []).slice(0, 3),
    ...(candidate.situation.errorMessages ?? []).slice(0, 2),
    ...(candidate.action.toolsUsed ?? []).slice(0, 2),
  ].join('|');
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 10);
  return `exp_${candidate.type}_${hash}`;
}

function experienceMatchesQuery(exp: Experience, query: ExperienceQuery): boolean {
  if (query.workspaceRoot !== undefined) {
    if (query.workspaceRoot === null || query.workspaceRoot === '') {
      if (exp.workspaceRoot) return false;
    } else if (exp.workspaceRoot !== query.workspaceRoot) {
      return false;
    }
  }
  if (query.type && exp.type !== query.type) return false;
  if (query.minConfidence && exp.confidence < query.minConfidence) return false;
  if (query.toolNames && query.toolNames.length > 0) {
    const expTools = new Set(exp.action.toolsUsed ?? []);
    if (!query.toolNames.some((t) => expTools.has(t))) return false;
  }
  if (query.errorMessages && query.errorMessages.length > 0 && exp.situation.errorMessages) {
    const msg = exp.situation.errorMessages.join(' ').toLowerCase();
    if (!query.errorMessages.some((e) => msg.includes(e.toLowerCase()))) return false;
  }
  if (query.taskKeywords && query.taskKeywords.length > 0) {
    const blob = [
      ...exp.situation.symptoms,
      exp.situation.context ?? '',
      ...(exp.situation.triggers ?? []),
      ...(exp.situation.keywords ?? []),
      ...(exp.situation.errorMessages ?? []),
      ...(exp.situation.toolNames ?? []),
      ...exp.action.steps,
      exp.outcome.resolution ?? '',
      ...exp.tags,
    ].join(' ').toLowerCase();
    if (!query.taskKeywords.some((k) => blob.includes(k.toLowerCase()))) return false;
  }
  return true;
}

function scoreExperience(exp: Experience, query: ExperienceQuery): number {
  let score = exp.confidence * 10;
  score += Math.min(exp.timesReinforced, 10);
  score += Math.min(exp.useCount, 5);
  if (exp.outcome.success) score += 2;
  if (query.errorMessages?.length && exp.situation.errorMessages?.length) {
    score += 5;
  }
  if (query.toolNames?.length && exp.action.toolsUsed?.length) {
    const overlap = query.toolNames.filter((t) => exp.action.toolsUsed!.includes(t)).length;
    score += overlap * 3;
  }
  if (query.taskKeywords?.length) {
    const blob = [
      ...exp.situation.symptoms,
      ...(exp.situation.triggers ?? []),
      ...(exp.situation.keywords ?? []),
      ...exp.tags,
    ].join(' ').toLowerCase();
    let matchCount = 0;
    for (const kw of query.taskKeywords) {
      if (blob.includes(kw.toLowerCase())) matchCount += 1;
    }
    score += matchCount * 2;
  }
  return score;
}

export class InMemoryExperienceStore implements ExperienceStore {
  private experiences: Map<string, Experience> = new Map();

  async record(candidate: ExperienceCandidate, evaluation: EvaluationResult): Promise<Experience> {
    const id = generateExperienceId(candidate);
    const existing = this.experiences.get(id);
    if (existing) {
      existing.timesReinforced += 1;
      existing.confidence = Math.min(1, (existing.confidence + evaluation.confidence) / 2 + 0.05);
      existing.lastUsedAt = Date.now();
      if (evaluation.suggestedTags) {
        existing.tags = [...new Set([...existing.tags, ...evaluation.suggestedTags])];
      }
      return existing;
    }
    const exp: Experience = {
      id,
      type: candidate.type,
      situation: candidate.situation,
      action: candidate.action,
      outcome: candidate.outcome,
      confidence: evaluation.confidence,
      timesReinforced: 1,
      workspaceRoot: candidate.workspaceRoot,
      sourceThreadId: candidate.sourceThreadId,
      tags: evaluation.suggestedTags ?? candidate.tags ?? [],
      createdAt: Date.now(),
      useCount: 0,
    };
    this.experiences.set(id, exp);
    return exp;
  }

  async reinforce(id: string): Promise<void> {
    const exp = this.experiences.get(id);
    if (exp) {
      exp.timesReinforced += 1;
      exp.confidence = Math.min(1, exp.confidence + 0.1);
      exp.lastUsedAt = Date.now();
    }
  }

  async query(query: ExperienceQuery): Promise<Experience[]> {
    const results: Experience[] = [];
    for (const exp of this.experiences.values()) {
      if (experienceMatchesQuery(exp, query)) {
        results.push(exp);
      }
    }
    results.sort((a, b) => scoreExperience(b, query) - scoreExperience(a, query));
    const limit = query.limit ?? 10;
    return results.slice(0, limit);
  }

  async getAll(workspaceRoot?: string): Promise<Experience[]> {
    const all = [...this.experiences.values()];
    if (workspaceRoot !== undefined) {
      return all.filter((e) => e.workspaceRoot === workspaceRoot);
    }
    return all;
  }

  async remove(id: string): Promise<void> {
    this.experiences.delete(id);
  }

  async prune(maxEntries: number = 200): Promise<number> {
    const all = [...this.experiences.values()];
    if (all.length <= maxEntries) return 0;
    all.sort((a, b) => {
      const scoreA = a.confidence * 10 + a.timesReinforced + a.useCount - (Date.now() - (a.lastUsedAt ?? a.createdAt)) / 86400000;
      const scoreB = b.confidence * 10 + b.timesReinforced + b.useCount - (Date.now() - (b.lastUsedAt ?? b.createdAt)) / 86400000;
      return scoreB - scoreA;
    });
    const toRemove = all.slice(maxEntries);
    for (const exp of toRemove) {
      this.experiences.delete(exp.id);
    }
    return toRemove.length;
  }

  clear(): void {
    this.experiences.clear();
  }
}

interface ExperienceFile {
  version: number;
  experiences: Experience[];
}

const CURRENT_FILE_VERSION = 1;

export class JsonExperienceStore implements ExperienceStore {
  private readonly memory: InMemoryExperienceStore;
  private readonly filePath: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(baseDir: string, filename: string = 'experiences.json') {
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }
    this.filePath = join(baseDir, filename);
    this.memory = new InMemoryExperienceStore();
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as ExperienceFile;
      if (parsed.version === CURRENT_FILE_VERSION && Array.isArray(parsed.experiences)) {
        for (const exp of parsed.experiences) {
          (this.memory as unknown as { experiences: Map<string, Experience> }).experiences.set(exp.id, exp);
        }
      }
    } catch {
      // corrupt file, start fresh
    }
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveNow();
      this.saveTimer = null;
    }, 5000);
  }

  saveNow(): void {
    if (!this.dirty) return;
    try {
      const all = this.memory['experiences'] as Map<string, Experience>;
      const data: ExperienceFile = {
        version: CURRENT_FILE_VERSION,
        experiences: [...all.values()],
      };
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
      this.dirty = false;
    } catch {
      // best effort
    }
  }

  async record(candidate: ExperienceCandidate, evaluation: EvaluationResult): Promise<Experience> {
    const exp = await this.memory.record(candidate, evaluation);
    this.scheduleSave();
    return exp;
  }

  async reinforce(id: string): Promise<void> {
    await this.memory.reinforce(id);
    this.scheduleSave();
  }

  async query(query: ExperienceQuery): Promise<Experience[]> {
    return this.memory.query(query);
  }

  async getAll(workspaceRoot?: string): Promise<Experience[]> {
    return this.memory.getAll(workspaceRoot);
  }

  async remove(id: string): Promise<void> {
    await this.memory.remove(id);
    this.scheduleSave();
  }

  async prune(maxEntries: number = 200): Promise<number> {
    const n = await this.memory.prune(maxEntries);
    if (n > 0) this.scheduleSave();
    return n;
  }

  destroy(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveNow();
    }
  }

  static resetStore(baseDir: string, filename: string = 'experiences.json'): void {
    const fp = join(baseDir, filename);
    if (existsSync(fp)) rmSync(fp, { force: true });
  }
}
