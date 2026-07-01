// Node 标准库：用于读写文件系统
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ─── AGENTS.md ──────────────────────────────────────────────────────────────
/**
 * Load project-level rules from AGENTS.md.
 * Returns the parsed content or null if not found.
 */
// 加载项目级规则文件 AGENTS.md；返回内容或 null（不存在时）
export async function loadAgentsMd(workspaceRoot: string): Promise<string | null> {
  const agentsPath = path.join(workspaceRoot, 'AGENTS.md');
  try {
    return await fs.readFile(agentsPath, 'utf-8');
  } catch {
    return null;
  }
}

// ─── Skills ─────────────────────────────────────────────────────────────────
// 技能定义：描述一个完整技能的结构
export interface SkillDefinition {
  /** Skill name (e.g. "explore", "review"). */
  // 技能名称（例如 "explore"、"review"）
  name: string;
  /** One-line description shown in the skills index. */
  // 单行描述（展示在技能索引中）
  description: string;
  /** The skill body — markdown instructions for the agent. */
  // 技能主体：Markdown 格式的指令（发给模型）
  body: string;
  /** Optional tool allowlist. */
  // 可选的工具白名单：限制该技能只能使用指定工具
  allowedTools?: string[];
  /** Source file path. */
  // 源文件路径（SKILL.md 所在路径）
  sourcePath: string;
}

// 技能注册表接口：注册、查找、列出、生成提示词
export interface SkillRegistry {
  /** Register a skill programmatically. */
  // 程序化注册一个技能
  register(skill: SkillDefinition): void;
  /** Get a skill by name. */
  // 按名称获取技能定义
  get(name: string): SkillDefinition | undefined;
  /** List all registered skills. */
  // 列出所有已注册技能
  list(): SkillDefinition[];
  /** Get a formatted skills index for the system prompt. */
  // 生成可用于系统提示词的格式化技能索引文本
  toPromptText(): string;
}

// 技能引导语的固定前缀（发给模型的说明）
// A skill is a set of instructions provided through a SKILL.md source — 技能是通过 SKILL.md 源文件提供的一组指令
const SKILLS_INTRO_WITH_ABSOLUTE_PATHS =
  'A skill is a set of instructions provided through a SKILL.md source. Below is the list of skills available in this session. Each entry includes a name, description, and source file path.';
// 中文翻译：技能是通过 SKILL.md 源文件提供的一组指令。以下是本次会话可用的技能列表，每条包含名称、描述和源文件路径。

// 技能使用规则（逐条发给模型）
const SKILLS_HOW_TO_USE_WITH_ABSOLUTE_PATHS = [
  // Discovery — 发现：上方列表即本次会话可用的技能（名称 + 描述 + 源路径）
  '- Discovery: The list above is the skills available in this session (name + description + source path).',
  // Trigger rules — 触发规则：用户点名某个技能（使用 `$技能名` 或纯文本），或任务明显匹配上方技能描述时，该回合必须使用该技能。多处提到则全部使用。跨回合不携带，除非再次提到。
  "- Trigger rules: If the user names a skill (with `$SkillName` or plain text) OR the task clearly matches a skill's description shown above, you must use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.",
  // Missing/blocked — 缺失或阻塞：点名的技能不在列表中或无法读取源文件时，简短说明并用最佳回退方案继续。
  '- Missing/blocked: If a named skill is not in the list or its source cannot be read, say so briefly and continue with the best fallback.',
  // How to use a skill — 如何使用技能：先完整阅读列出的 SKILL.md 源文件再执行任务；若该文件引用了其他必需资源，先阅读必需的指令或参考文件再行动。
  '- How to use a skill: Read the listed SKILL.md source completely before taking task actions. If that file references another required resource, read the required instruction or reference file before acting on it.',
  // Progressive disclosure — 渐进式披露：仅阅读当前回合相关的技能文件，不要阅读所有已列出技能；选定技能后用其主体作任务指引。
  '- Progressive disclosure: Read only the relevant skill files for the current turn, not every listed skill. Use the skill body for task guidance after selecting it.',
  // Coordination and sequencing — 协调与排序：如多个技能适用，选择覆盖请求的最小集合并说明使用顺序。
  '- Coordination and sequencing: If multiple skills apply, choose the minimal set that covers the request and state the order you will use them.',
].join('\n');

// 本地技能注册表：内存 Map 实现，支持从目录加载 SKILL.md
export class LocalSkillRegistry implements SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();

  // 注册技能（同名覆盖）
  register(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill);
  }

  // 按名称查找（不解析别名）
  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  // 按名称排序列出所有技能（防原 Map 顺序泄露）
  list(): SkillDefinition[] {
    return [...this.skills.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // 生成发给模型的技能提示块：包含技能索引 + 使用规则
  toPromptText(): string {
    if (this.skills.size === 0) return '';
    const lines: string[] = [
      '<skills_instructions>',
      '## Skills',
      SKILLS_INTRO_WITH_ABSOLUTE_PATHS,
      '### Available skills',
    ];
    for (const skill of this.list()) {
      lines.push(`- ${skill.name}: ${skill.description} (file: ${formatSkillSourcePath(skill.sourcePath)})`);
    }
    lines.push('### How to use skills', SKILLS_HOW_TO_USE_WITH_ABSOLUTE_PATHS, '</skills_instructions>');
    return lines.join('\n');
  }

  /**
   * Load skills from a directory containing SKILL.md files.
   * Each subdirectory with a SKILL.md is a skill.
   */
  // 从目录加载技能：扫描每个子目录，若包含 SKILL.md 则解析并注册；每个包含 SKILL.md 的子目录即为一个技能
  async loadFromDirectory(skillsDir: string): Promise<number> {
    let loaded = 0;
    try {
      const entries = (await fs.readdir(skillsDir, { withFileTypes: true }))
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
        try {
          const body = await fs.readFile(skillMdPath, 'utf-8');
          const definition = parseSkillMd(entry.name, body, skillMdPath);
          this.register(definition);
          loaded++;
        } catch {
          // 跳过不含 SKILL.md 的目录
        }
      }
    } catch {
      // 技能目录不存在
    }
    return loaded;
  }
}

