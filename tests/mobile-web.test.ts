import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mobileWebRedirect } from '../src/client/mobile-web';

test('Android phone browsers go to downloads even without Mobile or touch tokens', () => {
  for (const userAgent of [
    'Mozilla/5.0 (Linux; Android 13) Chrome/142.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13) Chrome/142.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14) Mobile MicroMessenger/8.0',
    'Mozilla/5.0 (Linux; Android 14) MQQBrowser/15.0',
  ])
    assert.equal(
      mobileWebRedirect({
        userAgent,
        platform: 'Linux armv8l',
        maxTouchPoints: 0,
      }),
      '/download.html',
    );
});
test('iPhone and desktop-mode iPad browsers also go to downloads', () => {
  assert.equal(
    mobileWebRedirect({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    }),
    '/download.html',
  );
  assert.equal(
    mobileWebRedirect({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.0 Safari/605.1',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    }),
    '/download.html',
  );
});
test('the existing Android APK stays in the game and keeps its login entry', () => {
  assert.equal(
    mobileWebRedirect({
      userAgent:
        'Mozilla/5.0 (Linux; Android 13; wv) Version/4.0 Chrome/142.0 Mobile Safari/537.36 HiddenTrackAndroid/1.0',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    }),
    undefined,
  );
});
test('desktop browsers and Windows WebView2 remain open, including touch desktops', () => {
  for (const browser of [
    {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 10,
    },
    {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0 Edg/142.0',
      platform: 'Win32',
      maxTouchPoints: 0,
    },
    {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.0 Safari/605.1',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    },
  ])
    assert.equal(mobileWebRedirect(browser), undefined);
});
test('the download page has installers and no web-play entry or stale WeChat instructions', () => {
  const html = readFileSync('public/download.html', 'utf8');
  assert.ok(html.includes('./downloads/HiddenTrack-Android.apk'));
  assert.ok(html.includes('./downloads/HiddenTrack-Windows-x64.exe'));
  assert.doesNotMatch(html, /<a\b[^>]*href=["']\/["']/i);
  assert.doesNotMatch(html, /网页直接玩|不用安装|横屏即可体验/);
  assert.match(html, /手机网页版暂时关闭/);
  assert.match(html, /iOS.*暂无正式客户端/);
});
