import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ─── AGENTS.md ──────────────────────────────────────────────────────────────
/**
 * Load project-level rules from AGENTS.md.
 * Returns the parsed content or null if not found.
 */
export async function loadAgentsMd(workspaceRoot: string): Promise<string | null> {
  const agentsPath = path.join(workspaceRoot, 'AGENTS.md');
  try {
    return await fs.readFile(agentsPath, 'utf-8');
  } catch {
    return null;
  }
}

// ─── Skills ─────────────────────────────────────────────────────────────────
export interface SkillDefinition {
  /** Skill name (e.g. "explore", "review"). */
  name: string;
  /** One-line description shown in the skills index. */
  description: string;
  /** The skill body — markdown instructions for the agent. */
  body: string;
  /** Optional tool allowlist. */
  allowedTools?: string[];
  /** Source file path. */
  sourcePath: string;
}

export interface SkillRegistry {
  /** Register a skill programmatically. */
  register(skill: SkillDefinition): void;
  /** Get a skill by name. */
  get(name: string): SkillDefinition | undefined;
  /** List all registered skills. */
  list(): SkillDefinition[];
  /** Get a formatted skills index for the system prompt. */
  toPromptText(): string;
}

export class LocalSkillRegistry implements SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();

  register(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill);
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  list(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  toPromptText(): string {
    if (this.skills.size === 0) return '';
    const lines: string[] = ['## Available Skills'];
    for (const skill of this.skills.values()) {
      lines.push(`- **${skill.name}**: ${skill.description}`);
    }
    return lines.join('\n');
  }

  /**
   * Load skills from a directory containing SKILL.md files.
   * Each subdirectory with a SKILL.md is a skill.
   */
  async loadFromDirectory(skillsDir: string): Promise<number> {
    let loaded = 0;
    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
        try {
          const body = await fs.readFile(skillMdPath, 'utf-8');
          const definition = parseSkillMd(entry.name, body, skillMdPath);
          this.register(definition);
          loaded++;
        } catch {
          // skip directories without SKILL.md
        }
      }
    } catch {
      // skills dir doesn't exist
    }
    return loaded;
  }
}

/** Parse a SKILL.md file into a SkillDefinition. */
function parseSkillMd(name: string, body: string, sourcePath: string): SkillDefinition {
  // Simple YAML frontmatter parser
  let description = '';
  let allowedTools: string[] | undefined;

  const frontmatterMatch = body.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    const content = frontmatterMatch[2];

    // Parse description
    const descMatch = frontmatter.match(/description:\s*(.+)/);
    if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '');

    // Parse allowed_tools
    const toolsMatch = frontmatter.match(/allowed_tools:\s*\[(.+?)\]/);
    if (toolsMatch) {
      allowedTools = toolsMatch[1].split(',').map((t) => t.trim().replace(/^["']|["']$/g, ''));
    }

    return { name, description, body: content.trim(), allowedTools, sourcePath };
  }

  // No frontmatter — use first line as description
  const firstLine = body.split('\n')[0].replace(/^#\s*/, '').trim();
  return { name, description: firstLine, body: body.trim(), sourcePath };
}

// ─── Hooks ──────────────────────────────────────────────────────────────────
export type HookEvent =
  | 'session_start'
  | 'session_end'
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'pre_compact'
  | 'post_compact'
  | 'turn_start'
  | 'turn_end';

export interface HookContext {
  threadId: string;
  turnId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  workspaceRoot: string;
}

export type HookHandler = (ctx: HookContext) => Promise<void> | void;

export interface HookRegistry {
  on(event: HookEvent, handler: HookHandler): void;
  trigger(event: HookEvent, ctx: HookContext): Promise<void>;
}

export class LocalHookRegistry implements HookRegistry {
  private handlers: Map<HookEvent, HookHandler[]> = new Map();

  on(event: HookEvent, handler: HookHandler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  async trigger(event: HookEvent, ctx: HookContext): Promise<void> {
    const list = this.handlers.get(event);
    if (!list) return;
    for (const handler of list) {
      await handler(ctx);
    }
  }
}
