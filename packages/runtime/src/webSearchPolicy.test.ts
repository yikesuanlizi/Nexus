import { describe, expect, it } from 'vitest';
import { shouldEnableWebSearch } from './webSearchPolicy.js';

describe('shouldEnableWebSearch', () => {
  it('enables search explicitly and disables it for local coding turns in auto mode', () => {
    expect(shouldEnableWebSearch('on', { type: 'text', text: '改一下按钮' })).toBe(true);
    expect(shouldEnableWebSearch('off', { type: 'text', text: '查一下今天的新闻' })).toBe(false);
    expect(shouldEnableWebSearch('auto', { type: 'text', text: '刷新网页为什么还要转圈' })).toBe(false);
  });

  it('enables auto mode only for clearly external or recent-information requests', () => {
    expect(shouldEnableWebSearch('auto', { type: 'text', text: '联网搜索 langchain 最新版本' })).toBe(true);
    expect(shouldEnableWebSearch('auto', { type: 'text', text: 'look up the latest OpenAI docs' })).toBe(true);
  });
});
