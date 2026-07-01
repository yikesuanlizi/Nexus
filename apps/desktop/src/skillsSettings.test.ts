import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('skills settings', () => {
  it('uses one configured skillsRoot instead of per-skill path editing', () => {
    const settingsDrawer = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const defaults = readFileSync(join(here, 'config', 'defaults.ts'), 'utf-8');
    const types = readFileSync(join(here, 'shared', 'types.ts'), 'utf-8');

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
    const types = readFileSync(join(here, 'shared', 'types.ts'), 'utf-8');

    expect(types).toContain('interface SkillEntry');
    expect(settingsDrawer).toContain('skillsList');
    expect(settingsDrawer).toContain('refreshSkills');
    expect(main).toContain("'/api/skills?forceReload=1'");
    expect(main).toContain("'/api/skills'");
    expect(settingsDrawer).toContain('refreshSkills({ forceReload: true })');
    expect(settingsDrawer).toContain("t(locale, 'refresh')");
    expect(settingsDrawer).toContain('localizedSkillDescription(skill, locale)');
    expect(settingsDrawer).not.toContain('<code>{skill.sourcePath}</code>');
  });

  it('provides a recommended plugin catalog for built-in MCP and Skills', () => {
    const settingsDrawer = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const catalog = readFileSync(join(here, 'features', 'settings', 'pluginCatalog.ts'), 'utf-8');

    expect(settingsDrawer).toContain("useState<'recommended' | 'mcp' | 'skills' | 'web'>('recommended')");
    expect(settingsDrawer).toContain('recommendedPluginCatalog');
    expect(settingsDrawer).toContain('installRecommendedSkill');
    expect(settingsDrawer).toContain('addRecommendedMcp');
    expect(catalog).toContain('recommendedSkills');
    expect(catalog).toContain('recommendedMcps');
    expect(catalog).toContain('code-review');
    expect(catalog).toContain('playwright');
    expect(catalog).toContain('filesystem');
  });

  it('lets users remove installed skills from the plugin center', () => {
    const settingsDrawer = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const main = readFileSync(join(here, 'main.tsx'), 'utf-8');

    expect(settingsDrawer).toContain('deleteSkill');
    expect(settingsDrawer).toContain('onClick={() => void deleteSkill(skill.name)}');
    expect(settingsDrawer).toContain("aria-label={t(locale, 'remove')}");
    expect(main).toContain('async function deleteSkill');
    expect(main).toContain("method: 'DELETE'");
    expect(main).toContain("`/api/skills/${encodeURIComponent(name)}`");
  });

  it('handles MCP persistence fetch failures without an uncaught promise', () => {
    const main = readFileSync(join(here, 'main.tsx'), 'utf-8');

    const mcpPersistence = main.slice(
      main.indexOf("fetch('/api/mcp'"),
      main.indexOf('}, [mcpHydrated, mcps]);'),
    );

    expect(mcpPersistence).toContain('.catch((error)');
    expect(mcpPersistence).toContain('MCP 配置保存失败');
  });

  it('keeps plugin tab layout stable and readable in light mode', () => {
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8');

    expect(styles).toMatch(/\.settingsDrawer \.pluginTabs\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
    expect(styles).toMatch(/\.settingsDrawer \.pluginPane\s*\{[^}]*min-height:\s*360px/s);
    expect(styles).toMatch(/\.settingsDrawer \.pluginInnerSection\s*\{[^}]*width:\s*100%/s);
    expect(styles).toMatch(/\.appShell\.theme-light \.settingsDrawer \.pluginCatalogItem strong[\s\S]*color:\s*#0f172a/);
    expect(styles).toMatch(/\.appShell\.theme-light \.settingsDrawer \.pluginTabs button span[\s\S]*color:\s*#0f172a/);
  });

  it('uses locale-aware skill descriptions without showing per-skill paths', () => {
    const settingsDrawer = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const descriptions = readFileSync(join(here, 'features', 'settings', 'skillDescriptions.ts'), 'utf-8');
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8');

    expect(settingsDrawer).toContain('localizedSkillDescription(skill, locale)');
    expect(descriptions).toContain('ZH_SKILL_DESCRIPTIONS');
    expect(descriptions).toContain("'frontend-design': '设计高质量、具有明确风格的前端界面。'");
    expect(styles).not.toContain('grid-cols-[minmax(0,1fr)_minmax(180px,320px)]');
  });

  it('keeps provider dropdown options focused on provider names only', () => {
    const settingsDrawer = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const providerOptions = settingsDrawer.slice(settingsDrawer.indexOf('function providerDropdownOptions'));

    expect(providerOptions).toContain('label: provider.name');
    expect(providerOptions).not.toContain('detail: provider');
    expect(providerOptions).not.toContain('apiKeyEnvVar');
    expect(providerOptions).not.toContain('baseUrl.replace');
  });

  it('marks the applied model preset in the row instead of repeating current config in the header', () => {
    const settingsDrawer = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const presetsSection = settingsDrawer.slice(
      settingsDrawer.indexOf("activeSection === 'presets'"),
      settingsDrawer.indexOf("activeSection === 'plugins'"),
    );

    expect(presetsSection).toContain('presetAppliedBadge');
    expect(presetsSection).toContain('modelPresetMatchesRunConfig');
    expect(presetsSection).not.toContain('selectedProvider?.name ?? config.provider');
    expect(presetsSection).not.toContain('saveModelPreset()');
  });
});
