"""Explicit offline build of whole French learning clips; never a page-load service.

Run with the Python environment named in voices/provenance.json. This process owns
its Chatterbox model and waits for each local validator subprocess before exiting.
No vocabulary carrier, word extraction, model server or background worker is used.
"""
import os
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

import argparse
import fcntl
import gc
import hashlib
import json
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unicodedata
import wave
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / 'audio' / 'learning'
MODEL = 'mlx-community/chatterbox-multilingual-v3'
REFERENCE = ROOT / 'voices' / 'french-reference.wav'
VOICE_PROVENANCE = ROOT / 'voices' / 'provenance.json'
WHISPER_MODEL = Path.home() / '.local/share/whisper-models/ggml-large-v3-turbo.bin'
# Same selected voice and sampling settings as render-audio.py. Whole passages
# receive a larger generation ceiling than single vocabulary words; no text is cut.
SETTINGS = {'lang_code': 'fr', 'cfg_weight': 0.5, 'exaggeration': 0.1,
            'temperature': 0.5, 'max_tokens': 1000}
PIPELINE = 'whole-learning-clip-v1'
ENCODING = {'codec': 'libmp3lame', 'bitrate': '96k'}
VALIDATION = {'language': 'fr', 'model': 'large-v3-turbo',
              'accept': 'full-normalized-text-or-full-french-phonemes',
              'input': 'decoded-final-mp3', 'sampleRate': 16000}


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp.json')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def normalize(text):
    text = unicodedata.normalize('NFC', text.lower().replace('œ', 'oe'))
    return ''.join(character for character in text if character.isalnum())


def executable(name):
    installed = Path('/opt/homebrew/bin') / name
    found = str(installed) if installed.is_file() else shutil.which(name)
    if not found:
        raise RuntimeError(f'Required local validator is missing: {name}')
    return found


