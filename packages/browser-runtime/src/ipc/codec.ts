// JSONL 编解码器：一行一帧、单行 JSON 无换行（sidecar stdout 纯净约束——
// 日志不得混入 stdout，否则 Host 无法按行解析）。
// — English: JSONL codec — one frame per line, single-line JSON without
//   newlines (sidecar stdout purity: no logs may pollute stdout).
// decodeLine 失败（非法 JSON / 缺字段 / 未知 action）一律返回 null：
// 不抛异常、不写日志。
// — English: decodeLine failures (invalid JSON / missing fields / unknown
//   action) always return null — no throw, no logging.
import { protocolFrameSchema } from './ipcSchemas.js';
import { IPC_VERSION } from './ipcTypes.js';
import type { IpcCodec, ProtocolFrame } from './ipcTypes.js';

// 默认帧号：fr-${sessionId}-${seq}；跨进程重放需保持原 frameId 时由调用方覆盖。
// — English: default frame id; callers may override it when replaying across
//   processes must keep the original frameId.
export function makeFrameId(sessionId: string, seq: number): string {
  return `fr-${sessionId}-${seq}`;
}

// 帧号幂等判定（at-least-once 语义）：seenFrameIds 由调用方（Sidecar）维护。
// 未见过 → 记录并返回 false；已见过 → 返回 true（丢弃重复 command）。
// — English: frame-id dedup (at-least-once) — the caller-owned set is
//   consulted and updated; first sight returns false, repeats return true.
export function isDuplicateFrame(frame: ProtocolFrame, seenFrameIds: Set<string>): boolean {
  if (seenFrameIds.has(frame.frameId)) return true;
  seenFrameIds.add(frame.frameId);
  return false;
}

export const ipcCodec: IpcCodec = {
  encode(frame) {
    // JSON.stringify 对字符串内换行会转义为 \n 字面量，输出始终为单行。
    // — English: stringified newlines are escaped, output is always one line.
    return JSON.stringify(frame);
  },

  decodeLine(line) {
    // 一行一帧：行内含换行/回车（多行输入只取第一行的约束）直接拒绝。
    // — English: one frame per line — lines containing newline/CR are rejected.
    if (line.includes('\n') || line.includes('\r')) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return null;
    }
    const result = protocolFrameSchema.safeParse(parsed);
    return result.success ? result.data : null;
  },

  makeFrame(input) {
    // 未传 frameId 时自动生成 fr-${sessionId}-${seq}；seq 由调用方维护，
    // codec 不保存任何状态。
    // — English: frameId defaults to fr-${sessionId}-${seq}; seq is maintained
    //   by the caller — the codec keeps no state.
    return {
      version: IPC_VERSION,
      frameId: input.frameId ?? makeFrameId(input.sessionId, input.seq),
      sessionId: input.sessionId,
      seq: input.seq,
      timestamp: Date.now(),
      traceId: input.traceId,
      ...(input.spanId !== undefined ? { spanId: input.spanId } : {}),
      type: input.type,
      action: input.action,
      ...(input.deadline !== undefined ? { deadline: input.deadline } : {}),
      payload: input.payload,
    };
  },
};
