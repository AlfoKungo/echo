"""Render French vocabulary in context, then extract the word using local Whisper timings."""
import os
os.environ['HF_HUB_OFFLINE'] = '1'
import argparse
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
from mlx_audio.tts.utils import load_model

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / 'audio'
AUDIO.mkdir(exist_ok=True)
MODEL = 'mlx-community/chatterbox-multilingual-v3'
REFERENCE = ROOT / 'voices/french-reference.wav'
SETTINGS = {'lang_code': 'fr', 'cfg_weight': 0.5, 'exaggeration': 0.1, 'temperature': 0.5, 'max_tokens': 400}
PIPELINE = 'context-word-alignment-v1'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--ids', help='Comma-separated word IDs; default is the whole deck')
parser.add_argument('--force', action='store_true')
parser.add_argument('--sources', nargs='+', choices=['core', 'world'], default=['core', 'world'])
parser.add_argument('--seeds', default='42,17,101', help='Seeds to try when speech content does not match')
parser.add_argument('--carrier', help='Override the French lead-in; use --force to replace cached clips')
parser.add_argument('--keep-context', action='store_true', help='Keep full sentences for alignment inspection')
args = parser.parse_args()
contexts = json.loads((ROOT / 'voices/contexts.json').read_text())
words = []
for name in args.sources:
    words.extend(json.loads((ROOT / 'content' / f'{name}.json').read_text()))
groups = {}
for word in words:
    groups.setdefault(word['category'], []).append(word)
words = [group[i] for i in range(max(map(len, groups.values()))) for group in groups.values() if i < len(group)]
if args.ids:
    wanted = set(args.ids.split(','))
    words = [word for word in words if word['id'] in wanted]
    if len(words) != len(wanted):
        raise ValueError('One or more word IDs do not exist')
manifest_path = AUDIO / 'manifest.json'
manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
reference_hash = hashlib.sha256(REFERENCE.read_bytes()).hexdigest()

def carrier_for(word):
    return args.carrier if args.carrier is not None else contexts.get(word['id'], {}).get('before', 'On dit : ')

def signature(word):
    return hashlib.sha256(json.dumps([MODEL, SETTINGS, PIPELINE, reference_hash, word['fr'], carrier_for(word)], ensure_ascii=False).encode()).hexdigest()

def normalize(text):
    text = unicodedata.normalize('NFC', text.lower().replace('œ', 'oe'))
    return ''.join(character for character in text if character.isalnum())

def phonemes(text):
    text = ' '.join(text.replace('«', '').replace('»', '').replace(':', '').replace('.', '').split())
    result = subprocess.run(['/opt/homebrew/bin/espeak-ng', '-q', '-v', 'fr-fr', '--ipa', text], capture_output=True, text=True, check=True)
    # Timestamp line breaks are not pauses; French vowel length varies by accent.
    return re.sub(r'[\sˈˌː]', '', result.stdout)

