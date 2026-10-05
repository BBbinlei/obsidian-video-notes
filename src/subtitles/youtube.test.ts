import { describe, expect, it } from 'vitest';
import { Http, alignTranslation, fetchYouTubeTrack, fetchYouTubeTranslation, pickTrack } from './youtube';

const tr = (languageCode: string, kind?: string) => ({ baseUrl: `https://x/${languageCode}?a=1&fmt=srv3`, languageCode, kind });

describe('pickTrack', () => {
  it('prefers manual over auto-generated', () => {
    expect(pickTrack([tr('en', 'asr'), tr('fr')], ['en'])?.languageCode).toBe('fr');
  });

  it('prefers the listed language among manual tracks', () => {
    expect(pickTrack([tr('de'), tr('en-GB')], ['en'])?.languageCode).toBe('en-GB');
  });

  it('returns null for none', () => {
    expect(pickTrack([], ['en'])).toBeNull();
  });
});

describe('fetchYouTubeTrack', () => {
  const json3 = JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'Hi' }] }] });

  it('uses the player API track and requests json3', async () => {
    const urls: string[] = [];
    const http: Http = {
      post: () => Promise.resolve(JSON.stringify({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [tr('en')] } } })),
      get: (u) => {
        urls.push(u);

        return Promise.resolve(json3);
      },
    };
    const r = await fetchYouTubeTrack(http, 'abcdefghijk');

    expect(r).toEqual({ lang: 'en', cues: [{ start: 1, end: 2, text: 'Hi' }] });
    expect(urls[0]).toBe('https://x/en?a=1&fmt=json3');
  });

  it('falls back to the watch page when the player API fails', async () => {
    const http: Http = {
      post: () => Promise.reject(new Error('blocked')),
      get: (u) =>
        Promise.resolve(u.includes('watch?v=') ? `..."captionTracks":${JSON.stringify([tr('en')])},"x":1` : json3),
    };

    expect((await fetchYouTubeTrack(http, 'abcdefghijk')).cues).toHaveLength(1);
  });

  it('explains an empty subtitle body', async () => {
    const http: Http = {
      post: () => Promise.resolve(JSON.stringify({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [tr('en')] } } })),
      get: () => Promise.resolve(''),
    };

    await expect(fetchYouTubeTrack(http, 'abcdefghijk')).rejects.toThrow('导入字幕文件');
  });

  it('reports a video without caption tracks', async () => {
    const http: Http = { post: () => Promise.resolve('{}'), get: () => Promise.resolve('<html></html>') };

    await expect(fetchYouTubeTrack(http, 'abcdefghijk')).rejects.toThrow('没有可用的字幕轨');
  });
});

describe('fetchYouTubeTranslation', () => {
  const tracksJson = JSON.stringify({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [tr('en')] } } });
  const zh = JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: '你好' }] }] });
  const noDelay = (): Promise<void> => Promise.resolve();

  it('asks for the translated track with tlang', async () => {
    const urls: string[] = [];
    const http: Http = {
      post: () => Promise.resolve(tracksJson),
      get: (u) => {
        urls.push(u);

        return Promise.resolve(zh);
      },
    };
    const cues = await fetchYouTubeTranslation(http, 'abcdefghijk', 'en', 'zh-Hans', noDelay);

    expect(cues[0]?.text).toBe('你好');
    expect(urls[0]).toBe('https://x/en?a=1&fmt=json3&tlang=zh-Hans');
  });

  it('retries once after a rate-limit page, then succeeds', async () => {
    let n = 0;
    let waited = 0;
    const http: Http = {
      post: () => Promise.resolve(tracksJson),
      get: () => Promise.resolve(n++ === 0 ? '<html>Sorry...</html>' : zh),
    };
    const cues = await fetchYouTubeTranslation(http, 'abcdefghijk', 'en', 'zh-Hans', (ms) => {
      waited = ms;

      return Promise.resolve();
    });

    expect(cues).toHaveLength(1);
    expect(waited).toBe(3000);
  });

  it('gives a clear error when it stays rate-limited', async () => {
    const http: Http = { post: () => Promise.resolve(tracksJson), get: () => Promise.resolve('<html>Sorry...</html>') };

    await expect(fetchYouTubeTranslation(http, 'abcdefghijk', 'en', 'zh-Hans', noDelay)).rejects.toThrow('限流');
  });

  it('refuses a track that cannot be translated', async () => {
    const body = JSON.stringify({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ ...tr('en'), isTranslatable: false }] } } });
    const http: Http = { post: () => Promise.resolve(body), get: () => Promise.resolve(zh) };

    await expect(fetchYouTubeTranslation(http, 'abcdefghijk', 'en', 'zh-Hans', noDelay)).rejects.toThrow('不支持');
  });
});

describe('alignTranslation', () => {
  const c = (start: number, text: string) => ({ start, end: start + 1, text });

  it('matches exact starts', () => {
    expect(alignTranslation([c(1, 'a'), c(5, 'b')], [c(1, 'A'), c(5, 'B')])).toEqual(['A', 'B']);
  });

  it('matches within half a second', () => {
    expect(alignTranslation([c(1, 'a')], [c(1.3, 'A')])).toEqual(['A']);
  });

  it('leaves a blank where nothing lines up', () => {
    expect(alignTranslation([c(1, 'a'), c(9, 'b')], [c(1, 'A'), c(20, 'Z')])).toEqual(['A', '']);
  });

  it('picks the nearer of two neighbours', () => {
    expect(alignTranslation([c(5, 'x')], [c(4.7, 'near'), c(5.4, 'far')])).toEqual(['near']);
  });
});
