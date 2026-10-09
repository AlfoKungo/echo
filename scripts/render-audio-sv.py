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
"""
import os
os.environ['HF_HUB_OFFLINE'] = '1'
import argparse
import difflib
import hashlib
import json
import re
import subprocess
import time
import unicodedata
import wave
from pathlib import Path

import mlx.core as mx
import numpy as np
from huggingface_hub import hf_hub_download
from mlx_audio.tts.utils import load_model
from num2words import num2words

ROOT = Path(__file__).resolve().parent.parent
# An 8-bit MLX conversion of the official checkpoint at this revision (voices/provenance.json says how to rebuild it).
# It slips on fewer hard words than the 6-bit community quant, so every Swedish clip comes from this build.
MODEL = 'bosonai/higgs-tts-3-4b'
REVISION = '239f63fb7b02b1aa085f98d9efae5e35cc5523e8'
BUILD = Path.home() / '.local/share/higgs-tts/higgs-tts-3-4b-mlx-8bit'
REFERENCE = ROOT / 'voices/swedish-reference.wav'
REFERENCE_TEXT = ('Den spelmannen som fanns i Svartsjö ville han nämligen inte kalla. '
                  'Han hette Jan Öster och nämndemannen visste nog att han hade ett ganska stort rykte.')
SETTINGS = {'temperature': 0.7, 'top_k': 50}
WHISPER, WHISPER_REVISION = 'KBLab/kb-whisper-large', 'd5d5984b4d8f7c4847a8ea203f1976285fb28300'
PIPELINE = 'word-alone-pause-v1'
FFMPEG = '/opt/homebrew/bin/ffmpeg'
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


def spoken(text):
    # Said bare, Higgs stops on the word's last sound and often clips a final release (gjort, sjuk); a full stop and
    # a pause tag make it finish the word and fall silent, which the tail check below can then confirm.
    text = text.strip()
    text = text[0].upper() + text[1:]
    if text[-1] not in '.!?':
        text += '.'
    return text + ' <|prosody:pause|>'


def normalize(text):
    # KB-Whisper writes numbers as digits (sju as "7", sjätte as "6:e").
    text = re.sub(r'(\d+)(:[ae])?', lambda match: num2words(int(match.group(1)), lang='sv', to='ordinal' if match.group(2) else 'cardinal'), text)
    return ''.join(character for character in unicodedata.normalize('NFC', text.lower()) if character.isalnum())


def phonemes(text):
    # Swedish spells one sound several ways, so Whisper can write a right take as a homophone (gärna as "hjärna");
    # espeak-ng gives both the same phonemes. Stress marks go, length marks stay: vowel length tells tak from tack.
    text = ' '.join(re.sub(r'[^\w\s:]', ' ', text).split())
    if not text:
        return ''
    result = subprocess.run(['/opt/homebrew/bin/espeak-ng', '-q', '-v', 'sv', '--ipa', text], capture_output=True, text=True, check=True)
    return re.sub(r'[\sˈˌ]', '', result.stdout)


def heard_as(heard, text):
    """'text' when Whisper wrote the word itself, 'phonetic' when it wrote a word that sounds the same, else None."""
    if normalize(heard) == normalize(text):
        return 'text'
    return 'phonetic' if heard and phonemes(heard) == phonemes(text) else None


def transcribe(paths):
    """KB-Whisper's text for each WAV, in one whisper-cli run so the model loads once per round."""
    subprocess.run(['/opt/homebrew/bin/whisper-cli', '-m', whisper_model, '-l', 'sv', '-oj', '-np', *map(str, paths)],
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
    heard = []
    for path in paths:
        result_path = Path(str(path) + '.json')
        # whisper.cpp can split one letter across two tokens; such bytes read as U+FFFD, which normalize() drops.
        result = json.loads(result_path.read_bytes().decode('utf-8', errors='replace'))
        result_path.unlink()
        heard.append(''.join(segment['text'] for segment in result['transcription']).strip())
    return heard


STOPS = set('ptkbdg')
KEEP = 25  # 10 ms frames kept after the speech: the clip ends 250 ms after the word, inside the pause the tag asked for
GAP = 50   # a loud stretch starting over 500 ms after the last one is a late sound (a click, a breath), not more speech


def runs(mask, shortest):
    """(start, stop) frame pairs of the True stretches in `mask` at least `shortest` frames long."""
    found, start = [], None
    for index, on in enumerate([*mask, False]):
        if on and start is None:
            start = index
        elif not on and start is not None:
            if index - start >= shortest:
                found.append((start, index))
            start = None
    return found


def tail(pcm, sample_rate, text):
    """Where the speech starts and ends (frames) and what is wrong with the clip cut KEEP frames after it.

    Levels are 10 ms frames in dB. The floor is the take's own quietest 100 ms, so a faint room tone copied from the
    reference is not itself a flag. Swedish final stops are aspirated: tack, köket and flygplats end in a release up to
    250 ms long after a short closure, so one such burst counts as speech when the word's last consonants hold a stop.
    Anything later than the cut, often a click in the take's last two codec frames, is trimmed away and only listed."""
    frame = sample_rate // 100
    count = len(pcm) // frame
    level = 20 * np.log10(np.sqrt(np.square(pcm[:count * frame].reshape(count, frame)).mean(axis=1)) + 1e-9)
    peak = float(level.max())
    floor = float(np.convolve(level, np.ones(10) / 10, mode='valid').min())
    strong = level > peak - 25
    stretches = runs(strong, 5) or runs(strong, 1)
    begin, end = stretches[0]
    for start, stop in stretches[1:]:
        if start - end > GAP:
            break
        end = stop
    threshold = max(peak - 40, floor + 12)
    # The last sound's decay dips and rises around the threshold; a dip shorter than 50 ms is still the word.
    while end < count and level[end:end + 5].max() > threshold:
        end += 1
    bursts = [(end + start, end + stop, float(level[end + start:end + stop].max()) - peak) for start, stop in runs(level[end:] > threshold, 2)]
    coda = re.search(r'[^aeiouyåäöé]*$', normalize(text)).group()
    if bursts and STOPS & set(coda) and bursts[0][0] - end <= 30 and bursts[0][1] - bursts[0][0] <= 25 and bursts[0][2] < -10:
        end = bursts.pop(0)[1]
    cut = min(count, end + KEEP)
    flags = [f'sound after speech (+{(start - end) * 10} ms, {loudest:.0f} dB)' for start, _, loudest in bursts if start < cut]
    last = level[max(0, cut - 15):cut]
    last_db = float(10 * np.log10(np.mean(10 ** (last / 10))))
    if cut - end < 15 or last_db > max(floor + 10, peak - 45):
        flags.append(f'end not silent ({last_db - peak:.0f} dB)')
    late = [f'+{(start - end) * 10} ms, {loudest:.0f} dB' for start, _, loudest in bursts if start >= cut]
    return {'begin': begin, 'end': end, 'cut': cut, 'flags': flags, 'late': late}


# Every word clip starts with the same 250 ms of quiet as the French ones (render-audio.py): a phone, and Bluetooth
# earbuds even more, drop the first moment of a short clip while the output wakes.
LEAD_IN = 'silenceremove=start_periods=1:start_threshold=-60dB,adelay=250:all=1,asetnsamples=n=1152:p=1'


def save_manifest():
    temporary = AUDIO / 'manifest.tmp.json'
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    temporary.replace(manifest_path)


def save_wav(path, samples, sample_rate):
    with wave.open(str(path), 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(sample_rate)
        stream.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())


def closeness(take):
    """Orders a word's takes when none passed: heard right beats misheard, then fewer tail flags, then the nearer
    transcript."""
    return (take['heardAs'] is not None, -len(take['tailFlags']), difflib.SequenceMatcher(None, normalize(take['transcript']), normalize(take['text'])).ratio())


pending = [word for word in words if args.force or not (AUDIO / f"{word['id']}.mp3").exists() or manifest.get(word['id'], {}).get('signature') != signature(word)]
if not pending:
    print(json.dumps({'cached': len(words), 'pending': 0}), flush=True)
    raise SystemExit(0)
if not (BUILD / 'model.safetensors').exists():
    raise SystemExit(f'No Higgs build at {BUILD}; voices/provenance.json (swedish.build) says how to make it')
print(json.dumps({'loading': MODEL, 'revision': REVISION, 'build': str(BUILD), 'pending': len(pending), 'pipeline': PIPELINE}), flush=True)
whisper_model = hf_hub_download(WHISPER, 'ggml-model.bin', revision=WHISPER_REVISION)
model = load_model(str(BUILD))
reference_codes = model.encode_reference_audio(str(REFERENCE))
sample_rate = int(model.sample_rate)
frame = sample_rate // 100
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
        limit = int(25 * (2.5 + 0.12 * len(word['sv']))) + 8
        result = next(model.generate(text=spoken(word['sv']), ref_audio_codes=reference_codes, ref_text=REFERENCE_TEXT, seed=seed, max_new_tokens=limit, **SETTINGS))
        pcm = np.asarray(result.audio, dtype=np.float32).reshape(-1)
        mx.clear_cache()
        if args.keep_context:
            save_wav(AUDIO / f"{word['id']}.{seed}.take.wav", pcm, sample_rate)
        found = tail(pcm, sample_rate, word['sv'])
        clip = pcm[:found['cut'] * frame].copy()
        if found['cut'] * frame < len(pcm):
            fade = sample_rate // 50
            clip[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
        # Whisper hears the clip as delivered, so a word cut short by the trim fails here, not in a learner's ear.
        path = AUDIO / f"{word['id']}.{seed}.wav"
        save_wav(path, clip, sample_rate)
        paths.append(path)
        takes[word['id']].append({'seed': seed, 'clip': clip, 'text': word['sv'], 'tailFlags': found['flags'], 'lateSounds': found['late'],
                                  'speechStart': found['begin'] / 100, 'speechEnd': found['end'] / 100, 'seconds': round(len(clip) / sample_rate, 3),
                                  'frames': result.token_count, 'hitFrameLimit': result.token_count >= limit, 'renderSeconds': round(time.monotonic() - render_started, 2)})
    for word, path, heard in zip(waiting, paths, transcribe(paths)):
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
