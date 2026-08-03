/**
 * 文件用途：锁定 Nexus Web 深色主题的基础视觉令牌，防止后续局部规则重新引入白色表面。
 * 业务归属：Web 客户端视觉系统。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

/** 读取最终 CSS 守卫，确保断言覆盖位于旧规则之后的最终优先级。 */
function readVisualContract(): string {
  const styles = readFileSync(join(here, 'styles.css'), 'utf-8').replace(/\r\n/g, '\n');
  return styles.slice(styles.lastIndexOf('/* Nexus visual contract:'));
}

describe('dark theme skin', () => {
  it('defines a dark semantic surface contract after legacy component rules', () => {
    const contract = readVisualContract();

    expect(contract).toContain('--nx-surface-canvas: #0a0e13;');
    expect(contract).toContain('--nx-surface-raised: #121820;');
    expect(contract).toContain('--nx-surface-panel: #171e27;');
    expect(contract).toContain('--nx-control-bg: #0c1218;');
    expect(contract).toContain('--nx-text-primary: #e9edf2;');
  });

  it('does not let the dark settings drawer fall back to a white surface', () => {
    const contract = readVisualContract();

    expect(contract).toContain('.appShell:not(.theme-light) .settingsDrawer');
    expect(contract).not.toContain('.appShell:not(.theme-light) .settingsDrawer {\n  background: #ffffff;');
  });
});
