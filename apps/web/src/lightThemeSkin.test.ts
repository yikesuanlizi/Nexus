import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('light theme skin', () => {
  it('keeps the final light-theme guard after dark settings rules', () => {
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8').replace(/\r\n/g, '\n');
    const darkSettings = styles.lastIndexOf('.appShell:not(.theme-light) .settingsDrawer');
    const utilitiesLayer = styles.lastIndexOf('@layer utilities {');

    expect(darkSettings).toBeGreaterThan(-1);
    expect(utilitiesLayer).toBeGreaterThan(-1);
    expect(darkSettings).toBeGreaterThan(utilitiesLayer);
    expect(styles).toContain('.appShell.theme-light .conversationPane');
    expect(styles).toContain('.appShell.theme-light .settingsDrawer');
  });

  it('uses light surfaces and dark text for light-theme content areas', () => {
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8').replace(/\r\n/g, '\n');
    const lightGuard = styles.slice(styles.lastIndexOf('@layer utilities {'));

    expect(lightGuard).toContain('.appShell.theme-light .workflowSidePane');
    expect(lightGuard).toContain('background: #ffffff;');
    expect(lightGuard).toContain('background: #f8fafc;');
    expect(lightGuard).toContain('color: #0f172a;');
    expect(lightGuard).toContain('.appShell.theme-light .codeBlock');
    expect(lightGuard).not.toContain('background: #111318;');
    expect(lightGuard).not.toContain('background: #0f172a;');
  });

  it('keeps slash menus, settings dropdowns, and panel toggles readable in light mode', () => {
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8').replace(/\r\n/g, '\n');
    const lightGuard = styles.slice(styles.lastIndexOf('@layer utilities {'));

    expect(lightGuard).toContain('.appShell.theme-light .slashPalette');
    expect(lightGuard).toContain('.appShell.theme-light .settingsDrawer .dropdownMenu');
    expect(lightGuard).toContain('.appShell.theme-light .panelButton.active');
    expect(lightGuard).toContain('.appShell.theme-light .slashOption strong');
    expect(lightGuard).toContain('color: #0f172a;');
  });

  it('keeps composer controls and preset rows high contrast in light mode', () => {
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8').replace(/\r\n/g, '\n');
    const lightGuard = styles.slice(styles.lastIndexOf('@layer utilities {'));

    expect(lightGuard).toContain('.appShell.theme-light .composer');
    expect(lightGuard).toContain('.appShell.theme-light .commandInputRow');
    expect(lightGuard).toContain('.appShell.theme-light .modelPresetSelect .dropdownButton');
    expect(lightGuard).toContain('.appShell.theme-light .settingsDrawer .presetItem');
    expect(lightGuard).toContain('.appShell.theme-light .settingsDrawer .presetAppliedBadge');
    expect(lightGuard).toContain('.appShell.theme-light .weixinBindingButton.ok');
    expect(lightGuard).toContain('background: #dcfce7;');
    expect(lightGuard).toContain('color: #166534;');
    expect(lightGuard).toContain('border-color: #94a3b8;');
  });

  it('keeps the bottom model preset dropdown visible above the composer', () => {
    const styles = readFileSync(join(here, 'styles.css'), 'utf-8').replace(/\r\n/g, '\n');
    const utilityGuard = styles.slice(styles.lastIndexOf('@layer utilities {'));

    expect(utilityGuard).toContain('.composerMeta');
    expect(utilityGuard).toContain('overflow: visible;');
    expect(utilityGuard).toContain('.modelPresetSelect .dropdownMenu');
    expect(utilityGuard).toContain('bottom: calc(100% + 8px);');
    expect(utilityGuard).toContain('top: auto;');
    expect(utilityGuard).toContain('z-index: 90;');
    expect(utilityGuard).toContain('.modelPresetSelect .dropdownOption.current span::before');
    expect(utilityGuard).toContain('color: #15803d;');
  });
});
