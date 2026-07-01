import { describe, expect, it } from 'vitest';
import {
  completeLocalSkillDraftItem,
  createLocalSkillDraftItems,
  mergeIncomingItems,
} from './threadItems.js';

describe('local skill draft transcript items', () => {
  it('creates visible transcript items for a submitted skills add command', () => {
    const draft = createLocalSkillDraftItems('https://github.com/anthropics/skills', 'zh', '2026-06-09T08:00:00.000Z');

    expect(draft.items).toEqual([
      expect.objectContaining({
        id: expect.stringContaining('skill_draft_'),
        type: 'user_message',
        text: '/skills add https://github.com/anthropics/skills',
      }),
      expect.objectContaining({
        id: draft.statusItemId,
        type: 'tool_call',
        toolName: 'skills_add',
        status: 'in_progress',
        result: '正在读取内容并生成 Skill 草稿...',
      }),
    ]);
  });

  it('updates the local skill draft status item after draft generation finishes', () => {
    const draft = createLocalSkillDraftItems('code review', 'zh', '2026-06-09T08:00:00.000Z');

    expect(
      completeLocalSkillDraftItem(draft.items, draft.statusItemId, 'completed', '已生成 Skill 草稿：code-review'),
    ).toEqual([
      draft.items[0],
      expect.objectContaining({
        id: draft.statusItemId,
        status: 'completed',
        result: '已生成 Skill 草稿：code-review',
      }),
    ]);
  });
});

describe('skills add slash command routing', () => {
  it('uses the thread-level skill install endpoint for GitHub URLs', async () => {
    const main = await import('node:fs').then(({ readFileSync }) => readFileSync(
      new URL('../../main.tsx', import.meta.url),
      'utf-8',
    ));

    expect(main).toContain("fetch(`/api/threads/${activeThreadId}/skills/install`");
    expect(main).not.toContain("fetch('/api/skills/install'");
    expect(main).toContain('await refreshSkills()');
  });
});

describe('transcript item merging', () => {
  it('keeps the real user message before same-turn tool items when it arrives late', () => {
    const merged = mergeIncomingItems(
      [
        { id: 'pending_user', type: 'user_message', text: '问题' },
        { id: 'tool-1', type: 'context_compaction', turnId: 'turn-1', status: 'completed' },
      ] as never,
      [
        { id: 'user-1', type: 'user_message', turnId: 'turn-1', text: '问题' },
      ] as never,
    );

    expect(merged.map((item) => item.id)).toEqual(['user-1', 'tool-1']);
  });

  it('drops pending user items once persisted turn items arrive', () => {
    const merged = mergeIncomingItems(
      [
        { id: 'pending_user_1', type: 'user_message', text: '几点了', status: 'in_progress' },
      ] as never,
      [
        { id: 'agent-1', type: 'agent_message', turnId: 'turn-1', text: '现在是北京时间 10:05。' },
      ] as never,
    );

    expect(merged.map((item) => item.id)).toEqual(['agent-1']);
  });
});
