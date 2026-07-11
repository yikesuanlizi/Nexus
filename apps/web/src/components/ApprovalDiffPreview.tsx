import type React from 'react';
import { DiffView } from './DiffView.js';
import { extractApprovalDiffHunks } from './approvalDiffParser.js';
import type { Locale } from '../config/config.js';

// 审批 diff 预览 props — English: approval diff preview props
export interface ApprovalDiffPreviewProps {
  // 工具调用参数原始值（approval.required 事件的 payload）
  // — English: raw tool arguments from approval.required payload
  payload: unknown;
  locale?: Locale;
}

export function ApprovalDiffPreview({ payload, locale = 'zh' }: ApprovalDiffPreviewProps) {
  const hunks = extractApprovalDiffHunks(payload);
  if (hunks.length === 0) return null;
  return <DiffView hunks={hunks} locale={locale} />;
}
