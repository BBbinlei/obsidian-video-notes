import { MindNode, parseMarkdown } from './core/parse/parser';
import { parseTimestamp } from './timestamp';
export interface Frontmatter {
  /** Line index of the closing `---`, or -1 when the note has none. */
  end: number;
  /** The `video:` property, if any. */
  video: string | null;
}

export interface Doc {
  lines: string[];
  fm: Frontmatter;
  root: MindNode;
}

export function readFrontmatter(lines: string[]): Frontmatter {
  if (lines[0]?.trim() !== '---') {
    return { end: -1, video: null };
  }
  let video: string | null = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (line.trim() === '---') {
      return { end: i, video };
    }
    const m = /^video:\s*(.+?)\s*$/.exec(line);

    if (m) {
      video = (m[1] ?? '').replace(/^["']|["']$/g, '');
    }
  }

  return { end: -1, video: null };
}

/**
 * Parses a note into a mind map. The frontmatter is blanked out (not removed)
 * before parsing so its YAML lists never become nodes and every node keeps its
 * real file line.
 */
export function parseDoc(text: string, title: string): Doc {
  const lines = text.split(/\r?\n/);
  const fm = readFrontmatter(lines);
  const masked = lines.map((l, i) => (i <= fm.end ? '' : l));

  return { lines, fm, root: parseMarkdown(masked.join('\n'), title) };
}

/** The file lines holding a node's own text: [start, end). */
export function bodyRange(
  node: MindNode,
  lines: string[],
  fm: Frontmatter,
): { start: number; end: number } {
  const isRoot = node.line < 0;
  const start = isRoot ? fm.end + 1 : node.line + 1;
  const end = node.children[0]?.line ?? (isRoot ? lines.length : node.endLine + 1);

  return { start, end: Math.max(start, end) };
}

export function bodyText(
  node: MindNode,
  lines: string[],
  fm: Frontmatter,
): string {
  const { start, end } = bodyRange(node, lines, fm);

  return lines.slice(start, end).join('\n').replace(/^\n+|\s+$/g, '');
}

/** Replaces a node's own text lines; nothing else in the file moves. */
export function setBodyOp(
  lines: string[],
  node: MindNode,
  text: string,
  fm: Frontmatter,
): string[] {
  const { start, end } = bodyRange(node, lines, fm);
  const body = text.trim() === '' ? [] : text.replace(/\s+$/, '').split('\n');

  // Keep a blank line before whatever follows, as the file had it.
  if (body.length && end < lines.length) {
    body.push('');
  }
  lines.splice(start, end - start, ...body);

  return lines;
}

export interface Chapter {
  seconds: number;
  line: number;
  title: string;
  /** Depth 1 chapters are drawn taller on the progress bar. */
  top: boolean;
}

/** Timed nodes at depth 1-2: they become the markers on the progress bar. */
export function chapterMarkers(root: MindNode): Chapter[] {
  const out: Chapter[] = [];
  const walk = (n: MindNode, depth: number): void => {
    if (depth >= 1) {
      const { title, seconds } = parseTimestamp(n.text);

      if (seconds !== null) {
        out.push({ seconds, line: n.line, title, top: depth === 1 });
      }
    }
    if (depth < 2) {
      n.children.forEach((c) => walk(c, depth + 1));
    }
  };

  walk(root, 0);

  return out;
}

/**
 * Sets the `video:` property, creating the frontmatter if the note has none.
 * Other properties and the body are left exactly as they were.
 */
export function setVideoOp(lines: string[], url: string): string[] {
  const out = [...lines];
  const fm = readFrontmatter(out);
  const prop = `video: ${url.trim()}`;

  if (fm.end < 0) {
    return ['---', prop, '---', '', ...out];
  }
  for (let i = 1; i < fm.end; i++) {
    if (/^video:/.test(out[i] ?? '')) {
      out[i] = prop;

      return out;
    }
  }
  out.splice(fm.end, 0, prop);

  return out;
}

/**
 * Where a selected line ends up after the body of the node at `editedLine`
 * grew or shrank by `delta` lines: everything after it moves, the rest stays.
 */
export function shiftSelection(sel: number, editedLine: number, delta: number): number {
  return sel > editedLine ? sel + delta : sel;
}
