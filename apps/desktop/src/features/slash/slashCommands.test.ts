import { describe, expect, it } from 'vitest';
import { getSlashCommandOptions, parseSlashCommand } from './slashCommands.js';

describe('parseSlashCommand', () => {
  it('parses skills and mcp add commands with natural language arguments', () => {
    expect(parseSlashCommand('/skills add 创建一个代码审查 skill')).toEqual({
      kind: 'skills.add',
      args: '创建一个代码审查 skill',
    });
    expect(parseSlashCommand('/mcp add npx @playwright/mcp@latest')).toEqual({
      kind: 'mcp.add',
      args: 'npx @playwright/mcp@latest',
    });
  });

  it('parses web search mode commands without treating normal messages as slash commands', () => {
    expect(parseSlashCommand('/web_search auto')).toEqual({
      kind: 'web_search.mode',
      mode: 'auto',
    });
    expect(parseSlashCommand(' /skills')).toEqual({ kind: 'none' });
  });

  it('parses one-shot task mode commands and compact', () => {
    expect(parseSlashCommand('/plan 重构侧栏')).toEqual({
      kind: 'task.mode',
      mode: 'plan',
      args: '重构侧栏',
    });
    expect(parseSlashCommand('/review apps/web/src/main.tsx')).toEqual({
      kind: 'task.mode',
      mode: 'review',
      args: 'apps/web/src/main.tsx',
    });
    expect(parseSlashCommand('/compact')).toEqual({ kind: 'compact' });
  });

  it('localizes slash command descriptions by selected locale', () => {
    expect(getSlashCommandOptions('en').find((option) => option.id === 'skills-add')).toMatchObject({
      title: 'Skills add',
      detail: 'Generate and install a Skill from natural language',
    });
    expect(getSlashCommandOptions('zh').find((option) => option.id === 'skills-add')).toMatchObject({
      title: 'Skills add',
      detail: '用自然语言生成并安装 Skill',
    });
    expect(getSlashCommandOptions('zh').find((option) => option.id === 'skills')).toMatchObject({
      detail: '列出并选择 Skill',
    });
    expect(getSlashCommandOptions('zh').find((option) => option.id === 'mcp')).toMatchObject({
      detail: '列出并启用 MCP',
    });
    expect(getSlashCommandOptions('zh').find((option) => option.id === 'plan')).toMatchObject({
      title: '计划',
    });
    expect(getSlashCommandOptions('en').map((option) => option.detail).join('\n')).not.toContain('打开');
  });
});
