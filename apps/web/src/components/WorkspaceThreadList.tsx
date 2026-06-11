import React, { useMemo, useState } from 'react';
import type { Locale } from '../config.js';
import { formatTimestamp, t } from '../i18n.js';
import type { ThreadMeta } from '../types.js';
import {
  buildPlainChatThreads,
  buildWorkspaceThreadGroups,
  type ThreadActivityState,
  type WorkspaceThreadGroup,
} from '../workspaces.js';
import { Icon } from './Icon.js';

export function WorkspaceThreadList({
  activeThreadId,
  busy,
  currentWorkspaceRoot,
  locale,
  rememberedRoots,
  runningTurnIds,
  searchQuery,
  sidebarCollapsed,
  threads,
  onCreatePlainChat,
  onCreateInWorkspace,
  onDeleteThread,
  onForgetWorkspace,
  onOpenSettings,
  onPickWorkspace,
  onRenameThread,
  onSearchQueryChange,
  onSelectThread,
  onToggleSidebar,
}: {
  activeThreadId: string;
  busy: boolean;
  currentWorkspaceRoot: string;
  locale: Locale;
  rememberedRoots: string[];
  runningTurnIds: Set<string>;
  searchQuery: string;
  sidebarCollapsed: boolean;
  threads: ThreadMeta[];
  onCreatePlainChat(): void;
  onCreateInWorkspace(workspaceRoot: string): void;
  onDeleteThread(threadId: string): void;
  onForgetWorkspace(workspaceRoot: string): void;
  onOpenSettings(): void;
  onPickWorkspace(): void;
  onRenameThread(threadId: string, title: string): Promise<void>;
  onSearchQueryChange(query: string): void;
  onSelectThread(threadId: string): void;
  onToggleSidebar(): void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [plainCollapsed, setPlainCollapsed] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<ThreadMeta | null>(null);
  const plainChats = useMemo(() => buildPlainChatThreads({ searchQuery, threads }), [searchQuery, threads]);
  const groups = useMemo(() => buildWorkspaceThreadGroups({
    currentWorkspaceRoot,
    locale,
    rememberedRoots,
    searchQuery,
    threads,
  }), [currentWorkspaceRoot, locale, rememberedRoots, searchQuery, threads]);
  const searchVisible = searchOpen || searchQuery.trim().length > 0;
  const searchResults = useMemo(() => [
    ...plainChats.map((thread) => ({ context: locale === 'zh' ? '对话' : 'Chats', thread })),
    ...groups.flatMap((group) => group.threads.map((thread) => ({ context: group.label, thread }))),
  ].sort((a, b) => b.thread.updatedAt.localeCompare(a.thread.updatedAt)), [groups, locale, plainChats]);

  if (sidebarCollapsed) {
    return (
      <section className="threadListPanel collapsed" aria-label={t(locale, 'conversations')}>
        <button className="sidebarBrandButton" type="button" title={t(locale, 'title')} onClick={onToggleSidebar}>
          <Icon name="spark" />
        </button>
        <button className="miniIconButton" type="button" title={t(locale, 'settings')} onClick={onOpenSettings}>
          <Icon name="gear" />
        </button>
      </section>
    );
  }

  return (
    <section className="threadListPanel" aria-label={t(locale, 'conversations')}>
      <header className="threadListHeader">
        <div className="threadListBrand">
          <span className="brandMark small"><Icon name="spark" /></span>
          <strong>{t(locale, 'title')}</strong>
        </div>
        <button
          className="miniIconButton"
          type="button"
          title={t(locale, 'collapseSidebar')}
          aria-label={t(locale, 'collapseSidebar')}
          onClick={onToggleSidebar}
        >
          <Icon name="chevron" />
        </button>
      </header>

      <div className="workspaceThreadsHeader">
        <button className={searchVisible ? 'searchLauncher active' : 'searchLauncher'} type="button" title={locale === 'zh' ? '搜索对话' : 'Search chats'} onClick={() => setSearchOpen(true)}>
          <Icon name="search" />
          <span>{locale === 'zh' ? '搜索' : 'Search'}</span>
        </button>
      </div>

      <div className="threadListScroll">
        <div className="workspaceGroupList">
        <ThreadModuleView
          activeThreadId={activeThreadId}
          busy={busy}
          collapsed={plainCollapsed}
          locale={locale}
          runningTurnIds={runningTurnIds}
          threads={plainChats}
          title={locale === 'zh' ? '对话' : 'Chats'}
          onCreate={onCreatePlainChat}
          onDeleteThread={onDeleteThread}
          onRenameThread={(thread) => setRenaming(thread)}
          onSelectThread={onSelectThread}
          onToggleCollapsed={() => setPlainCollapsed((value) => !value)}
        />

        <div className="threadModuleTitle">
          <button className="threadModuleToggle" type="button" onClick={() => setProjectsCollapsed((value) => !value)}>
            <Icon name={projectsCollapsed ? 'chevronRight' : 'chevronDown'} />
            <span>{locale === 'zh' ? '项目' : 'Projects'}</span>
          </button>
          <button className="threadModuleAction" type="button" title={locale === 'zh' ? '选择工作区' : 'Select workspace'} onClick={onPickWorkspace}>
            <Icon name="folderPlus" />
          </button>
        </div>
        {!projectsCollapsed && groups.length === 0 ? (
          <div className="workspaceThreadEmpty">
            {locale === 'zh' ? '暂无工作区对话' : 'No workspace chats'}
          </div>
        ) : null}
        {!projectsCollapsed ? groups.map((group) => (
          <WorkspaceGroupView
            activeThreadId={activeThreadId}
            busy={busy}
            collapsed={collapsed[group.workspaceRoot] === true}
            expanded={expanded[group.workspaceRoot] === true}
            group={group}
            key={group.workspaceRoot || '__default'}
            locale={locale}
            runningTurnIds={runningTurnIds}
            onCreateInWorkspace={onCreateInWorkspace}
            onDeleteThread={onDeleteThread}
            onForgetWorkspace={onForgetWorkspace}
            onRenameThread={(thread) => setRenaming(thread)}
            onSelectThread={onSelectThread}
            onToggleCollapsed={() => setCollapsed((current) => ({ ...current, [group.workspaceRoot]: !current[group.workspaceRoot] }))}
            onToggleExpanded={() => setExpanded((current) => ({ ...current, [group.workspaceRoot]: !current[group.workspaceRoot] }))}
          />
        )) : null}
        </div>
      </div>
      {renaming ? (
        <RenameThreadDialog
          locale={locale}
          thread={renaming}
          onClose={() => setRenaming(null)}
          onSave={async (title) => {
            await onRenameThread(renaming.threadId, title);
            setRenaming(null);
          }}
        />
      ) : null}
      {searchOpen ? (
        <SearchDialog
          locale={locale}
          query={searchQuery}
          results={searchResults}
          onClose={() => setSearchOpen(false)}
          onQueryChange={onSearchQueryChange}
          onSelect={(id) => {
            setSearchOpen(false);
            onSelectThread(id);
          }}
        />
      ) : null}
      <footer className="threadListFooter">
        <button className="settingsButton" type="button" onClick={onOpenSettings}>
          <Icon name="gear" />
          <span>{t(locale, 'settings')}</span>
        </button>
      </footer>
    </section>
  );
}

function SearchDialog({
  locale,
  query,
  results,
  onClose,
  onQueryChange,
  onSelect,
}: {
  locale: Locale;
  query: string;
  results: Array<{ context: string; thread: ThreadMeta }>;
  onClose(): void;
  onQueryChange(query: string): void;
  onSelect(threadId: string): void;
}) {
  return (
    <div className="dialogLayer searchDialogLayer" role="presentation" onMouseDown={onClose}>
      <section className="appDialog searchDialog" role="dialog" aria-modal="true" aria-label={locale === 'zh' ? '搜索对话' : 'Search chats'} onMouseDown={(event) => event.stopPropagation()}>
        <label className="searchDialogInput">
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={locale === 'zh' ? '搜索对话' : 'Search chats'}
          />
          {query.trim() ? (
            <button type="button" title={t(locale, 'cancel')} onClick={() => onQueryChange('')}>
              <Icon name="x" />
            </button>
          ) : null}
        </label>
        <div className="searchDialogResults">
          {results.length === 0 ? (
            <p>{locale === 'zh' ? '没有匹配的对话' : 'No matching chats'}</p>
          ) : results.slice(0, 12).map(({ context, thread }, index) => (
            <button key={thread.threadId} type="button" onClick={() => onSelect(thread.threadId)}>
              <span>{thread.title || t(locale, 'untitled')}</span>
              <small>{context}</small>
              <kbd>Ctrl+{index + 1}</kbd>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ThreadModuleView({
  activeThreadId,
  busy,
  collapsed,
  locale,
  runningTurnIds,
  threads,
  title,
  onCreate,
  onDeleteThread,
  onRenameThread,
  onSelectThread,
  onToggleCollapsed,
}: {
  activeThreadId: string;
  busy: boolean;
  collapsed: boolean;
  locale: Locale;
  runningTurnIds: Set<string>;
  threads: ThreadMeta[];
  title: string;
  onCreate(): void;
  onDeleteThread(threadId: string): void;
  onRenameThread(thread: ThreadMeta): void;
  onSelectThread(threadId: string): void;
  onToggleCollapsed(): void;
}) {
  const visibleThreads = threads.slice(0, 8);
  return (
    <article className="threadModule">
      <div className="threadModuleHeader">
        <button className="threadModuleToggle" type="button" onClick={onToggleCollapsed}>
          <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} />
          <span>{title}</span>
        </button>
        <button type="button" title={locale === 'zh' ? '新建对话' : 'New chat'} onClick={onCreate}>
          <Icon name="plus" />
        </button>
      </div>
      {!collapsed ? <div className="workspaceThreadRows plain">
        {visibleThreads.length === 0 ? (
          <div className="workspaceThreadEmptyRow">
            <span>{locale === 'zh' ? '暂无对话' : 'No chats'}</span>
            <button type="button" onClick={onCreate}>{locale === 'zh' ? '新建' : 'New'}</button>
          </div>
        ) : visibleThreads.map((thread) => {
          const activity = threadActivityFor(thread, activeThreadId, busy, runningTurnIds);
          return (
            <ThreadRow
              activity={activity}
              active={thread.threadId === activeThreadId}
              key={thread.threadId}
              locale={locale}
              thread={thread}
              onDeleteThread={onDeleteThread}
              onRenameThread={onRenameThread}
              onSelectThread={onSelectThread}
            />
          );
        })}
      </div> : null}
    </article>
  );
}

function WorkspaceGroupView({
  activeThreadId,
  busy,
  collapsed,
  expanded,
  group,
  locale,
  runningTurnIds,
  onCreateInWorkspace,
  onDeleteThread,
  onForgetWorkspace,
  onRenameThread,
  onSelectThread,
  onToggleCollapsed,
  onToggleExpanded,
}: {
  activeThreadId: string;
  busy: boolean;
  collapsed: boolean;
  expanded: boolean;
  group: WorkspaceThreadGroup;
  locale: Locale;
  runningTurnIds: Set<string>;
  onCreateInWorkspace(workspaceRoot: string): void;
  onDeleteThread(threadId: string): void;
  onForgetWorkspace(workspaceRoot: string): void;
  onRenameThread(thread: ThreadMeta): void;
  onSelectThread(threadId: string): void;
  onToggleCollapsed(): void;
  onToggleExpanded(): void;
}) {
  const visibleThreads = expanded ? group.threads : group.threads.slice(0, 5);
  const hasOverflow = group.threads.length > 5;
  return (
    <article className="workspaceGroup">
      <div className="workspaceGroupHeader" title={group.workspaceRoot || group.label}>
        <button className="workspaceGroupMain" type="button" onClick={onToggleCollapsed}>
          <Icon name="folder" />
          <span>{group.label}</span>
          {group.context ? <small>{group.context}</small> : null}
        </button>
        <div className="workspaceGroupActions">
          <button type="button" title={locale === 'zh' ? '新建对话' : 'New chat'} onClick={() => onCreateInWorkspace(group.workspaceRoot)}>
            <Icon name="plus" />
          </button>
          {group.workspaceRoot ? (
            <button type="button" title={locale === 'zh' ? '移除工作区' : 'Remove workspace'} onClick={() => onForgetWorkspace(group.workspaceRoot)}>
              <Icon name="trash" />
            </button>
          ) : null}
        </div>
      </div>
      {!collapsed ? (
        <div className="workspaceThreadRows">
          {visibleThreads.length === 0 ? (
            <div className="workspaceThreadEmptyRow">
              <span>{locale === 'zh' ? '暂无对话' : 'No chats'}</span>
              <button type="button" onClick={() => onCreateInWorkspace(group.workspaceRoot)}>
                {locale === 'zh' ? '新建' : 'New'}
              </button>
            </div>
          ) : visibleThreads.map((thread) => {
            const activity = threadActivityFor(thread, activeThreadId, busy, runningTurnIds);
            return (
              <ThreadRow
                activity={activity}
                active={thread.threadId === activeThreadId}
                key={thread.threadId}
                locale={locale}
                thread={thread}
                onDeleteThread={onDeleteThread}
                onRenameThread={onRenameThread}
                onSelectThread={onSelectThread}
              />
            );
          })}
          {hasOverflow ? (
            <button className="workspaceMoreButton" type="button" onClick={onToggleExpanded}>
              {expanded
                ? (locale === 'zh' ? '收起' : 'Show less')
                : (locale === 'zh' ? `显示更多 ${group.threads.length - 5}` : `Show ${group.threads.length - 5} more`)}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function ThreadRow({
  activity,
  active,
  locale,
  thread,
  onDeleteThread,
  onRenameThread,
  onSelectThread,
}: {
  activity: ThreadActivityState;
  active: boolean;
  locale: Locale;
  thread: ThreadMeta;
  onDeleteThread(threadId: string): void;
  onRenameThread(thread: ThreadMeta): void;
  onSelectThread(threadId: string): void;
}) {
  return (
    <div className={active ? 'workspaceThreadRow active' : 'workspaceThreadRow'}>
      <button className="workspaceThreadMain" type="button" title={thread.title} onClick={() => onSelectThread(thread.threadId)}>
        <span>{thread.title || t(locale, 'untitled')}</span>
        <small>{formatTimestamp(thread.updatedAt, locale)}</small>
        <ThreadActivityDot state={activity} />
      </button>
      <div className="workspaceThreadActions">
        <button type="button" title={t(locale, 'edit')} onClick={() => onRenameThread(thread)}>
          <Icon name="pen" />
        </button>
        <button type="button" title={t(locale, 'deleteConversation')} onClick={() => onDeleteThread(thread.threadId)}>
          <Icon name="trash" />
        </button>
      </div>
    </div>
  );
}

export function ThreadActivityDot({ state }: { state: ThreadActivityState }) {
  if (state === 'idle') return null;
  return <span className={state === 'running' ? 'threadActivityDot running' : 'threadActivityDot unread'} aria-hidden="true" />;
}

function threadActivityFor(thread: ThreadMeta, activeThreadId: string, busy: boolean, runningTurnIds: Set<string>): ThreadActivityState {
  if (thread.status === 'running') return 'running';
  if (thread.threadId === activeThreadId && (busy || runningTurnIds.size > 0)) return 'running';
  return 'idle';
}

function RenameThreadDialog({
  locale,
  thread,
  onClose,
  onSave,
}: {
  locale: Locale;
  thread: ThreadMeta;
  onClose(): void;
  onSave(title: string): Promise<void>;
}) {
  const [value, setValue] = useState(thread.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const nextTitle = value.trim();
  const disabled = saving || !nextTitle || nextTitle === thread.title;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setSaving(true);
    setError('');
    try {
      await onSave(nextTitle);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSaving(false);
    }
  }

  return (
    <div className="dialogLayer" role="presentation" onMouseDown={onClose}>
      <form className="appDialog renameThreadDialog" role="dialog" aria-modal="true" aria-labelledby="rename-thread-title" onSubmit={(event) => void submit(event)} onMouseDown={(event) => event.stopPropagation()}>
        <header className="dialogHeader">
          <h2 id="rename-thread-title">{locale === 'zh' ? '重命名对话' : 'Rename chat'}</h2>
          <button className="iconButton" type="button" title={t(locale, 'cancel')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} onFocus={(event) => event.currentTarget.select()} />
        {error ? <p className="dialogMessage">{error}</p> : null}
        <div className="dialogActions">
          <button className="textButton" type="button" onClick={onClose} disabled={saving}>{t(locale, 'cancel')}</button>
          <button className="solidButton" type="submit" disabled={disabled}>{saving ? t(locale, 'running') : t(locale, 'save')}</button>
        </div>
      </form>
    </div>
  );
}
