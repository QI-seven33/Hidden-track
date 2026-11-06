import {
  nextTrack,
  prevTrack,
  setBgmEnabled,
  startBgm,
} from './engine';
import { BGM_TRACKS } from './tracks';
import { useAudio } from './useAudio';

/**
 * 牌桌顶栏常驻的小播放器：切歌与暂停，和设置里的音频区块共用同一份状态。
 * 不显示音量——那属于设置，这里只解决「随时换一首 / 先静一下」。
 */
export function MiniPlayer() {
  const audio = useAudio();
  const track = BGM_TRACKS[audio.track] ?? BGM_TRACKS[0]!;
  const paused = !audio.playing;
  const toggle = () => {
    if (!audio.bgm) {
      setBgmEnabled(true);
      void startBgm();
      return;
    }
    if (audio.playing) setBgmEnabled(false);
    else void startBgm();
  };
  return (
    <div
      className={
        'mini-player' +
        (paused ? ' is-paused' : ' is-playing') +
        (audio.previewing ? ' is-previewing' : '')
      }
      role="group"
      aria-label="背景音乐播放器"
    >
      <span className="mp-note" aria-hidden="true">
        ♪
      </span>
      <span className="mp-title" title={`${track.title} · ${track.artist}`}>
        <b>{track.title}</b>
        <small>{audio.previewing ? '试听中 · 已暂停' : track.artist}</small>
      </span>
      <button
        className="mp-btn"
        aria-label="上一首"
        title="上一首"
        onClick={prevTrack}
      >
        ‹
      </button>
      <button
        className="mp-btn mp-play"
        aria-label={paused ? '播放背景音乐' : '暂停背景音乐'}
        title={paused ? '播放' : '暂停'}
        aria-pressed={!paused}
        onClick={toggle}
      >
        {paused ? '▶' : '❙❙'}
      </button>
      <button
        className="mp-btn"
        aria-label="下一首"
        title="下一首"
        onClick={nextTrack}
      >
        ›
      </button>
    </div>
  );
}
