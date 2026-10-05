import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('undoes and redoes in order', () => {
    const h = new History<string>();

    h.push('a'); // a -> b
    h.push('b'); // b -> c

    expect(h.undo('c')).toBe('b');
    expect(h.undo('b')).toBe('a');
    expect(h.undo('a')).toBeNull();
    expect(h.redo('a')).toBe('b');
    expect(h.redo('b')).toBe('c');
    expect(h.redo('c')).toBeNull();
  });

  it('drops the redo stack on a new change', () => {
    const h = new History<string>();

    h.push('a');
    h.undo('b');
    h.push('a');
    expect(h.redo('b')).toBeNull();
  });

  it('keeps at most `limit` steps', () => {
    const h = new History<number>(2);

    h.push(1);
    h.push(2);
    h.push(3);
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBeNull();
  });
});
