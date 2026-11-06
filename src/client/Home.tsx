import { rememberWebLogin } from './auth-session';
import { useEffect, useRef, useState } from 'react';
import type { Meta, Session } from './types';
import type { MusicMode, RoomView } from '../shared/protocol';
import { warmCardArt } from './presentation/preload';
import { api, ApiError } from './api';
import { errorText } from './utils';
import {
  LobbyTurntable,
  MangaAvatar,
  MangaFrame,
  MangaIcon,
  MangaSheet,
} from './MangaUI';
import { AudioSettings } from './audio/AudioSettings';
import { isStandaloneApp } from './useExitGuard';
import { RulesDoc } from './RulesDoc';

export function Home({
  meta,
  session,
  navigate,
  refresh,
}: {
  meta: Meta;
  session: Session;
  navigate: (to: string) => void;
  refresh: () => Promise<void>;
}) {
  const [sheet, setSheet] = useState<
    'join' | 'profile' | 'settings' | 'rules' | ''
  >('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [code, setCode] = useState(''),
    [name, setName] = useState(session.name);
  // 曲库来源只有一种：配置了 QQ 音乐就走真实曲库，否则退回本地测试曲目。
  // 两种来源返回的资料结构完全一致，个人资料里的下拉框只是多一个无意义开关。
  const mode: MusicMode = meta.qqConfigured ? 'qq' : 'fixture';
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  function showError(value: unknown) {
    clearTimeout(noticeTimer.current);
    const message = errorText(value);
    setError(message);
    if (value instanceof ApiError && value.code === 'MULTIPLAYER_UNAVAILABLE')
      noticeTimer.current = setTimeout(
        () => setError((current) => (current === message ? '' : current)),
        3000,
      );
  }
  const close = () => {
    setSheet('');
    setError('');
  };
  // 打开个人资料时预取曲库页，点「我的音乐库」不再经过一次空白的懒加载等待。
  useEffect(() => {
    if (sheet === 'profile') void import('./MyMusic');
  }, [sheet]);
  async function create(bot = false, chosenMode = mode) {
    setBusy(true);
    setError('');
    try {
      await warmCardArt();
      const r = await api<{ room: RoomView; invite: string }>('/rooms', {
        mode: chosenMode,
        bot,
      });
      navigate(`/r/${r.room.id}#invite=${r.invite}`);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ room: RoomView }>('/rooms/join', {
        code: code.trim(),
      });
      navigate('/r/' + r.room.id);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }
  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/session', { name });
      await refresh();
      close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <MangaFrame lobby>
      <section className="mg-page mg-lobby">
        <header className="mg-top">
          <button
            className="mg-identity"
            aria-label="个人资料"
            onClick={() => {
              setName(session.name);
              setSheet('profile');
            }}
          >
            <MangaAvatar
              src={session.avatar}
              name={session.name}
              className="mg-face-lg"
            />
            <span>
              <b>{session.name}</b>
              <small>
                {session.qqAuthorized ? 'QQ 音乐已连接' : '未连接 QQ 音乐'}
              </small>
            </span>
          </button>
          <button
            className="mg-icon-btn"
            aria-label="设置"
            onClick={() => setSheet('settings')}
          >
            <MangaIcon name="settings" />
          </button>
        </header>
        <main className="mg-lobby-main">
          <LobbyTurntable />
          <div className="mg-room-actions">
            <button
              className="mg-btn mg-primary"
              disabled={busy}
              onClick={() => void create()}
            >
              <span>{busy ? '创建中…' : '创建房间'}</span>
            </button>
            <button
              className="mg-btn"
              disabled={busy}
              onClick={() => setSheet('join')}
            >
              <span>加入房间</span>
            </button>
          </div>
        </main>
      </section>
      {sheet === 'join' && (
        <MangaSheet title="加入房间" close={close}>
          <form className="mg-join-form" onSubmit={(e) => void join(e)}>
            <input
              className="mg-code-input"
              placeholder="房间号"
              aria-label="房间号"
              value={code}
              maxLength={8}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button className="mg-btn mg-primary" disabled={busy}>
              <span>{busy ? '加入中…' : '加入'}</span>
            </button>
          </form>
        </MangaSheet>
      )}
      {sheet === 'settings' && (
        <MangaSheet title="设置" close={close}>
          <AudioSettings />
          {(meta.practice ?? meta.fixtures) && (
            <div className="mg-setting-row">
              <span>本地练习</span>
              <button
                className="mg-sheet-link"
                disabled={busy}
                onClick={() => {
                  void create(true, 'fixture');
                }}
              >
                与电脑试一局
              </button>
            </div>
          )}
          <div className="mg-setting-row">
            <span>规则</span>
            <button className="mg-sheet-link" onClick={() => setSheet('rules')}>
              玩法说明
            </button>
          </div>
          {isStandaloneApp() && (
            <div className="mg-setting-row">
              <span>离开</span>
              <button
                className="mg-sheet-link"
                onClick={() => dispatchEvent(new Event('request-exit'))}
              >
                退出游戏
              </button>
            </div>
          )}
        </MangaSheet>
      )}
      {sheet === 'rules' && (
        <MangaSheet title="玩法说明" close={close}>
          <RulesDoc />
        </MangaSheet>
      )}
      {sheet === 'profile' && (
        <MangaSheet title="个人资料" close={close}>
          <div className="mg-profile-card">
            <MangaAvatar
              src={session.avatar}
              name={session.name}
              className="mg-face-xl"
            />
            <div>
              <b>{session.name}</b>
              <small>
                {session.qqAuthorized
                  ? 'QQ 音乐已连接'
                  : meta.qqConfigured
                    ? '未连接 QQ 音乐'
                    : '服务器未配置 QQ 音乐'}
              </small>
            </div>
          </div>
          <form className="mg-profile" onSubmit={(e) => void saveName(e)}>
            <label className="mg-field-label" htmlFor="mg-player-name">
              游戏内称呼
            </label>
            <input
              id="mg-player-name"
              className="mg-code-input mg-name-input"
              aria-label="你的称呼"
              value={name}
              maxLength={24}
              placeholder={session.nickname || '起一个称呼'}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="mg-btn" disabled={busy || !name.trim()}>
              <span>保存称呼</span>
            </button>
          </form>
          <button className="mg-btn mg-ghost" onClick={() => navigate('/me')}>
            <span>我的音乐库</span>
          </button>
          {session.qqAuthorized ? (
            <button
              className="mg-btn mg-ghost"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                rememberWebLogin(0);
                void api('/music/auth/logout', {})
                  .then(refresh)
                  .catch((e) => setError(errorText(e)))
                  .finally(() => setBusy(false));
              }}
            >
              <span>退出 QQ 音乐登录</span>
            </button>
          ) : (
            <button
              className="mg-btn mg-ghost"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void refresh()
                  .catch((e) => setError(errorText(e)))
                  .finally(() => setBusy(false));
              }}
            >
              <span>重新检测连接</span>
            </button>
          )}
        </MangaSheet>
      )}
      {error && (
        <div className="mg-toast" role="alert">
          {error}
        </div>
      )}
    </MangaFrame>
  );
}
