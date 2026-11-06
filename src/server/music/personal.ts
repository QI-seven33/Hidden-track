import {
  QQMusic,
  object,
  text,
  number,
  coverUrl,
  songList,
  songFromQQ,
} from './qq';
import type { QQAuth } from '../store';
import { AppError } from '../errors';
import type { MusicFact } from '../../shared/protocol';
type Context = { ip: string; device: string; auth?: QQAuth };
export interface LibraryItem {
  id: string;
  title: string;
  subtitle: string;
  cover?: string;
  songId?: string;
  count?: number;
  lastPlayedAt?: number;
  listenCount?: number;
}
export type LibraryKind =
  | 'playlists'
  | 'playlist'
  | 'likes'
  | 'recent'
  | 'albums'
  | 'follows'
  | 'daily';
export interface LibraryPage {
  kind: LibraryKind;
  title: string;
  items: LibraryItem[];
  total?: number;
  hasMore: boolean;
  nextOffset: number;
  notice?: string;
}
export function requireIdentity(context: Context) {
  if (!context.auth)
    throw new AppError(401, '请先扫码授权 QQ 音乐', 'QQ_LOGIN_REQUIRED');
}
export async function personalProfile(qq: QQMusic, context: Context) {
  requireIdentity(context);
  const data = await qq.call(
      'fcg_music_custom_get_account_info.fcg',
      {},
      context,
    ),
    user = object(data.user_info);
  const notices: string[] = [],
    membership: MusicFact[] = [];
  try {
    const vip = await qq.call('fcg_music_rpc_green_vip_info.fcg', {}, context);
    for (const [flag, label, start, end] of [
      ['green_vip_flag', '绿钻', 'green_vip_start_time', 'green_vip_end_time'],
      [
        'super_green_vip_flag',
        '豪华绿钻',
        'super_green_vip_start_time',
        'super_green_vip_end_time',
      ],
      ['huge_vip_flag', '超级会员', 'huge_vip_start_time', 'huge_vip_end_time'],
      ['lm_flag', '听书会员', 'lm_start', 'lm_end'],
      ['eight_flag', '付费包', 'eight_start_time', 'eight_end_time'],
      ['twelve_flag', '豪华付费包', 'twelve_start_time', 'twelve_end_time'],
      [
        'partner_dolby_vip_flag',
        '杜比权益',
        'partner_dolby_vip_start_time',
        'partner_dolby_vip_end_time',
      ],
    ] as const) {
      if (vip[flag] === undefined) continue;
      membership.push({
        label,
        value: number(vip[flag]) === 1 ? '已开通' : '未开通',
        ...(number(vip[flag]) === 1
          ? {
              note: [text(vip[start]), text(vip[end])]
                .filter(Boolean)
                .join(' 至 '),
            }
          : {}),
      });
    }
    if (number(vip.icur_level) > 0)
      membership.push({
        label: '绿钻等级',
        value: String(number(vip.icur_level)),
      });
  } catch {
    notices.push('会员资料本次未读到，其余个人资料仍可查看。');
  }
  return {
    nickname: text(user.nickname),
    avatar: coverUrl(user.headimgurl),
    membership,
    notices,
    checkedAt: new Date().toISOString(),
  };
}
function tracks(values: unknown): LibraryItem[] {
  return Array.isArray(values)
    ? values.flatMap((v) => {
        try {
          const s = songFromQQ(v);
          return [
            {
              id: s.id,
              songId: s.id,
              title: s.title,
              subtitle: [s.artists.join(' / '), s.album]
                .filter(Boolean)
                .join(' · '),
              cover: s.cover,
            },
          ];
        } catch {
          return [];
        }
      })
    : [];
}
export async function personalLibrary(
  qq: QQMusic,
  context: Context,
  kind: LibraryKind,
  offset = 0,
  playlistId?: string,
): Promise<LibraryPage> {
  requireIdentity(context);
  let data: Record<string, unknown>,
    items: LibraryItem[] = [],
    title = '',
    total: number | undefined,
    hasMore = false,
    nextOffset = offset,
    notice: string | undefined;
  if (kind === 'playlists') {
    data = await qq.call('fcg_music_custom_get_songlist_self.fcg', {}, context);
    items = (Array.isArray(data.data) ? data.data : []).map((v) => {
      const r = object(v);
      return {
        id: text(r.diss_id),
        title: text(r.diss_name),
        subtitle: `${number(r.song_num)} 首 · ${number(r.listen_num)} 次收听`,
        count: number(r.song_num),
        cover: coverUrl(r.diss_pic),
      };
    });
    title = '我的歌单';
    total = items.length;
  } else if (kind === 'likes' || kind === 'playlist') {
    if (kind === 'playlist') {
      const owned = await qq.call(
        'fcg_music_custom_get_songlist_self.fcg',
        {},
        context,
      );
      if (
        !playlistId ||
        !Array.isArray(owned.data) ||
        !owned.data.some((v) => text(object(v).diss_id) === playlistId)
      )
        throw new AppError(403, '该歌单不在当前授权账户的目录中');
    }
    data = await qq.call(
      'fcg_music_custom_get_songlist_detail.fcg',
      {
        dissid: kind === 'likes' ? '0' : playlistId!,
        page: offset,
        page_size: 30,
      },
      context,
    );
    items = tracks(songList(data));
    title = kind === 'likes' ? '我喜欢' : text(data.diss_title);
    total = data.total_num === undefined ? undefined : number(data.total_num);
    hasMore = number(data.has_more) === 1 && items.length > 0;
    nextOffset = offset + 1;
  } else if (kind === 'recent') {
    data = await qq.call(
      'fcg_music_custom_get_play_recently.fcg',
      { type: 2, updateTime: 0, offset },
      context,
    );
    if (Array.isArray(data.song_list)) {
      const rows = new Map(
        data.song_list.map((v: unknown) => [
          `qq:${text(object(v).song_mid)}`,
          object(v),
        ]),
      );
      items = tracks(data.song_list).map((item) => {
        const raw = rows.get(item.id) || {};
        return {
          ...item,
          lastPlayedAt: number(raw.lastTime) || undefined,
          listenCount:
            raw.listenCount === undefined ? undefined : number(raw.listenCount),
        };
      });
      total = number(data.total_num);
      hasMore = number(data.has_more) === 1 && items.length > 0;
      nextOffset = number(data.next_offset);
    } else {
      const recent = object(data.data).song;
      items = (Array.isArray(recent) ? recent : []).map((v) => {
        const r = object(v),
          mid = text(r.mid);
        return {
          id: `qq:${mid}`,
          songId: mid ? `qq:${mid}` : undefined,
          title: text(r.title),
          subtitle: [
            Array.isArray(r.singer) ? r.singer.map(text).join(' / ') : '',
            text(r.albumTitle),
          ]
            .filter(Boolean)
            .join(' · '),
          lastPlayedAt: number(r.lastTime) || undefined,
          listenCount: number(r.listenCount) || undefined,
        };
      });
      total = items.length;
    }
    title = '最近播放';
    notice =
      text(data.notice) ||
      '播放次数与最近时间按 QQ 音乐返回的原值展示，不代表完整历史。';
  } else if (kind === 'albums') {
    data = await qq.call(
      'fcg_get_fav_album_list.fcg',
      { offset, limit: 20, type: 0 },
      context,
    );
    items = (Array.isArray(data.albums) ? data.albums : []).map((v) => {
      const r = object(v),
        singers = Array.isArray(r.singers)
          ? r.singers.map((v) => text(object(v).name)).join(' / ')
          : '';
      return {
        id: text(r.mid || r.albumId),
        title: text(r.name),
        subtitle: [singers, text(r.releaseTime)].filter(Boolean).join(' · '),
        count: number(r.trackNums),
        cover: coverUrl(r.cover300x300 || r.cover),
      };
    });
    title = '收藏专辑';
    total = number(data.total);
    hasMore = Boolean(data.hasMore) && items.length > 0;
    nextOffset = offset + items.length;
    notice = text(data.notice) || undefined;
  } else if (kind === 'follows') {
    data = await qq.call(
      'fcg_music_custom_get_fav_singerlist.fcg',
      { start_index: offset, page_size: 20 },
      context,
    );
    items = (Array.isArray(data.singer_list) ? data.singer_list : []).map(
      (v) => {
        const r = object(v);
        return {
          id: text(r.singer_mid || r.singer_id),
          title: text(r.singer_name),
          subtitle: '已关注',
          cover: coverUrl(r.singer_pic_300x300 || r.singer_pic),
        };
      },
    );
    title = '关注歌手';
    total = number(data.total);
    hasMore = number(data.hasMore) === 1 && items.length > 0;
    nextOffset = offset + items.length;
  } else {
    data = await qq.call(
      'fcg_music_custom_rc_songs.fcg',
      { scene: 1, page: offset },
      context,
    );
    items = tracks(songList(data));
    title = '每日推荐';
    total =
      data.total_num === undefined ? items.length : number(data.total_num);
    hasMore = number(data.has_more) === 1 && items.length > 0;
    nextOffset = offset + 1;
    notice = text(data.notice) || undefined;
  }
  return {
    kind,
    title,
    items,
    total,
    hasMore,
    nextOffset,
    ...(notice ? { notice } : {}),
  };
}
