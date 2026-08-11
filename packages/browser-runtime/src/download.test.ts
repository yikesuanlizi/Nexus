// 下载管理策略测试（架构文档 11.2）：文件名清洗（路径穿越/控制字符/截断）、
// 同源检查、扩展名白名单、MIME 推断与白名单、大小上限、downloadId 唯一性
// — English: download policy tests (architecture §11.2) — filename
//   sanitization (path traversal / control chars / truncation), same-origin
//   check, extension whitelist, MIME inference and whitelist, size cap,
//   downloadId uniqueness
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOWNLOAD_POLICY,
  evaluateDownload,
  normalizeDownloadName,
} from './download.js';

const SAME_ORIGIN_SPEC = {
  url: 'https://example.com/files/a.pdf',
  suggestedName: 'a.pdf',
  sourceOrigin: 'https://example.com',
  sizeBytes: 1024 * 1024, // 1MB
};

describe('normalizeDownloadName', () => {
  it("路径穿越 '../../etc/passwd' → 纯文件名，不含 / 或 ..", () => {
    // — English: path traversal '../../etc/passwd' → bare filename, no / or ..
    const name = normalizeDownloadName('../../etc/passwd');
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
    expect(name).toBe('passwd');
  });

  it("反斜杠 'a\\b\\c.txt' → 仅保留末段 'c.txt'", () => {
    // — English: backslashes 'a\\b\\c.txt' → last segment 'c.txt' only
    expect(normalizeDownloadName('a\\b\\c.txt')).toBe('c.txt');
  });

  it('控制字符（\\x00-\\x1f）被剔除', () => {
    // — English: control characters (\x00-\x1f) are stripped
    expect(normalizeDownloadName('fi\x00le\x1f.txt')).toBe('file.txt');
    expect(normalizeDownloadName('a\nb\tc.pdf')).toBe('abc.pdf');
  });

  it('超长文件名截断到 120 字符', () => {
    // — English: over-long filenames truncate to 120 chars
    const long = 'x'.repeat(200) + '.pdf';
    const name = normalizeDownloadName(long);
    expect(name.length).toBe(120);
  });

  it("空字符串与全空白 → 回退 'download.bin'", () => {
    // — English: empty / all-whitespace input falls back to 'download.bin'
    expect(normalizeDownloadName('')).toBe('download.bin');
    expect(normalizeDownloadName('   ')).toBe('download.bin');
    expect(normalizeDownloadName('..')).toBe('download.bin');
  });
});

