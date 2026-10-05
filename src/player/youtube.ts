import { Player, PlayerState } from './types';

interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}

interface YTApi {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, number>;
      events?: { onReady?: () => void };
    },
  ) => YTPlayer;
  PlayerState: { PLAYING: number };
}

interface YTWindow extends Window {
  YT?: YTApi;
  onYouTubeIframeAPIReady?: () => void;
}

let apiPromise: Promise<YTApi> | null = null;

function loadApi(win: YTWindow): Promise<YTApi> {
  if (win.YT?.Player) {
    return Promise.resolve(win.YT);
  }
  apiPromise ??= new Promise<YTApi>((resolve, reject) => {
    const prev = win.onYouTubeIframeAPIReady;

    win.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (win.YT) {
        resolve(win.YT);
      } else {
        reject(new Error('YouTube API did not initialise'));
      }
    };
    const s = win.document.createElement('script');

    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('Could not load the YouTube player API'));
    };
    win.document.head.appendChild(s);
  });

  return apiPromise;
}

export class YouTubePlayer implements Player {
  private yt: YTPlayer | null = null;
  private api: YTApi | null = null;
  private cb: ((s: PlayerState) => void) | null = null;
  private timer: number | null = null;
  private last = '';

  constructor(
    private readonly container: HTMLElement,
    private readonly videoId: string,
    private readonly start: number,
  ) {}

  async load(): Promise<void> {
    const win = this.container.win as YTWindow;

    this.api = await loadApi(win);
    const mount = this.container.createDiv({ cls: 'vn-player-mount' });

    await new Promise<void>((resolve) => {
      this.yt = new this.api!.Player(mount, {
        videoId: this.videoId,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, start: this.start },
        events: { onReady: () => resolve() },
      });
    });
    this.timer = win.setInterval(() => this.poll(), 250);
  }

  private poll(): void {
    const s = this.getState();
    const key = `${s.time.toFixed(1)}|${s.duration}|${s.playing}`;

    if (key !== this.last) {
      this.last = key;
      this.cb?.(s);
    }
  }

  play(): void {
    this.yt?.playVideo();
  }

  pause(): void {
    this.yt?.pauseVideo();
  }

  seek(seconds: number): void {
    this.yt?.seekTo(seconds, true);
  }

  getState(): PlayerState {
    if (!this.yt || !this.api) {
      return { time: 0, duration: 0, playing: false };
    }

    return {
      time: this.yt.getCurrentTime() || 0,
      duration: this.yt.getDuration() || 0,
      playing: this.yt.getPlayerState() === this.api.PlayerState.PLAYING,
    };
  }

  onChange(cb: (s: PlayerState) => void): void {
    this.cb = cb;
  }

  destroy(): void {
    if (this.timer !== null) {
      (this.container.win as YTWindow).clearInterval(this.timer);
    }
    this.yt?.destroy();
    this.yt = null;
    this.container.empty();
  }
}
