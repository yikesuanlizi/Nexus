import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('appearance persistence', () => {
  it('keeps theme and user avatar as global appearance settings outside thread config', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');

    expect(source).toContain('const { themeMode, userAvatarId, customUserAvatarDataUrl, ...threadConfig } = apiConfig;');
    expect(source).toContain('const { workspaceRoot, themeMode, userAvatarId, customUserAvatarDataUrl, ...threadConfig } = data.config;');
    expect(source).toContain('body: JSON.stringify({ config: threadApiConfig })');
    expect(source).not.toContain('body: JSON.stringify({ config: apiConfig }),\n      });\n    }');
  });
});
