import { describe, expect, it } from 'vitest';
import { BATCH_SIZE, parseReply, translateAll } from './translate';

describe('parseReply', () => {
  it('reads a bare array', () => {
    expect(parseReply('["a","b"]', 2)).toEqual(['a', 'b']);
  });

  it('reads an array wrapped in prose or a code fence', () => {
    expect(parseReply('Sure:\n```json\n["a","b"]\n```', 2)).toEqual(['a', 'b']);
  });

  it('rejects the wrong length or non-strings', () => {
    expect(parseReply('["a"]', 2)).toBeNull();
    expect(parseReply('[1,2]', 2)).toBeNull();
    expect(parseReply('no json', 1)).toBeNull();
  });
});

describe('translateAll', () => {
  const echo = (m: { content: string }[]): Promise<string> =>
    Promise.resolve(JSON.stringify((JSON.parse(m[1]!.content) as string[]).map((s) => `zh:${s}`)));

  it('translates in batches and reports progress', async () => {
    const texts = Array.from({ length: BATCH_SIZE + 5 }, (_, i) => `t${i}`);
    const seen: number[] = [];
    const r = await translateAll(texts, {
      lang: '简体中文',
      call: echo,
      onProgress: (d) => seen.push(d),
    });

    expect(r.failed).toBe(0);
    expect(r.out[0]).toBe('zh:t0');
    expect(r.out.at(-1)).toBe(`zh:t${BATCH_SIZE + 4}`);
    expect(seen).toEqual([BATCH_SIZE, BATCH_SIZE + 5]);
  });

  it('skips lines that already have a translation', async () => {
    let calls = 0;
    const r = await translateAll(['a', 'b'], {
      lang: 'x',
      existing: ['A', ''],
      call: (m) => {
        calls++;

        return echo(m);
      },
    });

    expect(r.out).toEqual(['A', 'zh:b']);
    expect(calls).toBe(1);
  });

  it('retries once, then leaves a failed batch blank', async () => {
    let calls = 0;
    const r = await translateAll(['a', 'b'], {
      lang: 'x',
      call: () => {
        calls++;

        return Promise.resolve('garbage');
      },
    });

    expect(calls).toBe(2);
    expect(r.out).toEqual(['', '']);
    expect(r.failed).toBe(2);
    expect(r.lastError).toContain('不是预期的 JSON');
  });

  it('stops when cancelled', async () => {
    const texts = Array.from({ length: BATCH_SIZE * 2 }, (_, i) => `t${i}`);
    let n = 0;
    const r = await translateAll(texts, {
      lang: 'x',
      call: echo,
      isCancelled: () => n++ >= 1,
    });

    expect(r.out.filter(Boolean)).toHaveLength(BATCH_SIZE);
  });

  it('aborts early with the error when every call throws', async () => {
    let calls = 0;
    const texts = Array.from({ length: BATCH_SIZE * 10 }, (_, i) => `t${i}`);
    const r = await translateAll(texts, {
      lang: 'x',
      call: () => {
        calls++;

        return Promise.reject(new Error('401 invalid api key'));
      },
    });

    // two batches x two attempts, not all ten batches
    expect(calls).toBe(4);
    expect(r.lastError).toBe('401 invalid api key');
    expect(r.failed).toBe(texts.length);
  });

  it('keeps going when one batch throws but the next works', async () => {
    let n = 0;
    const texts = Array.from({ length: BATCH_SIZE * 2 }, (_, i) => `t${i}`);
    const r = await translateAll(texts, {
      lang: 'x',
      call: (m) => (n++ < 2 ? Promise.reject(new Error('503')) : echo(m)),
    });

    expect(r.out.filter(Boolean)).toHaveLength(BATCH_SIZE);
    expect(r.failed).toBe(BATCH_SIZE);
  });
});
