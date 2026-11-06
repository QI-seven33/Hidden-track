import { useEffect, useRef } from 'react';

const layers: (() => void)[] = [];

/** Div-based sheets need the same Back behavior as native <dialog> elements. */
export function useBackLayer(close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    const handler = () => latest.current();
    layers.push(handler);
    return () => {
      const i = layers.indexOf(handler);
      if (i >= 0) layers.splice(i, 1);
    };
  }, []);
}

export function hasBackLayer(): boolean {
  const focused = document.activeElement;
  return Boolean(
    (focused instanceof HTMLElement &&
      focused.matches('input, textarea, select, [contenteditable="true"]')) ||
    document.querySelector('dialog[open]') ||
    layers.length,
  );
}

export function dismissBackLayer(): boolean {
  const focused = document.activeElement;
  if (
    focused instanceof HTMLElement &&
    focused.matches('input, textarea, select, [contenteditable="true"]')
  ) {
    focused.blur();
    return true;
  }
  // Native modal dialogs live in the top layer, above ordinary DOM sheets.
  const dialogs = [
    ...document.querySelectorAll<HTMLDialogElement>('dialog[open]'),
  ];
  const dialog = dialogs.at(-1);
  if (dialog) {
    if (dialog.dispatchEvent(new Event('cancel', { cancelable: true })))
      dialog.close();
    return true;
  }
  const close = layers.at(-1);
  if (!close) return false;
  close();
  return true;
}
