import { Settings, SubMode } from '../settings';
import { formatTimestamp } from '../timestamp';
import { Cue, TrackData, cueIndexAt } from '../subtitles/types';

export interface SubtitleHost {
  seek(seconds: number): void;
  /** Append a quoted line to the selected node's note. */
  excerpt(seconds: number, text: string): void;
  fetch(): void;
  importFile(): void;
  translate(): void;
  translateYouTube(): void;
  saveSettings(): void;
}

const MODES: [SubMode, string][] = [
  ['orig', '原文'],
  ['trans', '中文'],
  ['both', '双语'],
];

/** The floating subtitle over the video and the searchable list under it. */
export class SubtitlePanel {
  private readonly overlay: HTMLElement;
  private readonly drawer: HTMLElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly modeBtns = new Map<SubMode, HTMLButtonElement>();
  private readonly transBtn: HTMLButtonElement;
  private readonly ytBtn: HTMLButtonElement;
  private track: TrackData | null = null;
  private trans: string[] = [];
  private time = 0;
  private rows: HTMLElement[] = [];
  private lastCur = -2;
  private translating = false;

  constructor(
    stage: HTMLElement,
    drawerParent: HTMLElement,
    private readonly settings: Settings,
    private readonly host: SubtitleHost,
  ) {
    this.overlay = stage.createDiv({ cls: 'vn-sub' });
    this.installDrag();
    this.drawer = drawerParent.createDiv({ cls: 'vn-drawer' });
    const bar = this.drawer.createDiv({ cls: 'vn-drawer-h' });
    const fetchBtn = bar.createEl('button', { text: '获取字幕' });
    const importBtn = bar.createEl('button', { text: '导入' });

    this.transBtn = bar.createEl('button', { text: '翻译' });
    this.ytBtn = bar.createEl('button', {
      text: 'YT翻译',
      attr: { title: '用 YouTube 自带的机器翻译（免费，易被限流）' },
    });
    this.ytBtn.addClass('is-hidden');
    this.ytBtn.addEventListener('click', () => host.translateYouTube());
    this.status = bar.createSpan({ cls: 'vn-status' });
    fetchBtn.addEventListener('click', () => host.fetch());
    importBtn.addEventListener('click', () => host.importFile());
    this.transBtn.addEventListener('click', () => host.translate());
    const bar2 = this.drawer.createDiv({ cls: 'vn-drawer-h' });

    this.search = bar2.createEl('input', { type: 'text', placeholder: '搜索字幕（中/英）' });
    this.search.addClass('vn-search');
    this.search.addEventListener('input', () => this.renderList());
    const seg = bar2.createDiv({ cls: 'vn-seg' });

    for (const [m, label] of MODES) {
      const b = seg.createEl('button', { text: label });

      b.addEventListener('click', () => {
        settings.subMode = m;
        host.saveSettings();
        this.refresh();
      });
      this.modeBtns.set(m, b);
    }
    const minus = bar2.createEl('button', { text: 'A−', attr: { title: '字幕缩小' } });
    const plus = bar2.createEl('button', { text: 'A+', attr: { title: '字幕放大' } });

    minus.addEventListener('click', () => this.setFont(settings.fontSize - 2));
    plus.addEventListener('click', () => this.setFont(settings.fontSize + 2));
    this.list = this.drawer.createDiv({ cls: 'vn-sublist' });
    this.applyLayout();
    this.refresh();
  }

  setOpen(open: boolean): void {
    this.drawer.toggleClass('is-closed', !open);
  }

  setTrack(track: TrackData | null, trans: string[] | null): void {
    this.track = track;
    this.trans = trans ?? [];
    this.lastCur = -2;
    this.refresh();
  }

  setTrans(trans: string[]): void {
    this.trans = trans;
    this.refresh();
  }

  setStatus(text: string): void {
    this.status.setText(text);
  }

  /** The YouTube-translation button only makes sense for YouTube videos. */
  setYouTube(on: boolean): void {
    this.ytBtn.toggleClass('is-hidden', !on);
  }

  setTranslating(on: boolean): void {
    this.translating = on;
    this.transBtn.setText(on ? '停止翻译' : '翻译');
  }

  setTime(t: number): void {
    this.time = t;
    this.paintOverlay();
    this.markCurrent();
  }

  private cues(): Cue[] {
    return this.track?.cues ?? [];
  }

  private refresh(): void {
    for (const [m, b] of this.modeBtns) {
      b.toggleClass('is-on', m === this.settings.subMode);
    }
    this.applyLayout();
    this.renderList();
    this.paintOverlay();
  }

  private setFont(px: number): void {
    this.settings.fontSize = Math.max(12, Math.min(40, px));
    this.host.saveSettings();
    this.applyLayout();
  }

  private applyLayout(): void {
    const { x, y } = this.settings.subOffset;

    this.overlay.style.fontSize = `${this.settings.fontSize}px`;
    this.overlay.style.transform = `translate(calc(-50% + ${x}px), ${y}px)`;
  }

