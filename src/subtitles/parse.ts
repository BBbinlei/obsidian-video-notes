import { Cue } from './types';

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

function clean(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

/** `00:01:02,345`, `01:02.345` or `1:02` to seconds; NaN when malformed. */
export function parseClock(s: string): number {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(s.trim());

  if (!m) {
    return NaN;
  }
  const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;

  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + ms / 1000;
}

/** SRT and WebVTT share enough that one reader handles both. */
export function parseSrtVtt(raw: string): Cue[] {
  const blocks = raw
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/);
  const cues: Cue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));

    if (at < 0 || /^(NOTE|STYLE|REGION)\b/.test(lines[0] ?? '')) {
      continue;
    }
    const [a = '', b = ''] = (lines[at] ?? '').split('-->');
    const start = parseClock(a);
    const end = parseClock(b.trim().split(/\s+/)[0] ?? '');
    const text = clean(lines.slice(at + 1).join('\n'));

    if (Number.isFinite(start) && Number.isFinite(end) && text) {
      cues.push({ start, end, text });
    }
  }

  return cues.sort((x, y) => x.start - y.start);
}

interface Json3 {
  events?: {
    tStartMs?: number;
    dDurationMs?: number;
    segs?: { utf8?: string }[];
  }[];
}

/** YouTube's `fmt=json3` caption format. */
export function parseJson3(raw: string): Cue[] {
  let data: Json3;

  try {
    data = JSON.parse(raw) as Json3;
  } catch {
    return [];
  }
  const cues: Cue[] = [];

  for (const ev of data.events ?? []) {
    if (!ev.segs || ev.tStartMs === undefined) {
      continue;
    }
    const text = clean(ev.segs.map((s) => s.utf8 ?? '').join(''));

    if (text) {
      const start = ev.tStartMs / 1000;

      cues.push({ start, end: start + (ev.dDurationMs ?? 2000) / 1000, text });
    }
  }

  return cues;
}

/** Picks the parser from the file name / content. */
export function parseSubtitleFile(name: string, raw: string): Cue[] {
  return /\.json3?$/i.test(name) ? parseJson3(raw) : parseSrtVtt(raw);
}
