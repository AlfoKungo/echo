"""Teacher-forced Whisper scoring: how likely each candidate text is as the transcript of one clip.

Free transcription picks one text and can mishear a short or near-homophone clip; scoring asks Whisper
about specific texts instead, so "je parlerais" can be weighed against "je parlerai", or "they" against
the "They have." it wrote down freely. Scores are summed log-probabilities (nats), end token included.
"""
import os
import subprocess

os.environ.setdefault('HF_HUB_OFFLINE', '1')
MODEL = 'mlx-community/whisper-large-v3-turbo-asr-fp16'


class Scorer:
    def __init__(self, language):
        import mlx.core as mx
        import numpy as np
        from mlx_audio.stt.utils import load_model
        from mlx_audio.stt.models.whisper.audio import log_mel_spectrogram, pad_or_trim, N_SAMPLES
        self.mx, self.np = mx, np
        self.mel, self.pad, self.samples = log_mel_spectrogram, pad_or_trim, N_SAMPLES
        self.model = load_model(MODEL)
        self.tokenizer = self.model.get_tokenizer(language=language, task='transcribe')

    def __call__(self, path, texts):
        mx, np = self.mx, self.np
        pcm = subprocess.run(['/opt/homebrew/bin/ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
                             capture_output=True, check=True).stdout
        audio = self.pad(mx.array(np.frombuffer(pcm, dtype=np.float32)), self.samples)
        features = self.model.embed_audio(self.mel(audio, n_mels=self.model.dims.n_mels)[None].astype(mx.float16))
        prefix = list(self.tokenizer.sot_sequence_including_notimestamps)
        scores = []
        for text in texts:
            body = self.tokenizer.encode(' ' + text.strip().replace('’', "'")) + [self.tokenizer.eot]
            logits = self.model.logits(mx.array([prefix + body]), features).astype(mx.float32)
            logp = logits - mx.logsumexp(logits, axis=-1, keepdims=True)
            scores.append(round(sum(logp[0, len(prefix) - 1 + i, token].item() for i, token in enumerate(body)), 3))
        mx.clear_cache()
        return scores
