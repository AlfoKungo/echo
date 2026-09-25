// Asks the local Qwen3 (Ollama) for the facts about one word form. Thinking is on: it is slow (about 10–20 s a
// word) but far more careful about genders, headwords and senses. num_predict bounds a runaway answer, which
// Ollama would otherwise keep generating after the request is abandoned; num_ctx leaves room for the thinking
// (Ollama's default 4096-token window cut long answers off).
import { StoreError } from './store';
import { FACTS_RULES, FACTS_SCHEMA, factsPrompt, type LyricForm, type WordFacts } from './song-words';

const KINDS = new Set(['word', 'name', 'sound', 'foreign']);

export function createQwen(options: { url?: string; model?: string } = {}) {
  const url = (options.url ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = options.model ?? 'qwen3:8b';
  return async function ask(entry: LyricForm): Promise<WordFacts> {
    let seed = 7;
    for (let attempt = 0; attempt < 3; attempt++, seed++) {
      let response: Response;
      try {
        response = await fetch(`${url}/api/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(240_000),
          body: JSON.stringify({
            model, stream: false, think: true, format: FACTS_SCHEMA,
            options: { temperature: 0, seed, num_predict: 4000, num_ctx: 8192 },
            messages: [{ role: 'system', content: FACTS_RULES }, { role: 'user', content: factsPrompt(entry) }],
          }),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'TimeoutError') continue;
        throw new StoreError('Qwen is not running on your Mac. Open Ollama, then try the song again.', 503);
      }
      if (response.status === 404) throw new StoreError(`Qwen (${model}) is not installed in Ollama. Run: ollama pull ${model}`, 503);
      if (!response.ok) continue;
      try {
        const facts = JSON.parse((await response.json() as { message: { content: string } }).message.content) as WordFacts;
        if (KINDS.has(facts.kind) && typeof facts.base === 'string' && typeof facts.en === 'string') return facts;
      } catch { /* a cut-off answer: ask again with another seed */ }
    }
    throw new Error(`No clear answer for ${entry.form}`);
  };
}
