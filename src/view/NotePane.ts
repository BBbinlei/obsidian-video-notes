import { App, Component, MarkdownRenderer } from 'obsidian';
import { Doc, bodyText } from '../doc';
import { MindNode } from '../core/parse/parser';
import { formatTimestamp, parseTimestamp } from '../timestamp';
import { isComposingKey } from './keys';

export interface NotePaneHost {
  /** Body text of the node at `line` was edited. */
  commitBody(line: number, text: string): void;
  seek(seconds: number): void;
}

const TS_IN_TEXT = /\[(\d{1,3}):([0-5]\d)(?::([0-5]\d))?\]/g;
const SAVE_DELAY = 400;
/** Waits out the click that caused a blur, so saving does not redraw under it. */
const BLUR_SAVE_DELAY = 250;

/**
 * The selected node's own text. Shown as rendered Markdown; a click turns it
 * into a textarea, and leaving the textarea saves and renders again.
 */
export class NotePane {
  private readonly titleEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly body: HTMLElement;
  private line = -1;
  private text = '';
  private editing = false;
  private dirty = false;
  private timer: number | null = null;
  private renderId = 0;

  constructor(
    parent: HTMLElement,
    private readonly app: App,
    private readonly owner: Component,
    private readonly host: NotePaneHost,
    private sourcePath: () => string,
  ) {
    const head = parent.createDiv({ cls: 'vn-pane-h' });

    this.titleEl = head.createEl('b', { text: '笔记' });
    this.timeEl = head.createSpan();
    this.body = parent.createDiv({ cls: 'vn-note' });
    this.body.addEventListener('click', (e) => {
      if (this.editing) {
        return;
      }
      const target = e.target as HTMLElement;
      const ts = target.closest<HTMLElement>('.vn-ts');

      if (ts) {
        this.host.seek(Number(ts.dataset.t));
      } else if (!target.closest('a')) {
        this.enterEdit();
      }
    });
  }

  show(node: MindNode, doc: Doc): void {
    const { title, seconds } = parseTimestamp(node.text);

    this.line = node.line;
    this.titleEl.setText(title || doc.root.text);
    this.timeEl.setText(seconds !== null ? `· ${formatTimestamp(seconds)}` : '');
    if (this.editing) {
      // The user's text is the truth while typing: the saved copy is trimmed,
      // and writing it back would eat a trailing space or move the caret.
      return;
    }
    this.text = bodyText(node, doc.lines, doc.fm);
    void this.renderView();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private enterEdit(): void {
    this.editing = true;
    this.body.empty();
    const ta = this.body.createEl('textarea', {
      cls: 'vn-note-edit',
      attr: { placeholder: '在这里写这个节点的笔记（Markdown）…' },
    });

    ta.value = this.text;
    ta.addEventListener('input', () => {
      this.text = ta.value;
      this.dirty = true;
      this.clearTimer();
      const line = this.line;
      const text = this.text;

      this.timer = window.setTimeout(() => {
        this.timer = null;
        this.dirty = false;
        this.host.commitBody(line, text);
      }, SAVE_DELAY);
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !isComposingKey(e)) {
        e.preventDefault();
        ta.blur();
      }
    });
    ta.addEventListener('blur', () => this.leaveEdit());
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  private leaveEdit(): void {
    if (!this.editing) {
      return;
    }
    this.editing = false;
    this.clearTimer();
    if (this.dirty) {
      // Take line and text now: by the time this runs another node may be selected.
      const line = this.line;
      const text = this.text;

      this.dirty = false;
      window.setTimeout(() => this.host.commitBody(line, text), BLUR_SAVE_DELAY);
    }
    void this.renderView();
  }

  private async renderView(): Promise<void> {
    const id = ++this.renderId;
    const text = this.text;
    const holder = this.body.doc.createElement('div');

    if (!text.trim()) {
      holder.createDiv({ cls: 'vn-none', text: '点击这里开始写这个节点的笔记' });
    } else {
      await MarkdownRenderer.render(this.app, text, holder, this.sourcePath(), this.owner);
      this.linkTimestamps(holder);
    }
    // A newer render, or the user starting to type, supersedes this one.
    if (id !== this.renderId || this.editing) {
      return;
    }
    this.body.empty();
    this.body.append(...Array.from(holder.childNodes));
  }

  /** Turns `[mm:ss]` in rendered text into links that seek the video. */
  private linkTimestamps(root: HTMLElement): void {
    const walker = root.doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits: Text[] = [];

    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (/\[\d{1,3}:[0-5]\d/.test(n.nodeValue ?? '')) {
        hits.push(n as Text);
      }
    }
    for (const t of hits) {
      const src = t.nodeValue ?? '';
      const frag = root.doc.createDocumentFragment();
      let last = 0;

      for (const m of src.matchAll(TS_IN_TEXT)) {
        const idx = m.index ?? 0;
        const sec = parseTimestamp(m[0]).seconds;

        frag.append(src.slice(last, idx));
        const a = root.doc.createElement('a');

        a.className = 'vn-ts';
        a.dataset.t = String(sec ?? 0);
        a.textContent = m[0].slice(1, -1);
        frag.append(a);
        last = idx + m[0].length;
      }
      frag.append(src.slice(last));
      t.replaceWith(frag);
    }
  }
}
