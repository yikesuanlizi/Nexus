import type { UserInput } from '@nexus/protocol';

export type WebSearchMode = 'auto' | 'on' | 'off';

const SEARCH_TRIGGERS = [
  '联网',
  '搜索',
  '查一下',
  '最新',
  '今天',
  '新闻',
  'web_search',
  'web search',
  'search the web',
  'look up',
  'latest',
  'recent',
  'current',
  'today',
];

export function shouldEnableWebSearch(mode: WebSearchMode, input: UserInput): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  const text = userInputToText(input).toLowerCase();
  return SEARCH_TRIGGERS.some((trigger) => text.includes(trigger.toLowerCase()));
}

function userInputToText(input: UserInput): string {
  if (input.type === 'text') return input.text;
  return input.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}
