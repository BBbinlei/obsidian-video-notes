export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** One chat-completion call; the plugin supplies the HTTP part. */
export type ChatCall = (messages: ChatMessage[]) => Promise<string>;

export const BATCH_SIZE = 25;

export function buildMessages(lang: string, lines: string[]): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        `You translate video subtitles into ${lang}. ` +
        'You get a JSON array of subtitle lines. Reply with ONLY a JSON array of strings: ' +
        'the same number of items, same order, one translation per line. ' +
        'Keep each line short and natural for subtitles. Do not merge, split, add or drop lines.',
    },
    { role: 'user', content: JSON.stringify(lines) },
  ];
}

/** The reply as `n` strings, or null when it is not exactly that. */
export function parseReply(reply: string, n: number): string[] | null {
  const m = /\[[\s\S]*\]/.exec(reply);

  if (!m) {
    return null;
  }
  try {
    const arr: unknown = JSON.parse(m[0]);

    if (
      Array.isArray(arr) &&
      arr.length === n &&
      arr.every((x) => typeof x === 'string')
    ) {
      return arr as string[];
    }
  } catch {
    // fall through
  }

  return null;
}

export interface TranslateOptions {
  lang: string;
  call: ChatCall;
  /** Already-translated lines to keep ('' = still to do). */
  existing?: string[];
  onProgress?: (done: number, total: number, partial: string[]) => void;
  isCancelled?: () => boolean;
}

export interface TranslateResult {
  out: string[];
  failed: number;
  /** Why the last failed batch failed, for showing to the user. */
  lastError: string | null;
}

/** A call that throws (bad key, wrong URL, quota) fails every batch alike, so stop early. */
const MAX_CALL_ERRORS = 2;

/**
 * Translates every line that has no translation yet, in batches. A batch whose
 * reply is unusable twice is left blank and counted in `failed`. Two batches
 * in a row that *throw* abort the run with that error: it would only repeat.
 */
export async function translateAll(
  texts: string[],
  opts: TranslateOptions,
): Promise<TranslateResult> {
  const out = texts.map((_, i) => opts.existing?.[i] ?? '');
  const todo = out.flatMap((t, i) => (t ? [] : [i]));
  let failed = 0;
  let done = texts.length - todo.length;
  let lastError: string | null = null;
  let callErrors = 0;

  for (let at = 0; at < todo.length; at += BATCH_SIZE) {
    if (opts.isCancelled?.()) {
      break;
    }
    const idx = todo.slice(at, at + BATCH_SIZE);
    const lines = idx.map((i) => texts[i] ?? '');
    let result: string[] | null = null;
    let threw = false;

    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        const reply = await opts.call(buildMessages(opts.lang, lines));

        result = parseReply(reply, lines.length);
        if (!result) {
          threw = false;
          lastError = `模型的回复不是预期的 JSON 数组（需要 ${lines.length} 项）：${reply.slice(0, 120)}`;
        }
      } catch (e) {
        threw = true;
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    if (result) {
      callErrors = 0;
      idx.forEach((i, k) => (out[i] = result![k] ?? ''));
    } else {
      failed += idx.length;
      callErrors = threw ? callErrors + 1 : 0;
      if (callErrors >= MAX_CALL_ERRORS) {
        return { out, failed: out.filter((t) => !t).length, lastError };
      }
    }
    done += idx.length;
    opts.onProgress?.(done, texts.length, out);
  }

  return { out, failed, lastError };
}