describe('evaluateDownload', () => {
  it('同 origin + 合法扩展名 + 未超限 → allow，携带 fileName 与隔离 relativePath', () => {
    // — English: same origin + allowed extension + within cap → allow with
    //   fileName and isolated relativePath
    const verdict = evaluateDownload(SAME_ORIGIN_SPEC);
    expect(verdict.kind).toBe('allow');
    if (verdict.kind !== 'allow') return;
    expect(verdict.fileName).toContain('a.pdf');
    expect(verdict.relativePath.startsWith('downloads/')).toBe(true);
    expect(verdict.relativePath).toContain(verdict.downloadId);
    expect(verdict.relativePath.endsWith(`/${verdict.fileName}`)).toBe(true);
    expect(verdict.downloadId.startsWith('dl-')).toBe(true);
  });

  it('跨域（url 与 sourceOrigin 不同）→ deny ORIGIN_BLOCKED', () => {
    // — English: cross-origin (url origin ≠ sourceOrigin) → deny
    //   ORIGIN_BLOCKED
    const verdict = evaluateDownload({
      ...SAME_ORIGIN_SPEC,
      url: 'https://other.com/files/a.pdf',
    });
    expect(verdict).toEqual({ kind: 'deny', reason: expect.any(String), code: 'ORIGIN_BLOCKED' });
    // 拒绝信息不回显 URL 中的 userinfo 凭据
    // — English: the denial message never echoes userinfo credentials from the URL
    const withCreds = evaluateDownload({
      ...SAME_ORIGIN_SPEC,
      url: 'https://user:secret@other.com/files/a.pdf',
    });
    expect(withCreds.kind).toBe('deny');
    if (withCreds.kind === 'deny') {
      expect(withCreds.reason).not.toContain('secret');
    }
  });

  it('URL 解析失败 → deny ORIGIN_BLOCKED', () => {
    // — English: unparseable URL → deny ORIGIN_BLOCKED
    const verdict = evaluateDownload({
      ...SAME_ORIGIN_SPEC,
      url: 'not a url',
    });
    expect(verdict).toEqual({ kind: 'deny', reason: expect.any(String), code: 'ORIGIN_BLOCKED' });
  });

  it("扩展名 '.exe' 不在白名单 → deny TYPE_BLOCKED", () => {
    // — English: extension '.exe' not whitelisted → deny TYPE_BLOCKED
    const verdict = evaluateDownload({ ...SAME_ORIGIN_SPEC, suggestedName: 'installer.exe' });
    expect(verdict).toEqual({ kind: 'deny', reason: expect.any(String), code: 'TYPE_BLOCKED' });
  });

  it('sizeBytes 超过 maxBytes（1MB 上限 / 2MB 文件）→ deny SIZE_LIMIT', () => {
    // — English: sizeBytes exceeds maxBytes (1MB cap / 2MB file) → deny
    //   SIZE_LIMIT
    const verdict = evaluateDownload(
      { ...SAME_ORIGIN_SPEC, sizeBytes: 2 * 1024 * 1024 },
      { maxBytes: 1024 * 1024 },
    );
    expect(verdict).toEqual({ kind: 'deny', reason: expect.any(String), code: 'SIZE_LIMIT' });
  });

  it("MIME 'application/x-msdownload' 不在前缀白名单 → deny TYPE_BLOCKED", () => {
    // — English: MIME 'application/x-msdownload' outside prefix whitelist →
    //   deny TYPE_BLOCKED
    const verdict = evaluateDownload({
      ...SAME_ORIGIN_SPEC,
      suggestedName: 'setup',
      mimeType: 'application/x-msdownload',
    });
    expect(verdict).toEqual({ kind: 'deny', reason: expect.any(String), code: 'TYPE_BLOCKED' });
  });

  it("无扩展名 + MIME 'application/pdf' → 推断扩展名，fileName 以 '.pdf' 结尾", () => {
    // — English: no extension + MIME 'application/pdf' → extension inferred,
    //   fileName ends with '.pdf'
    const verdict = evaluateDownload({
      ...SAME_ORIGIN_SPEC,
      suggestedName: 'report',
      mimeType: 'application/pdf',
    });
    expect(verdict.kind).toBe('allow');
    if (verdict.kind !== 'allow') return;
    expect(verdict.fileName.endsWith('.pdf')).toBe(true);
    expect(verdict.fileName).toBe('report.pdf');
  });

  it("未知 MIME：allowUnknownMime=false → deny TYPE_BLOCKED；true → allow 且带 note", () => {
    // — English: unknown MIME — allowUnknownMime=false → deny TYPE_BLOCKED;
    //   true → allow with a note
    const spec = { ...SAME_ORIGIN_SPEC, suggestedName: 'report', mimeType: undefined };
    const strict = evaluateDownload(spec, { allowUnknownMime: false });
    expect(strict).toEqual({ kind: 'deny', reason: expect.any(String), code: 'TYPE_BLOCKED' });

    const lenient = evaluateDownload(spec, { allowUnknownMime: true });
    expect(lenient.kind).toBe('allow');
    if (lenient.kind !== 'allow') return;
    expect(lenient.note).toBe('extension inferred from mime');
  });

  it('默认策略 allowUnknownMime=true：未知 MIME 默认放行', () => {
    // — English: default policy allowUnknownMime=true — unknown MIME allowed
    //   by default
    expect(DEFAULT_DOWNLOAD_POLICY.allowUnknownMime).toBe(true);
    const verdict = evaluateDownload({ ...SAME_ORIGIN_SPEC, suggestedName: 'report' });
    expect(verdict.kind).toBe('allow');
  });

  it('downloadId 唯一：相同输入两次调用产生不同 downloadId', () => {
    // — English: downloadId uniqueness — two calls with identical input yield
    //   different downloadIds
    const first = evaluateDownload(SAME_ORIGIN_SPEC);
    const second = evaluateDownload(SAME_ORIGIN_SPEC);
    expect(first.kind).toBe('allow');
    expect(second.kind).toBe('allow');
    if (first.kind !== 'allow' || second.kind !== 'allow') return;
    expect(first.downloadId).not.toBe(second.downloadId);
  });
});
