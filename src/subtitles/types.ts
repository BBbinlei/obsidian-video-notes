export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface TrackData {
  /** Where the cues came from: 'youtube', or the imported file's name. */
  source: string;
  lang: string;
  cues: Cue[];
  /** Translated text per target language, index-aligned with `cues`. */
  trans: Record<string, string[]>;
}

/** Index of the last cue starting at or before `t`; -1 before the first. */
export function cueIndexAt(cues: Cue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let ans = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;

    if ((cues[mid]?.start ?? Infinity) <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return ans;
}
