import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('workspace file search', () => {
  it('uses the recursive workspace search endpoint when a filter is entered', () => {
    const component = readFileSync(join(here, 'components', 'WorkspaceFilesPanel.tsx'), 'utf-8');

    expect(component).toContain('const searchQuery = filter.trim();');
    expect(component).toContain('&query=${encodeURIComponent(searchQuery)}');
    expect(component).toContain('entriesByPath?: Record<string, WorkspaceFileEntry[]>');
    expect(component).toContain("setEntriesByPath(data.entriesByPath ?? { '': data.entries ?? [] });");
    expect(component).toContain("setExpanded(new Set(data.expandedPaths ?? ['']));");
    expect(component).toContain('entryHasMatchingDescendant(entriesByPath, query, entry.path)');
    expect(component).toContain('FILE_TYPE_ALIASES[entry.extension]');
    expect(component).toContain("const searchingFiles = loadingPaths.has('__search__');");
    expect(component).toContain('workspaceSearchSpinner');
    expect(component).toContain('aria-label={locale === \'zh\' ? \'正在搜索文件\' : \'Searching files\'}');
    expect(component).toContain('}, 300);');
  });
});
