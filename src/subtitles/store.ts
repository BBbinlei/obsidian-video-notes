import { App } from 'obsidian';
import { TrackData } from './types';

/** Subtitle + translation cache, one JSON file per video, in the plugin folder. */
export class SubtitleStore {
  constructor(
    private readonly app: App,
    private readonly dir: string,
  ) {}

  private path(key: string): string {
    return `${this.dir}/cache/${key.replace(/[^\w-]/g, '_')}.json`;
  }

  async load(key: string): Promise<TrackData | null> {
    const p = this.path(key);
    const fs = this.app.vault.adapter;

    try {
      if (!(await fs.exists(p))) {
        return null;
      }
      const data = JSON.parse(await fs.read(p)) as TrackData;

      return Array.isArray(data.cues) ? { ...data, trans: data.trans ?? {} } : null;
    } catch {
      return null;
    }
  }

  async save(key: string, data: TrackData): Promise<void> {
    const fs = this.app.vault.adapter;
    const cache = `${this.dir}/cache`;

    if (!(await fs.exists(cache))) {
      await fs.mkdir(cache);
    }
    await fs.write(this.path(key), JSON.stringify(data));
  }
}
