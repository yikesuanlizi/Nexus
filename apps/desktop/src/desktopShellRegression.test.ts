import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('desktop shell regression guard', () => {
  const readGuard = () => {
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8').replace(/\r\n/g, '\n');
    const guardStart = styles.lastIndexOf('/* Desktop shell regression guard */');
    expect(guardStart).toBeGreaterThan(-1);
    return styles.slice(guardStart);
  };

  it('does not let late workbench/file rules force white panels in dark mode', () => {
    const guard = readGuard();

    for (const selector of [
      '.appShell.theme-dark .workbenchContent',
      '.appShell.theme-dark .workbenchActivity',
      '.appShell.theme-dark .workbenchAgents',
      '.appShell.theme-dark .workbenchFiles',
      '.appShell.theme-dark .agentInspector',
      '.appShell.theme-dark .workspaceFiles',
      '.appShell.theme-dark .workspaceFileBody',
      '.appShell.theme-dark .workspaceFileTreePane',
      '.appShell.theme-dark .workspacePreviewPane',
      '.appShell.theme-dark .workspacePreview',
    ]) {
      expect(guard).toContain(selector);
    }

    expect(guard).toContain('background: #0f172a;');
    expect(guard).toContain('background: #111827;');
    expect(guard).not.toContain('background: #ffffff;');
  });

  it('restores readable dark settings surfaces after the light-theme guard', () => {
    const guard = readGuard();

    expect(guard).toContain('.settingsLayer.theme-dark');
    expect(guard).toContain('.appShell.theme-dark .settingsLayer');
    expect(guard).toContain('.settingsLayer.theme-dark .settingsDrawer');
    expect(guard).toContain('.appShell.theme-dark .settingsLayer .settingsDrawer');
    expect(guard).toContain('.settingsLayer.theme-dark .settingsDrawer input');
    expect(guard).toContain('.appShell.theme-dark .settingsLayer .settingsDrawer input');
    expect(guard).toContain('.appShell.theme-dark .settingsLayer .settingsDrawer .settingsNav button.active');
    expect(guard).toContain('.appShell.theme-dark .settingsLayer .settingsDrawer .settingsHeader .iconButton');
    expect(guard).toContain('.appShell.theme-dark .settingsDrawer');
    expect(guard).toContain('.appShell.theme-dark .settingsBody');
    expect(guard).toContain('.appShell.theme-dark .settingsNav');
    expect(guard).toContain('.appShell.theme-dark .settingsContent');
    expect(guard).toContain('.appShell.theme-dark .settingsCard');
    expect(guard).toContain('.appShell.theme-dark .settingsDrawer .dropdownMenu');
    expect(guard).toContain('.appShell.theme-dark .settingsDrawer .modelKeyStatusLine');
    expect(guard).toContain('.appShell.theme-dark .settingsDrawer .modelKeyEnvGroup');
    expect(guard).toContain('.appShell.theme-dark .settingsDrawer .settingsCardCompact');
    expect(guard).toContain('color: #e5e7eb;');
  });

  it('puts the final dark settings overrides inside the components layer so important light rules cannot win', () => {
    const guard = readGuard();

    const layeredGuardStart = guard.lastIndexOf('/* Desktop dark layered override guard');
    expect(layeredGuardStart).toBeGreaterThan(-1);
    const layeredGuard = guard.slice(layeredGuardStart);

    expect(layeredGuard).toContain('@layer components');
    expect(layeredGuard).toContain('.settingsLayer.theme-dark .settingsDrawer .settingsNav button.active');
    expect(layeredGuard).toContain('.settingsLayer.theme-dark .settingsDrawer .settingsHeader .iconButton');
    expect(layeredGuard).toContain('.settingsLayer.theme-dark .settingsDrawer .memoryAdvancedToggle');
    expect(layeredGuard).toContain('.settingsLayer.theme-dark .settingsDrawer .modelKeyStatusLine');
    expect(layeredGuard).toContain('.settingsLayer.theme-dark .settingsDrawer button:disabled:not(.solidButton):not(.dangerButton)');
    expect(layeredGuard).toContain('.appShell.theme-dark .turnFileSummary');
  });

  it('keeps touched-file summaries readable in dark chat messages', () => {
    const guard = readGuard();

    for (const selector of [
      '.appShell.theme-dark .turnFileSummary',
      '.appShell.theme-dark .turnFileSummaryRow',
      '.appShell.theme-dark .turnFileSummaryBadge',
      '.appShell.theme-dark .turnFileSummaryPath',
      '.appShell.theme-dark .turnFileSummaryPathText',
    ]) {
      expect(guard).toContain(selector);
    }

    expect(guard).toContain('background: rgba(15, 23, 42, 0.70) !important;');
    expect(guard).toContain('color: #e5e7eb !important;');
  });

  it('passes the resolved visual theme into SettingsShell instead of relying on ancestor CSS only', () => {
    const drawerSource = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const shellSource = readFileSync(join(here, 'components', 'settings', 'SettingsShell.tsx'), 'utf-8');

    expect(drawerSource).toContain('const visualThemeMode = resolveSettingsVisualThemeMode(config.themeMode);');
    expect(drawerSource).toContain('visualThemeMode={visualThemeMode}');
    expect(shellSource).toContain("visualThemeMode?: 'light' | 'dark';");
    expect(shellSource).toContain("className={`settingsLayer theme-${visualThemeMode}`}");
    expect(shellSource).toContain("className={`settingsDrawer theme-${visualThemeMode}`}");
  });

  it('uses the resolved system theme as the shell class so old theme-system light rules cannot win', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');

    expect(source).toContain('const shortcutThemeMode = resolveThemeShortcutMode(config.themeMode);');
    expect(source).toContain('`theme-${shortcutThemeMode}`');
    expect(source).toContain('`theme-source-${config.themeMode}`');
    expect(source).not.toContain('`theme-${config.themeMode}`');
  });

  it('keeps the desktop composer usable when the window is short or narrow', () => {
    const guard = readGuard();

    expect(guard).toContain('.appShell.theme-dark .composerInner');
    expect(guard).toContain('.appShell.theme-dark .commandInputRow');
    expect(guard).toContain('.appShell.theme-dark .composer textarea');
    expect(guard).toContain('@media (max-width: 900px), (max-height: 720px)');
    expect(guard).toContain('.composer {');
    expect(guard).toContain('max-height: min(46vh, 260px);');
    expect(guard).toContain('width: min(100% - 24px, 960px);');
    expect(guard).toContain('.composerBottom');
    expect(guard).toContain('grid-template-columns: minmax(0, 1fr);');
  });
});
