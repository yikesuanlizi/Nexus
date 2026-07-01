import { DingtalkClient, type DingtalkMessageAttachment } from '@nexus/bot';
import type { ToolContext, ToolDefinition, ToolResult } from '@nexus/tools';
import {
  BOT_CONFIG_KEY,
  normalizeBotConfig,
  type BotConfig,
} from '../config/botConfig.js';
import type { ThreadStore } from '@nexus/storage';

export const DINGTALK_FORWARD_TOOL_NAME = 'dingtalk_forward_to_group';

export interface DingtalkForwardToolOptions {
  getConfig: () => Promise<BotConfig> | BotConfig;
  createClient?: (config: BotConfig) => DingtalkClient;
  currentUserText?: string;
  mentionUsers?: Array<{ staffId: string; name?: string }>;
  currentAttachments?: DingtalkMessageAttachment[];
}

export function createDingtalkForwardTools(options: DingtalkForwardToolOptions): ToolDefinition[] {
  const execute = (args: Record<string, unknown>, ctx: ToolContext) => executeDingtalkForward(args, ctx, options);
  return [
    {
      name: DINGTALK_FORWARD_TOOL_NAME,
      description: [
        'Forward or send a short message to the configured DingTalk target group.',
        'Use this for DingTalk DM to group forwarding, group mention forwarding, and Nexus chat commands that ask to send something to the DingTalk group.',
        'Do not search files, MCP tools, ports, environment variables, or local APIs to send DingTalk messages.',
      ].join(' '),
      requiredPolicy: 'readonly',
      timeoutMs: 30_000,
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Exact message content to send to the configured DingTalk group. With fileMode, this is an optional caption or note sent after the attachment.',
          },
          targetGroupName: {
            type: 'string',
            description: 'Optional group name mentioned by the user. It must match the configured target group name when one is configured.',
          },
          mentions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional DingTalk display names to mention in the group message, for example ["付守凡"]. The tool resolves them to real user IDs.',
          },
          source: {
            type: 'string',
            enum: ['dingtalk_dm', 'dingtalk_group_mention', 'nexus_chat'],
            description: 'Where the request came from.',
          },
          intent: {
            type: 'string',
            enum: ['send_message', 'forward_user_request', 'announce_reply'],
            description: 'The forwarding intent recognized from the user request.',
          },
          note: {
            type: 'string',
            description: 'Optional private audit note. Do not put secrets or internal IDs here.',
          },
          fileMode: {
            type: 'string',
            enum: ['current_message_files'],
            description: 'Forward files or images attached to the current or most recent DingTalk DM message to the configured group. Only valid for source=dingtalk_dm.',
          },
          fileNames: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional attachment file names to forward from the current DingTalk DM context.',
          },
        },
        required: [],
        additionalProperties: false,
      },
      execute,
    },
  ];
}

export function createDingtalkForwardToolsForStore(store: ThreadStore): ToolDefinition[] {
  return createDingtalkForwardTools({
    getConfig: async () => normalizeBotConfig(await store.getSetting(BOT_CONFIG_KEY)),
  });
}

