import { Notice } from 'obsidian';
import { Doc, parseDoc } from '../doc';
import { DEFAULT_PALETTE } from '../core/render/colors';
import { DropTarget, findDrop } from '../core/render/drag';
import { LaidNode, layoutTree, makeLaid } from '../core/render/layout';
import { MindNode, findByLine } from '../core/parse/parser';
import {
  addChildOp,
  addSiblingOp,
  deleteNodeOp,
  moveNodeOp,
  setTextOp,
} from '../core/write/ops';
import { formatTimestamp, parseTimestamp, withTimestamp } from '../timestamp';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NEW_NODE = '新节点';

export interface MindMapHost {
  /** Write new file lines, then re-render with `select` chosen. */
  commit(lines: string[], opts: { select: number; edit?: boolean }): void;
  /** The user picked a node. */
  selected(node: MindNode): void;
  /** Current video time in seconds, for stamping new nodes. */
  currentTime(): number;
  undo(): void;
  redo(): void;
}

/** Titles from the top down: stable across line shifts, so folds survive edits. */
function pathKey(node: MindNode): string {
  const parts: string[] = [];

  for (let n: MindNode | null = node; n?.parent; n = n.parent) {
    parts.push(parseTimestamp(n.text).title);
  }

  return parts.reverse().join('\u0001');
}

/**
 * Draws the outline as a tree and turns key presses and drags into line edits.
 * It never owns the text: every change is an `ops` function over the file's
 * lines, handed to the host to write.
 */
export class MindMap {
  private doc: Doc | null = null;
  private sel = -1;
  private editing: number | null = null;
  private readonly collapsed = new Set<string>();
  private readonly scroller: HTMLElement;
  private readonly canvas: HTMLElement;
  private timed: { el: HTMLElement; seconds: number }[] = [];
  private laidByLine = new Map<number, LaidNode>();
  private dragNode: MindNode | null = null;
  private drop: DropTarget | null = null;

  constructor(
    parent: HTMLElement,
    private readonly host: MindMapHost,
  ) {
    this.scroller = parent.createDiv({ cls: 'vn-mm', attr: { tabindex: '0' } });
    this.canvas = this.scroller.createDiv({ cls: 'vn-mm-canvas' });
    this.scroller.addEventListener('keydown', (e) => this.onKey(e));
    this.scroller.addEventListener('dragover', (e) => this.onDragOver(e));
    this.scroller.addEventListener('drop', (e) => this.onDrop(e));
  }

  focus(): void {
    this.scroller.focus();
  }

  selectedLine(): number {
    return this.sel;
  }

  /** Select by line, as if clicked (seeks the video if the node is timed). */
  selectLine(line: number): void {
    this.select(line);
  }

  private nodeAt(line: number): MindNode | null {
    if (!this.doc) {
      return null;
    }

    return line < 0 ? this.doc.root : findByLine(this.doc.root, line);
  }

  render(doc: Doc, select: number, edit = false): void {
    this.doc = doc;
    this.sel = this.nodeAt(select) ? select : -1;
    this.editing = edit ? this.sel : null;
    // A selection inside a folded branch opens the branch.
    for (let a = this.nodeAt(this.sel)?.parent; a?.parent; a = a.parent) {
      this.collapsed.delete(pathKey(a));
    }
    const left = this.scroller.scrollLeft;
    const top = this.scroller.scrollTop;

    this.canvas.empty();
    this.timed = [];
    this.laidByLine = new Map();
    const svg = this.canvas.doc.createElementNS(SVG_NS, 'svg');

    this.canvas.appendChild(svg);
    const laidRoot = this.build(doc.root, DEFAULT_PALETTE[0] ?? 'gray', 0);
    const size = layoutTree(laidRoot);

    this.canvas.style.width = `${size.width}px`;
    this.canvas.style.height = `${size.height}px`;
    svg.setAttribute('width', String(size.width));
    svg.setAttribute('height', String(size.height));
    this.place(laidRoot, svg);
    this.scroller.scrollLeft = left;
    this.scroller.scrollTop = top;
    if (this.editing !== null) {
      const input = this.canvas.querySelector('input');

      input?.focus();
      input?.select();
    }
  }

  private isFolded(node: MindNode): boolean {
    return node.children.length > 0 && node.type !== 'root' && this.collapsed.has(pathKey(node));
  }

