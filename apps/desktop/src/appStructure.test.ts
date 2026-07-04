import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('app module structure', () => {
  it('keeps main.tsx focused on app state and layout', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    expect(source.split('\n').length).toBeLessThanOrEqual(1620);
    expect(source).toContain("from './components/Dialogs.js'");
  });

  it('keeps workflow projects as a split chat plus workflow workspace', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    expect(source).toContain('<section className="transcript"');
    expect(source).toContain('workflowSidePane');
    expect(source).toContain('workspaceView === \'workflow\' ? <section className="workflowSidePane">');
    expect(source).not.toContain('<section className="workflowWorkspace">');
  });

  it('creates a titled workflow project shell without saving an empty workflow definition', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    const createDraft = source.match(/const createWorkflowProjectDraft[\s\S]*?\n\n  useEffect/)?.[0] ?? '';
    expect(createDraft).toContain("setWorkspaceView('workflow')");
    expect(createDraft).toContain('createWorkflowThread(');
    expect(createDraft).toContain('未命名工作流项目');
    expect(createDraft).not.toContain('saveThreadWorkflow(');
    expect(createDraft).not.toContain('createEmptyWorkflowSnapshot');
  });

  it('uses workflow-specific empty transcript text in workflow mode', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    expect(source).toContain("workspaceView === 'workflow'");
    expect(source).toContain('从下方输入工作流目标，或描述节点修改要求。');
  });

  it('clears transient workflow UI state when deleting the active workflow thread', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    const deleteConversation = source.match(/async function deleteConversation[\s\S]*?async function renameConversation/)?.[0] ?? '';
    expect(source).toContain('function resetWorkflowState()');
    expect(deleteConversation).toContain('resetWorkflowState();');
  });

  it('recovers the active workflow from checkpoint items when thread tags are unavailable', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    expect(source).toContain('parseWorkflowCheckpointItems');
    expect(source).toContain('parseThreadWorkflow(activeThread) ?? parseWorkflowCheckpointItems(items)');
  });

  it('drops unconfirmed workflow drafts when switching sidebar threads', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    const selectThread = source.match(/const selectThreadFromSidebar[\s\S]*?const createWorkflowProjectDraft/)?.[0] ?? '';
    expect(selectThread).toContain('resetWorkflowState();');
  });

  it('shows workflow planning input and reply in the chat transcript', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    const requestWorkflowPlan = source.match(/const requestWorkflowPlan[\s\S]*?const commitWorkflowPlan/)?.[0] ?? '';
    expect(requestWorkflowPlan).toContain('createWorkflowDraftUserItem');
    expect(requestWorkflowPlan).toContain('createWorkflowDraftReplyItem');
    expect(requestWorkflowPlan).toContain('createWorkflowDraftErrorItem');
  });

  it('renames untitled workflow project shells after a plan is generated', () => {
    const source = readFileSync(join(here, 'main.tsx'), 'utf-8');
    const requestWorkflowPlan = source.match(/const requestWorkflowPlan[\s\S]*?const commitWorkflowPlan/)?.[0] ?? '';
    expect(requestWorkflowPlan).toContain('isUntitledWorkflowProjectTitle');
    expect(requestWorkflowPlan).toContain('workflowThreadTitleFromGoal');
    expect(requestWorkflowPlan).toContain('renameConversation');
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
