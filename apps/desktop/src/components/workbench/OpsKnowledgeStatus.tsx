import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '../../config/config.js';
import {
  createKnowledgeBase,
  actOnKnowledgeJob,
  authorizeKnowledgeDirectory,
  deleteKnowledgeBase,
  getKnowledgePage,
  getKnowledgeBase,
  listKnowledgePages,
  listKnowledgeBases,
  queryKnowledgeBases,
  renameKnowledgeBase,
  syncKnowledgeBase,
  type KnowledgeBaseDetail,
  type KnowledgePageSummary,
  type KnowledgeScopeSelection,
  type KnowledgeDirectoryGrant,
  type KnowledgeCompileJob,
  type KnowledgeWikiGraphNode,
} from '../../api/knowledgeClient.js';
import { Icon } from '../Icon.js';
import { ConfirmPanel } from '../settings/ConfirmPanel.js';
import { KnowledgeBaseGraph } from './KnowledgeBaseGraph.js';

function label(locale: Locale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en;
}

function compileStageLabel(locale: Locale, stage: string): string {
  const stages: Record<string, [string, string]> = {
    queued: ['排队中', 'Queued'], scanning: ['扫描中', 'Scanning'], extracting: ['提取中', 'Extracting'],
    indexing: ['索引中', 'Indexing'], finalizing: ['收尾中', 'Finalizing'], paused: ['已暂停', 'Paused'],
    completed: ['已完成', 'Completed'], cancelled: ['已取消', 'Cancelled'], failed: ['失败', 'Failed'],
  };
  const value = stages[stage] ?? [stage, stage];
  return label(locale, value[0], value[1]);
}

function selectionFor(detail: KnowledgeBaseDetail): KnowledgeScopeSelection | null {
  const snapshot = detail.snapshot;
  if (!snapshot || snapshot.status !== 'ready' || !snapshot.immutable) return null;
  return {
    knowledgeBaseIds: [detail.knowledgeBase.knowledgeBaseId],
    snapshotIds: [snapshot.snapshotId],
    indexVersion: snapshot.indexVersion,
  };
}

