import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Locale } from '../config/config.js';
import { formatTimestamp } from '../shared/i18n.js';
import type { WorkspaceFileEntry, WorkspaceFilePreview } from '../shared/types.js';
import { Icon } from './Icon.js';
import { GitNexusPanel } from './GitNexusPanel.js';

interface TreeRow {
  depth: number;
  entry: WorkspaceFileEntry;
}

type WorkspacePreviewMode = 'rendered' | 'source';

const FILE_TYPE_ALIASES: Record<string, string> = {
  csv: 'excel spreadsheet sheet table office 表格 电子表格',
  doc: 'word document office 文档',
  docx: 'word document office 文档',
  odp: 'powerpoint presentation slides office 演示 幻灯片',
  ods: 'excel spreadsheet sheet table office 表格 电子表格',
  odt: 'word document office 文档',
  pdf: 'pdf document report paper 报告 文档',
  ppt: 'powerpoint presentation slides office 演示 幻灯片',
  pptx: 'powerpoint presentation slides office 演示 幻灯片',
  rtf: 'word document office 文档',
  xls: 'excel spreadsheet sheet table office 表格 电子表格',
  xlsx: 'excel spreadsheet sheet table office 表格 电子表格',
};

for (const extension of ['apng', 'avif', 'bmp', 'gif', 'ico', 'jpg', 'jpeg', 'png', 'svg', 'webp']) {
  FILE_TYPE_ALIASES[extension] = `image picture photo ${extension} 图片 图像 照片`;
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

function entryMatchesFilter(entry: WorkspaceFileEntry, query: string): boolean {
  if (!query) return true;
  const extension = entry.extension ? `.${entry.extension}\n${entry.extension}` : '';
  const aliases = entry.extension ? FILE_TYPE_ALIASES[entry.extension] ?? '' : '';
  return `${entry.name}\n${entry.path}\n${extension}\n${aliases}`.toLowerCase().includes(query);
}

function entryHasMatchingDescendant(entriesByPath: Record<string, WorkspaceFileEntry[]>, query: string, parent: string): boolean {
  for (const entry of entriesByPath[parent] ?? []) {
    if (entryMatchesFilter(entry, query)) return true;
    if (entry.kind === 'directory' && entryHasMatchingDescendant(entriesByPath, query, entry.path)) return true;
  }
  return false;
}

function flattenTree(entriesByPath: Record<string, WorkspaceFileEntry[]>, expanded: Set<string>, filter: string, parent = '', depth = 0): TreeRow[] {
  const query = filter.trim().toLowerCase();
  const rows: TreeRow[] = [];
  for (const entry of entriesByPath[parent] ?? []) {
    const matches = entryMatchesFilter(entry, query);
    const hasMatchingDescendant = query && entry.kind === 'directory' && entryHasMatchingDescendant(entriesByPath, query, entry.path);
    if (matches || hasMatchingDescendant) rows.push({ depth, entry });
    if (entry.kind === 'directory' && expanded.has(entry.path)) rows.push(...flattenTree(entriesByPath, expanded, filter, entry.path, depth + 1));
  }
  return rows;
}

export type WorkspaceTreeTargetKind = 'file' | 'directory';

export function workspaceRelativePathForTree(inputPath: string, workspaceRoot: string): string {
  const normalizedPath = inputPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const pathLower = normalizedPath.toLowerCase();
  const rootLower = normalizedRoot.toLowerCase();

  if (normalizedRoot && (pathLower === rootLower || pathLower.startsWith(`${rootLower}/`))) {
    return normalizedPath.slice(normalizedRoot.length).replace(/^\/+/, '');
  }

  return normalizedPath;
}

export function workspaceDirectoryChainForTarget(relativePath: string, targetKind: WorkspaceTreeTargetKind): string[] {
  const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const directoryPath = targetKind === 'directory'
    ? normalizedPath
    : normalizedPath.includes('/')
      ? normalizedPath.slice(0, normalizedPath.lastIndexOf('/'))
      : '';
  const parts = directoryPath.split('/').filter(Boolean);
  const chain = [''];

  for (let index = 1; index <= parts.length; index += 1) {
    chain.push(parts.slice(0, index).join('/'));
  }

  return chain;
}

export function workspaceFileRowTitle(entry: Pick<WorkspaceFileEntry, 'name' | 'path'>, workspaceRoot: string): string {
  const rawPath = entry.path || entry.name;
  const normalizedRoot = workspaceRoot.replace(/[\\/]+$/, '');
  if (!normalizedRoot) return rawPath;

  const normalizedRawPath = rawPath.replace(/^[\\/]+/, '');
  const rawPathForCompare = normalizedRawPath.replace(/\\/g, '/').toLowerCase();
  const rootForCompare = normalizedRoot.replace(/\\/g, '/').toLowerCase();
  if (rawPathForCompare === rootForCompare || rawPathForCompare.startsWith(`${rootForCompare}/`)) {
    return normalizedRawPath;
  }

  const separator = normalizedRoot.includes('\\') ? '\\' : '/';
  return `${normalizedRoot}${separator}${normalizedRawPath.replace(/[\\/]/g, separator)}`;
}

export function workspacePreviewCopyPath(preview: Pick<WorkspaceFilePreview, 'name' | 'path'>, workspaceRoot: string): string {
  return workspaceFileRowTitle(preview, workspaceRoot);
}

export function workspacePreviewBreadcrumb(preview: Pick<WorkspaceFilePreview, 'name' | 'path'>, workspaceRoot: string): string {
  const normalizedRoot = workspaceRoot.replace(/[\\/]+$/, '');
  const rootName = normalizedRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? normalizedRoot;
  const relativePath = workspaceRelativePathForTree(preview.path || preview.name, workspaceRoot);
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  return [rootName, ...parts].filter(Boolean).join(' > ');
}

export function workspacePreviewTabsForDisplay<T extends Pick<WorkspaceFilePreview, 'path'>>(preview: T | null, pinned: T[], transientPreview: T | null = preview): T[] {
  const transient = transientPreview ?? (preview && !pinned.some((file) => file.path === preview.path) ? preview : null);
  if (!transient || pinned.some((file) => file.path === transient.path)) return pinned;
  return [transient, ...pinned];
}

export function workspaceHtmlPreviewDocument(html: string): string {
  const previewStyle = `<style data-nexus-preview-style>
html,
body {
  box-sizing: border-box !important;
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  margin: 0 !important;
  overflow: auto !important;
  background: #ffffff !important;
  color: #0f172a !important;
}
*,
*::before,
*::after {
  box-sizing: border-box !important;
  max-width: 100% !important;
}
img,
video,
canvas,
svg,
iframe {
  max-width: 100% !important;
}
table,
pre,
code {
  max-width: 100% !important;
  overflow: auto !important;
  white-space: pre-wrap !important;
  word-break: break-word !important;
}
</style>`;

  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${previewStyle}</head>`);
  if (/<html\b/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${previewStyle}</head>`);
  return `<!doctype html><html><head>${previewStyle}</head><body>${html}</body></html>`;
}

