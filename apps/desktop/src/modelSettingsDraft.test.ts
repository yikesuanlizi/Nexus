import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('model settings draft state', () => {
  it('edits model settings in a draft before applying them as the current config', () => {
    const source = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');

    expect(source).toContain('const [modelConfigDraft, setModelConfigDraft]');
    expect(source).toContain('value={modelConfigDraft.provider}');
    expect(source).toContain('value={modelConfigDraft.model}');
    expect(source).toContain('value={modelConfigDraft.baseUrl}');
    expect(source).toContain('applyModelConfigDraft');
    expect(source).not.toContain('value={config.model} onChange={(event) => setConfig({ ...config, model: event.target.value })}');
    expect(source).not.toContain('value={config.baseUrl} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })}');
  });

  it('keeps model presets inside the model page as draft loaders instead of a separate settings page', () => {
    const source = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');

    expect(source).toContain('modelPresetDraftOptions');
    expect(source).toContain('loadModelPresetIntoDraft');
    expect(source).toContain('modelPresetInlineSelect');
    expect(source).not.toContain("{ id: 'presets'");
    expect(source).not.toContain("activeSection === 'presets'");
  });

  it('lets users edit and batch set model environment variables', () => {
    const source = readFileSync(join(here, 'components', 'SettingsDrawer.tsx'), 'utf-8');

    expect(source).toContain('modelEnvVarDraft');
    expect(source).toContain('modelEnvVarOptions');
    expect(source).toContain('modelEnvBatchText');
    expect(source).toContain('/api/keys/env-vars');
    expect(source).toContain('list="model-env-var-options"');
    expect(source).toContain('setModelEnvVarRemoteOptions');
  });
});
