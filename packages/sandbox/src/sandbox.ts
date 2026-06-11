// ─── Sandbox Policy Level ───────────────────────────────────────────────────
/**
 * Three sandbox levels:
 * - readonly:  Read files only, no writes, no shell, no network.
 * - workspace_write: Read + write within workspace, shell allowed but approved.
 * - full:  Full filesystem + network access (dangerous).
 */
export type SandboxLevel = 'readonly' | 'workspace_write' | 'full';

// ─── Exec Policy Rule ───────────────────────────────────────────────────────
export type ExecPolicyPatternPart =
  | string
  | string[]
  | { glob: string }
  | { regex: string };

/** Exec policy model supporting prefix, glob, and regex rules. */
export interface ExecPolicyRule {
  /** Tokens to match (first N tokens of the command). Each element can be a string or alternatives list. */
  pattern: ExecPolicyPatternPart[];
  /** Decision for this match. */
  decision: 'allow' | 'prompt' | 'forbidden';
  /** Human-readable justification. */
  justification?: string;
  /** Example commands that must match this rule (unit tests). */
  match?: (string | string[])[];
  /** Example commands that must NOT match. */
  notMatch?: (string | string[])[];
}

/** Result of evaluating a command against exec policy. */
export interface ExecPolicyResult {
  /** All rules that matched. */
  matchedRules: Array<{
    matchedPrefix: string[];
    decision: 'allow' | 'prompt' | 'forbidden';
    justification?: string;
  }>;
  /** Strictest decision across all matches (forbidden > prompt > allow). */
  decision: 'allow' | 'prompt' | 'forbidden' | null;
}

// ─── Sandbox Configuration ──────────────────────────────────────────────────
import type { PermissionPreset } from './presets.js';

export interface SandboxConfig {
  /**
   * Permission preset — the primary way to configure sandbox + approval.
   * When set, `level` and `networkAllowed` are derived from it.
   */
  preset?: PermissionPreset;
  /** Current sandbox level (derived from preset if preset is set). */
  level?: SandboxLevel;
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
  /** Additional allowed read paths. */
  allowedReadPaths?: string[];
  /** Additional allowed write paths. */
  allowedWritePaths?: string[];
  /** Exec policy rules. */
  execPolicyRules?: ExecPolicyRule[];
  /** Whether network access is allowed (derived from preset if preset is set). */
  networkAllowed?: boolean;
  /** Optional host allowlist. Supports exact hosts and leading wildcard patterns such as *.example.com. */
  networkAllowlist?: string[];
}

/** Resolve effective level + network from config (preset takes priority). */
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
export class Sandbox {
  private config: SandboxConfig;
  private effective: ReturnType<typeof resolveSandboxEffective>;

  constructor(config: SandboxConfig) {
    this.config = config;
    this.effective = resolveSandboxEffective(config);
  }

  /** Check if a file read is allowed. */
  canRead(absPath: string): boolean {
    if (this.effective.level === 'full') return true;
    if (absPath.startsWith(this.config.workspaceRoot)) return true;
    if (this.config.allowedReadPaths?.some((p) => absPath.startsWith(p))) return true;
    return false;
  }

  /** Check if a file write is allowed. */
  canWrite(absPath: string): boolean {
    if (this.effective.level === 'full') return true;
    if (this.effective.level === 'readonly') return false;
    if (absPath.startsWith(this.config.workspaceRoot)) return true;
    if (this.config.allowedWritePaths?.some((p) => absPath.startsWith(p))) return true;
    return false;
  }

  /** Check if a shell command is allowed. */
  canExec(): boolean {
    return this.effective.level !== 'readonly';
  }

  /** Check if network access is allowed. */
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
  getConfig(): SandboxConfig {
    return { ...this.config };
  }
}

// ─── Prefix matching ────────────────────────────────────────────────────────
function prefixMatches(commandTokens: string[], pattern: ExecPolicyPatternPart[]): boolean {
  if (pattern.length > commandTokens.length) return false;

  for (let i = 0; i < pattern.length; i++) {
    const pat = pattern[i];
    const cmd = commandTokens[i];
    if (Array.isArray(pat)) {
      if (!pat.includes(cmd)) return false;
    } else if (typeof pat === 'object' && 'glob' in pat) {
      if (!globMatches(cmd, pat.glob)) return false;
    } else if (typeof pat === 'object' && 'regex' in pat) {
      if (!new RegExp(pat.regex).test(cmd)) return false;
    } else {
      if (pat !== cmd) return false;
    }
  }
  return true;
}

function patternPartLabel(part: ExecPolicyPatternPart): string {
  if (Array.isArray(part)) return part[0] ?? '';
  if (typeof part === 'object' && 'glob' in part) return part.glob;
  if (typeof part === 'object' && 'regex' in part) return `/${part.regex}/`;
  return part;
}

function globMatches(value: string, glob: string): boolean {
  const normalizedValue = value.replace(/\\/g, '/').replace(/^\.\//, '');
  const normalizedGlob = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  return globToRegExp(normalizedGlob).test(normalizedValue);
}

function globToRegExp(glob: string): RegExp {
  let pattern = '^';
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    const next = glob[index + 1];
    const afterNext = glob[index + 2];
    if (char === '*' && next === '*' && afterNext === '/') {
      pattern += '(?:.*/)?';
      index += 2;
    } else if (char === '*' && next === '*') {
      pattern += '.*';
      index += 1;
    } else if (char === '*') {
      pattern += '[^/]*';
    } else if (char === '?') {
      pattern += '[^/]';
    } else {
      pattern += escapeRegExp(char);
    }
  }
  pattern += '$';
  return new RegExp(pattern);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function hostFromTarget(target: string): string | null {
  try {
    return new URL(target).hostname.toLowerCase();
  } catch {
    return target.split('/')[0]?.toLowerCase() || null;
  }
}

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
