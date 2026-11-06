import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

const code = transformSync(
  readFileSync(new URL('../src/client/stage.ts', import.meta.url), 'utf8'),
  { loader: 'ts', format: 'cjs' },
).code;
function browser(withKeyboard = true, width = 390, height = 844) {
  const values = new Map<string, string>(),
    attrs = new Set<string>();
  class Element {
    tagName = 'INPUT';
    isContentEditable = false;
    matches() {
      return true;
    }
    closest() {
      return null;
    }
    parentElement = null;
  }
  const root = {
    style: {
      setProperty: (k: string, v: string) => values.set(k, v),
      removeProperty: (k: string) => values.delete(k),
    },
    setAttribute: (k: string) => attrs.add(k),
    removeAttribute: (k: string) => attrs.delete(k),
    hasAttribute: (k: string) => attrs.has(k),
  };
  const document = Object.assign(new EventTarget(), {
    documentElement: root,
    activeElement: new Element() as Element | null,
    body: {},
    querySelector: (q: string) => (q.startsWith('meta') ? meta : null),
  });
  const meta = {
    content: 'width=device-width, interactive-widget=overlays-content',
  };
  const viewport = Object.assign(new EventTarget(), {
    height,
    offsetTop: 0,
  });
  const keyboard = Object.assign(new EventTarget(), {
    overlaysContent: false,
    boundingRect: { height: 0 },
  });
  const window = Object.assign(new EventTarget(), { visualViewport: viewport });
  const scheduled: (() => void)[] = [];
  const exports: { installStageMetrics?: () => void } = {};
  const context = {
    module: { exports },
    exports,
    window,
    document,
    HTMLElement: Element,
    navigator: withKeyboard ? { virtualKeyboard: keyboard } : {},
    innerWidth: width,
    innerHeight: height,
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (fn: () => void) => fn(),
    setTimeout: (fn: () => void) => scheduled.push(fn),
    addEventListener: window.addEventListener.bind(window),
  };
  runInNewContext(code, context);
  context.module.exports.installStageMetrics!();
  const sync = () => window.dispatchEvent(new Event('resize'));
  return {
    values,
    attrs,
    document,
    viewport,
    keyboard,
    meta,
    context,
    sync,
    flush: () => {
      for (const fn of scheduled.splice(0)) fn();
    },
  };
}

test('overlay keyboard geometry freezes the stage even when neither viewport resizes', () => {
  const b = browser();
  b.keyboard.boundingRect.height = 320;
  b.keyboard.dispatchEvent(new Event('geometrychange'));
  assert.equal(b.values.get('--kb'), '320px');
  assert.equal(b.values.get('--stage-h'), '844px');
  assert.equal(b.values.get('--stage-w'), '390px');
  assert.ok(b.attrs.has('data-kb'));
  b.keyboard.boundingRect.height = 0;
  b.keyboard.dispatchEvent(new Event('geometrychange'));
  assert.ok(!b.attrs.has('data-kb'));
});
test('without keyboard geometry the viewport remains measurable on an HTTP origin', () => {
  const b = browser(false);
  assert.match(b.meta.content, /interactive-widget=resizes-visual/);
  b.viewport.height = 524;
  b.viewport.offsetTop = 20;
  b.viewport.dispatchEvent(new Event('scroll'));
  assert.equal(b.values.get('--kb'), '300px');
  assert.equal(b.values.get('--stage-h'), '844px');
});
test('layout-resizing keyboards do not compress the stage during focus or blur', () => {
  const b = browser(false);
  b.context.innerHeight = 524;
  b.viewport.height = 524;
  b.sync();
  b.document.activeElement = null;
  b.document.dispatchEvent(new Event('focusout'));
  b.flush();
  assert.equal(b.values.get('--stage-h'), '844px');
  assert.equal(b.values.get('--kb'), '320px');
  b.context.innerHeight = 844;
  b.viewport.height = 844;
  b.sync();
  assert.equal(b.values.get('--stage-h'), '844px');
  assert.ok(!b.attrs.has('data-kb'));
});
test('address bar motion below the keyboard threshold does not freeze the stage', () => {
  const b = browser(false);
  b.context.innerHeight = 790;
  b.viewport.height = 790;
  b.sync();
  assert.ok(!b.attrs.has('data-kb'));
  assert.equal(b.values.get('--stage-h'), '790px');
});
test('viewport changes without a focused editable control are normal layout updates', () => {
  const b = browser(false);
  b.document.activeElement = null;
  b.context.innerHeight = 600;
  b.viewport.height = 600;
  b.sync();
  assert.ok(!b.attrs.has('data-kb'));
  assert.equal(b.values.get('--stage-h'), '600px');
});

test('landscape overlay keyboards publish the visible region without resizing the table', () => {
  const b = browser(true, 844, 390);
  b.keyboard.boundingRect.height = 230;
  b.keyboard.dispatchEvent(new Event('geometrychange'));
  assert.equal(b.values.get('--stage-h'), '390px');
  assert.equal(b.values.get('--kb-visible-h'), '160px');
  assert.equal(b.values.get('--kb-top'), '0px');
});
test('landscape visual viewport panning is included in the input surface position', () => {
  const b = browser(false, 844, 390);
  b.viewport.height = 140;
  b.viewport.offsetTop = 20;
  b.viewport.dispatchEvent(new Event('resize'));
  assert.equal(b.values.get('--kb'), '230px');
  assert.equal(b.values.get('--kb-visible-h'), '140px');
  assert.equal(b.values.get('--kb-top'), '20px');
  b.document.activeElement = null;
  b.viewport.height = 390;
  b.viewport.offsetTop = 0;
  b.sync();
  assert.equal(b.values.get('--kb-visible-h'), undefined);
  assert.equal(b.values.get('--kb-top'), undefined);
});
