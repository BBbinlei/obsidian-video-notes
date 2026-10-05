import { describe, expect, it } from 'vitest';
import { bodyText, parseDoc, readFrontmatter, setBodyOp } from './doc';

const NOTE = [
  '---',
  'video: https://youtu.be/dQw4w9WgXcQ',
  'tags:',
  '  - a',
  '---',
  'intro line',
  '',
  '## One [00:10]',
  'one body',
  '',
  '### Child',
  'child body',
  '',
  '## Two',
].join('\n');

describe('readFrontmatter', () => {
  it('finds the end and the video property', () => {
    const fm = readFrontmatter(NOTE.split('\n'));

    expect(fm).toEqual({ end: 4, video: 'https://youtu.be/dQw4w9WgXcQ' });
  });

  it('reports none when the note has no frontmatter', () => {
    expect(readFrontmatter(['# a'])).toEqual({ end: -1, video: null });
  });
});

describe('parseDoc', () => {
  it('does not turn frontmatter lists into nodes', () => {
    const { root } = parseDoc(NOTE, 'T');

    expect(root.children.map((c) => c.text)).toEqual(['One [00:10]', 'Two']);
  });

  it('keeps real file lines', () => {
    const { root } = parseDoc(NOTE, 'T');

    expect(root.children[0]?.line).toBe(7);
  });
});

describe('bodyText / setBodyOp', () => {
  it('reads the root body after the frontmatter', () => {
    const d = parseDoc(NOTE, 'T');

    expect(bodyText(d.root, d.lines, d.fm)).toBe('intro line');
  });

  it('reads a node body up to its first child', () => {
    const d = parseDoc(NOTE, 'T');

    expect(bodyText(d.root.children[0]!, d.lines, d.fm)).toBe('one body');
  });

  it('replaces only that node body', () => {
    const d = parseDoc(NOTE, 'T');
    const out = setBodyOp([...d.lines], d.root.children[0]!, 'new a\nnew b', d.fm);

    expect(out.join('\n')).toBe(
      NOTE.replace('one body', 'new a\nnew b'),
    );
  });

  it('clears a body without touching neighbours', () => {
    const d = parseDoc(NOTE, 'T');
    const out = setBodyOp([...d.lines], d.root.children[1]!, '', d.fm);

    expect(out.join('\n')).toBe(NOTE);
  });
});

import { chapterMarkers, setVideoOp } from './doc';

describe('chapterMarkers', () => {
  it('lists timed nodes down to depth 2', () => {
    const note = NOTE.replace('child body', 'child body\n\n#### Deep [01:00]\n\n### Sub [00:30]');
    const d = parseDoc(note, 'T');

    // "Deep" sits at depth 3 and is left out; "Sub" is a timed depth-2 node.
    expect(chapterMarkers(d.root).map((c) => [c.title, c.top])).toEqual([
      ['One', true],
      ['Sub', false],
    ]);
  });
});

describe('setVideoOp', () => {
  const URL_A = 'https://youtu.be/dQw4w9WgXcQ';

  it('creates frontmatter when the note has none', () => {
    expect(setVideoOp(['## One', 'body'], URL_A)).toEqual(['---', `video: ${URL_A}`, '---', '', '## One', 'body']);
  });

  it('adds video to existing frontmatter and keeps the other properties', () => {
    const out = setVideoOp(['---', 'tags:', '  - a', '---', 'body'], URL_A);

    expect(out).toEqual(['---', 'tags:', '  - a', `video: ${URL_A}`, '---', 'body']);
  });

  it('replaces an existing video line', () => {
    const out = setVideoOp(['---', 'video: https://old', 'x: 1', '---', 'body'], ` ${URL_A} `);

    expect(out).toEqual(['---', `video: ${URL_A}`, 'x: 1', '---', 'body']);
  });

  it('does not change its input', () => {
    const src = ['body'];

    setVideoOp(src, URL_A);
    expect(src).toEqual(['body']);
  });

  it('round-trips through readFrontmatter', () => {
    expect(readFrontmatter(setVideoOp(['body'], URL_A)).video).toBe(URL_A);
  });
});
