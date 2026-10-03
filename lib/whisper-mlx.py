# Speech recognition for Say it on Apple's MLX: Whisper large-v3-turbo, loaded once and kept while Echo calls on it
# (lib/whisper.ts starts and stops this). Two calls, both on a 16 kHz mono 16-bit WAV file Echo has written:
#   POST /transcribe {"path", "prompt"} -> {"text"}: what was said; the prompt tells Whisper which words to expect.
#   POST /score {"path", "texts"} -> {"scores"}: for each text, how likely Whisper finds it for the clip, as the sum of
#     its tokens' log-probabilities with nothing forced and no prompt. Echo compares the answer it wanted with what
#     was heard: an answer nearly as likely as the heard words was probably said, and recognition misread it.
# One request at a time, as the GPU runs one model; the clip's encoding is kept for a score that follows its
# transcription.
import json
import sys
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

import mlx.core as mx
import mlx_whisper
import numpy as np
from mlx_whisper.audio import log_mel_spectrogram, pad_or_trim
from mlx_whisper.tokenizer import get_tokenizer
from mlx_whisper.transcribe import ModelHolder

PORT, REPO = int(sys.argv[1]), sys.argv[2]
# The same copy transcribe() uses, so scoring adds no second model.
model = ModelHolder.get_model(REPO, mx.float16)
tokenizer = get_tokenizer(multilingual=True, num_languages=model.num_languages, language="en", task="transcribe")
encoded = {"path": None, "features": None}


def read(path):
    with wave.open(path, "rb") as clip:
        if clip.getframerate() != 16000 or clip.getnchannels() != 1 or clip.getsampwidth() != 2:
            raise ValueError("expected 16 kHz mono 16-bit WAV")
        return np.frombuffer(clip.readframes(clip.getnframes()), np.int16).astype(np.float32) / 32768


def transcribe(path, prompt):
    result = mlx_whisper.transcribe(read(path), path_or_hf_repo=REPO, language="en", initial_prompt=prompt or None,
                                    temperature=0.0, condition_on_previous_text=False, fp16=True)
    return result["text"].strip()


def score(path, texts):
    if encoded["path"] != path:
        mel = log_mel_spectrogram(pad_or_trim(mx.array(read(path))), n_mels=model.dims.n_mels).astype(mx.float16)
        encoded["features"], encoded["path"] = model.encoder(mel[None]), path
    start = list(tokenizer.sot_sequence_including_notimestamps)
    scores = []
    for text in texts:
        body = tokenizer.encode(" " + text.strip()) + [tokenizer.eot]
        logits = model.decoder(mx.array([start + body]), encoded["features"])[0].astype(mx.float32)
        steps = logits[0, len(start) - 1:len(start) - 1 + len(body)]
        logp = steps - mx.logsumexp(steps, axis=-1, keepdims=True)
        scores.append(round(sum(logp[i, token].item() for i, token in enumerate(body)), 3))
    return scores


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.reply(200, {"ok": True})

    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            if self.path == "/transcribe":
                self.reply(200, {"text": transcribe(body["path"], body.get("prompt", ""))})
            elif self.path == "/score":
                self.reply(200, {"scores": score(body["path"], body["texts"])})
            else:
                self.reply(404, {"error": "not found"})
        except Exception as error:  # the reply carries it to Echo, which reports it
            self.reply(500, {"error": str(error)})

    def reply(self, status, data):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
