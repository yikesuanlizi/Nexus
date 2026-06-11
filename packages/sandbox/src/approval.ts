import type { ApprovalRequest } from '@nexus/protocol';

/**
 * Callback interface for Human-In-The-Loop approval.
 * Implementations can prompt the user (CLI, Web UI, etc.).
 */
export interface ApprovalHandler {
  /** Request approval. Returns the user's decision. */
  requestApproval(req: ApprovalRequest): Promise<{ approved: boolean; reason?: string }>;
}

/** A no-op handler that auto-denies everything (safest default). */
export class DenyAllApprovalHandler implements ApprovalHandler {
  async requestApproval(req: ApprovalRequest) {
    return { approved: false, reason: 'No approval handler configured — denying by default' };
  }
}

/** Auto-approve handler (for trusted environments). */
export class AutoApproveHandler implements ApprovalHandler {
  async requestApproval(req: ApprovalRequest) {
    return { approved: true, reason: 'auto-approved' };
  }
}
