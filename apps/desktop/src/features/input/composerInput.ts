export interface UrlToken {
  value: string;
  label: string;
}

export function extractUrlTokens(text: string): UrlToken[] {
  const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  return matches
    .map((value) => stripUrlPunctuation(value))
    .filter((value, index, current) => Boolean(value) && current.indexOf(value) === index)
    .map((value) => ({
      value,
      label: summarizeUrlToken(value),
    }));
}

export function isGitHubSkillInstallUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    const hostname = parsed.hostname.replace(/^www\./, '');
    if (hostname !== 'github.com') return false;
    const parts = parsed.pathname.split('/').filter(Boolean);
    const [, repo, marker, ref, ...rest] = parts;
    if (!repo || !ref || (marker !== 'blob' && marker !== 'tree')) return false;
    const path = rest.join('/');
    if (marker === 'blob') {
      return path === 'SKILL.md' || path.endsWith('/SKILL.md');
    }
    const pathParts = path.split('/').filter(Boolean);
    return pathParts.length === 2 && pathParts[0]?.toLowerCase() === 'skills';
  } catch {
    return false;
  }
}

export function extractGitHubSkillInstallUrls(text: string): string[] {
  return extractUrlTokens(text)
    .map((token) => token.value)
    .filter(isGitHubSkillInstallUrl);
}

export function summarizeUrlToken(value: string): string {
  try {
    const parsed = new URL(value.trim());
    const hostname = parsed.hostname.replace(/^www\./, '');
    const parts = parsed.pathname.split('/').filter(Boolean);
    const tail = parts.slice(-2).join('/');
    return tail ? `${hostname}/${tail}` : hostname;
  } catch {
    return value;
  }
}

function stripUrlPunctuation(value: string): string {
  return value.replace(/[),.;:!?]+$/g, '').trim();
}
