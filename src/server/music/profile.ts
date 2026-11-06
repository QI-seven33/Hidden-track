import type {
  MusicFact,
  MusicProfile,
  SongSummary,
} from "../../shared/protocol";
import {
  coverUrl,
  number,
  object,
  text,
  webPlaybackResource,
  type QQData,
} from "./qq";
import { extractCredits } from "./credits";

// Public copy is rendered as text. Upstream HTML/XML is never executed in the UI.
export function readableText(value: unknown): string {
  return text(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, v: string) => {
      const code =
        v.startsWith("x") || v.startsWith("X")
          ? parseInt(v.slice(1), 16)
          : Number(v);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(
      /&(nbsp|amp|lt|gt|quot|apos);/g,
      (_, key: string) =>
        ({ nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[
          key
        ] || "",
    )
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
const duration = (seconds: unknown) => {
  const n = number(seconds);
  return n > 0 ? `${Math.floor(n / 60)} 分 ${Math.round(n % 60)} 秒` : "";
};
const size = (value: unknown) =>
  number(value) > 0
    ? `${(number(value) / 1024 / 1024).toFixed(1)} MB`
    : undefined;
const facts = (entries: [string, unknown, string?][]): MusicFact[] =>
  entries.map(([label, value, note]) => ({
    label,
    value: readableText(value) || "暂未提供",
    ...(note ? { note } : {}),
  }));
function related(values: unknown): SongSummary[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => {
      const row = object(value),
        album = object(row.album),
        mid = text(row.song_mid || row.mid),
        id = text(row.song_id || row.id);
      const singers = Array.isArray(row.singer_list)
        ? row.singer_list
        : Array.isArray(row.singer)
          ? row.singer
          : [];
      const artists = [
        ...new Set(
          [
            text(row.singer_name),
            ...singers.map((v) =>
              text(object(v).name || object(v).singer_name),
            ),
            ...(Array.isArray(row.other_singer_list)
              ? row.other_singer_list.map((v) =>
                  text(object(v).name || object(v).singer_name),
                )
              : []),
          ].filter(Boolean),
        ),
      ];
      return {
        id: `qq:${mid || id}`,
        provider: "qq" as const,
        providerMid: mid || undefined,
        title: readableText(
          row.song_name || row.name || row.song_title || row.title,
        ),
        artists,
        album: readableText(row.album_name || album.name),
        albumMid: text(row.album_mid || album.mid) || undefined,
        cover: coverUrl(row.album_pic_300x300 || row.album_pic || album.pic),
      };
    })
    .filter((row) => row.id !== "qq:" && Boolean(row.title))
    .filter(
      (row, index, rows) =>
        rows.findIndex((other) => other.id === row.id) === index,
    );
}
export function musicProfile(
  song: SongSummary,
  sources: Record<string, QQData>,
  authorized: boolean,
): MusicProfile {
  const track = sources.song || {},
    search = sources.search || {},
    album = sources.album || {},
    singer = sources.singer || {};
  const credits = extractCredits(sources.lyric || {}, track.song_id);
  const web = sources.web || {};
  const listText = (value: unknown) =>
    Array.isArray(value)
      ? value.map(readableText).filter(Boolean).join("、")
      : "";
  const language = text(track.language) || listText(web.languages),
    genre = text(track.genre) || listText(web.genres);
  const bpm = number(track.bpm) > 0 ? number(track.bpm) : number(web.bpm);
  const description =
    readableText(search.song_desc) || readableText(web.description);
  const webUsed =
    (!text(track.language) && Boolean(language)) ||
    (!text(track.genre) && Boolean(genre)) ||
    (number(track.bpm) <= 0 && bpm > 0) ||
    (!readableText(search.song_desc) &&
      Boolean(readableText(web.description))) ||
    Boolean(text(web.company) || text(web.wikiUrl)) ||
    (Array.isArray(web.extraFacts) && web.extraFacts.length > 0);
  const webNote = "来源：QQ 音乐公开网页资料（实验）";
  const byRole = (role: string) =>
    credits.filter((c) => c.role === role).flatMap((c) => c.names);
  const lyricists = byRole("作词"),
    composers = byRole("作曲");
  const composerText = text(search.author) || composers.join("、");
  const sourceOK = (key: string) =>
    sources[key] && number(sources[key]?.ret) === 0;
  const xml = text(singer.wikiInfo),
    basic = xml.match(/<basic>([\s\S]*?)<\/basic>/)?.[1] || "",
    other = xml.match(/<other>([\s\S]*?)<\/other>/)?.[1] || "";
  const entries = (part: string) =>
    [
      ...part.matchAll(
        /<item>\s*<key>([\s\S]*?)<\/key>\s*<value>([\s\S]*?)<\/value>\s*<\/item>/g,
      ),
    ]
      .map((m) => ({ label: readableText(m[1]), value: readableText(m[2]) }))
      .filter((v) => v.label && v.value);
  const type =
    track.song_version === undefined
      ? ""
      : { "0": "完整歌曲", "7": "长音频", "29": "播客" }[
          text(track.song_version)
        ] || "其他音频";
  const singerType =
    singer.type === undefined
      ? ""
      : [
          "男歌手",
          "女歌手",
          "组合",
          "其他",
          "影视",
          "虚拟歌手",
          "综艺",
          "团体",
          "AI歌手",
        ][number(singer.type)] || "其他";
  const singerIdentity =
    singer.identity === undefined
      ? ""
      : {
          "0": "演唱",
          "1": "作曲家",
          "2": "演奏家",
          "3": "指挥家",
          "4": "其他",
        }[text(singer.identity)] || "未知";
  const albumParagraphs = readableText(album.album_desc)
    .split(/\n+/)
    .filter(Boolean);
  const songParagraph = albumParagraphs.findIndex(
    (p) => p.trim() === song.title,
  );
  const albumSongNote =
    songParagraph >= 0 &&
    albumParagraphs[songParagraph + 1] &&
    albumParagraphs[songParagraph + 1]!.length > 20
      ? albumParagraphs[songParagraph + 1]
      : undefined;
  const resourceNames: [string, string, string, "full" | "preview"][] = [
    ["song_play_url", "song_size", "流畅音质", "full"],
    ["song_play_url_standard", "song_size_standard", "标准音质", "full"],
    ["song_play_url_hq", "song_size_hq", "高品质", "full"],
    ["song_play_url_sq", "song_size_sq", "无损音质", "full"],
    ["song_play_url_dolby", "song_size_dolby", "杜比音质", "full"],
    ["song_play_url_xq", "song_size_xq", "Hi-Res", "full"],
    ["song_play_url_pq", "song_size_pq", "全景声", "full"],
    ["song_play_url_accom", "song_size_accom", "伴唱", "full"],
    ["try_30s_url", "try_file_size", "官方试听", "preview"],
  ];
  const resources = resourceNames.flatMap(([key, sizeKey, label, kind]) => {
    const url = coverUrl(track[key]);
    return url
      ? [
          {
            label,
            kind,
            format:
              new URL(url).pathname
                .match(/\.([a-z0-9]+)$/i)?.[1]
                ?.toUpperCase() || "平台资源",
            size: size(track[sizeKey]),
          },
        ]
      : [];
  });
  const resource = webPlaybackResource(track),
    fullAllowed = number(track.playable) === 1;
  const noText =
    readableText(track.unplayable_msg) || "当前身份未取得完整收听权限。";
  const explanation = resource?.preview
    ? fullAllowed
      ? "账号已具备完整收听权益，完整资源也已返回。本站目前可播放官方试听；完整播放等待接入官方支持的方案。"
      : "当前可播放平台提供的试听片段。完整收听权限：" + noText
    : resource
      ? "当前可使用平台提供的完整音频。"
      : fullAllowed
        ? "账号已具备完整收听权益，完整资源也已返回。本站暂不能播放该专用格式，等待接入官方支持的方案。"
        : noText + (authorized ? "" : " 登录后可以重新查询你的收听权益。");
  const begin = number(track.excited_begin),
    end = number(track.excited_end);
  const mir = object(object(sources.chorus?.data)[text(track.song_id)]);
  const useTrackPoint = begin >= 0 && end > begin;
  const a = useTrackPoint ? begin : number(mir.touchpointStart),
    b = useTrackPoint ? end : number(mir.touchpointEnd);
  const validPoint =
    a >= 0 &&
    b > a &&
    (number(track.song_play_time) <= 0 ||
      b <= number(track.song_play_time) * 1000);
  const missing = [
    ...(!language ? ["单曲语言"] : []),
    ...(!genre ? ["单曲流派"] : []),
    ...(!composerText ? ["作曲署名"] : []),
    ...(!lyricists.length ? ["作词署名"] : []),
    ...(!description ? ["独立歌曲介绍"] : []),
    ...(bpm <= 0 ? ["可靠的 BPM"] : []),
  ];
  const lyricFields = [
    ["song_lyric", "普通歌词"],
    ["song_translate_lyric", "翻译歌词"],
    ["song_rome_enc_lyric", "罗马音歌词"],
    ["song_qrc_no_enc_lyric", "逐字歌词"],
    ["song_qrc_enc_lyric", "编码逐字歌词"],
  ] as const;
  return {
    facts: facts([
      ["发行日期", track.public_time, "当前选定版本"],
      ["歌曲时长", duration(track.song_play_time)],
      ["内容类型", type],
      [
        "单曲语言",
        language,
        text(track.language)
          ? "来源：比赛 OpenAPI"
          : language
            ? webNote
            : undefined,
      ],
      [
        "单曲流派",
        genre,
        text(track.genre) ? "来源：比赛 OpenAPI" : genre ? webNote : undefined,
      ],
      [
        "节拍速度",
        bpm > 0 ? `${bpm} BPM` : "",
        number(track.bpm) > 0
          ? "来源：比赛 OpenAPI；尚未人工校准"
          : bpm > 0
            ? `${webNote}；平台标注，尚未人工校准`
            : "平台返回 0 时按未知处理",
      ],
      [
        "作词",
        lyricists.join("、"),
        lyricists.length ? "来源：QQ 音乐歌词署名" : undefined,
      ],
      [
        "作曲",
        composerText,
        text(search.author)
          ? "来源：QQ 音乐搜索资料"
          : composers.length
            ? "来源：QQ 音乐歌词署名"
            : undefined,
      ],
      ...credits
        .filter((c) => !["作词", "作曲"].includes(c.role))
        .map(
          (c) =>
            [c.role, c.names.join("、"), "来源：QQ 音乐歌词署名"] as [
              string,
              string,
              string,
            ],
        ),
      ...(text(search.author) &&
      composers.length &&
      text(search.author) !== composers.join("、")
        ? [
            [
              "作曲（歌词署名）",
              composers.join("、"),
              "与搜索资料分开保留",
            ] as [string, string, string],
          ]
        : []),
      [
        "原唱信息",
        number(search.origin) === 1 ? "平台标记为原唱" : "尚不能确认",
      ],
      [
        "关联 MV",
        number(track.mv_id) > 0 || text(track.mv_vid)
          ? "已返回关联 MV"
          : "暂未提供",
      ],
      ...(text(web.company)
        ? [["单曲唱片公司", web.company, webNote] as [string, unknown, string]]
        : []),
      ...(Array.isArray(web.extraFacts)
        ? web.extraFacts.map((v) => {
            const row = object(v);
            return [text(row.label), row.value, webNote] as [
              string,
              unknown,
              string,
            ];
          })
        : []),
    ]),
    description: description || undefined,
    metadataNotice: webUsed
      ? "已从 QQ 音乐公开网页资料补充字段，与比赛 OpenAPI 分开标注；网页接口可用性及比赛接入授权尚待确认。"
      : undefined,
    referenceLinks: text(web.wikiUrl)
      ? [{ title: "QQ 音乐官方歌曲百科", url: text(web.wikiUrl) }]
      : [],
    albumSongNote,
    missing,
    album: {
      title: readableText(album.album_name) || song.album,
      cover: coverUrl(album.album_pic_300x300 || album.album_pic) || song.cover,
      facts: facts([
        ["发行日期", album.public_time],
        ["唱片公司", album.company_name],
        ["专辑语言", album.str_language],
        ["专辑流派", album.str_genre],
        ["专辑类型", album.str_type],
        [
          "收录曲目",
          number(album.total_num) > 0 ? `${number(album.total_num)} 首` : "",
        ],
        ["译名", album.album_trans_name],
      ]),
      description: readableText(album.album_desc) || undefined,
    },
    singer: {
      name: readableText(singer.singer_name) || song.artists[0] || "歌手",
      portrait: coverUrl(singer.singer_pic),
      facts: [
        ...facts([
          ["地区", singer.area],
          ["类型", singerType],
          [
            "平台身份",
            singerIdentity,
            "来源：比赛 OpenAPI；歌手分类不代表逐首作品的创作署名",
          ],
          [
            "曲库作品数",
            number(singer.song_sum) > 0 ? `${number(singer.song_sum)} 首` : "",
            "来源：比赛 OpenAPI；本次返回数量",
          ],
          ["译名", singer.singer_translator_name],
        ]),
        ...entries(basic),
      ],
      biography:
        readableText(xml.match(/<desc>([\s\S]*?)<\/desc>/)?.[1]) || undefined,
      chapters: entries(other).map((v) => ({ title: v.label, body: v.value })),
    },
    listening: {
      fullAllowed,
      delivery: resource
        ? resource.preview
          ? "preview"
          : "full"
        : "unavailable",
      explanation,
      resources,
    },
    ...(validPoint ? { chorus: { begin: a / 1000, end: b / 1000 } } : {}),
    lyrics: lyricFields.map(([key, label]) => {
      const value = sources.lyric?.[key],
        count =
          typeof value === "string"
            ? value.length
            : number(object(value).characters);
      return { label, available: count > 0, characters: count };
    }),
    versions: sourceOK("versions") ? related(sources.versions?.song_list) : [],
    similar: sourceOK("similar") ? related(sources.similar?.songlist) : [],
    notices: Object.entries({
      album: "专辑资料",
      singer: "歌手资料",
      lyric: "歌词资料",
      chorus: "副歌定位",
      versions: "其他版本",
      similar: "相似歌曲",
    }).flatMap(([key, label]) =>
      sourceOK(key) ? [] : [`${label}本次暂未读到，可以稍后重试。`],
    ),
  };
}
