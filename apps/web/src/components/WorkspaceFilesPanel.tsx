import React, { useEffect, useMemo, useState } from 'react';
import type { Locale } from '../config.js';
import { formatTimestamp } from '../i18n.js';
import type { WorkspaceFileEntry, WorkspaceFilePreview } from '../types.js';
import { Icon } from './Icon.js';

function parentPath(value: string): string {
  const parts = value.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
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

export function WorkspaceFilesPanel({
  locale,
  workspaceRoot,
}: {
  locale: Locale;
  workspaceRoot: string;
}) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<WorkspaceFileEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setCurrentPath('');
    setPreview(null);
    setFilter('');
  }, [workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void fetchJson<{ entries: WorkspaceFileEntry[] }>(`/api/workspaces/files?root=${encodeURIComponent(workspaceRoot)}&path=${encodeURIComponent(currentPath)}`)
      .then((data) => setEntries(data.entries ?? []))
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [currentPath, reloadKey, workspaceRoot]);

  const visibleEntries = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => [entry.name, entry.path, entry.extension].join('\n').toLowerCase().includes(query));
  }, [entries, filter]);

  async function openEntry(entry: WorkspaceFileEntry) {
    if (entry.kind === 'directory') {
      setCurrentPath(entry.path);
      setPreview(null);
      return;
    }
    setError('');
    setPreview(null);
    try {
      const data = await fetchJson<WorkspaceFilePreview>(`/api/workspaces/preview?root=${encodeURIComponent(workspaceRoot)}&path=${encodeURIComponent(entry.path)}`);
      setPreview(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
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
        <button type="button" className="miniIconButton" title={locale === 'zh' ? '刷新' : 'Refresh'} onClick={() => setReloadKey((value) => value + 1)}>
          <Icon name="refresh" />
        </button>
      </header>
      <label className="workspaceFileSearch">
        <Icon name="search" />
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={locale === 'zh' ? '筛选文件...' : 'Filter files...'} />
      </label>
      <div className="workspacePathLine">
        <button type="button" disabled={!currentPath} onClick={() => { setCurrentPath(parentPath(currentPath)); setPreview(null); }}>
          <Icon name="chevron" />
        </button>
        <span title={currentPath || workspaceRoot}>{currentPath || (locale === 'zh' ? '根目录' : 'Root')}</span>
      </div>
      {error ? <p className="workspaceFileError">{error}</p> : null}
      <div className="workspaceFileList" aria-busy={loading}>
        {loading ? <p>{locale === 'zh' ? '读取中...' : 'Loading...'}</p> : null}
        {!loading && visibleEntries.length === 0 ? <p>{locale === 'zh' ? '没有文件' : 'No files'}</p> : null}
        {visibleEntries.map((entry) => (
          <button key={entry.path} type="button" className={preview?.path === entry.path ? 'workspaceFileRow active' : 'workspaceFileRow'} onClick={() => void openEntry(entry)}>
            <Icon name={entry.kind === 'directory' ? 'folder' : 'file'} />
            <span>{entry.name}</span>
            <small>{entry.kind === 'directory' ? '' : formatBytes(entry.size)}</small>
          </button>
        ))}
      </div>
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
          <p>{locale === 'zh' ? '选择一个文件预览。' : 'Select a file to preview.'}</p>
        )}
      </div>
    </section>
  );
}
