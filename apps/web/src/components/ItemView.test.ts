import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ItemView, summarizeToolItem } from './ItemView.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('agent message avatars', () => {
  it('renders the Nexus robot mood avatar for assistant history and streaming turns', () => {
    const source = readFileSync(join(here, 'ItemView.tsx'), 'utf-8');

    expect(source).toContain('messageAgentAvatar');
    expect(source).toContain('<RobotMoodIcon variant={moodVariant} />');
    expect(source).toContain("text.trim() ? 'working' : 'thinking'");
  });

  it('renders the working icon inline on the active streaming output line', () => {
    const source = readFileSync(join(here, 'ItemView.tsx'), 'utf-8');
    const styles = readFileSync(join(here, '..', 'styles.css'), 'utf-8');

    expect(source).toContain('showStreamingOutputIcon');
    expect(source).toContain('function StreamingOutputIcon()');
    expect(source).toContain('streamingOutputIcon');
    expect(source).toContain('M18 62 L8 66');
    expect(source).toContain('values="84; 115; 115"');
    expect(source).toContain('from="0 82 82" to="360 82 82"');
    expect(source).toContain("item.id === streamingAgentItemId");
    expect(styles).toContain('.streamingOutputLine');
    expect(styles).toContain('grid-template-columns: 34px minmax(0, 1fr);');
  });

  it('renders user messages with the configured user avatar on the right side', () => {
    const source = readFileSync(join(here, 'ItemView.tsx'), 'utf-8');
    const styles = readFileSync(join(here, '..', 'styles.css'), 'utf-8');

    expect(source).toContain('messageUserAvatar');
    expect(source).toContain('<UserAvatar avatarId={userAvatarId} customDataUrl={customUserAvatarDataUrl} size="sm" />');
    expect(styles).toContain('.messageBlock.user > .messageUserAvatar');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) 38px;');
  });
});

describe('tool item summaries', () => {
  it('shows the searched content for search_content calls', () => {
    const summary = summarizeToolItem({
      id: 'tool-1',
      type: 'tool_call',
      toolName: 'search_content',
      arguments: { pattern: '工具调用', path: 'apps/web' },
      status: 'completed',
    }, 'zh');

    expect(summary.name).toBe('search_content');
    expect(summary.value).toBe('工具调用');
    expect(summary.meta).toBe('apps/web');
  });

  it('shows the file path for read_file calls', () => {
    const summary = summarizeToolItem({
      id: 'tool-2',
      type: 'tool_call',
      toolName: 'read_file',
      arguments: { filePath: 'apps/web/src/main.tsx', offset: 10 },
      status: 'completed',
    }, 'zh');

    expect(summary.name).toBe('read_file');
    expect(summary.value).toBe('apps/web/src/main.tsx');
    expect(summary.meta).toBe('offset 10');
  });

  it('uses the command text for command execution rows', () => {
    const summary = summarizeToolItem({
      id: 'cmd-1',
      type: 'command_execution',
      command: 'npm test',
      status: 'completed',
    }, 'zh');

    expect(summary.name).toBe('shell_command');
    expect(summary.value).toBe('npm test');
  });
});
