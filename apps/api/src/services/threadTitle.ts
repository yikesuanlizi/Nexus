const GENERATED_TITLES = new Set(['', 'Untitled', '未命名对话', 'Nexus']);

export function shouldRetitleThread(title: string | undefined): boolean {
  return GENERATED_TITLES.has((title ?? '').trim());
}

export function titleFromInput(input: string | undefined): string {
  return (input ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
}
