import { describe, expect, it } from 'vitest';
import {
  completeLocalSkillDraftItem,
  createLocalSkillDraftItems,
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
      new URL('./main.tsx', import.meta.url),
      'utf-8',
    ));

    expect(main).toContain("fetch(`/api/threads/${activeThreadId}/skills/install`");
    expect(main).not.toContain("fetch('/api/skills/install'");
    expect(main).toContain('await refreshSkills()');
  });
});