export function dingtalkForwardingSystemPrompt(locale: string): string {
  if (locale === 'en') {
    return [
      '## DingTalk Group Forwarding',
      `When the user asks to send, forward, announce, coordinate, mention someone, or deliver a task result in the configured DingTalk group, call ${DINGTALK_FORWARD_TOOL_NAME}.`,
      `This includes short requests like "bubble in the group", "mention Alex in the group", "say hi in the group", "send the result to the group after finishing", DingTalk DM requests to forward the current DM attachment/image to the group, follow-ups that refer to the previous DingTalk group delivery, and Nexus chat commands that ask DingTalk to post a message.`,
      'For mentions, put human-readable names in mentions. If message starts with visible @name text, the tool will strip that prefix before sending the webhook Text message so DingTalk can render the real highlighted mention once. Do not invent DingTalk staff IDs.',
      'For attachment forwarding, use fileMode=current_message_files only when the request comes from DingTalk DM and refers to the attached/recent DM file or image. If the user asks for a caption/note or @ mention with that attachment, put the caption in message and human-readable names in mentions. Do not use it for Nexus local files, paths, URLs, or group mention contexts.',
      'Do not discover DingTalk by searching code, reading files, scanning ports, calling MCP, checking environment variables, or curling local APIs.',
      'The tool result is final: if it says sent, answer briefly that it was sent; if it says failed, answer only the failure in user-facing words.',
      'Never reveal conversationId, openConversationId, processQueryKey, messageId, access tokens, tool arguments, or routing internals.',
    ].join('\n');
  }
  return [
    '## 钉钉群转发',
    `当用户要求把内容发送、转发、发布、通知、喊话、冒泡、艾特某人、协调群内事项，或把任务结果交付到已配置的钉钉群时，调用 ${DINGTALK_FORWARD_TOOL_NAME}。`,
    '这包括“在群里冒个泡”“去群里艾特一下某人”“帮我往钉钉群发 xxx”“把这段转到群里”“做完后把结果同步到群里”、钉钉单聊里要求把当前/最近附件或图片转到群里、以及引用上一条钉钉群投递任务的连续对话。',
    '需要 @ 人时，把可读姓名放入 mentions；message 可以包含开头的 @姓名，工具会在 webhook Text 发送前去掉这个普通文本前缀，只保留钉钉真正高亮 @。不要编造钉钉 staff/user ID。',
    '附件转发只用于钉钉单聊附件：用户要求把当前/最近单聊文件或图片发到群里时，使用 fileMode=current_message_files；如果用户同时要求备注/说明/@某人，把备注文本放入 message，把姓名放入 mentions。不要用于 Nexus 本地文件、路径、URL 或群 @ 上下文。',
    '不要搜索代码、不要读取文件、不要扫描端口、不要调用 MCP、不要查环境变量、不要 curl 本地 API 来寻找钉钉发送方式。',
    '工具结果就是最终事实：成功只说明已发送；失败只说明发送失败和用户可理解的原因。',
    '不要向用户透露 conversationId、openConversationId、processQueryKey、messageId、access token、工具参数或其他内部路由细节。',
  ].join('\n');
}

