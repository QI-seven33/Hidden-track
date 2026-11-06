import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { stageCoordinates } from './coordinates';
type Drag = {
  id: string;
  x: number;
  y: number;
  pointer: number;
  source: HTMLElement;
  ghost?: HTMLElement;
  rect: DOMRect;
  /** 手指/鼠标这一次到底算拖拽还是横向滚动：只判定一次。 */
  decided: boolean;
  /** 触摸端横向意图：卡上 touch-action 已是 none，浏览器不会滚，自己滚。 */
  scrollMode?: boolean;
};
export function insideStage(
  x: number,
  y: number,
  r: { left: number; right: number; top: number; bottom: number },
) {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
/** No real card or resource moves before the server accepts a command. */
export function useHandPointer({
  table,
  stage,
  identity,
  canPlay,
  submit,
  select,
  reject,
}: {
  table: RefObject<HTMLElement | null>;
  stage: RefObject<HTMLElement | null>;
  identity: string;
  canPlay: (id: string) => boolean;
  submit: (id: string, origin?: DOMRect) => void;
  select: (id: string) => void;
  /** 拖了打不出的牌：回位 + 抖一下。点按不触发，避免抢掉选中的反馈。 */
  reject: (id: string) => void;
}) {
  const drag = useRef<Drag | undefined>(undefined),
    suppressed = useRef(0);
  const latest = useRef({ canPlay, submit, select, reject });
  latest.current = { canPlay, submit, select, reject };
  /** Touch tap selection happens on pointerup; cancelled gestures never select or submit. */
  const isTap = (d: Drag, e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'touch') return false;
    const dx = e.clientX - d.x,
      dy = e.clientY - d.y;
    return Math.hypot(dx, dy) < 6;
  };
  const tapSelect = (id: string) => {
    // 400ms 内的 click 一律吞掉，避免 select 是 toggle 被点按+click 双触发抵消。
    suppressed.current = performance.now() + 400;
    latest.current.select(id);
  };
  const cleanup = () => {
    const d = drag.current;
    drag.current = undefined;
    d?.ghost?.remove();
    d?.source.classList.remove('dragging');
    stage.current?.classList.remove('drop-on');
    if (d && d.source.hasPointerCapture?.(d.pointer))
      d.source.releasePointerCapture(d.pointer);
  };
  useEffect(() => {
    const hide = () => {
      if (document.hidden) cleanup();
    };
    window.addEventListener('resize', cleanup);
    document.addEventListener('visibilitychange', hide);
    return () => {
      cleanup();
      window.removeEventListener('resize', cleanup);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [identity]);
  return {
    down(e: ReactPointerEvent<HTMLElement>, id: string) {
      if (!e.isPrimary || e.button !== 0) return;
      cleanup();
      // Capture at the button, not the inner image's implicit touch target.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      drag.current = {
        id,
        x: e.clientX,
        y: e.clientY,
        pointer: e.pointerId,
        source: e.currentTarget,
        rect: e.currentTarget.getBoundingClientRect(),
        decided: false,
      };
    },
    move(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d || d.pointer !== e.pointerId) return;
      // 打不出的牌也允许起手跟手：拖出去再弹回来，比"拖不动"更容易懂。
      // 只有真的落下时才由 up() 判断能不能出。
      const playable = latest.current.canPlay(d.id);
      const coordinates = stageCoordinates();
      const { x: dx, y: dy } = coordinates.delta(
        e.clientX - d.x,
        e.clientY - d.y,
      );
      if (!d.decided && !d.ghost) {
        // 触摸端先看方向：横向意图当成滚动手牌（卡上 touch-action: none，
        // 浏览器不会接手，必须自己滚），纵向意图才当成拖拽。
        // 判断阈值给小一点，手指稍微一动就开始拖，避免"点一下没反应"。
        const travel = Math.hypot(dx, dy);
        if (travel < 6) return;
        const hand = d.source.closest('.hand');
        if (
          e.pointerType === 'touch' &&
          hand &&
          hand.scrollWidth > hand.clientWidth + 1 &&
          Math.abs(dx) > Math.abs(dy) * 1.15
        ) {
          d.decided = true;
          d.scrollMode = true;
          // 接管指针，保证后续 move 都送到卡片上。
          try {
            d.source.setPointerCapture(e.pointerId);
          } catch {
            /* 某些浏览器会拒绝，忽略即可 */
          }
          return;
        }
        d.decided = true;
        // 立刻接管指针，避免浏览器在滚动与拖拽之间反复取消。
        try {
          d.source.setPointerCapture(e.pointerId);
        } catch {
          /* 某些浏览器会拒绝，忽略即可 */
        }
        const ghost = d.source.cloneNode(true) as HTMLElement;
        ghost.removeAttribute('data-motion-card');
        ghost.removeAttribute('aria-pressed');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.className =
          'duel-drag-ghost' +
          (d.source.classList.contains('unavailable') ? ' unavailable' : '');
        Object.assign(ghost.style, {
          width: getComputedStyle(d.source).width,
          height: getComputedStyle(d.source).height,
        });
        table.current?.appendChild(ghost);
        d.ghost = ghost;
        d.source.classList.add('dragging');
      }
      if (d.scrollMode) {
        // 跟手横向滚动手牌：每次事件按位移增量滚，并刷新基准点。
        const hand = d.source.closest('.hand');
        if (hand) hand.scrollLeft -= dx;
        d.x = e.clientX;
        d.y = e.clientY;
        return;
      }
      if (!d.ghost) return;
      e.preventDefault();
      const point = coordinates.point(e.clientX, e.clientY);
      const size = coordinates.rect(d.rect);
      Object.assign(d.ghost.style, {
        left: point.x - size.width / 2 + 'px',
        top: point.y - size.height / 2 + 'px',
      });
      const r = stage.current?.getBoundingClientRect();
      // 打不出的牌不点亮牌桌落点，避免"好像能放"的错觉。
      stage.current?.classList.toggle(
        'drop-on',
        playable && !!r && insideStage(e.clientX, e.clientY, r),
      );
    },
    up(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d || d.pointer !== e.pointerId) return;
      if (d.scrollMode) {
        // 滚动手势不算点击，落点上的卡不要被选中。
        suppressed.current = performance.now() + 400;
        cleanup();
        return;
      }
      if (!d.ghost) {
        cleanup();
        // 触摸点按兜底：不依赖 click 事件，X5 下也能稳定选中/取消。
        if (isTap(d, e)) tapSelect(d.id);
        return;
      }
      suppressed.current = performance.now() + 400;
      const r = stage.current?.getBoundingClientRect(),
        origin = d.ghost.getBoundingClientRect();
      const accepted =
        !!r &&
        insideStage(e.clientX, e.clientY, r) &&
        latest.current.canPlay(d.id);
      const rejected = !accepted && !latest.current.canPlay(d.id);
      const ghost = d.ghost;
      d.ghost = undefined;
      cleanup();
      if (accepted) {
        ghost.remove();
        latest.current.submit(d.id, origin);
      } else if (
        ghost.animate &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        // 打不出的牌拖出去后回位时抖一下；能出但没放到牌桌上则安静回位。
        if (rejected) latest.current.reject(d.id);
        const coordinates = stageCoordinates();
        const from = coordinates.rect(origin),
          to = coordinates.rect(d.rect);
        const a = ghost.animate(
          [
            { transform: 'rotate(-3deg)' },
            {
              transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) rotate(0deg)`,
              opacity: 0.4,
            },
          ],
          { duration: 180, easing: 'ease-out' },
        );
        a.finished.then(
          () => ghost.remove(),
          () => ghost.remove(),
        );
      } else {
        if (rejected) latest.current.reject(d.id);
        ghost.remove();
      }
    },
    cancel() {
      cleanup();
    },
    lost(e: ReactPointerEvent<HTMLElement>) {
      // An image losing implicit capture bubbles here when the button takes over.
      // Only cancellation of the button's own capture ends this drag.
      if (
        e.target === e.currentTarget &&
        drag.current?.pointer === e.pointerId &&
        !e.currentTarget.hasPointerCapture(e.pointerId)
      )
        cleanup();
    },
    click(id: string) {
      if (performance.now() > suppressed.current) latest.current.select(id);
    },
  };
}
