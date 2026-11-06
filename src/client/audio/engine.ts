import { BGM_TRACKS, SFX_FILES, type SfxKind } from "./tracks";

export type AudioSide = "self" | "opponent" | "neutral";

export type AudioSnapshot = {
  bgm: boolean;
  sfx: boolean;
  /** 0–1，与 duck 相乘后写入元素音量 */
  bgmVolume: number;
  track: number;
  playing: boolean;
  /** 浏览器拦了自动播放，等一次点击 */
  blocked: boolean;
  /** 官方试听正在播放，背景音乐被整体暂停 */
  previewing: boolean;
};

const STORAGE_KEY = "duel.audio.v1";
const SFX_GAIN = 0.9;
/** 对战界面压低背景音乐，避免盖住试听 */
const DUCK_DUEL = 0.32;

type Stored = Pick<AudioSnapshot, "bgm" | "sfx" | "bgmVolume" | "track">;

const DEFAULTS: Stored = { bgm: true, sfx: true, bgmVolume: 0.45, track: 0 };

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function read(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const data = JSON.parse(raw) as Partial<Stored>;
    return {
      bgm: typeof data.bgm === "boolean" ? data.bgm : DEFAULTS.bgm,
      sfx: typeof data.sfx === "boolean" ? data.sfx : DEFAULTS.sfx,
      bgmVolume:
        typeof data.bgmVolume === "number" && Number.isFinite(data.bgmVolume)
          ? clamp(data.bgmVolume)
          : DEFAULTS.bgmVolume,
      track:
        typeof data.track === "number" &&
        data.track >= 0 &&
        data.track < BGM_TRACKS.length
          ? Math.floor(data.track)
          : 0,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings: Stored = read();
let element: HTMLAudioElement | undefined;
let playing = false;
let blocked = false;
let duelMode = false;
let previewing = false;
let inLobby = false;
let backgrounded = false;
let backgroundResume = false;
let playbackEpoch = 0;
const activeSources = new Set<AudioBufferSourceNode>();
const listeners = new Set<() => void>();

function snapshot(): AudioSnapshot {
  return { ...settings, playing, blocked, previewing };
}
let current = snapshot();

function emit() {
  const next = snapshot();
  // 值没变就别通知，避免轮询时白白重渲染设置面板。
  if (
    next.bgm === current.bgm &&
    next.sfx === current.sfx &&
    next.bgmVolume === current.bgmVolume &&
    next.track === current.track &&
    next.playing === current.playing &&
    next.blocked === current.blocked &&
    next.previewing === current.previewing
  )
    return;
  current = next;
  for (const listener of listeners) listener();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* 隐私模式下写不进去也不该影响播放 */
  }
}

export function subscribeAudio(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function audioSnapshot() {
  return current;
}

function duckLevel() {
  return duelMode ? DUCK_DUEL : 1;
}

function applyVolume() {
  if (!element) return;
  element.volume = clamp(settings.bgmVolume * duckLevel());
}

function node() {
  if (element) return element;
  const audio = new Audio();
  audio.preload = "auto";
  audio.addEventListener("ended", () => {
    nextTrack();
  });
  audio.addEventListener("playing", () => {
    if (backgrounded || !settings.bgm || !inLobby || previewing) {
      audio.pause();
      return;
    }
    playing = true;
    blocked = false;
    emit();
  });
  audio.addEventListener("pause", () => {
    playing = !audio.paused;
    emit();
  });
  audio.addEventListener("error", () => {
    playing = false;
    emit();
  });
  element = audio;
  return audio;
}

function loadTrack(index: number) {
  const audio = node();
  const track = BGM_TRACKS[index] ?? BGM_TRACKS[0]!;
  if (!audio.src.endsWith(track.file)) {
    audio.src = track.file;
    audio.load();
  }
  return audio;
}

/**
 * 快速「关 → 开」时，pause 事件可能晚于 playing 事件到达，
 * 把状态写成「没在放」。这里按元素真实状态对一次。
 */
function reconcile(delay = 240) {
  setTimeout(() => {
    if (!element) return;
    const live = !element.paused;
    if (live !== playing) {
      playing = live;
      emit();
    }
  }, delay);
}

/** Try automatically. A browser denial is exposed to the existing player controls. */
export async function startBgm() {
  if (!settings.bgm || previewing || !inLobby || backgrounded) return;
  const epoch = ++playbackEpoch;
  const audio = loadTrack(settings.track);
  applyVolume();
  try {
    await audio.play();
    if (epoch !== playbackEpoch) return;
    if (!settings.bgm || previewing || !inLobby || backgrounded) {
      audio.pause();
      return;
    }
    playing = true;
    blocked = false;
  } catch (error) {
    if (epoch !== playbackEpoch) return;
    playing = false;
    blocked = error instanceof DOMException && error.name === "NotAllowedError";
    // 只在开发时留意：多半是自动播放策略或解码失败。
    if (import.meta.env?.DEV) console.warn("[audio] bgm 未能播放", error);
  }
  emit();
  reconcile();
}

/** Page host starts the one shared BGM player automatically. */
export function enterLobby() {
  inLobby = true;
  if (backgrounded && settings.bgm) backgroundResume = true;
  void startBgm();
}

/** Leaving the app stops the shared player without changing saved preferences. */
export function leaveLobby() {
  inLobby = false;
  playbackEpoch++;
  element?.pause();
  reconcile(120);
}

export function setBgmEnabled(on: boolean) {
  settings.bgm = on;
  save();
  emit();
  if (on) {
    void startBgm();
  } else {
    element?.pause();
    reconcile(120);
  }
}

export function setSfxEnabled(on: boolean) {
  settings.sfx = on;
  save();
  emit();
  if (on) void primeSfx();
}

export function setBgmVolume(value: number) {
  settings.bgmVolume = clamp(value);
  save();
  applyVolume();
  emit();
}

function goTo(index: number) {
  playbackEpoch++;
  settings.track =
    ((index % BGM_TRACKS.length) + BGM_TRACKS.length) % BGM_TRACKS.length;
  save();
  const audio = loadTrack(settings.track);
  emit();
  audio.currentTime = 0;
  if (settings.bgm) {
    if (previewing) previewPaused = true;
    else void startBgm();
  }
}

export function nextTrack() {
  goTo(settings.track + 1);
}

export function prevTrack() {
  goTo(settings.track - 1);
}

export function selectTrack(index: number) {
  goTo(index);
}

/** 对战界面：整体压低音乐，给试听留出空间。 */
export function setDuelMode(on: boolean) {
  duelMode = on;
  applyVolume();
}

let previewPaused = false;
/**
 * 官方试听开始就整段停掉背景音乐（只压低音量仍会盖住要听的 10 秒），
 * 试听结束后从原位置接着放。用户主动关掉 BGM 时不去恢复。
 */
export function setPreviewing(on: boolean) {
  if (on === previewing) return;
  previewing = on;
  if (on) {
    if (element && !element.paused) {
      previewPaused = true;
      element.pause();
    }
  } else if (previewPaused) {
    previewPaused = false;
    if (settings.bgm) void startBgm();
  }
  emit();
}

/** Mobile browser and native lifecycle pause without changing the user's audio preference. */
export function setBackgrounded(hidden: boolean) {
  if (hidden === backgrounded) return;
  backgrounded = hidden;
  if (hidden) {
    for (const source of activeSources) {
      try {
        source.stop();
      } catch {}
    }
    activeSources.clear();
    backgroundResume = Boolean(
      settings.bgm &&
      (playing || previewPaused || (element && !element.paused)),
    );
    element?.pause();
    playing = false;
    emit();
  } else if (backgroundResume) {
    backgroundResume = false;
    void startBgm();
  }
}
export function isAudioBackgrounded() {
  return backgrounded;
}
if (
  typeof window !== "undefined" &&
  /HiddenTrackAndroid\/1\.0/.test(navigator.userAgent)
) {
  let nativeHidden = document.documentElement.dataset.appHidden === "1";
  const sync = () => setBackgrounded(nativeHidden || document.hidden);
  document.addEventListener("visibilitychange", sync);
  addEventListener("pagehide", () => setBackgrounded(true));
  addEventListener("pageshow", sync);
  addEventListener("ht-background", () => {
    nativeHidden = true;
    sync();
  });
  addEventListener("ht-foreground", () => {
    nativeHidden = false;
    sync();
  });
  sync();
}

/* ---------------- 音效 ---------------- */

let context: AudioContext | undefined;
const buffers = new Map<SfxKind, Promise<AudioBuffer | undefined>>();
const lastPlayed = new Map<string, number>();

function audioContext() {
  if (context) {
    if (context.state === "suspended") void context.resume().catch(() => {});
    return context;
  }
  if (typeof window === "undefined" || !("AudioContext" in window)) return;
  context = new AudioContext();
  return context;
}

function decode(kind: SfxKind) {
  const ctx = audioContext();
  if (!ctx) return Promise.resolve(undefined);
  const cached = buffers.get(kind);
  if (cached) return cached;
  const task = fetch(SFX_FILES[kind])
    .then((response) => {
      if (!response.ok) throw new Error("音效载入失败");
      return response.arrayBuffer();
    })
    .then((data) => ctx.decodeAudioData(data))
    .catch(() => {
      buffers.delete(kind);
      return undefined;
    });
  buffers.set(kind, task);
  return task;
}

/** 提前解码，第一次出手不卡。 */
export function primeSfx() {
  if (!settings.sfx || backgrounded) return;
  for (const kind of Object.keys(SFX_FILES) as SfxKind[]) void decode(kind);
}

/**
 * 双方音效必须能听出区别：自己偏高、偏右、更亮；
 * 对手偏低、偏左、更闷更轻。同一时刻的重复条目只响一次。
 */
const SIDES: Record<AudioSide, { rate: number; gain: number; pan: number }> = {
  self: { rate: 1, gain: 1, pan: 0.16 },
  opponent: { rate: 0.78, gain: 0.62, pan: -0.16 },
  neutral: { rate: 1, gain: 0.82, pan: 0 },
};

/**
 * 单次音效的可选参数。默认行为与旧版完全一致（整段放完、不做包络）。
 */
export type SfxOptions = {
  /** 相对 SFX_GAIN 的额外增益，1 = 与出牌音同响；小于 1 更轻 */
  volume?: number;
  /** 起播后多久开始淡出（秒，按墙钟时间算，不受播放速率影响） */
  hold?: number;
  /** 淡出时长（秒）；省略则整段播完 */
  fade?: number;
  /** 绕开同 kind+side 的 90ms 去重：整局只响一次的结算音用 */
  once?: boolean;
};

/** 提前掐掉正在播的音效（例如玩家点掉结算横幅）。 */
export type SfxHandle = { stop: (fadeSeconds?: number) => void };

export async function playSfx(
  kind: SfxKind,
  side: AudioSide = "neutral",
  rate = 1,
  options: SfxOptions = {},
): Promise<SfxHandle | undefined> {
  if (!settings.sfx || backgrounded) return;
  if (!options.once) {
    const stamp = performance.now();
    const key = `${kind}:${side}`;
    if (stamp - (lastPlayed.get(key) ?? -1e9) < 90) return;
    lastPlayed.set(key, stamp);
  }
  const ctx = audioContext();
  if (!ctx) return;
  const buffer = await decode(kind);
  if (!buffer || !settings.sfx || backgrounded) return;
  const source = ctx.createBufferSource();
  activeSources.add(source);
  source.buffer = buffer;
  const variant = SIDES[side];
  source.playbackRate.value = variant.rate * rate;
  const gain = ctx.createGain();
  const level = variant.gain * SFX_GAIN * (options.volume ?? 1);
  const pan = ctx.createStereoPanner();
  pan.pan.value = variant.pan;
  source.connect(gain);
  gain.connect(pan);
  pan.connect(ctx.destination);
  source.onended = () => {
    activeSources.delete(source);
    source.disconnect();
    gain.disconnect();
    pan.disconnect();
  };
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(level, now);
  // 带包络：到 hold 点后线性淡出，淡出结束就停源，省得在循环素材的接缝上硬切。
  const fade = options.fade ?? 0;
  if (fade > 0) {
    const hold = Math.max(0, options.hold ?? 0);
    const end = now + hold + fade;
    gain.gain.setValueAtTime(level, now + hold);
    gain.gain.linearRampToValueAtTime(0.0001, end);
    source.start(now);
    source.stop(end + 0.02);
    return {
      stop: (fadeSeconds = 0.1) => {
        const at = ctx.currentTime;
        try {
          gain.gain.cancelScheduledValues(at);
          gain.gain.setValueAtTime(gain.gain.value, at);
          gain.gain.linearRampToValueAtTime(0.0001, at + fadeSeconds);
          source.stop(at + fadeSeconds + 0.02);
        } catch {
          /* 已经停了 */
        }
      },
    };
  }
  source.start(now);
  return {
    stop: (fadeSeconds = 0.08) => {
      const at = ctx.currentTime;
      try {
        gain.gain.cancelScheduledValues(at);
        gain.gain.setValueAtTime(gain.gain.value, at);
        gain.gain.linearRampToValueAtTime(0.0001, at + fadeSeconds);
        source.stop(at + fadeSeconds + 0.02);
      } catch {
        /* 已经停了 */
      }
    },
  };
}
