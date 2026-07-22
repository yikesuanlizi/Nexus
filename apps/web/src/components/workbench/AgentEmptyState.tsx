import type { Locale } from '../../config/config.js';

export function AgentEmptyState({ locale }: { locale: Locale }) {
  const zh = locale === 'zh';
  return (
    <div className="agentEmptyState">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <rect x="10" y="14" width="28" height="22" rx="4" fill="currentColor" opacity="0.1" />
        <circle cx="18" cy="24" r="2.5" fill="currentColor" opacity="0.4" />
        <circle cx="30" cy="24" r="2.5" fill="currentColor" opacity="0.4" />
        <path d="M18 30c2 1.5 10 1.5 12 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
        <rect x="22" y="8" width="4" height="6" rx="1" fill="currentColor" opacity="0.2" />
        <circle cx="24" cy="7" r="2" fill="currentColor" opacity="0.3" />
      </svg>
      <p>{zh ? '等待任务开始' : 'Waiting for task to start'}</p>
      <span>{zh ? '发送消息后，Agent 活动将显示在这里' : 'Agent activity will appear here after you send a message'}</span>
    </div>
  );
}