  private build(node: MindNode, color: string, depth: number): LaidNode {
    const el = this.canvas.createDiv({
      cls: 'vn-node' + (depth === 0 ? ' is-root' : ''),
    });
    const { title, seconds } = parseTimestamp(node.text);
    const folded = this.isFolded(node);

    el.dataset.line = String(node.line);
    el.style.setProperty('--vn-c', color);
    el.toggleClass('is-sel', node.line === this.sel);
    if (this.editing === node.line) {
      this.buildEditor(el, node, title);
    } else {
      el.createSpan({ cls: 'vn-dot' });
      el.createSpan({ cls: 'vn-title', text: title || '（空）' });
      if (folded) {
        el.createSpan({
          cls: 'vn-fold',
          text: `+${countDescendants(node)}`,
          attr: { 'data-act': 'unfold', title: '展开' },
        });
      }
      if (seconds !== null) {
        el.createSpan({ cls: 'vn-tm', text: formatTimestamp(seconds) });
        this.timed.push({ el, seconds });
      }
      this.buildActions(el, node, folded);
      el.addEventListener('click', (e) => {
        const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');

        if (act) {
          e.stopPropagation();
          this.act(act.dataset.act ?? '', node);
        } else {
          this.select(node.line);
        }
      });
      el.addEventListener('dblclick', () => this.startEdit(node.line));
      if (node.type !== 'root') {
        el.draggable = true;
        el.addEventListener('dragstart', (e) => {
          this.dragNode = node;
          e.dataTransfer?.setData('text/plain', node.text);
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
          }
          el.addClass('is-dragging');
        });
        el.addEventListener('dragend', () => this.endDrag());
      }
    }
    const laid = makeLaid(node, el, color);

    this.laidByLine.set(node.line, laid);
    if (!folded) {
      laid.children = node.children.map((c, i) =>
        this.build(
          c,
          depth === 0 ? (DEFAULT_PALETTE[i % DEFAULT_PALETTE.length] ?? color) : color,
          depth + 1,
        ),
      );
    }

