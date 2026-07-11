import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Locale } from '../config/config.js';
import { Icon } from './Icon.js';
import { GitNexusResultView } from './GitNexusResultView.js';
import type { GitNexusGraphData } from './gitNexusResult.js';
import { GitNexusForceGraph } from './GitNexusForceGraph.js';
import type { ForceGraphData } from './GitNexusForceGraph.js';

type GitNexusTab = 'overview' | 'query' | 'context' | 'impact' | 'trace';

interface GitNexusRepo {
  path: string;
  name?: string;
  status?: string;
  fileCount?: number;
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!response.ok || data.ok === false) {
    throw new Error(data.error ?? 'Request failed');
  }
  return data;
}

function detectProjectRoots(entries: Array<{ path: string; name: string; kind: string }>): string[] {
  const markers = [
    'package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts',
    'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt',
    'Gemfile', 'composer.json', 'Cargo.lock', 'pnpm-lock.yaml',
    'package-lock.json', 'yarn.lock', '.git',
  ];
  const roots: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'directory') continue;
    if (markers.some((m) => entry.name === m)) {
      const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
      if (parent && !roots.includes(parent)) roots.push(parent);
    }
  }
  return roots;
}

function normalizePath(p: string): string {
  const normalized = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')
    ? normalized.toLowerCase()
    : normalized;
}

