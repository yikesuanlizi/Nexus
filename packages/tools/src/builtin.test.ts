import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyPatchTool, readFileTool, searchContentTool, webFetchTool, webSearchTool } from './builtin.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('webSearchTool', () => {
  it('formats web search results from DuckDuckGo html', async () => {
    globalThis.fetch = async () =>
      new Response(`
        <div class="result">
          <a rel="nofollow" class="result__a" href="https://example.com/page?x=1&amp;y=2">Example &amp; Result</a>
          <a class="result__snippet">A useful <b>snippet</b> about the result.</a>
        </div>
      `);

    const result = await webSearchTool.execute(
      { query: 'Nexus', maxResults: 1 },
      { workspaceRoot: process.cwd(), threadId: 'thread', turnId: 'turn', approved: false },
    );

    expect(result.status).toBe('completed');
    expect(result.output).toContain('Web search results for "Nexus"');
    expect(result.output).toContain('Example & Result');
    expect(result.output).toContain('https://example.com/page?x=1&y=2');
    expect(result.output).toContain('A useful snippet about the result.');
  });

  it('falls back to Bing when the first search source fails', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) throw new Error('first source timeout');
      return new Response(`
        <li class="b_algo">
          <h2><a href="https://bing.example/result">Bing Result</a></h2>
          <p>Bing&nbsp;snippet with <strong>details</strong>&ensp;.</p>
        </li>
      `);
    };

    const result = await webSearchTool.execute(
      { query: 'fallback search', maxResults: 1 },
      { workspaceRoot: process.cwd(), threadId: 'thread', turnId: 'turn', approved: false },
    );

    expect(result.status).toBe('completed');
    expect(result.output).toContain('Bing Result');
    expect(result.output).toContain('https://bing.example/result');
    expect(result.output).toContain('Bing snippet with details.');
  });

  it('fails clearly when query is empty', async () => {
    const result = await webSearchTool.execute(
      { action: 'search', query: '   ' },
      { workspaceRoot: process.cwd(), threadId: 'thread', turnId: 'turn', approved: false },
    );

    expect(result.status).toBe('failed');
    expect(result.error?.message).toBe('query or queries is required for action="search"');
  });

  it('opens a page through the Codex-style web_search action', async () => {
    globalThis.fetch = async () =>
      new Response(`
        <html>
          <head><title>React Bits</title></head>
          <body><h1>Animations</h1><p>Text animations include DecryptText.</p></body>
        </html>
      `, { headers: { 'content-type': 'text/html' } });

    const result = await webSearchTool.execute(
      { action: 'open_page', url: 'https://example.com/react-bits' },
      { workspaceRoot: process.cwd(), threadId: 'thread', turnId: 'turn', approved: false },
    );

    expect(result.status).toBe('completed');
    expect(result.output).toContain('Opened page: https://example.com/react-bits');
    expect(result.output).toContain('Title: React Bits');
    expect(result.output).toContain('Text animations include DecryptText.');
  });

  it('finds text in a page through the Codex-style web_search action', async () => {
    globalThis.fetch = async () =>
      new Response(`
        <html><body><p>BlurText adds blur transitions.</p><p>DecryptText reveals letters.</p></body></html>
      `, { headers: { 'content-type': 'text/html' } });

    const result = await webSearchTool.execute(
      { action: 'find_in_page', url: 'https://example.com/react-bits', pattern: 'DecryptText' },
      { workspaceRoot: process.cwd(), threadId: 'thread', turnId: 'turn', approved: false },
    );

    expect(result.status).toBe('completed');
    expect(result.output).toContain('Find in page: "DecryptText"');
    expect(result.output).toContain('DecryptText reveals letters.');
  });
});

describe('webFetchTool', () => {
  it('fetches a URL and extracts readable HTML text', async () => {
    globalThis.fetch = async () =>
      new Response(`
        <html>
          <head><title>React Bits &amp; Animations</title><style>.hidden{}</style></head>
          <body>
            <script>window.noise = true</script>
            <main>
              <h1>Text Animations</h1>
              <p>Includes <strong>DecryptText</strong> and FuzzyText.</p>
            </main>
          </body>
        </html>
      `, { headers: { 'content-type': 'text/html; charset=utf-8' } });

    const result = await webFetchTool.execute(
      { url: 'https://example.com/react-bits' },
      { workspaceRoot: process.cwd(), threadId: 'thread', turnId: 'turn', approved: false },
    );

    expect(result.status).toBe('completed');
    expect(result.output).toContain('Opened page: https://example.com/react-bits');
    expect(result.output).toContain('Title: React Bits & Animations');
    expect(result.output).toContain('Text Animations');
    expect(result.output).toContain('Includes DecryptText and FuzzyText.');
    expect(result.output).not.toContain('window.noise');
  });

  it('rejects non-http URLs', async () => {
    const result = await webFetchTool.execute(
      { url: 'file:///secret.txt' },
      { workspaceRoot: process.cwd(), threadId: 'thread', turnId: 'turn', approved: false },
    );

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('INVALID_ARGUMENTS');
  });
});

