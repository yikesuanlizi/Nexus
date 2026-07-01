// ─── Sandbox Policy Level ───────────────────────────────────────────────────
/**
 * Three sandbox levels:
 * - readonly:  Read files only, no writes, no shell, no network.
 * - workspace_write: Read + write within workspace, shell allowed but approved.
 * - full:  Full filesystem + network access (dangerous).
 */
// 沙箱等级：readonly（只读）/ workspace_write（工作区可写）/ full（完全访问）
export type SandboxLevel = 'readonly' | 'workspace_write' | 'full';

// ─── Exec Policy Rule ───────────────────────────────────────────────────────
// 执行策略规则的 pattern 元素：单字符串、字符串数组、glob、regex 四种
export type ExecPolicyPatternPart =
  | string
  | { glob: string }
  | { regex: string }
  | string[];

/** Exec policy model supporting prefix, glob, and regex rules. */
// 执行策略规则：用于匹配 shell 命令并给出 allow/prompt/forbidden 决策
export interface ExecPolicyRule {
  /** Tokens to match (first N tokens of the command). Each element can be a string or alternatives list. */
  // 要匹配的前缀 token 列表，数组元素可以是字符串或备选项列表
  pattern: ExecPolicyPatternPart[];
  /** Decision for this match. */
  // 匹配后给出的决策
  decision: 'allow' | 'prompt' | 'forbidden';
  /** Human-readable justification. */
  // 人类可读的解释（可选）
  justification?: string;
  /** Example commands that must match this rule (unit tests). */
  // 必须命中此规则的示例（用于单元测试）
  match?: (string | string[])[];
  /** Example commands that must NOT match. */
  // 必须不命中此规则的示例（用于单元测试）
  notMatch?: (string | string[])[];
}

/** Result of evaluating a command against exec policy. */
// 命令执行策略评估结果
export interface ExecPolicyResult {
  /** All rules that matched. */
  // 所有命中的规则详情
  matchedRules: Array<{
    matchedPrefix: string[];
    decision: 'allow' | 'prompt' | 'forbidden';
    justification?: string;
  }>;
  /** Strictest decision across all matches (forbidden > prompt > allow). */
  // 所有命中规则里最严格的决策：forbidden > prompt > allow
  decision: 'allow' | 'prompt' | 'forbidden' | null;
}

// ─── Sandbox Configuration ──────────────────────────────────────────────────
// 引入权限预设类型
import type { PermissionPreset } from './presets.js';

// 沙箱配置：用户可声明预设 / 等级 / 工作区 / 额外白名单 / 执行策略 / 网络
export interface SandboxConfig {
  /**
   * Permission preset — the primary way to configure sandbox + approval.
   * When set, `level` and `networkAllowed` are derived from it.
   */
  // 权限预设：配置沙箱 + 审批的主要方式；设置后 level / networkAllowed 从 preset 派生
  preset?: PermissionPreset;
  /** Current sandbox level (derived from preset if preset is set). */
  // 当前沙箱等级（preset 存在时由其派生）
  level?: SandboxLevel;
  /** Absolute path to the workspace root. */
  // 工作区根目录的绝对路径
  workspaceRoot: string;
  /** Additional allowed read paths. */
  // 额外的可读路径前缀列表
  allowedReadPaths?: string[];
  /** Additional allowed write paths. */
  // 额外的可写路径前缀列表
  allowedWritePaths?: string[];
  /** Exec policy rules. */
  // shell 命令执行策略规则列表
  execPolicyRules?: ExecPolicyRule[];
  /** Whether network access is allowed (derived from preset if preset is set). */
  // 是否允许访问网络（preset 存在时由其派生）
  networkAllowed?: boolean;
  /** Optional host allowlist. Supports exact hosts and leading wildcard patterns such as *.example.com. */
  // 可选的主机白名单，支持精确主机与前缀通配（如 *.example.com）
  networkAllowlist?: string[];
}

/** Resolve effective level + network from config (preset takes priority). */
// 从配置中解析最终生效的沙箱等级与网络权限（preset 优先）
export function resolveSandboxEffective(config: SandboxConfig): {
  level: SandboxLevel;
  networkAllowed: boolean;
} {
  if (config.preset) {
    return {
      level: config.preset.sandboxLevel,
      networkAllowed: config.preset.networkAllowed,
    };
  }
  return {
    level: config.level ?? 'workspace_write',
    networkAllowed: config.networkAllowed ?? false,
  };
}

// ─── Sandbox Engine ─────────────────────────────────────────────────────────
// 沙箱引擎：对外提供 canRead / canWrite / canExec / canNetwork / evaluateCommand
export class Sandbox {
  private config: SandboxConfig;
  private effective: ReturnType<typeof resolveSandboxEffective>;

  // 构造时立刻解析最终生效配置
  constructor(config: SandboxConfig) {
    this.config = config;
    this.effective = resolveSandboxEffective(config);
  }

  /** Check if a file read is allowed. */
  // 是否允许读取指定绝对路径
  canRead(absPath: string): boolean {
    if (this.effective.level === 'full') return true;
    if (absPath.startsWith(this.config.workspaceRoot)) return true;
    if (this.config.allowedReadPaths?.some((p) => absPath.startsWith(p))) return true;
    return false;
  }

  /** Check if a file write is allowed. */
  // 是否允许写入指定绝对路径
  canWrite(absPath: string): boolean {
    if (this.effective.level === 'full') return true;
    if (this.effective.level === 'readonly') return false;
    if (absPath.startsWith(this.config.workspaceRoot)) return true;
    if (this.config.allowedWritePaths?.some((p) => absPath.startsWith(p))) return true;
    return false;
  }

