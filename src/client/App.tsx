import { BRAND_TAGLINE } from "../shared/brand";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { warmCardArt } from "./presentation/preload";
import { api } from "./api";
import { errorText } from "./utils";
import { announceAuthChange, authChangedKey } from "./auth-session";
import type { Meta, Session } from "./types";
import { Home } from "./Home";
import { RoomPage } from "./RoomPage";
import { MangaDialog, MangaFrame } from "./MangaUI";
import { LoginGate } from "./LoginGate";
import { RulesDoc } from "./RulesDoc";
const Lab = import.meta.env.DEV
  ? lazy(() => import("./Lab").then((m) => ({ default: m.Lab })))
  : null;
const MusicData = import.meta.env.DEV
  ? lazy(() => import("./MusicData").then((m) => ({ default: m.MusicData })))
  : null;
const MyMusic = lazy(() =>
  import("./MyMusic").then((m) => ({ default: m.MyMusic })),
);
import { DemoIcon } from "./DemoUI";
import { AudioHost } from "./audio/AudioHost";
import { Splash } from "./Splash";
import { useExitGuard } from "./useExitGuard";
import { APP_VERSION } from "../shared/version";
export function App() {
  useEffect(() => {
    void warmCardArt().catch(() => {});
  }, []);
  const [menu, setMenu] = useState<"settings" | "rules" | "restart" | "">("");
  const [duel, setDuel] = useState(false);
  const [path, setPath] = useState(location.pathname);
  const [meta, setMeta] = useState<Meta>();
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const exit = useExitGuard(path);
  const sessionRequest = useRef(0);
  const latestSessionTask = useRef<Promise<void> | undefined>(undefined);
  const refreshSession = useCallback((): Promise<void> => {
    const sequence = ++sessionRequest.current;
    const task: Promise<void> = api<Session>("/session").then((next) => {
      if (sequence === sessionRequest.current) setSession(next);
      else return latestSessionTask.current;
    });
    latestSessionTask.current = task;
    return task;
  }, []);
  const announcedAuth = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!session) return;
    if (
      session.qqAuthorized !== announcedAuth.current &&
      (session.qqAuthorized || announcedAuth.current !== undefined)
    )
      announceAuthChange();
    announcedAuth.current = session.qqAuthorized;
  }, [session?.qqAuthorized]);
  useEffect(() => {
    void Promise.all([
      api<Meta>("/meta").then(setMeta),
      refreshSession(),
    ]).catch((e) => setError(errorText(e)));
    const changed = () => setPath(location.pathname);
    const expired = () => {
      void refreshSession().catch(() => {});
    };
    addEventListener("popstate", changed);
    addEventListener("music-login-required", expired);
    return () => {
      removeEventListener("popstate", changed);
      removeEventListener("music-login-required", expired);
    };
  }, [refreshSession]);
  useEffect(() => {
    let last = 0;
    const sync = () => {
      if (document.hidden || Date.now() - last < 800) return;
      last = Date.now();
      void refreshSession().catch(() => {});
    };
    const changed = (event: StorageEvent) => {
      if (event.key === authChangedKey) void refreshSession().catch(() => {});
    };
    addEventListener("pageshow", sync);
    addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    addEventListener("storage", changed);
    return () => {
      removeEventListener("pageshow", sync);
      removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
      removeEventListener("storage", changed);
    };
  }, [refreshSession]);
  const navigate = (to: string) => {
    history.pushState({}, "", to);
    setPath(location.pathname);
    setError("");
  };
  const id = path.match(/^\/r\/([A-Za-z0-9_-]+)$/)?.[1];
  useEffect(() => setDuel(false), [id]);
  const manga = path === "/" || path === "/me" || Boolean(id && !duel);
  // 强制登录：配置了 QQ 音乐应用时，没有授权就只能停在登录页。
  const needsLogin = Boolean(
    meta?.qqConfigured && session && !session.qqAuthorized,
  );
  return (
    <div
      className={
        "app-shell demo-app " +
        (id ? "in-lobby room-route" : path === "/" ? "in-home" : "in-reader") +
        (id && duel ? " in-duel" : "") +
        (manga ? " manga-shell" : "")
      }
    >
      {/* 进大厅就开始放背景音乐；对战时自动压低，给官方试听让路。 */}
      {meta && session && (
        <AudioHost
          duel={Boolean(id && duel)}
          scene={needsLogin ? "login" : path}
        />
      )}
      <header className={id && duel ? "app-header duel-header" : "app-header"}>
        {id && duel ? (
          <button
            className="duel-settings"
            aria-label="设置"
            title="设置 · 玩法与卡牌"
            onClick={() => dispatchEvent(new Event("open-room-settings"))}
          >
            <DemoIcon name="settings" size={20} />
          </button>
        ) : (
          <>
            <button
              className={id ? "theme-brand" : "lobby-label"}
              onClick={() => navigate("/")}
            >
              {id ? (
                BRAND_TAGLINE
              ) : (
                <>
                  <img
                    className="brand-icon"
                    src="/icons/brand-64.png"
                    alt=""
                  />
                  Hidden Track <small>音乐分享卡牌 · {APP_VERSION}</small>
                </>
              )}
            </button>
            <nav className="header-actions" aria-label="游戏操作">
              <button
                className="quiet-button"
                onClick={() =>
                  id
                    ? dispatchEvent(new Event("open-room-settings"))
                    : setMenu("settings")
                }
              >
                <DemoIcon name="settings" size={18} />
                设置
              </button>
              {id && meta?.developer && (
                <button
                  className="quiet-button"
                  onClick={() =>
                    window.dispatchEvent(new Event("open-developer-options"))
                  }
                >
                  开发者
                </button>
              )}
              {id && (
                <button
                  className="quiet-button"
                  onClick={() => setMenu("restart")}
                >
                  重新开始
                </button>
              )}
              <button className="quiet-button" onClick={() => navigate("/me")}>
                我的音乐
              </button>
            </nav>
          </>
        )}
      </header>
      {/* 开屏：假进度条 + 牌面/事件卡/首曲预热，收尾淡出。 */}
      <Splash ready={Boolean(meta && session)} />
      <div
        key={path}
        className={
          "mg-view " +
          (id ? "room-main" : path === "/" ? "home-main" : "reader-main")
        }
      >
        {error && !manga && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        <Suspense
          fallback={
            manga ? (
              // 漫画版页面用同风格占位，避免懒加载时闪过旧版 .panel 面板。
              <MangaFrame>
                <div className="mg-connecting" role="status">
                  <p>正在载入…</p>
                </div>
              </MangaFrame>
            ) : (
              <section className="panel">正在载入页面…</section>
            )
          }
        >
          {!meta || !session ? (
            manga ? (
              <MangaFrame>
                <div className="mg-connecting" role="status">
                  <p>{error || "连接中…"}</p>
                  {error && (
                    <button
                      className="mg-btn"
                      onClick={() => location.reload()}
                    >
                      重试
                    </button>
                  )}
                </div>
              </MangaFrame>
            ) : (
              <section className="panel">
                <h1>连接服务中</h1>
                <p>请确认本地后端已启动。</p>
                <button onClick={() => location.reload()}>重试</button>
              </section>
            )
          ) : needsLogin ? (
            <LoginGate meta={meta} refresh={refreshSession} />
          ) : path === "/music" && MusicData ? (
            <MusicData />
          ) : path === "/me" ? (
            <MyMusic meta={meta} session={session} refresh={refreshSession} />
          ) : path === "/lab" && Lab ? (
            <Lab meta={meta} />
          ) : id ? (
            <RoomPage key={id} id={id} onDuel={setDuel} />
          ) : (
            <Home
              meta={meta}
              session={session}
              navigate={navigate}
              refresh={refreshSession}
            />
          )}
        </Suspense>
      </div>
      {menu && (
        <MangaDialog
          title={
            menu === "settings"
              ? "设置"
              : menu === "rules"
                ? "玩法说明"
                : "回到首页，重新入座？"
          }
          wide={menu === "rules"}
          close={() => setMenu("")}
        >
          {menu === "rules" ? (
            <RulesDoc />
          ) : menu === "restart" ? (
            <div className="mg-menu">
              <p>当前房间会保留。你可以稍后通过原链接回来。</p>
              <button
                className="mg-btn mg-primary"
                onClick={() => {
                  setMenu("");
                  navigate("/");
                }}
              >
                回到首页
              </button>
            </div>
          ) : (
            <div className="mg-menu">
              <button className="mg-btn" onClick={() => setMenu("rules")}>
                玩法与卡牌
              </button>
              {Lab && !meta?.playtest && (
                <button
                  className="mg-btn"
                  onClick={() => {
                    setMenu("");
                    navigate("/lab");
                  }}
                >
                  接口实验室
                </button>
              )}
              {MusicData && (
                <button
                  className="mg-btn"
                  onClick={() => {
                    setMenu("");
                    navigate("/music");
                  }}
                >
                  音乐资料
                </button>
              )}
              <button
                className="mg-btn"
                onClick={() => {
                  setMenu("");
                  navigate("/me");
                }}
              >
                QQ 音乐授权与个人音乐
              </button>
              {meta?.playtest && (
                <button
                  className="mg-btn"
                  onClick={() =>
                    void fetch("/test-logout", {
                      method: "POST",
                      credentials: "same-origin",
                    }).then(() => location.reload())
                  }
                >
                  退出测试
                </button>
              )}
            </div>
          )}
        </MangaDialog>
      )}
      {/* 移动端退出确认：返回键、边缘内滑都会走到这里。 */}
      {exit.asking && (
        <div
          className="mg-exit"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mg-exit-t"
        >
          <div className="mg-exit-card">
            <h2 id="mg-exit-t">要离开 Hidden Track 吗？</h2>
            <p>当前房间会保留，下次可以继续。</p>
            <div className="mg-exit-acts">
              <button className="mg-btn mg-primary" onClick={exit.cancel}>
                <span>继续游戏</span>
              </button>
              <button className="mg-btn mg-ghost" onClick={exit.confirm}>
                <span>退出</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
