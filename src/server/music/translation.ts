import { TextDecoder } from 'node:util';
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
/** crypt=0 requests ordinary text. Base64 is transport encoding here, not QRC
 * decryption. Refuse encrypted replies, a different recording, and non-LRC blobs. */
export function publicTranslation(
  payload: unknown,
  expectedId: string,
): string | undefined {
  const outer = record(payload),
    wrapper = record(outer.song),
    data = record(wrapper.data);
  const id =
    typeof data.songID === 'number' && Number.isSafeInteger(data.songID)
      ? String(data.songID)
      : typeof data.songID === 'string'
        ? data.songID
        : '';
  if (
    outer.code !== 0 ||
    wrapper.code !== 0 ||
    id !== expectedId ||
    data.crypt !== 0 ||
    data.qrc !== 0 ||
    typeof data.trans !== 'string' ||
    data.trans.length > 500_000
  )
    return;
  let content = data.trans.trim();
  if (!/\[\d{1,3}:\d{2}/.test(content)) {
    if (
      !content ||
      content.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(content)
    )
      return;
    const bytes = Buffer.from(content, 'base64');
    if (bytes.toString('base64') !== content) return;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return;
    }
  }
  return /\[\d{1,3}:\d{2}/.test(content) && /[\u4e00-\u9fff]/.test(content)
    ? content
    : undefined;
}
export async function readPublicTranslation(
  transport: typeof fetch,
  id: string,
  mid?: string,
): Promise<string | undefined> {
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return;
  try {
    const response = await transport('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Referer: 'https://y.qq.com/',
      },
      body: JSON.stringify({
        comm: { ct: 19, cv: 0 },
        song: {
          module: 'music.musichallSong.PlayLyricInfo',
          method: 'GetPlayLyricInfo',
          param: {
            songMID: mid || '',
            songID: Number(id),
            crypt: 0,
            qrc: 0,
            roma: 0,
            trans: 1,
            trans_t: 0,
            type: -1,
            interval: 0,
            ct: 19,
            cv: 0,
          },
        },
      }),
      signal: AbortSignal.timeout(6000),
    });
    const raw = await response.text();
    if (response.ok && raw.length <= 1_000_000)
      return publicTranslation(JSON.parse(raw), id);
  } catch {
    /* Optional translation must not hide available original lyrics. */
  }
}
