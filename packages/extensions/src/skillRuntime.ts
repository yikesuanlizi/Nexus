import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SkillDefinition, SkillRegistry } from './extensions.js';

export type SkillKind = 'prompt' | 'executable';

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
}

export interface SkillManifest {
  name: string;
  description: string;
  version?: string;
  kind: SkillKind;
  entry?: string;
  body: string;
  allowedTools?: string[];
  parameters?: SkillParameter[];
  timeoutMs?: number;
  dependencies?: string[];
  tags?: string[];
  sourcePath: string;
  entryPath?: string;
}

export interface SkillExecutionContext {
  workspaceRoot: string;
  threadId: string;
  turnId?: string;
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
    debug: (msg: string, meta?: Record<string, unknown>) => void;
  };
  signal?: AbortSignal;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  readFile?: (filePath: string) => Promise<string>;
  writeFile?: (filePath: string, content: string) => Promise<void>;
  extra?: Record<string, unknown>;
}

export interface SkillPrepareResult {
  ok: boolean;
  error?: string;
  preparedFiles?: string[];
  backupFiles?: Array<{ path: string; content: string }>;
}

export interface SkillVerifyResult {
  ok: boolean;
  error?: string;
  verifiedBy?: string[];
}

export type SkillRollbackReason = 'prepare_failed' | 'execute_failed' | 'verify_failed' | 'aborted';

export interface SkillExecutionResult {
  success: boolean;
  output?: unknown;
  summary?: string;
  error?: { message: string; code?: string; stack?: string };
  filesChanged?: string[];
  toolsUsed?: string[];
  durationMs: number;
  prepared?: boolean;
  rolledBack?: boolean;
  rollbackReason?: SkillRollbackReason;
}

export type SkillPrepareFn = (
  params: Record<string, unknown>,
  ctx: SkillExecutionContext,
) => Promise<SkillPrepareResult> | SkillPrepareResult;

export type SkillVerifyFn = (
  params: Record<string, unknown>,
  result: unknown,
  ctx: SkillExecutionContext,
) => Promise<SkillVerifyResult> | SkillVerifyResult;

export type SkillRollbackFn = (
  params: Record<string, unknown>,
  reason: SkillRollbackReason,
  backup: Array<{ path: string; content: string }> | undefined,
  ctx: SkillExecutionContext,
) => Promise<void> | void;

export type SkillExecuteFn = (
  params: Record<string, unknown>,
  ctx: SkillExecutionContext,
) => Promise<SkillExecutionResult> | SkillExecutionResult;

export interface SkillModule {
  execute: SkillExecuteFn;
  prepare?: SkillPrepareFn;
  verify?: SkillVerifyFn;
  rollback?: SkillRollbackFn;
  description?: string;
  parameters?: SkillParameter[];
  validateParams?: (params: Record<string, unknown>) => { valid: boolean; errors?: string[] };
}

export interface LoadedSkill extends SkillManifest {
  module?: SkillModule;
}

export interface SkillLoadError {
  name: string;
  sourcePath: string;
  error: string;
}

export interface LoadSkillsResult {
  skills: LoadedSkill[];
  errors: SkillLoadError[];
}

const DEFAULT_SKILL_TIMEOUT_MS = 30_000;
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

function parseFrontmatter(frontmatter: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && value) result[key] = value;
  }
  return result;
}

function parseYamlArray(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  return trimmed.split(/\s+/).filter(Boolean);
}

function parseParameters(frontmatter: Record<string, string>): SkillParameter[] | undefined {
  const params: SkillParameter[] = [];
  const paramRegex = /^param(?:eter)?s?_(\w+?)_(\w+)$/;
  const paramMap = new Map<string, Partial<SkillParameter>>();
  for (const [key, value] of Object.entries(frontmatter)) {
    const match = key.match(paramRegex);
    if (!match) continue;
    const [, paramName, field] = match;
    const entry = paramMap.get(paramName) ?? { name: paramName };
    switch (field) {
      case 'type':
        entry.type = value as SkillParameter['type'];
        break;
      case 'desc':
      case 'description':
        entry.description = value;
        break;
      case 'required':
        entry.required = value === 'true';
        break;
      case 'default':
        try { entry.default = JSON.parse(value); } catch { entry.default = value; }
        break;
    }
    paramMap.set(paramName, entry);
  }
  for (const [name, p] of paramMap) {
    params.push({ name, type: p.type ?? 'string', description: p.description, required: p.required, default: p.default });
  }
  return params.length > 0 ? params : undefined;
}

