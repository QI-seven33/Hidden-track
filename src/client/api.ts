export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  token?: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  let value;
  try {
    value = await response.json();
  } catch {
    throw new ApiError(
      '服务响应异常，请稍后重试',
      'INVALID_RESPONSE',
      response.status,
    );
  }
  if (
    !response.ok &&
    response.status === 401 &&
    value.error?.code === 'QQ_LOGIN_REQUIRED'
  )
    dispatchEvent(new Event('music-login-required'));
  if (!response.ok && value.error?.code === 'PLAYTEST_LOGIN_REQUIRED')
    location.reload();
  if (!response.ok)
    throw new ApiError(
      value.error?.message || `请求失败 ${response.status}`,
      value.error?.code || 'HTTP_ERROR',
      response.status,
    );
  return value as T;
}
