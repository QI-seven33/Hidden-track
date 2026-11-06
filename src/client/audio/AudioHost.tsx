import { useEffect, useRef } from "react";
import {
  enterLobby,
  leaveLobby,
  setDuelMode,
  startBgm,
  audioSnapshot,
} from "./engine";

/**
 * 大厅一进来就放背景音乐。对战时把音乐压到三成，
 * 免得盖住要听的那 10 秒试听；离开对战自动恢复。
 */
export function AudioHost({ duel, scene }: { duel?: boolean; scene?: string }) {
  const previousScene = useRef(scene);
  useEffect(() => {
    enterLobby();
    return () => leaveLobby();
  }, []);
  useEffect(() => {
    if (previousScene.current === scene) return;
    previousScene.current = scene;
    // A successful login may now permit browser autoplay. Retry on a scene
    // transition, not on arbitrary clicks, and never restart an active track.
    if (!audioSnapshot().playing) void startBgm();
  }, [scene]);
  useEffect(() => {
    setDuelMode(Boolean(duel));
  }, [duel]);
  return null;
}
