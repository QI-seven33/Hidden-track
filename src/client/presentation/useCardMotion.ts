import { useLayoutEffect, useRef, type RefObject } from 'react';
import { flightDelta, MOTION } from './motion';
import type { PresentationEvent } from './events';
import { stageCoordinates } from './coordinates';

/**
 * 找不到手牌位置时的兜底起点：自己从牌桌底部中央升起，对手从顶部中央落下。
 * 有了它，出牌动画永远不会从牌堆（右上角）或随机方向窜出来。
 */
function homeAnchor(node: HTMLElement, mine: boolean) {
  const box = stageCoordinates().rect(node.getBoundingClientRect());
  const width = 96;
  const height = 128;
  return {
    left: box.left + box.width / 2 - width / 2,
    top: mine ? box.top + box.height - height - 12 : box.top + 12,
    width,
    height,
  };
}

export function useCardMotion(
  table: RefObject<HTMLElement | null>,
  identity: string,
  handKey: string,
  latestCard: PresentationEvent | undefined,
  me: 'a' | 'b',
) {
  const prior = useRef<
    | { identity: string; rects: Map<string, DOMRect>; cardId?: number }
    | undefined
  >(undefined);
  const animations = useRef(new Set<Animation>());
  const decorations = useRef(
    new Map<HTMLElement, ReturnType<typeof setTimeout>>(),
  );
  const prepared = useRef<{ rect: DOMRect; at: number } | undefined>(undefined);
  const stop = () => {
    animations.current.forEach((a) => a.cancel());
    animations.current.clear();
    decorations.current.forEach((timer, element) => {
      clearTimeout(timer);
      element.remove();
    });
    decorations.current.clear();
  };
  const play = (
    element: HTMLElement,
    frames: Keyframe[],
    duration: number,
    delay = 0,
    easing = MOTION.travel,
  ) => {
    if (!element.animate) return;
    const animation = element.animate(frames, {
      duration,
      delay,
      easing,
      fill: 'backwards',
    });
    animations.current.add(animation);
    const release = () => animations.current.delete(animation);
    animation.finished.then(release, release);
    return animation;
  };
  useLayoutEffect(() => {
    const node = table.current;
    if (!node) return;
    const coordinates = stageCoordinates();
    const cards = [...node.querySelectorAll<HTMLElement>('[data-motion-card]')];
    const rects = new Map(
      cards.map((c) => [c.dataset.motionCard!, c.getBoundingClientRect()]),
    );
    const before = prior.current;
    prior.current = { identity, rects, cardId: latestCard?.id };
    if (
      !before ||
      before.identity !== identity ||
      document.hidden ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      stop();
      prepared.current = undefined;
      return;
    }
    const deck = node
      .querySelector('.deck-stack .card-back')
      ?.getBoundingClientRect();
    let index = 0;
    for (const card of cards) {
      const destination = coordinates.rect(
        rects.get(card.dataset.motionCard!)!,
      );
      const previous = before.rects.get(card.dataset.motionCard!);
      const source = previous && coordinates.rect(previous);
      if (!source && deck) {
        const delta = flightDelta(coordinates.rect(deck), destination);
        const face = card.querySelector<HTMLElement>('.skill-card');
        if (delta && face) {
          const flight = face.cloneNode(true) as HTMLElement;
          flight.classList.add('duel-deal-ghost');
          flight.setAttribute('aria-hidden', 'true');
          Object.assign(flight.style, {
            position: 'fixed',
            left: destination.left + 'px',
            top: destination.top + 'px',
            width: getComputedStyle(card).width,
            height: getComputedStyle(card).height,
            visibility: 'visible',
          });
          node.appendChild(flight);
          face.style.visibility = 'hidden';
          const animation = play(
            flight,
            [
              {
                transform: `translate(${delta.x}px, ${delta.y}px) rotate(-7deg) scale(${delta.scale})`,
                opacity: 0,
              },
              { offset: 0.14, opacity: 1 },
              {
                offset: 0.66,
                transform: `translate(${delta.x * 0.3}px, ${delta.y * 0.3}px) rotate(-1.5deg) scale(1.03)`,
                opacity: 1,
              },
              {
                offset: 0.88,
                transform: 'translate(0, -1px) rotate(0deg) scale(1.012)',
                opacity: 1,
                easing: MOTION.settle,
              },
              { transform: 'none', opacity: 1 },
            ],
            MOTION.drawMs,
            Math.min(index++ * 45, 180),
            MOTION.travel,
          );
          const finish = () => {
            face.style.removeProperty('visibility');
            flight.remove();
          };
          if (animation) animation.finished.then(finish, finish);
          else finish();
        }
      } else if (source && Math.abs(source.left - destination.left) > 1) {
        // Independent translate leaves selected/hover transforms and the resting layout intact.
        play(
          card,
          [
            { translate: `${source.left - destination.left}px 0` },
            { translate: '0 0' },
          ],
          MOTION.reflowMs,
        );
      }
    }
    if (latestCard && latestCard.id !== before.cardId) {
      const stage = node.querySelector<HTMLElement>(
        '.stage-cards .played-card',
      );
      const mine = latestCard.side === me;
      // 起点优先级：刚点/拖的那张手牌 → 手牌区里的一张手牌 → 底部/顶部中央兜底。
      // 这样「自己出的牌」一定从自己这一侧升起，而不是从牌堆斜插进来。
      const recall =
        mine &&
        prepared.current &&
        performance.now() - prepared.current.at < 6000
          ? prepared.current.rect
          : undefined;
      const origin =
        recall ??
        node
          .querySelector<HTMLElement>(
            mine
              ? '.hand-zone .duel-hand-card.sel, .hand-zone .duel-hand-card'
              : '.opponent-hand .mini-card, .opponent-hand',
          )
          ?.getBoundingClientRect();
      prepared.current = undefined;
      if (stage) {
        const preview = stage.closest('.pv');
        if (preview) {
          const ripple = document.createElement('span');
          ripple.className = 'ripple';
          ripple.setAttribute('aria-hidden', 'true');
          for (let i = 0; i < 3; i++)
            ripple.appendChild(document.createElement('i'));
          preview.appendChild(ripple);
          decorations.current.set(
            ripple,
            setTimeout(() => {
              ripple.remove();
              decorations.current.delete(ripple);
            }, 1450),
          );
          const copy = preview.querySelector<HTMLElement>('.pv-copy');
          if (copy)
            play(
              copy,
              [
                { opacity: 0, transform: 'translateY(14px) scale(.96)' },
                { opacity: 1, transform: 'none' },
              ],
              380,
              120,
              MOTION.settle,
            );
        }
        const delta = flightDelta(
          origin ? coordinates.rect(origin) : homeAnchor(node, mine),
          coordinates.rect(stage.getBoundingClientRect()),
        );
        if (delta)
          play(
            stage,
            [
              {
                transform: `translate(${delta.x}px, ${delta.y}px) rotate(${mine ? -6 : 6}deg) scale(${delta.scale})`,
                opacity: 0.3,
              },
              { offset: 0.16, opacity: 1 },
              // 中段走一条很浅的弧线：先抬起来再落到桌面上，比直线更像「甩出一张牌」。
              // 这里刻意只吃掉 65% 的位移，剩下的交给后半程，整段速度才均匀。
              {
                offset: 0.62,
                transform: `translate(${delta.x * 0.35}px, ${delta.y * 0.35}px) rotate(${mine ? -2 : 2}deg) scale(1.028)`,
                opacity: 1,
              },
              {
                offset: 0.86,
                transform: 'translate(0, -2px) rotate(0deg) scale(1.01)',
                opacity: 1,
                // 最后这一段只负责「停稳」，用 settle 收尾，前面长距离仍保持匀速感。
                easing: MOTION.settle,
              },
              { transform: 'none', opacity: 1 },
            ],
            MOTION.cardMs,
            0,
            MOTION.travel,
          );
      }
    }
  }, [identity, handKey, latestCard?.id, me]);
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const reset = () => {
      stop();
      prior.current = undefined;
      prepared.current = undefined;
    };
    window.addEventListener('resize', reset);
    document.addEventListener('visibilitychange', reset);
    media.addEventListener('change', reset);
    return () => {
      reset();
      window.removeEventListener('resize', reset);
      document.removeEventListener('visibilitychange', reset);
      media.removeEventListener('change', reset);
    };
  }, []);
  return (instanceId: string, origin?: DOMRect) => {
    const card = [
      ...(table.current?.querySelectorAll<HTMLElement>('[data-motion-card]') ??
        []),
    ].find((c) => c.dataset.motionCard === instanceId);
    if (origin || card)
      prepared.current = {
        rect: origin || card!.getBoundingClientRect(),
        at: performance.now(),
      };
  };
}
