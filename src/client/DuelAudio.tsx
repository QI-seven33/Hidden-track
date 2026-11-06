import { useEffect, useRef, useState } from 'react';
import type { SongSummary } from '../shared/protocol';
import { setPreviewing, isAudioBackgrounded } from './audio/engine';
type Grant = { id: string; seconds: number; since?: number; sent: boolean };
/** Playback lifecycle is separate from settlement. Unmount/revocation cancels stale requests. */
export function AudioPlayer({
  song,
  roomId,
  permissionKey = '',
  seconds = 10,
  compact = false,
  autoPlay = false,
  autoDelay = 1500,
}: {
  song?: SongSummary;
  roomId?: string;
  permissionKey?: string;
  seconds?: number;
  compact?: boolean;
  /** 结算页用：停顿一下再自己起播，省掉玩家再点一次。手动暂停照常有效。 */
  autoPlay?: boolean;
  autoDelay?: number;
}) {
  const audio = useRef<HTMLAudioElement>(null),
    expires = useRef(0),
    request = useRef<AbortController | null>(null),
    grant = useRef<Grant | undefined>(undefined),
    generation = useRef(0);
  const [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [message, setMessage] = useState(''),
    [login, setLogin] = useState(false),
    [playing, setPlaying] = useState(false),
    [preview, setPreview] = useState(Boolean(roomId));
  // 自动起播只做一次：切到自己的底牌再切回来时不要又响一遍。
  const autoDone = useRef(false),
    autoConfig = useRef({ autoPlay, autoDelay });
  autoConfig.current = { autoPlay, autoDelay };
  function accumulate() {
    const g = grant.current;
    if (g?.since !== undefined) {
      g.seconds += (performance.now() - g.since) / 1000;
      g.since = undefined;
    }
  }
  function report(ended = false) {
    accumulate();
    const g = grant.current;
    if (!g || g.sent) return;
    g.sent = true;
    void fetch('/api/music/listen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify({
        grantId: g.id,
        seconds: Math.floor(g.seconds),
        ended,
      }),
    })
      .then((r) => {
        if (!r.ok) g.sent = false;
      })
      .catch(() => {
        g.sent = false;
      });
  }
  function release() {
    audio.current?.pause();
    setPreviewing(false);
    report();
    if (audio.current) {
      audio.current.removeAttribute('src');
      audio.current.load();
    }
    expires.current = 0;
    grant.current = undefined;
  }
  useEffect(() => {
    generation.current++;
    request.current?.abort();
    release();
    setLoaded(false);
    setPlaying(false);
    setBusy(false);
    setMessage('');
    setLogin(false);
    setPreview(Boolean(roomId));
    const hide = () => {
      if (document.hidden) {
        audio.current?.pause();
        accumulate();
      }
    };
    const pauseNative = () => {
      audio.current?.pause();
      accumulate();
    };
    document.addEventListener('visibilitychange', hide);
    addEventListener('ht-background', pauseNative);
    // 结算页：先留出看结果的时间，再替玩家把对方的底牌放出来。
    // 起播失败（浏览器拦自动播放）会落到 start() 的提示上，按钮照样能点。
    let autoTimer: ReturnType<typeof setTimeout> | undefined;
    const auto = autoConfig.current;
    if (auto.autoPlay && !autoDone.current && song?.id) {
      autoDone.current = true;
      setMessage('稍后自动播放对方的底牌…');
      autoTimer = setTimeout(() => void start(), Math.max(0, auto.autoDelay));
    }
    return () => {
      generation.current++;
      if (autoTimer) clearTimeout(autoTimer);
      request.current?.abort();
      release();
      document.removeEventListener('visibilitychange', hide);
      removeEventListener('ht-background', pauseNative);
      // 试听停了就把背景音乐还原，避免离开这一页后还压着。
      setPreviewing(false);
    };
  }, [song?.id, roomId, permissionKey, seconds]);
  async function start() {
    if (document.hidden || isAudioBackgrounded()) return;
    if (loaded && audio.current && (!roomId || expires.current > Date.now())) {
      try {
        if (audio.current.ended) audio.current.currentTime = 0;
        await audio.current.play();
        setMessage(roomId || preview ? '正在播放试听片段' : '正在播放完整音乐');
      } catch {
        setMessage(compact ? '点 ▶ 继续播放' : '请点下方播放器的播放键');
      }
      return;
    }
    request.current?.abort();
    release();
    const epoch = generation.current,
      controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage(
      roomId ? '正在请求已解锁的试听片段…' : '正在请求当前账号的音乐资源…',
    );
    setLogin(false);
    try {
      const response = await fetch(
        roomId
          ? `/api/rooms/${encodeURIComponent(roomId)}/preview-source`
          : '/api/music/playback',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(roomId ? {} : { songId: song?.id }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if ([401, 403].includes(response.status)) setLogin(true);
        throw new Error(body.error?.message || '官方音频暂时不可用，请重试');
      }
      let src: string,
        id: string,
        isPreview = Boolean(roomId);
      if (roomId) {
        const body = await response.json();
        if (controller.signal.aborted || epoch !== generation.current) return;
        const prefix =
          '/api/rooms/' + encodeURIComponent(roomId) + '/preview-source/';
        if (
          typeof body.src !== 'string' ||
          !body.src.startsWith(prefix) ||
          !/^[A-Za-z0-9_-]{32}$/.test(body.src.slice(prefix.length)) ||
          typeof body.grantId !== 'string' ||
          !Number.isFinite(body.expiresAt)
        )
          throw new Error('试听资源响应无效，请重试');
        src = body.src;
        id = body.grantId;
        expires.current = body.expiresAt;
      } else {
        const body = await response.json();
        if (controller.signal.aborted || epoch !== generation.current) return;
        if (body.requiresDecoding)
          throw new Error(
            body.note ||
              `QQ 音乐返回完整 ${String(body.format || '音频').toUpperCase()} 资源，需解码后播放。`,
          );
        isPreview = body.preview === true;
        setPreview(isPreview);
        src = body.url;
        id = body.grantId;
      }
      const node = audio.current;
      if (!node || document.hidden || isAudioBackgrounded()) return;
      grant.current = { id, seconds: 0, sent: false };
      node.src = src;
      node.load();
      setLoaded(true);
      setBusy(false);
      setMessage('音频已载入，正在启动播放…');
      try {
        await node.play();
        if (epoch === generation.current)
          setMessage(
            roomId
              ? `试听 · 已解锁前 ${seconds} 秒`
              : isPreview
                ? 'QQ 音乐本次返回试听片段'
                : '正在播放完整音乐',
          );
      } catch (error) {
        if (epoch === generation.current)
          setMessage(
            error instanceof DOMException && error.name === 'NotAllowedError'
              ? compact
                ? '点 ▶ 听对方的底牌'
                : '音频已载入，请再点播放或下方播放器'
              : compact
                ? '播放未能启动，点 ▶ 重试'
                : '播放未能启动，请重试或查看下方播放器',
          );
      }
    } catch (e) {
      if (!controller.signal.aborted && epoch === generation.current)
        setMessage(e instanceof Error ? e.message : '试听载入失败');
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  }
  return (
    <div className={compact ? 'audio duel-audio' : 'audio'}>
      <button
        disabled={busy}
        aria-label={playing ? '暂停音乐' : roomId ? '播放试听' : '播放音乐'}
        onClick={() => {
          if (compact && playing) audio.current?.pause();
          else void start();
        }}
      >
        {compact
          ? busy
            ? '…'
            : playing
              ? 'Ⅱ'
              : '▶'
          : busy
            ? '载入中…'
            : loaded
              ? '播放 / 重播'
              : roomId
                ? '播放已解锁试听'
                : '播放音乐'}
      </button>
      <audio
        ref={audio}
        controls={!compact}
        playsInline
        preload="none"
        hidden={!loaded}
        aria-label={roomId ? '试听播放器' : '音乐播放器'}
        onPlaying={() => {
          if (document.hidden || isAudioBackgrounded()) {
            audio.current?.pause();
            return;
          }
          setPlaying(true);
          setPreviewing(true);
          if (grant.current && grant.current.since === undefined)
            grant.current.since = performance.now();
        }}
        onPause={() => {
          accumulate();
          setPlaying(false);
          setPreviewing(false);
        }}
        onCanPlay={() =>
          setMessage(
            roomId
              ? `试听 · 已解锁前 ${seconds} 秒`
              : preview
                ? 'QQ 试听片段已就绪'
                : '完整音乐已就绪',
          )
        }
        onWaiting={accumulate}
        onSeeking={accumulate}
        onEnded={() => {
          report(true);
          setPlaying(false);
          setPreviewing(false);
        }}
        onError={() => {
          if (!grant.current) return;
          accumulate();
          setPlaying(false);
          setPreviewing(false);
          setLoaded(false);
          setMessage('音频未能解码或资源已失效，请点播放重新载入');
        }}
      />
      <small role="status">{message}</small>
      {login && (
        <a href="/" target="_blank" rel="noreferrer">
          打开首页登录 QQ 音乐，完成后回此页重试
        </a>
      )}
    </div>
  );
}
