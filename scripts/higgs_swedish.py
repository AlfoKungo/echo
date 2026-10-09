"""The Swedish voice and its checks, shared by the word recorder (render-audio-sv.py) and the sentence recorder
(render-clips.py --lang sv): Higgs TTS 3 in the cloned Swedish voice, one take per seed, each take trimmed after its
speech and checked by KB-Whisper (or espeak-ng, for a spelling that sounds the same) and by a tail-noise check.

mlx and the model load only when a recorder asks for them, so a run with nothing to record loads nothing.
"""
import difflib
import json
import re
import subprocess
import unicodedata
import wave
from pathlib import Path

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
FFMPEG = '/opt/homebrew/bin/ffmpeg'
# Every clip starts with the same 250 ms of quiet as the French ones (render-audio.py): a phone, and Bluetooth
# earbuds even more, drop the first moment of a short clip while the output wakes.
LEAD_IN = 'silenceremove=start_periods=1:start_threshold=-60dB,adelay=250:all=1,asetnsamples=n=1152:p=1'


def spoken(text):
    # Said bare, Higgs stops on the last sound and often clips a final release (gjort, sjuk); a full stop and a pause
    # tag make it finish and fall silent, which the tail check can then confirm. A text line left open (Hej allihop,)
    # is said as a sentence of its own.
    text = text.strip().rstrip(',:;')
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
    """'text' when Whisper wrote the text itself, 'phonetic' when it wrote words that sound the same, else None."""
    if normalize(heard) == normalize(text):
        return 'text'
    return 'phonetic' if heard and phonemes(heard) == phonemes(text) else None


def whisper_model():
    from huggingface_hub import hf_hub_download
    return hf_hub_download(WHISPER, 'ggml-model.bin', revision=WHISPER_REVISION)


def transcribe(paths, model_path):
    """KB-Whisper's text for each WAV, in one whisper-cli run so the model loads once per round."""
    subprocess.run(['/opt/homebrew/bin/whisper-cli', '-m', model_path, '-l', 'sv', '-oj', '-np', *map(str, paths)],
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
KEEP = 25  # 10 ms frames kept after the speech: the clip ends 250 ms after it, inside the pause the tag asked for
GAP = 50   # a loud stretch starting over 500 ms after the last one is a late sound (a click, a breath), not more speech
# A sentence clip can hold a pause of over a second between two sentences of one line (Bra. Jag dukar bordet.), so
# only a stretch starting more than 1.5 s after the last one is a late sound there.
SENTENCE_GAP = 150


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


def tail(pcm, sample_rate, text, gap=GAP):
    """Where the speech starts and ends (frames) and what is wrong with the clip cut KEEP frames after it.

    Levels are 10 ms frames in dB. The floor is the take's own quietest 100 ms, so a faint room tone copied from the
    reference is not itself a flag. Swedish final stops are aspirated: tack, köket and flygplats end in a release up to
    250 ms long after a short closure, so one such burst counts as speech when the last consonants hold a stop.
    Anything later than the cut, often a click in the take's last two codec frames, is trimmed away and only listed."""
    import numpy as np
    frame = sample_rate // 100
    count = len(pcm) // frame
    level = 20 * np.log10(np.sqrt(np.square(pcm[:count * frame].reshape(count, frame)).mean(axis=1)) + 1e-9)
    peak = float(level.max())
    floor = float(np.convolve(level, np.ones(10) / 10, mode='valid').min())
    strong = level > peak - 25
    stretches = runs(strong, 5) or runs(strong, 1)
    begin, end = stretches[0]
    for start, stop in stretches[1:]:
        if start - end > gap:
            break
        end = stop
    threshold = max(peak - 40, floor + 12)
    # The last sound's decay dips and rises around the threshold; a dip shorter than 50 ms is still speech.
    while end < count and level[end:end + 5].max() > threshold:
        end += 1
    bursts = [(end + start, end + stop, float(level[end + start:end + stop].max()) - peak) for start, stop in runs(level[end:] > threshold, 2)]
    # x is said /ks/, so a text ending in x (sex, lax) ends in a stop's release too.
    coda = re.search(r'[^aeiouyåäöé]*$', normalize(text).replace('x', 'ks')).group()
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


def save_wav(path, samples, sample_rate):
    import numpy as np
    with wave.open(str(path), 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(sample_rate)
        stream.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())


def closeness(take):
    """Orders takes when none passed: heard right beats misheard, then fewer tail flags, then the nearer transcript."""
    return (take['heardAs'] is not None, -len(take['tailFlags']), difflib.SequenceMatcher(None, normalize(take['transcript']), normalize(take['text'])).ratio())


class Voice:
    """Higgs loaded once in the cloned voice; take() renders one seed of a text and trims it after its speech."""

    def __init__(self):
        if not (BUILD / 'model.safetensors').exists():
            raise SystemExit(f'No Higgs build at {BUILD}; voices/provenance.json (swedish.build) says how to make it')
        from mlx_audio.tts.utils import load_model
        self.model = load_model(str(BUILD))
        self.reference_codes = self.model.encode_reference_audio(str(REFERENCE))
        self.sample_rate = int(self.model.sample_rate)
        self.frame = self.sample_rate // 100

    def take(self, text, seed, keep_raw=None, gap=GAP):
        """One take of `text`: the trimmed clip and what the tail check found. keep_raw: a path for the take as made."""
        import mlx.core as mx
        import numpy as np
        # Frames allowed: 25 a second, for 2.5 s plus 0.12 s a character, so a take that runs on is stopped and flagged.
        limit = int(25 * (2.5 + 0.12 * len(text))) + 8
        result = next(self.model.generate(text=spoken(text), ref_audio_codes=self.reference_codes, ref_text=REFERENCE_TEXT, seed=seed, max_new_tokens=limit, **SETTINGS))
        pcm = np.asarray(result.audio, dtype=np.float32).reshape(-1)
        mx.clear_cache()
        if keep_raw is not None:
            save_wav(keep_raw, pcm, self.sample_rate)
        found = tail(pcm, self.sample_rate, text, gap)
        clip = pcm[:found['cut'] * self.frame].copy()
        if found['cut'] * self.frame < len(pcm):
            fade = self.sample_rate // 50
            clip[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
        return {'clip': clip, 'found': found, 'frames': result.token_count, 'hitFrameLimit': result.token_count >= limit}