export function parseSkillManifest(dirPath: string, skillName: string, mdContent: string, mdFilePath: string): SkillManifest {
  let description = '';
  let entry: string | undefined;
  let allowedTools: string[] | undefined;
  let version: string | undefined;
  let tags: string[] | undefined;
  let dependencies: string[] | undefined;
  let parameters: SkillParameter[] | undefined;
  let timeoutMs: number | undefined;
  let body: string;

  const fm = mdContent.match(FRONTMATTER_PATTERN);
  if (fm) {
    const fmData = parseFrontmatter(fm[1]);
    body = fm[2].trim();
    description = fmData.description ?? '';
    version = fmData.version;
    entry = fmData.entry;
    if (fmData.allowed_tools) allowedTools = parseYamlArray(fmData.allowed_tools);
    if (fmData.tags) tags = parseYamlArray(fmData.tags);
    if (fmData.dependencies) dependencies = parseYamlArray(fmData.dependencies);
    parameters = parseParameters(fmData);
    if (fmData.timeout_ms) {
      const parsed = Number(fmData.timeout_ms);
      if (!Number.isNaN(parsed) && parsed > 0) timeoutMs = parsed;
    }
  } else {
    body = mdContent.trim();
  }

  if (!description) {
    const firstLine = body.split('\n')[0]?.replace(/^#\s*/, '').trim() ?? skillName;
    description = firstLine;
  }

  const kind: SkillKind = entry ? 'executable' : 'prompt';
  const entryPath = entry ? path.resolve(path.dirname(mdFilePath), entry) : undefined;

  return {
    name: skillName,
    description,
    version,
    kind,
    entry,
    body,
    allowedTools,
    parameters,
    timeoutMs: timeoutMs ?? DEFAULT_SKILL_TIMEOUT_MS,
    dependencies,
    tags,
    sourcePath: mdFilePath,
    entryPath,
  };
}

export async function discoverSkills(skillsDir: string): Promise<LoadSkillsResult> {
  const skills: LoadedSkill[] = [];
  const errors: SkillLoadError[] = [];

  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return { skills, errors };
  }

  entries = entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
      try {
        const md = await fs.readFile(skillMdPath, 'utf-8');
        const manifest = parseSkillManifest(path.join(skillsDir, entry.name), entry.name, md, skillMdPath);
        skills.push({ ...manifest });
      } catch (err) {
        errors.push({ name: entry.name, sourcePath: skillMdPath, error: (err as Error).message });
      }
    } else if (entry.isFile() && entry.name.endsWith('.skill.md')) {
      const skillName = entry.name.replace(/\.skill\.md$/, '');
      const skillMdPath = path.join(skillsDir, entry.name);
      try {
        const md = await fs.readFile(skillMdPath, 'utf-8');
        const manifest = parseSkillManifest(skillsDir, skillName, md, skillMdPath);
        skills.push({ ...manifest });
      } catch (err) {
        errors.push({ name: skillName, sourcePath: skillMdPath, error: (err as Error).message });
      }
    }
  }

  return { skills, errors };
}

export async function loadSkillModule(manifest: SkillManifest): Promise<SkillModule | undefined> {
  if (manifest.kind !== 'executable' || !manifest.entryPath) return undefined;

  try {
    const stat = await fs.stat(manifest.entryPath);
    if (!stat.isFile()) return undefined;
  } catch {
    return undefined;
  }

  try {
    const fileUrl = pathToFileURL(manifest.entryPath).href;
    const imported = await import(fileUrl);
    const mod = imported.default ?? imported;

    if (typeof mod.execute !== 'function') {
      throw new Error(`Skill module at ${manifest.entryPath} must export an "execute" function`);
    }

    return {
      execute: mod.execute as SkillExecuteFn,
      prepare: typeof mod.prepare === 'function' ? mod.prepare as SkillPrepareFn : undefined,
      verify: typeof mod.verify === 'function' ? mod.verify as SkillVerifyFn : undefined,
      rollback: typeof mod.rollback === 'function' ? mod.rollback as SkillRollbackFn : undefined,
      description: mod.description,
      parameters: mod.parameters,
      validateParams: mod.validateParams,
    };
  } catch (err) {
    throw new Error(`Failed to load skill module "${manifest.name}" from ${manifest.entryPath}: ${(err as Error).message}`);
  }
}

export async function loadAllSkillModules(skills: LoadedSkill[]): Promise<SkillLoadError[]> {
  const errors: SkillLoadError[] = [];
  for (const skill of skills) {
    if (skill.kind !== 'executable') continue;
    try {
      skill.module = await loadSkillModule(skill);
    } catch (err) {
      errors.push({ name: skill.name, sourcePath: skill.entryPath ?? skill.sourcePath, error: (err as Error).message });
    }
  }
  return errors;
}

export function skillsToDefinitions(skills: LoadedSkill[]): SkillDefinition[] {
  return skills.map((s) => ({
    name: s.name,
    description: s.description,
    body: s.body,
    allowedTools: s.allowedTools,
    sourcePath: s.sourcePath,
  }));
}

export function registerSkillsToRegistry(registry: SkillRegistry, skills: LoadedSkill[]): void {
  for (const def of skillsToDefinitions(skills)) {
    registry.register(def);
  }
}

export function buildSkillsIndexBlock(skills: LoadedSkill[]): string {
  if (skills.length === 0) return '';
  const lines = ['<available_executable_skills>'];
  lines.push('The following skills have executable handlers. Invoke them via the use_skill tool.');
  for (const s of skills) {
    if (s.kind !== 'executable') continue;
    const params = s.parameters?.map((p) => `${p.name}:${p.type}${p.required ? '' : '?'}`).join(', ') ?? '';
    lines.push(`- ${s.name}${params ? `(${params})` : ''}: ${s.description}`);
  }
  lines.push('</available_executable_skills>');
  return lines.join('\n');
}
