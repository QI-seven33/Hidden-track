import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LobbyTurntable } from "../src/client/MangaUI";

test("lobby turntable is a display group without keyboard or button affordances", () => {
  const html = renderToStaticMarkup(createElement(LobbyTurntable));
  assert.match(html, /role="group"/);
  assert.doesNotMatch(html, /role="button"|tabindex|is-resumable/);
});

test("only the Android app pauses BGM in background; browsers and Windows keep playing", async () => {
  const keys = [
    "window",
    "document",
    "navigator",
    "Audio",
    "addEventListener",
    "removeEventListener",
  ] as const;
  const previous = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  class FakeAudio {
    static current: FakeAudio;
    src = "";
    preload = "";
    volume = 0;
    paused = true;
    currentTime = 0;
    plays = 0;
    denied = false;
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
      if (this.denied) throw new DOMException("blocked", "NotAllowedError");
      this.paused = false;
      this.handlers.get("playing")?.();
    }
    pause() {
      this.paused = true;
      this.handlers.get("pause")?.();
    }
  }
  try {
    for (const [platform, ua, pause] of [
      ["mobile browser", "Mozilla Android Mobile", false],
      ["Windows app", "Mozilla Windows HiddenTrackWindows/1.0", false],
      ["Android app", "Mozilla Android Mobile HiddenTrackAndroid/1.0", true],
    ] as const) {
      const win = new EventTarget();
      const doc = Object.assign(new EventTarget(), {
        hidden: false,
        documentElement: { dataset: { appHidden: "0" } },
      });
      const values = {
        window: win,
        document: doc,
        navigator: { userAgent: ua },
        Audio: FakeAudio,
        addEventListener: win.addEventListener.bind(win),
        removeEventListener: win.removeEventListener.bind(win),
      };
      for (const key of keys)
        Object.defineProperty(globalThis, key, {
          value: values[key],
          configurable: true,
          writable: true,
        });
      const engine = await import(
        new URL(
          "../src/client/audio/engine.ts?platform=" +
            encodeURIComponent(platform),
          import.meta.url,
        ).href
      );
      engine.enterLobby();
      await Promise.resolve();
      assert.equal(
        FakeAudio.current.plays,
        1,
        platform + " starts automatically",
      );
      assert.equal(FakeAudio.current.paused, false);
      doc.hidden = true;
      doc.dispatchEvent(new Event("visibilitychange"));
      win.dispatchEvent(new Event("ht-background"));
      assert.equal(
        FakeAudio.current.paused,
        pause,
        platform + " background policy",
      );
      doc.hidden = false;
      doc.dispatchEvent(new Event("visibilitychange"));
      win.dispatchEvent(new Event("ht-foreground"));
      await Promise.resolve();
      assert.equal(
        FakeAudio.current.paused,
        false,
        platform + " foreground resumes",
      );
      engine.leaveLobby();
    }
    // A denied browser does not start unexpectedly on an arbitrary page click.
    const win = new EventTarget(),
      doc = Object.assign(new EventTarget(), {
        hidden: false,
        documentElement: { dataset: {} },
      });
    Object.defineProperty(globalThis, "window", {
      value: win,
      configurable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: doc,
      configurable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "Mozilla" },
      configurable: true,
    });
    Object.defineProperty(globalThis, "addEventListener", {
      value: win.addEventListener.bind(win),
      configurable: true,
    });
    Object.defineProperty(globalThis, "removeEventListener", {
      value: win.removeEventListener.bind(win),
      configurable: true,
    });
    const engine = await import(
      new URL("../src/client/audio/engine.ts?platform=denied", import.meta.url)
        .href
    );
    engine.setBgmEnabled(false);
    engine.enterLobby();
    engine.nextTrack();
    FakeAudio.current.denied = true;
    engine.setBgmEnabled(true);
    await Promise.resolve();
    assert.equal(engine.audioSnapshot().blocked, true);
    const attempts = FakeAudio.current.plays;
    win.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    assert.equal(FakeAudio.current.plays, attempts);
    FakeAudio.current.denied = false;
    await engine.startBgm();
    assert.equal(engine.audioSnapshot().playing, true);
    engine.leaveLobby();
  } finally {
    for (const key of keys) {
      const old = previous.get(key);
      if (old) Object.defineProperty(globalThis, key, old);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
