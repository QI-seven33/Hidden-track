import { rememberWebLogin } from './auth-session';
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { errorText, goto } from './utils';
import type { Meta, Session } from './types';
import type { MusicFact } from '../shared/protocol';
import type { LibraryKind, LibraryPage } from '../server/music/personal';
import { MangaAvatar, MangaFrame, MangaIcon } from './MangaUI';
interface PersonalProfile {
  nickname: string;
  avatar?: string;
  membership: MusicFact[];
  notices: string[];
  checkedAt: string;
}
const tabs: [LibraryKind, string][] = [
  ['likes', '我喜欢'],
  ['playlists', '我的歌单'],
  ['recent', '最近播放'],
  ['albums', '收藏专辑'],
  ['follows', '关注歌手'],
  ['daily', '每日推荐'],
];
export function MyMusic({
  session,
  refresh,
}: {
  meta: Meta;
  session: Session;
  refresh: () => Promise<void>;
}) {
  const [profile, setProfile] = useState<PersonalProfile>(),
    [page, setPage] = useState<LibraryPage>(),
    [kind, setKind] = useState<LibraryKind>('likes'),
    [playlistId, setPlaylistId] = useState<string>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    let current = true;
    setProfile(undefined);
    setPage(undefined);
    setError('');
    if (session.qqAuthorized)
      void api<PersonalProfile>('/music/me')
        .then((value) => {
          if (current) setProfile(value);
        })
        .catch((e) => {
          if (current) setError(errorText(e));
        });
    return () => {
      current = false;
      generation.current++;
    };
  }, [session.qqAuthorized]);
  async function load(
    selected: LibraryKind,
    offset = 0,
    id?: string,
    append = false,
  ) {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    if (!append) setPage(undefined);
    setKind(selected);
    setPlaylistId(id);
    try {
      const data = await api<LibraryPage>(
        `/music/me/library?kind=${selected}&offset=${offset}${id ? '&playlistId=' + encodeURIComponent(id) : ''}`,
      );
      if (request === generation.current)
        setPage((previous) =>
          append && previous
            ? {
                ...data,
                items: [
                  ...previous.items,
                  ...data.items.filter(
                    (item) => !previous.items.some((old) => old.id === item.id),
                  ),
                ],
              }
            : data,
        );
    } catch (e) {
      if (request === generation.current) setError(errorText(e));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (session.qqAuthorized) void load('likes');
  }, [session.qqAuthorized]);
  // 游戏身份由玩家保存的称呼决定；QQ 资料只提供头像与音乐资产。
  const gameName = session.name;
  return (
    <MangaFrame>
      <main className="mg-page mg-library">
        <header className="mg-top mg-library-head">
          <button
            className="mg-icon-btn"
            aria-label="返回大厅"
            onClick={() => goto('/')}
          >
            <MangaIcon name="back" />
          </button>
          <h1 className="mg-title">个人资料</h1>
          <button
            className="mg-header-link"
            disabled={loading}
            onClick={() => {
              rememberWebLogin(0);
              void api('/music/auth/logout', {})
                .then(refresh)
                .catch((e) => setError(errorText(e)));
            }}
          >
            退出登录
          </button>
        </header>
        <div className="mg-library-body">
          <section className="mg-library-hero">
            <MangaAvatar
              src={profile?.avatar || session.avatar}
              name={gameName}
              className="mg-face-xl"
            />
            <div className="mg-library-who">
              <b>{gameName}</b>
              <small>
                {session.qqAuthorized
                  ? 'QQ 音乐已连接 · 资料仅自己可见'
                  : '未连接 QQ 音乐'}
              </small>
              <div className="mg-library-facts">
                {profile?.membership.map((fact) => (
                  <span key={fact.label}>
                    {fact.label}
                    <b>{fact.value}</b>
                  </span>
                ))}
                {!profile && session.qqAuthorized && (
                  <span>正在读取账户资料…</span>
                )}
              </div>
            </div>
          </section>
          <nav className="mg-chips" aria-label="个人音乐分类">
            {tabs.map(([value, label]) => (
              <button
                key={value}
                className="mg-chip"
                aria-pressed={kind === value}
                onClick={() => void load(value)}
                disabled={loading}
              >
                {label}
              </button>
            ))}
          </nav>
          <section className="mg-library-list" aria-busy={loading}>
            <header className="mg-library-list-head">
              <h2>
                {page?.title ||
                  tabs.find(([value]) => value === kind)?.[1] ||
                  '歌单歌曲'}
              </h2>
              {page && (
                <span>
                  已显示 {page.items.length}
                  {page.total !== undefined ? ` / ${page.total}` : ''} 项
                </span>
              )}
            </header>
            {loading && <p className="mg-state">正在读取你的音乐资料…</p>}
            {!loading && error && (
              <p className="mg-state" role="alert">
                {error}
              </p>
            )}
            {!loading && page?.notice && (
              <p className="mg-state">{page.notice}</p>
            )}
            {!loading && page && !page.items.length && (
              <p className="mg-state">本次没有返回内容。</p>
            )}
            {page?.items.map((item, index) => (
              <div className="mg-lib-row" key={`${item.id}-${index}`}>
                <span className="mg-lib-cover" aria-hidden="true">
                  {item.cover ? (
                    <img src={item.cover} alt="" loading="lazy" />
                  ) : (
                    <i>♫</i>
                  )}
                </span>
                <span className="mg-lib-copy">
                  <b>{item.title}</b>
                  <small>{item.subtitle}</small>
                  {item.count !== undefined && <small>{item.count} 首</small>}
                  {item.listenCount !== undefined && (
                    <small>播放 {item.listenCount} 次</small>
                  )}
                </span>
                {kind === 'playlists' ? (
                  <button
                    className="mg-lib-action"
                    onClick={() => void load('playlist', 0, item.id)}
                    disabled={loading}
                  >
                    查看歌曲
                  </button>
                ) : null}
              </div>
            ))}
            {page?.hasMore && (
              <button
                className="mg-btn mg-ghost mg-lib-more"
                disabled={loading}
                onClick={() =>
                  void load(kind, page.nextOffset, playlistId, true)
                }
              >
                <span>加载更多</span>
              </button>
            )}
          </section>
        </div>
      </main>
    </MangaFrame>
  );
}
