import type { Locale } from '../config.js';
import type { WeixinLoginState } from '../botClient.js';
import { Icon } from './Icon.js';

export function WeixinConnectDialog({
  locale,
  state,
  onClose,
}: {
  locale: Locale;
  state: WeixinLoginState;
  onClose(): void;
}) {
  const qr = state.qr;
  return (
    <div className="dialogLayer" role="presentation" onMouseDown={onClose}>
      <section
        className="appDialog weixinConnectDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="weixin-connect-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialogHeader">
          <h2 id="weixin-connect-title">{locale === 'zh' ? '连接微信远程助手' : 'Connect WeChat assistant'}</h2>
          <button className="iconButton" title={locale === 'zh' ? '关闭' : 'Close'} aria-label={locale === 'zh' ? '关闭' : 'Close'} onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        {qr ? (
          <div className="weixinQrBox large">
            <img src={qr.startsWith('data:image/') ? qr : qrImageSrc(qr)} alt={locale === 'zh' ? '微信登录二维码' : 'WeChat login QR'} />
            <span>{state.polling
              ? (locale === 'zh' ? '请用手机微信扫码，Nexus 会自动确认。' : 'Scan with WeChat. Nexus will confirm automatically.')
              : (state.message || (locale === 'zh' ? '二维码已生成。' : 'QR generated.'))}</span>
          </div>
        ) : (
          <p className={state.error ? 'dialogMessage errorText' : 'dialogMessage'}>
            {state.error || state.message || (locale === 'zh' ? '正在生成二维码...' : 'Generating QR code...')}
          </p>
        )}
        {state.error && qr ? <p className="dialogMessage errorText">{state.error}</p> : null}
      </section>
    </div>
  );
}

function qrImageSrc(value: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(value)}`;
}
