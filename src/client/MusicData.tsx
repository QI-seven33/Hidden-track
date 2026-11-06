import { useEffect, useState } from "react";
import { api } from "./api";
import { errorText } from "./utils";
import { AudioPlayer } from "./GameBoard";
import { FullLyrics } from "./FullLyrics";
import type {
  MusicFact,
  MusicInspection,
  SongSummary,
  OfficialSongAssociations,
} from "../shared/protocol";

function Facts({ items }: { items: MusicFact[] }) {
  return (
    <dl className="music-facts">
      {items.map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          className={item.value === "暂未提供" ? "fact-missing" : undefined}
        >
          <dt>
            {item.label}
            {item.note && <small>{item.note}</small>}
          </dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
function Prose({ text }: { text?: string }) {
  return text ? (
    <div className="music-prose">
      {text
        .split(/\n+/)
        .filter(Boolean)
        .map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
    </div>
  ) : (
    <p className="muted">本次暂未取得介绍。</p>
  );
}
const clock = (seconds: number) => {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
};

function OfficialScenes({ songId }: { songId: string }) {
  const [result, setResult] = useState<OfficialSongAssociations>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    try {
      setResult(
        await api<OfficialSongAssociations>(
          `/music/official-associations?id=${encodeURIComponent(songId)}`,
        ),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }
  const groups = [...new Set(result?.matches.map((m) => m.group) || [])];
  return (
    <section
      id="music-official-scenes"
      className="music-section"
      aria-busy={loading}
    >
      <header className="music-section-heading">
        <h2>官方心情与场景</h2>
        <span className="badge">比赛 OpenAPI</span>
      </header>
      <p className="muted">
        查看这个录音被收录在哪些官方运营分类中。分类可以重叠，会随运营更新。
      </p>
      <button disabled={loading} onClick={() => void load()}>
        {loading
          ? "正在读取官方分类…"
          : result
            ? "重新读取"
            : "读取官方心情与场景"}
      </button>
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          {result.matches.length > 0 && (
            <Facts
              items={groups.map((group) => ({
                label: group,
                value: result.matches
                  .filter((m) => m.group === group)
                  .map((m) => m.label)
                  .join("、"),
                note: "来源：比赛 OpenAPI 运营分类；已核对录音 ID / MID",
              }))}
            />
          )}
          {result.status === "unavailable" ? (
            <p className="muted">本次暂未读到官方运营列表，可以稍后重试。</p>
          ) : (
            <>
              {!result.matches.length && (
                <p className="muted">
                  本次读取的官方列表中没有找到这个录音，不代表它没有相关心情或场景。
                </p>
              )}
              <p className="muted">
                已读取 {result.scannedLists} / {result.totalLists} 类列表，共{" "}
                {result.recordingCount} 个去重录音；每类最多{" "}
                {result.matchesPerListLimit} 首。
                {result.status === "partial"
                  ? "部分列表未取得，以上仅为已查到的关系。"
                  : ""}{" "}
                未收录不能作为排除依据。
              </p>
              <small className="muted">
                采集于 {new Date(result.checkedAt).toLocaleString("zh-CN")}
                ；服务端最多缓存30分钟。
              </small>
            </>
          )}
        </>
      )}
      <p>
        <a
          href="https://y.qq.com/music_developer/#/docs/openapi#/feature/playlist"
          target="_blank"
          rel="noreferrer"
        >
          官方运营分类来源说明 ↗
        </a>
      </p>
    </section>
  );
}

export function MusicData() {
  const [query, setQuery] = useState("晴天");
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [data, setData] = useState<MusicInspection>();
  const [showResults, setShowResults] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function search() {
    setBusy(true);
    setError("");
    setShowResults(true);
    try {
      setSongs(
        (
          await api<{ songs: SongSummary[] }>(
            `/music/search?mode=qq&q=${encodeURIComponent(query)}`,
          )
        ).songs,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function inspect(song: Pick<SongSummary, "id">) {
    setBusy(true);
    setError("");
    setData(undefined);
    setShowResults(false);
    try {
      const loaded = await api<MusicInspection>(
        `/music/inspect?id=${encodeURIComponent(song.id)}`,
      );
      setData(loaded);
      setQuery(loaded.song.title);
      history.replaceState(
        null,
        "",
        `/music?song=${encodeURIComponent(song.id)}`,
      );
    } catch (e) {
      setError(errorText(e));
      setShowResults(true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const initial = new URLSearchParams(location.search).get("song");
    if (initial && /^qq:[A-Za-z0-9_-]{1,64}$/.test(initial))
      void inspect({ id: initial });
  }, []);
  function Related({
    title,
    id,
    items,
  }: {
    title: string;
    id: string;
    items: SongSummary[];
  }) {
    return (
      <section id={id} className="music-section">
        <header className="music-section-heading">
          <h2>{title}</h2>
          <span>{items.length} 首</span>
        </header>
        {items.length ? (
          <div className="music-related">
            {items.map((song) => (
              <button
                key={song.id}
                disabled={busy}
                onClick={() => void inspect(song)}
                className="music-song-tile"
              >
                {song.cover ? (
                  <img src={song.cover} alt="" loading="lazy" />
                ) : (
                  <span className="music-cover-placeholder" aria-hidden="true">
                    ♫
                  </span>
                )}
                <span>
                  <strong>{song.title}</strong>
                  <small>{song.artists.join(" / ") || "歌手暂未提供"}</small>
                  <small>{song.album || "专辑暂未提供"}</small>
                </span>
                <span className="music-open" aria-hidden="true">
                  ↗
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">本次没有返回{title}。</p>
        )}
      </section>
    );
  }
  const profile = data?.profile;
  return (
    <div className="music-data music-reader">
      <header className="data-heading">
        <span className="eyebrow">来自 QQ 音乐</span>
        <h1>歌曲资料</h1>
        <p>搜索歌曲，直接阅读专辑、歌手与音乐资料。</p>
      </header>
      <form
        className="search music-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          aria-label="搜索歌曲或歌手"
          placeholder="输入歌名或歌手"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="primary" disabled={busy || !query.trim()}>
          {busy ? "读取中…" : "搜索"}
        </button>
        {data && songs.length > 0 && (
          <button type="button" onClick={() => setShowResults((v) => !v)}>
            {showResults ? "收起结果" : "换一首"}
          </button>
        )}
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="music-loading">
          正在读取音乐资料，请稍候…
        </p>
      )}
      {showResults && songs.length > 0 && (
        <section className="music-search-results" aria-label="搜索结果">
          <h2>选择一首歌</h2>
          <div className="data-results">
            {songs.map((song) => (
              <button
                key={song.id}
                disabled={busy}
                onClick={() => void inspect(song)}
                aria-pressed={data?.song.id === song.id}
              >
                <strong>{song.title}</strong>
                <small>
                  {song.artists.join(" / ")} · {song.album}
                </small>
              </button>
            ))}
          </div>
        </section>
      )}
      {!data && !busy && (
        <p className="muted">选择一个具体版本，查看它的真实资料。</p>
      )}
      {data && profile && (
        <>
          <section className="music-hero">
            <div className="music-art">
              {data.song.cover ? (
                <img src={data.song.cover} alt={`${data.song.album}专辑封面`} />
              ) : (
                <span aria-hidden="true">♫</span>
              )}
            </div>
            <div className="music-hero-copy">
              <span className="eyebrow">
                {profile.facts.find((f) => f.label === "内容类型")?.value ||
                  "歌曲"}
              </span>
              <h2>{data.song.title}</h2>
              <p className="music-artists">{data.song.artists.join(" / ")}</p>
              <p>收录于《{data.song.album || "专辑暂未提供"}》</p>
              <div className="music-hero-meta">
                {profile.facts
                  .filter((f) => ["发行日期", "歌曲时长"].includes(f.label))
                  .map((f) => (
                    <span key={f.label}>
                      {f.label} · {f.value}
                    </span>
                  ))}
              </div>
              <small className="muted">
                {data.identity === "authorized"
                  ? "已使用你的 QQ 音乐授权"
                  : "当前为未登录查询"}{" "}
                · {new Date(data.checkedAt).toLocaleString("zh-CN")}
              </small>
            </div>
          </section>
          <nav className="music-jump" aria-label="资料目录">
            {[
              ["song", "歌曲信息"],
              ["album", "专辑介绍"],
              ["singer", "歌手百科"],
              ["official-scenes", "官方心情与场景"],
              ["listening", "收听与副歌"],
              ["lyrics", "完整歌词"],
              ["versions", "其他版本"],
              ["similar", "相似歌曲"],
            ].map(([id, label]) => (
              <a key={id} href={`#music-${id}`}>
                {label}
              </a>
            ))}
          </nav>
          <section id="music-song" className="music-section">
            <header className="music-section-heading">
              <h2>歌曲信息</h2>
            </header>
            <Facts items={profile.facts} />
            {profile.metadataNotice && (
              <p className="muted">{profile.metadataNotice}</p>
            )}
            {profile.description && <Prose text={profile.description} />}
            {profile.referenceLinks?.map((link) => (
              <p key={link.url}>
                <a href={link.url} target="_blank" rel="noreferrer">
                  {link.title} ↗
                </a>
              </p>
            ))}
            {profile.albumSongNote && (
              <div className="music-album-note">
                <h3>专辑里这样介绍《{data.song.title}》</h3>
                <Prose text={profile.albumSongNote} />
                <small>来自《{data.song.album}》专辑介绍</small>
              </div>
            )}
            <p className="music-missing">
              本次暂缺：
              {profile.missing.length ? profile.missing.join("、") : "无"}。
            </p>
            {(profile.missing.includes("单曲语言") ||
              profile.missing.includes("单曲流派")) && (
              <p className="muted">
                {profile.missing
                  .filter((item) => ["单曲语言", "单曲流派"].includes(item))
                  .join("、")}
                本次暂未取得，可稍后重试。专辑标签在下方单独展示，不代替单曲属性。
              </p>
            )}
          </section>
          <section id="music-album" className="music-section">
            <header className="music-section-heading">
              <div>
                <span className="eyebrow">专辑</span>
                <h2>{profile.album.title || "专辑资料"}</h2>
              </div>
            </header>
            <Facts items={profile.album.facts} />
            <Prose text={profile.album.description} />
          </section>
          <section id="music-singer" className="music-section">
            <header className="music-section-heading music-singer-heading">
              {profile.singer.portrait && (
                <img
                  src={profile.singer.portrait}
                  alt={`${profile.singer.name}歌手照片`}
                  loading="lazy"
                />
              )}
              <div>
                <span className="eyebrow">歌手百科</span>
                <h2>{profile.singer.name}</h2>
              </div>
            </header>
            <p className="muted">
              来源：比赛 OpenAPI 歌手百科。荣誉记录为平台介绍文本，可能不完整。
            </p>
            <Prose text={profile.singer.biography} />
            <Facts items={profile.singer.facts} />
            {profile.singer.chapters.map((chapter, index) => (
              <details key={index} className="music-chapter">
                <summary>{chapter.title}</summary>
                <Prose text={chapter.body} />
              </details>
            ))}
          </section>
          <OfficialScenes
            key={`official-scenes:${data.song.id}`}
            songId={data.song.id}
          />
          <section id="music-listening" className="music-section">
            <header className="music-section-heading">
              <h2>收听与副歌</h2>
              <span className="badge">
                {profile.listening.delivery === "full"
                  ? "完整音频可播放"
                  : profile.listening.delivery === "preview"
                    ? "可听官方试听"
                    : "本站暂不可播放"}
              </span>
            </header>
            <p className="music-listening-note">
              {profile.listening.explanation}
            </p>
            <AudioPlayer key={data.song.id} song={data.song} />
            <div className="music-audio-resources">
              {profile.listening.resources.map((item) => (
                <div key={item.label}>
                  <strong>{item.label}</strong>
                  <span>
                    {item.kind === "full" ? "完整歌曲" : "试听片段"} ·{" "}
                    {item.format}
                    {item.size ? ` · ${item.size}` : ""}
                  </span>
                </div>
              ))}
            </div>
            {profile.chorus ? (
              <div className="music-chorus">
                <span>平台定位的副歌</span>
                <strong>
                  约 {clock(profile.chorus.begin)} — {clock(profile.chorus.end)}
                </strong>
                <small>按平台数值换算，尚未与完整音频校准。</small>
              </div>
            ) : (
              <p className="muted">本次暂未取得副歌位置。</p>
            )}
            <details className="music-chapter">
              <summary>比赛接口的歌词资源状态</summary>
              <ul className="music-lyrics-status">
                {profile.lyrics.map((item) => (
                  <li key={item.label}>
                    <span>{item.label}</span>
                    <strong className={item.available ? "" : "muted"}>
                      {item.available
                        ? `已返回 · ${item.characters} 字符`
                        : "暂未提供"}
                    </strong>
                  </li>
                ))}
              </ul>
            </details>
          </section>
          <FullLyrics key={data.song.id} songId={data.song.id} />
          <Related
            title="其他版本"
            id="music-versions"
            items={profile.versions}
          />
          <Related
            title="相似歌曲"
            id="music-similar"
            items={profile.similar}
          />
          {profile.notices.length > 0 && (
            <p className="music-missing">{profile.notices.join(" ")}</p>
          )}
        </>
      )}
    </div>
  );
}
