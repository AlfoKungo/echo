// Names every French clip a set needs, so the renderer never has to read Echo's content itself.
// Usage: bun scripts/list-clips.ts comprehension|grammar|story  ->  [{ "id": "...", "text": "..." }] on stdout.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadBank } from '../lib/comprehension-content';
import { grammarSpeech, loadCourse } from '../lib/grammar-content';

const root = join(import.meta.dir, '..');
const set = process.argv[2];
if (set !== 'comprehension' && set !== 'grammar' && set !== 'story') {
  console.error('Usage: bun scripts/list-clips.ts comprehension|grammar|story');
  process.exit(2);
}

const clips: { id: string; text: string }[] = [];
if (set === 'comprehension') {
  // Lanes Echo wrote itself (lib/text-topup.ts); the server names its folders, colon-separated, when it records them.
  const generated = process.env.ECHO_COMPREHENSION_GENERATED?.split(':').filter(Boolean) ?? [join(root, 'data/comprehension')];
  const bank = await loadBank(root, process.env.ECHO_COMPREHENSION_DIR, generated);
  for (const sentence of bank.sentences) clips.push({ id: sentence.id, text: sentence.fr });
  // A passage is heard line by line, so each line is its own clip, numbered from one.
  for (const passage of bank.passages) {
    passage.lines.forEach((line, index) => clips.push({ id: `${passage.id}-${index + 1}`, text: line.fr }));
  }
} else if (set === 'story') {
  // Story episodes Echo wrote (lib/story.ts), one clip per line, numbered from one; the server names the folder.
  const dir = process.env.ECHO_STORY_DIR ?? join(root, 'data/story');
  for (const name of existsSync(dir) ? readdirSync(dir).filter((file) => /^episode-\d+\.json$/.test(file)).sort() : []) {
    const episode = await Bun.file(join(dir, name)).json() as { id: string; lines: { fr: string }[] };
    episode.lines.forEach((line, index) => clips.push({ id: `${episode.id}-${index + 1}`, text: line.fr }));
  }
} else {
  const course = await loadCourse(join(root, 'content/grammar'));
  for (const topic of course.topics) {
    for (const exercise of topic.exercises) clips.push({ id: exercise.id, text: grammarSpeech(exercise) });
  }
}
console.log(JSON.stringify(clips));
