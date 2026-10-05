// A node's time lives at the end of its text as ` [mm:ss]` (or `[h:mm:ss]`),
// so the note stays plain Markdown and stays readable without the plugin.

const TS_RE = /\s*\[(\d{1,3}):([0-5]\d)(?::([0-5]\d))?\]\s*$/;

export interface TimedText {
  title: string;
  seconds: number | null;
}

export function parseTimestamp(text: string): TimedText {
  const m = TS_RE.exec(text);

  if (!m) {
    return { title: text, seconds: null };
  }
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = m[3] === undefined ? null : Number(m[3]);
  const seconds = c === null ? a * 60 + b : a * 3600 + b * 60 + c;

  return { title: text.slice(0, m.index), seconds };
}

export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');

  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** The node text with its time replaced (or removed when `seconds` is null). */
export function withTimestamp(text: string, seconds: number | null): string {
  const { title } = parseTimestamp(text);

  return seconds === null ? title : `${title} [${formatTimestamp(seconds)}]`;
}
