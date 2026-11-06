export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '请求失败';

/**
 * 站内跳转：只改地址栏并通知 App 重新取路径。
 * 之前用 location.href 会整页重载，重载过程中先渲染一遍旧版外壳，看起来像“旧 UI 闪了一下”。
 */
export function goto(path: string, replace = false) {
  if (location.pathname + location.search + location.hash === path) return;
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * 复制文本。
 * navigator.clipboard 只在安全上下文（HTTPS / localhost）可用，
 * 纯 IP + http 的演示环境下它是 undefined，需要退回隐藏 textarea 方案。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 继续走降级方案 */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    Object.assign(area.style, {
      position: 'fixed',
      top: '-1000px',
      left: '-1000px',
      opacity: '0',
      // iOS 上字号小于 16px 会触发缩放，这里避开。
      fontSize: '16px',
    });
    document.body.appendChild(area);
    const selection = document.getSelection();
    const previous = selection?.rangeCount ? selection.getRangeAt(0) : null;
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    area.remove();
    if (previous && selection) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
    return ok;
  } catch {
    return false;
  }
}
