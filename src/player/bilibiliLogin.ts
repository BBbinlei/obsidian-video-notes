import { App, Modal } from 'obsidian';
import { BILIBILI_PARTITION } from './bilibili';

interface Webview extends HTMLElement {
  executeJavaScript(code: string): Promise<unknown>;
  loadURL(url: string): Promise<void>;
}

const LOGIN_URL = 'https://passport.bilibili.com/login';

// HttpOnly cookies are invisible to scripts, so ask the API who we are instead.
const NAV_JS = `fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' })
  .then(r => r.json()).then(j => j && j.data && j.data.isLogin ? (j.data.uname || '已登录') : null)`;

const LOGOUT_JS = `(() => {
  const m = document.cookie.match(/(?:^|; )bili_jct=([^;]+)/);
  return fetch('https://passport.bilibili.com/login/exit/v2', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'biliCSRF=' + (m ? m[1] : ''),
  }).then(() => true);
})()`;

/**
 * Bilibili's own login page in the player's session. The plugin never sees the
 * password or the cookies; it only asks the API whether the session is logged in.
 */
export class BilibiliLoginModal extends Modal {
  private wv: Webview | null = null;
  private timer: number | null = null;
  private status!: HTMLElement;
  private outBtn!: HTMLButtonElement;
  private user: string | null = null;
  private first = true;
  private changed = false;

  constructor(
    app: App,
    private readonly onDone: (changed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('vn-login-modal');
    const bar = this.contentEl.createDiv({ cls: 'vn-login-bar' });

    this.status = bar.createSpan({ text: '正在检查登录状态…' });
    this.outBtn = bar.createEl('button', { text: '退出登录', cls: 'is-hidden' });
    this.outBtn.addEventListener('click', () => void this.logout());
    const wv = this.contentEl.doc.createElement('webview') as Webview;

    wv.addClass('vn-login-view');
    wv.setAttribute('partition', BILIBILI_PARTITION);
    wv.setAttribute('src', LOGIN_URL);
    this.contentEl.appendChild(wv);
    this.wv = wv;
    this.timer = this.contentEl.win.setInterval(() => void this.poll(), 1500);
  }

  private async ask(code: string): Promise<unknown> {
    try {
      return await this.wv?.executeJavaScript(code);
    } catch {
      return undefined; // page still loading or navigating
    }
  }

  private async poll(): Promise<void> {
    const name = await this.ask(NAV_JS);

    if (name === undefined) {
      return;
    }
    const user = typeof name === 'string' ? name : null;

    if (user === this.user && !this.first) {
      return;
    }
    const wasFirst = this.first;

    this.first = false;
    this.user = user;
    this.outBtn.toggleClass('is-hidden', !user);
    if (!user) {
      this.status.setText('请在下方登录 B 站（扫码或账号），登录成功后窗口会自动关闭');

      return;
    }
    if (wasFirst) {
      this.status.setText(`已登录：${user}`);

      return;
    }
    this.changed = true;
    this.close();
  }

  private async logout(): Promise<void> {
    await this.ask(LOGOUT_JS);
    this.changed = true;
    this.user = null;
    this.outBtn.addClass('is-hidden');
    this.status.setText('已退出，请重新登录');
    void this.wv?.loadURL(LOGIN_URL).catch(() => undefined);
  }

  onClose(): void {
    if (this.timer !== null) {
      this.contentEl.win.clearInterval(this.timer);
    }
    this.wv?.remove();
    this.contentEl.empty();
    this.onDone(this.changed);
  }
}
