import { ItemView, Notice, TFile, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import { Doc, bodyText, chapterMarkers, parseDoc, setBodyOp, setVideoOp } from '../doc';
import { History } from '../history';
import type VideoNotesPlugin from '../main';
import { MindNode, findByLine } from '../core/parse/parser';
import { makeChatCall, obsidianHttp } from '../net';
import { BilibiliPlayer } from '../player/bilibili';
import { Player, PlayerState, VideoSource, parseVideoUrl, videoKey } from '../player/types';
import { YouTubePlayer } from '../player/youtube';
import { parseSubtitleFile } from '../subtitles/parse';
import { translateAll } from '../subtitles/translate';
import { TrackData } from '../subtitles/types';
import { alignTranslation, fetchYouTubeTrack, fetchYouTubeTranslation } from '../subtitles/youtube';
import { formatTimestamp, parseTimestamp } from '../timestamp';
import { Controls } from './Controls';
import { MindMap } from './MindMap';
import { NotePane } from './NotePane';
import { SubtitlePanel } from './SubtitlePanel';

export const VIEW_TYPE = 'video-notes-view';

interface ViewState extends Record<string, unknown> {
  file?: string;
}

interface Snapshot {
  lines: string[];
  select: number;
}

/**
 * Left: video, controls, subtitles. Right: mind map over the selected node's
 * note. The note's .md file is the single source of truth; every edit becomes
 * a new set of lines, written back with vault.process, then re-parsed.
 */
export class VideoNoteView extends ItemView {
  private file: TFile | null = null;
  private doc: Doc | null = null;
  private videoUrl: string | null = null;
  private src: VideoSource | null = null;
  private player: Player | null = null;
  private lastWritten: string | null = null;
  private readonly history = new History<Snapshot>();
  private lastKind = '';
  private track: TrackData | null = null;
  private cancelTranslate = false;

  private stage!: HTMLElement;
  private left!: HTMLElement;
  private right!: HTMLElement;
  private mmWrap!: HTMLElement;
  private noteWrap!: HTMLElement;
  private controls!: Controls;
  private mindmap!: MindMap;
  private notes!: NotePane;
  private subs!: SubtitlePanel;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: VideoNotesPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? 'Video notes';
  }

  getIcon(): string {
    return 'video';
  }

  getState(): ViewState {
    return { file: this.file?.path };
  }

  async setState(state: ViewState, result: ViewStateResult): Promise<void> {
    const path = typeof state.file === 'string' ? state.file : null;
    const f = path ? this.app.vault.getFileByPath(path) : null;

    if (f) {
      this.file = f;
      await this.reload();
    }
    await super.setState(state, result);
  }

  onOpen(): Promise<void> {
    const root = this.contentEl;
    const settings = this.plugin.settings;

    root.empty();
    root.addClass('vn-root');
    this.left = root.createDiv({ cls: 'vn-left' });
    this.stage = this.left.createDiv({ cls: 'vn-stage' });
    this.controls = new Controls(this.left.createDiv({ cls: 'vn-controls' }), {
      toggle: () => this.togglePlay(),
      seek: (s) => this.player?.seek(s),
      chapter: (line) => {
        this.mindmap.selectLine(line);
        const node = this.nodeAtLine(line);

        if (node) {
          this.jumpTo(node);
        }
      },
      changeVideo: () => this.renderGuide(this.videoUrl ?? '', '', true),
      toggleDrawer: () => {
        settings.drawerOpen = !settings.drawerOpen;
        this.applyDrawer();
        void this.plugin.saveSettings();
      },
    });
    this.subs = new SubtitlePanel(this.stage, this.left, settings, {
      seek: (s) => this.player?.seek(s),
      excerpt: (s, t) => void this.excerpt(s, t),
      fetch: () => void this.fetchSubtitles(),
      importFile: () => this.importSubtitles(),
      translate: () => void this.translate(),
      translateYouTube: () => void this.translateYouTube(),
      saveSettings: () => void this.plugin.saveSettings(),
    });
    this.applyDrawer();
    const vsplit = root.createDiv({ cls: 'vn-vsplit' });

    this.right = root.createDiv({ cls: 'vn-right' });
    this.mmWrap = this.right.createDiv({ cls: 'vn-mm-wrap' });
    const mmHead = this.mmWrap.createDiv({ cls: 'vn-pane-h' });

    mmHead.createEl('b', { text: '思维导图' });
    mmHead.createSpan({ text: '大纲即笔记结构' });
    mmHead.createSpan({ cls: 'vn-sp' });
    const full = mmHead.createEl('button', { text: '⤢', attr: { title: '全屏导图' } });

    full.addEventListener('click', () => {
      const on = this.mmWrap.hasClass('is-full');

      this.mmWrap.toggleClass('is-full', !on);
      full.setText(on ? '⤢' : '⤡');
    });
    this.mindmap = new MindMap(this.mmWrap, {
      commit: (lines, opts) => void this.commit(lines, opts),
      selected: (node) => this.onSelected(node),
      jump: (node) => this.jumpTo(node),
      currentTime: () => this.player?.getState().time ?? 0,
      undo: () => void this.undo(),
      redo: () => void this.redo(),
    });
    this.mmWrap.createDiv({
      cls: 'vn-hint',
      text: '↑↓←→ 移动 · Tab 子节点 · Enter 同级 · F2 改名 · Del 删除 · Ctrl+←/→ 折叠/展开 · ⌘Z 撤销 · 拖动节点改结构',
    });
    const hsplit = this.right.createDiv({ cls: 'vn-hsplit' });

    this.noteWrap = this.right.createDiv({ cls: 'vn-note-wrap' });
    this.notes = new NotePane(
      this.noteWrap,
      this.app,
      this,
      {
        commitBody: (line, text) => void this.commitBody(line, text),
        seek: (s) => this.player?.seek(s),
      },
      () => this.file?.path ?? '',
    );
    this.dragSplit(vsplit, 'x');
    this.dragSplit(hsplit, 'y');
    this.registerEvent(
      this.app.vault.on('modify', (f) => {
        if (f === this.file) {
          void this.reload(true);
        }
      }),
    );
    if (this.file) {
      void this.reload();
    }

    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.cancelTranslate = true;
    this.destroyPlayer();

    return Promise.resolve();
  }

  private applyDrawer(): void {
    const open = this.plugin.settings.drawerOpen;

    this.subs.setOpen(open);
    this.controls.setDrawerOpen(open);
  }

  private dragSplit(handle: HTMLElement, axis: 'x' | 'y'): void {
    handle.addEventListener('pointerdown', (e) => {
      handle.setPointerCapture(e.pointerId);
      handle.addClass('is-drag');
      const move = (ev: PointerEvent): void => {
        if (axis === 'x') {
          const r = this.contentEl.getBoundingClientRect();
          const p = Math.max(30, Math.min(80, ((ev.clientX - r.left) / r.width) * 100));

          this.left.style.flex = `0 0 ${p}%`;
        } else {
          const r = this.right.getBoundingClientRect();
          const p = Math.max(20, Math.min(80, ((ev.clientY - r.top) / r.height) * 100));

          this.mmWrap.style.flex = `0 0 ${p}%`;
        }
      };
      const up = (): void => {
        handle.removeClass('is-drag');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  /* ---------- file <-> view ---------- */

  private async reload(fromEvent = false): Promise<void> {
    if (!this.file || !this.stage) {
      return;
    }
    const text = await this.app.vault.read(this.file);

    if (fromEvent && text === this.lastWritten) {
      return; // our own write coming back
    }
    if (fromEvent) {
      this.history.clear(); // someone else edited the file: old snapshots no longer fit
    }
    const keep = this.mindmap.selectedLine();

    this.doc = parseDoc(text, this.file.basename);
    this.mindmap.render(this.doc, keep);
    this.afterRender();
    this.mountVideo(this.doc.fm.video);
  }

  private afterRender(): void {
    if (!this.doc) {
      return;
    }
    this.controls.setChapters(chapterMarkers(this.doc.root));
    this.showSelected();
  }

  private async write(lines: string[]): Promise<void> {
    if (!this.file) {
      return;
    }
    const text = lines.join('\n');

    this.lastWritten = text;
    await this.app.vault.process(this.file, () => text);
    this.doc = parseDoc(text, this.file.basename);
  }

  private async commit(
    lines: string[],
    opts: { select: number; edit?: boolean },
    record = true,
  ): Promise<void> {
    if (!this.file || !this.doc) {
      return;
    }
    if (record) {
      this.history.push({ lines: this.doc.lines, select: this.mindmap.selectedLine() });
      this.lastKind = 'struct';
    }
    await this.write(lines);
    this.mindmap.render(this.doc!, opts.select, opts.edit ?? false);
    this.afterRender();
    if (!opts.edit) {
      this.mindmap.focus();
    }
  }

  private async undo(): Promise<void> {
    if (!this.doc) {
      return;
    }
    const prev = this.history.undo({ lines: this.doc.lines, select: this.mindmap.selectedLine() });

    if (prev) {
      this.lastKind = '';
      await this.commit(prev.lines, { select: prev.select }, false);
    }
  }

  private async redo(): Promise<void> {
    if (!this.doc) {
      return;
    }
    const next = this.history.redo({ lines: this.doc.lines, select: this.mindmap.selectedLine() });

    if (next) {
      this.lastKind = '';
      await this.commit(next.lines, { select: next.select }, false);
    }
  }

  private async commitBody(line: number, body: string): Promise<void> {
    if (!this.doc || !this.file) {
      return;
    }
    const node = line < 0 ? this.doc.root : findByLine(this.doc.root, line);

    if (!node) {
      return;
    }
    // Typing is one undo step per node, not one per pause.
    const kind = `body:${line}`;

    if (this.lastKind !== kind) {
      this.history.push({ lines: this.doc.lines, select: this.mindmap.selectedLine() });
      this.lastKind = kind;
    }
    await this.write(setBodyOp([...this.doc.lines], node, body, this.doc.fm));
    this.mindmap.render(this.doc!, this.mindmap.selectedLine());
    this.controls.setChapters(chapterMarkers(this.doc!.root));
  }

  /* ---------- selection / playback ---------- */

  private selectedNode(): MindNode | null {
    if (!this.doc) {
      return null;
    }
    const line = this.mindmap.selectedLine();

    return line < 0 ? this.doc.root : findByLine(this.doc.root, line);
  }

  private showSelected(): void {
    const node = this.selectedNode();

    if (node && this.doc) {
      this.notes.show(node, this.doc);
      this.controls.setSelected(node.line);
    }
  }

  private onSelected(node: MindNode): void {
    if (!this.doc) {
      return;
    }
    // Picking a node only shows its note; the video moves when asked to (jumpTo).
    this.notes.show(node, this.doc);
    this.controls.setSelected(node.line);
  }

  /** Seek the video to the node's `[mm:ss]`, if it has one. */
  private jumpTo(node: MindNode): void {
    const { seconds } = parseTimestamp(node.text);

    if (seconds !== null) {
      this.player?.seek(seconds);
    }
  }

  private nodeAtLine(line: number): MindNode | null {
    if (!this.doc) {
      return null;
    }

    return line < 0 ? this.doc.root : findByLine(this.doc.root, line);
  }

  private togglePlay(): void {
    if (!this.player) {
      return;
    }
    if (this.player.getState().playing) {
      this.player.pause();
    } else {
      this.player.play();
    }
  }

  private onPlayerChange(s: PlayerState): void {
    this.controls.update(s);
    this.mindmap.setTime(s.time, s.playing);
    this.subs.setTime(s.time);
  }

  private destroyPlayer(): void {
    this.player?.destroy();
    this.player = null;
    this.videoUrl = null;
  }

  private mountVideo(url: string | null): void {
    if (url === this.videoUrl && this.player) {
      return;
    }
    this.destroyPlayer();
    this.stage.findAll('.vn-stage-msg, .vn-player-mount, .vn-guide').forEach((e) => e.remove());
    this.videoUrl = url;
    this.src = url ? parseVideoUrl(url) : null;
    void this.loadTrack();
    const src = this.src;

    this.subs.setYouTube(src?.kind === 'youtube');

    if (!src) {
      this.renderGuide(url ?? '', url ? '无法识别这个视频链接，请检查后重新填写' : '', false);

      return;
    }
    const player =
      src.kind === 'youtube'
        ? new YouTubePlayer(this.stage, src.id, src.start)
        : new BilibiliPlayer(this.stage, src.bvid, src.page);

    this.player = player;
    player.onChange((s) => this.onPlayerChange(s));
    player.load().catch((err: unknown) => {
      new Notice(`视频加载失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /**
   * The "which video?" card over the stage. Submitting writes the link into the
   * note's frontmatter, so the note stays the one place the video is recorded.
   */
  private renderGuide(prefill: string, error: string, cancellable: boolean): void {
    this.stage.findAll('.vn-guide').forEach((e) => e.remove());
    const guide = this.stage.createDiv({ cls: 'vn-guide' });
    const card = guide.createDiv({ cls: 'vn-guide-card' });

    card.createEl('h3', { text: cancellable ? '更换视频' : '给这篇笔记配一个视频' });
    card.createEl('p', { text: '粘贴 YouTube 或 B 站链接，会自动写进这篇笔记顶部的 video 属性。' });
    const input = card.createEl('input', { type: 'text', placeholder: 'https://www.youtube.com/watch?v=…' });
    const err = card.createDiv({ cls: 'vn-guide-err', text: error });
    const row = card.createDiv({ cls: 'vn-guide-row' });
    const go = row.createEl('button', { text: cancellable ? '替换' : '开始', cls: 'mod-cta' });

    input.value = prefill;
    const submit = (): void => {
      const url = input.value.trim();

      if (!parseVideoUrl(url)) {
        err.setText(url ? '无法识别：目前支持 YouTube 和 B 站的视频链接' : '请先粘贴一个视频链接');
        input.focus();

        return;
      }
      go.disabled = true;
      void this.setVideo(url).catch((e: unknown) => {
        go.disabled = false;
        err.setText(`写入笔记失败：${e instanceof Error ? e.message : String(e)}`);
      });
    };

    go.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        submit();
      }
    });
    if (cancellable) {
      row.createEl('button', { text: '取消' }).addEventListener('click', () => guide.remove());
    }
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  /** Records the link in the note's frontmatter, then loads the video. */
  private async setVideo(url: string): Promise<void> {
    if (!this.doc || !this.file) {
      return;
    }
    const lines = setVideoOp(this.doc.lines, url);

    // The frontmatter grew or shrank, so every saved line number is stale.
    this.history.clear();
    this.lastKind = '';
    await this.write(lines);
    this.mindmap.render(this.doc!, -1);
    this.afterRender();
    this.mountVideo(this.doc!.fm.video);
  }

  /* ---------- subtitles ---------- */

  private cacheKey(): string | null {
    return this.src ? videoKey(this.src) : null;
  }

  private async loadTrack(): Promise<void> {
    const key = this.cacheKey();

    this.track = key ? await this.plugin.store.load(key) : null;
    this.subs.setTrack(this.track, this.track?.trans[this.plugin.settings.targetLang] ?? null);
    if (!this.track) {
      this.subs.setStatus('');
    }
  }

  private async useTrack(track: TrackData): Promise<void> {
    const key = this.cacheKey();

    this.track = track;
    if (key) {
      await this.plugin.store.save(key, track);
    }
    this.subs.setTrack(track, null);
  }

  private async fetchSubtitles(): Promise<void> {
    if (!this.src) {
      new Notice('先给笔记设置视频链接');

      return;
    }
    if (this.src.kind !== 'youtube') {
      new Notice('B 站字幕需要登录状态，暂不支持自动获取，请用「导入」选择 .srt / .vtt 文件');

      return;
    }
    this.subs.setStatus('正在获取字幕…');
    try {
      const r = await fetchYouTubeTrack(obsidianHttp, this.src.id, ['en', 'zh']);

      await this.useTrack({ source: `YouTube · ${r.lang}`, lang: r.lang, cues: r.cues, trans: {} });
      new Notice(`已获取 ${r.cues.length} 条字幕`);
    } catch (e) {
      this.subs.setStatus('');
      new Notice(e instanceof Error ? e.message : String(e), 8000);
    }
  }

  private importSubtitles(): void {
    const input = this.contentEl.doc.createElement('input');

    input.type = 'file';
    input.accept = '.srt,.vtt,.json,.json3';
    input.addEventListener('change', () => {
      const f = input.files?.[0];

      if (!f) {
        return;
      }
      void f.text().then(async (raw) => {
        const cues = parseSubtitleFile(f.name, raw);

        if (!cues.length) {
          new Notice('没有从这个文件里读到字幕');

          return;
        }
        await this.useTrack({ source: f.name, lang: 'imported', cues, trans: {} });
        new Notice(`已导入 ${cues.length} 条字幕`);
      });
    });
    input.click();
  }

  private async translate(): Promise<void> {
    if (this.subs.isTranslating) {
      this.cancelTranslate = true;

      return;
    }
    const track = this.track;
    const key = this.cacheKey();
    const s = this.plugin.settings;

    if (!track || !key) {
      new Notice('先获取或导入字幕');

      return;
    }
    if (!s.apiBase || !s.apiKey || !s.model) {
      new Notice('先在 设置 → Video notes 里填好接口地址、API Key 和模型');

      return;
    }
    const lang = s.targetLang;

    this.cancelTranslate = false;
    this.subs.setTranslating(true);
    try {
      const { out, failed, lastError } = await translateAll(
        track.cues.map((c) => c.text),
        {
          lang,
          call: makeChatCall(s),
          existing: track.trans[lang],
          isCancelled: () => this.cancelTranslate,
          onProgress: (done, total, partial) => {
            track.trans[lang] = [...partial];
            this.subs.setTrans(track.trans[lang]);
            this.subs.setStatus(`翻译中 ${done}/${total}`);
            void this.plugin.store.save(key, track);
          },
        },
      );

      track.trans[lang] = out;
      await this.plugin.store.save(key, track);
      this.subs.setTrans(out);
      this.subs.setStatus('');
      if (this.cancelTranslate) {
        new Notice('翻译已停止，已完成的部分已缓存');
      } else if (failed) {
        new Notice(
          `有 ${failed} 条没翻译成功。原因：${lastError ?? '未知'}\n再点一次「翻译」只会补这些。`,
          15000,
        );
      } else {
        new Notice('翻译完成');
      }
    } catch (e) {
      new Notice(`翻译失败：${e instanceof Error ? e.message : String(e)}`, 8000);
    } finally {
      this.subs.setTranslating(false);
    }
  }

  /** YouTube's own machine translation, lined up with the cues we already have. */
  private async translateYouTube(): Promise<void> {
    const track = this.track;
    const key = this.cacheKey();
    const src = this.src;

    if (!track || !key || src?.kind !== 'youtube') {
      new Notice('先获取或导入字幕');

      return;
    }
    const s = this.plugin.settings;
    const lang = s.targetLang;

    this.subs.setStatus('正在向 YouTube 取译文…');
    try {
      const sourceLang = track.lang === 'imported' ? 'en' : track.lang;
      const translated = await fetchYouTubeTranslation(obsidianHttp, src.id, sourceLang, s.ytTransLang);
      const aligned = alignTranslation(track.cues, translated);
      const existing = track.trans[lang] ?? [];
      const merged = aligned.map((t, i) => existing[i] || t);
      const missing = merged.filter((t) => !t).length;

      track.trans[lang] = merged;
      await this.plugin.store.save(key, track);
      this.subs.setTrans(merged);
      new Notice(
        missing
          ? `已取到译文，但有 ${missing} 条没对上，可再点「翻译」用 AI 补齐`
          : 'YouTube 译文已加载',
        missing ? 8000 : 4000,
      );
    } catch (e) {
      this.subs.setStatus('');
      new Notice(e instanceof Error ? e.message : String(e), 8000);
    }
  }

  /** Append a quoted subtitle line, with its time, to the selected node's note. */
  private async excerpt(seconds: number, text: string): Promise<void> {
    const node = this.selectedNode();

    if (!node || !this.doc) {
      return;
    }
    const existing = bodyText(node, this.doc.lines, this.doc.fm);
    const line = `> [${formatTimestamp(seconds)}] ${text}`;

    await this.commitBody(node.line, existing ? `${existing}\n${line}` : line);
    this.showSelected();
    new Notice(`已摘录到「${parseTimestamp(node.text).title || this.doc.root.text}」`);
  }
}
