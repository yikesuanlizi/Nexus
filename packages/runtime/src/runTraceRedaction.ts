const SENSITIVE_KEY_PATTERN = /^(authorization|cookie|set-cookie|api[-_]?key|token|access[-_]?token|password|secret|env)$/i;

export interface TraceRedactionOptions {
  workspaceRoot?: string;
  maxStringBytes?: number;
  maxPayloadBytes?: number;
}

export function redactTracePayload(value: unknown, options: TraceRedactionOptions = {}): unknown {
  const seen = new WeakSet<object>();
  const maxStringBytes = options.maxStringBytes ?? 2048;
  return redactValue(value, { ...options, maxStringBytes }, seen, '');
}

function redactValue(
  value: unknown,
  options: Required<Pick<TraceRedactionOptions, 'maxStringBytes'>> & TraceRedactionOptions,
  seen: WeakSet<object>,
  key: string,
): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactString(value, options);
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return { type: 'Buffer', bytes: value.byteLength };
  }
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message, options) };
  }
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, options, seen, ''));
  }

  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    out[childKey] = redactValue(childValue, options, seen, childKey);
  }
  return out;
}

function redactString(value: string, options: Required<Pick<TraceRedactionOptions, 'maxStringBytes'>> & TraceRedactionOptions): unknown {
  const normalized = options.workspaceRoot ? redactPath(value, options.workspaceRoot) : value;
  const bytes = Buffer.byteLength(normalized, 'utf8');
  if (bytes <= options.maxStringBytes) return normalized;
  return {
    value: normalized.slice(0, options.maxStringBytes),
    truncated: true,
    originalBytes: bytes,
  };
}

function redactPath(value: string, workspaceRoot: string): string {
  const normalizedWorkspace = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const normalizedValue = value.replace(/\\/g, '/');
  if (!normalizedValue.includes('/') && !/^[A-Za-z]:/.test(normalizedValue)) return value;
  const lower = normalizedValue.toLowerCase();
  if (lower.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedValue.slice(normalizedWorkspace.length + 1);
  }
  const basename = normalizedValue.split('/').pop() || normalizedValue;
  return `${basename} [outside-workspace]`;
}