def transcribe(path):
    model_path = Path.home() / '.local/share/whisper-models/ggml-large-v3-turbo.bin'
    subprocess.run(['/opt/homebrew/bin/whisper-cli', '-m', str(model_path), '-l', 'fr', '--dtw', 'large.v3.turbo', '--no-flash-attn', '-ojf', '-np', str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
    result_path = Path(str(path) + '.json')
    result = json.loads(result_path.read_text())
    if not args.keep_context:
        result_path.unlink()
    return {'text': ''.join(segment['text'] for segment in result['transcription']), 'tokens': [token for segment in result['transcription'] for token in segment['tokens']]}

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

pending = [word for word in words if args.force or not (AUDIO / f"{word['id']}.mp3").exists() or manifest.get(word['id'], {}).get('signature') != signature(word)]
if not pending:
    print(json.dumps({'cached': len(words), 'pending': 0}), flush=True)
    raise SystemExit(0)
print(json.dumps({'loading': MODEL, 'pending': len(pending), 'pipeline': PIPELINE}), flush=True)
model = load_model(MODEL)
conds = model.prepare_conditionals(str(REFERENCE), 24000, exaggeration=SETTINGS['exaggeration'])
failures = []
for index, word in enumerate(pending, 1):
    started = time.monotonic()
    carrier = carrier_for(word)
    text = carrier + word['fr'].strip().rstrip('.!?') + '.'
    errors = []
    wav = AUDIO / f"{word['id']}.context.wav"
    trimmed = AUDIO / f"{word['id']}.trim.wav"
    final = AUDIO / f"{word['id']}.mp3"
    for seed in map(int, args.seeds.split(',')):
        mx.random.seed(seed)
        chunks = [result.audio for result in model.generate(text=text, conds=conds, verbose=False, **SETTINGS)]
        if not chunks:
            errors.append({'seed': seed, 'error': 'No audio'})
            continue
        samples = mx.concatenate(chunks) if len(chunks) > 1 else chunks[0]
        mx.eval(samples)
        pcm = np.asarray(samples, dtype=np.float32).reshape(-1)
        sample_rate = int(model.sample_rate)
        if not np.isfinite(pcm).all() or np.max(np.abs(pcm)) < .001:
            errors.append({'seed': seed, 'error': 'Invalid audio'})
            continue
        save_wav(wav, pcm, sample_rate)
        result = transcribe(wav)
        transcript = result.get('text', '').strip()
        exact = normalize(transcript) == normalize(text)
        if not exact and phonemes(transcript) != phonemes(text):
            errors.append({'seed': seed, 'transcript': transcript, 'error': 'Speech content mismatch'})
            continue
        tokens = [token for token in result['tokens'] if token['t_dtw'] >= 0 and normalize(token['text'])]
        prefix = ''
        boundary = None
        for token_index, token in enumerate(tokens):
            prefix += normalize(token['text'])
            if prefix == normalize(carrier):
                boundary = token_index
                break
        if boundary is None or boundary + 1 >= len(tokens):
            errors.append({'seed': seed, 'transcript': transcript, 'error': 'No reliable word boundary'})
            continue
        # Cut at the quietest transition between DTW anchors, not inside the carrier.
        start = int(tokens[boundary]['t_dtw'] * sample_rate / 100)
        end = int(tokens[boundary + 1]['t_dtw'] * sample_rate / 100)
        frame = sample_rate // 100
        section = pcm[start:end]
        count = len(section) // frame
        if count >= 2:
            energy = np.square(section[:count * frame].reshape(count, frame)).mean(axis=1)
            cut = (start + int(np.argmin(energy[:-1] + energy[1:])) * frame) / sample_rate
        else:
            cut = max(0, (start + end) / (2 * sample_rate))
        clip = pcm[int(cut * sample_rate):]
        if len(clip) == 0:
            errors.append({'seed': seed, 'error': 'Empty aligned clip'})
            continue
        save_wav(trimmed, clip, sample_rate)
        temporary = AUDIO / f"{word['id']}.tmp.mp3"
        subprocess.run(['/opt/homebrew/bin/ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(trimmed), '-codec:a', 'libmp3lame', '-b:a', '96k', str(temporary)], check=True)
        temporary.replace(final)
        manifest[word['id']] = {'text': word['fr'], 'signature': signature(word), 'model': MODEL, 'pipeline': PIPELINE, 'alignment': 'whisper-dtw-energy', 'carrier': carrier, 'seconds': round(len(clip) / sample_rate, 3), 'trimStart': round(cut, 3), 'fullSeconds': round(len(pcm) / sample_rate, 3), 'transcript': transcript, 'check': 'text' if exact else 'phonetic', 'seed': seed, 'renderSeconds': round(time.monotonic() - started, 2)}
        if not args.keep_context:
            wav.unlink(missing_ok=True)
        trimmed.unlink(missing_ok=True)
        print(json.dumps({'done': index, 'total': len(pending), 'id': word['id'], **manifest[word['id']]}), flush=True)
        break
    else:
        failures.append({'id': word['id'], 'text': word['fr'], 'attempts': errors})
        final.unlink(missing_ok=True)
        manifest.pop(word['id'], None)
        print(json.dumps({'failed': word['id'], 'attempts': errors}), flush=True)
    if index % 10 == 0:
        save_manifest()
    mx.clear_cache()
save_manifest()
(AUDIO / 'failures.json').write_text(json.dumps(failures, ensure_ascii=False, indent=2))
print(json.dumps({'complete': len(words) - len(failures), 'failed': len(failures), 'recordings': len(manifest)}), flush=True)
raise SystemExit(1 if failures else 0)