function workspaceSupportsDualPreview(preview: WorkspaceFilePreview): boolean {
  return preview.previewType === 'markdown' || preview.previewType === 'html';
}

function workspaceDefaultPreviewMode(preview: WorkspaceFilePreview): WorkspacePreviewMode {
  return workspaceSupportsDualPreview(preview) ? 'rendered' : 'source';
}

function renderSourcePreview(preview: WorkspaceFilePreview, text: string): React.ReactNode {
  return <pre className="workspaceSourcePreview">{text}{preview.truncated ? '\n\n... truncated' : ''}</pre>;
}

function renderPreviewContent(preview: WorkspaceFilePreview, locale: Locale, previewMode: WorkspacePreviewMode): React.ReactNode {
  if (preview.previewType === 'image' && preview.rawUrl) {
    return (
      <div className="workspaceImagePreview">
        <img src={preview.rawUrl} alt={preview.name} />
      </div>
    );
  }

  if (preview.previewType === 'pdf' && preview.rawUrl) {
    return <iframe className="workspacePdfPreview" src={preview.rawUrl} title={preview.name} />;
  }

  if (preview.previewType === 'markdown') {
    if (previewMode === 'source') return renderSourcePreview(preview, preview.text);
    return (
      <div className="workspaceMarkdownPreview workspaceRenderedPreview">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{`${preview.text}${preview.truncated ? '\n\n... truncated' : ''}`}</ReactMarkdown>
      </div>
    );
  }

  if (preview.previewType === 'html') {
    if (previewMode === 'source') return renderSourcePreview(preview, preview.text);
    return <iframe className="workspaceHtmlPreview workspaceRenderedPreview" sandbox="" srcDoc={workspaceHtmlPreviewDocument(preview.text)} title={`${preview.name} rendered preview`} />;
  }

  if (preview.previewType === 'office') {
    return (
      <pre className="workspaceOfficePreview workspaceSourcePreview">
        {preview.text || (locale === 'zh' ? '未能抽取可预览文本。' : 'No previewable text extracted.')}
      </pre>
    );
  }

  if (preview.binary) {
    return <p>{locale === 'zh' ? '该文件不是可预览的文本文件。' : 'This file is not previewable text.'}</p>;
  }

  return renderSourcePreview(preview, preview.text);
}

