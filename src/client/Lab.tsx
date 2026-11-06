import { useState } from 'react';
import { api } from './api';
import { errorText } from './utils';
import type { Meta } from './types';
import type { ProbeResult } from '../shared/protocol';
export function Lab({ meta }: { meta: Meta }) {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<Record<string, unknown>>();
  const [capability, setCapability] = useState('search');
  const [query, setQuery] = useState('周杰伦');
  const [songMid, setSongMid] = useState('');
  const [songId, setSongId] = useState('');
  const [albumMid, setAlbumMid] = useState('');
  const [singerMid, setSingerMid] = useState('');
  const [result, setResult] = useState<ProbeResult>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(
        (
          await api<{ result: ProbeResult }>(
            '/admin/probe',
            {
              capability,
              query,
              ...(songMid ? { songMid } : {}),
              ...(songId ? { songId } : {}),
              ...(albumMid ? { albumMid } : {}),
              ...(singerMid ? { singerMid } : {}),
            },
            token,
          )
        ).result,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="lab">
      <section className="panel">
        <span className="eyebrow">开发者接口实验室</span>
        <h1>让真实返回决定能力。</h1>
        <p>
          管理令牌来自服务端 .env 的 ADMIN_TOKEN。appkey
          只在服务端填写，此处不会索取或展示。
        </p>
        <label>
          管理令牌
          <input
            autoComplete="off"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <button
          onClick={() =>
            void api<Record<string, unknown>>('/admin/status', undefined, token)
              .then(setStatus)
              .catch((e) => setError(errorText(e)))
          }
        >
          检查服务配置
        </button>
        {status && <pre>{JSON.stringify(status, null, 2)}</pre>}
      </section>
      <section className="panel">
        <h2>逐项探测</h2>
        <label>
          能力
          <select
            value={capability}
            onChange={(e) => setCapability(e.target.value)}
          >
            {meta.capabilities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.login ? ' · 需用户授权' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          搜索词
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label>
          歌曲数字 ID（副歌接口必需）
          <input value={songId} onChange={(e) => setSongId(e.target.value)} />
        </label>
        <label>
          歌曲 MID
          <input value={songMid} onChange={(e) => setSongMid(e.target.value)} />
        </label>
        <label>
          专辑 MID
          <input
            value={albumMid}
            onChange={(e) => setAlbumMid(e.target.value)}
          />
        </label>
        <label>
          歌手 MID
          <input
            value={singerMid}
            onChange={(e) => setSingerMid(e.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={busy || !token}
          onClick={() => void run()}
        >
          {busy ? '等待上游返回…' : '发送一次真实请求'}
        </button>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {result && (
          <>
            <h3>{result.status}</h3>
            <p>{result.message}</p>
            <p>
              {result.elapsedMs} ms · 业务码 {result.code ?? '未请求'}
            </p>
            <details open>
              <summary>实际返回字段</summary>
              <pre>{result.fields.join('\n') || '没有可记录的字段'}</pre>
            </details>
            {result.sample !== undefined && (
              <details>
                <summary>脱敏样本</summary>
                <pre>{JSON.stringify(result.sample, null, 2)}</pre>
              </details>
            )}
          </>
        )}
        <p className="muted">
          未配置、无权限、需要登录、网络失败与成功分别记录。播放地址和票据不写入探测记录。歌曲百科仍标为未确认。
        </p>
      </section>
    </div>
  );
}
