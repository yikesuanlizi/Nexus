import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf-8');

describe('slash command palette layout', () => {
  it('lets the event pane fill the full right column below the topbar', () => {
    expect(styles).toContain('grid-cols-[minmax(0,1fr)_320px]');
    expect(styles).toContain('display: contents');
    expect(styles).toContain('grid-row: 2 / -1');
    expect(styles).toContain('grid-column: 1;');
    expect(styles).not.toContain('width: calc(100% - 320px)');
  });

  it('allows the palette to escape the composer and stay above the transcript', () => {
    const composer = styles.match(/\.composer\s*\{\s*@apply([^;]*);/)?.[1] ?? '';
    const palette = styles.match(/\.slashPalette\s*\{\s*@apply([^;]*);/)?.[1] ?? '';
    expect(composer).toContain('overflow-visible');
    expect(composer).toContain('z-20');
    expect(palette).toContain('z-30');
  });

  it('keeps the palette compact with internal scrolling', () => {
    const palette = styles.match(/\.slashPalette\s*\{\s*@apply([^;]*);/)?.[1] ?? '';
    const option = styles.match(/\.slashOption\s*\{\s*@apply([^;]*);/)?.[1] ?? '';
    const compact = styles.match(/\.slashOption\.compact\s*\{\s*@apply([^;]*);/)?.[1] ?? '';
    const title = styles.match(/\.slashOption strong\s*\{\s*@apply([^;]*);/)?.[1] ?? '';
    const detail = styles.match(/\.slashOption small\s*\{\s*@apply([^;]*);/)?.[1] ?? '';

    expect(palette).toContain('w-[560px]');
    expect(palette).toContain('max-h-[240px]');
    expect(palette).toContain('overflow-y-auto');
    expect(option).toContain('grid-cols-[150px_150px_minmax(0,1fr)]');
    expect(compact).toContain('grid-cols-[170px_minmax(0,1fr)]');
    expect(option).toContain('py-1');
    expect(title).toContain('text-[12px]');
    expect(detail).toContain('text-[11px]');
    expect(detail).not.toContain('col-span-2');
  });
});
