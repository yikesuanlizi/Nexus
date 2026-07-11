import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Locale } from '../config/config.js';
import { Icon } from './Icon.js';
import { GitNexusResultView } from './GitNexusResultView.js';
import type { GitNexusGraphData } from './gitNexusResult.js';
import { GitNexusForceGraph } from './GitNexusForceGraph.js';
import type { ForceGraphData } from './GitNexusForceGraph.js';
import { GitNexusGraphModal } from './GitNexusGraphModal.js';

type GitNexusTab = 'overview' | 'query' | 'context' | 'impact' | 'trace';

interface TabHelpInfo {
  title: string;
  description: string;
  useCase: string;
  input: string;
  output: string;
}

const tabHelpData: Record<GitNexusTab, { zh: TabHelpInfo; en: TabHelpInfo }> = {
  overview: {
    zh: {
      title: '概览',
      description: '展示项目整体架构概览，包括代码统计、依赖关系图、模块分布',
      useCase: '快速了解项目结构、发现核心模块、定位技术栈',
      input: '选择项目路径，点击"开始分析"构建索引',
      output: '统计卡片 + 依赖关系图 + 模块分类列表',
    },
    en: {
      title: 'Overview',
      description: 'Shows overall project architecture, including code statistics, dependency graphs, and module distribution',
      useCase: 'Quickly understand project structure, discover core modules, identify tech stack',
      input: 'Select project path, click "Analyze" to build index',
      output: 'Statistics cards + dependency graph + module category list',
    },
  },
  query: {
    zh: {
      title: '智能搜索',
      description: '用自然语言搜索相关代码，基于语义理解找到匹配的代码片段',
      useCase: '想找某个功能的实现但不知道具体文件名、按功能描述搜索代码',
      input: '自然语言描述，如"用户认证"、"数据库查询"、"支付逻辑"',
      output: '相关代码文件/符号列表，按相关性排序',
    },
    en: {
      title: 'Query',
      description: 'Search code using natural language, find matching code snippets based on semantic understanding',
      useCase: 'Find feature implementation without knowing file names, search code by feature description',
      input: 'Natural language description, e.g. "user authentication", "database query", "payment logic"',
      output: 'Related code files/symbols list, sorted by relevance',
    },
  },
  context: {
    zh: {
      title: '符号上下文',
      description: '查看某个符号（类/方法/函数）的完整上下文，包括定义、引用、依赖关系',
      useCase: '想深入理解某个方法的作用、查看类的继承关系、分析函数的调用链',
      input: '符号名称，如类名、方法名',
      output: '符号定义位置、所有引用点、相关依赖、调用关系',
    },
    en: {
      title: 'Context',
      description: 'View complete context of a symbol (class/method/function), including definition, references, dependencies',
      useCase: 'Deeply understand a method\'s purpose, view class inheritance, analyze function call chains',
      input: 'Symbol name, e.g. class name, method name',
      output: 'Symbol definition location, all reference points, related dependencies, call relationships',
    },
  },
  impact: {
    zh: {
      title: '影响分析',
      description: '分析修改某个符号可能影响的范围，找出所有依赖该符号的代码',
      useCase: '修改前评估影响面、重构前做风险分析、理解代码耦合度',
      input: '要分析的符号名称',
      output: '受影响的文件、类、方法列表，按依赖层级展示',
    },
    en: {
      title: 'Impact',
      description: 'Analyze the scope of impact when modifying a symbol, find all code that depends on it',
      useCase: 'Assess impact before changes, risk analysis before refactoring, understand code coupling',
      input: 'Symbol name to analyze',
      output: 'Affected files, classes, methods list, displayed by dependency hierarchy',
    },
  },
  trace: {
    zh: {
      title: '调用路径',
      description: '追踪从一个符号到另一个符号的完整调用路径',
      useCase: '理解业务流程、排查调用链问题、分析数据流向',
      input: '起点符号和终点符号',
      output: '多条可能的调用路径，每条路径显示经过的中间节点',
    },
    en: {
      title: 'Trace',
      description: 'Trace the complete call path from one symbol to another',
      useCase: 'Understand business flow, troubleshoot call chain issues, analyze data flow',
      input: 'Start symbol and end symbol',
      output: 'Multiple possible call paths, each showing intermediate nodes',
    },
  },
};

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
  const [graphModalOpen, setGraphModalOpen] = useState(false);
  const [statusChecked, setStatusChecked] = useState(false);
  const [indexStatus, setIndexStatus] = useState<{ indexed: boolean; needsUpdate?: boolean; fileCount?: number; lastIndexed?: string } | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [helpTab, setHelpTab] = useState<GitNexusTab | null>(null);
  const [helpModalOpen, setHelpModalOpen] = useState(false);

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
        `/api/gitnexus/graph?repo=${encodeURIComponent(path)}&level=${level}&limit=800`,
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

  useEffect(() => {
    if (!helpTab) return;
    const handleClickOutside = () => setHelpTab(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [helpTab]);

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
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button
            type="button"
            className="miniIconButton"
            title={locale === 'zh' ? '帮助' : 'Help'}
            onClick={() => setHelpModalOpen(true)}
          >
            <Icon name="question" />
          </button>
          <button
            type="button"
            className="miniIconButton"
            title={locale === 'zh' ? '刷新仓库列表' : 'Refresh repos'}
            onClick={() => void loadRepos()}
          >
            <Icon name="refresh" />
          </button>
        </div>
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
        {(['overview', 'query', 'context', 'impact', 'trace'] as GitNexusTab[]).map((tab) => {
          const tabLabel = locale === 'zh'
            ? (tab === 'overview' ? '概览' : tab === 'query' ? '智能搜索' : tab === 'context' ? '符号上下文' : tab === 'impact' ? '影响分析' : '调用路径')
            : (tab === 'overview' ? 'Overview' : tab === 'query' ? 'Query' : tab === 'context' ? 'Context' : tab === 'impact' ? 'Impact' : 'Trace');
          const helpInfo = tabHelpData[tab][locale === 'zh' ? 'zh' : 'en'];
          return (
            <div key={tab} className="gitNexusTabItem">
              <button
                className={activeTab === tab ? 'active' : ''}
                type="button"
                role="tab"
                onClick={() => {
                  setActiveTab(tab);
                  setResultData(null);
                  setResultError('');
                  setLoading(false);
                }}
              >
                {tabLabel}
                <span
                  className="gitNexusHelpIcon"
                  onClick={(e) => {
                    e.stopPropagation();
                    setHelpTab(helpTab === tab ? null : tab);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setHelpTab(helpTab === tab ? null : tab);
                    }
                  }}
                >
                  ?
                </span>
              </button>
              {helpTab === tab && (
                <div
                  className="gitNexusHelpPopover"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="gitNexusHelpPopoverTitle">{helpInfo.title}</div>
                  <div className="gitNexusHelpPopoverRow">
                    <strong>{locale === 'zh' ? '简介：' : 'Description:'}</strong>
                    <span>{helpInfo.description}</span>
                  </div>
                  <div className="gitNexusHelpPopoverRow">
                    <strong>{locale === 'zh' ? '使用场景：' : 'Use Case:'}</strong>
                    <span>{helpInfo.useCase}</span>
                  </div>
                  <div className="gitNexusHelpPopoverRow">
                    <strong>{locale === 'zh' ? '输入：' : 'Input:'}</strong>
                    <span>{helpInfo.input}</span>
                  </div>
                  <div className="gitNexusHelpPopoverRow">
                    <strong>{locale === 'zh' ? '输出：' : 'Output:'}</strong>
                    <span>{helpInfo.output}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
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
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button
                      type="button"
                      className="gitNexusGraphRefreshBtn"
                      onClick={() => void loadGraph(currentPath, graphLevel)}
                      disabled={graphLoading}
                    >
                      {locale === 'zh' ? '刷新' : 'Refresh'}
                    </button>
                    {graphData && graphData.nodes.length > 0 && (
                      <button
                        type="button"
                        className="gitNexusGraphExpandBtn"
                        onClick={() => setGraphModalOpen(true)}
                        title={locale === 'zh' ? '放大查看' : 'Expand view'}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                {graphLoading ? (
                  <div className="gitNexusLoading">{locale === 'zh' ? '正在加载依赖图...' : 'Loading dependency graph...'}</div>
                ) : graphData && graphData.nodes.length > 0 ? (
                  <GitNexusForceGraph
                    data={graphData}
                    height={520}
                    onNodeClick={(node) => {
                      if (node.label) {
                        const inputValue = graphLevel === 'file' ? (node.file ?? node.label) : node.label;
                        setSymbolInput(inputValue);
                        setActiveTab('context');
                        setResultData(null);
                        setResultError('');
                        setLoading(false);
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

      {graphData && (
        <GitNexusGraphModal
          isOpen={graphModalOpen}
          onClose={() => setGraphModalOpen(false)}
          data={graphData}
          title={graphLevel === 'file'
            ? (locale === 'zh' ? '文件级依赖图' : 'File-level Dependency Graph')
            : (locale === 'zh' ? '符号级调用图' : 'Symbol-level Call Graph')}
          onNodeClick={(node) => {
            if (node.label) {
              const inputValue = graphLevel === 'file' ? (node.file ?? node.label) : node.label;
              setSymbolInput(inputValue);
              setActiveTab('context');
              setResultData(null);
              setResultError('');
              setLoading(false);
              setGraphModalOpen(false);
            }
          }}
        />
      )}

      {helpModalOpen && (
        <div
          className="gitNexusHelpModalBackdrop"
          onClick={() => setHelpModalOpen(false)}
        >
          <div
            className="gitNexusHelpModal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="gitNexusHelpModalClose"
              onClick={() => setHelpModalOpen(false)}
              aria-label={locale === 'zh' ? '关闭' : 'Close'}
            >
              <Icon name="x" />
            </button>

            <div className="gitNexusHelpModalContent">
              <h2 className="gitNexusHelpModalTitle">
                {locale === 'zh' ? 'GitNexus 代码分析使用指南' : 'GitNexus Code Analysis Guide'}
              </h2>

              <p className="gitNexusHelpModalWelcome">
                {locale === 'zh'
                  ? '欢迎使用 GitNexus 代码分析工具！本工具基于代码知识图谱，帮助你深入理解项目架构、快速定位代码、分析影响范围。'
                  : 'Welcome to GitNexus Code Analysis! This tool is based on code knowledge graphs, helping you deeply understand project architecture, quickly locate code, and analyze impact scope.'}
              </p>

              <div className="gitNexusHelpSection">
                <h3 className="gitNexusHelpSectionTitle">
                  1. {locale === 'zh' ? '概览 (Overview)' : 'Overview'}
                </h3>
                <ul className="gitNexusHelpList">
                  <li>{locale === 'zh' ? '功能：展示项目整体架构概览' : 'Feature: Display overall project architecture overview'}</li>
                  <li>{locale === 'zh' ? '包含：文件/符号统计、依赖关系图、模块分布' : 'Includes: file/symbol statistics, dependency graph, module distribution'}</li>
                  <li>{locale === 'zh' ? '使用方式：选择项目路径，点击"开始分析"构建索引，即可查看' : 'Usage: Select project path, click "Analyze" to build index, then view'}</li>
                </ul>
              </div>

              <div className="gitNexusHelpSection">
                <h3 className="gitNexusHelpSectionTitle">
                  2. {locale === 'zh' ? '智能搜索 (Query)' : 'Query'}
                </h3>
                <ul className="gitNexusHelpList">
                  <li>{locale === 'zh' ? '功能：用自然语言搜索相关代码' : 'Feature: Search related code using natural language'}</li>
                  <li>{locale === 'zh' ? '基于语义理解，不是简单的关键词匹配' : 'Based on semantic understanding, not simple keyword matching'}</li>
                  <li>{locale === 'zh' ? '输入示例："用户认证"、"数据库查询"、"支付逻辑"' : 'Input examples: "user authentication", "database query", "payment logic"'}</li>
                  <li>{locale === 'zh' ? '输出：相关代码文件/符号列表，按相关性排序' : 'Output: related code files/symbols list, sorted by relevance'}</li>
                </ul>
              </div>

              <div className="gitNexusHelpSection">
                <h3 className="gitNexusHelpSectionTitle">
                  3. {locale === 'zh' ? '符号上下文 (Context)' : 'Context'}
                </h3>
                <ul className="gitNexusHelpList">
                  <li>{locale === 'zh' ? '功能：查看某个符号的完整上下文' : 'Feature: View complete context of a symbol'}</li>
                  <li>{locale === 'zh' ? '支持：类、方法、函数、接口等' : 'Supports: classes, methods, functions, interfaces, etc.'}</li>
                  <li>{locale === 'zh' ? '包含：定义位置、所有引用点、相关依赖、调用关系' : 'Includes: definition location, all references, related dependencies, call relationships'}</li>
                  <li>{locale === 'zh' ? '使用方式：输入符号名称，如"UserController"、"login"' : 'Usage: Enter symbol name, e.g. "UserController", "login"'}</li>
                </ul>
              </div>

              <div className="gitNexusHelpSection">
                <h3 className="gitNexusHelpSectionTitle">
                  4. {locale === 'zh' ? '影响分析 (Impact)' : 'Impact'}
                </h3>
                <ul className="gitNexusHelpList">
                  <li>{locale === 'zh' ? '功能：分析修改某个符号可能影响的范围' : 'Feature: Analyze the scope of impact when modifying a symbol'}</li>
                  <li>{locale === 'zh' ? '找出所有依赖该符号的代码' : 'Find all code that depends on the symbol'}</li>
                  <li>{locale === 'zh' ? '使用场景：修改前评估影响面、重构前风险分析' : 'Use cases: assess impact before changes, risk analysis before refactoring'}</li>
                  <li>{locale === 'zh' ? '输出：受影响的文件、类、方法列表' : 'Output: list of affected files, classes, methods'}</li>
                </ul>
              </div>

              <div className="gitNexusHelpSection">
                <h3 className="gitNexusHelpSectionTitle">
                  5. {locale === 'zh' ? '调用路径 (Trace)' : 'Trace'}
                </h3>
                <ul className="gitNexusHelpList">
                  <li>{locale === 'zh' ? '功能：追踪两个符号之间的完整调用路径' : 'Feature: Trace the complete call path between two symbols'}</li>
                  <li>{locale === 'zh' ? '使用场景：理解业务流程、排查调用链问题' : 'Use cases: understand business flow, troubleshoot call chain issues'}</li>
                  <li>{locale === 'zh' ? '输入：起点符号和终点符号' : 'Input: start symbol and end symbol'}</li>
                  <li>{locale === 'zh' ? '输出：多条可能的调用路径，显示中间节点' : 'Output: multiple possible call paths, showing intermediate nodes'}</li>
                </ul>
              </div>

              <div className="gitNexusHelpTips">
                <h3 className="gitNexusHelpSectionTitle">
                  {locale === 'zh' ? '提示' : 'Tips'}
                </h3>
                <ul className="gitNexusHelpList">
                  <li>{locale === 'zh' ? '首次使用需先构建索引，后续可增量更新' : 'First use requires building index, subsequent updates can be incremental'}</li>
                  <li>{locale === 'zh' ? '点击依赖图上的节点可快速跳转到对应符号的上下文' : 'Click nodes on the dependency graph to quickly jump to the corresponding symbol context'}</li>
                  <li>{locale === 'zh' ? '点击图右上角的放大按钮可全屏查看依赖图' : 'Click the expand button in the top-right corner of the graph to view the dependency graph in full screen'}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
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
