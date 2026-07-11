import { describe, expect, it } from 'vitest';
import { createI18n, systemPromptKey } from './i18n.js';

describe('agent system prompt GitNexus strategy', () => {
  it('keeps built-in workspace tools primary and treats GitNexus as optional enhancement in zh prompt', () => {
    const prompt = createI18n('zh').t(systemPromptKey('zh'));

    expect(prompt).toContain('list_files/read_file/search_content');
    expect(prompt).toContain('GitNexus');
    expect(prompt).toContain('结构化增强');
    expect(prompt).toContain('gitnexus_analyze');
    expect(prompt).toContain('如果 GitNexus 不可用、未索引或失败，继续使用内置工具');
  });

  it('keeps built-in workspace tools primary and treats GitNexus as optional enhancement in en prompt', () => {
    const prompt = createI18n('en').t(systemPromptKey('en'));

    expect(prompt).toContain('list_files/read_file/search_content');
    expect(prompt).toContain('GitNexus');
    expect(prompt).toContain('structured enhancement');
    expect(prompt).toContain('gitnexus_analyze');
    expect(prompt).toContain('If GitNexus is unavailable, unindexed, or fails, continue with built-in tools');
  });
});