export interface ExternalPreviewRequest {
  path: string;
  pin?: boolean;
  /** 用于触发同一文件的重复请求 — 每次自增的序号 */
  // — Chinese: used to trigger repeated requests for the same file — an incrementing sequence
  nonce?: number;
}

export function WorkspaceFilesPanel({
  locale,
  workspaceRoot,
  externalPreviewRequest,
}: {
  locale: Locale;
  workspaceRoot: string;
  /** 外部预览请求 — 从对话条目点击"预览"时传入，自动加载该文件 */
  // — Chinese: external preview request — passed in when clicking "preview" from a chat item
  externalPreviewRequest?: ExternalPreviewRequest | null;
}) {
  const [entriesByPath, setEntriesByPath] = useState<Record<string, WorkspaceFileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [filter, setFilter] = useState('');
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [previewMode, setPreviewMode] = useState<WorkspacePreviewMode>('source');
  const [transientPreview, setTransientPreview] = useState<WorkspaceFilePreview | null>(null);
  const [copiedPreviewPath, setCopiedPreviewPath] = useState('');
  const [pinned, setPinned] = useState<WorkspaceFilePreview[]>([]);
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [gitnexusOpen, setGitnexusOpen] = useState(false);
  const [gitnexusSelectedPath, setGitnexusSelectedPath] = useState('');
  const [revealedPath, setRevealedPath] = useState<{ path: string; nonce: number } | null>(null);
  const [spotlightPath, setSpotlightPath] = useState('');
  // 文件树宽度百分比从 localStorage 读取，默认 28% 让预览框更宽（约 2.5 倍）
  // — English: tree width % from localStorage, default 28% for wider preview (~2.5x)
  const [treeWidth, setTreeWidth] = useState(() => {
    const stored = Number(localStorage.getItem('nexus.fileTreeWidth') ?? 0);
    return stored >= 15 && stored <= 60 ? stored : 28;
  });
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const revealNonceRef = useRef(0);
  const copyPreviewPathTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setEntriesByPath({});
    setExpanded(new Set(['']));
    setPreview(null);
    setPreviewMode('source');
    setTransientPreview(null);
    setCopiedPreviewPath('');
    setPinned([]);
    setFilter('');
    setRevealedPath(null);
    setSpotlightPath('');
    fileRowRefs.current = {};
  }, [workspaceRoot]);

  useEffect(() => () => {
    if (copyPreviewPathTimerRef.current) window.clearTimeout(copyPreviewPathTimerRef.current);
  }, []);

  // 中文注释：响应外部预览请求 — 从对话条目点击"预览"时自动加载该文件或目录
  // 若路径是目录则展开目录树，是文件则预览内容
  // — Chinese: respond to external preview request — auto-load file or expand directory
  useEffect(() => {
    if (!externalPreviewRequest?.path || !workspaceRoot) return;
    const requestPath = externalPreviewRequest.path;
    setFilter('');

    void (async () => {
      try {
        // 先尝试当作文件预览 — English: try as file preview first
        const data = await fetchJson<WorkspaceFilePreview>(`/api/workspaces/preview?root=${encodeURIComponent(workspaceRoot)}&path=${encodeURIComponent(requestPath)}`);
        setPreview(data);
        setPreviewMode(workspaceDefaultPreviewMode(data));
        if (externalPreviewRequest.pin) {
          setPinned((current) => current.some((item) => item.path === data.path) ? current : [...current, data]);
          setTransientPreview((current) => current?.path === data.path ? null : current);
        } else {
          setTransientPreview(data);
        }
        const relPath = workspaceRelativePathForTree(data.path, workspaceRoot);
        await loadDirectoryChainForTarget(relPath, 'file');
        setRevealedPath({ path: relPath, nonce: revealNonceRef.current += 1 });
        setError('');
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        // 路径是目录：fallback 到加载目录并展开 — English: path is a directory: fallback to loading and expanding it
        if (message.includes('not a file') || message.includes('is a directory')) {
          try {
            const relPath = workspaceRelativePathForTree(requestPath, workspaceRoot);
            await loadDirectoryChainForTarget(relPath, 'directory');
            setPreview(null);
            setTransientPreview(null);
            setRevealedPath({ path: relPath, nonce: revealNonceRef.current += 1 });
            setError('');
          } catch (dirError) {
            setError(dirError instanceof Error ? dirError.message : String(dirError));
          }
        } else {
          setError(message);
        }
      }
    })();
  }, [externalPreviewRequest?.nonce, externalPreviewRequest?.path, externalPreviewRequest?.pin, workspaceRoot]);

  async function fetchDirectory(path = ''): Promise<WorkspaceFileEntry[]> {
    const data = await fetchJson<{ entries: WorkspaceFileEntry[] }>(`/api/workspaces/files?root=${encodeURIComponent(workspaceRoot)}&path=${encodeURIComponent(path)}`);
    return data.entries ?? [];
  }

  async function loadDirectoryChainForTarget(relativePath: string, targetKind: WorkspaceTreeTargetKind) {
    if (!workspaceRoot) return;
    const chain = workspaceDirectoryChainForTarget(relativePath, targetKind);
    setLoadingPaths((current) => {
      const next = new Set(current);
      for (const path of chain) next.add(path);
      return next;
    });
    setError('');
    try {
      const loadedDirectories = await Promise.all(chain.map(async (path) => ({
        path,
        entries: await fetchDirectory(path),
      })));
      setEntriesByPath((current) => {
        const next = { ...current };
        for (const directory of loadedDirectories) {
          next[directory.path] = directory.entries;
        }
        return next;
      });
      setExpanded((current) => {
        const next = new Set(current);
        for (const path of chain) next.add(path);
        return next;
      });
    } finally {
      setLoadingPaths((current) => {
        const next = new Set(current);
        for (const path of chain) next.delete(path);
        return next;
      });
    }
  }

  async function loadDirectory(path = '') {
    if (!workspaceRoot) return;
    setLoadingPaths((current) => new Set(current).add(path));
    setError('');
    try {
      const entries = await fetchDirectory(path);
      setEntriesByPath((current) => ({ ...current, [path]: entries }));
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
    if (filter.trim()) return;
    void loadDirectory('');
  }, [filter, reloadKey, workspaceRoot]);

  useEffect(() => {
    const searchQuery = filter.trim();
    if (!workspaceRoot || !searchQuery) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setLoadingPaths((current) => new Set(current).add('__search__'));
      setError('');
      void fetchJson<{ entries: WorkspaceFileEntry[]; entriesByPath?: Record<string, WorkspaceFileEntry[]>; expandedPaths?: string[] }>(`/api/workspaces/files?root=${encodeURIComponent(workspaceRoot)}&query=${encodeURIComponent(searchQuery)}`)
        .then((data) => {
          if (cancelled) return;
          setEntriesByPath(data.entriesByPath ?? { '': data.entries ?? [] });
          setExpanded(new Set(data.expandedPaths ?? ['']));
        })
        .catch((caught) => {
          if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
        })
        .finally(() => {
          if (cancelled) return;
          setLoadingPaths((current) => {
            const next = new Set(current);
            next.delete('__search__');
            return next;
          });
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      setLoadingPaths((current) => {
        const next = new Set(current);
        next.delete('__search__');
        return next;
      });
    };
  }, [filter, workspaceRoot]);

  const rows = useMemo(() => flattenTree(entriesByPath, expanded, filter), [entriesByPath, expanded, filter]);
  const searchingFiles = loadingPaths.has('__search__');
  const activePreviewPath = preview ? workspaceRelativePathForTree(preview.path, workspaceRoot) : '';
  const displayedPreviewTabs = useMemo(() => workspacePreviewTabsForDisplay(preview, pinned, transientPreview), [preview, pinned, transientPreview]);

  useEffect(() => {
    if (!revealedPath?.path) return;
    const target = fileRowRefs.current[revealedPath.path];
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setSpotlightPath('');
    let clearSpotlightTimer: number | undefined;
    const animationFrame = window.requestAnimationFrame(() => {
      setSpotlightPath(revealedPath.path);
      clearSpotlightTimer = window.setTimeout(() => {
        setSpotlightPath((current) => current === revealedPath.path ? '' : current);
      }, 2400);
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      if (clearSpotlightTimer) window.clearTimeout(clearSpotlightTimer);
    };
  }, [revealedPath, rows]);

  async function previewFile(entry: WorkspaceFileEntry, pin = false) {
    if (entry.kind !== 'file') return;
    setError('');
    try {
      const data = await fetchJson<WorkspaceFilePreview>(`/api/workspaces/preview?root=${encodeURIComponent(workspaceRoot)}&path=${encodeURIComponent(entry.path)}`);
      setPreview(data);
      setPreviewMode(workspaceDefaultPreviewMode(data));
      if (pin) {
        setPinned((current) => current.some((item) => item.path === data.path) ? current : [...current, data]);
        setTransientPreview((current) => current?.path === data.path ? null : current);
      } else {
        setTransientPreview(data);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function copyPreviewPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPreviewPath(path);
      if (copyPreviewPathTimerRef.current) window.clearTimeout(copyPreviewPathTimerRef.current);
      copyPreviewPathTimerRef.current = window.setTimeout(() => setCopiedPreviewPath(''), 1600);
    } catch {
      setError(locale === 'zh' ? '复制路径失败' : 'Failed to copy path');
    }
  }

  function toggleDirectory(entry: WorkspaceFileEntry) {
    if (gitnexusOpen) {
      const fullPath = workspaceRoot && entry.path
        ? `${workspaceRoot.replace(/\\/g, '/')}/${entry.path}`
        : workspaceRoot || entry.path;
      setGitnexusSelectedPath(fullPath);
    }
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
      const clamped = Math.min(60, Math.max(15, percent));
      setTreeWidth(clamped);
      localStorage.setItem('nexus.fileTreeWidth', String(Math.round(clamped)));
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
        <div className="workspaceFilesHeaderActions">
          <button
            type="button"
            className={`miniIconButton ${gitnexusOpen ? 'active' : ''}`}
            title={locale === 'zh' ? 'GitNexus 代码分析' : 'GitNexus code analysis'}
            onClick={() => {
              setGitnexusOpen((v) => !v);
              if (!gitnexusOpen && !gitnexusSelectedPath && workspaceRoot) {
                setGitnexusSelectedPath(workspaceRoot);
              }
            }}
          >
            <Icon name="branch" />
          </button>
          <button type="button" className="miniIconButton" title={locale === 'zh' ? '刷新' : 'Refresh'} onClick={() => { setEntriesByPath({}); setExpanded(new Set([''])); setReloadKey((value) => value + 1); }}>
            <Icon name="refresh" />
          </button>
        </div>
      </header>
      <div className="workspaceFileBody" ref={bodyRef} style={{ gridTemplateColumns: `minmax(180px, ${treeWidth}%) 7px minmax(0, 1fr)` }}>
        <section className="workspaceFileTreePane">
          <label className="workspaceFileSearch">
            <Icon name="search" />
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={locale === 'zh' ? '搜索文件...' : 'Search files...'} />
            {searchingFiles ? (
              <span className="workspaceSearchSpinner" role="status" aria-label={locale === 'zh' ? '正在搜索文件' : 'Searching files'} />
            ) : null}
          </label>
          {error ? <p className="workspaceFileError">{error}</p> : null}
          <div className="workspaceFileList" aria-busy={loadingPaths.size > 0}>
            {loadingPaths.has('') ? <p>{locale === 'zh' ? '读取中...' : 'Loading...'}</p> : null}
            {!loadingPaths.has('') && rows.length === 0 ? <p>{locale === 'zh' ? '没有文件' : 'No files'}</p> : null}
            {rows.map(({ depth, entry }) => {
              const opened = expanded.has(entry.path);
              const rowBaseClassName = spotlightPath === entry.path ? 'workspaceFileRow spotlight' : 'workspaceFileRow';
              const rowClassName = activePreviewPath === entry.path ? `${rowBaseClassName} active` : rowBaseClassName;
              return (
                <button
                  key={entry.path}
                  type="button"
                  ref={(node) => {
                    if (node) fileRowRefs.current[entry.path] = node;
                    else delete fileRowRefs.current[entry.path];
                  }}
                  className={rowClassName}
                  title={workspaceFileRowTitle(entry, workspaceRoot)}
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
        <section className={displayedPreviewTabs.length > 0 || gitnexusOpen ? 'workspacePreviewPane' : 'workspacePreviewPane noPreviewTabs'}>
          {displayedPreviewTabs.length > 0 && !gitnexusOpen ? (
            <div className="workspacePreviewTabs">
              {displayedPreviewTabs.map((file) => {
                const pinnedFile = pinned.some((item) => item.path === file.path);
                return (
                  <button
                    className={preview?.path === file.path ? 'active' : ''}
                    key={file.path}
                    type="button"
                    onClick={() => {
                      setPreview(file);
                      setPreviewMode(workspaceDefaultPreviewMode(file));
                    }}
                    title={file.path}
                  >
                    <span>{file.name}</span>
                    {pinnedFile ? (
                      <i
                        onClick={(event) => {
                          event.stopPropagation();
                          setPinned((current) => current.filter((item) => item.path !== file.path));
                          if (preview?.path === file.path) {
                            const fallbackPreview = transientPreview?.path === file.path ? null : transientPreview;
                            setPreview(fallbackPreview);
                            if (fallbackPreview) setPreviewMode(workspaceDefaultPreviewMode(fallbackPreview));
                          }
                        }}
                      >
                        ×
                      </i>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="workspacePreview">
            {gitnexusOpen ? (
              <div className="workspaceGitNexusView">
                <GitNexusPanel
                  locale={locale}
                  workspaceRoot={workspaceRoot}
                  selectedPath={gitnexusSelectedPath}
                  onSelectPath={setGitnexusSelectedPath}
                />
              </div>
            ) : preview ? (
              <>
                <div className="workspacePreviewHeader">
                  <div className="workspacePreviewMeta">
                    <button
                      type="button"
                      className="workspacePreviewPathButton"
                      data-copy-hint={locale === 'zh' ? '点击复制路径' : 'Click to copy path'}
                      aria-label={`${locale === 'zh' ? '点击复制路径' : 'Click to copy path'}: ${workspacePreviewCopyPath(preview, workspaceRoot)}`}
                      title={`${locale === 'zh' ? '点击复制路径' : 'Click to copy path'}: ${workspacePreviewCopyPath(preview, workspaceRoot)}`}
                      onClick={() => void copyPreviewPath(workspacePreviewCopyPath(preview, workspaceRoot))}
                    >
                      <strong>{workspacePreviewBreadcrumb(preview, workspaceRoot)}</strong>
                    </button>
                    <span className="workspacePreviewSubline">
                      {formatBytes(preview.size)} · {formatTimestamp(preview.updatedAt, locale)}
                      {copiedPreviewPath === workspacePreviewCopyPath(preview, workspaceRoot) ? ` · ${locale === 'zh' ? '已复制路径' : 'Path copied'}` : ''}
                    </span>
                  </div>
                  {workspaceSupportsDualPreview(preview) ? (
                    <div className="workspacePreviewModeSwitch" role="group" aria-label={locale === 'zh' ? '预览视图切换' : 'Preview view switch'}>
                      <button type="button" className={previewMode === 'rendered' ? 'active' : ''} onClick={() => setPreviewMode('rendered')}>
                        {locale === 'zh' ? '渲染' : 'Render'}
                      </button>
                      <button type="button" className={previewMode === 'source' ? 'active' : ''} onClick={() => setPreviewMode('source')}>
                        {locale === 'zh' ? '源码' : 'Source'}
                      </button>
                    </div>
                  ) : null}
                </div>
                {renderPreviewContent(preview, locale, previewMode)}
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
