// IconPark icons, derived from @icon-park/svg v1.4.2 (Apache-2.0).
// 仅内置当前界面实际使用的图标，避免引入整套图标包作为运行时依赖。
export type IconParkName = 'brain' | 'connection' | 'lightning' | 'lock' | 'magic' | 'play' | 'protect' | 'rocket' | 'speed';

export function IconParkIcon({ className, name, theme = 'two-tone' }: {
  className?: string;
  name: IconParkName;
  theme?: 'outline' | 'two-tone';
}) {
  const filled = theme === 'two-tone';
  const softFill = filled ? 'currentColor' : 'none';
  const softFillOpacity = filled ? 0.16 : undefined;
  const stroke = {
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 3.5,
  } as const;

  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 48 48">
      {name === 'connection' ? (
        <path d="M24.7073 9.56521 9.85801 24.4145c-3.51472 3.5147-3.51472 9.2132 0 12.7279 3.51469 3.5147 9.21319 3.5147 12.72789 0l17.6777-17.6777c2.3431-2.3431 2.3431-6.1421 0-8.4853-2.3431-2.34312-6.1421-2.34312-8.4853 0L14.1007 28.6571c-1.1716 1.1716-1.1716 3.0711 0 4.2426 1.1715 1.1716 3.071 1.1716 4.2426 0L33.1925 18.0505" {...stroke} />
      ) : null}
      {name === 'lock' ? (
        <>
          <rect x="6" y="22" width="36" height="22" rx="2" fill={softFill} fillOpacity={softFillOpacity} {...stroke} />
          <path d="M14 22V14C14 8.477 18.477 4 24 4s10 4.477 10 10v8M24 30v6" {...stroke} />
        </>
      ) : null}
      {name === 'protect' ? (
        <>
          <path d="m6 9.256 18.009-5.256L42 9.256v10.778c0 11.328-7.25 21.385-17.997 24.967C13.252 41.42 6 31.36 6 20.029V9.256Z" fill={softFill} fillOpacity={softFillOpacity} {...stroke} />
          <path d="m15 23 7 7 12-12" {...stroke} />
        </>
      ) : null}
      {name === 'rocket' ? (
        <>
          <path d="m18.705 7.894L24 4l5.295 3.894C32.882 10.533 35 14.72 35 19.173V37H13V19.173c0-4.453 2.118-8.64 5.705-11.279Z" fill={softFill} fillOpacity={softFillOpacity} {...stroke} />
          <path d="m13 17-6 6v8l6-3v-11Zm22 0 6 6v8l-6-3V17ZM18 39v3m6-3v5m6-5v3" {...stroke} />
        </>
      ) : null}
      {name === 'lightning' ? <path d="M19 4h18L26 18h15L17 44l5-19H8L19 4Z" fill={softFill} fillOpacity={softFillOpacity} {...stroke} /> : null}
      {name === 'speed' ? (
        <>
          <path d="M34.023 6.689A39.8 39.8 0 0 0 24 4C12.954 4 4 12.954 4 24s8.954 20 20 20 20-8.954 20-20a20 20 0 0 0-2.654-9.962" {...stroke} />
          <path d="M31.95 16.05S28.562 25.095 27 26.657a4 4 0 0 1-5.657-5.657c1.562-1.562 10.607-4.95 10.607-4.95Z" fill={softFill} fillOpacity={softFillOpacity} {...stroke} />
        </>
      ) : null}
      {name === 'brain' ? (
        <>
          <path d="M19.036 44c-.98-3.195-2.458-5.578-4.435-7.147-2.965-2.353-7.676-.89-9.416-3.318-1.74-2.428 1.219-6.892 2.257-9.526 1.039-2.634-3.98-3.566-3.394-4.314.39-.498 2.927-1.937 7.609-4.315C12.987 7.794 17.9 4 26.398 4 39.144 4 44 14.806 44 21.679c0 6.873-5.88 14.277-14.256 15.874-.75 1.09.33 3.24 3.24 6.447" {...stroke} />
          <path d="M19.5 14.5c-.654 2.534-.46 4.313.583 5.339 1.042 1.024 2.818 1.694 5.328 2.01-.57 3.268.125 4.802 2.083 4.6 1.958-.201 3.134-1.015 3.53-2.441 3.06.86 4.718.14 4.975-2.159.385-3.45-1.475-6.201-2.238-6.201-.762 0-2.738-.093-2.738-1.148 0-1.055-2.308-1.65-4.391-1.65-2.083 0-.83-1.405-3.69-.85-1.907.37-3.055 1.204-3.443 2.5Z" fill={softFill} fillOpacity={softFillOpacity} {...stroke} />
          <path d="M30.5 25.5c-1.017.631-2.412 1.68-3 2.5-1.469 2.05-2.66 3.298-2.921 4.608" {...stroke} />
        </>
      ) : null}
      {name === 'magic' ? (
        <>
          <path d="m20.1 8.1 4.243 4.243M30 4v6m9.9-1.9-4.243 4.243M44 18h-6m1.9 9.9-4.243-4.243M30 32v-6m-9.9 1.9 4.243-4.243M16 18h6M29.586 18.414 5.544 42.456" {...stroke} />
        </>
      ) : null}
      {name === 'play' ? (
        <>
          <circle cx="24" cy="24" r="20" fill={softFill} fillOpacity={softFillOpacity} {...stroke} />
          <path d="M20 24v-6.928L32 24l-12 6.928V24Z" fill="currentColor" fillOpacity={filled ? 0.82 : 0} {...stroke} />
        </>
      ) : null}
    </svg>
  );
}
