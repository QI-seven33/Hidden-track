const browserPackages = {
  qqbrowser: 'com.tencent.mtt',
  chrome: 'com.android.chrome',
  edge: 'com.microsoft.emmx',
  uc: 'com.UCMobile',
  firefox: 'org.mozilla.firefox',
  samsung: 'com.sec.android.app.sbrowser',
} as const;
export type AuthReturnTarget = '' | 'native' | keyof typeof browserPackages;

/** Hints can reopen a known app, but never grant it a different session's login. */
export function authReturnTarget(
  agent: string,
  native: boolean,
): AuthReturnTarget {
  if (native) return 'native';
  if (!/Android/i.test(agent) || /MicroMessenger|\bQQ\//i.test(agent))
    return '';
  if (/MQQBrowser/i.test(agent)) return 'qqbrowser';
  if (/EdgA\//i.test(agent)) return 'edge';
  if (/UCBrowser/i.test(agent)) return 'uc';
  if (/SamsungBrowser/i.test(agent)) return 'samsung';
  if (/Firefox/i.test(agent)) return 'firefox';
  if (/Chrome\//i.test(agent) && !/; wv\)/i.test(agent)) return 'chrome';
  return '';
}

export function validAuthReturnTarget(value: unknown): AuthReturnTarget {
  return value === 'native' ||
    (typeof value === 'string' && Object.hasOwn(browserPackages, value))
    ? (value as AuthReturnTarget)
    : '';
}

/** No code, state, token or invitation secret is put in the app/browser return link. */
export function authReturnPage(
  origin: string,
  target: AuthReturnTarget,
): string {
  const home = new URL('/?login=resume', origin);
  const destination =
    target === 'native'
      ? 'hiddentrack://oauth?resume=1'
      : target
        ? `intent://${home.host}${home.pathname}${home.search}#Intent;scheme=${home.protocol.slice(0, -1)};package=${browserPackages[target]};end`
        : home.href;
  const scriptValue = JSON.stringify({
    destination,
    automatic: Boolean(target),
  }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><title>返回 Hidden Track</title><body style="margin:0;background:#f7f7f2;color:#111;font:16px/1.6 system-ui;display:grid;place-items:center;min-height:100dvh"><main style="box-sizing:border-box;max-width:36em;padding:24px"><h1 style="font-size:24px">授权结果已收到</h1><p>请回到最初打开游戏的浏览器或 App，游戏会自动确认登录。</p><a id="return" href="/" style="display:inline-block;padding:10px 24px;border:2px solid #111;border-radius:12px;background:#c6f04a;color:#111;text-decoration:none;font-weight:700">返回游戏</a><p id="hint">如果未能自动返回，请点上方按钮；仍无法切回时，请手动回到原浏览器或 App。本页不会领取其他浏览器的登录。</p></main><script>(()=>{const config=${scriptValue};const link=document.getElementById('return');link.href=config.destination;if(config.automatic&&/Android/i.test(navigator.userAgent)){setTimeout(()=>{if(!document.hidden)location.assign(config.destination)},200)}})()</script></body></html>`;
}