export function GitNexusPanel({
  locale,
  workspaceRoot,
  selectedPath,
  onSelectPath,
}: {
  locale: Locale;
  workspaceRoot: string;
  selectedPath: string;
  onSelectPath(path: string): void;
}) {
  const [activeTab, setActiveTab] = useState<GitNexusTab>('overview');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const [analyzeStatus, setAnalyzeStatus] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [symbolInput, setSymbolInput] = useState('');
  const [traceFromInput, setTraceFromInput] = useState('');
  const [traceToInput, setTraceToInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultData, setResultData] = useState<GitNexusGraphData | null>(null);
  const [resultError, setResultError] = useState('');
  const [repos, setRepos] = useState<GitNexusRepo[]>([]);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [overviewData, setOverviewData] = useState<{
    labels: Array<{ label: string; count: number }>;
    relations: Array<{ type: string; count: number }>;
    fileCount: number;
  } | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [graphData, setGraphData] = useState<ForceGraphData | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphLevel, setGraphLevel] = useState<'file' | 'symbol'>('file');
  const [statusChecked, setStatusChecked] = useState(false);
  const [indexStatus, setIndexStatus] = useState<{ indexed: boolean; needsUpdate?: boolean; fileCount?: number; lastIndexed?: string } | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  const currentPath = selectedPath || workspaceRoot;

  const pathOptions = useMemo(() => {
    const options: Array<{ value: string; label: string; isWorkspace?: boolean }> = [];
    if (workspaceRoot) {
      options.push({ value: workspaceRoot, label: workspaceRoot, isWorkspace: true });
    }
    if (selectedPath && selectedPath !== workspaceRoot) {
      const exists = repos.some((r) => r.path === selectedPath);
      if (!exists) {
        options.push({ value: selectedPath, label: selectedPath });
      }
    }
    for (const repo of repos) {
      if (!options.some((o) => o.value === repo.path)) {
        options.push({ value: repo.path, label: repo.name || repo.path });
      }
    }
    return options;
  }, [selectedPath, workspaceRoot, repos]);

  const loadRepos = useCallback(async () => {
    try {
      const data = await apiJson<{ data: unknown }>('/api/gitnexus/repos');
      const repoList = Array.isArray(data.data) ? (data.data as GitNexusRepo[]) : [];
      setRepos(repoList);
      setReposLoaded(true);
    } catch {
      setRepos([]);
      setReposLoaded(true);
    }
  }, []);

  const isRepoAnalyzed = useMemo(() => {
    // status 检查已经明确知道是否索引；如果 repos 里匹配也视为已索引
    if (statusChecked && indexStatus?.indexed) return true;
    const normCurrent = normalizePath(currentPath);
    return repos.some((r) => {
      const normRepo = normalizePath(r.path);
      return normRepo === normCurrent || normCurrent.startsWith(normRepo + '/');
    });
  }, [repos, currentPath, statusChecked, indexStatus]);

  useEffect(() => {
    setStatusChecked(false);
    setIndexStatus(null);
  }, [currentPath]);

  const loadOverview = useCallback(async (path: string) => {
    setOverviewLoading(true);
    try {
      const data = await apiJson<{
        data: {
          labels: Array<{ label: string; count: number }>;
          relations: Array<{ type: string; count: number }>;
          fileCount: number;
        };
      }>(
        `/api/gitnexus/overview?repo=${encodeURIComponent(path)}`,
      );
      setOverviewData(data.data);
    } catch {
      setOverviewData(null);
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadGraph = useCallback(async (path: string, level: 'file' | 'symbol') => {
    setGraphLoading(true);
    try {
      const data = await apiJson<{ data: ForceGraphData }>(
        `/api/gitnexus/graph?repo=${encodeURIComponent(path)}&level=${level}&limit=500`,
      );
      setGraphData(data.data);
    } catch {
      setGraphData(null);
    } finally {
      setGraphLoading(false);
    }
  }, []);

  // 路径变化时重置概览数据和索引状态
  useEffect(() => {
    setOverviewData(null);
    setGraphData(null);
    setStatusChecked(false);
    setIndexStatus(null);
  }, [currentPath]);

  // 建完索引后自动加载概览和图
  useEffect(() => {
    if (isRepoAnalyzed && activeTab === 'overview') {
      if (!overviewData && !overviewLoading) {
        void loadOverview(currentPath);
      }
      if (!graphData && !graphLoading) {
        void loadGraph(currentPath, graphLevel);
      }
    }
  }, [isRepoAnalyzed, activeTab, overviewData, overviewLoading, graphData, graphLoading, currentPath, loadOverview, loadGraph, graphLevel]);

  const checkStatus = useCallback(async (): Promise<{ indexed: boolean; needsUpdate?: boolean; fileCount?: number; lastIndexed?: string } | null> => {
    if (!currentPath) return null;
    setCheckingStatus(true);
    try {
      const url = `/api/gitnexus/status?repo=${encodeURIComponent(currentPath)}`;
      console.log('[GitNexusPanel] checkStatus url:', url);
      const data = await apiJson<{ data: { indexed: boolean; needsUpdate?: boolean; fileCount?: number; lastIndexed?: string } }>(url);
      console.log('[GitNexusPanel] checkStatus result:', JSON.stringify(data.data, null, 2));
      setIndexStatus(data.data);
      setStatusChecked(true);
      return data.data;
    } catch (caught) {
      console.error('[GitNexusPanel] checkStatus error:', caught);
      setIndexStatus(null);
      setStatusChecked(false);
      return null;
    } finally {
      setCheckingStatus(false);
    }
  }, [currentPath]);

  // 挂载时自动加载 repo 列表并检查索引状态
  useEffect(() => {
    void loadRepos();
    void checkStatus();
  }, [loadRepos, checkStatus]);

  async function doAnalyze(force: boolean = false) {
    if (!currentPath) return;
    setAnalyzing(true);
    setAnalyzeError('');
    setAnalyzeStatus(locale === 'zh' ? '正在构建索引...' : 'Building index...');
    try {
      const data = await apiJson<{ data: unknown }>('/api/gitnexus/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentPath, force }),
      });
      setAnalyzeStatus(locale === 'zh' ? '索引构建完成' : 'Index built successfully');
      await loadRepos();
      setOverviewData(null);
      setGraphData(null);
      void loadOverview(currentPath);
      void loadGraph(currentPath, graphLevel);
      setStatusChecked(true);
      setIndexStatus({ indexed: true, needsUpdate: false });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setAnalyzeError(message);
      setAnalyzeStatus('');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleAnalyze() {
    if (!currentPath) return;

    if (statusChecked && indexStatus?.indexed && !indexStatus?.needsUpdate) {
      void doAnalyze(true);
      return;
    }

    const status = await checkStatus();
    if (!status) {
      void doAnalyze(false);
      return;
    }

    if (!status.indexed || status.needsUpdate) {
      void doAnalyze(false);
    }
  }

  async function handleQuery() {
    if (!queryInput.trim()) return;
    setLoading(true);
    setResultError('');
    try {
      const data = await apiJson<{ data: unknown }>(
        `/api/gitnexus/query?q=${encodeURIComponent(queryInput)}&repo=${encodeURIComponent(currentPath)}`,
      );
      const converted = convertRawToGraphData(data.data, 'query', queryInput, locale);
      setResultData(converted);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setResultError(message);
      setResultData(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleContext() {
    if (!symbolInput.trim()) return;
    setLoading(true);
    setResultError('');
    try {
      const data = await apiJson<{ data: unknown }>(
        `/api/gitnexus/context?symbol=${encodeURIComponent(symbolInput)}&repo=${encodeURIComponent(currentPath)}`,
      );
      const converted = convertRawToGraphData(data.data, 'context', symbolInput, locale);
      setResultData(converted);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setResultError(message);
      setResultData(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleImpact() {
    if (!symbolInput.trim()) return;
    setLoading(true);
    setResultError('');
    try {
      const data = await apiJson<{ data: unknown }>(
        `/api/gitnexus/impact?symbol=${encodeURIComponent(symbolInput)}&repo=${encodeURIComponent(currentPath)}`,
      );
      const converted = convertRawToGraphData(data.data, 'impact', symbolInput, locale);
      setResultData(converted);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setResultError(message);
      setResultData(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleTrace() {
    if (!traceFromInput.trim() || !traceToInput.trim()) return;
    setLoading(true);
    setResultError('');
    try {
      const data = await apiJson<{ data: unknown }>(
        `/api/gitnexus/trace?from=${encodeURIComponent(traceFromInput)}&to=${encodeURIComponent(traceToInput)}&repo=${encodeURIComponent(currentPath)}`,
      );
      const converted = convertRawToGraphData(data.data, 'trace', `${traceFromInput} -> ${traceToInput}`, locale);
      setResultData(converted);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setResultError(message);
      setResultData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="gitNexusPanel" aria-label={locale === 'zh' ? 'GitNexus 代码分析' : 'GitNexus code analysis'}>
      <header className="gitNexusPanelHeader">
        <div>
          <h2>{locale === 'zh' ? 'GitNexus 代码分析' : 'GitNexus Analysis'}</h2>
          <p title={currentPath}>{currentPath || (locale === 'zh' ? '未选择项目' : 'No project selected')}</p>
        </div>
        <button
          type="button"
          className="miniIconButton"
          title={locale === 'zh' ? '刷新仓库列表' : 'Refresh repos'}
          onClick={() => void loadRepos()}
        >
          <Icon name="refresh" />
        </button>
      </header>

      <div className="gitNexusProjectSection">
        <div className="gitNexusProjectRow">
          <span className="gitNexusLabel">{locale === 'zh' ? '项目路径：' : 'Project path:'}</span>
          <select
            className="gitNexusPathSelect"
            value={currentPath}
            onChange={(e) => onSelectPath(e.target.value)}
          >
            {pathOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.isWorkspace ? (locale === 'zh' ? '工作区根目录：' : 'Workspace root: ') : ''}
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="gitNexusAnalyzeRow">
          <button
            type="button"
            className="gitNexusAnalyzeBtn"
            onClick={() => void handleAnalyze()}
            disabled={analyzing || checkingStatus || !currentPath}
          >
            {analyzing
              ? (locale === 'zh' ? '分析中...' : 'Analyzing...')
              : checkingStatus
                ? (locale === 'zh' ? '检查状态...' : 'Checking status...')
                : statusChecked && indexStatus?.indexed && !indexStatus.needsUpdate
                  ? (locale === 'zh' ? '重新分析' : 'Re-analyze')
                  : statusChecked && indexStatus?.indexed && indexStatus.needsUpdate
                    ? (locale === 'zh' ? '更新索引' : 'Update index')
                    : (locale === 'zh' ? '开始分析' : 'Analyze')}
          </button>
          {statusChecked && indexStatus?.indexed && !indexStatus.needsUpdate && !analyzing && !checkingStatus ? (
            <span className="gitNexusStatus">{locale === 'zh' ? '索引已是最新' : 'Index is up to date'}</span>
          ) : null}
          {analyzeStatus ? <span className="gitNexusStatus">{analyzeStatus}</span> : null}
          {analyzeError ? <span className="gitNexusError">{analyzeError}</span> : null}
        </div>
      </div>

      <div className="gitNexusTabs" role="tablist">
        <button
          className={activeTab === 'overview' ? 'active' : ''}
          type="button"
          role="tab"
          onClick={() => setActiveTab('overview')}
        >
          {locale === 'zh' ? '概览' : 'Overview'}
        </button>
        <button
          className={activeTab === 'query' ? 'active' : ''}
          type="button"
          role="tab"
          onClick={() => setActiveTab('query')}
        >
          {locale === 'zh' ? '智能搜索' : 'Query'}
        </button>
        <button
          className={activeTab === 'context' ? 'active' : ''}
          type="button"
          role="tab"
          onClick={() => setActiveTab('context')}
        >
          {locale === 'zh' ? '符号上下文' : 'Context'}
        </button>
        <button
          className={activeTab === 'impact' ? 'active' : ''}
          type="button"
          role="tab"
          onClick={() => setActiveTab('impact')}
        >
          {locale === 'zh' ? '影响分析' : 'Impact'}
        </button>
        <button
          className={activeTab === 'trace' ? 'active' : ''}
          type="button"
          role="tab"
          onClick={() => setActiveTab('trace')}
        >
          {locale === 'zh' ? '调用路径' : 'Trace'}
        </button>
      </div>

      <div className="gitNexusToolBody">
        {activeTab === 'overview' ? (
          <div className="gitNexusOverview">
            {!isRepoAnalyzed ? (
              <div className="gitNexusEmptyHint">
                {locale === 'zh' ? '请先点击"开始分析"构建索引，然后查看项目架构概览。' : 'Click "Analyze" to build the index first, then view the project overview.'}
              </div>
            ) : (
              <>
                {overviewData && (
                  <div className="gitNexusOverviewStats">
                    <div className="gitNexusStatCard">
                      <div className="gitNexusStatValue">{overviewData.fileCount}</div>
                      <div className="gitNexusStatLabel">{locale === 'zh' ? '文件' : 'Files'}</div>
                    </div>
                    {overviewData.labels.slice(0, 6).map((item) => (
                      <div key={item.label} className="gitNexusStatCard">
                        <div className="gitNexusStatValue">{item.count}</div>
                        <div className="gitNexusStatLabel">{item.label}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="gitNexusOverviewGraphHeader">
                  <div className="gitNexusOverviewGraphTabs">
                    <button
                      type="button"
                      className={graphLevel === 'file' ? 'active' : ''}
                      onClick={() => {
                        setGraphLevel('file');
                        void loadGraph(currentPath, 'file');
                      }}
                    >
                      {locale === 'zh' ? '文件级依赖' : 'File-level'}
                    </button>
                    <button
                      type="button"
                      className={graphLevel === 'symbol' ? 'active' : ''}
                      onClick={() => {
                        setGraphLevel('symbol');
                        void loadGraph(currentPath, 'symbol');
                      }}
                    >
                      {locale === 'zh' ? '符号级调用' : 'Symbol-level'}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="gitNexusGraphRefreshBtn"
                    onClick={() => void loadGraph(currentPath, graphLevel)}
                    disabled={graphLoading}
                  >
                    {locale === 'zh' ? '刷新' : 'Refresh'}
                  </button>
                </div>
                {graphLoading ? (
                  <div className="gitNexusLoading">{locale === 'zh' ? '正在加载依赖图...' : 'Loading dependency graph...'}</div>
                ) : graphData && graphData.nodes.length > 0 ? (
                  <GitNexusForceGraph
                    data={graphData}
                    height={520}
                    onNodeClick={(node) => {
                      if (node.label) {
                        setSymbolInput(node.label);
                        setActiveTab('context');
                      }
                    }}
                  />
                ) : (
                  <div className="gitNexusEmptyHint">
                    {locale === 'zh' ? '暂无依赖图数据' : 'No dependency graph data available'}
                  </div>
                )}

                {overviewData && overviewData.relations.length > 0 && (
                  <div className="gitNexusOverviewRelations">
                    <h3 className="gitNexusOverviewSectionTitle">
                      {locale === 'zh' ? '关系类型统计' : 'Relation Types'}
                    </h3>
                    <div className="gitNexusRelationGrid">
                      {overviewData.relations.slice(0, 8).map((rel) => (
                        <div key={rel.type} className="gitNexusRelationItem">
                          <span className="gitNexusRelationName">{rel.type}</span>
                          <span className="gitNexusRelationCount">{rel.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}

        {activeTab === 'query' ? (
          <div className="gitNexusToolForm">
            <div className="gitNexusInputRow">
              <input
                type="text"
                placeholder={locale === 'zh' ? '输入符号名搜索，例如：UserService、login、UserController' : 'Symbol name, e.g. UserService, login, UserController'}
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleQuery(); }}
              />
              <button type="button" onClick={() => void handleQuery()} disabled={loading || !queryInput.trim()}>
                {locale === 'zh' ? '搜索' : 'Search'}
              </button>
            </div>
          </div>
        ) : null}

        {activeTab === 'context' ? (
          <div className="gitNexusToolForm">
            <div className="gitNexusInputRow">
              <input
                type="text"
                placeholder={locale === 'zh' ? '输入符号名，例如：UserService.login' : 'Symbol name, e.g. UserService.login'}
                value={symbolInput}
                onChange={(e) => setSymbolInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleContext(); }}
              />
              <button type="button" onClick={() => void handleContext()} disabled={loading || !symbolInput.trim()}>
                {locale === 'zh' ? '查看上下文' : 'View Context'}
              </button>
            </div>
          </div>
        ) : null}

        {activeTab === 'impact' ? (
          <div className="gitNexusToolForm">
            <div className="gitNexusInputRow">
              <input
                type="text"
                placeholder={locale === 'zh' ? '输入符号名查看影响范围' : 'Symbol name to analyze impact'}
                value={symbolInput}
                onChange={(e) => setSymbolInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleImpact(); }}
              />
              <button type="button" onClick={() => void handleImpact()} disabled={loading || !symbolInput.trim()}>
                {locale === 'zh' ? '分析影响' : 'Analyze Impact'}
              </button>
            </div>
          </div>
        ) : null}

        {activeTab === 'trace' ? (
          <div className="gitNexusToolForm">
            <div className="gitNexusInputRow">
              <input
                type="text"
                placeholder={locale === 'zh' ? '起点符号' : 'From symbol'}
                value={traceFromInput}
                onChange={(e) => setTraceFromInput(e.target.value)}
              />
              <span className="gitNexusArrow">→</span>
              <input
                type="text"
                placeholder={locale === 'zh' ? '终点符号' : 'To symbol'}
                value={traceToInput}
                onChange={(e) => setTraceToInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleTrace(); }}
              />
              <button
                type="button"
                onClick={() => void handleTrace()}
                disabled={loading || !traceFromInput.trim() || !traceToInput.trim()}
              >
                {locale === 'zh' ? '追踪路径' : 'Trace Path'}
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="gitNexusLoading">{locale === 'zh' ? '加载中...' : 'Loading...'}</div>
        ) : resultError ? (
          <div className="gitNexusResultError">{resultError}</div>
        ) : resultData ? (
          <GitNexusResultView data={resultData} locale={locale} />
        ) : (
          <div className="gitNexusEmptyHint">
            {locale === 'zh'
              ? '选择工具并输入参数后执行分析。请确保已先构建索引。'
              : 'Select a tool and enter parameters to analyze. Make sure to build the index first.'}
          </div>
        )}
      </div>
    </section>
  );
}

function convertRawToGraphData(
  raw: unknown,
  tool: string,
  input: string,
  locale: Locale,
): GitNexusGraphData {
  if (!raw || typeof raw !== 'object') {
    return {
      kind: 'list',
      title: `${tool}: ${input}`,
      nodes: [],
      edges: [],
      rows: [],
    };
  }
  const s = raw as Record<string, unknown>;

  if (tool === 'query') {
    const list = Array.isArray(s.results)
      ? s.results
      : Array.isArray(s.symbols)
        ? s.symbols
        : Array.isArray(s.matches)
          ? s.matches
          : [];
    const rows = list.map((item: unknown, i: number) => {
      if (typeof item === 'string') return { name: item };
      if (!item || typeof item !== 'object') return { name: `item${i}` };
      const ie = item as Record<string, unknown>;
      return {
        name: String(ie.name ?? ie.symbol ?? ie.label ?? `item${i}`),
        kind: ie.kind ? String(ie.kind) : undefined,
        file: ie.file ? String(ie.file) : ie.path ? String(ie.path) : undefined,
        line: typeof ie.line === 'number' ? ie.line : undefined,
        score: typeof ie.score === 'number' ? ie.score : undefined,
        confidence: typeof ie.confidence === 'number' ? ie.confidence : undefined,
      };
    });
    return {
      kind: 'list',
      title: `query: ${input}`,
      nodes: [],
      edges: [],
      rows,
    };
  }

  if (tool === 'context' || tool === 'impact') {
    const nodes: Array<{ id: string; label: string; group: string; kind?: string; file?: string; line?: number }> = [];
    const edges: Array<{ id: string; source: string; target: string }> = [];
    let nodeIdx = 0;
    let edgeIdx = 0;

    const centerSymbol = s.symbol ?? s.root;
    let centerName = '';
    let centerKind: string | undefined;
    let centerFile: string | undefined;
    let centerLine: number | undefined;
    if (typeof centerSymbol === 'string') {
      centerName = centerSymbol;
    } else if (centerSymbol && typeof centerSymbol === 'object') {
      const cs = centerSymbol as Record<string, unknown>;
      centerName = String(cs.name ?? cs.symbol ?? cs.label ?? input);
      centerKind = cs.kind ? String(cs.kind) : undefined;
      centerFile = cs.file ? String(cs.file) : undefined;
      centerLine = typeof cs.line === 'number' ? cs.line : undefined;
    }
    if (!centerName) centerName = input;

    const centerId = `gn-center-${nodeIdx++}`;
    nodes.push({ id: centerId, label: centerName, group: 'center', kind: centerKind, file: centerFile, line: centerLine });

    const leftGroup = tool === 'context' ? 'callers' : 'upstream';
    const rightGroup = tool === 'context' ? 'callees' : 'downstream';
    const leftLabel = tool === 'context' ? 'caller' : 'upstream';
    const rightLabel = tool === 'context' ? 'callee' : 'downstream';

    const leftItems = Array.isArray(s[leftGroup]) ? (s[leftGroup] as Array<Record<string, unknown>>) : [];
    leftItems.forEach((item, i) => {
      const label = String(item.symbol ?? item.name ?? item.label ?? `${leftLabel}${i}`);
      const id = `gn-left-${nodeIdx++}`;
      nodes.push({
        id,
        label,
        group: tool === 'context' ? 'caller' : 'upstream',
        kind: item.kind ? String(item.kind) : undefined,
        file: item.file ? String(item.file) : undefined,
        line: typeof item.line === 'number' ? item.line : undefined,
      });
      edges.push({ id: `gn-edge-${edgeIdx++}`, source: id, target: centerId });
    });

    const rightItems = Array.isArray(s[rightGroup]) ? (s[rightGroup] as Array<Record<string, unknown>>) : [];
    rightItems.forEach((item, i) => {
      const label = String(item.symbol ?? item.name ?? item.label ?? `${rightLabel}${i}`);
      const id = `gn-right-${nodeIdx++}`;
      nodes.push({
        id,
        label,
        group: tool === 'context' ? 'callee' : 'downstream',
        kind: item.kind ? String(item.kind) : undefined,
        file: item.file ? String(item.file) : undefined,
        line: typeof item.line === 'number' ? item.line : undefined,
      });
      edges.push({ id: `gn-edge-${edgeIdx++}`, source: centerId, target: id });
    });

    if (tool === 'context' && Array.isArray(s.processes)) {
      (s.processes as Array<Record<string, unknown>>).forEach((item, i) => {
        const label = String(item.name ?? item.symbol ?? item.label ?? `process${i}`);
        const id = `gn-proc-${nodeIdx++}`;
        nodes.push({ id, label, group: 'process', kind: 'process', file: item.file ? String(item.file) : undefined });
        edges.push({ id: `gn-edge-${edgeIdx++}`, source: centerId, target: id });
      });
    }

    return {
      kind: 'graph',
      title: `${tool}: ${centerName}`,
      nodes,
      edges,
      groups: Array.from(new Set(nodes.map((n) => n.group))).map((g) => ({
        label: g,
        count: nodes.filter((n) => n.group === g).length,
      })),
    };
  }

  if (tool === 'trace') {
    const steps = Array.isArray(s.path) ? s.path : Array.isArray(s.steps) ? s.steps : [];
    const nodes: Array<{ id: string; label: string; group: string; kind?: string; file?: string; line?: number }> = [];
    const edges: Array<{ id: string; source: string; target: string }> = [];
    let prevId: string | null = null;

    steps.forEach((step: unknown, i: number) => {
      let label = '';
      let kind: string | undefined;
      let file: string | undefined;
      let line: number | undefined;
      if (typeof step === 'string') {
        label = step;
      } else if (step && typeof step === 'object') {
        const se = step as Record<string, unknown>;
        label = String(se.name ?? se.symbol ?? se.label ?? se.file ?? `step${i}`);
        kind = se.kind ? String(se.kind) : undefined;
        file = se.file ? String(se.file) : undefined;
        line = typeof se.line === 'number' ? se.line : undefined;
      } else {
        label = `step${i}`;
      }
      const id = `gn-trace-${i}`;
      nodes.push({ id, label, group: 'route', kind, file, line });
      if (prevId) {
        edges.push({ id: `gn-trace-edge-${i}`, source: prevId, target: id });
      }
      prevId = id;
    });

    const first = steps[0];
    const last = steps[steps.length - 1];
    const firstLabel = typeof first === 'string' ? first : first && typeof first === 'object' ? String((first as Record<string, unknown>).name ?? (first as Record<string, unknown>).symbol ?? '') : '';
    const lastLabel = typeof last === 'string' ? last : last && typeof last === 'object' ? String((last as Record<string, unknown>).name ?? (last as Record<string, unknown>).symbol ?? '') : '';
    const title = firstLabel && lastLabel && firstLabel !== lastLabel
      ? `trace: ${firstLabel} -> ${lastLabel}`
      : `trace: ${firstLabel || input}`;

    return {
      kind: 'graph',
      title,
      nodes,
      edges,
      groups: [{ label: 'route', count: nodes.length }],
    };
  }

  return {
    kind: 'list',
    title: `${tool}: ${input}`,
    nodes: [],
    edges: [],
    rows: [],
  };
}