def run(command):
    # A Ctrl-C or SIGTERM must not orphan Whisper/ffmpeg. Each short-lived child
    # gets its own process group, and only that owned group is terminated here.
    child = subprocess.Popen(command, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        stdout, stderr = child.communicate()
        if child.returncode:
            raise RuntimeError(f'{Path(command[0]).name} exited {child.returncode}: {stderr.strip()}')
        return stdout
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()


def phonemes(text, espeak):
    text = ' '.join(text.replace('«', '').replace('»', '').replace(':', '').replace('.', '').split())
    return re.sub(r'[\sˈˌː]', '', run([espeak, '-q', '-v', 'fr-fr', '--ipa', text]))


def transcribe(path, whisper):
    # Whole-clip validation needs no vocabulary DTW boundary or word trimming.
    run([whisper, '-m', str(WHISPER_MODEL), '-l', 'fr', '--no-flash-attn',
         '-ojf', '-np', str(path)])
    result = json.loads(Path(str(path) + '.json').read_text())
    return ''.join(segment['text'] for segment in result['transcription']).strip()


def clips_from(content):
    clips = [{'id': lesson['audioId'], 'text': lesson['fr'],
              'sourceId': lesson['id'], 'kind': lesson['kind']}
             for lesson in content['listening']]
    for lesson in content['conversations']:
        clips.extend({'id': turn['audioId'], 'text': turn['fr'],
                      'sourceId': lesson['id'], 'turnId': turn['id'], 'kind': 'conversation'}
                     for turn in lesson['turns'])
    seen = set()
    for clip in clips:
        if not re.fullmatch(r'[a-z]+(?:-[a-z]+)*', clip['id']) or clip['id'] in seen:
            raise ValueError(f'Unsafe or duplicate audioId: {clip["id"]}')
        if not clip['text'].strip():
            raise ValueError(f'Empty French source for {clip["id"]}')
        seen.add(clip['id'])
    return clips


def render_wav(model, conds, text, seed, path, mx, np):
    mx.random.seed(seed)
    chunks = []
    samples = None
    pcm = None
    result = None
    try:
        for result in model.generate(text=text, conds=conds, verbose=False, **SETTINGS):
            chunks.append(result.audio)
        if not chunks:
            raise RuntimeError('No audio generated')
        samples = mx.concatenate(chunks) if len(chunks) > 1 else chunks[0]
        mx.eval(samples)
        pcm = np.asarray(samples, dtype=np.float32).reshape(-1)
        if pcm.size == 0 or not np.isfinite(pcm).all() or np.max(np.abs(pcm)) < .001:
            raise RuntimeError('Empty, non-finite or silent generated audio')
        rate = int(model.sample_rate)
        with wave.open(str(path), 'wb') as stream:
            stream.setnchannels(1)
            stream.setsampwidth(2)
            stream.setframerate(rate)
            stream.writeframes((np.clip(pcm, -1, 1) * 32767).astype('<i2').tobytes())
        return round(len(pcm) / rate, 3)
    finally:
        chunks.clear()
        samples = pcm = result = None
        mx.clear_cache()


def build(args):
    content = json.loads((ROOT / 'content' / 'learning.json').read_text())
    clips = clips_from(content)
    if args.ids is not None:
        wanted = {value.strip() for value in args.ids.split(',') if value.strip()}
        unknown = wanted - {clip['id'] for clip in clips}
        if not wanted or unknown:
            raise ValueError(f'--ids must name existing audioIds; unknown: {sorted(unknown)}')
        clips = [clip for clip in clips if clip['id'] in wanted]
    seeds = [int(value.strip()) for value in args.seeds.split(',') if value.strip()]
    if not seeds:
        raise ValueError('--seeds must contain at least one integer')
    voice = json.loads(VOICE_PROVENANCE.read_text())
    reference_hash = hashlib.sha256(REFERENCE.read_bytes()).hexdigest()
    signature_settings = {'model': MODEL, 'settings': SETTINGS, 'pipeline': PIPELINE,
                          'referenceSha256': reference_hash, 'voiceProvenance': voice,
                          'encoding': ENCODING, 'validation': VALIDATION}

    def signature(clip):
        payload = {**signature_settings, 'source': clip}
        return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

    manifest_path = AUDIO / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    pending = []
    for clip in clips:
        path = AUDIO / f'{clip["id"]}.mp3'
        cached = manifest.get(clip['id'], {})
        if (args.force or not path.is_file() or cached.get('signature') != signature(clip)
                or cached.get('sha256') != hashlib.sha256(path.read_bytes()).hexdigest()):
            pending.append(clip)
    if not pending:
        print(json.dumps({'cached': len(clips), 'pending': 0}), flush=True)
        return 0

    ffmpeg = executable('ffmpeg')
    whisper = executable('whisper-cli')
    espeak = executable('espeak-ng')
    if not WHISPER_MODEL.is_file():
        raise RuntimeError(f'Required local Whisper model is missing: {WHISPER_MODEL}')
    provenance = {**signature_settings, 'source': 'content/learning.json',
                  'python': sys.executable, 'reference': str(REFERENCE.relative_to(ROOT)),
                  'generationCommand': 'scripts/render-learning-audio.py',
                  'processing': 'Generate each complete French source without a carrier or trimming; encode MP3, decode it, then validate the entire spoken text locally.',
                  'validatorDependencies': {'whisper': whisper, 'whisperModel': str(WHISPER_MODEL),
                                            'espeak': espeak, 'ffmpeg': ffmpeg},
                  'pronunciationCaveat': 'Synthetic speech and ASR can make mistakes. Full phonetic agreement permits homophones and is not native-speaker certification. Dialogue clips use one selected voice, not separate character voices.'}
    atomic_json(AUDIO / 'provenance.json', provenance)
    print(json.dumps({'loading': MODEL, 'pending': len(pending), 'pipeline': PIPELINE}), flush=True)

    # Import and load only after cache/dependency checks. Offline mode forbids
    # downloads; missing cached model files fail rather than starting a service.
    import mlx.core as mx
    import numpy as np
    from mlx_audio.tts.utils import load_model

    model = conds = None
    failures = []
    completed = 0
    try:
        model = load_model(MODEL)
        conds = model.prepare_conditionals(str(REFERENCE), 24000, exaggeration=SETTINGS['exaggeration'])
        with tempfile.TemporaryDirectory(prefix='.render-', dir=AUDIO) as work:
            scratch = Path(work)
            for index, clip in enumerate(pending, 1):
                started = time.monotonic()
                errors = []
                final = AUDIO / f'{clip["id"]}.mp3'
                expected_phonemes = phonemes(clip['text'], espeak)
                for seed in seeds:
                    try:
                        wav = scratch / 'source.wav'
                        mp3 = scratch / 'encoded.mp3'
                        decoded = scratch / 'decoded.wav'
                        seconds = render_wav(model, conds, clip['text'], seed, wav, mx, np)
                        run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
                             '-codec:a', ENCODING['codec'], '-b:a', ENCODING['bitrate'], str(mp3)])
                        run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(mp3),
                             '-ac', '1', '-ar', str(VALIDATION['sampleRate']), str(decoded)])
                        transcript = transcribe(decoded, whisper)
                        exact = normalize(transcript) == normalize(clip['text'])
                        if not exact and (not transcript or phonemes(transcript, espeak) != expected_phonemes):
                            errors.append({'seed': seed, 'error': 'Full spoken text mismatch', 'transcript': transcript})
                            continue
                        record = {**clip, 'signature': signature(clip), 'model': MODEL,
                                  'pipeline': PIPELINE, 'seconds': seconds, 'transcript': transcript,
                                  'check': 'text' if exact else 'phonetic', 'seed': seed,
                                  'sha256': hashlib.sha256(mp3.read_bytes()).hexdigest(),
                                  'generatedAt': datetime.now(timezone.utc).isoformat(),
                                  'renderSeconds': round(time.monotonic() - started, 2)}
                        mp3.replace(final)
                        manifest[clip['id']] = record
                        atomic_json(manifest_path, manifest)
                        completed += 1
                        print(json.dumps({'done': index, 'total': len(pending), **record}, ensure_ascii=False), flush=True)
                        break
                    except Exception as error:
                        errors.append({'seed': seed, 'error': str(error)})
                    finally:
                        mx.clear_cache()
                else:
                    failures.append({'id': clip['id'], 'text': clip['text'], 'attempts': errors})
                    # Never serve stale/unchecked output for a failed re-render.
                    final.unlink(missing_ok=True)
                    manifest.pop(clip['id'], None)
                    atomic_json(manifest_path, manifest)
                    print(json.dumps({'failed': clip['id'], 'attempts': errors}, ensure_ascii=False), flush=True)
                atomic_json(AUDIO / 'failures.json', failures)
    finally:
        conds = model = None
        gc.collect()
        mx.clear_cache()
        # A completed/failed clip is saved immediately; an interrupted clip is
        # retried on the next explicit invocation, never by ordinary browsing.
        atomic_json(AUDIO / 'failures.json', failures)
    print(json.dumps({'requested': len(clips), 'cached': len(clips) - len(pending),
                      'rendered': completed, 'failed': len(failures), 'recordings': len(manifest)}), flush=True)
    return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ids', help='Comma-separated audioIds; default: all listening and conversation clips')
    parser.add_argument('--force', action='store_true', help='Re-render selected clips even if their signature matches')
    parser.add_argument('--seeds', default='42,17,101', help='Deterministic retry seeds, tried in order')
    args = parser.parse_args()
    AUDIO.mkdir(parents=True, exist_ok=True)

    def interrupt(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupt)
    try:
        with (AUDIO / '.render.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError('Another learning-audio renderer owns this output directory')
            return build(args)
    except KeyboardInterrupt:
        print('Learning audio render interrupted; owned validators and model resources released.', file=sys.stderr)
        return 130
    except Exception as error:
        print(f'Learning audio render failed: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
