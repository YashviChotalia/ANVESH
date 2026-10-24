"""Replaceable model adapters: ASR, voice emotion, speaker embedding.

Each adapter loads lazily and reports its status. If a model is not
installed, the API says so plainly at /api/health. Nothing is faked: a missing
model means that signal is absent, and downstream logic abstains.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

import numpy as np

from ..config import settings

log = logging.getLogger("anvesh.models")


@dataclass
class ModelStatus:
    name: str
    model: str
    loaded: bool
    error: str | None = None
    license: str | None = None


class _Lazy:
    name = "model"
    license = None

    def __init__(self, model_id: str, enabled: bool):
        self.model_id = model_id
        self.enabled = enabled
        self._model = None
        self._error: str | None = None if enabled else "disabled by configuration"
        self._lock = threading.Lock()

    def _load(self):  # pragma: no cover - needs model files
        raise NotImplementedError

    def get(self):
        if not self.enabled:
            return None
        if self._model is None and self._error is None:
            with self._lock:
                if self._model is None and self._error is None:
                    try:
                        self._model = self._load()
                        log.info("%s loaded: %s", self.name, self.model_id)
                    except Exception as e:  # ImportError, download failure, ...
                        self._error = f"{type(e).__name__}: {e}"[:300]
                        log.warning("%s unavailable: %s", self.name, self._error)
        return self._model

    def status(self) -> ModelStatus:
        return ModelStatus(self.name, self.model_id, self._model is not None, self._error, self.license)


class ASR(_Lazy):
    name = "asr"
    license = "MIT (faster-whisper, Whisper weights)"

    def _load(self):  # pragma: no cover
        from faster_whisper import WhisperModel
        return WhisperModel(self.model_id, device=settings.asr_device, compute_type=settings.asr_compute)

    def transcribe(self, audio: np.ndarray, offset: float = 0.0, language: str | None = None) -> tuple[list[dict], str | None]:
        m = self.get()
        if m is None:
            raise RuntimeError(f"ASR model not available ({self._error})")
        segs, info = m.transcribe(
            audio, language=language, vad_filter=True, word_timestamps=True, beam_size=5,
            initial_prompt="Hinglish phone call to cyber police about UPI fraud: paise, hazaar, lakh, OTP, "
                           "PhonePe, Google Pay, SBI, at the rate, account number.",
        )
        out = []
        for s in segs:
            out.append({
                "start": round(s.start + offset, 2), "end": round(s.end + offset, 2), "text": s.text.strip(),
                "avg_logprob": s.avg_logprob, "no_speech_prob": s.no_speech_prob,
                "words": [{"word": w.word.strip(), "start": round(w.start + offset, 2), "end": round(w.end + offset, 2),
                           "p": round(w.probability, 3)} for w in (s.words or [])],
            })
        return out, getattr(info, "language", None)


class Emotion(_Lazy):
    name = "voice_emotion"
    license = "Check the emotion2vec+ model card (model-license) before commercial use"

    def _load(self):  # pragma: no cover
        from funasr import AutoModel
        hub = "hf" if "/" in self.model_id and self.model_id.startswith("emotion2vec/") else "ms"
        return AutoModel(model=self.model_id, hub=hub, disable_update=True)

    def predict(self, audio: np.ndarray) -> dict[str, float] | None:
        m = self.get()
        if m is None:
            return None
        res = m.generate(audio, granularity="utterance", extract_embedding=False)
        r = res[0] if isinstance(res, list) else res
        labels = [str(lbl).split("/")[-1].lower() for lbl in r["labels"]]
        return {lbl: float(s) for lbl, s in zip(labels, r["scores"])}


class Speaker(_Lazy):
    name = "speaker_embedding"
    license = "Apache-2.0 (SpeechBrain ECAPA-TDNN, VoxCeleb)"

    def _load(self):  # pragma: no cover
        try:
            from speechbrain.inference.speaker import EncoderClassifier
        except ImportError:
            from speechbrain.pretrained import EncoderClassifier
        return EncoderClassifier.from_hparams(source=self.model_id,
                                              savedir=str(settings.data_dir / "models" / "ecapa"))

    def embed(self, audio: np.ndarray) -> list[float] | None:
        m = self.get()
        if m is None:
            return None
        import torch
        with torch.no_grad():
            e = m.encode_batch(torch.from_numpy(audio).unsqueeze(0)).squeeze().cpu().numpy()
        e = e / (np.linalg.norm(e) + 1e-9)
        return [round(float(v), 6) for v in e]


asr = ASR(settings.asr_model, settings.enable_asr)
emotion = Emotion(settings.emotion_model, settings.enable_emotion)
speaker = Speaker("speechbrain/spkrec-ecapa-voxceleb", settings.enable_speaker)


def statuses() -> list[dict]:
    return [s.status().__dict__ for s in (asr, emotion, speaker)]
