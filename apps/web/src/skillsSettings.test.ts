import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('skills settings', () => {
  it('uses one configured skillsRoot instead of per-skill path editing', () => {
    const settingsDrawer = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const defaults = readFileSync(join(here, 'defaults.ts'), 'utf-8');
    const types = readFileSync(join(here, 'types.ts'), 'utf-8');

    expect(settingsDrawer).toContain('skillsRoot');
    expect(settingsDrawer).not.toContain('skillDraft');
    expect(settingsDrawer).not.toMatch(/\bsetSkills[,:}]/);
    expect(defaults).not.toContain('defaultSkills');
    expect(defaults).not.toContain('emptySkill');
    expect(types).not.toContain('interface SkillConfig');
  });

  it('saves skillsRoot only when the save button is clicked', () => {
    const settingsDrawer = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');

    expect(settingsDrawer).toContain('skillsRootDraft');
    expect(settingsDrawer).toContain('ensureSkillsRoot');
    expect(settingsDrawer).toContain("fetch('/api/settings')");
    expect(settingsDrawer).toContain('saveSkillsRoot');
    expect(settingsDrawer).toContain("t(locale, 'saveSkillsRoot')");
    expect(settingsDrawer).not.toContain('onChange={(event) => setConfig({ ...config, skillsRoot: event.target.value })}');
  });

  it('opens MCP add and edit forms in an internal panel', () => {
    const settingsDrawer = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8');

    expect(settingsDrawer).toContain('mcpPanelOpen');
    expect(settingsDrawer).toContain('mcpPanelTitle');
    expect(settingsDrawer).toContain('role="dialog"');
    expect(settingsDrawer).not.toContain('className="crudForm"');
    expect(styles).toMatch(/\.dialogLayer\s*\{\s*@apply[^;]*pointer-events-auto/);
  });

  it('renders MCP enabled state as a clickable toggle button', () => {
    const settingsDrawer = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8');

    expect(settingsDrawer).toContain('onToggleEnabled');
    expect(settingsDrawer).toContain('mcpToggle');
    expect(settingsDrawer).not.toContain('<small className={item.enabled');
    expect(styles).toMatch(/\.mcpToggle\s*\{\s*@apply[^;]*cursor-pointer/);
  });

  it('shows the installed skills list and a refresh action', () => {
    const settingsDrawer = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const main = readFileSync(join(here, 'main.tsx'), 'utf-8');
    const types = readFileSync(join(here, 'types.ts'), 'utf-8');

    expect(types).toContain('interface SkillEntry');
    expect(settingsDrawer).toContain('skillsList');
    expect(settingsDrawer).toContain('refreshSkills');
    expect(main).toContain("fetch('/api/skills')");
    expect(settingsDrawer).toContain("t(locale, 'refresh')");
    expect(settingsDrawer).toContain('localizedSkillDescription(skill, locale)');
    expect(settingsDrawer).not.toContain('<code>{skill.sourcePath}</code>');
  });

  it('uses locale-aware skill descriptions without showing per-skill paths', () => {
    const settingsDrawer = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const descriptions = readFileSync(join(here, 'skillDescriptions.ts'), 'utf-8');
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8');

    expect(settingsDrawer).toContain('localizedSkillDescription(skill, locale)');
    expect(descriptions).toContain('ZH_SKILL_DESCRIPTIONS');
    expect(descriptions).toContain("'frontend-design': '设计高质量、具有明确风格的前端界面。'");
    expect(styles).not.toContain('grid-cols-[minmax(0,1fr)_minmax(180px,320px)]');
  });
});