export function OpsKnowledgeStatus({
  locale,
  mode = 'select',
  value = null,
  onChange,
}: {
  locale: Locale;
  /** Settings owns source authorization and catalog management; Ops only selects ready snapshots. */
  mode?: 'manage' | 'select';
  value?: KnowledgeScopeSelection | null;
  onChange?: (selection: KnowledgeScopeSelection | null) => void;
}) {
  const [entries, setEntries] = useState<KnowledgeBaseDetail[]>([]);
  const [name, setName] = useState('');
  const [sourceGrant, setSourceGrant] = useState<KnowledgeDirectoryGrant | null>(null);
  const [persistPending, setPersistPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pages, setPages] = useState<Record<string, KnowledgePageSummary[]>>({});
  const [pagePreview, setPagePreview] = useState<{ title: string; body: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ relativePath: string; text: string; heading?: string }>>([]);
  const [managedId, setManagedId] = useState<string | null>(null);
  const [knowledgeView, setKnowledgeView] = useState<'table' | 'graph'>('table');
  const [pendingDelete, setPendingDelete] = useState<KnowledgeBaseDetail | null>(null);
  const selectionEnabled = mode === 'select' && Boolean(onChange);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.knowledgeBase.knowledgeBaseId === value?.knowledgeBaseIds[0]) ?? null,
    [entries, value],
  );

  const managedEntry = useMemo(
    () => entries.find((entry) => entry.knowledgeBase.knowledgeBaseId === managedId) ?? null,
    [entries, managedId],
  );

  const managedSelection = useMemo(
    () => managedEntry ? selectionFor(managedEntry) : null,
    [managedEntry],
  );

  async function refresh(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const bases = await listKnowledgeBases();
      const details = await Promise.all(bases.map((base) => getKnowledgeBase(base.knowledgeBaseId)));
      setEntries(details);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const activeJobIds = useMemo(
    () => entries
      .map((entry) => entry.job)
      .filter((job): job is KnowledgeCompileJob => Boolean(job && !['completed', 'paused', 'cancelled', 'failed'].includes(job.status)))
      .map((job) => job.jobId)
      .sort()
      .join(','),
    [entries],
  );

  useEffect(() => {
    if (!activeJobIds) return undefined;
    const timer = window.setInterval(() => {
      void Promise.all(entries.filter((entry) => entry.job && activeJobIds.includes(entry.job.jobId)).map(async (entry) => {
        try {
          const next = await getKnowledgeBase(entry.knowledgeBase.knowledgeBaseId);
          setEntries((current) => current.map((item) => item.knowledgeBase.knowledgeBaseId === next.knowledgeBase.knowledgeBaseId ? next : item));
        } catch {
          // A later poll or manual refresh can recover from a transient request failure.
        }
      }));
    }, 800);
    return () => window.clearInterval(timer);
  }, [activeJobIds, entries]);

  useEffect(() => {
    if (mode !== 'manage') return;
    if (managedId && entries.some((entry) => entry.knowledgeBase.knowledgeBaseId === managedId)) return;
    const firstReady = entries.find((entry) => entry.snapshot?.status === 'ready' && entry.snapshot.immutable);
    setManagedId(firstReady?.knowledgeBase.knowledgeBaseId ?? entries[0]?.knowledgeBase.knowledgeBaseId ?? null);
  }, [entries, managedId, mode]);

  function choose(detail: KnowledgeBaseDetail): void {
    if (!selectionEnabled) {
      setManagedId(detail.knowledgeBase.knowledgeBaseId);
      setKnowledgeView('table');
      setSearchResults([]);
      setError('');
      return;
    }
    const selection = selectionFor(detail);
    if (!selection) {
      setError(label(locale, '该知识库没有可用的不可变快照，请先同步。', 'This knowledge base has no ready immutable snapshot. Sync it first.'));
      return;
    }
    const id = selection.knowledgeBaseIds[0]!;
    const current = value ?? { knowledgeBaseIds: [], snapshotIds: [] };
    const selected = current.knowledgeBaseIds.includes(id);
    const nextIds = selected ? current.knowledgeBaseIds.filter((item) => item !== id) : [...current.knowledgeBaseIds, id];
    const nextSnapshots = selected
      ? current.snapshotIds.filter((snapshotId) => snapshotId !== selection.snapshotIds[0])
      : [...current.snapshotIds, selection.snapshotIds[0]!];
    onChange?.(nextIds.length ? { knowledgeBaseIds: nextIds, snapshotIds: nextSnapshots, indexVersion: selection.indexVersion } : null);
    setError('');
    setNotice(label(locale, selected ? '已取消选择' : '已选择固定快照', selected ? 'Selection cleared' : 'Ready snapshot selected'));
  }

  async function chooseSourceRoot(): Promise<void> {
    try {
      const picked = await authorizeKnowledgeDirectory();
      if (picked) setSourceGrant(picked);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function create(): Promise<void> {
    const nextName = name.trim();
    if (!nextName || !sourceGrant) {
      setError(label(locale, '请输入知识库名称和源目录。', 'Enter a knowledge base name and source root.'));
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const detail = await createKnowledgeBase(nextName, sourceGrant.grantId, persistPending);
      setEntries((current) => [...current.filter((item) => item.knowledgeBase.knowledgeBaseId !== detail.knowledgeBase.knowledgeBaseId), detail]);
      setName('');
      setSourceGrant(null);
      setNotice(label(locale, '知识库已加入编译队列', 'Knowledge base compilation queued'));
      if (selectionEnabled) choose(detail);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function sync(detail: KnowledgeBaseDetail): Promise<void> {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await syncKnowledgeBase(detail.knowledgeBase.knowledgeBaseId, persistPending);
      setEntries((current) => current.map((item) => item.knowledgeBase.knowledgeBaseId === next.knowledgeBase.knowledgeBaseId ? next : item));
      if (selectionEnabled && value?.knowledgeBaseIds.includes(next.knowledgeBase.knowledgeBaseId)) {
        const refreshed = selectionFor(next);
        if (refreshed) {
          const index = value.knowledgeBaseIds.indexOf(next.knowledgeBase.knowledgeBaseId);
          const snapshotIds = [...value.snapshotIds];
          if (index >= 0) snapshotIds[index] = refreshed.snapshotIds[0]!;
          onChange?.({ ...value, snapshotIds, indexVersion: refreshed.indexVersion });
        }
      } else setNotice(label(locale, '知识库已加入编译队列', 'Knowledge base compilation queued'));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function jobAction(detail: KnowledgeBaseDetail, action: 'pause' | 'resume' | 'cancel'): Promise<void> {
    const job = detail.job;
    if (!job) return;
    setBusy(true);
    setError('');
    try {
      const next = await actOnKnowledgeJob(job.jobId, action);
      setEntries((current) => current.map((item) => item.knowledgeBase.knowledgeBaseId === detail.knowledgeBase.knowledgeBaseId ? { ...item, job: next } : item));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function saveName(detail: KnowledgeBaseDetail): Promise<void> {
    if (!editingName.trim()) return;
    setBusy(true);
    try {
      const updated = await renameKnowledgeBase(detail.knowledgeBase.knowledgeBaseId, editingName);
      setEntries((current) => current.map((item) => item.knowledgeBase.knowledgeBaseId === updated.knowledgeBaseId ? { ...item, knowledgeBase: updated } : item));
      setEditingId(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally { setBusy(false); }
  }

  async function remove(): Promise<void> {
    if (!pendingDelete) return;
    const detail = pendingDelete;
    setBusy(true);
    try {
      await deleteKnowledgeBase(detail.knowledgeBase.knowledgeBaseId);
      setEntries((current) => current.filter((item) => item.knowledgeBase.knowledgeBaseId !== detail.knowledgeBase.knowledgeBaseId));
      if (selectionEnabled && value?.knowledgeBaseIds.includes(detail.knowledgeBase.knowledgeBaseId)) onChange?.(null);
      setPendingDelete(null);
      setNotice(label(locale, '已移除本地索引与连接元数据。', 'Local index and connection metadata removed.'));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally { setBusy(false); }
  }

  async function togglePages(detail: KnowledgeBaseDetail): Promise<void> {
    const id = detail.knowledgeBase.knowledgeBaseId;
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!pages[id]) {
      try { const loaded = await listKnowledgePages(id); setPages((current) => ({ ...current, [id]: loaded })); }
      catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    }
  }

  async function previewPage(knowledgeBaseId: string, page: KnowledgePageSummary): Promise<void> {
    try {
      const detail = await getKnowledgePage(knowledgeBaseId, page.pageId);
      setPagePreview({ title: detail.title, body: detail.body });
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
  }

  function previewGraphNode(node: KnowledgeWikiGraphNode): void {
    if (!managedEntry) return;
    void previewPage(managedEntry.knowledgeBase.knowledgeBaseId, {
      pageId: node.pageId,
      title: node.title,
      relativePath: node.relativePath,
    });
  }

  async function verifySearch(): Promise<void> {
    const searchSelection = selectionEnabled ? value : managedSelection;
    if (!searchQuery.trim() || !searchSelection?.knowledgeBaseIds.length || !searchSelection.snapshotIds.length) return;
    setBusy(true);
    try {
      const result = await queryKnowledgeBases({ knowledgeBaseIds: searchSelection.knowledgeBaseIds, snapshotIds: searchSelection.snapshotIds, query: searchQuery.trim(), maxHits: 6 });
      setSearchResults(result.hits);
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setBusy(false); }
  }

  const managedSnapshotReady = managedEntry?.snapshot?.status === 'ready' && managedEntry.snapshot.immutable;
  const managedGraph = managedSnapshotReady ? (managedEntry?.snapshot?.graph ?? { nodes: [], edges: [] }) : null;
  const graphRows = useMemo(() => {
    if (!managedGraph) return [];
    const outgoing = new Map<string, { total: number; resolved: number; unresolved: number }>();
    for (const edge of managedGraph.edges) {
      const current = outgoing.get(edge.sourcePageId) ?? { total: 0, resolved: 0, unresolved: 0 };
      current.total += 1;
      if (edge.resolved) current.resolved += 1;
      else current.unresolved += 1;
      outgoing.set(edge.sourcePageId, current);
    }
    return managedGraph.nodes.map((node) => ({
      node,
      links: outgoing.get(node.pageId) ?? { total: 0, resolved: 0, unresolved: 0 },
    }));
  }, [managedGraph]);

  return (
    <section className={`opsKnowledgeStatus opsKnowledgeStatus-${mode}`} aria-label={label(locale, mode === 'manage' ? '个人知识库' : '知识依据', mode === 'manage' ? 'Personal knowledge bases' : 'Knowledge sources')}>
      <div className="opsKnowledgeStatusHeader">
        <div className="opsKnowledgeStatusTitle"><Icon name="knowledge" /><strong>{label(locale, mode === 'manage' ? '个人知识库' : '知识依据', mode === 'manage' ? 'Personal knowledge bases' : 'Knowledge sources')}</strong></div>
        <button type="button" className="iconButton" onClick={() => void refresh()} disabled={busy} title={label(locale, '刷新', 'Refresh')} aria-label={label(locale, '刷新知识库', 'Refresh knowledge bases')}><Icon name="refresh" /></button>
      </div>
      {mode === 'manage' ? <div className="opsKnowledgeCreateForm">
        <label><span>{label(locale, '名称', 'Name')}</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={label(locale, '例如：生产运行手册', 'e.g. Production runbook')} disabled={busy} /></label>
        <label><span>{label(locale, '已授权源目录', 'Authorized source directory')}</span><div className="opsKnowledgeSourcePicker"><input value={sourceGrant?.canonicalPath ?? ''} readOnly placeholder={label(locale, '使用目录选择器授权', 'Choose a directory')} disabled={busy} /><button type="button" className="iconButton" onClick={() => void chooseSourceRoot()} disabled={busy} title={label(locale, '选择目录', 'Choose directory')} aria-label={label(locale, '选择目录', 'Choose directory')}><Icon name="folderOpen" /></button></div></label>
        <label className="opsKnowledgePendingToggle"><input type="checkbox" checked={persistPending} onChange={(event) => setPersistPending(event.target.checked)} disabled={busy} /><span>{label(locale, '保留待处理缓存', 'Keep pending cache')}</span></label>
        <button type="button" className="opsKnowledgeStatusAction" onClick={() => void create()} disabled={busy}><Icon name="plus" />{label(locale, '创建并同步', 'Create and sync')}</button>
      </div> : null}
      {notice ? <p className="opsKnowledgeStatusNotice" role="status">{notice}</p> : null}
      {error ? <p className="opsKnowledgeStatusError" role="alert">{error}</p> : null}
      {entries.length === 0 && !busy ? <div className="opsKnowledgeStatusEmpty"><span>{label(locale, mode === 'manage' ? '暂无个人知识库。' : '暂无可选择的个人知识库，请在设置中添加。', mode === 'manage' ? 'No personal knowledge base yet.' : 'No personal knowledge base is available. Add one in Settings.')}</span></div> : null}
      {mode === 'manage' && managedSelection?.knowledgeBaseIds.length ? <div className="opsKnowledgeVerify"><div><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={label(locale, '验证当前知识库搜索', 'Verify current knowledge base')} /><button type="button" className="iconButton" onClick={() => void verifySearch()} disabled={busy || !searchQuery.trim()} title={label(locale, '验证搜索', 'Run search')} aria-label={label(locale, '验证搜索', 'Run search')}><Icon name="search" /></button></div>{searchResults.map((hit, index) => <button type="button" key={`${hit.relativePath}:${index}`} onClick={() => setPagePreview({ title: hit.heading ?? hit.relativePath, body: hit.text })}><strong>{hit.heading ?? hit.relativePath}</strong><small>{hit.text}</small></button>)}</div> : null}
      <div className="opsKnowledgeStatusList">
        {entries.map((entry) => {
          const snapshot = entry.snapshot;
          const ready = snapshot?.status === 'ready' && snapshot.immutable;
          const job = entry.job;
          const jobActive = Boolean(job && !['completed', 'cancelled', 'failed'].includes(job.status));
          const selected = selectionEnabled && (value?.knowledgeBaseIds.includes(entry.knowledgeBase.knowledgeBaseId) ?? false);
          const root = entry.knowledgeBase.source?.canonicalPath ?? label(locale, '未配置已授权目录', 'No authorized source directory');
          return (
            <div className="opsKnowledgeEntry" key={entry.knowledgeBase.knowledgeBaseId}>
            <article className={`opsKnowledgeStatusRow${selected || (!selectionEnabled && managedId === entry.knowledgeBase.knowledgeBaseId) ? ' selected' : ''}`}>
              <button type="button" className="opsKnowledgeStatusSelect" onClick={() => choose(entry)} disabled={!ready || busy}>
                <Icon name="knowledge" />
                <span>{editingId === entry.knowledgeBase.knowledgeBaseId ? <input value={editingName} onChange={(event) => setEditingName(event.target.value)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Enter') void saveName(entry); }} autoFocus /> : <strong>{entry.knowledgeBase.name}</strong>}<small>{root}</small><em>{ready ? `${snapshot?.pages?.length ?? 0} ${label(locale, '页', 'pages')}${snapshot?.indexStats?.truncated || (snapshot?.indexStats?.skippedFiles ?? 0) > 0 ? ` · ${label(locale, '部分索引', 'partial')}` : ''}` : label(locale, '快照未就绪', 'Snapshot unavailable')}</em></span>
                {selected ? <Icon name="check" /> : (!selectionEnabled && managedId === entry.knowledgeBase.knowledgeBaseId ? <Icon name="eye" /> : null)}
              </button>
              {mode === 'manage' ? <span className="opsKnowledgeRowActions"><button type="button" className="iconButton" onClick={() => void togglePages(entry)} disabled={!ready || busy} title={label(locale, '查看页面', 'View pages')} aria-label={label(locale, '查看页面', 'View pages')}><Icon name="folderOpen" /></button><button type="button" className="iconButton" onClick={() => void sync(entry)} disabled={busy} title={label(locale, '同步', 'Sync')} aria-label={`${label(locale, '同步', 'Sync')} ${entry.knowledgeBase.name}`}><Icon name="refresh" /></button><button type="button" className="iconButton" onClick={() => { setEditingId(entry.knowledgeBase.knowledgeBaseId); setEditingName(entry.knowledgeBase.name); }} disabled={busy} title={label(locale, '改名', 'Rename')} aria-label={label(locale, '改名', 'Rename')}><Icon name="pen" /></button>{editingId === entry.knowledgeBase.knowledgeBaseId ? <button type="button" className="iconButton" onClick={() => void saveName(entry)} disabled={busy} title={label(locale, '保存名称', 'Save name')} aria-label={label(locale, '保存名称', 'Save name')}><Icon name="check" /></button> : <button type="button" className="iconButton" onClick={() => setPendingDelete(entry)} disabled={busy} title={label(locale, '停用', 'Disable')} aria-label={label(locale, '停用', 'Disable')}><Icon name="trash" /></button>}</span> : null}
            </article>
            {job && (jobActive || job.status === 'paused' || job.status === 'failed') ? <div className={`opsKnowledgeCompileJob opsKnowledgeCompileJob-${job.status}`}>
              <div className="opsKnowledgeCompileMeta"><span>{compileStageLabel(locale, job.stage)}</span><span>{job.processedFiles}/{job.totalFiles || '?'}</span><span>{job.indexedFiles} {label(locale, '已编译', 'indexed')}</span></div>
              {job.currentFile ? <div className="opsKnowledgeCompileFile" title={job.currentFile}>{job.currentFile}</div> : null}
              {job.errors.length ? <div className="opsKnowledgeCompileError">{job.errors[job.errors.length - 1]?.message}</div> : null}
              <div className="opsKnowledgeCompileActions">
                {job.status === 'paused' ? <button type="button" className="iconButton" onClick={() => void jobAction(entry, 'resume')} disabled={busy} title={label(locale, '继续', 'Resume')} aria-label={label(locale, '继续编译', 'Resume compilation')}><Icon name="play" /></button> : <button type="button" className="iconButton" onClick={() => void jobAction(entry, 'pause')} disabled={busy || !jobActive} title={label(locale, '暂停', 'Pause')} aria-label={label(locale, '暂停编译', 'Pause compilation')}><Icon name="pause" /></button>}
                {jobActive ? <button type="button" className="iconButton" onClick={() => void jobAction(entry, 'cancel')} disabled={busy} title={label(locale, '取消', 'Cancel')} aria-label={label(locale, '取消编译', 'Cancel compilation')}><Icon name="stop" /></button> : null}
              </div>
            </div> : null}
            {expandedId === entry.knowledgeBase.knowledgeBaseId ? <div className="opsKnowledgePages">{(pages[entry.knowledgeBase.knowledgeBaseId] ?? []).map((page) => <button type="button" key={page.pageId} onClick={() => void previewPage(entry.knowledgeBase.knowledgeBaseId, page)}><Icon name="file" /><span>{page.title}<small>{page.relativePath}</small></span></button>)}</div> : null}
            </div>
          );
        })}
      </div>
      {mode === 'manage' && managedEntry && managedSnapshotReady ? <section className="opsKnowledgeVisual" aria-label={label(locale, '知识库可视化', 'Knowledge base visualization')}>
        <div className="opsKnowledgeVisualHeader">
          <div><strong>{label(locale, '页面关系', 'Page relationships')}</strong><small>{managedEntry.knowledgeBase.name}</small></div>
          <div className="opsKnowledgeViewSwitch" role="group" aria-label={label(locale, '视图', 'View')}>
            <button type="button" className={knowledgeView === 'table' ? 'active' : ''} aria-pressed={knowledgeView === 'table'} onClick={() => setKnowledgeView('table')}><Icon name="fileText" />{label(locale, '表格', 'Table')}</button>
            <button type="button" className={knowledgeView === 'graph' ? 'active' : ''} aria-pressed={knowledgeView === 'graph'} onClick={() => setKnowledgeView('graph')}><Icon name="workflow" />{label(locale, '力导向', 'Graph')}</button>
          </div>
        </div>
        {knowledgeView === 'graph' ? <KnowledgeBaseGraph locale={locale} graph={managedGraph} onNodeClick={previewGraphNode} /> : <div className="table-responsive opsKnowledgeTableWrap">
          <table className="table table-sm opsKnowledgeTable">
            <thead><tr><th>{label(locale, '页面', 'Page')}</th><th>{label(locale, '路径', 'Path')}</th><th>{label(locale, '目录', 'Directory')}</th><th className="text-end">{label(locale, '出链', 'Links')}</th><th className="text-end">{label(locale, '已解析', 'Resolved')}</th><th className="text-end">{label(locale, '未解析', 'Unresolved')}</th></tr></thead>
            <tbody>{graphRows.map(({ node, links }) => <tr key={node.pageId}>
              <td><button type="button" className="opsKnowledgePageLink" onClick={() => previewGraphNode(node)}>{node.title || node.slug}</button></td>
              <td><code>{node.relativePath}</code></td><td>{node.pageDirectory}</td><td className="text-end">{links.total}</td><td className="text-end">{links.resolved}</td><td className="text-end">{links.unresolved}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section> : null}
      {selectionEnabled && selectedEntry && value?.snapshotIds[0] ? <small className="opsKnowledgeStatusSelected">{label(locale, '当前选择', 'Selected')}: {selectedEntry.knowledgeBase.name} · {value.snapshotIds[0]}</small> : null}
      {pagePreview ? <div className="opsKnowledgePagePreview"><div><strong>{pagePreview.title}</strong><button type="button" className="iconButton" onClick={() => setPagePreview(null)} aria-label={label(locale, '关闭预览', 'Close preview')}><Icon name="x" /></button></div><pre>{pagePreview.body}</pre></div> : null}
      <ConfirmPanel
        locale={locale}
        open={Boolean(pendingDelete)}
        title={label(locale, '移除这个知识库？', 'Remove this knowledge base?')}
        description={label(locale, '只移除本地索引与连接元数据，不删除原始文件；取消不会发送网络 DELETE。', 'Only the local index and connection metadata will be removed. Original files are untouched; cancel sends no DELETE request.')}
        confirmLabel={label(locale, '移除索引', 'Remove index')}
        cancelLabel={label(locale, '取消', 'Cancel')}
        tone="danger"
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
      />
    </section>
  );
}
