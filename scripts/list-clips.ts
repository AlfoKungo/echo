// Names every clip a set needs in the language ECHO_LANG picks (French when unset), so the renderer never has to read
// Echo's content itself.
// Usage: bun scripts/list-clips.ts comprehension|grammar|story|verbs|sentences  ->  [{ "id": "...", "text": "..." }] on stdout.
// verbs is the Verbs room's phrases in Portuguese or Swedish (lib/verb-phrases.ts). sentences is the sentences Echo
// wrote for Sentence cards (lib/text-topup.ts), recorded in their own set (audio/sentences) so that recording them
// never touches the comprehension clips.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadBank, loadCards } from '../lib/comprehension-content';
import { grammarSpeech, loadCourse } from '../lib/grammar-content';
import { currentLanguage } from '../lib/language';
import { verbClip } from '../lib/verb-grammar';
import { verbPhrases } from '../lib/verb-phrases';

const root = join(import.meta.dir, '..');
const language = currentLanguage(root);
const set = process.argv[2];
if (set !== 'comprehension' && set !== 'grammar' && set !== 'story' && set !== 'verbs' && set !== 'sentences') {
  console.error('Usage: bun scripts/list-clips.ts comprehension|grammar|story|verbs|sentences');
  process.exit(2);
}

const clips: { id: string; text: string }[] = [];
if (set === 'verbs') {
  for (const text of await verbPhrases(currentLanguage(root))) clips.push(verbClip(text));
} else if (set === 'comprehension') {
  // Lanes Echo wrote itself (lib/text-topup.ts); the server names its folders, colon-separated, when it records them.
  // Only French writes lanes, so another language has none unless they are named.
  const generated = process.env.ECHO_COMPREHENSION_GENERATED?.split(':').filter(Boolean) ?? (language.code === 'fr' ? [join(root, 'data/comprehension')] : []);
  const bank = await loadBank(root, process.env.ECHO_COMPREHENSION_DIR, generated, language);
  for (const sentence of bank.sentences) clips.push({ id: sentence.id, text: sentence.fr });
  // A passage is heard line by line, so each line is its own clip, numbered from one.
  for (const passage of bank.passages) {
    passage.lines.forEach((line, index) => clips.push({ id: `${passage.id}-${index + 1}`, text: line.fr }));
  }
} else if (set === 'sentences') {
  // The folders of written cards, colon-separated (the server names its live and pending ones); French's data/ by default.
  const dirs = process.env.ECHO_SENTENCE_CARDS_DIRS?.split(':').filter(Boolean) ?? [join(root, 'data/sentence-cards')];
  const taken = new Set((await loadBank(root, process.env.ECHO_COMPREHENSION_DIR, [], language)).sentences.map((sentence) => sentence.id));
  for (const sentence of await loadCards(root, dirs, taken)) clips.push({ id: sentence.id, text: sentence.fr });
} else if (set === 'story') {
  // Story episodes Echo wrote (lib/story.ts), one clip per line, numbered from one; the server names the folder.
  const dir = process.env.ECHO_STORY_DIR ?? join(root, 'data/story');
  for (const name of existsSync(dir) ? readdirSync(dir).filter((file) => /^episode-\d+\.json$/.test(file)).sort() : []) {
    const episode = await Bun.file(join(dir, name)).json() as { id: string; lines: { fr: string }[] };
    episode.lines.forEach((line, index) => clips.push({ id: `${episode.id}-${index + 1}`, text: line.fr }));
  }
} else {
  const course = await loadCourse(join(language.content, 'grammar'), language.textKey);
  for (const topic of course.topics) {
    for (const exercise of topic.exercises) clips.push({ id: exercise.id, text: grammarSpeech(exercise) });
  }
}
console.log(JSON.stringify(clips));
