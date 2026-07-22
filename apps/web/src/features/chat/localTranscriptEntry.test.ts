import { describe, expect, it } from 'vitest';
import {
  clearThreadLocalEntries,
  createLocalEntry,
  reconcileCanonicalItems,
  removeLocalEntry,
  toCanonicalEntries,
  type TranscriptEntry,
} from './localTranscriptEntry.js';
import type { ThreadItem } from '../../shared/types.js';

function makeItem(id: string, text: string): ThreadItem {
  return { id, type: 'agent_message', text } as ThreadItem;
}

describe('localTranscriptEntry', () => {
  it('creates canonical and local entries with correct discriminator', () => {
    const item = makeItem('item-1', 'hello');
    const canonical: TranscriptEntry = { source: 'canonical', item };
    const local = createLocalEntry('corr-1', 'thread-a', item);
    expect(canonical.source).toBe('canonical');
    expect(canonical.item).toBe(item);
    expect(local.source).toBe('local');
    expect(local.correlationId).toBe('corr-1');
    expect(local.threadId).toBe('thread-a');
    expect(local.item).toBe(item);
  });

  it('reconcileCanonicalItems replaces matching local entry with canonical items', () => {
    const localItem = makeItem('local-pending', 'optimistic');
    const canonicalItem1 = makeItem('canon-1', 'first');
    const canonicalItem2 = makeItem('canon-2', 'second');
    const entries: TranscriptEntry[] = [
      { source: 'canonical', item: makeItem('existing', 'existing') },
      createLocalEntry('corr-1', 'thread-a', localItem),
    ];
    const result = reconcileCanonicalItems(entries, [canonicalItem1, canonicalItem2], 'corr-1');
    expect(result.removedCorrelationIds).toEqual(['corr-1']);
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]).toEqual({ source: 'canonical', item: makeItem('existing', 'existing') });
    expect(result.entries[1]).toEqual({ source: 'canonical', item: canonicalItem1 });
    expect(result.entries[2]).toEqual({ source: 'canonical', item: canonicalItem2 });
    const sources = result.entries.map((e) => e.source);
    expect(sources).not.toContain('local');
  });

  it('reconcileCanonicalItems keeps unrelated local entries', () => {
    const localA = createLocalEntry('corr-a', 'thread-a', makeItem('la', 'a'));
    const localB = createLocalEntry('corr-b', 'thread-a', makeItem('lb', 'b'));
    const entries: TranscriptEntry[] = [localA, localB];
    const result = reconcileCanonicalItems(entries, [makeItem('c1', 'c')], 'corr-a');
    expect(result.removedCorrelationIds).toEqual(['corr-a']);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual(localB);
    expect(result.entries[1].source).toBe('canonical');
  });

  it('removeLocalEntry removes only the matching correlation', () => {
    const localA = createLocalEntry('corr-a', 'thread-a', makeItem('la', 'a'));
    const localB = createLocalEntry('corr-b', 'thread-a', makeItem('lb', 'b'));
    const canonical: TranscriptEntry = { source: 'canonical', item: makeItem('c1', 'c') };
    const entries: TranscriptEntry[] = [localA, canonical, localB];
    const result = removeLocalEntry(entries, 'corr-a');
    expect(result).toHaveLength(2);
    expect(result).toContain(canonical);
    expect(result).toContain(localB);
    expect(result).not.toContain(localA);
  });

  it('clearThreadLocalEntries removes all local entries for the given threadId only', () => {
    const threadA_local1 = createLocalEntry('corr-a1', 'thread-a', makeItem('a1', 'a1'));
    const threadA_local2 = createLocalEntry('corr-a2', 'thread-a', makeItem('a2', 'a2'));
    const threadB_local = createLocalEntry('corr-b1', 'thread-b', makeItem('b1', 'b1'));
    const canonical: TranscriptEntry = { source: 'canonical', item: makeItem('c1', 'c') };
    const entries: TranscriptEntry[] = [threadA_local1, canonical, threadA_local2, threadB_local];
    const result = clearThreadLocalEntries(entries, 'thread-a');
    expect(result).toHaveLength(2);
    expect(result).toContain(canonical);
    expect(result).toContain(threadB_local);
    expect(result).not.toContain(threadA_local1);
    expect(result).not.toContain(threadA_local2);
  });

  it('toCanonicalEntries wraps items as canonical source', () => {
    const items = [makeItem('i1', 'one'), makeItem('i2', 'two')];
    const result = toCanonicalEntries(items);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ source: 'canonical', item: items[0] });
    expect(result[1]).toEqual({ source: 'canonical', item: items[1] });
  });

  it('does not mutate the input entries array', () => {
    const local = createLocalEntry('corr-1', 'thread-a', makeItem('l', 'l'));
    const entries: TranscriptEntry[] = [local];
    const snapshot = [...entries];
    reconcileCanonicalItems(entries, [makeItem('c', 'c')], 'corr-1');
    expect(entries).toEqual(snapshot);
    removeLocalEntry(entries, 'corr-1');
    expect(entries).toEqual(snapshot);
    clearThreadLocalEntries(entries, 'thread-a');
    expect(entries).toEqual(snapshot);
  });
});
