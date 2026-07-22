import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('settings navigation', () => {
  it('switches settings pages with internal state instead of anchor scrolling', () => {
    const source = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const shell = readFileSync(join(here, 'components', 'settings', 'SettingsShell.tsx'), 'utf-8');

    // activeSection state 仍在主 SettingsDrawer 中管理
    expect(source).toContain('const [activeSection, setActiveSection]');
    // tab 切换 onClick 已迁到 SettingsShell.tsx
    expect(shell).toContain("onClick={() => setActiveSection(tab.id)}");
    expect(source).not.toContain('href="#settings-');
    expect(shell).not.toContain('href="#settings-');
  });

  it('keeps the settings layer fixed instead of sharing drawer panel layout', () => {
    const css = readFileSync(join(here, 'styles.css'), 'utf-8');

    expect(css).toMatch(/\.settingsLayer\s*\{[^}]*fixed[^}]*inset-0[^}]*z-20/s);
    expect(css).not.toMatch(/\.settingsLayer\s*,\s*\.settingsDrawer\s*\{/);
  });

  it('only exposes admin token management when deployment enables it', () => {
    const source = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const main = readFileSync(join(here, 'main.tsx'), 'utf-8');

    expect(source).toContain('showAdminControls = false');
    expect(source).toContain('...(showAdminControls ?');
    expect(source).toContain("if (activeSection === 'admin' && !showAdminControls) setActiveSection('agent')");
    expect(main).toContain("deploymentStatus?.deploymentMode === 'multi' && deploymentStatus?.authMode === 'token'");
    expect(main).toContain('showAdminControls={showAdminControls}');
  });

  it('offers built-in and custom user avatar controls in appearance settings', () => {
    const appearance = readFileSync(join(here, 'components', 'settings', 'AppearancePage.tsx'), 'utf-8');
    const avatar = readFileSync(join(here, 'components', 'UserAvatar.tsx'), 'utf-8');

    // 头像相关 UI 已迁到 AppearancePage.tsx
    expect(appearance).toContain('USER_AVATAR_OPTIONS.map');
    expect(appearance).toContain('accept="image/*"');
    expect(appearance).toContain('customUserAvatarDataUrl');
    expect(appearance).toContain('恢复默认头像');
    expect(avatar).toContain("DEFAULT_USER_AVATAR_ID: UserAvatarId = 'asteroid'");
    expect(avatar).toContain("id: 'mushroom'");
  });

  it('offers memory controls with list, delete, and export actions', () => {
    const source = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');
    const memory = readFileSync(join(here, 'components', 'settings', 'MemoryPage.tsx'), 'utf-8');
    const main = readFileSync(join(here, 'main.tsx'), 'utf-8');

    expect(source).toContain("{ id: 'memory'");
    expect(source).toContain('/api/memories/settings');
    expect(source).toContain('/api/memories/export');
    // 记录列表渲染已迁到 MemoryPage.tsx
    expect(memory).toContain('memoryRecords.map');
    expect(main).toContain('memoryExcluded');
  });
});