    return laid;
  }

  private buildActions(el: HTMLElement, node: MindNode, folded: boolean): void {
    const bar = el.createDiv({ cls: 'vn-abar' });
    const items: [string, string, string][] = [
      ['child', '＋子', 'Tab'],
      ['sib', '＋同级', 'Enter'],
      ['stamp', '⏱', '用当前播放时间打点'],
    ];

    if (node.children.length && node.type !== 'root') {
      items.push([folded ? 'unfold' : 'fold', folded ? '⊞' : '⊟', 'Ctrl+←/→ 折叠/展开']);
    }
    if (node.type !== 'root') {
      items.push(['del', '🗑', 'Delete']);
    }
    for (const [act, label, tip] of items) {
      bar.createEl('button', { text: label, attr: { 'data-act': act, title: tip } });
    }
  }

  private buildEditor(el: HTMLElement, node: MindNode, title: string): void {
    const input = el.createEl('input', { type: 'text' });

    input.value = title;
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) {
        return;
      }
      done = true;
      this.editing = null;
      const value = input.value.trim();

      if (ok && value && value !== title && this.doc) {
        const lines = [...this.doc.lines];
        const { seconds } = parseTimestamp(node.text);
        const typed = parseTimestamp(value);
        const text =
          typed.seconds === null && seconds !== null
            ? withTimestamp(value, seconds)
            : value;

        setTextOp(lines, node, text);
        this.host.commit(lines, { select: node.line });
      } else if (this.doc) {
        this.render(this.doc, node.line);
        this.focus();
      }
    };

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        finish(true);
      } else if (e.key === 'Escape') {
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  private place(laid: LaidNode, svg: SVGElement): void {
    laid.el.style.left = `${laid.x}px`;
    laid.el.style.top = `${laid.y}px`;
    for (const c of laid.children) {
      const x1 = laid.x + laid.w;
      const y1 = laid.y + laid.h / 2;
      const x2 = c.x;
      const y2 = c.y + c.h / 2;
      const mx = (x1 + x2) / 2;
      const path = svg.doc.createElementNS(SVG_NS, 'path');

      path.setAttribute('d', `M${x1} ${y1} C${mx} ${y1},${mx} ${y2},${x2} ${y2}`);
      path.setAttribute('stroke', c.color);
      svg.appendChild(path);
      this.place(c, svg);
    }
  }

  /** Marks the node whose time is the latest one at or before `t`. */
  setTime(t: number, playing: boolean): void {
    let best: { el: HTMLElement; seconds: number } | null = null;

    for (const n of this.timed) {
      if (n.seconds <= t && (!best || n.seconds >= best.seconds)) {
        best = n;
      }
    }
    for (const n of this.timed) {
      n.el.toggleClass('is-now', playing && n === best);
    }
  }

  private select(line: number): void {
    const node = this.nodeAt(line);

    if (!node) {
      return;
    }
    this.sel = line;
    this.canvas.querySelectorAll('.vn-node').forEach((el) => {
      el.toggleClass('is-sel', (el as HTMLElement).dataset.line === String(line));
    });
    this.canvas
      .querySelector<HTMLElement>(`.vn-node[data-line="${line}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.focus();
    this.host.selected(node);
  }

  private startEdit(line: number): void {
    if (this.doc) {
      this.render(this.doc, line, true);
    }
  }

  private setFold(node: MindNode, fold: boolean): void {
    if (!this.doc || !node.children.length || node.type === 'root') {
      return;
    }
    if (fold) {
      this.collapsed.add(pathKey(node));
    } else {
      this.collapsed.delete(pathKey(node));
    }
    this.render(this.doc, node.line);
    this.focus();
  }

  private act(act: string, node: MindNode): void {
    if (!this.doc) {
      return;
    }
    const lines = [...this.doc.lines];

    if (act === 'fold' || act === 'unfold') {
      this.setFold(node, act === 'fold');
    } else if (act === 'child' || (act === 'sib' && node.type === 'root')) {
      this.insert(lines, addChildOp(lines, node));
    } else if (act === 'sib') {
      this.insert(lines, addSiblingOp(lines, node));
    } else if (act === 'stamp') {
      setTextOp(lines, node, withTimestamp(node.text, this.host.currentTime()));
      this.host.commit(lines, { select: node.line });
    } else if (act === 'del' && node.type !== 'root') {
      const sibs = node.parent?.children ?? [];
      const prev = sibs[sibs.indexOf(node) - 1];

      deleteNodeOp(lines, node);
      this.host.commit(lines, { select: prev ? prev.line : (node.parent?.line ?? -1) });
    }
  }

  private insert(lines: string[], r: { lines: string[]; insertedLine: number }): void {
    const t = this.host.currentTime();

    r.lines[r.insertedLine] =
      (r.lines[r.insertedLine] ?? '') +
      (t > 0 ? withTimestamp(NEW_NODE, t) : NEW_NODE);
    this.host.commit(lines, { select: r.insertedLine, edit: true });
  }

  /* ---------- drag to reorder / reparent ---------- */

  private clearDropMarks(): void {
    this.canvas
      .querySelectorAll('.drop-into, .drop-before, .drop-after')
      .forEach((el) => el.removeClasses(['drop-into', 'drop-before', 'drop-after']));
  }

  private endDrag(): void {
    this.dragNode = null;
    this.drop = null;
    this.clearDropMarks();
    this.canvas.querySelectorAll('.is-dragging').forEach((el) => el.removeClass('is-dragging'));
  }

  private onDragOver(e: DragEvent): void {
    if (!this.dragNode) {
      return;
    }
    e.preventDefault();
    this.drop = findDrop(this.laidByLine, [this.dragNode], e.clientX, e.clientY);
    this.clearDropMarks();
    const d = this.drop;

    if (d) {
      d.laid.el.addClass(
        d.parent === null ? 'drop-into' : d.before === d.laid.node ? 'drop-before' : 'drop-after',
      );
    }
  }

  private onDrop(e: DragEvent): void {
    e.preventDefault();
    const node = this.dragNode;
    const drop = this.drop;

    this.endDrag();
    if (!node || !drop || !this.doc) {
      return;
    }
    const newParent = drop.parent ?? drop.laid.node;
    const lines = [...this.doc.lines];

    try {
      moveNodeOp(lines, node, newParent, drop.parent ? drop.before : null);
    } catch (err) {
      new Notice(`无法移动这个节点：${err instanceof Error ? err.message : String(err)}`);

      return;
    }
    if (drop.parent === null) {
      this.collapsed.delete(pathKey(newParent));
    }
    this.host.commit(lines, {
      select: this.findMoved(lines, node, newParent),
    });
  }

  /** After a move the node has a new line: find it by title under its new parent. */
  private findMoved(lines: string[], moved: MindNode, parent: MindNode): number {
    if (!this.doc) {
      return -1;
    }
    const next = parseDoc(lines.join('\n'), this.doc.root.text);
    let found = -1;
    const walk = (n: MindNode): void => {
      if (
        found < 0 &&
        n.parent &&
        n.text === moved.text &&
        n.parent.text === parent.text
      ) {
        found = n.line;
      }
      n.children.forEach(walk);
    };

    walk(next.root);

    return found;
  }

  /* ---------- keyboard ---------- */

  private onKey(e: KeyboardEvent): void {
    if (this.editing !== null) {
      return;
    }
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'z') {
      e.shiftKey ? this.host.redo() : this.host.undo();
      e.preventDefault();

      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'y') {
      this.host.redo();
      e.preventDefault();

      return;
    }
    const node = this.nodeAt(this.sel);

    if (!node) {
      return;
    }
    const sibs = node.parent?.children ?? [node];
    const i = sibs.indexOf(node);
    const go = (n: MindNode | undefined | null): void => {
      if (n) {
        this.select(n.line);
      }
    };

    if (mod && e.key === 'ArrowLeft') {
      node.children.length && !this.isFolded(node) ? this.setFold(node, true) : go(node.parent);
      e.preventDefault();

      return;
    }
    if (mod && e.key === 'ArrowRight') {
      this.setFold(node, false);
      e.preventDefault();

      return;
    }
    switch (e.key) {
      case 'ArrowUp':
        go(sibs[i - 1]);
        break;
      case 'ArrowDown':
        go(sibs[i + 1]);
        break;
      case 'ArrowLeft':
        go(node.parent);
        break;
      case 'ArrowRight':
        if (this.isFolded(node)) {
          this.setFold(node, false);
        } else {
          go(node.children[0]);
        }
        break;
      case 'Tab':
        this.act('child', node);
        break;
      case 'Enter':
        this.act('sib', node);
        break;
      case 'F2':
        this.startEdit(node.line);
        break;
      case 'Delete':
      case 'Backspace':
        this.act('del', node);
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}

function countDescendants(n: MindNode): number {
  return n.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}
