import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('message actions', () => {
  it('renders timestamp, copy, user rollback, and agent branch actions below chat bubbles', () => {
    const itemView = readFileSync(join(here, 'components', 'ItemView.tsx'), 'utf-8');
    const main = readFileSync(join(here, 'main.tsx'), 'utf-8');
    const icon = readFileSync(join(here, 'components', 'Icon.tsx'), 'utf-8');

    expect(itemView).toContain('messageActions');
    expect(itemView).toContain('messageTimestamp');
    expect(itemView).toContain("name=\"copy\"");
    expect(itemView).toContain("action === 'branch' ? 'branch' : 'pen'");
    expect(itemView).toContain('onBranch');
    expect(main).toContain('rollbackToTurn');
    expect(main).toContain('branchFromTurn');
    expect(icon).toContain("'pen'");
  });

  it('hides message actions for in-progress messages', () => {
    const itemView = readFileSync(join(here, 'components', 'ItemView.tsx'), 'utf-8');

    expect(itemView).toContain('showActions');
    expect(itemView).toContain("item.status !== 'in_progress'");
    expect(itemView).toContain('{showActions ? (');
  });

  it('allows assistant turn groups without final text to suppress message actions', () => {
    const itemView = readFileSync(join(here, 'components', 'ItemView.tsx'), 'utf-8');

    expect(itemView).toContain('showActionRow={Boolean(text.trim())}');
    expect(itemView).toContain('showActionRow && item.status');
  });
});
