import { describe, expect, it } from 'vitest';
import { defaultMcps } from './defaults.js';

describe('default MCP config', () => {
  it('does not add a filesystem MCP placeholder by default', () => {
    expect(defaultMcps).toEqual([]);
  });
});
