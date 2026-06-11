import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, resolveConfig } from './config.js';

describe('AgentRunConfig skillsRoot', () => {
  it('defaults skillsRoot to the current user home directory', () => {
    expect(defaultConfig.skillsRoot).toBe(path.join(os.homedir(), '.nexus', 'skills'));
  });

  it('resolves configured skillsRoot to an absolute path', () => {
    expect(resolveConfig({ skillsRoot: '.nexus/skills' }).skillsRoot).toBe(
      path.resolve('.nexus/skills'),
    );
  });

  it('treats an empty stored skillsRoot as unset', () => {
    expect(resolveConfig({ skillsRoot: '' }).skillsRoot).toBe(defaultConfig.skillsRoot);
  });
});
