import type { MotionRect } from './motion';

/** Client rects include the root rotation; CSS offsets/WAAPI frames do not. */
export function localRect(
  rect: MotionRect,
  frame: MotionRect,
  rotated: boolean,
): MotionRect {
  // DOMRect fields are prototype getters, so object spread loses them.
  if (!rotated)
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  return {
    left: rect.top - frame.top,
    top: frame.left + frame.width - rect.left - rect.width,
    width: rect.height,
    height: rect.width,
  };
}

export function stageCoordinates() {
  const root = document.getElementById('root');
  const rotated =
    !!root &&
    matchMedia('(orientation: portrait) and (max-width: 900px)').matches &&
    getComputedStyle(root).transform !== 'none';
  const frame = root?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  };
  return {
    rect: (rect: MotionRect) => localRect(rect, frame, rotated),
    point: (x: number, y: number) =>
      rotated
        ? { x: y - frame.top, y: frame.left + frame.width - x }
        : { x, y },
    delta: (x: number, y: number) => (rotated ? { x: y, y: -x } : { x, y }),
  };
}
