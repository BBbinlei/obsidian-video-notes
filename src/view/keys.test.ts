import { describe, expect, it } from 'vitest';
import { isComposingKey } from './keys';

describe('isComposingKey', () => {
  it('is true while the input method is composing', () => {
    expect(isComposingKey({ isComposing: true, keyCode: 13 })).toBe(true);
  });

  it('is true for the 229 "processing" key code', () => {
    expect(isComposingKey({ isComposing: false, keyCode: 229 })).toBe(true);
  });

  it('is false for an ordinary Enter', () => {
    expect(isComposingKey({ isComposing: false, keyCode: 13 })).toBe(false);
  });
});
