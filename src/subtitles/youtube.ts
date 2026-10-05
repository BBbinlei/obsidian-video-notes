import { parseJson3 } from './parse';
import { Cue } from './types';

export interface Http {
  get(url: string, headers?: Record<string, string>): Promise<string>;
  post(url: string, body: unknown, headers?: Record<string, string>): Promise<string>;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  isTranslatable?: boolean;
}

export interface YouTubeTrack {
  lang: string;
  cues: Cue[];
}

const ANDROID_VERSION = '20.10.38';

function tracksFromPlayerResponse(data: unknown): CaptionTrack[] {
  const caps = (
    data as {
      captions?: {
        playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
      };
    }
  ).captions?.playerCaptionsTracklistRenderer?.captionTracks;

  return Array.isArray(caps) ? caps.filter((t) => typeof t.baseUrl === 'string') : [];
}

/** The player API as the Android app calls it: its caption URLs need no extra token. */
async function tracksViaInnertube(http: Http, id: string): Promise<CaptionTrack[]> {
  const body = {
    context: { client: { clientName: 'ANDROID', clientVersion: ANDROID_VERSION } },
    videoId: id,
  };
  const raw = await http.post('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', body, {
    'User-Agent': `com.google.android.youtube/${ANDROID_VERSION} (Linux; U; Android 11) gzip`,
    'X-YouTube-Client-Name': '3',
    'X-YouTube-Client-Version': ANDROID_VERSION,
  });

  return tracksFromPlayerResponse(JSON.parse(raw));
}

/** Fallback: the caption list embedded in the watch page. */
async function tracksViaWatchPage(http: Http, id: string): Promise<CaptionTrack[]> {
  const html = await http.get(`https://www.youtube.com/watch?v=${id}`, {
    'Accept-Language': 'en-US,en;q=0.9',
  });
  const m = /"captionTracks":(\[.*?\])/.exec(html);

  if (!m?.[1]) {
    return [];
  }
  try {
    return (JSON.parse(m[1]) as CaptionTrack[]).filter((t) => typeof t.baseUrl === 'string');
  } catch {
    return [];
  }
}

/** Manual captions beat auto-generated ones; within that, earlier `prefer` wins. */
export function pickTrack(tracks: CaptionTrack[], prefer: string[]): CaptionTrack | null {
  const rank = (t: CaptionTrack): number => {
    const lang = prefer.findIndex((p) => t.languageCode === p || t.languageCode.startsWith(`${p}-`));

    return (t.kind === 'asr' ? 100 : 0) + (lang < 0 ? 50 : lang);
  };

  return [...tracks].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Every caption track YouTube lists for the video; throws when there is none. */
export async function listYouTubeTracks(http: Http, id: string): Promise<CaptionTrack[]> {
  let tracks: CaptionTrack[] = [];
  let firstError: unknown = null;

  for (const way of [tracksViaInnertube, tracksViaWatchPage]) {
    try {
      tracks = await way(http, id);
    } catch (e) {
      firstError ??= e;
    }
    if (tracks.length) {
      return tracks;
    }
  }
  throw new Error(
    firstError instanceof Error
      ? `取不到这个视频的字幕轨：${firstError.message}`
      : '这个视频没有可用的字幕轨',
  );
}

const jsonUrl = (track: CaptionTrack): string => track.baseUrl.replace(/&fmt=[^&]*/, '') + '&fmt=json3';

export async function fetchYouTubeTrack(
  http: Http,
  id: string,
  prefer: string[] = ['en', 'zh'],
): Promise<YouTubeTrack> {
  const track = pickTrack(await listYouTubeTracks(http, id), prefer);

  if (!track) {
    throw new Error('这个视频没有可用的字幕轨');
  }
  const cues = parseJson3(await http.get(jsonUrl(track)));

  if (!cues.length) {
    throw new Error('YouTube 返回了空字幕（可能需要额外校验），请改用「导入字幕文件」');
  }

  return { lang: track.languageCode, cues };
}

const RATE_LIMITED = 'YouTube 限流了（请求翻译轨太频繁），请过几分钟再试，或改用「翻译」（AI 接口）';

/**
 * YouTube's own machine translation of a caption track (`&tlang=`). It is
 * rate-limited much harder than the plain track: a refusal comes back as an
 * HTML page, which parses to no cues. One retry, then a clear error.
 */
export async function fetchYouTubeTranslation(
  http: Http,
  id: string,
  sourceLang: string,
  tlang: string,
  delay: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Cue[]> {
  const tracks = await listYouTubeTracks(http, id);
  const same = tracks.filter((t) => t.languageCode === sourceLang);
  const track = pickTrack(same.length ? same : tracks, [sourceLang]);

  if (!track) {
    throw new Error('这个视频没有可用的字幕轨');
  }
  if (track.isTranslatable === false) {
    throw new Error('这条字幕轨不支持 YouTube 自动翻译，请改用「翻译」（AI 接口）');
  }
  const url = `${jsonUrl(track)}&tlang=${encodeURIComponent(tlang)}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const cues = parseJson3(await http.get(url));

    if (cues.length) {
      return cues;
    }
    if (attempt === 0) {
      await delay(3000);
    }
  }
  throw new Error(RATE_LIMITED);
}

/**
 * Lines `translated` up with `cues` by start time (nearest within 0.5 s).
 * Returns one string per cue, '' where nothing lines up.
 */
export function alignTranslation(cues: Cue[], translated: Cue[]): string[] {
  const sorted = [...translated].sort((a, b) => a.start - b.start);
  let j = 0;

  return cues.map((c) => {
    while (j + 1 < sorted.length && Math.abs((sorted[j + 1]?.start ?? Infinity) - c.start) <= Math.abs((sorted[j]?.start ?? Infinity) - c.start)) {
      j++;
    }
    const near = sorted[j];

    return near && Math.abs(near.start - c.start) <= 0.5 ? near.text : '';
  });
}
