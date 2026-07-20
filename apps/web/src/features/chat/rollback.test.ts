import { describe, expect, it } from 'vitest';
import { rollbackCountForTurn } from './rollback.js';

describe('rollbackCountForTurn', () => {
  it('returns the number of trailing turns that must be removed for an older user turn', () => {
    const turns = [
      { turnId: 'turn-1', userInput: 'one' },
      { turnId: 'turn-2', userInput: 'two' },
      { turnId: 'turn-3', userInput: 'three' },
      { turnId: 'turn-4', userInput: 'four' },
    ];

    expect(rollbackCountForTurn('turn-4', turns, [])).toBe(1);
    expect(rollbackCountForTurn('turn-2', turns, [])).toBe(3);
    expect(rollbackCountForTurn('turn-1', turns, [])).toBe(4);
  });

  it('falls back to ordered user message items when turn metadata is absent', () => {
    const items = [
      { id: 'u1', type: 'user_message', turnId: 'turn-1' },
      { id: 'u2', type: 'user_message', turnId: 'turn-2' },
      { id: 'u3', type: 'user_message', turnId: 'turn-3' },
    ];

    expect(rollbackCountForTurn('turn-1', [], items)).toBe(3);
  });
});