  /** The text lines to show for cue `i`, per the display mode. */
  private linesFor(i: number): { orig?: string; zh?: string } {
    const orig = this.cues()[i]?.text ?? '';
    const zh = this.trans[i] || '';
    const mode = this.settings.subMode;

    if (mode === 'orig' || (!zh && mode === 'both')) {
      return { orig };
    }
    if (mode === 'trans') {
      return zh ? { zh } : { orig };
    }

    return { orig, zh };
  }

  private paintOverlay(): void {
    const cues = this.cues();
    const i = cueIndexAt(cues, this.time);
    const c = cues[i];

    this.overlay.empty();
    if (!c || this.time > c.end + 0.4) {
      return;
    }
    const { orig, zh } = this.linesFor(i);

    if (orig) {
      this.overlay.createDiv({ cls: 'vn-sub-l', text: orig });
    }
    if (zh) {
      this.overlay.createDiv({ cls: 'vn-sub-l is-zh', text: zh });
    }
  }

  private installDrag(): void {
    const el = this.overlay;
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    let on = false;

    el.addEventListener('pointerdown', (e) => {
      on = true;
      sx = e.clientX;
      sy = e.clientY;
      ox = this.settings.subOffset.x;
      oy = this.settings.subOffset.y;
      el.setPointerCapture(e.pointerId);
      el.addClass('is-drag');
    });
    el.addEventListener('pointermove', (e) => {
      if (on) {
        this.settings.subOffset = { x: ox + e.clientX - sx, y: oy + e.clientY - sy };
        this.applyLayout();
      }
    });
    el.addEventListener('pointerup', () => {
      if (on) {
        on = false;
        el.removeClass('is-drag');
        this.host.saveSettings();
      }
    });
  }

  private renderList(): void {
    const cues = this.cues();
    const q = this.search.value.trim().toLowerCase();

    this.list.empty();
    this.rows = [];
    this.lastCur = -2;
    if (!cues.length) {
      this.list.createDiv({
        cls: 'vn-empty',
        text: '还没有字幕。点「获取字幕」自动取 YouTube 字幕，或「导入」.srt / .vtt 文件。',
      });

      return;
    }
    let shown = 0;
    const frag = this.list.doc.createDocumentFragment();

    cues.forEach((c, i) => {
      const zh = this.trans[i] ?? '';

      if (q && !`${c.text}\n${zh}`.toLowerCase().includes(q)) {
        return;
      }
      shown++;
      const row = this.list.doc.createElement('div');

      row.className = 'vn-row';
      row.dataset.i = String(i);
      row.createSpan({ cls: 'vn-row-ts', text: formatTimestamp(c.start) });
      const tx = row.createDiv({ cls: 'vn-row-tx' });
      const { orig, zh: z } = this.linesFor(i);

      if (orig) {
        this.fill(tx.createDiv({ cls: 'vn-row-en' }), orig, q);
      }
      if (z) {
        this.fill(tx.createDiv({ cls: 'vn-row-zh' }), z, q);
      }
      const ex = row.createDiv({ cls: 'vn-row-ex' });

      ex.createSpan({ text: '摘录' });
      for (const [kind, label] of [['orig', '原'], ['trans', '中'], ['both', '双']] as const) {
        const b = ex.createEl('button', { text: label });

        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.host.excerpt(c.start, this.excerptText(i, kind));
        });
      }
      row.addEventListener('click', () => this.host.seek(c.start));
      this.rows[i] = row;
      frag.append(row);
    });
    this.list.append(frag);
    if (!shown) {
      this.list.createDiv({ cls: 'vn-empty', text: '没有匹配的字幕' });
    }
    this.status.setText(this.statusText(shown, cues.length, q !== ''));
    this.markCurrent();
  }

  private statusText(shown: number, total: number, filtered: boolean): string {
    const base = filtered ? `${shown} / ${total} 条` : `${total} 条`;
    const t = this.track;
    const zh = this.trans.filter(Boolean).length;
    const tr = zh ? ` · 已译 ${zh}/${total}` : '';

    return `${base}${t ? ` · ${t.source}` : ''}${tr}`;
  }

  private excerptText(i: number, kind: SubMode): string {
    const orig = this.cues()[i]?.text ?? '';
    const zh = this.trans[i] ?? '';

    if (kind === 'orig' || !zh) {
      return orig;
    }

    return kind === 'trans' ? zh : `${orig} / ${zh}`;
  }

  /** Text with the search term wrapped in <mark>. */
  private fill(el: HTMLElement, text: string, q: string): void {
    const at = q ? text.toLowerCase().indexOf(q) : -1;

    if (at < 0) {
      el.setText(text);

      return;
    }
    el.append(text.slice(0, at));
    el.createEl('mark', { text: text.slice(at, at + q.length) });
    el.append(text.slice(at + q.length));
  }

  private markCurrent(): void {
    const i = cueIndexAt(this.cues(), this.time);

    if (i === this.lastCur) {
      return;
    }
    this.rows[this.lastCur]?.removeClass('is-cur');
    this.lastCur = i;
    const row = this.rows[i];

    if (row) {
      row.addClass('is-cur');
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  get isTranslating(): boolean {
    return this.translating;
  }
}
