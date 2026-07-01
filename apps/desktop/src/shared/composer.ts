export function resizeTextareaToContent(textarea: HTMLTextAreaElement | null, maxHeight = 180): void {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
}
