import { describe, expect, it } from 'vitest';
import { formatTimestamp, parseTimestamp, withTimestamp } from './timestamp';

describe('parseTimestamp', () => {
  it('reads a trailing [mm:ss]', () => {
    expect(parseTimestamp('四个步骤 [02:40]')).toEqual({
      title: '四个步骤',
      seconds: 160,
    });
  });

  it('reads [h:mm:ss]', () => {
    expect(parseTimestamp('Intro [1:02:03]')).toEqual({
      title: 'Intro',
      seconds: 3723,
    });
  });

  it('returns null for text without a time', () => {
    expect(parseTimestamp('plain')).toEqual({ title: 'plain', seconds: null });
  });

  it('ignores a time that is not at the end', () => {
    expect(parseTimestamp('[02:40] later words').seconds).toBeNull();
  });

  it('rejects seconds above 59', () => {
    expect(parseTimestamp('x [01:75]').seconds).toBeNull();
  });
});

describe('formatTimestamp', () => {
  it('pads minutes and seconds', () => {
    expect(formatTimestamp(65)).toBe('01:05');
  });

  it('switches to h:mm:ss at an hour', () => {
    expect(formatTimestamp(3723)).toBe('1:02:03');
  });

  it('floors fractions and clamps negatives', () => {
    expect(formatTimestamp(59.9)).toBe('00:59');
    expect(formatTimestamp(-4)).toBe('00:00');
  });
});

describe('withTimestamp', () => {
  it('appends a time', () => {
    expect(withTimestamp('Hello', 90)).toBe('Hello [01:30]');
  });

  it('replaces an existing time', () => {
    expect(withTimestamp('Hello [01:30]', 125)).toBe('Hello [02:05]');
  });

  it('removes the time when null', () => {
    expect(withTimestamp('Hello [01:30]', null)).toBe('Hello');
  });
});
