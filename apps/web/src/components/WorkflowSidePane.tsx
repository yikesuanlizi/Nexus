import type { Locale } from '../config/config.js';
import type {
  WorkflowBlueprintCompileResult,
  WorkflowComponentDefinition,
  WorkflowPlanDraft,
  WorkflowRuntimeAction,
  WorkflowSnapshot,
} from '../features/workflow/workflow.js';
import type { RunEvent } from '../shared/types.js';
import { WorkflowPanel } from './WorkflowPanel.js';

export function WorkflowSidePane({
  blueprint = null,
  components = [],
  locale,
  runEvents = [],
  workflow,
  planDraft,
  runtimeBusy,
  saving,
  onCancelPlan,
  onCommitPlan,
  onControl,
  onSave,
  onSelectionChange,
}: {
  blueprint?: WorkflowBlueprintCompileResult | null;
  components?: WorkflowComponentDefinition[];
  locale: Locale;
  runEvents?: RunEvent[];
  workflow: WorkflowSnapshot | null;
  planDraft: WorkflowPlanDraft | null;
  runtimeBusy: boolean;
  saving: boolean;
  onCancelPlan(): void;
  onCommitPlan(): void;
  onControl(action: WorkflowRuntimeAction, nodeId?: string): void;
  onSave(workflow: WorkflowSnapshot): void;
  onSelectionChange?(nodeIds: string[]): void;
}) {
  return (
    <section className="workflowSidePane">
      <WorkflowPanel
        locale={locale}
        workflow={workflow}
        blueprint={blueprint}
        components={components}
        planDraft={planDraft}
        saving={saving}
        runtimeBusy={runtimeBusy}
        onCancelPlan={onCancelPlan}
        onCommitPlan={onCommitPlan}
        onSave={onSave}
        onRunWorkflow={() => onControl('run')}
        onResumeWorkflow={() => onControl('resume')}
        onCancelWorkflow={() => onControl('cancel')}
        onRetryWorkflowNode={(nodeId) => onControl('retry_node', nodeId)}
        onTestWorkflow={() => onControl('test_run')}
        onPublishWorkflow={() => onControl('publish')}
        onSelectionChange={onSelectionChange}
        runEvents={runEvents}
      />
    </section>
  );
}
