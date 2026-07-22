import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('appearance persistence', () => {
  it('keeps theme and user avatar outside thread config without auto-saving thread config', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');

    expect(source).toContain('const { themeMode, userAvatarId, customUserAvatarDataUrl, ...threadConfig } = apiConfig;');
    expect(source).toContain('const { workspaceRoot, themeMode, userAvatarId, customUserAvatarDataUrl, ...threadConfig } = data.config;');
    expect(source).toContain('threadApiConfig');
    expect(source).not.toContain('void saveGlobalDefaults(config);');
    expect(source).not.toContain('body: JSON.stringify({ config: apiConfig }),\n      });\n    }');
    expect(source).not.toContain('config: apiConfig');
  });
});
