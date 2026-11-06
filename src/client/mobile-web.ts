import {
  isAndroidApp,
  isMobileBrowser,
  type BrowserInfo,
} from './auth-session';

/** Mobile browsers use the existing download page; the hosted Android app
 * continues loading the same game and authorization flow in its WebView. */
export function mobileWebRedirect(browser: BrowserInfo) {
  return !isAndroidApp(browser.userAgent) && isMobileBrowser(browser)
    ? '/download.html'
    : undefined;
}
