const pendingKey = 'ht.web.pending';
export const authChangedKey = 'ht.auth.changed';

export function webLoginPending(): number {
  try {
    return Number(sessionStorage.getItem(pendingKey) || 0);
  } catch {
    return 0;
  }
}
export function rememberWebLogin(expires: number) {
  try {
    if (expires) sessionStorage.setItem(pendingKey, String(expires));
    else sessionStorage.removeItem(pendingKey);
  } catch {
    /* Server-side flow recovery also works without sessionStorage. */
  }
}
export function announceAuthChange() {
  try {
    localStorage.setItem(authChangedKey, `${Date.now()}:${Math.random()}`);
  } catch {
    /* Focus/pageshow recovery remains available. No credential is shared. */
  }
}
export function isAndroidApp(
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
) {
  return /HiddenTrackAndroid\/1\.0/.test(userAgent);
}
export type BrowserInfo = Pick<
  Navigator,
  'userAgent' | 'platform' | 'maxTouchPoints'
>;

export function isMobileBrowser(
  browser: BrowserInfo | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator,
) {
  return (
    !!browser &&
    (/Android|iPhone|iPad|iPod|Mobile/i.test(browser.userAgent) ||
      (browser.platform === 'MacIntel' && browser.maxTouchPoints > 1))
  );
}