async function executeDingtalkForward(
  args: Record<string, unknown>,
  _ctx: ToolContext,
  options: DingtalkForwardToolOptions,
): Promise<ToolResult> {
  const message = normalizeText(args.message);
  const fileMode = normalizeText(args.fileMode);
  const source = normalizeText(args.source);
  const requestedGroupName = normalizeText(args.targetGroupName);
  const rawMentionStaffIds = normalizeStringArray(args.mentionStaffIds);
  const invalidMentionStaffIds = rawMentionStaffIds.filter((id) => !looksLikeDingtalkStaffId(id));
  const requestedMentionNames = mergeUniqueStrings([
    ...normalizeStringArray(args.mentions).map(stripAtPrefix),
    ...extractMentionNames(message),
    ...extractMentionNames(options.currentUserText ?? ''),
  ]);
  const config = await options.getConfig();
  const targetConversationId = config.dingtalk.targetGroupConversationId?.trim() ?? '';
  const targetSessionWebhook = config.dingtalk.targetGroupSessionWebhook?.trim() ?? '';
  const targetGroupName = config.dingtalk.targetGroupName?.trim() ?? '';

  if (fileMode === 'current_message_files') {
    return forwardDingtalkDmAttachments({
      source,
      config,
      message,
      requestedGroupName,
      targetGroupName,
      targetConversationId,
      targetSessionWebhook,
      clientFactory: options.createClient,
      attachments: options.currentAttachments ?? [],
      fileNames: normalizeStringArray(args.fileNames),
      rawStaffIds: rawMentionStaffIds.filter((id) => looksLikeDingtalkStaffId(id)),
      invalidMentionStaffIds,
      mentionNames: requestedMentionNames,
      mentionUsers: options.mentionUsers ?? [],
      currentUserText: options.currentUserText ?? '',
    });
  }

  if (!message) {
    return failed('消息内容不能为空。', 'DINGTALK_MESSAGE_TEXT_REQUIRED');
  }
  if (!config.dingtalk.enabled) {
    return failed('钉钉机器人未启用。', 'DINGTALK_DISABLED');
  }
  if (!config.dingtalk.clientId.trim() || !config.dingtalk.clientSecret.trim()) {
    return failed('钉钉应用 AppKey 或 AppSecret 未配置。', 'DINGTALK_CREDENTIALS_NOT_CONFIGURED');
  }
  if (!targetConversationId) {
    return failed('还没有配置钉钉目标群会话 ID。请在设置里填写，或先在目标群 @ 我一次以自动检测。', 'DINGTALK_TARGET_GROUP_NOT_CONFIGURED');
  }
  if (requestedGroupName && targetGroupName && requestedGroupName !== targetGroupName) {
    return failed(`当前只配置了钉钉目标群「${targetGroupName}」，没有找到「${requestedGroupName}」。`, 'DINGTALK_TARGET_GROUP_MISMATCH');
  }
  const mentionRequested = containsMentionSyntax(options.currentUserText ?? '') || /艾特|@/.test(options.currentUserText ?? '');
  if (invalidMentionStaffIds.length > 0) {
    return failed('mentionStaffIds 必须是真实钉钉成员 ID，不能填写姓名或 @ 显示名。', 'DINGTALK_MENTION_TARGET_NOT_RESOLVED');
  }

  const client = options.createClient?.(config) ?? new DingtalkClient({
    clientId: config.dingtalk.clientId,
    clientSecret: config.dingtalk.clientSecret,
    robotCode: config.dingtalk.robotCode,
  });
  const mentionResolution = await resolveMentionStaffIds({
    rawStaffIds: rawMentionStaffIds.filter((id) => looksLikeDingtalkStaffId(id)),
    names: requestedMentionNames,
    knownUsers: options.mentionUsers ?? [],
    client,
  });
  if (!mentionResolution.ok) {
    return failed(mentionResolution.reason, mentionResolution.code);
  }
  const mentionStaffIds = mentionResolution.staffIds;
  if ((containsMentionSyntax(message) || mentionRequested) && mentionStaffIds.length === 0) {
    return failed('消息包含 @，但没有识别到对应的钉钉成员 ID，无法触发真正的群 @。', 'DINGTALK_MENTION_TARGET_NOT_RESOLVED');
  }
  const sendOptions = {
    conversationType: '2',
    conversationId: targetConversationId,
    text: message,
    ...(mentionStaffIds.length ? { atStaffIds: mentionStaffIds } : {}),
  };
  let result;
  if (mentionStaffIds.length) {
    if (!targetSessionWebhook) {
      return failed('目标群还没有可用于真实 @ 的 sessionWebhook。请先在目标群 @ 我一次，让我记录这个群的会话 webhook。', 'DINGTALK_GROUP_SESSION_WEBHOOK_REQUIRED_FOR_MENTION');
    }
    const webhookText = stripLeadingMentionText(message, requestedMentionNames) || message;
    result = await client.sendWebhookText({
      webhookUrl: targetSessionWebhook,
      text: webhookText,
      atStaffIds: mentionStaffIds,
    });
  } else {
    result = await client.sendMarkdown(sendOptions);
  }
  if (!result.ok) {
    return failed(result.error ?? 'unknown error', 'DINGTALK_GROUP_SEND_FAILED');
  }
  return { status: 'completed', output: '已发送' };
}

