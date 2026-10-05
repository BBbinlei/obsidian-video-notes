import { describe, expect, it } from 'vitest';
import { parseClock, parseJson3, parseSrtVtt } from './parse';
import { cueIndexAt } from './types';

describe('parseClock', () => {
  it('reads srt, vtt and short forms', () => {
    expect(parseClock('00:01:02,500')).toBe(62.5);
    expect(parseClock('01:02.250')).toBe(62.25);
    expect(parseClock('1:02')).toBe(62);
  });

  it('rejects garbage', () => {
    expect(parseClock('abc')).toBeNaN();
  });
});

describe('parseSrtVtt', () => {
  it('parses srt blocks, stripping tags and joining lines', () => {
    const srt = '1\n00:00:01,000 --> 00:00:03,000\nHello <i>world</i>\nsecond line\n\n2\n00:00:04,000 --> 00:00:05,500\nBye &amp; thanks\n';

    expect(parseSrtVtt(srt)).toEqual([
      { start: 1, end: 3, text: 'Hello world second line' },
      { start: 4, end: 5.5, text: 'Bye & thanks' },
    ]);
  });

  it('parses webvtt, skipping the header, notes and cue settings', () => {
    const vtt = 'WEBVTT\n\nNOTE a comment\n\n00:01.000 --> 00:02.000 align:start\nHi\n';

    expect(parseSrtVtt(vtt)).toEqual([{ start: 1, end: 2, text: 'Hi' }]);
  });

  it('handles CRLF and a BOM', () => {
    expect(parseSrtVtt('﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nA\r\n')).toHaveLength(1);
  });
});

describe('parseJson3', () => {
  it('joins segments and skips empty events', () => {
    const json = JSON.stringify({
      events: [
        { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hel' }, { utf8: 'lo' }] },
        { tStartMs: 3000, segs: [{ utf8: '\n' }] },
        { tStartMs: 4000, dDurationMs: 1000, segs: [{ utf8: 'Bye' }] },
      ],
    });

    expect(parseJson3(json)).toEqual([
      { start: 1, end: 3, text: 'Hello' },
      { start: 4, end: 5, text: 'Bye' },
    ]);
  });

  it('returns nothing for a non-json body', () => {
    expect(parseJson3('')).toEqual([]);
  });
});

describe('cueIndexAt', () => {
  const cues = [
    { start: 1, end: 2, text: 'a' },
    { start: 5, end: 6, text: 'b' },
  ];

  it('finds the latest cue at or before t', () => {
    expect(cueIndexAt(cues, 0)).toBe(-1);
    expect(cueIndexAt(cues, 1)).toBe(0);
    expect(cueIndexAt(cues, 4.9)).toBe(0);
    expect(cueIndexAt(cues, 99)).toBe(1);
  });
});
