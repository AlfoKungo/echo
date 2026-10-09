"""Cut a short French phrase out of "<carrier><phrase>." said in one take.

Whisper often mishears a word or a short form said on its own (ils vont as "il vont", tu peux as "tu peu"), so it is
said after a carrier ("On dit : ") and cut out inside the pause the voice leaves after it. A cut placed by token
timing alone landed inside "dit" (a stray sound before the word) or inside the word (its first syllable lost), so the
cut goes in the first clear pause after the carrier's last token, and only when that pause comes before the phrase.
Used by render-audio.py (vocabulary words) and render-radio.py (short phrases of the verb tape and By ear).
"""
import json
import subprocess
import unicodedata
from pathlib import Path

import numpy as np

MIN_PAUSE = 8   # 10 ms frames: the colon pause; a stop closure inside a word is shorter
MAX_TAIL = 30   # frames of the carrier allowed after its last token's anchor before the pause
LEAD = 3        # frames of silence kept before the word
QUIET_DB = 35   # a frame is silent when this far below the loudest frame
# A lead-in that ends the sentence ("Écoutez.") separates even short words such as "mais" or "donc"; "On dit…" makes
# the voice stop where "On dit :" sometimes runs on.
CARRIERS = ('On dit : ', 'On dit… ', 'Écoutez. ')
WHISPER_MODEL = Path.home() / '.local/share/whisper-models/ggml-large-v3-turbo.bin'


class NoCut(Exception):
    """The take gives no clean cut; `details` says why, for the failure log."""

    def __init__(self, error, **details):
        super().__init__(error)
        self.error = error
        self.details = details


def normalize(text):
    text = unicodedata.normalize('NFC', text.lower().replace('œ', 'oe'))
    return ''.join(character for character in text if character.isalnum())


def transcribe_tokens(path, keep=False, language='fr'):
    """Whisper's text and its tokens with DTW timings (t_dtw, in centiseconds) for a 16-bit WAV file, heard as
    `language` (French unless render-audio.py records another)."""
    subprocess.run(['/opt/homebrew/bin/whisper-cli', '-m', str(WHISPER_MODEL), '-l', language, '--dtw', 'large.v3.turbo', '--no-flash-attn', '-ojf', '-np', str(path)],
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
    result_path = Path(str(path) + '.json')
    # whisper.cpp can split one accented letter across two tokens, leaving bytes that are not UTF-8 on their own; such
    # a token reads as U+FFFD, which normalize() drops, so at worst the carrier is not found and the take is refused.
    result = json.loads(result_path.read_bytes().decode('utf-8', errors='replace'))
    if not keep:
        result_path.unlink()
    return {'text': ''.join(segment['text'] for segment in result['transcription']),
            'tokens': [token for segment in result['transcription'] for token in segment['tokens']]}


def cut_after_carrier(pcm, sample_rate, tokens, carrier):
    """The phrase from `pcm` (float samples of the whole take), with a short fade in: (clip, cut in seconds, pause as
    a pair of frame indexes). Raises NoCut when the carrier's end, a clear pause or the phrase after it is missing."""
    tokens = [token for token in tokens if token['t_dtw'] >= 0 and normalize(token['text'])]
    prefix = ''
    boundary = None
    for token_index, token in enumerate(tokens):
        prefix += normalize(token['text'])
        if prefix == normalize(carrier):
            boundary = token_index
            break
    if boundary is None or boundary + 1 >= len(tokens):
        raise NoCut('No reliable word boundary')
    frame = sample_rate // 100
    count = len(pcm) // frame
    level = 20 * np.log10(np.sqrt(np.square(pcm[:count * frame].reshape(count, frame)).mean(axis=1)) + 1e-9)
    quiet = level < level.max() - QUIET_DB
    carrier_anchor = int(tokens[boundary]['t_dtw'])  # t_dtw is in centiseconds, i.e. frames
    word_anchor = int(tokens[boundary + 1]['t_dtw'])
    pause, run = None, 0
    for position in range(carrier_anchor, count):
        run = run + 1 if quiet[position] else 0
        if run == MIN_PAUSE:
            end = position + 1
            while end < count and quiet[end]:
                end += 1
            pause = (position + 1 - MIN_PAUSE, end)
            break
    # The pause must follow the carrier closely and come before the word: a pause found later lies inside the word,
    # and cutting there would drop its first syllable.
    if pause is None or pause[0] - carrier_anchor > MAX_TAIL or pause[0] > word_anchor or pause[1] >= count:
        raise NoCut('No clear pause before the word', pause=pause, carrierAnchor=carrier_anchor, wordAnchor=word_anchor)
    cut = max(pause[0], pause[1] - LEAD) * frame / sample_rate
    clip = pcm[int(cut * sample_rate):].copy()
    if np.count_nonzero(~quiet[pause[1]:]) < 10:
        raise NoCut('Too little speech after the pause')
    fade = min(len(clip), sample_rate // 200)
    clip[:fade] *= np.linspace(0, 1, fade, dtype=np.float32)
    return clip, cut, pause
