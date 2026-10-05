import { describe, expect, it } from 'vitest';
import { parseVideoUrl } from './types';

describe('parseVideoUrl', () => {
  it('parses a youtube watch url', () => {
    expect(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      kind: 'youtube',
      id: 'dQw4w9WgXcQ',
      start: 0,
    });
  });

  it('parses youtu.be with a start time', () => {
    expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s')).toEqual({
      kind: 'youtube',
      id: 'dQw4w9WgXcQ',
      start: 90,
    });
  });

  it('parses an embed url', () => {
    expect(parseVideoUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toMatchObject({
      kind: 'youtube',
      id: 'dQw4w9WgXcQ',
    });
  });

  it('parses a bilibili video with a part number', () => {
    expect(
      parseVideoUrl('https://www.bilibili.com/video/BV1xx411c7mD/?p=3'),
    ).toEqual({ kind: 'bilibili', bvid: 'BV1xx411c7mD', page: 3 });
  });

  it('returns null for other sites and garbage', () => {
    expect(parseVideoUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseVideoUrl('not a url')).toBeNull();
    expect(parseVideoUrl('https://www.youtube.com/watch?v=short')).toBeNull();
  });
});
