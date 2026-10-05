import { describe, expect, it } from 'vitest';
import { parseDoc } from './doc';
import { addChildOp, addSiblingOp, deleteNodeOp, setTextOp } from './core/write/ops';
import { parseTimestamp, withTimestamp } from './timestamp';

const NOTE = ['---', 'video: https://youtu.be/dQw4w9WgXcQ', '---', '', '## One [00:10]', 'body', '', '## Two'].join('\n');

describe('mind map edit chain', () => {
  it('a new child gets a clean prefix and a parseable time', () => {
    const d = parseDoc(NOTE, 'T');
    const one = d.root.children[0]!;
    const lines = [...d.lines];
    const r = addChildOp(lines, one);

    r.lines[r.insertedLine] += withTimestamp('新节点', 75);
    const d2 = parseDoc(lines.join('\n'), 'T');
    const child = d2.root.children[0]!.children[0]!;

    expect(parseTimestamp(child.text)).toEqual({ title: '新节点', seconds: 75 });
  });

  it('a new sibling lands after the node', () => {
    const d = parseDoc(NOTE, 'T');
    const lines = [...d.lines];
    const r = addSiblingOp(lines, d.root.children[0]!);

    r.lines[r.insertedLine] += '新节点';
    const d2 = parseDoc(lines.join('\n'), 'T');

    expect(d2.root.children.map((c) => c.text)).toEqual(['One [00:10]', '新节点', 'Two']);
  });

  it('renaming keeps the time and leaves the frontmatter alone', () => {
    const d = parseDoc(NOTE, 'T');
    const lines = [...d.lines];

    setTextOp(lines, d.root.children[0]!, withTimestamp('Renamed', 10));
    expect(lines.join('\n')).toBe(NOTE.replace('One', 'Renamed'));
  });

  it('deleting a node removes its subtree only', () => {
    const d = parseDoc(NOTE, 'T');
    const lines = [...d.lines];

    deleteNodeOp(lines, d.root.children[0]!);
    expect(parseDoc(lines.join('\n'), 'T').root.children.map((c) => c.text)).toEqual(['Two']);
  });
});
