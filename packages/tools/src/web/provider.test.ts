import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FirecrawlWebProvider,
  NativeFetchWebProvider,
  WebProviderRouter,
} from './provider.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

describe('NativeFetchWebProvider', () => {
  it('extracts readable text from HTML without script/style noise', async () => {
    globalThis.fetch = async () =>
      new Response(`
        <html>
          <head><title>Readable Page</title><style>.x{}</style></head>
          <body>
            <script>window.secret = true</script>
            <main><h1>Hello</h1><p>Readable <strong>content</strong>.</p></main>
          </body>
        </html>
      `, { headers: { 'content-type': 'text/html; charset=utf-8' } });

    const provider = new NativeFetchWebProvider();
    const result = await provider.openPage({ url: 'https://example.com/page' });

    expect(result.provider).toBe('native_fetch');
    expect(result.title).toBe('Readable Page');
    expect(result.text).toContain('Hello');
    expect(result.text).toContain('Readable content.');
    expect(result.text).not.toContain('window.secret');
  });

  it('blocks local and private literal hosts before fetching', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const provider = new NativeFetchWebProvider();
    await expect(provider.openPage({ url: 'http://127.0.0.1:3000/private' })).rejects.toThrow(/private or local/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('FirecrawlWebProvider', () => {
  it('scrapes pages through Firecrawl REST without requiring the SDK', async () => {
    globalThis.fetch = async (input, init) => {
      expect(String(input)).toBe('https://api.firecrawl.dev/v1/scrape');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer test-key');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        url: 'https://example.com/docs',
        formats: ['markdown'],
        onlyMainContent: true,
      });
      return Response.json({
        success: true,
        data: {
          markdown: '# Docs\nFirecrawl markdown.',
          metadata: { title: 'Docs' },
        },
      });
    };

    const provider = new FirecrawlWebProvider({ apiKey: 'test-key' });
    const result = await provider.openPage({ url: 'https://example.com/docs' });

    expect(result.provider).toBe('firecrawl');
    expect(result.title).toBe('Docs');
    expect(result.text).toContain('Firecrawl markdown.');
  });

  it('searches through Firecrawl when selected as the search provider', async () => {
    globalThis.fetch = async (input, init) => {
      expect(String(input)).toBe('https://api.firecrawl.dev/v1/search');
      expect(JSON.parse(String(init?.body))).toMatchObject({ query: 'react bits', limit: 3 });
      return Response.json({
        success: true,
        data: [
          { title: 'React Bits', url: 'https://reactbits.dev', description: 'Animated components.' },
        ],
      });
    };

    const provider = new FirecrawlWebProvider({ apiKey: 'test-key' });
    const result = await provider.search({ query: 'react bits', maxResults: 3 });

    expect(result).toEqual([
      expect.objectContaining({
        title: 'React Bits',
        url: 'https://reactbits.dev',
        snippet: 'Animated components.',
        provider: 'firecrawl',
      }),
    ]);
  });
});

describe('WebProviderRouter', () => {
  it('uses native fetch by default and keeps enhanced providers opt-in', async () => {
    globalThis.fetch = async () =>
      new Response('<html><head><title>Native</title></head><body>Native body.</body></html>', {
        headers: { 'content-type': 'text/html' },
      });

    const router = new WebProviderRouter();
    const result = await router.openPage({ url: 'https://example.com/native' });

    expect(result.provider).toBe('native_fetch');
    expect(result.text).toContain('Native body.');
  });

  it('selects Firecrawl only when explicitly configured', async () => {
    globalThis.fetch = async () =>
      Response.json({
        success: true,
        data: { markdown: 'Firecrawl body.', metadata: { title: 'Firecrawl' } },
      });

    const router = new WebProviderRouter({
      provider: 'firecrawl',
      firecrawl: { apiKey: 'test-key' },
    });
    const result = await router.openPage({ url: 'https://example.com/enhanced' });

    expect(result.provider).toBe('firecrawl');
    expect(result.text).toBe('Firecrawl body.');
  });
});
