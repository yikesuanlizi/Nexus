import type { Locale, UserAvatarId } from '../config/config.js';

export const DEFAULT_USER_AVATAR_ID: UserAvatarId = 'asteroid';
export const CUSTOM_USER_AVATAR_ID: UserAvatarId = 'custom';

export const USER_AVATAR_OPTIONS: Array<{ id: UserAvatarId; labelZh: string; labelEn: string }> = [
  { id: 'asteroid', labelZh: '小行星', labelEn: 'Asteroid' },
  { id: 'rocket', labelZh: '小火箭', labelEn: 'Rocket' },
  { id: 'owl', labelZh: '猫头鹰', labelEn: 'Owl' },
  { id: 'crystal', labelZh: '能量水晶', labelEn: 'Crystal' },
  { id: 'paper-plane', labelZh: '纸飞机', labelEn: 'Paper plane' },
  { id: 'fox', labelZh: '小狐狸', labelEn: 'Fox' },
  { id: 'lightning', labelZh: '闪电球', labelEn: 'Lightning' },
  { id: 'mushroom', labelZh: '小蘑菇', labelEn: 'Mushroom' },
];

export function userAvatarLabel(id: string | undefined, locale: Locale): string {
  if (id === CUSTOM_USER_AVATAR_ID) return locale === 'zh' ? '自定义头像' : 'Custom avatar';
  const option = USER_AVATAR_OPTIONS.find((entry) => entry.id === id) ?? USER_AVATAR_OPTIONS[0];
  return locale === 'zh' ? option.labelZh : option.labelEn;
}

