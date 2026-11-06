import { useEffect, useState, type ReactNode } from "react";
import { phoneIsPortrait } from "./OrientationNotice";

/**
 * 微信内置浏览器的 UA 特征。只认官方关键字 MicroMessenger，
 * 不做模糊猜测——误伤普通浏览器会把人拦在游戏外面。
 */
export function isWeChatWebView(ua: string = navigator.userAgent) {
  return /MicroMessenger/i.test(ua);
}

/** 竖屏要持续这么久才切换：和横屏提示同一策略，首帧不闪。 */
const SETTLE_MS = 600;

function useSettledPortrait(active: boolean) {
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    if (!active) return;
    let timer = 0;
    const update = () => {
      const next = phoneIsPortrait({
        mobile: true,
        type: screen.orientation?.type,
        angle: (window as Window & { orientation?: number }).orientation,
        width: innerWidth,
        height: innerHeight,
      });
      if (!next) {
        window.clearTimeout(timer);
        timer = 0;
        setPortrait(false);
        return;
      }
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        setPortrait(
          phoneIsPortrait({
            mobile: true,
            type: screen.orientation?.type,
            angle: (window as Window & { orientation?: number }).orientation,
            width: innerWidth,
            height: innerHeight,
          }),
        );
      }, SETTLE_MS);
    };
    update();
    screen.orientation?.addEventListener("change", update);
    addEventListener("orientationchange", update);
    addEventListener("resize", update);
    return () => {
      window.clearTimeout(timer);
      screen.orientation?.removeEventListener("change", update);
      removeEventListener("orientationchange", update);
      removeEventListener("resize", update);
    };
  }, [active]);
  return portrait;
}

async function copyLink(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 微信 WebView 常不授权 clipboard，退回 execCommand。
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    return ok;
  }
}

/**
 * 方案 A：微信里竖屏玩不了（转不了横屏、横屏牌局也放不下），
 * 与其让人卡在「请将手机横过来」，不如直接给一条明确的出路：
 * 右上角 ⋯ → 在浏览器打开。用户横屏（部分安卓微信跟随旋转）时照常进游戏。
 */
export function WeChatGate({ children }: { children: ReactNode }) {
  const wechat = isWeChatWebView();
  const portrait = useSettledPortrait(wechat);
  if (!wechat || !portrait) return <>{children}</>;
  return (
    <div className="mg-wxgate" role="alertdialog" aria-label="请在浏览器中打开">
      <div className="mg-wxgate-card">
        <span className="mg-wxgate-dot" aria-hidden="true">
          ⋯
        </span>
        <h1>微信里打不开横屏牌局</h1>
        <p>
          微信内置浏览器转不了横屏，牌桌会被压坏。两步就能进：
        </p>
        <ol>
          <li>
            <span>
              点右上角的「<b>⋯</b>」
            </span>
          </li>
          <li>
            <span>
              选「<b>在浏览器打开</b>」，进页面后横屏开打
            </span>
          </li>
        </ol>
        <button
          className="mg-wxgate-copy"
          onClick={async (e) => {
            const ok = await copyLink(location.href);
            const btn = e.currentTarget;
            btn.textContent = ok ? "已复制，去浏览器粘贴打开" : "复制失败，请手动输入网址";
            window.setTimeout(() => {
              btn.textContent = "复制链接";
            }, 2400);
          }}
        >
          复制链接
        </button>
        <small>当前链接：{location.href}</small>
      </div>
    </div>
  );
}
