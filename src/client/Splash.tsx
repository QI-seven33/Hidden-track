import { BRAND_TAGLINE } from "../shared/brand";
import { useEffect, useRef, useState } from "react";
import { ART_PACK, artPath } from "./presentation/skin";
import { BGM_TRACKS } from "./audio/tracks";

/** 开屏要预热的图：卡面 / 牌背 / 三种事件卡前后 / 牌桌。 */
function preloadTargets() {
  const list: string[] = [];
  for (const asset of Object.values(ART_PACK.cards)) {
    const src = artPath(asset ?? undefined);
    if (src) list.push(src);
  }
  for (const key of ["cardFrame", "cardBack", "scene"] as const) {
    const src = artPath(ART_PACK[key]);
    if (src) list.push(src);
  }
  for (const pack of Object.values(ART_PACK.events ?? {})) {
    for (const face of [pack.front, pack.back]) {
      const src = artPath(face);
      if (src) list.push(src);
    }
  }
  return [...new Set(list)];
}

function preloadImage(src: string, done: () => void) {
  const img = new Image();
  img.onload = done;
  img.onerror = done;
  img.src = src;
}

/**
 * 开屏：先给一个 Hidden Track 的假进度条，同时把牌面、事件卡和第一首
 * 背景音乐预热掉，等应用真正拿到 meta + session 再收尾淡出。
 * 进度条不虚报完成——资源没到就停在 88% 等。
 */
export function Splash({ ready }: { ready: boolean }) {
  const [progress, setProgress] = useState(6);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const target = useRef(6);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    const list = preloadTargets();
    let loaded = 0;
    const total = list.length + 1; // +1 给背景音乐
    const bump = () => {
      loaded++;
      target.current = Math.min(88, 6 + (loaded / total) * 82);
    };
    for (const src of list) preloadImage(src, bump);
    // 背景音乐只拉首曲，后面的按需加载。
    const track = BGM_TRACKS[0];
    if (track) {
      const audio = new Audio();
      audio.preload = "auto";
      audio.addEventListener("loadeddata", bump, { once: true });
      audio.addEventListener("error", bump, { once: true });
      audio.src = track.file;
      audio.load();
    } else bump();
  }, []);

  // 进度条自己往上爬，避免资源很快时进度条显得僵住。
  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((value) => {
        const ceiling = ready ? 100 : Math.max(value, target.current);
        return Math.min(
          ceiling,
          value + Math.max(0.8, (ceiling - value) * 0.16),
        );
      });
    }, 90);
    return () => clearInterval(timer);
  }, [ready]);

  useEffect(() => {
    if (progress < 100) return;
    // 至少停留 650ms，快网速下也不要一闪而过。
    const wait = Math.max(0, 650 - (Date.now() - startedAt.current));
    const t1 = setTimeout(() => setLeaving(true), wait);
    const t2 = setTimeout(() => setGone(true), wait + 460);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [progress]);

  if (gone) return null;
  return (
    <div
      className={"mg-splash" + (leaving ? " is-leaving" : "")}
      role="status"
      aria-label="正在进入 Hidden Track"
    >
      <div className="mg-splash-inner">
        <img
          className="mg-splash-logo"
          src="/art/logo-hidden-track.png"
          alt="Hidden Track"
        />
        <p className="mg-splash-tag">{BRAND_TAGLINE}</p>
        <div className="mg-splash-bar" aria-hidden="true">
          <i style={{ width: progress.toFixed(1) + "%" }} />
        </div>
        <span className="mg-splash-num">{Math.round(progress)}%</span>
      </div>
    </div>
  );
}