// 带缓存的技能注册表：按目录缓存 registry，避免重复读盘
export class LocalSkillRegistryCache {
  private readonly cache = new Map<string, LocalSkillRegistry>();

  // 加载（或从缓存返回）指定目录的 registry
  async loadFromDirectory(
    skillsDir: string,
    options: { forceReload?: boolean } = {},
  ): Promise<LocalSkillRegistry> {
    const key = path.resolve(skillsDir || '.');
    if (!options.forceReload) {
      const cached = this.cache.get(key);
      if (cached) return cloneRegistry(cached);
    }

    const registry = new LocalSkillRegistry();
    await registry.loadFromDirectory(key);
    this.cache.set(key, registry);
    return cloneRegistry(registry);
  }

  // 清除缓存：指定目录则只清除该目录，否则清全部
  clear(skillsDir?: string): void {
    if (skillsDir) {
      this.cache.delete(path.resolve(skillsDir || '.'));
      return;
    }
    this.cache.clear();
  }
}

// 深拷贝一个 registry（防缓存污染）
function cloneRegistry(source: LocalSkillRegistry): LocalSkillRegistry {
  const clone = new LocalSkillRegistry();
  for (const skill of source.list()) {
    clone.register({ ...skill, allowedTools: skill.allowedTools ? [...skill.allowedTools] : undefined });
  }
  return clone;
}

// 统一路径分隔符：Windows 反斜杠转正斜杠
function formatSkillSourcePath(sourcePath: string): string {
  return sourcePath.replace(/\\/g, '/');
}

/** Parse a SKILL.md file into a SkillDefinition. */
// 解析 SKILL.md：将文件内容解析为 SkillDefinition；支持 YAML frontmatter，回退方案以首行作为 description
function parseSkillMd(name: string, body: string, sourcePath: string): SkillDefinition {
  let description = '';
  let allowedTools: string[] | undefined;

  // 解析 YAML frontmatter
  const frontmatterMatch = body.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    const content = frontmatterMatch[2];

    // 解析 description 字段
    const descMatch = frontmatter.match(/description:\s*(.+)/);
    if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '');

    // 解析 allowed_tools 字段（逗号分隔）
    const toolsMatch = frontmatter.match(/allowed_tools:\s*\[(.+?)\]/);
    if (toolsMatch) {
      allowedTools = toolsMatch[1].split(',').map((t) => t.trim().replace(/^["']|["']$/g, ''));
    }

    return { name, description, body: content.trim(), allowedTools, sourcePath };
  }

  // 无 frontmatter：把第一行井号注释去掉作为 description
  const firstLine = body.split('\n')[0].replace(/^#\s*/, '').trim();
  return { name, description: firstLine, body: body.trim(), sourcePath };
}

// ─── Hooks ──────────────────────────────────────────────────────────────────
// Hook 事件类型：横切于 Agent 运行周期的各个生命周期节点
export type HookEvent =
  | 'session_start'    // 会话开始 — Session start
  | 'session_end'      // 会话结束 — Session end
  | 'pre_tool_use'     // 工具执行前 — Before tool use
  | 'post_tool_use'    // 工具执行后 — After tool use
  | 'pre_compact'      // 上下文压缩前 — Before context compaction
  | 'post_compact'     // 上下文压缩后 — After context compaction
  | 'turn_start'       // 回合开始 — Turn start
  | 'turn_end';        // 回合结束 — Turn end

// Hook 上下文：触发 hook 时携带的运行时信息
export interface HookContext {
  threadId: string;
  turnId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  workspaceRoot: string;
}

// Hook 处理器签名：同步或异步皆可
export type HookHandler = (ctx: HookContext) => Promise<void> | void;

// Hook 注册表接口：注册事件监听器 + 触发
export interface HookRegistry {
  on(event: HookEvent, handler: HookHandler): void;
  trigger(event: HookEvent, ctx: HookContext): Promise<void>;
}

// 本地 Hook 注册表：内存 Map 实现，同一事件可注册多个 handler
export class LocalHookRegistry implements HookRegistry {
  private handlers: Map<HookEvent, HookHandler[]> = new Map();

  // 注册一个 handler 到指定事件
  on(event: HookEvent, handler: HookHandler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  // 触发事件：按注册顺序依次调用所有 handler
  async trigger(event: HookEvent, ctx: HookContext): Promise<void> {
    const list = this.handlers.get(event);
    if (!list) return;
    for (const handler of list) {
      await handler(ctx);
    }
  }
}
