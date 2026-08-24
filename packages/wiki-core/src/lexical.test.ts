import { describe, expect, it } from 'vitest';
import { searchWikiPages, tokenizeWikiQuery } from './lexical.js';

describe('wiki-core lexical search adapted from llm-wiki-compiler', () => {
  it('keeps query tokenization capped and whitespace based', () => {
    expect(tokenizeWikiQuery('  Restart   SERVICE ')).toEqual(['restart', 'service']);
    expect(tokenizeWikiQuery('x'.repeat(201))).toEqual(['x'.repeat(200)]);
  });

  it('requires every token and ranks title hits before body hits', () => {
    const result = searchWikiPages([
      { id: 'body', title: 'Runbook', body: 'Restart the service after approval.', sortKey: 'b' },
      { id: 'title', title: 'Restart Service', body: 'Follow the approval flow.', sortKey: 'a' },
      { id: 'partial', title: 'Restart', body: 'Approval only.', sortKey: 'c' },
    ], 'restart service');
    expect(result.results.map((item) => item.id)).toEqual(['title', 'body']);
    expect(result.results[0]?.matchedIn).toBe('title');
  });

  it('cleans inline Markdown in body snippets', () => {
    const result = searchWikiPages([
      {
        id: 'doc',
        title: 'Runbook',
        body: 'Use **restart** and [service approval](https://example.test) before continuing.',
      },
    ], 'restart approval');
    expect(result.results[0]?.snippet).not.toContain('**');
    expect(result.results[0]?.snippet).not.toContain('https://');
  });
});
