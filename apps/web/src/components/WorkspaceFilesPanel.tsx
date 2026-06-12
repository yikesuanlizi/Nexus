import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '../config.js';
import { formatTimestamp } from '../i18n.js';
import type { WorkspaceFileEntry, WorkspaceFilePreview } from '../types.js';
import { Icon } from './Icon.js';

interface TreeRow {
  depth: number;
  entry: WorkspaceFileEntry;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Request failed');
  return data;
}

function flattenTree(entriesByPath: Record<string, WorkspaceFileEntry[]>, expanded: Set<string>, filter: string, parent = '', depth = 0): TreeRow[] {
  const query = filter.trim().toLowerCase();
  const rows: TreeRow[] = [];
  for (const entry of entriesByPath[parent] ?? []) {
    const haystack = `${entry.name}\n${entry.path}\n${entry.extension ?? ''}`.toLowerCase();
    const matches = !query || haystack.includes(query);
    if (matches) rows.push({ depth, entry });
    if (entry.kind === 'directory' && expanded.has(entry.path)) rows.push(...flattenTree(entriesByPath, expanded, filter, entry.path, depth + 1));
  }
  return rows;
}

export function WorkspaceFilesPanel({
  locale,
  workspaceRoot,
}: {
  locale: Locale;
  workspaceRoot: string;
}) {
  const [entriesByPath, setEntriesByPath] = useState<Record<string, WorkspaceFileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [filter, setFilter] = useState('');
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [pinned, setPinned] = useState<WorkspaceFilePreview[]>([]);
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [treeWidth, setTreeWidth] = useState(50);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEntriesByPath({});
    setExpanded(new Set(['']));
    setPreview(null);
    setPinned([]);
    setFilter('');
  }, [workspaceRoot]);

  async function loadDirectory(path = '') {
    if (!workspaceRoot) return;
    setLoadingPaths((current) => new Set(current).add(path));
    setError('');
    try {
      const data = await fetchJson<{ entries: WorkspaceFileEntry[] }>(`/api/workspaces/files?root=${encodeURIComponent(workspaceRoot)}&path=${encodeURIComponent(path)}`);
      setEntriesByPath((current) => ({ ...current, [path]: data.entries ?? [] }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoadingPaths((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
  }

  useEffect(() => {
    if (!workspaceRoot) return;
    void loadDirectory('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, workspaceRoot]);

  const rows = useMemo(() => flattenTree(entriesByPath, expanded, filter), [entriesByPath, expanded, filter]);

  async function previewFile(entry: WorkspaceFileEntry, pin = false) {
    if (entry.kind !== 'file') return;
    setError('');
    try {
      const data = await fetchJson<WorkspaceFilePreview>(`/api/workspaces/preview?root=${encodeURIComponent(workspaceRoot)}&path=${encodeURIComponent(entry.path)}`);
      setPreview(data);
      if (pin) setPinned((current) => current.some((item) => item.path === data.path) ? current : [...current, data]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function toggleDirectory(entry: WorkspaceFileEntry) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.add(entry.path);
        if (!entriesByPath[entry.path]) void loadDirectory(entry.path);
      }
      return next;
    });
  }

  function startResize(event: React.PointerEvent<HTMLButtonElement>) {
    const initialRect = bodyRef.current?.getBoundingClientRect();
    if (!initialRect) return;
    const left = initialRect.left;
    const width = initialRect.width;
    event.currentTarget.setPointerCapture(event.pointerId);
    function move(moveEvent: PointerEvent) {
      const percent = ((moveEvent.clientX - left) / width) * 100;
      setTreeWidth(Math.min(68, Math.max(32, percent)));
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  if (!workspaceRoot) {
    return (
      <section className="workspaceFiles emptyFiles">
        <h2>{locale === 'zh' ? '工作区文件' : 'Workspace Files'}</h2>
        <p>{locale === 'zh' ? '当前对话没有绑定工作区。项目对话会在这里显示文件列表。' : 'This chat has no workspace. Project chats show files here.'}</p>
      </section>
    );
  }

  return (
    <section className="workspaceFiles" aria-label={locale === 'zh' ? '工作区文件' : 'Workspace files'}>
      <header className="workspaceFilesHeader">
        <div>
          <h2>{locale === 'zh' ? '工作区文件' : 'Workspace Files'}</h2>
          <p title={workspaceRoot}>{workspaceRoot}</p>
        </div>
        <button type="button" className="miniIconButton" title={locale === 'zh' ? '刷新' : 'Refresh'} onClick={() => { setEntriesByPath({}); setExpanded(new Set([''])); setReloadKey((value) => value + 1); }}>
          <Icon name="refresh" />
        </button>
      </header>
      <div className="workspaceFileBody" ref={bodyRef} style={{ gridTemplateColumns: `${treeWidth}% 7px minmax(0,1fr)` }}>
        <section className="workspaceFileTreePane">
          <label className="workspaceFileSearch">
            <Icon name="search" />
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={locale === 'zh' ? '筛选文件...' : 'Filter files...'} />
          </label>
          {error ? <p className="workspaceFileError">{error}</p> : null}
          <div className="workspaceFileList" aria-busy={loadingPaths.size > 0}>
            {loadingPaths.has('') ? <p>{locale === 'zh' ? '读取中...' : 'Loading...'}</p> : null}
            {!loadingPaths.has('') && rows.length === 0 ? <p>{locale === 'zh' ? '没有文件' : 'No files'}</p> : null}
            {rows.map(({ depth, entry }) => {
              const opened = expanded.has(entry.path);
              return (
                <button
                  key={entry.path}
                  type="button"
                  className={preview?.path === entry.path ? 'workspaceFileRow active' : 'workspaceFileRow'}
                  onClick={() => entry.kind === 'directory' ? toggleDirectory(entry) : void previewFile(entry)}
                  onDoubleClick={() => entry.kind === 'file' ? void previewFile(entry, true) : undefined}
                  style={{ '--file-depth': depth } as React.CSSProperties}
                >
                  {entry.kind === 'directory' ? <Icon name={opened ? 'chevronDown' : 'chevronRight'} /> : <Icon name="file" />}
                  <span>{entry.name}</span>
                  <small>{entry.kind === 'directory' ? (loadingPaths.has(entry.path) ? '...' : '') : formatBytes(entry.size)}</small>
                </button>
              );
            })}
          </div>
        </section>
        <button className="workspaceFileDivider" type="button" aria-label={locale === 'zh' ? '调整文件面板宽度' : 'Resize file panes'} onPointerDown={startResize} />
        <section className="workspacePreviewPane">
          {pinned.length > 0 ? (
            <div className="workspacePreviewTabs">
              {pinned.map((file) => (
                <button className={preview?.path === file.path ? 'active' : ''} key={file.path} type="button" onClick={() => setPreview(file)} title={file.path}>
                  <span>{file.name}</span>
                  <i onClick={(event) => { event.stopPropagation(); setPinned((current) => current.filter((item) => item.path !== file.path)); if (preview?.path === file.path) setPreview(null); }}>×</i>
                </button>
              ))}
            </div>
          ) : null}
          <div className="workspacePreview">
            {preview ? (
              <>
                <div className="workspacePreviewHeader">
                  <strong title={preview.path}>{preview.name}</strong>
                  <span>{formatBytes(preview.size)} · {formatTimestamp(preview.updatedAt, locale)}</span>
                </div>
                {preview.binary ? (
                  <p>{locale === 'zh' ? '该文件不是可预览的文本文件。' : 'This file is not previewable text.'}</p>
                ) : (
                  <pre>{preview.text}{preview.truncated ? '\n\n... truncated' : ''}</pre>
                )}
              </>
            ) : (
              <p>{locale === 'zh' ? '选择一个文件预览。双击文件可固定到上方列表。' : 'Select a file to preview. Double-click to pin it above.'}</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
