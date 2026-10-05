import { requestUrl } from 'obsidian';
import { Settings } from './settings';
import { ChatCall } from './subtitles/translate';
import { Http } from './subtitles/youtube';

/** requestUrl runs outside the browser sandbox, so no CORS in the way. */
export const obsidianHttp: Http = {
  async get(url, headers) {
    const r = await requestUrl({ url, headers, throw: false });

    return r.text;
  },
  async post(url, body, headers) {
    const r = await requestUrl({
      url,
      method: 'POST',
      headers,
      contentType: 'application/json',
      body: JSON.stringify(body),
      throw: false,
    });

    return r.text;
  },
};

export function makeChatCall(s: Settings): ChatCall {
  const url = `${s.apiBase.replace(/\/+$/, '')}/chat/completions`;

  return async (messages) => {
    const r = await requestUrl({
      url,
      method: 'POST',
      headers: { Authorization: `Bearer ${s.apiKey}` },
      contentType: 'application/json',
      body: JSON.stringify({ model: s.model, messages, temperature: 0.2 }),
      throw: false,
    });

    if (r.status >= 400) {
      throw new Error(`${r.status} ${r.text.slice(0, 200)}`);
    }
    const json = r.json as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;

    if (typeof content !== 'string') {
      throw new Error('接口返回里没有 choices[0].message.content');
    }

    return content;
  };
}
