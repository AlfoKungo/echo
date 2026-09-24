#!/usr/bin/env python3
"""Render grammar clips whose point is a sound Whisper's free transcript cannot settle.

A clip like "je parlerais" fails the ordinary check whenever Whisper writes the
near-homophone "je parlerai". Here each take must still pass the ordinary whole-text
check against the right text or one of its confusable twins, which verifies every
other word. Then Whisper scores the right text and each twin against the audio with
teacher forcing, and the take is kept only when the right text wins by MARGIN nats
or more. The best-scoring take is saved, with the same cache signature render-clips.py
uses, so an ordinary render keeps it.

Run with the TTS venv:
  .venv/bin/python scripts/render-contrast-clips.py [--ids a,b] [--seeds 42,17,...]
"""
import os
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

import argparse
import hashlib
import importlib.util
import json
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('render_clips', ROOT / 'scripts' / 'render-clips.py')
clips_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clips_module)
sys.path.insert(0, str(ROOT / 'scripts'))
from whisper_scorer import MODEL as SCORER_MODEL, Scorer  # noqa: E402

MARGIN = 3.0
SEEDS = '42,17,101,7,13,99,3,5,11,19,23,29'
# Clips whose meaning rests on one sound, with the forms a listener could hear instead.
TWINS = {
    'pronoun-order-imperative-affirmative-3': [
        'Tu as du chocolat ? Donne-moi, s’il te plaît !',
        'Tu as du chocolat ? Donne-moi-en, s’il te plaît !',
        'Tu as du chocolat ? Donne, s’il te plaît !',
        'Tu as du chocolat ? Donne-le-moi, s’il te plaît !',
    ],
    'pronoun-order-imperative-affirmative-4': ['Dis-le-leur !', 'Dis-la !', 'Dis-leur !', 'Dis-lui !', 'Dis-la-lui !'],
}


def conditional_twins(text):
    # The conditional -rais against the future -rai, the form Whisper hears when the vowel is not open enough.
    verb = re.search(r'(\w+)rais\b', text)
    if not verb:
        return []
    future = text[:verb.start()] + verb.group(1) + 'rai' + text[verb.end():]
    return [future]


def prompts(text):
    # What the voice is asked to say. -rait and -rè are spelled differently but sound like -rais, and may
    # coax the open vowel the voice keeps closing. The audio is always judged against the real text.
    variants = [text]
    if re.search(r'\w+rais\b', text):
        variants += [re.sub(r'(\w+)rais\b', r'\1rait', text), re.sub(r'(\w+)rais\b', r'\1rè', text)]
    return variants


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ids', help='Comma-separated grammar clip ids; default: every clip with twins and no recording')
    parser.add_argument('--seeds', default=SEEDS)
    args = parser.parse_args()
    audio = ROOT / 'audio' / 'grammar'
    clips = {clip['id']: clip for clip in clips_module.clips_from('grammar')}
    twins = {clip_id: TWINS.get(clip_id) or conditional_twins(clip['text']) for clip_id, clip in clips.items()}
    if args.ids:
        wanted = [value.strip() for value in args.ids.split(',') if value.strip()]
        unknown = [value for value in wanted if value not in clips or not twins[value]]
        if unknown:
            raise SystemExit(f'No such clip, or no confusable twins for: {unknown}')
    else:
        wanted = [clip_id for clip_id in clips if twins[clip_id] and not (audio / f'{clip_id}.mp3').is_file()]
    seeds = [int(value) for value in args.seeds.split(',') if value.strip()]
    ffmpeg = clips_module.executable('ffmpeg')
    whisper = clips_module.executable('whisper-cli')
    espeak = clips_module.executable('espeak-ng')
    settings = clips_module.signature_settings()
    manifest_path = audio / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    print(json.dumps({'clips': wanted}), flush=True)

    import mlx.core as mx
    import numpy as np
    from mlx_audio.tts.utils import load_model
    scorer = Scorer('fr')
    model = load_model(clips_module.MODEL)
    conds = model.prepare_conditionals(str(clips_module.REFERENCE), 24000, exaggeration=clips_module.SETTINGS['exaggeration'])
    summary = []
    with tempfile.TemporaryDirectory(prefix='.contrast-', dir=audio) as work:
        scratch = Path(work)
        for clip_id in wanted:
            clip = {'id': clip_id, 'text': clips[clip_id]['text']}
            alternatives = twins[clip_id]
            accepted_texts = [clip['text'], *alternatives]
            phonemes = {text: clips_module.phonemes(text, espeak) for text in accepted_texts}
            best = None
            takes = []
            started = time.monotonic()
            takes_to_try = [(seed, prompt) for seed in seeds for prompt in prompts(clip['text'])]
            for number, (seed, prompt) in enumerate(takes_to_try):
                wav, mp3, decoded = scratch / 'source.wav', scratch / f'{number}.mp3', scratch / 'decoded.wav'
                try:
                    seconds = clips_module.render_wav(model, conds, prompt, seed, wav, mx, np)
                except Exception as error:
                    takes.append({'seed': seed, 'prompt': prompt, 'error': str(error)})
                    continue
                clips_module.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
                                  '-codec:a', clips_module.ENCODING['codec'], '-b:a', clips_module.ENCODING['bitrate'], str(mp3)])
                clips_module.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(mp3),
                                  '-ac', '1', '-ar', '16000', str(decoded)])
                transcript = clips_module.transcribe(decoded, whisper)
                matched = next((text for text in accepted_texts
                                if clips_module.verdict(transcript, text, phonemes[text], espeak, 'grammar')), None)
                scores = scorer(decoded, accepted_texts)
                margin = round(scores[0] - max(scores[1:]), 3)
                take = {'seed': seed, 'prompt': prompt, 'transcript': transcript, 'matched': matched, 'scores': scores, 'margin': margin, 'seconds': seconds}
                takes.append(take)
                print(json.dumps({'clip': clip_id, **take}, ensure_ascii=False), flush=True)
                if matched and margin >= MARGIN and (best is None or margin > best['margin']):
                    best = {**take, 'path': mp3}
                if best and best['margin'] >= MARGIN + 3:
                    break
            if best is None:
                summary.append({'id': clip_id, 'kept': False, 'bestMargin': max((t.get('margin', -99) for t in takes), default=None)})
                continue
            final = audio / f'{clip_id}.mp3'
            best['path'].replace(final)
            manifest[clip_id] = {
                **clip, 'set': 'grammar', 'signature': clips_module.clip_signature(settings, clip), 'model': clips_module.MODEL,
                'pipeline': clips_module.PIPELINE, 'seconds': best['seconds'], 'transcript': best['transcript'],
                'check': {'kind': 'forced-choice', 'scorer': SCORER_MODEL, 'margin': best['margin'],
                          'texts': accepted_texts, 'scores': best['scores'], 'transcriptMatched': best['matched']},
                'seed': best['seed'], 'prompt': best['prompt'], 'sha256': hashlib.sha256(final.read_bytes()).hexdigest(),
                'generatedAt': datetime.now(timezone.utc).isoformat(), 'renderSeconds': round(time.monotonic() - started, 2)}
            clips_module.atomic_json(manifest_path, manifest)
            summary.append({'id': clip_id, 'kept': True, 'seed': best['seed'], 'margin': best['margin']})
    print(json.dumps({'summary': summary}, ensure_ascii=False), flush=True)
    return 0 if all(item['kept'] for item in summary) else 1


if __name__ == '__main__':
    sys.exit(main())
