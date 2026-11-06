/** Physical viewport metrics for the rigid, rotated mobile stage. */
let installed = false;
type KeyboardGeometry = EventTarget & {
  overlaysContent: boolean;
  boundingRect: DOMRectReadOnly;
};
const isField = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLElement &&
  (el.matches(
    'input:not([type=checkbox]):not([type=radio]), textarea, select',
  ) ||
    el.isContentEditable);

export function installStageMetrics() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const root = document.documentElement;
  const vv = window.visualViewport;
  const keyboard = (
    navigator as Navigator & { virtualKeyboard?: KeyboardGeometry }
  ).virtualKeyboard;
  let overlay = false;
  if (keyboard) {
    try {
      keyboard.overlaysContent = true;
      overlay = keyboard.overlaysContent;
    } catch {
      /* Some embedded browsers expose a read-only API. */
    }
  }
  // Without geometry events, overlays-content would hide the keyboard from
  // both viewport APIs (including on the production insecure HTTP origin).
  if (!overlay) {
    const meta = document.querySelector<HTMLMetaElement>('meta[name=viewport]');
    if (meta)
      meta.content = meta.content.replace(
        'interactive-widget=overlays-content',
        'interactive-widget=resizes-visual',
      );
  }
  let last = '';
  let baseHeight = Math.round(innerHeight);
  let covered = 0;
  const shifted = new Set<HTMLElement>();
  let guessCard: HTMLElement | null = null;
  const revealField = () => {
    for (const panel of shifted) panel.style.removeProperty('--kb-shift');
    shifted.clear();
    const field = document.activeElement;
    if (!covered || !isField(field)) return;
    const portrait = matchMedia(
      '(orientation: portrait) and (max-width: 900px)',
    ).matches;
    if (!portrait) {
      const top = vv?.offsetTop || 0;
      const bottom =
        top + Math.min(vv?.height || baseHeight, baseHeight - covered);
      let parent = field.parentElement;
      while (parent && parent !== root && parent !== document.body) {
        const style = getComputedStyle(parent);
        if (
          /(auto|scroll)/.test(style.overflowY) &&
          parent.scrollHeight > parent.clientHeight
        ) {
          const box = parent.getBoundingClientRect(),
            target = field.getBoundingClientRect();
          const high = Math.max(top + 8, box.top),
            low = Math.min(bottom - 8, box.bottom);
          const delta =
            target.bottom > low
              ? target.bottom - low
              : target.top < high
                ? target.top - high
                : 0;
          parent.scrollBy({ top: delta, behavior: 'instant' });
          break;
        }
        parent = parent.parentElement;
      }
      return;
    }
    if (field.closest('.guess-dialog-new')) return;
    const limit = baseHeight - covered - 12;
    const panel = field.closest<HTMLElement>(
      'dialog[open] > *, .mg-sheet, .mg-exit-card, .mg-search-wrap',
    );
    if (panel) {
      const target = field.getBoundingClientRect();
      const shift = Math.max(-covered, Math.min(0, limit - target.bottom));
      panel.style.setProperty('--kb-shift', `${shift}px`);
      shifted.add(panel);
    }
    // Scroll only the nearest local scroller, never the document. In the
    // rotated stage, physical vertical motion is local horizontal scrolling.
    let parent = field.parentElement;
    while (parent && parent !== root && parent !== document.body) {
      const style = getComputedStyle(parent);
      if (
        /(auto|scroll)/.test(style.overflowX) &&
        parent.scrollWidth > parent.clientWidth
      ) {
        parent.scrollBy({
          left: Math.max(0, field.getBoundingClientRect().bottom - limit),
          behavior: 'instant',
        });
        break;
      }
      parent = parent.parentElement;
    }
  };
  const sync = () => {
    const focused = isField(document.activeElement);
    const byVisual = vv ? baseHeight - vv.height - vv.offsetTop : 0;
    const byLayout = baseHeight - innerHeight;
    const byGeometry = overlay ? keyboard?.boundingRect.height || 0 : 0;
    const delta = Math.round(Math.max(byVisual, byLayout, byGeometry));
    // Hold the freeze through blur until the closing keyboard has finished.
    covered = (focused || covered > 0) && delta > 100 ? delta : 0;
    if (covered) {
      if (!root.hasAttribute('data-kb')) {
        guessCard = document.querySelector<HTMLElement>('.guess-dialog-new');
        if (guessCard)
          guessCard.style.setProperty(
            '--kb-card-height',
            `${guessCard.offsetHeight}px`,
          );
      }
      root.style.setProperty('--kb', `${covered}px`);
      root.style.setProperty(
        '--kb-visible-h',
        `${Math.max(0, Math.round(Math.min(vv?.height || baseHeight, baseHeight - covered)))}px`,
      );
      root.style.setProperty('--kb-top', `${Math.round(vv?.offsetTop || 0)}px`);
      root.setAttribute('data-kb', '');
      requestAnimationFrame(revealField);
      return;
    }
    root.removeAttribute('data-kb');
    root.style.removeProperty('--kb');
    root.style.removeProperty('--kb-visible-h');
    root.style.removeProperty('--kb-top');
    guessCard?.style.removeProperty('--kb-card-height');
    guessCard = null;
    for (const panel of shifted) panel.style.removeProperty('--kb-shift');
    shifted.clear();
    const w = Math.round(innerWidth),
      h = Math.round(innerHeight);
    baseHeight = h;
    const key = `${w}x${h}`;
    if (key === last) return;
    last = key;
    root.style.setProperty('--stage-w', `${w}px`);
    root.style.setProperty('--stage-h', `${h}px`);
  };
  sync();
  addEventListener('resize', sync, { passive: true });
  vv?.addEventListener('resize', sync, { passive: true });
  vv?.addEventListener('scroll', sync, { passive: true });
  keyboard?.addEventListener('geometrychange', sync);
  addEventListener('orientationchange', () => {
    covered = 0;
    const rotate = () => {
      baseHeight = Math.round(innerHeight);
      sync();
    };
    requestAnimationFrame(rotate);
    setTimeout(rotate, 120);
  });
  document.addEventListener('focusin', () => {
    sync();
    setTimeout(sync, 260);
  });
  document.addEventListener('focusout', () => {
    setTimeout(sync, 120);
    setTimeout(sync, 360);
  });
}
