const FENCED_CODE_BLOCK_RE = /```(\w*)\n([\s\S]*?)```/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const HORIZONTAL_RULE_RE = /^-{3,}$/gm;
const TABLE_SEPARATOR_RE = /^\|[-:| ]+\|$/m;

function convertMarkdownTable(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (i + 1 < lines.length && line.trim().startsWith('|') && TABLE_SEPARATOR_RE.test(lines[i + 1].trim())) {
      const headers = line.trim().replace(/^\||\|$/g, '').split('|').map((h) => h.trim());
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        for (let j = 0; j < headers.length; j++) {
          result.push(`> **${headers[j]}**: ${cells[j] ?? ''}`);
        }
        result.push('');
        i++;
      }
    } else {
      result.push(line);
      i++;
    }
  }
  return result.join('\n');
}

export function adaptMarkdownForDingtalk(text: string): string {
  let result = text;
  result = result.replace(FENCED_CODE_BLOCK_RE, (_match, lang: string, code: string) => {
    const prefix = lang ? `> **${lang}**\n` : '';
    const quoted = code.replace(/\n$/, '').split('\n').map((line: string) => `> ${line}`).join('\n');
    return `${prefix}${quoted}\n`;
  });
  result = result.replace(INLINE_CODE_RE, '**$1**');
  result = convertMarkdownTable(result);
  result = result.replace(HORIZONTAL_RULE_RE, '───────────');
  return result;
}