async function forwardDingtalkDmAttachments(options: {
  source: string;
  config: BotConfig;
  message: string;
  requestedGroupName: string;
  targetGroupName: string;
  targetConversationId: string;
  targetSessionWebhook: string;
  clientFactory?: (config: BotConfig) => DingtalkClient;
  attachments: DingtalkMessageAttachment[];
  fileNames: string[];
  rawStaffIds: string[];
  invalidMentionStaffIds: string[];
  mentionNames: string[];
  mentionUsers: Array<{ staffId: string; name?: string }>;
  currentUserText: string;
}): Promise<ToolResult> {
  if (options.source !== 'dingtalk_dm') {
    return failed('文件转发只支持钉钉单聊里的当前或最近附件。', 'DINGTALK_FILE_FORWARD_DM_ONLY');
  }
  if (!options.config.dingtalk.enabled) {
    return failed('钉钉机器人未启用。', 'DINGTALK_DISABLED');
  }
  if (!options.config.dingtalk.clientId.trim() || !options.config.dingtalk.clientSecret.trim()) {
    return failed('钉钉应用 AppKey 或 AppSecret 未配置。', 'DINGTALK_CREDENTIALS_NOT_CONFIGURED');
  }
  if (!options.targetConversationId) {
    return failed('还没有配置钉钉目标群会话 ID。请在设置里填写，或先在目标群 @ 我一次以自动检测。', 'DINGTALK_TARGET_GROUP_NOT_CONFIGURED');
  }
  if (options.requestedGroupName && options.targetGroupName && options.requestedGroupName !== options.targetGroupName) {
    return failed(`当前只配置了钉钉目标群「${options.targetGroupName}」，没有找到「${options.requestedGroupName}」。`, 'DINGTALK_TARGET_GROUP_MISMATCH');
  }
  const selected = selectAttachments(options.attachments, options.fileNames);
  if (!selected.length) {
    return failed('没有可转发的钉钉单聊文件。', 'DINGTALK_FILE_FORWARD_NOT_FOUND');
  }
  const client = options.clientFactory?.(options.config) ?? new DingtalkClient({
    clientId: options.config.dingtalk.clientId,
    clientSecret: options.config.dingtalk.clientSecret,
    robotCode: options.config.dingtalk.robotCode,
  });
  if (typeof client.downloadFile !== 'function') {
    return failed('当前钉钉客户端不支持文件下载。', 'DINGTALK_FILE_DOWNLOAD_UNSUPPORTED');
  }
  if (typeof client.sendFile !== 'function') {
    return failed('当前钉钉客户端不支持文件发送。', 'DINGTALK_FILE_SEND_UNSUPPORTED');
  }
  let captionSend: (() => Promise<ToolResult | null>) | null = null;
  let mentionWarning = '';
  if (options.message) {
    let mentionStaffIds: string[] = [];
    if (options.invalidMentionStaffIds.length > 0) {
      mentionWarning = '未能执行 @：mentionStaffIds 不是有效钉钉成员 ID。';
    } else {
      const mentionResolution = await resolveMentionStaffIds({
        rawStaffIds: options.rawStaffIds,
        names: options.mentionNames,
        knownUsers: options.mentionUsers,
        client,
      });
      if (mentionResolution.ok) {
        mentionStaffIds = mentionResolution.staffIds;
      } else {
        mentionWarning = `未能执行 @：${mentionResolution.reason}`;
      }
    }
    captionSend = async () => {
      let result;
      if (mentionStaffIds.length) {
        if (!options.targetSessionWebhook) {
          return failed('目标群还没有可用于真实 @ 的 sessionWebhook。请先在目标群 @ 我一次，让我记录这个群的会话 webhook。', 'DINGTALK_GROUP_SESSION_WEBHOOK_REQUIRED_FOR_MENTION');
        }
        const webhookText = stripLeadingMentionText(options.message, options.mentionNames) || options.message;
        result = await client.sendWebhookText({
          webhookUrl: options.targetSessionWebhook,
          text: webhookText,
          atStaffIds: mentionStaffIds,
        });
      } else {
        const plainText = stripLeadingMentionText(options.message, options.mentionNames) || options.message;
        result = await client.sendMarkdown({
          conversationType: '2',
          conversationId: options.targetConversationId,
          text: plainText,
        });
      }
      if (!result.ok) {
        return failed(result.error ?? 'unknown error', 'DINGTALK_GROUP_SEND_FAILED');
      }
      return null;
    };
  }
  for (const attachment of selected) {
    if (!attachment.downloadCode) {
      return failed(`文件「${attachment.fileName}」缺少下载凭证，无法转发。`, 'DINGTALK_FILE_DOWNLOAD_CODE_MISSING');
    }
    const download = await client.downloadFile({ downloadCode: attachment.downloadCode });
    if (!download.ok || !download.bytes) {
      return failed(`下载文件「${attachment.fileName}」失败：${download.error ?? 'unknown error'}`, 'DINGTALK_FILE_DOWNLOAD_FAILED');
    }
    const send = await client.sendFile({
      conversationType: '2',
      conversationId: options.targetConversationId,
      fileName: attachment.fileName,
      fileBytes: download.bytes,
      fileSize: attachment.fileSize ?? download.bytes.length,
      mimeType: attachment.mimeType,
    });
    if (!send.ok) {
      return failed(`发送文件「${attachment.fileName}」失败：${send.error ?? 'unknown error'}`, 'DINGTALK_FILE_SEND_FAILED');
    }
  }
  const captionResult = captionSend ? await captionSend() : null;
  if (captionResult) return captionResult;
  return { status: 'completed', output: mentionWarning ? `已发送（${mentionWarning}）` : '已发送' };
}

