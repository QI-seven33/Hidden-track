import { AppError } from '../errors';

type Row = Record<string, any>;
type Execute = (module: string, method: string, param: Row) => Promise<Row>;
type Track = (raw: Row) => Row;
const object = (value: unknown): Row =>
  value && typeof value === 'object' ? (value as Row) : {};
const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const dataError = () =>
  new AppError(502, 'QQ 音乐资料本次未完整返回，请稍后重试', 'QQ_LIBRARY_DATA');
function array(value: unknown): Row[] {
  if (!Array.isArray(value)) throw dataError();
  return value;
}
function checked(data: Row): Row {
  if ([data.code, data.retcode].some((n) => n !== undefined && Number(n) !== 0))
    throw dataError();
  return data;
}
function number(value: unknown): number | undefined {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) && n >= 0 ? n : undefined;
}
function playlistPage(data: Row, begin: number, track: Track): Row {
  checked(data);
  const rows = array(data.songlist),
    info = object(data.dirinfo);
  const total = number(data.total_song_num) ?? number(info.songnum);
  return {
    ret: 0,
    song_list: rows.map((s) => track(object(s.track || s))),
    diss_title: info.title,
    total_num: total,
    has_more: Number(
      rows.length > 0 &&
        (total !== undefined
          ? begin + rows.length < total
          : Boolean(data.hasmore)),
    ),
  };
}
function shanghaiDay(ms: number): string {
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
}

