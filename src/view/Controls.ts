import { Chapter } from '../doc';
import { PlayerState } from '../player/types';
import { formatTimestamp } from '../timestamp';

export interface ControlsHost {
  toggle(): void;
  seek(seconds: number): void;
  /** A chapter marker on the bar was clicked. */
  chapter(line: number): void;
  toggleDrawer(): void;
  changeVideo(): void;
}

/** Play/pause, time, and a progress bar carrying one marker per chapter. */
export class Controls {
  private readonly btn: HTMLButtonElement;
  private readonly label: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly drawerBtn: HTMLButtonElement;
  private duration = 0;
  private chapters: Chapter[] = [];
  private marks: { el: HTMLElement; ch: Chapter }[] = [];

  constructor(
    parent: HTMLElement,
    private readonly host: ControlsHost,
  ) {
    this.bar = parent.createDiv({ cls: 'vn-progress' });
    this.bar.createDiv({ cls: 'vn-progress-track' });
    this.fill = this.bar.createDiv({ cls: 'vn-progress-fill' });
    this.bar.addEventListener('click', (e) => {
      const r = this.bar.getBoundingClientRect();

      if (this.duration > 0) {
        host.seek(((e.clientX - r.left) / r.width) * this.duration);
      }
    });
    const row = parent.createDiv({ cls: 'vn-controls-row' });

    this.btn = row.createEl('button', { text: '▶', cls: 'vn-btn' });
    this.btn.addEventListener('click', () => host.toggle());
    this.label = row.createSpan({ cls: 'vn-time', text: '00:00 / 00:00' });
    row.createSpan({ cls: 'vn-sp' });
    const change = row.createEl('button', { text: '更换视频', cls: 'vn-btn' });

    change.addEventListener('click', () => host.changeVideo());
    this.drawerBtn = row.createEl('button', { text: '字幕列表', cls: 'vn-btn' });
    this.drawerBtn.addEventListener('click', () => host.toggleDrawer());
  }

  setDrawerOpen(open: boolean): void {
    this.drawerBtn.toggleClass('is-on', open);
  }

  update(s: PlayerState): void {
    const durationChanged = s.duration !== this.duration;

    this.duration = s.duration;
    this.btn.setText(s.playing ? '❚❚' : '▶');
    this.label.setText(`${formatTimestamp(s.time)} / ${formatTimestamp(s.duration)}`);
    this.fill.style.width = s.duration > 0 ? `${(s.time / s.duration) * 100}%` : '0';
    if (durationChanged) {
      this.layoutMarks();
    }
  }

  setChapters(chapters: Chapter[]): void {
    this.chapters = chapters;
    this.marks.forEach((m) => m.el.remove());
    this.marks = chapters.map((ch) => {
      const el = this.bar.createDiv({
        cls: 'vn-mark' + (ch.top ? ' is-top' : ''),
        attr: { title: `${ch.title} · ${formatTimestamp(ch.seconds)}` },
      });

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.host.chapter(ch.line);
      });

      return { el, ch };
    });
    this.layoutMarks();
  }

  setSelected(line: number): void {
    this.marks.forEach((m) => m.el.toggleClass('is-sel', m.ch.line === line));
  }

  private layoutMarks(): void {
    for (const m of this.marks) {
      const pct = this.duration > 0 ? (m.ch.seconds / this.duration) * 100 : 0;

      m.el.style.left = `${Math.min(100, pct)}%`;
      m.el.toggleClass('is-hidden', this.duration <= 0);
    }
  }
}
