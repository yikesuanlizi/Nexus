import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('app module structure', () => {
  it('keeps main.tsx focused on app state and layout', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    expect(source.split('\n').length).toBeLessThanOrEqual(1760);
    expect(source).toContain("from './components/Dialogs.js'");
  });

  it('renders workflow projects in a dedicated side pane instead of the generic right pane tabs', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    expect(source).toContain('WorkflowSidePane');
    expect(source).toContain("isWorkflowProject ? 'workflow'");
  });

  it('routes workflow composer submissions to workflow planning instead of ordinary chat turns', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    expect(source).toContain('if (isWorkflowProject)');
    expect(source).toContain('await requestWorkflowPlan(goal)');
    expect(source).toContain('workflowMode={isWorkflowProject}');
    expect(source).toContain('!isWorkflowProject && !activeSlashOption');
  });

  it('uses workflow-specific empty transcript text for workflow projects', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    expect(source).toContain('items.length === 0');
    expect(source).toContain('isWorkflowProject');
    expect(source).toContain('从下方输入工作流目标，或描述节点修改要求。');
  });

  it('stops the in-flight turn even before the newly created thread id reaches React state', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    expect(source).toContain('const activeTurnThreadIdRef = useRef');
    const sendMessage = source.match(/async function sendMessage[\s\S]*?async function stopTurn/)?.[0] ?? '';
    expect(sendMessage).toContain('activeTurnThreadIdRef.current = activeThreadId;');
    const stopTurn = source.match(/async function stopTurn[\s\S]*?async function decideApproval/)?.[0] ?? '';
    expect(stopTurn).toContain('const targetThreadId = activeTurnThreadIdRef.current || threadId');
    expect(stopTurn).toContain('`/api/threads/${targetThreadId}/interrupt`');
    expect(stopTurn).not.toContain('if (!threadId) return;');
  });
});
