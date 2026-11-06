// Adapted from the supplied UnifyAPI runtime; only QQ client dependencies remain.
import { AsyncLocalStorage } from 'node:async_hooks';
const requestContext = new AsyncLocalStorage();
function positiveMilliseconds(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
const UPSTREAM_TIMEOUT_MS = positiveMilliseconds(process.env.MUSIC_API_TIMEOUT_MS, 10000);
function upstreamTimeout(value) {
  return Math.min(positiveMilliseconds(value, UPSTREAM_TIMEOUT_MS), UPSTREAM_TIMEOUT_MS);
}
function requestSignal() { return requestContext.getStore()?.signal; }
function withRequestSignal(signal, operation) { return requestContext.run({signal}, operation); }
export default { UPSTREAM_TIMEOUT_MS, upstreamTimeout, requestSignal, withRequestSignal };