  /** Check if a shell command is allowed. */
  // 是否允许执行 shell 命令
  canExec(): boolean {
    return this.effective.level !== 'readonly';
  }

  /** Check if network access is allowed. */
  // 是否允许访问指定网络目标；无目标时只判断总开关
  canNetwork(target?: string): boolean {
    const networkEnabled = this.effective.level === 'full' || this.effective.networkAllowed;
    if (!networkEnabled) return false;
    const allowlist = this.config.networkAllowlist ?? [];
    if (allowlist.length === 0 || !target) return true;
    const host = hostFromTarget(target);
    if (!host) return false;
    return allowlist.some((pattern) => hostMatches(host, pattern));
  }

  /**
   * Evaluate a shell command against exec policy rules.
   * Matches prefix tokens in order; list entries in a pattern element denote alternatives.
   */
  // 用执行策略评估一条 shell 命令，返回所有命中规则与最严格决策
  evaluateCommand(command: string): ExecPolicyResult {
    const tokens = shellSplit(command);
    const rules = this.config.execPolicyRules ?? [];
    const matchedRules: ExecPolicyResult['matchedRules'] = [];

    for (const rule of rules) {
      if (prefixMatches(tokens, rule.pattern)) {
        const matchedPrefix = rule.pattern.map(patternPartLabel);
        matchedRules.push({
          matchedPrefix,
          decision: rule.decision,
          justification: rule.justification,
        });
      }
    }

    // 聚合所有命中规则，保留最严格决策
    const decision = matchedRules.reduce<'allow' | 'prompt' | 'forbidden' | null>(
      (worst, r) => {
        if (worst === 'forbidden' || r.decision === 'forbidden') return 'forbidden';
        if (worst === 'prompt' || r.decision === 'prompt') return 'prompt';
        return 'allow';
      },
      null,
    );

    return { matchedRules, decision };
  }

  /** Get the current config. */
  // 获取当前沙箱配置的浅拷贝（防止外部修改）
  getConfig(): SandboxConfig {
    return { ...this.config };
  }
}

// ─── Prefix matching ────────────────────────────────────────────────────────
// 判断命令 token 列表是否命中 pattern：依次比较每个 pattern 元素
function prefixMatches(commandTokens: string[], pattern: ExecPolicyPatternPart[]): boolean {
  if (pattern.length > commandTokens.length) return false;

  for (let i = 0; i < pattern.length; i++) {
    const pat = pattern[i];
    const cmd = commandTokens[i];
    if (Array.isArray(pat)) {
      // 数组表示备选项，匹配其中任一即通过
      if (!pat.includes(cmd)) return false;
    } else if (typeof pat === 'object' && 'glob' in pat) {
      // glob 模式匹配
      if (!globMatches(cmd, pat.glob)) return false;
    } else if (typeof pat === 'object' && 'regex' in pat) {
      // regex 模式匹配
      if (!new RegExp(pat.regex).test(cmd)) return false;
    } else {
      // 普通字符串精确匹配
      if (pat !== cmd) return false;
    }
  }
  return true;
}

// 把 pattern 元素规整为字符串标签（用于上报 matchedPrefix）
function patternPartLabel(part: ExecPolicyPatternPart): string {
  if (Array.isArray(part)) return part[0] ?? '';
  if (typeof part === 'object' && 'glob' in part) return part.glob;
  if (typeof part === 'object' && 'regex' in part) return `/${part.regex}/`;
  return part;
}

// glob 匹配：先归一化路径分隔符与 `./`，再编译为正则
function globMatches(value: string, glob: string): boolean {
  const normalizedValue = value.replace(/\\/g, '/').replace(/^\.\//, '');
  const normalizedGlob = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  return globToRegExp(normalizedGlob).test(normalizedValue);
}

// 把 glob 字符串编译成正则：`**/` `**` `*` `?` 各自展开
function globToRegExp(glob: string): RegExp {
  let pattern = '^';
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    const next = glob[index + 1];
    const afterNext = glob[index + 2];
    if (char === '*' && next === '*' && afterNext === '/') {
      // `**/` 表示跨级目录前缀
      pattern += '(?:.*/)?';
      index += 2;
    } else if (char === '*' && next === '*') {
      // `**` 表示任意字符（含路径分隔符）
      pattern += '.*';
      index += 1;
    } else if (char === '*') {
      // `*` 表示单层内的任意字符
      pattern += '[^/]*';
    } else if (char === '?') {
      // `?` 表示单层内单字符
      pattern += '[^/]';
    } else {
      // 普通字符需要转义
      pattern += escapeRegExp(char);
    }
  }
  pattern += '$';
  return new RegExp(pattern);
}

// 正则元字符转义
function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

// 从 URL 或 host:port 字符串中提取主机名
function hostFromTarget(target: string): string | null {
  try {
    return new URL(target).hostname.toLowerCase();
  } catch {
    return target.split('/')[0]?.toLowerCase() || null;
  }
}

// 主机名与白名单条目匹配：支持 `*.example.com` 形式的通配
function hostMatches(host: string, pattern: string): boolean {
  const normalized = pattern.toLowerCase().trim();
  if (!normalized) return false;
  if (normalized.startsWith('*.')) {
    const suffix = normalized.slice(1);
    return host.endsWith(suffix) && host !== normalized.slice(2);
  }
  return host === normalized;
}

/** Naive shell split (respects quoted strings). */
// 简易 shell 切分：保留单/双引号包裹的内容
function shellSplit(cmd: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (const ch of cmd) {
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
    } else if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else {
        current += ch;
      }
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === '"') {
      inDouble = true;
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}
