import { describe, expect, it } from 'vitest';
import { Sandbox } from './sandbox.js';

describe('Sandbox exec policy', () => {
  it('matches glob and regex exec policy rules across command arguments', () => {
    const sandbox = new Sandbox({
      workspaceRoot: process.cwd(),
      execPolicyRules: [
        {
          pattern: ['rm', { glob: '**/dist' }],
          decision: 'forbidden',
          justification: 'do not remove build output',
        },
        {
          pattern: [{ regex: '^git$' }, { regex: '^(push|reset)$' }],
          decision: 'prompt',
        },
      ],
    });

    expect(sandbox.evaluateCommand('rm ./packages/foo/dist -rf')).toMatchObject({
      decision: 'forbidden',
    });
    expect(sandbox.evaluateCommand('git push origin main')).toMatchObject({
      decision: 'prompt',
    });
    expect(sandbox.evaluateCommand('git status')).toMatchObject({
      decision: null,
    });
  });
});

describe('Sandbox network allowlist', () => {
  it('allows only configured network hosts when network is otherwise enabled', () => {
    const sandbox = new Sandbox({
      workspaceRoot: process.cwd(),
      networkAllowed: true,
      networkAllowlist: ['api.github.com', '*.example.com'],
    });

    expect(sandbox.canNetwork('https://api.github.com/repos/example/project')).toBe(true);
    expect(sandbox.canNetwork('https://docs.example.com/page')).toBe(true);
    expect(sandbox.canNetwork('https://evil.test/page')).toBe(false);
  });
});
