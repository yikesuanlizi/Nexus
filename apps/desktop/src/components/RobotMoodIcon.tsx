// 机器人表情 SVG：用于对话消息的 Agent 头像
// 从原 AgentStagePanel 中拆出，仅保留 ItemView 实际使用的 idle / working / thinking 三种变体
// 移除了 main / done / sleep / InteractiveMainRobot 等装饰性代码

export type RobotMoodVariant = 'idle' | 'working' | 'thinking';

export function RobotMoodIcon({ variant }: { variant: RobotMoodVariant }) {
  if (variant === 'working') {
    return (
      <svg className="robotMoodSvg" viewBox="-10 -30 140 160" aria-hidden="true">
        <ellipse cx="60" cy="110" rx="26" ry="5" fill="#cbd5e1">
          <animate attributeName="rx" values="26; 18; 26" dur="0.6s" repeatCount="indefinite" />
        </ellipse>
        <g>
          <animateTransform attributeName="transform" type="translate" values="0,-5; 0,-15; 0,-5" dur="0.6s" repeatCount="indefinite" />
          <rect x="25" y="35" width="70" height="60" rx="20" fill="#a7f3d0" stroke="#0f172a" strokeWidth="5" />
          <line x1="60" y1="35" x2="60" y2="20" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
          <ellipse cx="60" cy="20" rx="20" ry="5" fill="#34d399" stroke="#0f172a" strokeWidth="3">
            <animateTransform attributeName="transform" type="rotate" values="0 60 20; 360 60 20" dur="0.2s" repeatCount="indefinite" />
          </ellipse>
          <rect x="40" y="50" width="40" height="25" rx="8" fill="#0f172a" />
          <g>
            <animateTransform attributeName="transform" type="translate" values="-3,0; 3,0; -3,0" dur="0.8s" repeatCount="indefinite" />
            <circle cx="50" cy="62" r="3" fill="#10b981" />
            <circle cx="70" cy="62" r="3" fill="#10b981" />
          </g>
        </g>
      </svg>
    );
  }

  if (variant === 'thinking') {
    return (
      <svg className="robotMoodSvg" viewBox="-10 -30 140 160" aria-hidden="true">
        <ellipse cx="60" cy="110" rx="26" ry="5" fill="#cbd5e1">
          <animate attributeName="rx" values="26; 18; 26" dur="3s" repeatCount="indefinite" />
        </ellipse>
        <g>
          <animateTransform attributeName="transform" type="translate" values="0,-5; 0,-10; 0,-5" dur="3s" repeatCount="indefinite" />
          <g>
            <animateTransform attributeName="transform" type="rotate" values="-3 60 60; 3 60 60; -3 60 60" dur="4s" repeatCount="indefinite" additive="sum" />
            <rect x="25" y="40" width="70" height="50" rx="18" fill="white" stroke="#0f172a" strokeWidth="5" />
            <path d="M40 90 L30 105" stroke="#0f172a" strokeWidth="5" strokeLinecap="round" />
            <circle cx="25" cy="107" r="8" fill="white" stroke="#0f172a" strokeWidth="4" />
            <circle cx="45" cy="65" r="4" fill="#0f172a">
              <animate attributeName="cy" values="65; 60; 65" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx="75" cy="65" r="4" fill="#0f172a">
              <animate attributeName="cy" values="65; 60; 65" dur="2s" repeatCount="indefinite" />
            </circle>
            <g transform="translate(95, 25)">
              <circle r="8" fill="#fbbf24" stroke="#0f172a" strokeWidth="3">
                <animate attributeName="r" values="8; 10; 8" dur="1s" repeatCount="indefinite" />
              </circle>
            </g>
          </g>
        </g>
      </svg>
    );
  }

  // idle（默认）
  return (
    <svg className="robotMoodSvg" viewBox="-10 -30 140 160" aria-hidden="true">
      <ellipse cx="60" cy="110" rx="26" ry="5" fill="#cbd5e1">
        <animate attributeName="rx" values="26; 18; 26" dur="3s" repeatCount="indefinite" />
      </ellipse>
      <g>
        <animateTransform attributeName="transform" type="translate" values="0,2; 0,-8; 0,2" dur="3s" repeatCount="indefinite" />
        <path d="M60 40 L60 18" stroke="#0f172a" strokeWidth="5" strokeLinecap="round" />
        <circle cx="60" cy="18" r="7" fill="#fbbf24" stroke="#0f172a" strokeWidth="4">
          <animate attributeName="fill" values="#fbbf24; #fef08a; #fbbf24" dur="1.5s" repeatCount="indefinite" />
        </circle>
        <rect x="25" y="35" width="70" height="60" rx="24" fill="#ffffff" stroke="#0f172a" strokeWidth="5" />
        <rect x="35" y="50" width="50" height="30" rx="12" fill="#0f172a" />
        <ellipse cx="48" cy="65" rx="5" ry="7" fill="#38bdf8">
          <animate attributeName="ry" values="7; 1; 7; 7" dur="4s" repeatCount="indefinite" />
        </ellipse>
        <ellipse cx="72" cy="65" rx="5" ry="7" fill="#38bdf8">
          <animate attributeName="ry" values="7; 1; 7; 7" dur="4s" repeatCount="indefinite" />
        </ellipse>
        <circle cx="42" cy="78" r="3" fill="#f43f5e" opacity="0.5" />
        <circle cx="78" cy="78" r="3" fill="#f43f5e" opacity="0.5" />
      </g>
    </svg>
  );
}
