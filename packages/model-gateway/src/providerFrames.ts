import type { AnthropicContentBlock, ChatMessage, ToolCall } from './types.js';

export type ProviderAssistantFrame =
  | {
      format: 'openai_chat';
      content: string | null;
      toolCalls?: ToolCall[];
      reasoningContent?: string;
      reasoningDetails?: unknown[];
    }
  | {
      format: 'openai_responses';
      outputItems: unknown[];
    }
  | {
      format: 'anthropic_messages';
      contentBlocks: AnthropicContentBlock[];
    };

export interface ProviderToolResultReplay {
  modelToolCallId: string;
  output: string;
}

export function buildOpenAiChatToolHistory(
  frame: Extract<ProviderAssistantFrame, { format: 'openai_chat' }>,
  results: ProviderToolResultReplay[],
): ChatMessage[] {
  const assistant: ChatMessage = {
    role: 'assistant',
    content: frame.content,
    tool_calls: frame.toolCalls,
  };
  if (frame.reasoningContent) {
    assistant.reasoning_content = frame.reasoningContent;
  }
  if (frame.reasoningDetails) {
    assistant.reasoning_details = frame.reasoningDetails;
  }
  return [
    assistant,
    ...results.map((result): ChatMessage => ({
      role: 'tool',
      tool_call_id: result.modelToolCallId,
      content: result.output,
    })),
  ];
}

export function buildAnthropicToolHistory(
  frame: Extract<ProviderAssistantFrame, { format: 'anthropic_messages' }>,
  results: ProviderToolResultReplay[],
): Array<{ role: 'user' | 'assistant'; content: AnthropicContentBlock[] }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: AnthropicContentBlock[] }> = [{
    role: 'assistant',
    content: frame.contentBlocks,
  }];
  const resultBlocks: AnthropicContentBlock[] = results.map((result) => ({
    type: 'tool_result',
    tool_use_id: result.modelToolCallId,
    content: result.output,
  }));
  if (resultBlocks.length > 0) {
    messages.push({ role: 'user', content: resultBlocks });
  }
  return messages;
}
