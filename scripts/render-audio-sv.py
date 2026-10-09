"""Render Swedish vocabulary with Higgs TTS 3 in the cloned Swedish voice, check every take with KB-Whisper and a
tail-noise check, and re-render a failing word with the next seed.

Same command line and output as render-audio.py, so a Swedish server can call it the same way: --ids, --force,
--sources, --seeds, --keep-context, --audio-dir and --extra-words; one MP3 per word id, manifest.json and
failures.json in the audio directory; one JSON line per clip on stdout; exit status 1 when any word failed. Words carry
their Swedish text under "sv". The deck lives in content/sv/<source>.json; a source file that does not exist yet is
skipped, so --extra-words alone renders before the Swedish deck is written.

Unlike render-audio.py, a word no seed passes for is still written: its last-resort take is the one that came closest
(heard right with a noisy tail beats misheard), flagged "check": "failed" in the manifest and listed in failures.json,
so a reviewer can hear it later and no word is ever silently missing.

The voice, the trim and the checks live in higgs_swedish.py, which the sentence recorder (render-clips.py --lang sv)
shares.
"""
import os
os.environ['HF_HUB_OFFLINE'] = '1'
import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

from higgs_swedish import (BUILD, FFMPEG, LEAD_IN, MODEL, REFERENCE, REVISION, SETTINGS, ROOT, Voice, closeness,
                           heard_as, save_wav, transcribe, whisper_model)

PIPELINE = 'word-alone-pause-v1'
parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('--ids', help='Comma-separated word IDs; default is the whole deck')
parser.add_argument('--force', action='store_true')
parser.add_argument('--sources', nargs='+', choices=['core', 'world'], default=['core', 'world'])
parser.add_argument('--seeds', default='42,17,101', help='One take per seed until a take passes; the default allows three tries')
parser.add_argument('--keep-context', action='store_true', help='Keep every take whole (<id>.<seed>.take.wav) and as checked (<id>.<seed>.wav) for inspection')
parser.add_argument('--audio-dir', type=Path, default=ROOT / 'audio/sv', help='Where clips and the manifest live; point elsewhere to trial a change')
parser.add_argument('--extra-words', type=Path, help='A JSON list of added words to render alongside the deck')
args = parser.parse_args()
AUDIO = args.audio_dir
AUDIO.mkdir(parents=True, exist_ok=True)
words = []
for name in args.sources:
    path = ROOT / 'content/sv' / f'{name}.json'
    if path.exists():
        words.extend(json.loads(path.read_text()))
if args.extra_words:
    words.extend(json.loads(args.extra_words.read_text()))
if args.ids:
    wanted = set(args.ids.split(','))
    words = [word for word in words if word['id'] in wanted]
    if len(words) != len(wanted):
        raise ValueError('One or more word IDs do not exist')
seeds = [int(seed) for seed in args.seeds.split(',')]
manifest_path = AUDIO / 'manifest.json'
manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
reference_hash = hashlib.sha256(REFERENCE.read_bytes()).hexdigest()


def signature(word):
    return hashlib.sha256(json.dumps([MODEL, REVISION, BUILD.name, SETTINGS, PIPELINE, reference_hash, word['sv']], ensure_ascii=False).encode()).hexdigest()


def save_manifest():
    temporary = AUDIO / 'manifest.tmp.json'
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    temporary.replace(manifest_path)


pending = [word for word in words if args.force or not (AUDIO / f"{word['id']}.mp3").exists() or manifest.get(word['id'], {}).get('signature') != signature(word)]
if not pending:
    print(json.dumps({'cached': len(words), 'pending': 0}), flush=True)
    raise SystemExit(0)
if not (BUILD / 'model.safetensors').exists():
    raise SystemExit(f'No Higgs build at {BUILD}; voices/provenance.json (swedish.build) says how to make it')
print(json.dumps({'loading': MODEL, 'revision': REVISION, 'build': str(BUILD), 'pending': len(pending), 'pipeline': PIPELINE}), flush=True)
whisper = whisper_model()
voice = Voice()
sample_rate = voice.sample_rate
takes = {word['id']: [] for word in pending}
started = time.monotonic()
done = 0


def write(word, take, passed):
    source = AUDIO / f"{word['id']}.final.wav"
    save_wav(source, take.pop('clip'), sample_rate)
    temporary = AUDIO / f"{word['id']}.tmp.mp3"
    subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source), '-af', LEAD_IN, '-codec:a', 'libmp3lame', '-b:a', '96k', str(temporary)], check=True)
    temporary.replace(AUDIO / f"{word['id']}.mp3")
    source.unlink()
    manifest[word['id']] = {'text': word['sv'], 'signature': signature(word), 'model': MODEL, 'revision': REVISION, 'build': BUILD.name, 'pipeline': PIPELINE,
                            'check': 'passed' if passed else 'failed', **take}


failures = []
# One round per seed: every word still waiting gets a take, then one whisper-cli run checks the round's takes, so
# KB-Whisper loads at most once per seed while Higgs stays loaded for the whole run.
for round_index, seed in enumerate(seeds):
    waiting = [word for word in pending if takes[word['id']] is not None]
    if not waiting:
        break
    paths = []
    for word in waiting:
        render_started = time.monotonic()
        made = voice.take(word['sv'], seed, AUDIO / f"{word['id']}.{seed}.take.wav" if args.keep_context else None)
        found, clip = made['found'], made['clip']
        # Whisper hears the clip as delivered, so a word cut short by the trim fails here, not in a learner's ear.
        path = AUDIO / f"{word['id']}.{seed}.wav"
        save_wav(path, clip, sample_rate)
        paths.append(path)
        takes[word['id']].append({'seed': seed, 'clip': clip, 'text': word['sv'], 'tailFlags': found['flags'], 'lateSounds': found['late'],
                                  'speechStart': found['begin'] / 100, 'speechEnd': found['end'] / 100, 'seconds': round(len(clip) / sample_rate, 3),
                                  'frames': made['frames'], 'hitFrameLimit': made['hitFrameLimit'], 'renderSeconds': round(time.monotonic() - render_started, 2)})
    for word, path, heard in zip(waiting, paths, transcribe(paths, whisper)):
        take = takes[word['id']][-1]
        take.update({'transcript': heard, 'heardAs': heard_as(heard, word['sv'])})
        if not args.keep_context:
            path.unlink()
        if take['heardAs'] and not take['tailFlags'] and not take['hitFrameLimit']:
            done += 1
            write(word, take, True)
            print(json.dumps({'done': done, 'total': len(pending), 'id': word['id'], **manifest[word['id']]}, ensure_ascii=False), flush=True)
            takes[word['id']] = None
        elif round_index == len(seeds) - 1:
            # No seed passed: write the closest take anyway, flagged, rather than leave the word without a clip.
            best = max(takes[word['id']], key=closeness)
            attempts = [{key: value for key, value in attempt.items() if key != 'clip'} for attempt in takes[word['id']]]
            write(word, best, False)
            failures.append({'id': word['id'], 'text': word['sv'], 'written': f"{word['id']}.mp3", 'writtenSeed': best['seed'], 'attempts': attempts})
            print(json.dumps({'failed': word['id'], 'written': True, 'attempts': attempts}, ensure_ascii=False), flush=True)
            takes[word['id']] = None
    save_manifest()
(AUDIO / 'failures.json').write_text(json.dumps(failures, ensure_ascii=False, indent=2))
print(json.dumps({'complete': len(words) - len(failures), 'failed': len(failures), 'recordings': len(manifest), 'seconds': round(time.monotonic() - started, 1)}), flush=True)
raise SystemExit(1 if failures else 0)
