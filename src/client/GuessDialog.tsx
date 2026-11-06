import { useEffect, useRef, useState } from 'react';
import type { RoomView, SongSummary, PlayerAction } from '../shared/protocol';
import { api } from './api';
import { errorText } from './utils';
import { isTouchDevice } from './useExitGuard';
export function GuessDialog({
  room,
  busy,
  open,
  close,
  action,
}: {
  room: RoomView;
  busy: boolean;
  open: boolean;
  close: () => void;
  action: (a: PlayerAction) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    request = useRef<AbortController | null>(null);
  const [query, setQuery] = useState(''),
    [songs, setSongs] = useState<SongSummary[]>([]),
    [chosen, setChosen] = useState<SongSummary>();
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [searched, setSearched] = useState('');
  const g = room.game!;
  useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) {
      setChosen(undefined);
      node.showModal();
      if (isTouchDevice()) node.focus({ preventScroll: true });
    } else if (!open) node?.close();
    return () => request.current?.abort();
  }, [open, room.game?.matchId]);
  useEffect(() => {
    request.current?.abort();
    setChosen(undefined);
    setSongs([]);
    setSearched('');
    setError('');
    setLoading(false);
    if (!open || !query.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    const timer = setTimeout(() => {
      void api<{ songs: SongSummary[] }>(
        `/music/search?mode=${room.mode}&q=${encodeURIComponent(query.trim())}`,
        undefined,
        undefined,
        controller.signal,
      )
        .then((r) => {
          if (!controller.signal.aborted) {
            setSongs(r.songs);
            setSearched(query.trim());
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(errorText(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 280);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open, room.mode]);
  const direct =
    !!query.trim() && searched === query.trim() && !songs.length && !error;
  return (
    <dialog
      ref={dialog}
      className="dlg-frame"
      autoFocus={isTouchDevice()}
      tabIndex={-1}
      aria-labelledby="guess-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="duel-dialog dlg guess-dialog-new">
        <header className="dh">
          <div>
            <h2 id="guess-title">猜对方的底牌</h2>
            <p>
              {g.mustGuess ? (
                '最终猜歌，双方提交后统一结算'
              ) : (
                <>
                  本局剩余 <b>{g.guessesRemaining}</b> 次猜歌机会，猜错压力 +
                  {g.guessMissPressure}
                </>
              )}
            </p>
          </div>
          <button className="xb" onClick={close} aria-label="关闭猜歌">
            ×
          </button>
        </header>
        <input
          className="search"
          autoFocus={!isTouchDevice()}
          aria-label="搜索想猜的歌曲"
          maxLength={100}
          value={query}
          placeholder="搜索歌曲 / 歌手"
          onChange={(e) => {
            request.current?.abort();
            setChosen(undefined);
            setSongs([]);
            setQuery(e.target.value);
          }}
        />
        {error && (
          <p className="search-state" role="alert">
            {error}
          </p>
        )}
        <div className="cands" aria-busy={loading}>
          {songs.map((s) => (
            <button
              key={s.id}
              className={'cand' + (chosen?.id === s.id ? ' sel' : '')}
              aria-pressed={chosen?.id === s.id}
              onClick={() => setChosen(s)}
            >
              <span className="mcv">
                {s.cover ? (
                  <img src={s.cover} alt="" referrerPolicy="no-referrer" />
                ) : (
                  '♪'
                )}
              </span>
              <span className="cc">
                <b>{s.title}</b>
                <small>
                  {s.artists.join(' / ')}
                  {s.album ? ' · ' + s.album : ''}
                </small>
              </span>
              <i className="rd" />
            </button>
          ))}
          {loading && (
            <p className="search-state" role="status">
              搜索中…
            </p>
          )}
          {!songs.length && !loading && !error && (
            <p className="search-state">
              {direct
                ? '未找到候选，可直接提交歌名：' + query.trim()
                : '输入歌名或歌手搜索'}
            </p>
          )}
        </div>
        <footer className="gfoot">
          <span className="risk">
            {g.mustGuess ? '确认后等待对手提交' : '猜错后本回合不能再猜'}
          </span>
          <button
            className="gconfirm"
            disabled={busy || !g.canGuess || loading || !(chosen || direct)}
            onClick={() => {
              if (!g.canGuess || busy || loading || !(chosen || direct)) return;
              action({
                type: 'guess',
                answer: { title: chosen?.title || query.trim() },
              });
              close();
            }}
          >
            确认猜歌
          </button>
        </footer>
      </div>
    </dialog>
  );
}
