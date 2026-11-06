import { useEffect, useState } from 'react';
import { api } from './api';
import { errorText } from './utils';
import type { LyricSection } from '../server/music/lyrics';
export function FullLyrics({ songId }: { songId: string }) {
  const [sections, setSections] = useState<LyricSection[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    setSections([]);
    setError('');
    setLoading(true);
    void api<{ sections: LyricSection[] }>(
      '/music/lyrics?id=' + encodeURIComponent(songId),
    )
      .then((data) => {
        if (current) setSections(data.sections);
      })
      .catch((e) => {
        if (current) setError(errorText(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [songId]);
  return (
    <section className="music-section" id="music-lyrics">
      <header className="music-section-heading">
        <h2>完整歌词</h2>
        <span>原文与中文翻译</span>
      </header>
      {loading ? (
        <p role="status">正在读取歌词…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : !sections.length ? (
        <p className="muted">这个版本本次未返回普通歌词。</p>
      ) : (
        <>
          {!sections.some((section) => section.kind === 'translation') && (
            <p className="muted">这个版本本次未返回中文译文。</p>
          )}
          {sections.map((section) => (
            <details
              open
              key={section.label}
              className="music-chapter"
              data-lyric-kind={section.kind}
            >
              <summary>
                {section.label} · {section.lines.length} 行
              </summary>
              {section.source && (
                <p className="muted">来源：{section.source}</p>
              )}
              <div className="lyric-lines">
                {section.lines.map((line, index) => (
                  <p key={index}>
                    <span className="lyric-clock">
                      {line.seconds !== undefined
                        ? `${Math.floor(line.seconds / 60)}:${String(Math.floor(line.seconds % 60)).padStart(2, '0')}`
                        : ''}
                    </span>
                    <span>{line.text}</span>
                  </p>
                ))}
              </div>
            </details>
          ))}
        </>
      )}
    </section>
  );
}