/** Read-only adapters for the signed-in QQ account. No arbitrary user or playlist proxy. */
export async function embeddedLibrary(
  command: string,
  p: Record<string, string | number>,
  credential: Row,
  execute: Execute,
  track: Track,
): Promise<Row | undefined> {
  const commands = [
    'fcg_music_custom_get_songlist_self.fcg',
    'fcg_music_custom_get_songlist_detail.fcg',
    'fcg_music_custom_get_play_recently.fcg',
    'fcg_get_fav_album_list.fcg',
    'fcg_music_custom_get_fav_singerlist.fcg',
    'fcg_music_custom_rc_songs.fcg',
  ];
  if (!commands.includes(command)) return;
  if (!credential.musicid || !credential.musickey)
    throw new AppError(401, '请先扫码授权 QQ 音乐', 'QQ_LOGIN_REQUIRED');
  const uin = text(credential.musicid),
    euin = text(credential.encryptUin);
  const encryptedIdentity = () => {
    if (!euin) throw dataError();
    return euin;
  };
  switch (command) {
    case 'fcg_music_custom_get_songlist_self.fcg': {
      const data = checked(
        await execute('music.musicasset.PlaylistBaseRead', 'GetPlaylistByUin', {
          uin,
        }),
      );
      return {
        ret: 0,
        data: array(data.v_playlist)
          .filter((s) => !s.invalid)
          .map((s) => ({
            diss_id: text(s.tid),
            diss_name: text(s.dirName),
            diss_pic: s.picUrl || s.albumPicUrl || s.bigpicUrl,
            song_num: number(s.songNum),
            listen_num: number(s.play_cnt),
          })),
      };
    }
    case 'fcg_music_custom_get_songlist_detail.fcg': {
      const likes = p.dissid === '0',
        begin = Number(p.page || 0) * 30;
      const data = await execute('music.srfDissInfo.DissInfo', 'CgiGetDiss', {
        disstid: likes ? 0 : Number(p.dissid),
        dirid: likes ? 201 : 0,
        tag: true,
        song_begin: begin,
        song_num: 30,
        userinfo: true,
        orderlist: true,
        onlysonglist: false,
        ...(likes ? { enc_host_uin: encryptedIdentity() } : {}),
      });
      return playlistPage(data, begin, track);
    }
    case 'fcg_music_custom_get_play_recently.fcg': {
      const data = checked(
        await execute(
          'music.musicasset.PlayRecentlyRead',
          'GetPlayRecentlyInfo',
          { requestCnt: 2500, type: 2, updateTime: 0, lastTime: 0 },
        ),
      );
      const seen = new Set<string>();
      const rows = array(object(data.data).songList).flatMap((entry) => {
        const song = track(object(entry.track)),
          mid = text(song.song_mid);
        if (!mid || seen.has(mid)) return [];
        seen.add(mid);
        return [
          {
            ...song,
            lastTime: number(entry.lastTime),
            listenCount: number(entry.listenCnt),
          },
        ];
      });
      const offset = Number(p.offset || 0),
        limit = 50;
      return {
        ret: 0,
        song_list: rows.slice(offset, offset + limit),
        total_num: rows.length,
        has_more: Number(offset + limit < rows.length),
        next_offset:
          offset + Math.min(limit, Math.max(0, rows.length - offset)),
        notice:
          '显示 QQ 音乐返回的最近歌曲（最多 2500 条），不代表完整历史；播放次数与时间按平台原值展示。',
      };
    }
    case 'fcg_get_fav_album_list.fcg': {
      const offset = Number(p.offset || 0);
      const data = checked(
        await execute('music.musicasset.AlbumFavRead', 'CgiGetAlbumFavInfo', {
          euin: encryptedIdentity(),
          offset,
          size: 20,
        }),
      );
      const rows = array(data.v_list);
      return {
        ret: 0,
        albums: rows.map((a) => ({
          mid: text(a.mid),
          albumId: text(a.id),
          name: text(a.name),
          singers: Array.isArray(a.v_singer) ? a.v_singer : [],
          releaseTime: number(a.pubtime)
            ? new Date(Number(a.pubtime) * 1000).toISOString().slice(0, 10)
            : '',
          trackNums: number(a.songnum),
          cover: a.logo,
        })),
        total: number(data.total),
        hasMore: Boolean(data.hasmore) && rows.length > 0,
        ...(data.hide ? { notice: 'QQ 音乐当前隐藏了这项收藏资料。' } : {}),
      };
    }
    case 'fcg_music_custom_get_fav_singerlist.fcg': {
      const offset = Number(p.start_index || 0);
      const data = checked(
        await execute('music.concern.RelationList', 'GetFollowSingerList', {
          HostUin: encryptedIdentity(),
          From: offset,
          Size: 20,
        }),
      );
      if (data.LockFlag) throw dataError();
      const rows = array(data.List);
      return {
        ret: 0,
        singer_list: rows.map((s) => ({
          singer_mid: text(s.MID),
          singer_id: text(object(s.OtherInfo).SingerID),
          singer_name: text(s.Name),
          singer_pic: s.AvatarUrl,
        })),
        total: number(data.Total),
        hasMore: Number(Boolean(data.HasMore) && rows.length > 0),
      };
    }
    case 'fcg_music_custom_rc_songs.fcg': {
      const day = shanghaiDay(Date.now());
      const data = checked(
        await execute('music.recommend.RecommendFeed', 'get_recommend_feed', {
          direction: 0,
          page: 1,
          v_cache: [],
          v_uniq: [],
          s_num: 0,
        }),
      );
      const cards = array(data.v_shelf)
        .flatMap((s) => array(s.v_niche).flatMap((n) => array(n.v_card)))
        .filter((c) => Number(c.subtype) === 510);
      const card = cards[0],
        timestamp = Number(card?.time) * 1000;
      if (
        cards.length !== 1 ||
        !card ||
        !/^[1-9]\d*$/.test(text(card.id)) ||
        !Number.isFinite(timestamp) ||
        shanghaiDay(timestamp) !== day
      )
        throw new AppError(
          502,
          'QQ 音乐本次未返回当天的每日推荐，请稍后重试',
          'QQ_DAILY_UNAVAILABLE',
        );
      const begin = Number(p.page || 0) * 30;
      const songs = playlistPage(
        await execute('music.srfDissInfo.DissInfo', 'CgiGetDiss', {
          disstid: Number(card.id),
          dirid: 0,
          tag: true,
          song_begin: begin,
          song_num: 30,
          userinfo: true,
          orderlist: true,
          onlysonglist: false,
        }),
        begin,
        track,
      );
      if (shanghaiDay(Date.now()) !== day)
        throw new AppError(
          502,
          '每日推荐已跨日，请重新读取',
          'QQ_DAILY_UNAVAILABLE',
        );
      return { ...songs, notice: '来自当前 QQ 账号当天的每日推荐。' };
    }
  }
}
