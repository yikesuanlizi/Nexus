import { describe, expect, it } from 'vitest';
import { buildTurnFileSummary } from './turnFileSummary.js';

describe('buildTurnFileSummary', () => {
  it('summarizes read and changed files with full paths and change stats', () => {
    const summary = buildTurnFileSummary([
      {
        id: 'read-1',
        type: 'tool_call',
        toolName: 'read_file',
        arguments: { filePath: 'apps/web/src/main.tsx' },
        result: { path: 'E:\\langchain\\Nexus\\apps\\web\\src\\main.tsx' },
        status: 'completed',
      },
      {
        id: 'change-1',
        type: 'file_change',
        changes: [
          { path: 'apps/web/src/components/ItemView.tsx', kind: 'update', addedLines: 5, removedLines: 2 },
        ],
        status: 'completed',
      },
    ], 'E:\\langchain\\Nexus');

    expect(summary.readFiles).toEqual([
      { path: 'E:\\langchain\\Nexus\\apps\\web\\src\\main.tsx' },
    ]);
    expect(summary.changedFiles).toEqual([
      { path: 'E:\\langchain\\Nexus\\apps\\web\\src\\components\\ItemView.tsx', addedLines: 5, removedLines: 2 },
    ]);
  });

  it('filters internal temporary paths', () => {
    const summary = buildTurnFileSummary([
      {
        id: 'read-temp',
        type: 'tool_call',
        toolName: 'read_file',
        arguments: { filePath: 'C:\\Users\\me\\AppData\\Local\\Temp\\script.ts' },
        status: 'completed',
      },
      {
        id: 'change-temp',
        type: 'file_change',
        changes: [{ path: '.codex/tmp-script.ts', kind: 'add', addedLines: 1, removedLines: 0 }],
        status: 'completed',
      },
    ], 'E:\\langchain\\Nexus');

    expect(summary.readFiles).toEqual([]);
    expect(summary.changedFiles).toEqual([]);
  });

  it('filters root helper artifacts and keeps the real project document from command arguments', () => {
    const summary = buildTurnFileSummary([
      {
        id: 'read-dump',
        type: 'tool_call',
        toolName: 'read_file',
        arguments: { filePath: 'E:\\langchain\\dexin-agent\\_docx_dump.txt' },
        status: 'completed',
      },
      {
        id: 'change-helper',
        type: 'file_change',
        changes: [{ path: 'E:\\langchain\\dexin-agent\\_read_docx.py', kind: 'add', addedLines: 14, removedLines: 0 }],
        status: 'completed',
      },
      {
        id: 'command-docx',
        type: 'command_execution',
        command: 'python _read_docx.py "E:\\langchain\\dexin-agent\\智能体运行平台详细架构设计_v0.9.docx" > _docx_dump.txt',
        status: 'completed',
      },
    ], 'E:\\langchain\\dexin-agent');

    expect(summary.readFiles).toEqual([
      { path: 'E:\\langchain\\dexin-agent\\智能体运行平台详细架构设计_v0.9.docx' },
    ]);
    expect(summary.changedFiles).toEqual([]);
  });

  it('extracts bare project filenames from commands without treating URLs as files', () => {
    const summary = buildTurnFileSummary([
      {
        id: 'command-docx-name',
        type: 'command_execution',
        command: 'python _read_docx.py 需求说明.docx && curl https://example.com/report.pdf',
        status: 'completed',
      },
    ], 'E:\\langchain\\dexin-agent');

    expect(summary.readFiles).toEqual([
      { path: 'E:\\langchain\\dexin-agent\\需求说明.docx' },
    ]);
  });
});
