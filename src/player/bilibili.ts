import { Player, PlayerState } from './types';

// SPIKE: Bilibili's page is cross-origin, so we load it in an Electron
// <webview> and read/drive its <video> through executeJavaScript. Needs
// desktop Obsidian; unverified until tried against a real video.

/** One persistent session shared by the player and the login window. */
export const BILIBILI_PARTITION = 'persist:video-notes-bilibili';

interface WebviewElement extends HTMLElement {
  executeJavaScript(code: string): Promise<unknown>;
  insertCSS(css: string): Promise<string>;
}

// The full video page is the only Bilibili player that honours the login (the
// embed one always behaves like a guest), so load it and show just the player.
const PLAYER_ONLY_CSS = `
html, body { overflow: hidden !important; background: #000 !important; }
#playerWrap, .player-wrap { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 2147483647 !important; background: #000 !important; margin: 0 !important; padding: 0 !important; }
#bilibili-player, #bilibili-player .bpx-player-container, .bpx-player-container { width: 100% !important; height: 100% !important; }
#biliMainHeader, .bili-header, #bili-header-container, .fixed-sidenav-storage, .bili-feedback { display: none !important; }
`;

const READ_JS = `(() => {
  const v = document.querySelector('video');
  return v ? { t: v.currentTime, d: v.duration || 0, p: !v.paused } : null;
})()`;

export class BilibiliPlayer implements Player {
  private wv: WebviewElement | null = null;
  private ready = false;
  private cb: ((s: PlayerState) => void) | null = null;
  private timer: number | null = null;
  private busy = false;
  private state: PlayerState = { time: 0, duration: 0, playing: false };

  constructor(
    private readonly container: HTMLElement,
    private readonly bvid: string,
    private readonly page: number,
  ) {}

  async load(): Promise<void> {
    const wv = this.container.doc.createElement('webview') as WebviewElement;

    wv.addClass('vn-player-mount');
    wv.setAttribute('partition', BILIBILI_PARTITION);
    wv.setAttribute(
      'src',
      `https://www.bilibili.com/video/${this.bvid}/?p=${this.page}`,
    );
    this.container.appendChild(wv);
    this.wv = wv;
    await new Promise<void>((resolve) => {
      wv.addEventListener(
        'dom-ready',
        () => {
          this.ready = true;
          resolve();
        },
        { once: true },
      );
    });
    const fit = (): void => {
      void this.wv
        ?.insertCSS(PLAYER_ONLY_CSS)
        .then(() => this.run(`window.dispatchEvent(new Event('resize'))`))
        .catch(() => undefined);
    };

    fit();
    wv.addEventListener('did-finish-load', fit);
    wv.addEventListener('did-navigate-in-page', fit);
    this.timer = this.container.win.setInterval(() => void this.poll(), 300);
  }

  private async run(code: string): Promise<unknown> {
    if (!this.wv || !this.ready) {
      return null;
    }
    try {
      return await this.wv.executeJavaScript(code);
    } catch {
      return null;
    }
  }

  private async poll(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    const r = (await this.run(READ_JS)) as {
      t: number;
      d: number;
      p: boolean;
    } | null;

    this.busy = false;
    if (!r) {
      return;
    }
    const next = { time: r.t, duration: r.d, playing: r.p };
    const changed =
      next.time.toFixed(1) !== this.state.time.toFixed(1) ||
      next.duration !== this.state.duration ||
      next.playing !== this.state.playing;

    this.state = next;
    if (changed) {
      this.cb?.(next);
    }
  }

  play(): void {
    void this.run(`document.querySelector('video')?.play()`);
  }

  pause(): void {
    void this.run(`document.querySelector('video')?.pause()`);
  }

  seek(seconds: number): void {
    this.state = { ...this.state, time: seconds };
    void this.run(
      `(() => { const v = document.querySelector('video'); if (v) { v.currentTime = ${Number(seconds)}; v.play(); } })()`,
    );
  }

  getState(): PlayerState {
    return this.state;
  }

  onChange(cb: (s: PlayerState) => void): void {
    this.cb = cb;
  }

  destroy(): void {
    if (this.timer !== null) {
      this.container.win.clearInterval(this.timer);
    }
    this.wv?.remove();
    this.wv = null;
    this.container.empty();
  }
}
