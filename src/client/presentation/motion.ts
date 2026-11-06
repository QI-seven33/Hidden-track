import type { PresentationEvent } from './events';
export const MOTION = {
  /** 落位：起步快、尾巴长，卡片停住时不会「啪」一下。 */
  settle: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** 飞行中段：比 settle 更匀速，长距离移动不会中段发飘。 */
  travel: 'cubic-bezier(0.22, 0.68, 0.28, 1)',
  /** 抬升：给 hover / 选中这类小位移用，起手柔、收尾稳。 */
  lift: 'cubic-bezier(0.25, 0.8, 0.3, 1)',
  cardMs: 440,
  drawMs: 400,
  reflowMs: 220,
};
export type FeedbackCue = {
  id: number;
  lane: string;
  side?: 'a' | 'b';
  kind: 'damage' | 'pressure' | 'heal' | 'response' | 'clue' | 'draw' | 'guess';
  label: string;
  tone: 'warm' | 'cool' | 'gold';
  duration: number;
};

/** Same-action effects are composed immediately, never queued behind card/toast animations. */
export function composeFeedback(
  events: readonly PresentationEvent[],
): FeedbackCue[] {
  const result = new Map<string, FeedbackCue>();
  const hitSides = new Set(
    events
      .filter((e) => e.kind === 'damage' && e.title !== '失去行动点')
      .map((e) => e.side),
  );
  for (const e of events) {
    const lane = e.kind === 'clue' ? `clue:${e.side}` : `player:${e.side}`;
    let cue: FeedbackCue | undefined;
    if (e.kind === 'damage' && e.title !== '失去行动点')
      cue = {
        id: e.id,
        lane,
        side: e.side,
        kind: 'damage',
        label: `+${e.amount ?? 0} 压力`,
        tone: 'warm',
        duration: 760,
      };
    else if (e.kind === 'pressure' && !hitSides.has(e.side) && e.amount)
      cue = {
        id: e.id,
        lane,
        side: e.side,
        kind: 'pressure',
        label: `${e.amount > 0 ? '+' : ''}${e.amount} 压力`,
        tone: e.amount > 0 ? 'warm' : 'cool',
        duration: 680,
      };
    else if (e.kind === 'heal' && e.amount)
      cue = {
        id: e.id,
        lane: `ap:${e.side}`,
        side: e.side,
        kind: 'heal',
        label: `+${e.amount} 行动点`,
        tone: 'cool',
        duration: 680,
      };
    else if (e.kind === 'response')
      cue = {
        id: e.id,
        lane,
        side: e.side,
        kind: 'response',
        label: e.title === '伤害免疫' ? '已免疫' : '已抵消',
        tone: 'cool',
        duration: 680,
      };
    else if (e.kind === 'clue') {
      const previous = result.get(lane);
      const count = previous
        ? Number(previous.label.match(/\d+/)?.[0] ?? 1) + 1
        : 1;
      cue = {
        id: e.id,
        lane,
        side: e.side,
        kind: 'clue',
        label: count > 1 ? `${count} 条新线索` : '新线索',
        tone: 'gold',
        duration: 720,
      };
    } else if (e.kind === 'guess')
      cue = {
        id: e.id,
        lane: `guess:${e.side}`,
        side: e.side,
        kind: 'guess',
        label: '已提交猜歌',
        tone: 'gold',
        duration: 720,
      };
    if (cue) result.set(cue.lane, cue);
  }
  // Damage, response and nearby clue/AP feedback may coexist, but never pile up an old backlog.
  return [...result.values()].slice(-5);
}

export interface MotionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export function flightDelta(from: MotionRect, to: MotionRect) {
  if (
    ![
      from.left,
      from.top,
      from.width,
      from.height,
      to.left,
      to.top,
      to.width,
      to.height,
    ].every(Number.isFinite) ||
    to.width <= 0 ||
    to.height <= 0
  )
    return undefined;
  return {
    x: from.left + from.width / 2 - to.left - to.width / 2,
    y: from.top + from.height / 2 - to.top - to.height / 2,
    scale: Math.max(0.35, Math.min(1, from.width / to.width)),
  };
}
