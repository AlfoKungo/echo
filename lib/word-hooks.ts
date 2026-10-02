// Memory hooks: for a word missed TROUBLE_MISSES times, or a verb form that stays shaky (lib/verb-drills.ts), Claude
// (Opus) writes one short, vivid way to remember it, shown on the answer side. Written in the background, a batch at
// a time, and kept; a failed request waits RETRY_AFTER before the next try.
import type { Ask } from './claude';
import type { Store } from './store';
import type { VerbDrills } from './verb-drills';

const BATCH = 15;
const MAX_LENGTH = 240;
const RETRY_AFTER = 6 * 3_600_000;

function wordPrompt(words: ReturnType<Store['hookless']>): string {
  return `Echo is an app for an English speaker learning French (A1 to A2). The learner keeps forgetting the French words below. For each, write one memory hook: one or two short sentences that make the word stick, through an English sound-alike, a vivid picture, or a real English cousin of the word. Say "sounds like" rather than "comes from" unless the word really comes from it; never invent a history. Name the French word and what it means. When the word is listed with words it gets mixed up with, the hook may also say how to tell it from them. Plain English, under ${MAX_LENGTH} characters.

${JSON.stringify(words.map(({ id, fr, en, note, alongside }) => ({ id, fr, en, ...(note ? { note } : {}), ...(alongside.length ? { mixedUpWith: alongside } : {}) })))}

Reply with only JSON: {"hooks": [{"id": "...", "hook": "..."}]} with one entry for every id above.`;
}

function formPrompt(forms: ReturnType<VerbDrills['hookless']>): string {
  return `Echo is an app for an English speaker learning French (A1 to A2). The learner keeps getting the French verb forms below wrong. For each, write one memory hook: one or two short sentences that make this form stick — the pattern it follows or breaks, how it sounds next to the verb's other forms (silent endings, a changed stem), or a link to a form or English word they already know. Name the form. When wrong answers are listed, the hook may say how to tell the right form from them. Be exact about French: never invent a rule or a history. Plain English, under ${MAX_LENGTH} characters.

${JSON.stringify(forms.map(({ id, form, verb, means, tense, wrongAnswers }) => ({ id, form, verb, means, tense, ...(wrongAnswers.length ? { wrongAnswers } : {}) })))}

Reply with only JSON: {"hooks": [{"id": "...", "hook": "..."}]} with one entry for every id above.`;
}

// One kind of hook: what still needs one, how to ask for them, and where they go.
function createHookWriter<T extends { id: string }>(options: {
  ask: Ask; now: () => number; what: string;
  pending: () => T[]; prompt: (items: T[]) => string; save: (hooks: { id: string; hook: string }[]) => void;
}) {
  let busy = false;
  let failedAt = -Infinity;

  async function check(): Promise<void> {
    if (busy || options.now() - failedAt < RETRY_AFTER) return;
    const items = options.pending().slice(0, BATCH);
    if (!items.length) return;
    busy = true;
    try {
      const reply = await options.ask(options.prompt(items), { timeout: 5 * 60_000, purpose: `writing ${options.what} memory hooks` });
      let value: unknown;
      try { value = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)); } catch { value = null; }
      const hooks = value && typeof value === 'object' && Array.isArray((value as { hooks?: unknown }).hooks) ? (value as { hooks: unknown[] }).hooks : [];
      const ids = new Set(items.map((item) => item.id));
      const good = hooks.flatMap((entry) => {
        const { id, hook } = (entry ?? {}) as { id?: unknown; hook?: unknown };
        return typeof id === 'string' && ids.has(id) && typeof hook === 'string' && hook.trim() && hook.trim().length <= MAX_LENGTH ? [{ id, hook: hook.trim() }] : [];
      });
      options.save(good);
      if (good.length) console.log(`hooks: wrote ${good.length} ${options.what} memory ${good.length === 1 ? 'hook' : 'hooks'}`);
      if (!good.length) failedAt = options.now();
    } catch (error) {
      failedAt = options.now();
      console.error(`hooks: could not write ${options.what} memory hooks: ${(error as Error).message}`);
    } finally { busy = false; }
  }

  return { check };
}

export function createWordHooks(options: { ask: Ask; store: Store; verbs: VerbDrills; now?: () => number }) {
  const now = options.now ?? Date.now;
  const words = createHookWriter({ ask: options.ask, now, what: 'word', pending: options.store.hookless, prompt: wordPrompt, save: (hooks) => options.store.setHooks(hooks.map(({ id, hook }) => ({ wordId: id, hook }))) });
  const forms = createHookWriter({ ask: options.ask, now, what: 'verb form', pending: options.verbs.hookless, prompt: formPrompt, save: options.verbs.setHooks });
  // One request at a time: words first, then forms.
  return { check: async () => { await words.check(); await forms.check(); } };
}
