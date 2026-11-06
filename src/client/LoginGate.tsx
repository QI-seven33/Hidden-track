import { BRAND_TAGLINE } from "../shared/brand";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { errorText } from "./utils";
import type { Meta } from "./types";
import { MangaFrame } from "./MangaUI";
import { APP_VERSION } from "../shared/version";

import {
  announceAuthChange,
  isAndroidApp,
  isMobileBrowser,
  rememberWebLogin,
  webLoginPending,
} from "./auth-session";
import { goto } from "./utils";

/**
 * 强制登录门：大厅之前唯一入口。
 * 桌面扫码；已启用 H5 授权的移动端优先网页登录，始终保留扫码兜底。
 */
export function LoginGate({
  meta,
  refresh,
}: {
  meta: Meta;
  refresh: () => Promise<void>;
}) {
  const [useWeb, setUseWeb] = useState(() =>
    Boolean(
      meta.webLoginConfigured &&
      (webLoginPending() > Date.now() || isMobileBrowser()),
    ),
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [qr, setQr] = useState<{
    image: string;
    expiresAt: number;
    tip: string;
  }>();
  const [status, setStatus] = useState(() =>
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("login") === "failed"
      ? "网页授权未完成，可重试或切换二维码登录"
      : "",
  );
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const starting = useRef(false);
  const pendingUntil = useRef(webLoginPending());
  const [webPending, setWebPending] = useState(
    () => pendingUntil.current > Date.now(),
  );
  const authWindow = useRef<Window | null>(null);
  const finishLogin = useCallback(
    async (returnTo?: string) => {
      const startingPath = location.pathname;
      await refresh();
      pendingUntil.current = 0;
      rememberWebLogin(0);
      authWindow.current?.close();
      authWindow.current = null;
      announceAuthChange();
      if (mounted.current) setWebPending(false);
      if (
        returnTo &&
        returnTo !== location.pathname + location.search + location.hash &&
        location.pathname === startingPath
      )
        goto(returnTo, true);
    },
    [refresh],
  );
  useEffect(
    () => () => {
      authWindow.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (!meta.webLoginConfigured) return;
    let active = true,
      running = false,
      failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (!active || running) return;
      if (document.hidden && !authWindow.current) return;
      clearTimeout(timer);
      running = true;
      try {
        const result = await api<{
          status: string;
          expiresAt?: number;
          returnTo?: string;
        }>("/music/auth/web/complete", {});
        if (!active) return;
        failures = 0;
        if (result.status === "authorized") {
          await finishLogin(result.returnTo);
        } else if (result.status === "expired") {
          pendingUntil.current = 0;
          rememberWebLogin(0);
          setWebPending(false);
        } else if (result.status === "waiting") {
          pendingUntil.current = result.expiresAt || pendingUntil.current;
          rememberWebLogin(pendingUntil.current);
          setWebPending(true);
          timer = setTimeout(poll, 3000);
        }
      } catch (error) {
        if (
          active &&
          error instanceof ApiError &&
          [401, 403, 410].includes(error.status)
        ) {
          pendingUntil.current = 0;
          rememberWebLogin(0);
          setWebPending(false);
          setStatus(
            "授权已失效或未完成，请重新选择账号，也可改用 QQ 网页授权或扫码",
          );
        } else if (active && pendingUntil.current > Date.now()) {
          setStatus(
            "暂未确认授权结果，返回本页后会自动重试；也可切换二维码登录",
          );
          timer = setTimeout(poll, Math.min(15000, 3000 * ++failures));
        }
      } finally {
        running = false;
      }
    };
    const visible = () => {
      if (!document.hidden) void poll();
    };
    void poll(); // Recover a server-side flow even if this tab has lost sessionStorage.
    addEventListener("focus", visible);
    addEventListener("pageshow", visible);
    addEventListener("auth-flow-started", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearTimeout(timer);
      removeEventListener("focus", visible);
      removeEventListener("pageshow", visible);
      removeEventListener("auth-flow-started", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [meta.webLoginConfigured, finishLogin]);

  const connect = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setStatus("");
    setExpired(false);
    try {
      const data = await api<{ url?: string; image?: string; expiresAt: number; tip: string }>(
        "/music/auth/qr",
        {},
      );
      const QR = await import("qrcode");
      const image = data.image || await QR.toDataURL(data.url!, { width: 420, margin: 1 });
      if (mounted.current)
        setQr({ image, expiresAt: data.expiresAt, tip: data.tip });
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setBusy(false);
      starting.current = false;
    }
  }, []);

  useEffect(() => {
    if (meta.qrConfigured && !useWeb) void connect();
  }, [meta.qrConfigured, useWeb, connect]);

  async function connectWeb(channel: "all" | "qq" = "all") {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setStatus("正在前往 QQ 音乐授权页面…");
    const nativeReturn = isAndroidApp();
    // Mobile authorization stays in the initiating tab so Back and Cookie state
    // survive. Desktop may use a tracked popup and closes it after completion.
    const popup =
      !nativeReturn && !isMobileBrowser()
        ? window.open("about:blank", "_blank")
        : null;
    authWindow.current = popup;
    try {
      const destination = new URL(location.href);
      destination.searchParams.delete("login");
      const result = await api<{ url: string; expiresAt: number }>(
        "/music/auth/web",
        {
          returnTo:
            destination.pathname + destination.search + destination.hash,
          nativeReturn,
          channel,
        },
      );
      if (mounted.current) {
        pendingUntil.current = result.expiresAt;
        rememberWebLogin(result.expiresAt);
        setWebPending(true);
        setStatus(
          "授权后返回当前游戏页，登录将自动完成；QQ 拉起失败时可在官方页选择其他登录方式",
        );
        dispatchEvent(new Event("auth-flow-started"));
        if (popup) {
          popup.opener = null;
          popup.location.assign(result.url);
        } else location.assign(result.url);
      }
    } catch (e) {
      popup?.close();
      setStatus(errorText(e));
    } finally {
      starting.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!qr || useWeb) return;
    let active = true;
    let running = false;
    const timer = setInterval(() => {
      if (Date.now() > qr.expiresAt) {
        setQr(undefined);
        setExpired(true);
        setStatus("二维码已过期，请重新获取");
        return;
      }
      if (running) return;
      running = true;
      void api<{ status: string }>("/music/auth/poll", {})
        .then(async (r) => {
          if (!active) return;
          if (r.status === "authorized") {
            setStatus("登录成功，正在进入大厅…");
            await finishLogin();
            if (active) setQr(undefined);
          } else if (r.status === "scanned")
            setStatus("已扫码，请在 QQ 音乐确认授权");
        })
        .catch((e) => {
          if (active) {
            setStatus(errorText(e));
            if (e instanceof ApiError && [401, 410].includes(e.status)) {
              setQr(undefined);
              setExpired(true);
            }
          }
        })
        .finally(() => {
          running = false;
        });
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [qr, finishLogin, useWeb]);

  return (
    <MangaFrame>
      <main className="mg-page mg-gate">
        <section className="mg-gate-brand">
          <span className="mg-gate-kicker">MUSIC CARD DUEL</span>
          <h1 className="mg-gate-logo">
            <img
              className="mg-gate-logo-img"
              src="/art/logo-hidden-track.png"
              alt="Hidden Track"
            />
          </h1>
          <p>{BRAND_TAGLINE}</p>
          <ul className="mg-gate-steps">
            <li>
              <b>01</b> 登录QQ音乐，同步真实头像与昵称
            </li>
            <li>
              <b>02</b> 选择一首你想要分享的宝藏歌曲
            </li>
            <li>
              <b>03</b> 线索互弈，率先猜中对方底牌者获胜
            </li>
          </ul>
          <small className="mg-gate-version">版本 {APP_VERSION}</small>
        </section>
        <section className="mg-gate-card">
          <header>
            <h2>{useWeb ? "QQ 音乐授权" : "扫码登录"}</h2>
            <span>登录后才能进入游戏大厅</span>
          </header>
          <div className="mg-gate-qr">
            {useWeb ? (
              <div className="mg-gate-qr-empty" role="status">
                在本机完成 QQ 音乐网页授权
              </div>
            ) : qr ? (
              <img src={qr.image} alt="QQ 音乐登录二维码" />
            ) : (
              <div className="mg-gate-qr-empty" role="status">
                {busy
                  ? "正在获取二维码…"
                  : expired
                    ? "二维码已过期"
                    : "等待登录"}
              </div>
            )}
          </div>
          <p className="mg-gate-tip" role="status">
            {status ||
              (useWeb
                ? webPending
                  ? "正在等待授权，返回本页后会自动确认；取消或失败可重新授权或切换扫码"
                  : "点击下方按钮选择账号授权；QQ 或 QQ 音乐拉起失败时可切换扫码"
                : qr?.tip) ||
              (meta.qrConfigured
                ? "使用手机 QQ 或 QQ 音乐扫码"
                : "服务端未配置 QQ 音乐应用，暂时无法登录")}
            {useWeb && (
              <>
                {" "}
                <button
                  type="button"
                  className="mg-sheet-link"
                  disabled={busy}
                  onClick={() => void connectWeb("qq")}
                >
                  改用 QQ 网页授权
                </button>
              </>
            )}
          </p>
          <button
            className="mg-btn mg-primary"
            disabled={
              busy || !(useWeb ? meta.webLoginConfigured : meta.qrConfigured)
            }
            onClick={() => void (useWeb ? connectWeb() : connect())}
          >
            <span>
              {busy
                ? "处理中…"
                : useWeb
                  ? "继续授权登录"
                  : qr
                    ? "换一张二维码"
                    : "获取登录二维码"}
            </span>
          </button>
          {meta.webLoginConfigured && (
            <button
              className="mg-btn mg-ghost"
              disabled={busy}
              onClick={() => {
                setUseWeb(!useWeb);
                if (useWeb) {
                  pendingUntil.current = 0;
                  rememberWebLogin(0);
                  setWebPending(false);
                  authWindow.current?.close();
                  authWindow.current = null;
                }
                setStatus("");
              }}
            >
              <span>{useWeb ? "使用二维码登录" : "使用本机网页授权"}</span>
            </button>
          )}
          <small className="mg-gate-note">
            只读取头像、昵称与歌单权限，不代你发布任何内容。
          </small>
        </section>
      </main>
    </MangaFrame>
  );
}
