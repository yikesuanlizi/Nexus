export function resizeTextareaToContent(textarea: HTMLTextAreaElement | null, maxHeight = 420): void {
  if (!textarea) return;
  const currentHeight = textarea.getBoundingClientRect().height;
  const userResized = textarea.dataset.userResized === 'true';
  textarea.style.height = 'auto';
  const contentHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${userResized ? Math.max(currentHeight, contentHeight) : contentHeight}px`;
}
