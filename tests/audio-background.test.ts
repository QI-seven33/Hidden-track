import { test } from 'node:test';
import assert from 'node:assert/strict';

test('background lifecycle pauses BGM, blocks track changes and honors preview/user mute on resume', async () => {
  class FakeAudio {
    static current: FakeAudio;
    src = '';
    preload = '';
    volume = 0;
    paused = true;
    currentTime = 0;
    plays = 0;
    handlers = new Map<string, () => void>();
    constructor() {
      FakeAudio.current = this;
    }
    addEventListener(name: string, handler: () => void) {
      this.handlers.set(name, handler);
    }
    load() {}
    async play() {
      this.plays++;
      this.paused = false;
      this.handlers.get('playing')?.();
    }
    pause() {
      this.paused = true;
      this.handlers.get('pause')?.();
    }
  }
  const old = globalThis.Audio;
  globalThis.Audio = FakeAudio as unknown as typeof Audio;
  const engine = await import('../src/client/audio/engine');
  try {
    engine.enterLobby();
    await engine.startBgm();
    assert.equal(FakeAudio.current.paused, false);
    engine.setBackgrounded(true);
    const count = FakeAudio.current.plays;
    engine.nextTrack();
    await engine.startBgm();
    assert.equal(FakeAudio.current.plays, count);
    assert.equal(FakeAudio.current.paused, true);
    engine.setBackgrounded(false);
    await Promise.resolve();
    assert.equal(FakeAudio.current.paused, false);
    engine.setPreviewing(true);
    engine.setBackgrounded(true);
    engine.setPreviewing(false);
    assert.equal(FakeAudio.current.paused, true);
    engine.setBackgrounded(false);
    await Promise.resolve();
    assert.equal(FakeAudio.current.paused, false);
    engine.setBackgrounded(true);
    engine.setBgmEnabled(false);
    engine.setBackgrounded(false);
    await Promise.resolve();
    assert.equal(FakeAudio.current.paused, true);
  } finally {
    engine.leaveLobby();
    globalThis.Audio = old;
  }
});
