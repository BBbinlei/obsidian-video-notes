import { App, Modal, Notice, Plugin, Setting, TFile, normalizePath } from 'obsidian';
import { parseVideoUrl } from './player/types';
import { DEFAULT_SETTINGS, Settings, VideoNotesSettingTab } from './settings';
import { SubtitleStore } from './subtitles/store';
import { VIEW_TYPE, VideoNoteView } from './view/VideoNoteView';

export default class VideoNotesPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  store!: SubtitleStore;

  async onload(): Promise<void> {
    const saved = (await this.loadData()) as Partial<Settings> | null;

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      subOffset: { ...DEFAULT_SETTINGS.subOffset, ...saved?.subOffset },
    };
    this.store = new SubtitleStore(this.app, this.manifest.dir ?? '');
    this.addSettingTab(new VideoNotesSettingTab(this.app, this));
    this.registerView(VIEW_TYPE, (leaf) => new VideoNoteView(leaf, this));
    this.addRibbonIcon('video', 'Open current note as video note', () => {
      void this.openActive();
    });
    this.addCommand({
      id: 'open-current',
      name: 'Open current note as video note',
      callback: () => void this.openActive(),
    });
    this.addCommand({
      id: 'new-video-note',
      name: 'New video note…',
      callback: () => {
        new NewVideoNoteModal(this.app, (url, name) => {
          void this.createNote(url, name);
        }).open();
      },
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async openActive(): Promise<void> {
    const f = this.app.workspace.getActiveFile();

    if (!f || f.extension !== 'md') {
      new Notice('先打开一篇 Markdown 笔记');

      return;
    }
    await this.openFile(f);
  }

  private async openFile(f: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf('tab');

    await leaf.setViewState({ type: VIEW_TYPE, state: { file: f.path }, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private async createNote(url: string, name: string): Promise<void> {
    if (!parseVideoUrl(url)) {
      new Notice('只支持 YouTube 和 B 站链接');

      return;
    }
    const base = name.trim().replace(/[\\/:*?"<>|]/g, ' ') || 'Video note';
    let path = normalizePath(`${base}.md`);

    for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) {
      path = normalizePath(`${base} ${i}.md`);
    }
    const body = `---\nvideo: ${url.trim()}\n---\n\n## 第一章 [00:00]\n`;
    const f = await this.app.vault.create(path, body);

    await this.openFile(f);
  }
}

class NewVideoNoteModal extends Modal {
  private url = '';
  private name = '';

  constructor(
    app: App,
    private readonly onSubmit: (url: string, name: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle('新建视频笔记');
    new Setting(this.contentEl).setName('视频链接').addText((t) => {
      t.setPlaceholder('YouTube 或 B 站链接').onChange((v) => (this.url = v));
      t.inputEl.addClass('vn-wide');
    });
    new Setting(this.contentEl)
      .setName('笔记名称')
      .addText((t) => t.setPlaceholder('例如：费曼学习法').onChange((v) => (this.name = v)));
    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText('创建')
        .setCta()
        .onClick(() => {
          this.close();
          this.onSubmit(this.url, this.name);
        }),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
