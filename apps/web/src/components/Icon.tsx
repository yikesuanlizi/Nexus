import React from 'react';

export type IconName =
  | 'branch'
  | 'chevron'
  | 'chevronDown'
  | 'chevronRight'
  | 'clip'
  | 'copy'
  | 'file'
  | 'folder'
  | 'folderPlus'
  | 'gear'
  | 'panel'
  | 'pen'
  | 'plus'
  | 'question'
  | 'refresh'
  | 'search'
  | 'send'
  | 'spark'
  | 'stop'
  | 'trash'
  | 'x';

export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    branch: <path d="M6 4v5a3 3 0 0 0 3 3h6M6 20v-5a3 3 0 0 1 3-3m6-4 4 4-4 4" />,
    chevron: <path d="m15 18-6-6 6-6" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    chevronRight: <path d="m9 6 6 6-6 6" />,
    clip: <path d="m21.4 11.6-8.6 8.6a5 5 0 0 1-7.1-7.1l9.2-9.2a3.5 3.5 0 0 1 5 5l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />,
    copy: <path d="M8 8h11v11H8zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />,
    file: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 13h8M8 17h5" />,
    folder: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />,
    folderPlus: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Zm9 3v5m-2.5-2.5h5" />,
    gear: <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.2 4.8a7.7 7.7 0 0 0 0-2.6l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.2-1.3L15.3 3h-4l-.3 2.5a8 8 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.5a7.7 7.7 0 0 0 0 2.6l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.2 1.3l.3 2.5h4l.3-2.5a8 8 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.5Z" />,
    panel: <path d="M4 5h16v14H4zM15 5v14" />,
    pen: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    question: <path d="M9.1 9a3 3 0 1 1 4.8 2.4c-1 .7-1.9 1.3-1.9 2.6m0 3h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" />,
    refresh: <path d="M20 6v5h-5M4 18v-5h5M18.2 9A7 7 0 0 0 6.7 6.8L4 9.5m16 5-2.7 2.7A7 7 0 0 1 5.8 15" />,
    search: <path d="m21 21-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />,
    send: <path d="M21 3 10.5 21l-2-7.5L1 11l20-8Zm-12.5 10.5L21 3" />,
    spark: <path d="M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8L12 3Zm6 11 1 2.7 2.7 1-2.7 1-1 2.8-1-2.8-2.7-1 2.7-1 1-2.7ZM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Z" />,
    stop: <path d="M8 8h8v8H8z" />,
    trash: <path d="M4 7h16M9 7V5h6v2m-8 3 .5 10h9l.5-10" />,
    x: <path d="M18 6 6 18M6 6l12 12" />,
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}
