import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { errorText, goto, copyText } from './utils';
import type { RoomView, SongSummary } from '../shared/protocol';
import { MangaAvatar, MangaFrame, MangaIcon, MangaSheet } from './MangaUI';

type AlbumInfo = {
  title: string;
  description: string;
  releaseDate: string;
  cover?: string;
};

function coverOf(song?: SongSummary) {
  return song?.cover && /^https?:\/\//.test(song.cover) ? song.cover : '';
}
function timeText(seconds?: number) {
  if (!seconds || seconds <= 0) return '';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MangaSelection({
  room,
  busy,
  error,
  select,
  ready,
  swap,
  answerSwap,
  retryStart,
}: {
  room: RoomView;
  busy: boolean;
  error: string;
  select: (id: string) => void;
  ready: (value: boolean) => void;
  swap: () => void;
  answerSwap: (accept: boolean) => void;
  retryStart?: () => void;
}) {
  const [query, setQuery] = useState(''),
    [songs, setSongs] = useState<SongSummary[]>([]),
    [loading, setLoading] = useState(false),
    [searchError, setSearchError] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false),
    [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState<SongSummary>();
  const [albums, setAlbums] = useState<Record<string, AlbumInfo>>({});
  const me = room.players.find((p) => p.seat === room.me)!,
    enemy = room.players.find((p) => p.seat !== room.me)!;
  // 换位申请：自己发的等对方点头，对方发的在自己这儿弹气泡。
  const asking = room.swapAsk?.from === room.me;
  const asked = Boolean(room.swapAsk && !asking);
  // 座位真的换了才放一次动画，避免每次重渲染都抖一下。
  const [swapping, setSwapping] = useState(false);
  const seenSeat = useRef(room.me);
  useEffect(() => {
    if (seenSeat.current === room.me) return;
    seenSeat.current = room.me;
    setSwapping(true);
    const timer = setTimeout(() => setSwapping(false), 620);
    return () => clearTimeout(timer);
  }, [room.me]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(
      () => {
        setLoading(true);
        setSearchError('');
        void api<{ songs: SongSummary[] }>(
          `/music/search?mode=${room.mode}&q=${encodeURIComponent(query.trim())}`,
          undefined,
          undefined,
          controller.signal,
        )
          .then((r) => {
            if (active) {
              setSongs(r.songs);
              setHovered(undefined);
            }
          })
          .catch((e) => {
            if (active && !controller.signal.aborted)
              setSearchError(errorText(e));
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      },
      query ? 300 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, room.mode]);
  // 右侧资料：一旦确认了底牌就锁定它，之后悬停别的歌不再改写右侧；
  // 还没选定时才跟随悬停/聚焦的曲目，最后退回第一条搜索结果。
  const preview = room.ownSong ?? hovered ?? songs[0];
  const albumMid = preview?.albumMid;
  useEffect(() => {
    if (room.mode !== 'qq' || !albumMid || albums[albumMid]) return;
    let active = true;
    void api<AlbumInfo>(`/music/album?mid=${encodeURIComponent(albumMid)}`)
      .then((info) => {
        if (active) setAlbums((old) => ({ ...old, [albumMid]: info }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [albumMid, room.mode, albums]);
  const album = albumMid ? albums[albumMid] : undefined;
  const facts = useMemo(
    () =>
      [
        preview?.album ? ['专辑', preview.album] : undefined,
        album?.releaseDate ? ['发行', album.releaseDate] : undefined,
        preview?.year ? ['年份', String(preview.year)] : undefined,
        timeText(preview?.duration)
          ? ['时长', timeText(preview?.duration)!]
          : undefined,
      ].filter((row): row is [string, string] => Boolean(row)),
    [preview?.album, preview?.year, preview?.duration, album?.releaseDate],
  );
  return (
    <MangaFrame>
      <main className="mg-page mg-select">
        <header className="mg-top mg-select-head">
          <button
            className="mg-icon-btn"
            aria-label="返回大厅"
            onClick={() => goto('/')}
          >
            <MangaIcon name="back" />
          </button>
          <h1 className="mg-title">选择底牌</h1>
          <span className="mg-spacer" />
        </header>
        <div className={'mg-players' + (swapping ? ' is-swapping' : '')}>
          <div className="mg-player">
            <MangaAvatar
              src={me.avatar}
              name={me.name}
              className="mg-player-face"
            />
            <div>
              <b>{me.name}</b>
              <small className={me.ready ? 'is-ready' : ''}>
                {me.ready
                  ? me.seat === 'a'
                    ? '已准备 · 你先行动'
                    : '已准备 · 对手先行动'
                  : '选歌中'}
              </small>
            </div>
          </div>
          <button
            className={'mg-swap' + (asking ? ' is-asking' : '')}
            disabled={busy || !enemy.joined || Boolean(room.swapAsk)}
            title={
              asking
                ? '已发出换位申请，等对方同意'
                : asked
                  ? '对方正在等你回应换位申请'
                  : enemy.joined
                    ? '向对手申请换位，同意后交换先后手'
                    : '等对手加入后才能换位'
            }
            aria-label="向对手申请换位"
            onClick={swap}
          >
            <b aria-hidden="true">⇄</b>
            <small>{asking ? '已申请' : asked ? '待回应' : '换位'}</small>
          </button>
          <button
            className="mg-player mg-friend"
            title={!enemy.joined ? '点击邀请乐友' : undefined}
            aria-label={!enemy.joined ? '邀请乐友，查看房间号' : enemy.name}
            onClick={() => {
              if (!enemy.joined) {
                setCopied(false);
                setInviteOpen(true);
              }
            }}
          >
            <MangaAvatar
              src={enemy.joined ? enemy.avatar : undefined}
              name={enemy.joined ? enemy.name : '友'}
              className="mg-player-face"
            />
            <div>
              <b>{enemy.joined ? enemy.name : '乐友'}</b>
              <small>
                {enemy.joined
                  ? enemy.ready
                    ? enemy.seat === 'a'
                      ? '已准备 · 对手先行动'
                      : '已准备 · 你先行动'
                    : '选歌中'
                  : '等待加入'}
              </small>
            </div>
          </button>
          {asked && (
            <div className="mg-ask" role="group" aria-label="换位申请">
              <b>{enemy.name || '对手'} 想和你换位</b>
              <p>同意后交换先后手</p>
              <div className="mg-ask-acts">
                <button
                  type="button"
                  className="mg-ask-yes"
                  disabled={busy}
                  onClick={() => answerSwap(true)}
                >
                  同意
                </button>
                <button
                  type="button"
                  className="mg-ask-no"
                  disabled={busy}
                  onClick={() => answerSwap(false)}
                >
                  拒绝
                </button>
              </div>
            </div>
          )}
        </div>
        <form className="mg-search-wrap" onSubmit={(e) => e.preventDefault()}>
          <label className="mg-search">
            <MangaIcon name="search" />
            <input
              placeholder="搜索歌曲或歌手"
              aria-label="搜索歌曲或歌手"
              value={query}
              maxLength={100}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </form>
        <div className="mg-songs" aria-label="歌曲搜索结果" aria-busy={loading}>
          {loading && (
            <p className="mg-state" role="status">
              搜索中…
            </p>
          )}
          {!loading && searchError && (
            <p className="mg-state" role="alert">
              {searchError}
            </p>
          )}
          {!loading &&
            !searchError &&
            songs.map((song) => (
              <button
                type="button"
                className={
                  'mg-song' +
                  (room.ownSong?.id === song.id ? ' selected' : '') +
                  (preview?.id === song.id ? ' previewing' : '')
                }
                key={song.id}
                aria-pressed={room.ownSong?.id === song.id}
                disabled={busy}
                onFocus={() => setHovered(song)}
                onMouseEnter={() => setHovered(song)}
                onClick={() => select(song.id)}
              >
                <span className="mg-song-cover" aria-hidden="true">
                  {coverOf(song) ? (
                    <img
                      src={coverOf(song)}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <i>♫</i>
                  )}
                </span>
                <span className="mg-song-text">
                  <b>{song.title}</b>
                  <small>
                    {song.artists.join(' / ')}
                    {song.album ? ` · ${song.album}` : ''}
                  </small>
                </span>
                <span className="mg-radio" aria-hidden="true">
                  {room.ownSong?.id === song.id ? '✓' : ''}
                </span>
              </button>
            ))}
          {!loading && !searchError && !songs.length && (
            <p className="mg-state">
              {room.mode === 'qq' && !query
                ? '搜索歌曲或歌手'
                : '没有匹配的歌曲'}
            </p>
          )}
        </div>
        <aside className="mg-side" aria-label="歌曲与专辑资料">
          <div className="mg-album">
            <div className="mg-album-cover">
              {coverOf(preview) || album?.cover ? (
                <img
                  src={coverOf(preview) || album?.cover}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span aria-hidden="true">♫</span>
              )}
            </div>
            <div className="mg-album-copy">
              <span className="mg-side-label">专辑资料</span>
              <b>{preview?.title || '还没有选歌'}</b>
              <small>{preview?.artists.join(' / ') || '搜索后点选一首'}</small>
              {facts.length > 0 && (
                <dl className="mg-album-facts">
                  {facts.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            {album?.description && (
              <p className="mg-album-desc">{album.description}</p>
            )}
          </div>
          <footer className="mg-bottom">
            <div className="mg-current">
              <div>
                <span className="mg-current-label">当前底牌</span>
                <b>{room.ownSong?.title || '未选择'}</b>
              </div>
              <span className="mg-private">仅自己可见</span>
            </div>
            <button
              className="mg-btn mg-primary"
              disabled={busy || !room.ownSong}
              onClick={() => ready(!me.ready)}
            >
              <span>{me.ready ? '取消准备' : '准备'}</span>
            </button>
          </footer>
        </aside>
      </main>
      {inviteOpen && (
        <MangaSheet title="邀请乐友" close={() => setInviteOpen(false)}>
          <p className="mg-invite-hint">
            把房间号发给乐友，让他在地大厅「加入房间」里输入即可。
          </p>
          <input
            className="mg-code-input"
            aria-label="房间号"
            readOnly
            value={room.roomCode || ''}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            className="mg-btn mg-primary"
            onClick={() => {
              if (!room.roomCode) return;
              void copyText(room.roomCode).then((ok) => {
                setCopied(ok);
                if (!ok)
                  document
                    .querySelector<HTMLInputElement>('.mg-overlay input')
                    ?.select();
              });
            }}
          >
            <span>{copied ? '已复制 ✓' : '复制房间号'}</span>
          </button>
          {copied && (
            <p className="mg-invite-ok" role="status">
              房间号已复制到剪贴板
            </p>
          )}
        </MangaSheet>
      )}
      {error && (
        <div className="mg-toast" role="alert">
          {error}
          {retryStart && (
            <button
              className="mg-sheet-link"
              disabled={busy}
              onClick={retryStart}
            >
              重试
            </button>
          )}
        </div>
      )}
    </MangaFrame>
  );
}
