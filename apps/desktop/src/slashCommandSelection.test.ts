import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('slash command selection UI', () => {
  it('selects argument-taking slash commands into a styled chip instead of executing immediately', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    const composer = readFileSync(join(here, 'components', 'ComposerBar.tsx'), 'utf-8');
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8').replace(/\r\n/g, '\n');

    expect(source).toContain('activeSlashOption');
    expect(source).toContain('selectSlashOption');
    expect(composer).toContain('commandChip');
    expect(source).toContain('activeSlashOption.command + input');
    expect(source).not.toContain("if (!text) {\n      setSettingsOpen(true);");
    expect(styles).toContain('.commandChip');
  });

  it('keeps the selected slash command inside a plain black input frame', () => {
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8').replace(/\r\n/g, '\n');
    const commandStyles = styles.slice(styles.indexOf('.commandInputRow'), styles.indexOf('.skillDraftDialog'));

    expect(commandStyles).toContain('.commandInputRow.active {\n    @apply flex');
    expect(commandStyles).toContain('border-slate-950');
    expect(commandStyles).not.toContain('grid-cols-[auto_minmax(0,1fr)]');
    expect(commandStyles).not.toContain('text-sky');
    expect(commandStyles).not.toContain('border-sky');
    expect(commandStyles).not.toContain('bg-sky');
    expect(commandStyles).not.toContain('rgba(14,165,233');
  });

  it('lists skills and MCP servers as quick actions instead of only opening settings', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    const composer = readFileSync(join(here, 'components', 'ComposerBar.tsx'), 'utf-8');

    expect(source).toContain("action: 'insert_skill'");
    expect(source).toContain('hideCommand: true as const');
    expect(composer).toContain("'hideCommand' in option && option.hideCommand ? null : <span>{option.command}</span>");
    expect(source).toContain("setInput(`$${option.skillName} `)");
    expect(source).toContain("action: 'enable_mcp'");
    expect(source).toContain('setMcps((current) => current.map((mcp) => (');
    expect(source).not.toContain("case 'skills.list':\n        setSettingsOpen(true);");
    expect(source).not.toContain("case 'mcp.list':\n        setSettingsOpen(true);");
  });
});