describe('readFileTool', () => {
  it('returns line metadata and file segment artifact refs for large files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-read-file-'));
    await fs.writeFile(
      path.join(root, 'large.txt'),
      Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join('\n'),
      'utf-8',
    );

    const result = await readFileTool.execute(
      { filePath: 'large.txt', offset: 10, limit: 5 },
      { workspaceRoot: root, threadId: 'thread', turnId: 'turn', approved: false },
    );

    expect(result.status).toBe('completed');
    expect(result.output).toContain('10: line 10');
    expect(result.output).not.toContain('16: line 16');
    expect(result.data).toMatchObject({
      path: expect.stringContaining('large.txt'),
      startLine: 10,
      endLine: 14,
      totalLines: 80,
      artifactRefs: [
        expect.objectContaining({
          kind: 'file_segment',
          path: expect.stringContaining('large.txt'),
          startLine: 10,
          endLine: 14,
          sha256: expect.any(String),
        }),
      ],
    });
  });
});

describe('searchContentTool', () => {
  it('returns matches with file segment artifact refs instead of only plain text', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-search-content-'));
    await fs.writeFile(
      path.join(root, 'src.ts'),
      ['alpha', 'needle one', 'middle', 'needle two', 'omega'].join('\n'),
      'utf-8',
    );

    const result = await searchContentTool.execute(
      { pattern: 'needle', path: '.', contextLines: 1 },
      { workspaceRoot: root, threadId: 'thread', turnId: 'turn', approved: false },
    );

    expect(result.status).toBe('completed');
    expect(result.output).toContain('src.ts:2: needle one');
    expect(result.data).toMatchObject({
      matches: [
        expect.objectContaining({
          line: 2,
          artifactRef: expect.objectContaining({
            kind: 'file_segment',
            startLine: 1,
            endLine: 3,
          }),
        }),
        expect.objectContaining({
          line: 4,
          artifactRef: expect.objectContaining({
            kind: 'file_segment',
            startLine: 3,
            endLine: 5,
          }),
        }),
      ],
    });
  });
});

describe('applyPatchTool', () => {
  it('applies Nexus multi-hunk update patches', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-apply-patch-'));
    await fs.writeFile(
      path.join(root, 'src.txt'),
      ['alpha', 'beta', 'gamma', 'delta'].join('\n'),
      'utf-8',
    );

    const result = await applyPatchTool.execute(
      {
        patch: [
          '*** Begin Patch',
          '*** Update File: src.txt',
          '@@',
          ' alpha',
          '-beta',
          '+beta updated',
          ' gamma',
          '@@',
          ' gamma',
          '-delta',
          '+epsilon',
          '*** End Patch',
        ].join('\n'),
      },
      { workspaceRoot: root, threadId: 'thread', turnId: 'turn', approved: true },
    );

    await expect(fs.readFile(path.join(root, 'src.txt'), 'utf-8')).resolves.toBe(
      ['alpha', 'beta updated', 'gamma', 'epsilon'].join('\n'),
    );
    expect(result.status).toBe('completed');
    expect(result.data).toMatchObject({
      changes: [
        expect.objectContaining({
          path: 'src.txt',
          kind: 'update',
          addedLines: 2,
          removedLines: 2,
        }),
      ],
    });
  });

  it('fails verification instead of silently skipping missing update context', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-apply-patch-missing-'));
    await fs.writeFile(path.join(root, 'src.txt'), 'actual\n', 'utf-8');

    const result = await applyPatchTool.execute(
      {
        patch: [
          '*** Begin Patch',
          '*** Update File: src.txt',
          '@@',
          '-missing',
          '+replacement',
          '*** End Patch',
        ].join('\n'),
      },
      { workspaceRoot: root, threadId: 'thread', turnId: 'turn', approved: true },
    );

    expect(result.status).toBe('failed');
    expect(result.error?.message).toContain('apply_patch verification failed');
    await expect(fs.readFile(path.join(root, 'src.txt'), 'utf-8')).resolves.toBe('actual\n');
  });
});
