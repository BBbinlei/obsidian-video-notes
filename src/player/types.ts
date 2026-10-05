export type VideoSource =
  | { kind: 'youtube'; id: string; start: number }
  | { kind: 'bilibili'; bvid: string; page: number };

export interface PlayerState {
  time: number;
  duration: number;
  playing: boolean;
}

export interface Player {
  /** Mounts the player into the container it was built with. */
  load(): Promise<void>;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  getState(): PlayerState;
  /** Called whenever time/duration/playing changes (polled, ~4/s). */
  onChange(cb: (s: PlayerState) => void): void;
  destroy(): void;
}

const YT_ID_RE = /^[\w-]{11}$/;

function parseStart(raw: string | null): number {
  if (!raw) {
    return 0;
  }
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw);

  if (!m) {
    return 0;
  }

  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Recognises YouTube and Bilibili links; returns null for anything else. */
export function parseVideoUrl(input: string): VideoSource | null {
  let url: URL;

  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1);

    return YT_ID_RE.test(id)
      ? { kind: 'youtube', id, start: parseStart(url.searchParams.get('t')) }
      : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id =
      url.searchParams.get('v') ??
      /^\/(?:embed|shorts|live)\/([\w-]{11})/.exec(url.pathname)?.[1] ??
      '';

    return YT_ID_RE.test(id)
      ? { kind: 'youtube', id, start: parseStart(url.searchParams.get('t')) }
      : null;
  }
  if (host === 'bilibili.com') {
    const bvid = /\/video\/(BV[\w]+)/i.exec(url.pathname)?.[1];

    if (!bvid) {
      return null;
    }
    const p = Number(url.searchParams.get('p') ?? 1);

    return { kind: 'bilibili', bvid, page: Number.isFinite(p) && p > 0 ? p : 1 };
  }

  return null;
}

/** A stable cache key for a video (and part, for Bilibili). */
export function videoKey(src: VideoSource): string {
  return src.kind === 'youtube' ? `yt-${src.id}` : `bv-${src.bvid}-p${src.page}`;
}
