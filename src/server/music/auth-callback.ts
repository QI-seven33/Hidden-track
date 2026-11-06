import { z } from 'zod';
import { AppError } from '../errors';
const stateSchema = z
  .string()
  .min(20)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);
const codeSchema = z
  .string()
  .min(6)
  .max(2000)
  .regex(/^code-[A-Za-z0-9_-]+$/);
const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Official unionlogin encodes p, then addParam encodes it again. Fastify removes one layer. */
export function webAuthEnvelope(payload: string): unknown {
  const raw = payload.trim();
  return JSON.parse(/^%7b/i.test(raw) ? decodeURIComponent(raw) : raw);
}

/** Accept explicit provider envelopes, never search arbitrary text for a credential. */
export function parseWebAuthResult(
  payload: string,
  stateHint?: string,
): { code: string; state: string } {
  try {
    const outer = object(webAuthEnvelope(payload));
    if (!outer || (outer.ret !== 0 && outer.ret !== '0'))
      throw new AppError(
        401,
        '授权未完成或已取消，可以重试或使用二维码登录',
        'QQ_AUTH_CANCELLED',
      );
    let inner: Record<string, unknown> | undefined;
    if (typeof outer.encryptString === 'string') {
      const text = outer.encryptString.trim();
      inner = text.startsWith('{') ? object(JSON.parse(text)) : { code: text };
    } else inner = object(outer.encryptString);
    inner ??= outer;
    const state = stateSchema.parse(inner.state ?? outer.state ?? stateHint);
    if (
      (stateHint && state !== stateHint) ||
      (outer.state !== undefined && outer.state !== state)
    )
      throw new AppError(403, '授权状态校验失败，请重试', 'QQ_AUTH_STATE');
    return { code: codeSchema.parse(inner.code), state };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, '授权回调格式无效，请重新登录', 'QQ_AUTH_CALLBACK');
  }
}

export function loginReturnPath(value: string | undefined): string {
  if (!value) return '/';
  // Same-origin application paths only, including invitation fragments.
  if (
    !/^\/(?:[?#]|$|me(?:[?#]|$)|r\/[A-Za-z0-9_-]+(?:[?#]|$))/.test(value) ||
    /[\\\r\n]/.test(value)
  )
    throw new AppError(400, '登录返回地址不合法');
  const url = new URL(value, 'https://local.invalid');
  if (url.origin !== 'https://local.invalid')
    throw new AppError(400, '登录返回地址不合法');
  return url.pathname + url.search + url.hash;
}
