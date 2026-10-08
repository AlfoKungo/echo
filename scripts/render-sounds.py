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
import wave
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('render_clips', ROOT / 'scripts' / 'render-clips.py')
clips_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clips_module)
sys.path.insert(0, str(ROOT / 'scripts'))
import carrier_cut  # noqa: E402
from whisper_scorer import MODEL as SCORER_MODEL, Scorer  # noqa: E402

MARGIN = 3.0
# Every clip starts with the same 250 ms of quiet: a phone (and Bluetooth earbuds even more) drops the first moment
# of a short clip while its output wakes, which turned a clip starting straight on "ils" into "…ont".
LEAD_IN = 'silenceremove=start_periods=1:start_threshold=-60dB,adelay=250:all=1,asetnsamples=n=1152:p=1'
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
                clips_module.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav), '-af', LEAD_IN,
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
            # One short syllable alone is where the voice and Whisper slip most (jeu, queue, nœud): said after a
            # lead-in it comes out as itself, so it is cut out of "On dit : jeu." and must pass the same twin check.
            if best is None:
                best = carried_take(model, conds, side, texts, seeds, scratch, takes, scorer, ffmpeg, espeak, mx, np)
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
                             'check': {'kind': 'forced-choice', 'scorer': SCORER_MODEL, 'margin': best['margin'], 'scores': best['scores'], **({'carrier': best['carrier']} if best.get('carrier') else {})},
                             'sha256': hashlib.sha256(final.read_bytes()).hexdigest(), 'generatedAt': datetime.now(timezone.utc).isoformat(),
                             'renderSeconds': round(time.monotonic() - started, 2)}
            clips_module.atomic_json(manifest_path, manifest)
            print(json.dumps({'done': key, 'margin': best['margin']}), flush=True)
    print(json.dumps({'recorded': len(wanted) - failed, 'failed': failed}), flush=True)
    return 1 if failed else 0


def carried_take(model, conds, side, texts, seeds, scratch, takes, scorer, ffmpeg, espeak, mx, np):
    """The side cut out of a lead-in sentence (carrier_cut.py): the whole sentence must be heard saying this side,
    and the cut clip must score it above its twin by MARGIN. The best such take, or None."""
    best = None
    for carrier in carrier_cut.CARRIERS:
        sentence = carrier + side['text'].strip().rstrip('.!?') + '.'
        expected = clips_module.phonemes(sentence, espeak)
        for number, seed in enumerate(seeds[:3]):
            wav, cut_wav = scratch / 'carried.wav', scratch / 'cut.wav'
            mp3, decoded = scratch / f'carried-{carrier_cut.normalize(carrier)}-{number}.mp3', scratch / 'decoded.wav'
            try:
                clips_module.render_wav(model, conds, sentence, seed, wav, mx, np)
            except Exception as error:
                takes.append({'seed': seed, 'carrier': carrier, 'error': str(error)})
                continue
            heard = carrier_cut.transcribe_tokens(wav)
            if not clips_module.verdict(heard['text'].strip(), sentence, expected, espeak, 'grammar'):
                takes.append({'seed': seed, 'carrier': carrier, 'transcript': heard['text'].strip(), 'error': 'Sentence not heard as this side'})
                continue
            with wave.open(str(wav)) as stream:
                rate = stream.getframerate()
                pcm = np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2').astype(np.float32) / 32767
            try:
                clip, _, _ = carrier_cut.cut_after_carrier(pcm, rate, heard['tokens'], carrier)
            except carrier_cut.NoCut as error:
                takes.append({'seed': seed, 'carrier': carrier, 'error': error.error})
                continue
            with wave.open(str(cut_wav), 'wb') as stream:
                stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(rate)
                stream.writeframes((np.clip(clip, -1, 1) * 32767).astype('<i2').tobytes())
            clips_module.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(cut_wav), '-af', LEAD_IN,
                              '-codec:a', clips_module.ENCODING['codec'], '-b:a', clips_module.ENCODING['bitrate'], str(mp3)])
            clips_module.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(mp3), '-ac', '1', '-ar', '16000', str(decoded)])
            scores = scorer(decoded, texts)
            margin = round(scores[0] - scores[1], 3)
            takes.append({'seed': seed, 'carrier': carrier, 'transcript': heard['text'].strip(), 'margin': margin})
            if margin >= MARGIN and (best is None or margin > best['margin']):
                best = {'seed': seed, 'carrier': carrier, 'transcript': heard['text'].strip(), 'margin': margin, 'scores': scores, 'seconds': round(len(clip) / rate, 3), 'path': mp3}
            if best and best['margin'] >= MARGIN + 3:
                return best
    return best


if __name__ == '__main__':
    sys.exit(main())
