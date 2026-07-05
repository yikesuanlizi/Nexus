import React from 'react';

export type IconName =
  | 'activity'
  | 'browser'
  | 'branch'
  | 'calendar'
  | 'calculator'
  | 'chevron'
  | 'chevronDown'
  | 'chevronRight'
  | 'clip'
  | 'copy'
  | 'database'
  | 'doc'
  | 'download'
  | 'eye'
  | 'eyeOff'
  | 'file'
  | 'folder'
  | 'folderCode'
  | 'folderPlus'
  | 'gear'
  | 'github'
  | 'hash'
  | 'layers'
  | 'link'
  | 'memoryChip'
  | 'mermaid'
  | 'message'
  | 'monitor'
  | 'moon'
  | 'panel'
  | 'pen'
  | 'play'
  | 'plus'
  | 'puppet'
  | 'question'
  | 'refresh'
  | 'review'
  | 'search'
  | 'send'
  | 'spark'
  | 'sql'
  | 'stop'
  | 'sun'
  | 'terminal'
  | 'trash'
  | 'translate'
  | 'workflow'
  | 'wrench'
  | 'x';

export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    activity: <path d="M3 12h4l2-7 4 14 2-7h6" />,
    browser: (
      <>
        <rect x="2" y="3" width="20" height="18" rx="2" />
        <line x1="2" y1="9" x2="22" y2="9" />
        <circle cx="6" cy="6" r="0.8" fill="currentColor" stroke="none" />
        <circle cx="9" cy="6" r="0.8" fill="currentColor" stroke="none" />
      </>
    ),
    branch: <path d="M6 4v5a3 3 0 0 0 3 3h6M6 20v-5a3 3 0 0 1 3-3m6-4 4 4-4 4" />,
    calendar: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </>
    ),
    calculator: (
      <>
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <line x1="8" y1="6" x2="16" y2="6" />
        <line x1="8" y1="12" x2="8" y2="12" />
        <line x1="12" y1="12" x2="12" y2="12" />
        <line x1="16" y1="12" x2="16" y2="12" />
        <line x1="8" y1="16" x2="8" y2="16" />
        <line x1="12" y1="16" x2="12" y2="16" />
        <line x1="16" y1="16" x2="16" y2="16" />
      </>
    ),
    chevron: <path d="m15 18-6-6 6-6" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    chevronRight: <path d="m9 6 6 6-6 6" />,
    clip: <path d="m21.4 11.6-8.6 8.6a5 5 0 0 1-7.1-7.1l9.2-9.2a3.5 3.5 0 0 1 5 5l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />,
    copy: <path d="M8 8h11v11H8zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />,
    database: (
      <>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </>
    ),
    doc: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="13" y2="17" />
      </>
    ),
    download: <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />,
    eye: <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />,
    eyeOff: <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.1 4.1M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4.1-.8" />,
    file: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 13h8M8 17h5" />,
    folder: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />,
    folderCode: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Zm6.5 4L7 14l2.5 2.5M14.5 11.5 17 14l-2.5 2.5" />,
    folderPlus: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Zm9 3v5m-2.5-2.5h5" />,
    gear: <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.2 4.8a7.7 7.7 0 0 0 0-2.6l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.2-1.3L15.3 3h-4l-.3 2.5a8 8 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.5a7.7 7.7 0 0 0 0 2.6l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.2 1.3l.3 2.5h4l.3-2.5a8 8 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.5Z" />,
    github: <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />,
    hash: <path d="M10 3 8 21M16 3l-2 18M4 9h17M3 15h17" />,
    layers: <path d="m12 3 9 5-9 5-9-5 9-5Zm-7 9 7 4 7-4M5 16l7 4 7-4" />,
    link: (
      <>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </>
    ),
    memoryChip: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="8" y="8" width="8" height="8" rx="1" />
        <line x1="9" y1="2" x2="9" y2="4" />
        <line x1="15" y1="2" x2="15" y2="4" />
        <line x1="9" y1="20" x2="9" y2="22" />
        <line x1="15" y1="20" x2="15" y2="22" />
      </>
    ),
    mermaid: (
      <>
        <rect x="3" y="3" width="6" height="6" rx="1" />
        <rect x="15" y="15" width="6" height="6" rx="1" />
        <rect x="15" y="3" width="6" height="6" rx="1" />
        <line x1="9" y1="6" x2="15" y2="6" />
        <line x1="18" y1="9" x2="18" y2="15" />
      </>
    ),
    message: <path d="M4 5h16v11H8l-4 4V5Z" />,
    monitor: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 20h8" />
        <path d="M12 17v3" />
      </>
    ),
    moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.8 6.8 0 0 0 20 14.5Z" />,
    panel: <path d="M4 5h16v14H4zM15 5v14" />,
    pen: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" />,
    play: <path d="M8 5v14l11-7L8 5Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    puppet: (
      <>
        <line x1="12" y1="2" x2="12" y2="8" />
        <line x1="6" y1="4" x2="9" y2="8" />
        <line x1="18" y1="4" x2="15" y2="8" />
        <rect x="8" y="8" width="8" height="8" rx="1" />
        <line x1="6" y1="14" x2="8" y2="12" />
        <line x1="18" y1="14" x2="16" y2="12" />
        <line x1="10" y1="16" x2="10" y2="20" />
        <line x1="14" y1="16" x2="14" y2="20" />
      </>
    ),
    question: <path d="M9.1 9a3 3 0 1 1 4.8 2.4c-1 .7-1.9 1.3-1.9 2.6m0 3h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" />,
    refresh: <path d="M20 6v5h-5M4 18v-5h5M18.2 9A7 7 0 0 0 6.7 6.8L4 9.5m16 5-2.7 2.7A7 7 0 0 1 5.8 15" />,
    review: (
      <>
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </>
    ),
    search: <path d="m21 21-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />,
    send: <path d="M21 3 10.5 21l-2-7.5L1 11l20-8Zm-12.5 10.5L21 3" />,
    spark: <path d="M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8L12 3Zm6 11 1 2.7 2.7 1-2.7 1-1 2.8-1-2.8-2.7-1 2.7-1 1-2.7ZM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Z" />,
    sql: (
      <>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 5v6c0 1.66-4 3-9 3s-9-1.34-9-3V5" />
        <path d="M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6" />
      </>
    ),
    stop: <path d="M8 8h8v8H8z" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" />
      </>
    ),
    terminal: <path d="m4 7 5 5-5 5M11 17h9" />,
    trash: <path d="M4 7h16M9 7V5h6v2m-8 3 .5 10h9l.5-10" />,
    translate: (
      <>
        <path d="M4 5h7" />
        <path d="M9 3v2c0 4.418-2.239 8-5 8" />
        <path d="M5 9c0 2.144 2.952 3.908 6.7 4" />
        <path d="M12 20l4-9 4 9" />
        <path d="M14.5 16.5h3" />
      </>
    ),
    workflow: <path d="M6 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm12 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM9 8h4a3 3 0 0 1 3 3v2M15 16h-4a3 3 0 0 1-3-3v-2" />,
    wrench: <path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.8 2.8-2.1-2.1 2.8-2.8Z" />,
    x: <path d="M18 6 6 18M6 6l12 12" />,
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}
