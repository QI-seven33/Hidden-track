import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PresentationCursor, type PresentationEvent } from './events';
import { composeFeedback, type FeedbackCue } from './motion';
import { ART_PACK, artPath } from './skin';
import type { GameEvent, Side } from '../../game/types';
import { stageCoordinates } from './coordinates';

type LocatedCue = FeedbackCue & { x: number; y: number };
/** The server settles immediately. A bounded set of local cues never delays input. */
export function EffectLayer({
  roomId,
  events,
  epoch,
  me,
}: {
  roomId: string;
  events: readonly PresentationEvent[];
  epoch: number;
  me: Side;
}) {
  const cursor = useRef(new PresentationCursor());
  const layer = useRef<HTMLDivElement>(null);
  const identity = useRef('');
  const [cues, setCues] = useState<LocatedCue[]>([]);
  useEffect(() => {
    const key = `${roomId}:${epoch}`;
    if (identity.current !== key) {
      identity.current = key;
      setCues([]);
    }
    const fresh = cursor.current.next(key, events, !document.hidden);
    if (!fresh.length) return;
    const node = layer.current,
      table = node?.parentElement;
    if (!node || !table) return;
    const coordinates = stageCoordinates();
    const bounds = coordinates.rect(node.getBoundingClientRect());
    const next = composeFeedback(fresh).map((c) => {
      const rail =
        c.side === me ? '[data-player-side=human]' : '[data-player-side=bot]';
      const selector =
        c.kind === 'clue' && c.side === me
          ? '.clue-head'
          : rail + (c.kind === 'heal' ? ' [data-ap]' : ' [data-pressure]');
      const targetRect = table.querySelector(selector)?.getBoundingClientRect();
      const target = targetRect && coordinates.rect(targetRect);
      return {
        ...c,
        x: Math.max(
          65,
          Math.min(
            bounds.width - 65,
            (target
              ? target.left + target.width / 2
              : bounds.left + bounds.width / 2) - bounds.left,
          ),
        ),
        y: Math.max(
          28,
          Math.min(
            bounds.height - 28,
            (target ? target.top - 12 : bounds.top + 80) - bounds.top,
          ),
        ),
      };
    });
    setCues((old) =>
      [
        ...old.filter((c) => !next.some((n) => n.lane === c.lane)),
        ...next,
      ].slice(-5),
    );
  }, [roomId, epoch, events, me]);
  useEffect(() => {
    const reset = () => {
      setCues([]);
      cursor.current = new PresentationCursor();
    };
    document.addEventListener('visibilitychange', reset);
    window.addEventListener('resize', reset);
    return () => {
      document.removeEventListener('visibilitychange', reset);
      window.removeEventListener('resize', reset);
    };
  }, []);
  return (
    <div ref={layer} className="motion-feedback-layer" aria-hidden="true">
      {cues.map((c) => (
        <Cue
          key={`${c.lane}:${c.id}`}
          cue={c}
          done={() => setCues((old) => old.filter((v) => v !== c))}
        />
      ))}
    </div>
  );
}
function Cue({ cue: c, done }: { cue: LocatedCue; done: () => void }) {
  const complete = useRef(done);
  complete.current = done;
  useEffect(() => {
    const timer = setTimeout(() => complete.current(), c.duration);
    return () => clearTimeout(timer);
  }, [c.id, c.duration]);
  const asset = artPath(ART_PACK.effects[c.kind as GameEvent['kind']]);
  return (
    <div
      className={`motion-cue motion-${c.kind} tone-${c.tone}`}
      style={
        {
          left: c.x,
          top: c.y,
          '--cue-duration': `${c.duration}ms`,
        } as CSSProperties
      }
    >
      {(c.kind === 'damage' || c.kind === 'response') && (
        <svg className="motion-impact" viewBox="-60 -60 120 120">
          <circle className="motion-wave" r="23" />
          <circle className="motion-wave second" r="23" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <path
              key={i}
              className="motion-spark"
              d="M 29 0 L 39 0"
              transform={`rotate(${i * 60 + 15})`}
            />
          ))}
        </svg>
      )}
      <span className="motion-number">{c.label}</span>
      {c.kind === 'clue' && <span className="motion-clue-line" />}
      {asset && (
        <img
          className="motion-art"
          src={asset}
          alt=""
          onError={(e) => {
            e.currentTarget.hidden = true;
          }}
        />
      )}
    </div>
  );
}
