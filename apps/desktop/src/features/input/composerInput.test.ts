import { describe, expect, it } from 'vitest';
import { extractGitHubSkillInstallUrls, extractUrlTokens, isGitHubSkillInstallUrl, summarizeUrlToken } from './composerInput.js';

describe('composerInput', () => {
  it('extracts and labels multiple urls from a single composer input', () => {
    const tokens = extractUrlTokens('看这个 https://github.com/anthropics/skills/tree/main/skills/pdf 和 https://example.com/docs');

    expect(tokens.map((token) => token.value)).toEqual([
      'https://github.com/anthropics/skills/tree/main/skills/pdf',
      'https://example.com/docs',
    ]);
    expect(tokens[0]?.label).toBe(summarizeUrlToken('https://github.com/anthropics/skills/tree/main/skills/pdf'));
    expect(tokens[1]?.label).toBe('example.com/docs');
  });

  it('only marks explicit GitHub skill paths as installable skill targets', () => {
    expect(isGitHubSkillInstallUrl('https://github.com/anthropics/skills/tree/main/skills/pdf')).toBe(true);
    expect(isGitHubSkillInstallUrl('https://github.com/acme/agent-tools/blob/main/codex/SKILL.md')).toBe(true);
    expect(isGitHubSkillInstallUrl('https://github.com/anthropics/skills')).toBe(false);
    expect(isGitHubSkillInstallUrl('https://github.com/anthropics/skills/tree/main/docs')).toBe(false);
    expect(isGitHubSkillInstallUrl('https://github.com/anthropics/skills/tree/main/skills/pdf/references')).toBe(false);
    expect(isGitHubSkillInstallUrl('https://github.com/facebook/react')).toBe(false);
    expect(isGitHubSkillInstallUrl('https://example.com/docs')).toBe(false);
  });

  it('extracts every explicit GitHub skill install target from a single command', () => {
    expect(extractGitHubSkillInstallUrls(
      '/skills add https://github.com/anthropics/skills/tree/main/skills/pdf '
      + 'https://github.com/anthropics/skills/tree/main/skills/docx 添加这两个skill',
    )).toEqual([
      'https://github.com/anthropics/skills/tree/main/skills/pdf',
      'https://github.com/anthropics/skills/tree/main/skills/docx',
    ]);
  });
});
