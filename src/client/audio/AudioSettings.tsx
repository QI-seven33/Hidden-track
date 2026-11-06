import {
  nextTrack,
  prevTrack,
  selectTrack,
  setBgmEnabled,
  setBgmVolume,
  setSfxEnabled,
  startBgm,
} from "./engine";
import { BGM_TRACKS, SFX_CREDITS } from "./tracks";
import { useAudio } from "./useAudio";

/** 设置面板里的音频区块：开关、切歌、音量、音效、出处。 */
export function AudioSettings() {
  const audio = useAudio();
  const track = BGM_TRACKS[audio.track] ?? BGM_TRACKS[0]!;
  const volume = Math.round(audio.bgmVolume * 100);
  return (
    <div className="mg-audio">
      <div className="mg-setting-row">
        <span>背景音乐</span>
        <button
          className="mg-toggle"
          aria-label="背景音乐"
          aria-pressed={audio.bgm}
          onClick={() => {
            if (audio.bgm && audio.blocked) void startBgm();
            else setBgmEnabled(!audio.bgm);
          }}
        />
      </div>
      <div className="mg-track">
        <div className="mg-track-head">
          <span>曲目</span>
          <em>
            {audio.track + 1} / {BGM_TRACKS.length}
          </em>
        </div>
        <div className="mg-track-pick">
          <button
            className="mg-track-step"
            aria-label="上一首"
            onClick={prevTrack}
          >
            ‹
          </button>
          <div className="mg-track-name">
            <b title={track.title}>{track.title}</b>
            <small>{track.artist}</small>
          </div>
          <button
            className="mg-track-step"
            aria-label="下一首"
            onClick={nextTrack}
          >
            ›
          </button>
        </div>
        {BGM_TRACKS.length > 1 && (
          <div className="mg-track-dots" role="group" aria-label="选择曲目">
            {BGM_TRACKS.map((item, index) => (
              <button
                key={item.id}
                className="mg-track-dot"
                aria-label={`第 ${index + 1} 首：${item.title}`}
                aria-pressed={index === audio.track}
                onClick={() => selectTrack(index)}
              />
            ))}
          </div>
        )}
      </div>
      <div className="mg-setting-row">
        <span>音量</span>
        <input
          className="mg-range"
          type="range"
          min={0}
          max={100}
          step={5}
          value={volume}
          disabled={!audio.bgm}
          aria-label="背景音乐音量"
          onChange={(e) => setBgmVolume(Number(e.target.value) / 100)}
        />
      </div>
      <div className="mg-setting-row">
        <span>音效</span>
        <button
          className="mg-toggle"
          aria-label="音效"
          aria-pressed={audio.sfx}
          onClick={() => setSfxEnabled(!audio.sfx)}
        />
      </div>
      <p className="mg-audio-hint">
        {audio.blocked
          ? "浏览器限制有声自动播放：点击上方背景音乐开关即可开始播放。"
          : "出牌、摸牌、事件选择、获得线索与对局结算各有音效；自己与对手的音效刻意做成不同音高，听得出是谁。"}
      </p>
      <details className="mg-credit">
        <summary>音乐出处与授权</summary>
        <p>
          背景音乐除自备曲目外均取自 Pixabay，按 Pixabay Content License
          授权，可免费商用、无需署名。这里仍然列出作者与作品页。
        </p>
        <ul>
          {BGM_TRACKS.map((item) => (
            <li key={item.id}>
              {item.source ? (
                <a href={item.source} target="_blank" rel="noreferrer">
                  {item.title}
                </a>
              ) : (
                <b>{item.title}</b>
              )}
              <small>
                {item.artist} · {item.site} · {item.license}
              </small>
            </li>
          ))}
        </ul>
        <p>音效：</p>
        <ul>
          {SFX_CREDITS.map((item) => (
            <li key={item.title}>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.title}
                </a>
              ) : (
                <b>{item.title}</b>
              )}
              <small>
                {item.usage}
                {" · "}
                {item.source}
                {item.license ? " · " + item.license : ""}
              </small>
            </li>
          ))}
        </ul>
        <p>
          Pixabay：
          <a href="https://pixabay.com/music/" target="_blank" rel="noreferrer">
            pixabay.com/music
          </a>
          　Freesound：
          <a href="https://freesound.org/" target="_blank" rel="noreferrer">
            freesound.org
          </a>
        </p>
      </details>
    </div>
  );
}
