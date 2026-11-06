import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useBackLayer } from './back-layers';
import { useAudio } from './audio/useAudio';
import { BGM_TRACKS } from './audio/tracks';

export function MangaIcon({ name }: { name: 'back' | 'settings' | 'search' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'settings' ? 1.8 : 2}
      aria-hidden="true"
    >
      {name === 'back' ? (
        <path d="m15 5-7 7 7 7" />
      ) : name === 'search' ? (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 5 5" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19 13.5v-3l-2-.6a7 7 0 0 0-.8-1.8l1-1.8-2.2-2.2-1.8 1a7 7 0 0 0-1.8-.8l-.6-2h-3l-.6 2a7 7 0 0 0-1.8.8l-1.8-1-2.2 2.2 1 1.8a7 7 0 0 0-.8 1.8l-2 .6v3l2 .6a7 7 0 0 0 .8 1.8l-1 1.8 2.2 2.2 1.8-1a7 7 0 0 0 1.8.8l.6 2h3l.6-2a7 7 0 0 0 1.8-.8l1.8 1 2.2-2.2-1-1.8a7 7 0 0 0 .8-1.8l2-.6Z"
            transform="translate(2 2) scale(.83)"
          />
        </>
      )}
    </svg>
  );
}
export function MangaAvatar({
  src,
  name,
  className = '',
}: {
  src?: string;
  name: string;
  className?: string;
}) {
  const initial = [...(name.trim() || '乐')][0];
  return (
    <span className={`mg-face ${className}`}>
      {src ? (
        <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" />
      ) : (
        <b>{initial}</b>
      )}
    </span>
  );
}
export function MangaFrame({
  children,
  lobby = false,
}: {
  children: ReactNode;
  lobby?: boolean;
}) {
  return (
    <div className="manga-app">
      {lobby && (
        <div className="mg-sound-wave" aria-hidden="true">
          {Array.from({ length: 7 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
/**
 * 大厅左侧的黑胶：黑盘 + 荧光绿错位影子 + 中心绿标，盘下挂一行曲名和状态。
 * 转动跟着真实背景音乐走——engine 里 playing 为真时才跑动画，暂停就停住。
 */
export function LobbyTurntable() {
  const audio = useAudio();
  const track = BGM_TRACKS[audio.track] ?? BGM_TRACKS[0]!;
  const state = audio.playing
    ? '正在播放'
    : !audio.bgm
      ? '已关闭'
      : audio.blocked
        ? '浏览器限制自动播放'
        : audio.previewing
          ? '试听中'
          : '已暂停';
  return (
    <div
      className={'mg-turntable' + (audio.playing ? ' is-playing' : '')}
      role="group"
      aria-label={`背景音乐：${track.title}，${state}`}
    >
      <i className="mg-tt-shadow" aria-hidden="true" />
      <i className="mg-tt-disc" aria-hidden="true">
        <i className="mg-tt-label">
          <i className="mg-tt-hole" />
        </i>
      </i>
      <p className="mg-now" title={`${track.title} · ${track.artist}`}>
        <i className="mg-now-bar" aria-hidden="true" />
        <b>{track.title}</b>
        <span>{state}</span>
      </p>
    </div>
  );
}
/**
 * 牌桌内的漫画风弹窗。
 * 大厅用的是 MangaSheet，但它的样式挂在 .manga-shell 下，对局中的 .md-duel
 * 页面用不了；这里给出一份不依赖外层容器的同一套视觉（白卡 + 墨线 + 硬阴影），
 * 让「玩法说明」在大厅和牌桌里看起来是同一个东西。
 */
export function MangaDialog({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
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
      {/* 外层 dialog 只负责顶层与遮罩，卡片样式挂在这一层，
          竖屏旋转时才能整体跟着转（见 rotate.css）。 */}
      <div className={'manga-dialog' + (wide ? ' is-wide' : '')}>
        <header className="mdh">
          <h2>{title}</h2>
          <button className="xb" aria-label="关闭" onClick={close}>
            ×
          </button>
        </header>
        <div className="mdb">{children}</div>
      </div>
    </dialog>
  );
}
export function MangaSheet({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null),
    label = useId(),
    closeRef = useRef(close);
  closeRef.current = close;
  useBackLayer(() => closeRef.current());
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previous = document.activeElement;
    const siblings = [...(node.parentElement?.children ?? [])].filter(
      (n): n is HTMLElement => n instanceof HTMLElement && n !== node,
    );
    const old = siblings.map((n) => n.inert);
    siblings.forEach((n) => {
      n.inert = true;
    });
    const focusable = () => [
      ...node.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),a[href],select',
      ),
    ];
    node.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === 'Tab') {
        const all = focusable();
        const first = all[0],
          last = all.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === node)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    node.addEventListener('keydown', key);
    return () => {
      node.removeEventListener('keydown', key);
      siblings.forEach((n, i) => {
        n.inert = old[i]!;
      });
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <div
      className="mg-overlay"
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={label}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section className="mg-sheet">
        <header className="mg-sheet-head">
          <h2 id={label}>{title}</h2>
          <button className="mg-close" aria-label="关闭" onClick={close}>
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
