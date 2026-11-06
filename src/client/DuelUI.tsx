import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { RoomView } from '../shared/protocol';

/** Closing a presentation dialog never sends a game command. */
export function DuelDialog({
  title,
  close,
  children,
  className = '',
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dlg-frame"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className={'duel-dialog dlg ' + className}>
        <header className="dh">
          <h2>{title}</h2>
          <button className="xb" onClick={close} aria-label="关闭">
            ×
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function DuelAvatar({
  player,
  own = false,
}: {
  player: RoomView['players'][number];
  own?: boolean;
}) {
  const [failed, setFailed] = useState('');
  return (
    <span className={'av' + (own ? ' me' : '')}>
      {player.avatar && failed !== player.avatar ? (
        <img
          src={player.avatar}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(player.avatar || '')}
        />
      ) : (
        player.name.slice(0, 1)
      )}
    </span>
  );
}
export function DuelLogs({ room }: { room: RoomView }) {
  return (
    <div className="logs">
      {[...room.game!.log].reverse().map((l) => (
        <div className="log" key={l.id}>
          <span>{l.side === room.me ? '你' : l.side ? '对手' : '牌桌'}</span>
          <p>{l.text}</p>
        </div>
      ))}
    </div>
  );
}
export const EVENT_SYMBOLS: Record<string, string> = {
  silver: '◇',
  gold: '♭',
  prismatic: '♪',
};
export const EVENT_NAMES: Record<string, string> = {
  silver: '白银',
  gold: '黄金',
  prismatic: '棱彩',
};
