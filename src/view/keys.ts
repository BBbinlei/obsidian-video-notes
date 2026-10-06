/**
 * True for a key event that belongs to an input method (pinyin, kana, ...)
 * still composing text. Its Enter picks a candidate and its Escape cancels the
 * composition; neither should be taken as "save/discard the whole edit".
 * `keyCode 229` is how some environments mark the same thing.
 */
export function isComposingKey(e: { isComposing: boolean; keyCode: number }): boolean {
  return e.isComposing || e.keyCode === 229;
}
