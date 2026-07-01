import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('topbar actions', () => {
  it('does not render stop or fork buttons in the top-right toolbar', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    const topbar = source.match(/<header className="topbar">([\s\S]*?)<\/header>/)?.[1] ?? '';
    expect(topbar).not.toContain("title={t(config.locale, 'stop')}");
    expect(topbar).not.toContain("title={t(config.locale, 'fork')}");
    expect(topbar).not.toContain("threadAction('fork')");
  });

  it('uses a workflow draft title instead of no-conversation text while creating a workflow project', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    expect(source).toContain('workflowTitle');
    expect(source).toContain('未命名工作流项目');
    expect(source).toContain('activeThread?.title || workflowTitle || t(config.locale,');
  });
});
