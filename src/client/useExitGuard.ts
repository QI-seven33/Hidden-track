import { useEffect, useRef, useState } from 'react';
import { goto } from './utils';
import { dismissBackLayer, hasBackLayer } from './back-layers';
import { leaveLobby } from './audio/engine';

export function isTouchDevice() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined')
    return false;
  return (
    (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) &&
    /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent)
  );
}

/**
 * 独立应用外壳：安卓原生壳，或已经「添加到主屏幕」的 PWA。
 * 只有这种形态才存在「退出应用」；普通浏览器里退出就是关标签页，
 * 弹「要离开吗」纯属多余，确认后也无处可退。
 */
export function isStandaloneApp() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined')
    return false;
  if (navigator.userAgent.includes('HiddenTrackAndroid/1.0')) return true;
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone;
  return ios === true || matchMedia('(display-mode: standalone)').matches;
}

/** Only leaving the app from home asks to quit. Internal routes and card gestures never do. */
export function useExitGuard(path: string) {
  const [asking, setAsking] = useState(false);
  const leaving = useRef(false);
  const currentPath = useRef(path);
  const askingRef = useRef(asking);
  currentPath.current = path;
  askingRef.current = asking;
  useEffect(() => setAsking(false), [path]);
  useEffect(() => {
    const ask = () => setAsking(true);
    const back = () => {
      if (askingRef.current) {
        setAsking(false);
        return;
      }
      if (dismissBackLayer()) return;
      if (
        currentPath.current.startsWith('/r/') &&
        document.querySelector('.md-duel')
      )
        dispatchEvent(new Event('request-room-leave'));
      else if (currentPath.current !== '/') goto('/');
      // 浏览器里不存在「退出应用」，弹了也没处可退。
      else if (isStandaloneApp()) ask();
    };
    let restoring = false;
    let afterRestore: (() => void) | undefined;
    const pop = (event: PopStateEvent) => {
      if (!event.isTrusted || leaving.current) return;
      if (restoring) {
        restoring = false;
        event.stopImmediatePropagation();
        const action = afterRestore;
        afterRestore = undefined;
        queueMicrotask(() => action?.());
        return;
      }
      // A long-press history jump to a different route remains a real navigation.
      if (location.pathname !== currentPath.current) return;
      // 浏览器里没有「退出应用」：首页再按返回就让它真的后退离开站点。
      if (
        currentPath.current === '/' &&
        !askingRef.current &&
        !hasBackLayer() &&
        !isStandaloneApp()
      )
        return;
      if (
        askingRef.current ||
        hasBackLayer() ||
        (isTouchDevice() && event.state?.htBackGuard !== currentPath.current)
      ) {
        event.stopImmediatePropagation();
        restoring = true;
        afterRestore = back;
        // Restore before invoking close: some sheets close by navigating home.
        history.forward();
      }
    };
    const bridge = window as Window & { __hiddenTrackBack?: boolean };
    bridge.__hiddenTrackBack = true;
    addEventListener('request-exit', ask);
    addEventListener('app-back', back);
    addEventListener('popstate', pop, true);
    return () => {
      bridge.__hiddenTrackBack = false;
      removeEventListener('request-exit', ask);
      removeEventListener('app-back', back);
      removeEventListener('popstate', pop, true);
    };
  }, []);
  useEffect(() => {
    if (!isTouchDevice()) return;
    // 独立外壳在首页也要一个历史锚点，否则返回键会直接离开应用、连确认都来不及弹。
    // 浏览器里只有内页需要（用来回到首页），首页不必再压一层。
    if (
      history.state?.htBackGuard !== path &&
      (isStandaloneApp() || path !== '/')
    )
      history.pushState(
        { ...history.state, htBackGuard: path },
        '',
        location.href,
      );
  }, [path]);
  return {
    asking,
    ask: () => setAsking(true),
    cancel: () => setAsking(false),
    confirm: () => {
      leaving.current = true;
      setAsking(false);
      leaveLobby();
      if (navigator.userAgent.includes('HiddenTrackAndroid/1.0')) {
        location.assign('hiddentrack://exit');
      } else {
        window.close();
        // Browsers cannot close tabs they did not create. Leave the game once,
        // without history.back() returning to an old room or profile screen.
        setTimeout(() => location.replace('about:blank'), 150);
      }
    },
  };
}
