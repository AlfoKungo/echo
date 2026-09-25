#!/usr/bin/env python3
"""Record the Sounds drill (content/sounds.json): both sides of every pair, in the deck's French voice.

A pair's two sides differ by one sound, so a free transcript cannot tell whether a take says the right one: a take
is kept only when Whisper transcribes it as one of the two sides AND scores the intended side above its twin by
MARGIN nats (the forced-choice check of render-contrast-clips.py). A side no take passes for is left out, and its
pair waits. Output: audio/sounds/<item id>-<a|b>.mp3 and audio/sounds/manifest.json. Prints {"failed": id} per
side no take passed for, and exits 1 when there is one.
"""
import os
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

import argparse
import hashlib
import fcntl
import importlib.util
import json
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
SEEDS = '42,17,101,7,13,99'


def sides():
    """Every side to record: {id, text, twin}."""
    content = json.loads((ROOT / 'content' / 'sounds.json').read_text())
    for contrast in content['contrasts']:
        for item in contrast['items']:
            yield {'id': f"{item['id']}-a", 'text': item['a']['fr'], 'twin': item['b']['fr']}
            yield {'id': f"{item['id']}-b", 'text': item['b']['fr'], 'twin': item['a']['fr']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ids', help='Comma-separated side ids; default: every side with no current recording')
    parser.add_argument('--seeds', default=SEEDS)
    args = parser.parse_args()
    audio = ROOT / 'audio' / 'sounds'
    audio.mkdir(parents=True, exist_ok=True)
    manifest_path = audio / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    settings = clips_module.signature_settings()
    everything = {side['id']: side for side in sides()}
    # A side's signature covers its text and its twin: the check depends on both.
    signature = lambda side: clips_module.clip_signature(settings, {'id': side['id'], 'text': f"{side['text']}|{side['twin']}"})
    if args.ids:
        wanted = [value.strip() for value in args.ids.split(',') if value.strip() in everything]
    else:
        wanted = [key for key, side in everything.items()
                  if not (audio / f'{key}.mp3').is_file() or manifest.get(key, {}).get('signature') != signature(side)]
    print(json.dumps({'pending': len(wanted), 'recorded': len(manifest)}), flush=True)
    if not wanted:
        return 0
    lock = (audio / '.render.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError('Another renderer owns audio/sounds')
    seeds = [int(value) for value in args.seeds.split(',') if value.strip()]
    ffmpeg = clips_module.executable('ffmpeg')
    whisper = clips_module.executable('whisper-cli')
    espeak = clips_module.executable('espeak-ng')

    import mlx.core as mx
    import numpy as np
    from mlx_audio.tts.utils import load_model
    scorer = Scorer('fr')
    model = load_model(clips_module.MODEL)
    conds = model.prepare_conditionals(str(clips_module.REFERENCE), 24000, exaggeration=clips_module.SETTINGS['exaggeration'])
    failed = 0
    with tempfile.TemporaryDirectory(prefix='.sounds-', dir=audio) as work:
        scratch = Path(work)
        for key in wanted:
            side = everything[key]
            texts = [side['text'], side['twin']]
            phonemes = {text: clips_module.phonemes(text, espeak) for text in texts}
            best, takes, started = None, [], time.monotonic()
            for number, seed in enumerate(seeds):
                wav, mp3, decoded = scratch / 'source.wav', scratch / f'{number}.mp3', scratch / 'decoded.wav'
                try:
                    seconds = clips_module.render_wav(model, conds, side['text'], seed, wav, mx, np)
                except Exception as error:
                    takes.append({'seed': seed, 'error': str(error)})
                    continue
                clips_module.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
                                  '-codec:a', clips_module.ENCODING['codec'], '-b:a', clips_module.ENCODING['bitrate'], str(mp3)])
                clips_module.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(mp3), '-ac', '1', '-ar', '16000', str(decoded)])
                transcript = clips_module.transcribe(decoded, whisper)
                matched = next((text for text in texts if clips_module.verdict(transcript, text, phonemes[text], espeak, 'grammar')), None)
                scores = scorer(decoded, texts)
                margin = round(scores[0] - scores[1], 3)
                takes.append({'seed': seed, 'transcript': transcript, 'matched': matched, 'margin': margin})
                if matched and margin >= MARGIN and (best is None or margin > best['margin']):
                    best = {'seed': seed, 'transcript': transcript, 'margin': margin, 'scores': scores, 'seconds': seconds, 'path': mp3}
                if best and best['margin'] >= MARGIN + 3:
                    break
            if best is None:
                failed += 1
                (audio / f'{key}.mp3').unlink(missing_ok=True)
                manifest.pop(key, None)
                clips_module.atomic_json(manifest_path, manifest)
                print(json.dumps({'failed': key, 'attempts': takes}, ensure_ascii=False), flush=True)
                continue
            final = audio / f'{key}.mp3'
            best['path'].replace(final)
            manifest[key] = {'id': key, 'text': side['text'], 'twin': side['twin'], 'signature': signature(side), 'model': clips_module.MODEL,
                             'seconds': best['seconds'], 'transcript': best['transcript'], 'seed': best['seed'],
                             'check': {'kind': 'forced-choice', 'scorer': SCORER_MODEL, 'margin': best['margin'], 'scores': best['scores']},
                             'sha256': hashlib.sha256(final.read_bytes()).hexdigest(), 'generatedAt': datetime.now(timezone.utc).isoformat(),
                             'renderSeconds': round(time.monotonic() - started, 2)}
            clips_module.atomic_json(manifest_path, manifest)
            print(json.dumps({'done': key, 'margin': best['margin']}), flush=True)
    print(json.dumps({'recorded': len(wanted) - failed, 'failed': failed}), flush=True)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
