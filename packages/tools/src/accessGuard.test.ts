import { describe, expect, it } from 'vitest';
import { resolveToolPathAccess } from './accessGuard.js';

describe('resolveToolPathAccess', () => {
  it('resolves relative paths inside workspace', () => {
    const request = resolveToolPathAccess({
      workspaceRoot: 'E:\\langchain\\Nexus',
      path: 'README.md',
      access: 'read',
      threadId: 'thread-1',
      turnId: 'turn-1',
      toolName: 'read_file',
      description: 'read file',
    });

    expect(request.target).toEqual({ kind: 'path', path: 'E:\\langchain\\Nexus\\README.md' });
  });

  it('does not rewrite absolute external paths into the workspace', () => {
    const request = resolveToolPathAccess({
      workspaceRoot: 'E:\\langchain\\Nexus',
      path: 'E:\\langchain\\dexin-agent\\v1.docx',
      access: 'read',
      threadId: 'thread-1',
      turnId: 'turn-1',
      toolName: 'read_document',
      description: 'read document',
    });

    expect(request.target).toEqual({ kind: 'path', path: 'E:\\langchain\\dexin-agent\\v1.docx' });
  });

  it('normalizes dot-dot traversal before runtime policy evaluation', () => {
    const request = resolveToolPathAccess({
      workspaceRoot: 'E:\\langchain\\Nexus',
      path: '..\\dexin-agent\\v1.docx',
      access: 'read',
      threadId: 'thread-1',
      turnId: 'turn-1',
      toolName: 'read_document',
      description: 'read document',
    });

    expect(request.target).toEqual({ kind: 'path', path: 'E:\\langchain\\dexin-agent\\v1.docx' });
  });
});
