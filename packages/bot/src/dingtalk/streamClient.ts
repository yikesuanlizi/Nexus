import {
  CONVERSATION_TYPE_GROUP,
  CONVERSATION_TYPE_P2P,
  DINGTALK_API_BASE,
  type DingtalkInboundMessage,
  type DingtalkMessageAttachment,
  type DingtalkStartStreamResult,
} from './types.js';
import { DWClient, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream';

interface StreamClientOptions {
  clientId: string;
  clientSecret: string;
  getToken: () => Promise<string>;
  onMessage(msg: DingtalkInboundMessage): void | Promise<void>;
  onStatus?(status: 'connecting' | 'connected' | 'disconnected' | 'error', detail?: string): void;
  timeoutMs?: number;
}

export class DingtalkStreamClient {
  private readonly options: StreamClientOptions;
  private sdkClient: DWClient | null = null;
  private running = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectDelayMs = 60000;

  constructor(options: StreamClientOptions) {
    this.options = options;
  }

  async start(): Promise<DingtalkStartStreamResult> {
    if (this.running) return { connected: true };
    this.running = true;
    this.reconnectAttempts = 0;
    try {
      await this.connect();
      return { connected: true };
    } catch (error) {
      this.running = false;
      return {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  stop(): void {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sdkClient) {
      try { this.sdkClient.disconnect(); } catch { /* ignore */ }
      this.sdkClient = null;
    }
    this.options.onStatus?.('disconnected');
  }

  get isConnected(): boolean {
    return this.sdkClient?.connected === true;
  }

  private async connect(): Promise<void> {
    this.options.onStatus?.('connecting');
    await this.preflightGatewayAuth();
    this.sdkClient = new DWClient({
      clientId: this.options.clientId,
      clientSecret: this.options.clientSecret,
      keepAlive: true,
      debug: false,
    });
    this.sdkClient.registerCallbackListener(TOPIC_ROBOT, (message) => {
      const msg = parseStreamPayload(message);
      if (msg) {
        Promise.resolve(this.options.onMessage(msg)).catch((err) => {
          this.options.onStatus?.('error', err instanceof Error ? err.message : String(err));
        });
      }
      this.sdkClient?.socketCallBackResponse(message.headers.messageId, 'OK');
    });
    await this.sdkClient.connect();
    if (!this.sdkClient.connected) {
      try { this.sdkClient.disconnect(); } catch { /* ignore */ }
      this.sdkClient = null;
      throw new Error('DingTalk Stream SDK did not establish a connection');
    }
    this.sdkClient.on('error', (err) => {
      this.options.onStatus?.('error', err instanceof Error ? err.message : String(err));
    });
    this.sdkClient.on('close', () => {
      this.handleClose();
    });
    this.reconnectAttempts = 0;
    this.options.onStatus?.('connected');
  }

  private async preflightGatewayAuth(): Promise<void> {
    const response = await fetch(`${DINGTALK_API_BASE}/v1.0/gateway/connections/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        clientId: this.options.clientId,
        clientSecret: this.options.clientSecret,
        ua: '',
        subscriptions: [{ type: 'CALLBACK', topic: TOPIC_ROBOT }],
      }),
    });
    if (response.ok) return;
    const detail = await response.text().catch(() => '');
    throw new Error(`DingTalk Stream gateway auth failed: HTTP ${response.status}${formatDingtalkErrorDetail(detail)}`);
  }

  private handleClose(): void {
    this.sdkClient = null;
    if (!this.running) {
      this.options.onStatus?.('disconnected');
      return;
    }
    this.options.onStatus?.('disconnected', 'reconnecting...');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, Math.min(this.reconnectAttempts, 6)), this.maxReconnectDelayMs);
    this.reconnectTimer = setTimeout(() => {
      if (!this.running) return;
      this.connect().catch((err) => {
        this.options.onStatus?.('error', err instanceof Error ? err.message : String(err));
        this.scheduleReconnect();
      });
    }, delay);
  }
}

function formatDingtalkErrorDetail(detail: string): string {
  const trimmed = detail.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as { code?: unknown; message?: unknown; requestid?: unknown };
    const code = typeof parsed.code === 'string' ? parsed.code : '';
    const message = typeof parsed.message === 'string' ? parsed.message : '';
    const requestId = typeof parsed.requestid === 'string' ? parsed.requestid : '';
    const parts = [
      code ? `code=${code}` : '',
      message ? `message=${message}` : '',
      requestId ? `requestid=${requestId}` : '',
    ].filter(Boolean);
    return parts.length ? ` (${parts.join(', ')})` : `: ${trimmed.slice(0, 500)}`;
  } catch {
    return `: ${trimmed.slice(0, 500)}`;
  }
}

function parseStreamPayload(data: DWClientDownStream): DingtalkInboundMessage | null {
  const headers = data.headers as Record<string, unknown> | undefined;
  const topic = headers?.topic as string | undefined;
  if (topic !== TOPIC_ROBOT) return null;

  let body: Record<string, unknown> = {};
  try {
    const rawData = data.data;
    if (typeof rawData === 'string') {
      body = JSON.parse(rawData);
    } else if (rawData && typeof rawData === 'object') {
      body = rawData as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  const conversationType = String(body.conversationType ?? body.conversationtype ?? '').trim() === CONVERSATION_TYPE_GROUP
    ? CONVERSATION_TYPE_GROUP
    : CONVERSATION_TYPE_P2P;
  const conversationId = String(body.conversationId ?? body.openConversationId ?? '').trim();
  const senderStaffId = String(body.senderStaffId ?? body.senderId ?? body.senderNick ?? '').trim();
  const senderNick = String(body.senderNick ?? '').trim();
  const messageId = String(body.msgId ?? body.messageId ?? headers?.messageId ?? '').trim();
  const msgtype = String(body.msgtype ?? body.msgType ?? '').trim();

  let text = '';
  let messageType: DingtalkInboundMessage['messageType'] = 'text';
  if (body.textContent && typeof body.textContent === 'string') {
    text = body.textContent.trim();
  } else if (body.text && typeof body.text === 'object') {
    const textObj = body.text as Record<string, unknown>;
    if (typeof textObj.content === 'string') {
      text = textObj.content.trim();
    }
  } else if (body.content && typeof body.content === 'string') {
    text = body.content.trim();
  } else if (body.richTextContent) {
    messageType = 'richText';
    const rt = body.richTextContent as Record<string, unknown>;
    const rtList = Array.isArray(rt.richTextList) ? rt.richTextList : [];
    text = rtList
      .filter((item) => item && typeof item === 'object' && 'text' in (item as Record<string, unknown>))
      .map((item) => (item as { text: string }).text)
      .join(' ')
      .trim();
  } else if (body.content && typeof body.content === 'object') {
    const content = body.content as Record<string, unknown>;
    const rtList = richTextItems(content);
    if (rtList.length) {
      messageType = 'richText';
      text = rtList
        .map((item) => (typeof item.text === 'string' ? item.text : ''))
        .filter(Boolean)
        .join(' ')
        .trim();
    }
  }
  if (msgtype === 'picture') {
    messageType = 'image';
  } else if (msgtype === 'file') {
    messageType = 'file';
  } else if (msgtype === 'richText') {
    messageType = 'richText';
  }
  const attachments = parseAttachments(body, messageId);
  if (!text && attachments.length) {
    const hasFile = attachments.some((item) => item.type === 'file');
    text = hasFile ? attachments.map((item) => item.fileName).join(' ').trim() : '图片';
    messageType = hasFile ? 'file' : 'image';
  }

  const atUsers = parseAtUsers(body);
  const chatbotUserId = String(body.chatbotUserId ?? '').trim();
  const isAtBot = chatbotUserId
    ? atUsers.some((u) => u.dingtalkId === chatbotUserId) || Boolean(body.isInAtList)
    : false;

  if (!text || !messageId) return null;
  const finalConvId = conversationType === CONVERSATION_TYPE_GROUP
    ? conversationId || String(body.conversationId ?? '').trim()
    : senderStaffId;
  if (!finalConvId) return null;

  return {
    conversationType,
    conversationId: finalConvId,
    senderStaffId,
    senderNick,
    messageId,
    text,
    messageType,
    isAtBot: conversationType === CONVERSATION_TYPE_GROUP ? isAtBot : true,
    atUsers,
    sessionWebhook: typeof body.sessionWebhook === 'string' ? body.sessionWebhook.trim() : undefined,
    ...(attachments.length ? { attachments } : {}),
  };
}

function parseAttachments(body: Record<string, unknown>, messageId: string): DingtalkMessageAttachment[] {
  const fallbackBase = safeAttachmentBaseName(messageId || 'dingtalk-attachment');
  const candidates = [
    body.fileContent,
    body.file,
    body.fileMessage,
    body.imageContent,
    body.image,
    body.picture,
    body.attachment,
    body.content,
  ];
  const attachments: DingtalkMessageAttachment[] = [];
  for (const candidate of candidates) {
    const attachment = parseAttachment(candidate, `${fallbackBase}.jpg`);
    if (attachment) attachments.push(attachment);
  }
  const content = body.content && typeof body.content === 'object' ? body.content as Record<string, unknown> : null;
  const rtList = content ? richTextItems(content) : [];
  let index = 0;
  for (const item of rtList) {
    const kind = String(item.type ?? item.msgtype ?? item.msgType ?? '').toLowerCase();
    const hasAttachmentPayload = Boolean(item.downloadCode ?? item.download_code ?? item.pictureDownloadCode ?? item.picture_download_code ?? item.downloadUrl ?? item.download_url ?? item.mediaId ?? item.media_id);
    if (!hasAttachmentPayload) continue;
    if (kind && !/picture|image|file/.test(kind)) continue;
    index++;
    const attachment = parseAttachment(item, `${fallbackBase}-${index}.jpg`);
    if (attachment) attachments.push(attachment);
  }
  return attachments;
}

function parseAttachment(value: unknown, fallbackFileName?: string): DingtalkMessageAttachment | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const rawType = String(record.type ?? record.msgtype ?? record.msgType ?? '').toLowerCase();
  const downloadCode = String(record.downloadCode ?? record.download_code ?? record.pictureDownloadCode ?? record.picture_download_code ?? '').trim();
  const downloadUrl = String(record.downloadUrl ?? record.download_url ?? '').trim();
  const mediaId = String(record.mediaId ?? record.media_id ?? '').trim();
  const inferredImage = /picture|image/.test(rawType) || Boolean(record.pictureDownloadCode);
  const fileName = String(record.fileName ?? record.name ?? record.filename ?? (inferredImage ? fallbackFileName : '') ?? '').trim();
  if (!fileName || (!downloadCode && !downloadUrl && !mediaId)) return null;
  const fileSize = Number(record.fileSize ?? record.size);
  const mimeType = String(record.mimeType ?? record.contentType ?? '').trim();
  const type = /\.(png|jpe?g|gif|webp|bmp)$/i.test(fileName) || inferredImage
    ? 'image'
    : 'file';
  return {
    type,
    fileName,
    ...(Number.isFinite(fileSize) ? { fileSize } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(downloadCode ? { downloadCode } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(mediaId ? { mediaId } : {}),
  };
}

function richTextItems(record: Record<string, unknown>): Array<Record<string, unknown>> {
  const raw = Array.isArray(record.richText)
    ? record.richText
    : Array.isArray(record.richTextList)
      ? record.richTextList
      : [];
  return raw.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object');
}

function safeAttachmentBaseName(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'dingtalk-attachment';
}

function parseAtUsers(body: Record<string, unknown>): Array<{ dingtalkId: string; staffId?: string }> {
  const raw = body.atUsers;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((u): u is Record<string, unknown> => u !== null && typeof u === 'object')
    .map((u) => ({
      dingtalkId: String(u.dingtalkId ?? '').trim(),
      staffId: u.staffId ? String(u.staffId).trim() : undefined,
    }))
    .filter((u) => u.dingtalkId);
}
