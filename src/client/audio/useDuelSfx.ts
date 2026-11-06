import { useEffect, useRef } from 'react';
import type { RoomView } from '../../shared/protocol';
import type { Side } from '../../game/types';
import { playSfx, primeSfx, setPreviewing, type AudioSide } from './engine';

type Game = NonNullable<RoomView['game']>;

function sideOf(side: Side | undefined, me: Side): AudioSide {
  if (side === undefined) return 'neutral';
  return side === me ? 'self' : 'opponent';
}

/**
 * 牌桌音效：出牌 / 摸牌 / 获得线索 / 事件弹出。
 * 只放「这一帧新出现」的日志，进入牌桌不会把历史一次性补响。
 */
export function useDuelSfx(game: Game | undefined, me: Side) {
  const cursor = useRef(-1);
  const match = useRef('');
  const eventKey = useRef('');

  useEffect(() => {
    primeSfx();
    return () => setPreviewing(false);
  }, []);

  useEffect(() => {
    if (!game) return;
    // 换了一局：把当前日志全部视作历史，不补放。
    if (match.current !== game.matchId) {
      match.current = game.matchId;
      cursor.current = game.log.at(-1)?.id ?? 0;
      return;
    }
    const fresh = game.log.filter((entry) => entry.id > cursor.current);
    if (!fresh.length) return;
    cursor.current = game.log.at(-1)?.id ?? cursor.current;
    for (const entry of fresh) {
      const side = sideOf(entry.side, me);
      // 出牌与摸牌共用同一段卡牌音：摸牌略快一点，听得出是「拿」不是「打」。
      if (entry.kind === 'card') void playSfx('card', side, 1);
      else if (entry.kind === 'draw') void playSfx('card', side, 1.16);
      else if (entry.kind === 'clue') void playSfx('clue', side);
    }
  }, [game, me]);

  useEffect(() => {
    if (!game) return;
    const stage = game.stageEvent;
    if (!stage.waiting || stage.selected || !stage.options.length) return;
    const key = game.matchId + ':' + stage.stage;
    if (eventKey.current === key) return;
    eventKey.current = key;
    void playSfx('event');
  }, [game]);
}
