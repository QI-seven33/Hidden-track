import { useEffect, useState } from 'react';
import { isMobileBrowser } from './auth-session';

export function phoneIsPortrait(input: {
  mobile: boolean;
  type?: string;
  angle?: number;
  width: number;
  height: number;
}) {
  if (!input.mobile) return false;
  if (input.type?.startsWith('portrait')) return true;
  if (input.type?.startsWith('landscape')) return false;
  if (typeof input.angle === 'number') return Math.abs(input.angle) % 180 === 0;
  return input.height > input.width;
}

/** 安卓壳的 Activity 是 sensorLandscape，永远不会真的竖屏；提示只在浏览器里有意义。 */
function inNativeShell() {
  return (
    typeof navigator !== 'undefined' &&
    /HiddenTrackAndroid/i.test(navigator.userAgent)
  );
}

function currentOrientation() {
  if (typeof window === 'undefined') return false;
  return phoneIsPortrait({
    mobile: isMobileBrowser(),
    type: screen.orientation?.type,
    angle: (window as Window & { orientation?: number }).orientation,
    width: innerWidth,
    height: innerHeight,
  });
}

/** 竖屏要持续这么久才弹提示：首帧 orientation 还没就绪时不至于闪一下。 */
const SETTLE_MS = 600;

/** Detect orientation, not the keyboard-shortened viewport. Never attempts to lock it. */
export function OrientationNotice() {
  // 初值恒为 false：宁可晚 600ms 出现，也不要在壳启动那一帧闪出来。
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    if (inNativeShell()) return;
    let timer = 0;
    const update = () => {
      const next = currentOrientation();
      if (!next) {
        window.clearTimeout(timer);
        timer = 0;
        setPortrait(false);
        return;
      }
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        setPortrait(currentOrientation());
      }, SETTLE_MS);
    };
    update();
    screen.orientation?.addEventListener('change', update);
    addEventListener('orientationchange', update);
    addEventListener('resize', update);
    addEventListener('pageshow', update);
    return () => {
      window.clearTimeout(timer);
      screen.orientation?.removeEventListener('change', update);
      removeEventListener('orientationchange', update);
      removeEventListener('resize', update);
      removeEventListener('pageshow', update);
    };
  }, []);
  if (!portrait) return null;
  return (
    <div className="mg-rotate" role="status">
      <div>
        <span className="mg-rotate-icon" aria-hidden="true">
          ↻
        </span>
        <b>请将手机横过来</b>
        <small>横屏后自动进入游戏；若未旋转，请检查手机的方向锁定。</small>
      </div>
    </div>
  );
}