export function UserAvatar({
  avatarId = DEFAULT_USER_AVATAR_ID,
  customDataUrl = '',
  size = 'md',
}: {
  avatarId?: string;
  customDataUrl?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const resolvedId = USER_AVATAR_OPTIONS.some((entry) => entry.id === avatarId) ? avatarId as UserAvatarId : DEFAULT_USER_AVATAR_ID;
  if (avatarId === CUSTOM_USER_AVATAR_ID && customDataUrl) {
    return (
      <span className={`userAvatar ${size} custom`} aria-hidden="true">
        <img alt="" src={customDataUrl} />
      </span>
    );
  }
  return (
    <span className={`userAvatar ${size}`} aria-hidden="true">
      <UserAvatarSvg id={resolvedId} />
    </span>
  );
}

function UserAvatarSvg({ id }: { id: UserAvatarId }) {
  switch (id) {
    case 'rocket':
      return (
        <svg className="userAvatarSvg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
          <rect width="120" height="120" fill="#e0f2fe" />
          <ellipse cx="25" cy="85" rx="10" ry="4" fill="#bae6fd" opacity="0.6" />
          <ellipse cx="95" cy="30" rx="8" ry="3" fill="#bae6fd" opacity="0.5" />
          <g transform="rotate(-35 60 55)">
            <path d="M52 78 Q54 95 56 78 Q58 92 60 78 Q62 95 64 78 Q66 92 68 78 Z" fill="#f43f5e">
              <animate attributeName="d" values="M52 78 Q54 95 56 78 Q58 92 60 78 Q62 95 64 78 Q66 92 68 78 Z;M52 78 Q54 88 56 78 Q58 98 60 78 Q62 88 64 78 Q66 98 68 78 Z;M52 78 Q54 95 56 78 Q58 92 60 78 Q62 95 64 78 Q66 92 68 78 Z" dur="0.3s" repeatCount="indefinite" />
            </path>
            <path d="M50 30 Q50 20 60 15 Q70 20 70 30 L70 75 L50 75 Z" fill="#fff" stroke="#0f172a" strokeWidth="4" strokeLinejoin="round" />
            <path d="M50 30 Q60 15 70 30" fill="#f43f5e" stroke="#0f172a" strokeWidth="4" strokeLinejoin="round" />
            <circle cx="60" cy="42" r="7" fill="#38bdf8" stroke="#0f172a" strokeWidth="3" />
            <circle cx="58" cy="40" r="2" fill="#fff" opacity="0.6" />
            <path d="M50 60 L40 78 L50 72 Z" fill="#f43f5e" stroke="#0f172a" strokeWidth="3" strokeLinejoin="round" />
            <path d="M70 60 L80 78 L70 72 Z" fill="#f43f5e" stroke="#0f172a" strokeWidth="3" strokeLinejoin="round" />
            <rect x="52" y="73" width="16" height="6" rx="2" fill="#0f172a" />
          </g>
        </svg>
      );
    case 'owl':
      return (
        <svg className="userAvatarSvg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
          <rect width="120" height="120" fill="#fef3c7" />
          <path d="M20 100 Q60 96 100 100" stroke="#92400e" strokeWidth="5" fill="none" strokeLinecap="round" />
          <ellipse cx="60" cy="60" rx="30" ry="35" fill="#6366f1" stroke="#0f172a" strokeWidth="4" />
          <ellipse cx="60" cy="68" rx="18" ry="22" fill="#a5b4fc" stroke="#0f172a" strokeWidth="3" />
          <path d="M38 32 L34 18 L46 28 Z" fill="#6366f1" stroke="#0f172a" strokeWidth="3" strokeLinejoin="round" />
          <path d="M82 32 L86 18 L74 28 Z" fill="#6366f1" stroke="#0f172a" strokeWidth="3" strokeLinejoin="round" />
          <circle cx="48" cy="48" r="11" fill="#fff" stroke="#0f172a" strokeWidth="3.5" />
          <circle cx="72" cy="48" r="11" fill="#fff" stroke="#0f172a" strokeWidth="3.5" />
          <circle cx="48" cy="48" r="5" fill="#0f172a" />
          <circle cx="72" cy="48" r="5" fill="#0f172a" />
          <circle cx="50" cy="46" r="1.5" fill="#fff" />
          <circle cx="74" cy="46" r="1.5" fill="#fff" />
          <path d="M56 56 L60 62 L64 56 Z" fill="#fbbf24" stroke="#0f172a" strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
      );
    case 'crystal':
      return (
        <svg className="userAvatarSvg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
          <rect width="120" height="120" fill="#1e1b4b" />
          <g opacity="0.3">
            <line x1="60" y1="60" x2="60" y2="8" stroke="#22d3ee" strokeWidth="2"><animate attributeName="opacity" values="0.3;0.6;0.3" dur="2s" repeatCount="indefinite" /></line>
            <line x1="60" y1="60" x2="60" y2="112" stroke="#22d3ee" strokeWidth="2" />
            <line x1="60" y1="60" x2="10" y2="60" stroke="#22d3ee" strokeWidth="2" />
            <line x1="60" y1="60" x2="110" y2="60" stroke="#22d3ee" strokeWidth="2" />
          </g>
          <path d="M60 20 L85 50 L72 95 L48 95 L35 50 Z" fill="#22d3ee" stroke="#0f172a" strokeWidth="4" strokeLinejoin="round">
            <animate attributeName="fill" values="#22d3ee;#06b6d4;#22d3ee" dur="2s" repeatCount="indefinite" />
          </path>
          <path d="M60 20 L60 95" stroke="#0f172a" strokeWidth="3" opacity="0.4" />
          <path d="M35 50 L85 50" stroke="#0f172a" strokeWidth="3" opacity="0.4" />
          <path d="M60 20 L48 50 L60 50 Z" fill="#cffafe" opacity="0.6" />
          <circle cx="60" cy="55" r="4" fill="#fff" opacity="0.8"><animate attributeName="opacity" values="0.8;0.3;0.8" dur="1.5s" repeatCount="indefinite" /></circle>
        </svg>
      );
    case 'paper-plane':
      return (
        <svg className="userAvatarSvg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
          <rect width="120" height="120" fill="#dbeafe" />
          <path d="M15 95 Q40 70 55 55 Q70 40 90 25" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeDasharray="4 4" opacity="0.5" />
          <circle cx="30" cy="80" r="2" fill="#38bdf8" opacity="0.3" />
          <circle cx="50" cy="60" r="2" fill="#38bdf8" opacity="0.4" />
          <g transform="translate(50 28) rotate(25)">
            <path d="M0 0 L45 8 L15 22 L8 30 L5 14 Z" fill="#fff" stroke="#0f172a" strokeWidth="3.5" strokeLinejoin="round" />
            <path d="M0 0 L15 22" stroke="#0f172a" strokeWidth="2.5" fill="none" />
            <path d="M8 30 L5 14 L15 22 Z" fill="#e2e8f0" stroke="none" />
          </g>
          <line x1="95" y1="35" x2="95" y2="50" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M95 35 L105 38 L95 41 Z" fill="#f43f5e" stroke="#0f172a" strokeWidth="2" />
        </svg>
      );
    case 'fox':
      return (
        <svg className="userAvatarSvg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
          <rect width="120" height="120" fill="#fed7aa" />
          <path d="M85 65 Q105 60 102 82 Q98 90 88 82 Z" fill="#f97316" stroke="#0f172a" strokeWidth="4" strokeLinejoin="round" />
          <path d="M95 78 Q102 75 102 82 Q98 88 92 82 Z" fill="#fff" stroke="#0f172a" strokeWidth="3" strokeLinejoin="round" />
          <ellipse cx="55" cy="72" rx="28" ry="26" fill="#f97316" stroke="#0f172a" strokeWidth="4" />
          <ellipse cx="55" cy="80" rx="14" ry="14" fill="#fff" stroke="#0f172a" strokeWidth="3" />
          <path d="M32 48 L28 28 L44 40 Z" fill="#f97316" stroke="#0f172a" strokeWidth="3.5" strokeLinejoin="round" />
          <path d="M78 48 L82 28 L66 40 Z" fill="#f97316" stroke="#0f172a" strokeWidth="3.5" strokeLinejoin="round" />
          <path d="M40 55 Q55 48 70 55 Q65 70 55 68 Q45 70 40 55 Z" fill="#fff" stroke="#0f172a" strokeWidth="2.5" strokeLinejoin="round" />
          <circle cx="46" cy="56" r="3.5" fill="#0f172a" />
          <circle cx="64" cy="56" r="3.5" fill="#0f172a" />
          <ellipse cx="55" cy="64" rx="3" ry="2.5" fill="#0f172a" />
        </svg>
      );
    case 'lightning':
      return (
        <svg className="userAvatarSvg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
          <rect width="120" height="120" fill="#0f172a" />
          <circle cx="60" cy="60" r="42" fill="none" stroke="#fbbf24" strokeWidth="2" opacity="0.3" />
          <circle cx="60" cy="60" r="28" fill="#fbbf24" stroke="#0f172a" strokeWidth="4">
            <animate attributeName="r" values="28;30;28" dur="2s" repeatCount="indefinite" />
          </circle>
          <ellipse cx="52" cy="50" rx="10" ry="6" fill="#fef08a" opacity="0.5" />
          <path d="M62 42 L48 62 L58 62 L54 80 L72 56 L62 56 Z" fill="#0f172a" stroke="#0f172a" strokeWidth="2" strokeLinejoin="round">
            <animate attributeName="opacity" values="1;0.6;1" dur="0.8s" repeatCount="indefinite" />
          </path>
          <path d="M30 50 L25 48" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round"><animate attributeName="opacity" values="1;0;1" dur="0.5s" repeatCount="indefinite" /></path>
          <path d="M90 70 L95 72" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round"><animate attributeName="opacity" values="0;1;0" dur="0.5s" repeatCount="indefinite" /></path>
        </svg>
      );
    case 'mushroom':
      return (
        <svg className="userAvatarSvg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
          <rect width="120" height="120" fill="#d1fae5" />
          <path d="M0 100 Q30 95 60 100 Q90 105 120 100 L120 120 L0 120 Z" fill="#6ee7b7" stroke="#0f172a" strokeWidth="3.5" strokeLinejoin="round" />
          <path d="M48 70 Q48 95 44 100 L76 100 Q72 95 72 70 Z" fill="#fef3c7" stroke="#0f172a" strokeWidth="4" strokeLinejoin="round" />
          <path d="M25 70 Q25 30 60 25 Q95 30 95 70 Z" fill="#f43f5e" stroke="#0f172a" strokeWidth="4" strokeLinejoin="round" />
          <path d="M25 70 Q60 76 95 70" fill="none" stroke="#0f172a" strokeWidth="3.5" />
          <ellipse cx="42" cy="50" rx="6" ry="5" fill="#fff" stroke="#0f172a" strokeWidth="2.5" />
          <ellipse cx="68" cy="42" rx="5" ry="4" fill="#fff" stroke="#0f172a" strokeWidth="2.5" />
          <ellipse cx="78" cy="58" rx="4" ry="3.5" fill="#fff" stroke="#0f172a" strokeWidth="2.5" />
          <ellipse cx="42" cy="38" rx="8" ry="4" fill="#fff" opacity="0.3" />
        </svg>
      );
    case 'asteroid':
    case 'custom':
    default:
      return (
        <svg className="userAvatarSvg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
          <rect width="120" height="120" fill="#0f172a" />
          <circle cx="20" cy="25" r="1.5" fill="#fbbf24"><animate attributeName="opacity" values="1;0.2;1" dur="2s" repeatCount="indefinite" /></circle>
          <circle cx="100" cy="30" r="1" fill="#fbbf24"><animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite" /></circle>
          <circle cx="95" cy="90" r="1.5" fill="#fbbf24"><animate attributeName="opacity" values="1;0.3;1" dur="2.5s" repeatCount="indefinite" /></circle>
          <circle cx="18" cy="85" r="1" fill="#fbbf24" opacity="0.6" />
          <ellipse cx="60" cy="60" rx="48" ry="16" fill="none" stroke="#fbbf24" strokeWidth="2.5" opacity="0.4" transform="rotate(-20 60 60)" />
          <circle cx="60" cy="60" r="24" fill="#fbbf24" />
          <circle cx="60" cy="60" r="24" fill="none" stroke="#0f172a" strokeWidth="4" />
          <ellipse cx="52" cy="52" rx="6" ry="4" fill="#f59e0b" opacity="0.6" />
          <ellipse cx="66" cy="64" rx="5" ry="3" fill="#f59e0b" opacity="0.5" />
          <circle cx="56" cy="68" r="2" fill="#f59e0b" opacity="0.5" />
          <ellipse cx="52" cy="50" rx="8" ry="5" fill="#fef08a" opacity="0.5" />
        </svg>
      );
  }
}
