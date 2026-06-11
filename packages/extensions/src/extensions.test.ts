import { describe, expect, it } from 'vitest';
import { LocalSkillRegistry } from './extensions.js';

describe('LocalSkillRegistry', () => {
  it('renders skills in name order for stable prompt prefixes', () => {
    const registry = new LocalSkillRegistry();
    registry.register({
      name: 'zeta',
      description: 'Last skill.',
      body: '',
      sourcePath: 'zeta/SKILL.md',
    });
    registry.register({
      name: 'alpha',
      description: 'First skill.',
      body: '',
      sourcePath: 'alpha/SKILL.md',
    });

    expect(registry.list().map((skill) => skill.name)).toEqual(['alpha', 'zeta']);
    expect(registry.toPromptText()).toBe([
      '## Available Skills',
      '- **alpha**: First skill.',
      '- **zeta**: Last skill.',
    ].join('\n'));
  });
});
