// 历史快照面板：列出工程级检查点并支持回退到指定回合
// History snapshots panel: list project-level checkpoints with rollback support

import { useState } from 'react';
import type { Locale } from '../config/config.js';
import type { ThreadItem } from '../shared/types.js';

type ProjectFileSnapshot = NonNullable<ThreadItem['files']>[number];
type FileKind = 'add' | 'delete' | 'update';

export interface CheckpointPanelProps {
  /** 检查点条目（将按 turnCount 降序展示） */
  items: ThreadItem[];
  /** 当前回合数，用于判断是否为最新快照 */
  currentTurnCount: number;
  locale?: Locale;
  onRollback: (turnCount: number) => void;
}

const FILE_KIND_ICON: Record<FileKind, string> = {
  add: '+',
  delete: '\u2212',
  update: '~',
};

const FILE_KIND_LABEL_ZH: Record<FileKind, string> = {
  add: '新增',
  delete: '删除',
  update: '修改',
};

const FILE_KIND_LABEL_EN: Record<FileKind, string> = {
  add: 'Added',
  delete: 'Deleted',
  update: 'Modified',
};

export function CheckpointPanel({
  items,
  currentTurnCount,
  locale = 'zh',
  onRollback,
}: CheckpointPanelProps) {
  const zh = locale === 'zh';
  const checkpoints = items
    .filter(
      (item) =>
        item.type === 'project_checkpoint' &&
        typeof item.turnCount === 'number' &&
        Array.isArray(item.files),
    )
    .slice()
    .sort((a, b) => (b.turnCount ?? 0) - (a.turnCount ?? 0));

  if (checkpoints.length === 0) {
    return (
      <section className="checkpointPanel" aria-label={zh ? '历史快照' : 'History snapshots'}>
        <h4 className="checkpointTitle">{zh ? '历史快照' : 'History Snapshots'}</h4>
        <p className="checkpointEmpty">{zh ? '暂无历史快照' : 'No history snapshots yet'}</p>
      </section>
    );
  }

  return (
    <section className="checkpointPanel" aria-label={zh ? '历史快照' : 'History snapshots'}>
      <h4 className="checkpointTitle">{zh ? '历史快照' : 'History Snapshots'}</h4>
      <ul className="checkpointList">
        {checkpoints.map((checkpoint) => {
          const turnCount = checkpoint.turnCount ?? 0;
          const isLatest = turnCount >= currentTurnCount;
          return (
            <CheckpointEntry
              key={checkpoint.id}
              checkpoint={checkpoint}
              isLatest={isLatest}
              zh={zh}
              onRollback={onRollback}
            />
          );
        })}
      </ul>
    </section>
  );
}

function CheckpointEntry({
  checkpoint,
  isLatest,
  zh,
  onRollback,
}: {
  checkpoint: ThreadItem;
  isLatest: boolean;
  zh: boolean;
  onRollback: (turnCount: number) => void;
}) {
  const turnCount = checkpoint.turnCount ?? 0;
  const files = checkpoint.files ?? [];
  const stats = summarizeFiles(files);
  return (
    <li className="checkpointEntry">
      <div className="checkpointEntryHeader">
        <strong className="checkpointTurn">Turn #{turnCount}</strong>
        {checkpoint.timestamp ? (
          <time className="checkpointTime">{formatTime(checkpoint.timestamp, zh)}</time>
        ) : null}
        {isLatest ? (
          <span className="checkpointLatestTag">{zh ? '当前' : 'Latest'}</span>
        ) : (
          <button
            type="button"
            className="checkpointRollbackButton"
            onClick={() => onRollback(turnCount)}
          >
            {zh ? '回退到此' : 'Rollback to here'}
          </button>
        )}
      </div>
      <div className="checkpointStats">
        <span className="checkpointStat add">+{stats.added}</span>
        <span className="checkpointStat delete">{'\u2212'}{stats.removed}</span>
        <span className="checkpointStat files">
          {files.length} {zh ? '个文件' : 'files'}
        </span>
      </div>
      <ul className="checkpointFileList">
        {files.map((file, index) => (
          <FileCheckpointRow key={`${file.path}-${index}`} file={file} zh={zh} />
        ))}
      </ul>
    </li>
  );
}

function FileCheckpointRow({
  file,
  zh,
}: {
  file: ProjectFileSnapshot;
  zh: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const kind = file.kind as FileKind;
  const icon = FILE_KIND_ICON[kind] ?? '?';
  const label = zh ? FILE_KIND_LABEL_ZH[kind] ?? kind : FILE_KIND_LABEL_EN[kind] ?? kind;
  const hasDiff = file.beforeContent !== null || file.afterContent !== null;
  return (
    <li className={`checkpointFileRow ${kind}`}>
      <button
        type="button"
        className="checkpointFileHeader"
        onClick={() => (hasDiff ? setExpanded((value) => !value) : undefined)}
        aria-expanded={expanded}
        disabled={!hasDiff}
      >
        <span className={`checkpointFileIcon ${kind}`}>{icon}</span>
        <span className="checkpointFilePath" title={file.path}>{file.path}</span>
        <span className="checkpointFileKind">{label}</span>
      </button>
      {expanded && hasDiff ? (
        <div className="checkpointFileDiff">
          <div className="checkpointDiffSide">
            <div className="checkpointDiffLabel">{zh ? '变更前' : 'Before'}</div>
            <pre className="checkpointDiffPre">{file.beforeContent ?? ''}</pre>
          </div>
          <div className="checkpointDiffSide">
            <div className="checkpointDiffLabel">{zh ? '变更后' : 'After'}</div>
            <pre className="checkpointDiffPre">{file.afterContent ?? ''}</pre>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function summarizeFiles(files: ProjectFileSnapshot[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const file of files) {
    if (file.kind === 'add') {
      added += countLines(file.afterContent);
    } else if (file.kind === 'delete') {
      removed += countLines(file.beforeContent);
    } else {
      const diff = computeLineDiff(file.beforeContent, file.afterContent);
      added += diff.added;
      removed += diff.removed;
    }
  }
  return { added, removed };
}

function countLines(content: string | null): number {
  if (!content) return 0;
  const trimmed = content.replace(/\n$/, '');
  if (trimmed.length === 0) return 0;
  return trimmed.split('\n').length;
}

// 基于行级 LCS 的简化 diff，超过阈值时降级为行数差值
const DIFF_LINE_LIMIT = 2000;

function computeLineDiff(
  before: string | null,
  after: string | null,
): { added: number; removed: number } {
  const beforeLines = before ? before.replace(/\n$/, '').split('\n') : [];
  const afterLines = after ? after.replace(/\n$/, '').split('\n') : [];
  if (beforeLines.length === 0) return { added: afterLines.length, removed: 0 };
  if (afterLines.length === 0) return { added: 0, removed: beforeLines.length };
  if (beforeLines.length > DIFF_LINE_LIMIT || afterLines.length > DIFF_LINE_LIMIT) {
    return {
      added: Math.max(0, afterLines.length - beforeLines.length),
      removed: Math.max(0, beforeLines.length - afterLines.length),
    };
  }
  const m = beforeLines.length;
  const n = afterLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (beforeLines[i - 1] === afterLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  const common = dp[m][n];
  return {
    added: n - common,
    removed: m - common,
  };
}

function formatTime(iso: string, zh: boolean): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return zh ? '刚刚' : 'just now';
    if (diffMins < 60) return `${diffMins}${zh ? '分钟前' : 'm ago'}`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}${zh ? '小时前' : 'h ago'}`;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
