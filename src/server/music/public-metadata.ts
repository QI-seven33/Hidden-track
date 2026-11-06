export interface PublicMetadata {
  observedAt: string;
  mid: string;
  id: string;
  languages: string[];
  genres: string[];
  description?: string;
  company?: string;
  bpm?: number;
  wikiUrl?: string;
  extraFacts: { label: string; value: string }[];
  source: "qq_public_web";
}
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const string = (v: unknown) =>
  typeof v === "string"
    ? v.trim()
    : typeof v === "number" && Number.isSafeInteger(v)
      ? String(v)
      : "";
export function normalizePublicMetadata(
  payload: unknown,
  mid: string,
  id?: string,
): PublicMetadata | undefined {
  const wrapper = record(record(payload).song),
    body = record(wrapper.data),
    track = record(body.track_info),
    info = record(body.info);
  if (
    wrapper.code !== 0 ||
    track.mid !== mid ||
    (id && string(track.id) !== id)
  )
    return;
  const values = (key: string) => {
    const content = record(info[key]).content;
    return Array.isArray(content)
      ? [
          ...new Set(
            content.map((v) => string(record(v).value)).filter(Boolean),
          ),
        ]
      : [];
  };
  const wiki = string(record(body.extras).wikiurl);
  let wikiUrl: string | undefined;
  try {
    const url = new URL(wiki);
    if (
      url.protocol === "https:" &&
      url.hostname === "wiki.y.qq.com" &&
      !url.username &&
      !url.password
    )
      wikiUrl = url.href;
  } catch {
    /* optional */
  }
  return {
    observedAt: new Date().toISOString(),
    mid,
    id: string(track.id),
    languages: values("lan"),
    genres: values("genre"),
    description: values("intro").join("\n\n") || undefined,
    company: values("company").join("、") || undefined,
    bpm:
      typeof track.bpm === "number" && track.bpm > 0 && track.bpm <= 500
        ? track.bpm
        : undefined,
    wikiUrl,
    source: "qq_public_web",
    extraFacts: [
      ...(typeof track.index_album === "number" && track.index_album > 0
        ? [{ label: "专辑曲序", value: `第 ${track.index_album} 首` }]
        : []),
      ...(string(track.subtitle)
        ? [{ label: "副标题", value: string(track.subtitle) }]
        : []),
      ...(string(record(body.extras).transname)
        ? [{ label: "译名", value: string(record(body.extras).transname) }]
        : []),
      ...Object.entries(info)
        .filter(
          ([key]) =>
            !["lan", "genre", "intro", "company", "pub_time"].includes(key),
        )
        .flatMap(([key, value]) => {
          const label = string(record(value).title),
            entries = values(key);
          return label && entries.length
            ? [{ label, value: entries.join("、") }]
            : [];
        }),
    ],
  };
}
/** Experimental anonymous metadata only. Never send OpenAPI credentials or user
 * tickets here, never query stream resources, and never depend on this for play rights. */
export class PublicMetadataReader {
  private cache = new Map<
    string,
    { expires: number; value?: PublicMetadata }
  >();
  private pending = new Map<string, Promise<PublicMetadata | undefined>>();
  constructor(
    private enabled: boolean,
    private transport: typeof fetch = fetch,
  ) {}
  async get(mid?: string, id?: string): Promise<PublicMetadata | undefined> {
    if (!this.enabled || !mid || !/^[A-Za-z0-9_-]{1,64}$/.test(mid)) return;
    const key = `${mid}:${id || ""}`,
      cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const running = this.pending.get(key);
    if (running) return running;
    if (this.pending.size >= 4) return;
    const promise = (async () => {
      let value: PublicMetadata | undefined;
      try {
        const response = await this.transport(
          "https://u.y.qq.com/cgi-bin/musicu.fcg",
          {
            method: "POST",
            credentials: "omit",
            redirect: "error",
            headers: {
              "Content-Type": "application/json",
              Referer: "https://y.qq.com/",
            },
            body: JSON.stringify({
              comm: { ct: 24, cv: 0 },
              song: {
                module: "music.pf_song_detail_svr",
                method: "get_song_detail_yqq",
                param: { song_mid: mid },
              },
            }),
            signal: AbortSignal.timeout(6000),
          },
        );
        const raw = await response.text();
        if (response.ok && raw.length <= 1_000_000)
          value = normalizePublicMetadata(JSON.parse(raw), mid, id);
      } catch {
        /* This optional source must not block OpenAPI or game selection. */
      }
      if (this.cache.size >= 128)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, {
        expires: Date.now() + (value ? 30 * 60_000 : 30_000),
        value,
      });
      return value;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
}
