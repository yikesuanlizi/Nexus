import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('composer model presets', () => {
  it('exposes saved model presets as a compact selector with full hover details', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    const composer = readFileSync(join(here, 'components', 'ComposerBar.tsx'), 'utf-8');

    expect(source).toContain('modelPresets={modelPresets}');
    expect(source).toContain('applyModelPreset={applyModelPreset}');
    expect(composer).toContain('modelPresets: ModelPreset[]');
    expect(composer).toContain('applyModelPreset: (preset: ModelPreset) => void');
    expect(composer).toContain('modelPresetOptions');
    expect(composer).toContain('currentModelPresetOptions');
    expect(composer).not.toContain("group: config.locale === 'zh' ? '当前' : 'Current'");
    expect(composer).toContain('current: matchedModelPreset?.id === preset.id');
    expect(composer).toContain('modelPresetTooltip');
    expect(composer).toContain('className="modelPresetSelect"');
  });
});