function selectAttachments(attachments: DingtalkMessageAttachment[], fileNames: string[]): DingtalkMessageAttachment[] {
  const normalizedNames = new Set(fileNames.map(normalizeDingtalkToolText));
  const valid = attachments.filter((attachment) => attachment.fileName.trim());
  if (!normalizedNames.size) return valid;
  return valid.filter((attachment) => normalizedNames.has(normalizeDingtalkToolText(attachment.fileName)));
}

function failed(reason: string, code: string): ToolResult {
  return {
    status: 'failed',
    output: `发送失败：${reason}`,
    error: { message: reason, code },
  };
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item)).filter(Boolean);
}

function inferMentionStaffIds(message: string, users: Array<{ staffId: string; name?: string }>): string[] {
  const normalizedMessage = normalizeDingtalkToolText(message);
  if (!containsMentionSyntax(message)) return [];
  const ids: string[] = [];
  for (const user of users) {
    const staffId = user.staffId.trim();
    const name = user.name?.trim();
    if (!staffId || !name) continue;
    if (normalizedMessage.includes(`@${normalizeDingtalkToolText(name)}`)) {
      ids.push(staffId);
    }
  }
  return mergeUniqueStrings(ids);
}

async function resolveMentionStaffIds(options: {
  rawStaffIds: string[];
  names: string[];
  knownUsers: Array<{ staffId: string; name?: string }>;
  client: DingtalkClient;
}): Promise<
  | { ok: true; staffIds: string[] }
  | { ok: false; reason: string; code: string }
