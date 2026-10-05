import { App, Component, MarkdownRenderer } from 'obsidian';
import { Doc, bodyText } from '../doc';
import { MindNode } from '../core/parse/parser';
import { formatTimestamp, parseTimestamp } from '../timestamp';

export interface NotePaneHost {
  /** Body text of the node at `line` was edited. */
  commitBody(line: number, text: string): void;
  seek(seconds: number): void;
}

const TS_IN_TEXT = /\[(\d{1,3}):([0-5]\d)(?::([0-5]\d))?\]/g;

/** The selected node's own text: rendered Markdown, or a textarea to edit. */
export class NotePane {
  private readonly titleEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly editBtn: HTMLButtonElement;
  private readonly body: HTMLElement;
  private line = -1;
  private text = '';
  private editing = false;
  private timer: number | null = null;

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
    head.createSpan({ cls: 'vn-sp' });
    this.editBtn = head.createEl('button', { text: '编辑' });
    this.editBtn.addEventListener('click', () => this.toggle());
    this.body = parent.createDiv({ cls: 'vn-note' });
    this.body.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('.vn-ts');

      if (a) {
        this.host.seek(Number(a.dataset.t));
      }
    });
  }

  show(node: MindNode, doc: Doc): void {
    const { title, seconds } = parseTimestamp(node.text);

    this.line = node.line;
    this.text = bodyText(node, doc.lines, doc.fm);
    this.titleEl.setText(title || doc.root.text);
    this.timeEl.setText(seconds !== null ? `· ${formatTimestamp(seconds)}` : '');
    if (this.editing) {
      const ta = this.body.querySelector('textarea');

      if (ta) {
        ta.value = this.text;
      }
    } else {
      void this.renderView();
    }
  }

  private toggle(): void {
    this.editing = !this.editing;
    this.editBtn.setText(this.editing ? '完成' : '编辑');
    if (this.editing) {
      this.body.empty();
      const ta = this.body.createEl('textarea', { cls: 'vn-note-edit' });

      ta.value = this.text;
      ta.addEventListener('input', () => {
        this.text = ta.value;
        if (this.timer !== null) {
          window.clearTimeout(this.timer);
        }
        this.timer = window.setTimeout(
          () => this.host.commitBody(this.line, this.text),
          400,
        );
      });
      ta.focus();
    } else {
      void this.renderView();
    }
  }

  private async renderView(): Promise<void> {
    this.body.empty();
    if (!this.text.trim()) {
      this.body.createDiv({
        cls: 'vn-none',
        text: '这个节点还没有笔记。点右上角「编辑」开始填充。',
      });

      return;
    }
    await MarkdownRenderer.render(
      this.app,
      this.text,
      this.body,
      this.sourcePath(),
      this.owner,
    );
    this.linkTimestamps(this.body);
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
