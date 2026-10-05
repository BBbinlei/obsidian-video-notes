import { App, PluginSettingTab, Setting } from 'obsidian';
import type VideoNotesPlugin from './main';

export type SubMode = 'both' | 'orig' | 'trans';

export interface Settings {
  apiBase: string;
  apiKey: string;
  model: string;
  targetLang: string;
  /** YouTube's own language code for its auto-translation, e.g. zh-Hans. */
  ytTransLang: string;
  subMode: SubMode;
  fontSize: number;
  /** Where the floating subtitle was dragged to, relative to its default spot. */
  subOffset: { x: number; y: number };
  drawerOpen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  apiBase: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  targetLang: '简体中文',
  ytTransLang: 'zh-Hans',
  subMode: 'both',
  fontSize: 18,
  subOffset: { x: 0, y: 0 },
  drawerOpen: true,
};

export class VideoNotesSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: VideoNotesPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const el = this.containerEl;
    const s = this.plugin.settings;

    el.empty();
    new Setting(el).setName('字幕翻译').setHeading();
    new Setting(el)
      .setName('目标语言')
      .addText((t) =>
        t.setValue(s.targetLang).onChange((v) => {
          s.targetLang = v.trim() || DEFAULT_SETTINGS.targetLang;
          void this.plugin.saveSettings();
        }),
      );
    new Setting(el)
      .setName('YouTube 自动翻译语言码')
      .setDesc('点「YT翻译」时请求的语言，如 zh-Hans（简体）、zh-Hant（繁体）、ja。免费，但质量一般且容易被限流。')
      .addText((t) =>
        t.setValue(s.ytTransLang).onChange((v) => {
          s.ytTransLang = v.trim() || DEFAULT_SETTINGS.ytTransLang;
          void this.plugin.saveSettings();
        }),
      );
    new Setting(el)
      .setName('接口地址')
      .setDesc('OpenAI 兼容的 base URL，例如 https://api.openai.com/v1')
      .addText((t) =>
        t.setValue(s.apiBase).onChange((v) => {
          s.apiBase = v.trim();
          void this.plugin.saveSettings();
        }),
      );
    new Setting(el)
      .setName('API Key')
      .setDesc('以明文保存在本插件的 data.json 里；同步 vault 时注意别把它一起同步出去。')
      .addText((t) => {
        t.inputEl.type = 'password';
        t.setValue(s.apiKey).onChange((v) => {
          s.apiKey = v.trim();
          void this.plugin.saveSettings();
        });
      });
    new Setting(el)
      .setName('模型')
      .addText((t) =>
        t.setValue(s.model).onChange((v) => {
          s.model = v.trim();
          void this.plugin.saveSettings();
        }),
      );
  }
}