> {
  const staffIds = mergeUniqueStrings([
    ...options.rawStaffIds,
    ...inferMentionStaffIds(options.names.map((name) => `@${name}`).join(' '), options.knownUsers),
  ]);
  if (options.rawStaffIds.length > 0) {
    return { ok: true, staffIds };
  }
  const searchContactUserIds = typeof options.client.searchContactUserIds === 'function'
    ? options.client.searchContactUserIds.bind(options.client)
    : null;
  const searchOrgUserIdsByName = typeof options.client.searchOrgUserIdsByName === 'function'
    ? options.client.searchOrgUserIdsByName.bind(options.client)
    : null;
  for (const rawName of options.names) {
    const name = stripAtPrefix(rawName);
    if (!name) continue;
    if (findKnownMentionStaffId(name, options.knownUsers)) continue;
    if (!searchContactUserIds && !searchOrgUserIdsByName) {
      return {
        ok: false,
        reason: '当前钉钉客户端不支持通讯录或组织成员查询，无法解析 @ 成员。',
        code: 'DINGTALK_MENTION_TARGET_NOT_RESOLVED',
      };
    }
    let contactError = '';
    let userIds: string[] = [];
    if (searchContactUserIds) {
      const result = await searchContactUserIds({ queryWord: name, fullMatch: true, size: 10 });
      if (result.ok) {
        userIds = mergeUniqueStrings(result.userIds ?? []);
      } else {
        contactError = result.error ?? 'unknown error';
      }
    }
    if (userIds.length > 1) {
      return {
        ok: false,
        reason: `钉钉通讯录中找到多个「${name}」，请指定更唯一的姓名、手机号或组织信息。`,
        code: 'DINGTALK_MENTION_TARGET_AMBIGUOUS',
      };
    }
    if (userIds.length === 1) {
      staffIds.push(userIds[0]);
      continue;
    }
    if (searchOrgUserIdsByName) {
      const result = await searchOrgUserIdsByName({ name });
      if (!result.ok) {
        const error = (result.error ?? contactError) || 'unknown error';
        return {
          ok: false,
          reason: `查询钉钉组织成员「${name}」失败：${error}`,
          code: 'DINGTALK_MENTION_TARGET_NOT_RESOLVED',
        };
      }
      userIds = mergeUniqueStrings(result.userIds ?? []);
    }
    if (userIds.length === 0) {
      return {
        ok: false,
        reason: `没有在钉钉通讯录或组织部门中找到「${name}」。`,
        code: 'DINGTALK_MENTION_TARGET_NOT_RESOLVED',
      };
    }
    if (userIds.length > 1) {
      return {
        ok: false,
        reason: `钉钉组织中找到多个「${name}」，请指定更唯一的姓名、手机号或组织信息。`,
        code: 'DINGTALK_MENTION_TARGET_AMBIGUOUS',
      };
    }
    staffIds.push(userIds[0]);
  }
  return { ok: true, staffIds: mergeUniqueStrings(staffIds) };
}

function findKnownMentionStaffId(name: string, users: Array<{ staffId: string; name?: string }>): string {
  const normalizedName = normalizeDingtalkToolText(stripAtPrefix(name));
  if (!normalizedName) return '';
  const match = users.find((user) => normalizeDingtalkToolText(user.name ?? '') === normalizedName);
  return match?.staffId.trim() ?? '';
}

function containsMentionSyntax(message: string): boolean {
  return /@[^\s@，,。:：；;]{1,64}/.test(message);
}

function extractMentionNames(message: string): string[] {
  return [...message.matchAll(/@([^\s@，,。:：；;]{1,64})/g)]
    .map((match) => stripAtPrefix(match[1] ?? ''))
    .filter(Boolean);
}

function stripAtPrefix(value: string): string {
  return value.trim().replace(/^@+/, '').trim();
}

function stripLeadingMentionText(message: string, names: string[]): string {
  let next = message.trim();
  const sortedNames = mergeUniqueStrings(names.map(stripAtPrefix)).sort((a, b) => b.length - a.length);
  for (let changed = true; changed;) {
    changed = false;
    for (const name of sortedNames) {
      if (!name) continue;
      const pattern = new RegExp(`^@\\s*${escapeRegExp(name)}(?:[\\s,，:：;；]+|$)`);
      const stripped = next.replace(pattern, '').trimStart();
      if (stripped !== next) {
        next = stripped;
        changed = true;
        break;
      }
    }
  }
  return next.trim();
}

function looksLikeDingtalkStaffId(value: string): boolean {
  const trimmed = value.trim();
  return /^[A-Za-z0-9_.:-]{2,128}$/.test(trimmed);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mergeUniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeDingtalkToolText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, '')
    .trim();
}
