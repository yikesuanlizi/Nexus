export const DINGTALK_API_BASE = 'https://api.dingtalk.com';
export const DINGTALK_OAPI_BASE = 'https://oapi.dingtalk.com';

export const CONVERSATION_TYPE_P2P = '1';
export const CONVERSATION_TYPE_GROUP = '2';

export const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024;

export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface DingtalkSendBaseOptions {
  conversationType: string;
  conversationId: string;
  atStaffIds?: string[];
}

export interface DingtalkSendTextOptions extends DingtalkSendBaseOptions {
  text: string;
}

export interface DingtalkSendWebhookTextOptions {
  webhookUrl: string;
  text: string;
  atStaffIds?: string[];
}

export interface DingtalkSendFileOptions extends DingtalkSendBaseOptions {
  filePath?: string;
  fileName: string;
  fileBytes?: Uint8Array;
  fileSize?: number;
  mimeType?: string;
}

export interface DingtalkDownloadFileOptions {
  downloadCode: string;
}

export interface DingtalkDownloadFileResult {
  ok: boolean;
  bytes?: Uint8Array;
  error?: string;
}

export interface DingtalkTokenResult {
  accessToken: string;
  expiresIn: number;
}

export interface DingtalkSendResult {
  ok: boolean;
  processQueryKey?: string;
  messageId?: string;
  cardInstanceId?: string;
  error?: string;
}

export interface DingtalkSearchContactUserIdsOptions {
  queryWord: string;
  fullMatch?: boolean;
  size?: number;
  offset?: number;
}

export interface DingtalkSearchContactUserIdsResult {
  ok: boolean;
  userIds?: string[];
  error?: string;
}

export interface DingtalkSearchOrgUserIdsByNameOptions {
  name: string;
  rootDeptId?: number;
  maxDepartments?: number;
}

export interface DingtalkSearchOrgUserIdsByNameResult {
  ok: boolean;
  userIds?: string[];
  error?: string;
}

export interface DingtalkMessageAttachment {
  type: 'file' | 'image';
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  downloadCode?: string;
  downloadUrl?: string;
  mediaId?: string;
}

export interface DingtalkAICardCreateOptions {
  cardTemplateId: string;
  outTrackId?: string;
  conversationType?: string;
  conversationId?: string;
}

export interface DingtalkAICardCreateResult {
  ok: boolean;
  cardInstanceId?: string;
  error?: string;
}

export interface DingtalkAICardUpdateOptions {
  cardInstanceId: string;
  content: string;
  contentType?: 'markdown' | 'text';
  append?: boolean;
}

export interface DingtalkAICardFinalizeOptions {
  cardInstanceId: string;
}

export interface DingtalkSendCardOptions extends DingtalkSendBaseOptions {
  cardTemplateId: string;
  cardInstanceId: string;
}

export interface DingtalkReplyWithCardOptions extends DingtalkSendBaseOptions {
  cardTemplateId: string;
  thinkingText?: string;
  markdown: string;
}

export interface DingtalkInboundMessage {
  conversationType: string;
  conversationId: string;
  senderStaffId: string;
  senderNick: string;
  messageId: string;
  text: string;
  messageType: 'text' | 'richText' | 'file' | 'image';
  isAtBot?: boolean;
  atUsers?: Array<{ dingtalkId: string; staffId?: string }>;
  sessionWebhook?: string;
  attachments?: DingtalkMessageAttachment[];
}

export interface DingtalkWebhookEvent {
  msgtype: string;
  text?: { content: string };
  msgId?: string;
  createAt?: number;
  conversationType?: '1' | '2';
  conversationId?: string;
  senderId?: string;
  senderNick?: string;
  senderStaffId?: string;
  chatbotUserId?: string;
  atUsers?: Array<{ dingtalkId: string; staffId?: string }>;
  isInAtList?: boolean;
  sessionWebhook?: string;
  [key: string]: unknown;
}

export type DingtalkConnectionMode = 'stream' | 'webhook';

export interface DingtalkClientOptions {
  clientId: string;
  clientSecret: string;
  robotCode?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface DingtalkStartStreamResult {
  connected: boolean;
  error?: string;
}
