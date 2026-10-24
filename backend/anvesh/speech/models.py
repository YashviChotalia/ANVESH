"""Replaceable model adapters: ASR, voice emotion, speaker embedding.

Models load in a background thread at startup (`warmup()`), so a first live
call never waits on a download. Until a model is ready its signal is simply
absent and downstream logic abstains; /api/health reports loading / ready /
error. Nothing is ever simulated.
"""

from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass

import numpy as np

from ..config import settings

log = logging.getLogger("anvesh.models")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")


@dataclass
class ModelStatus:
    name: str
    model: str
    loaded: bool
    state: str  # disabled | idle | loading | ready | error
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
        self._loading = False

    def _load(self):  # pragma: no cover - needs model files
        raise NotImplementedError

    def _do_load(self) -> None:
        with self._lock:
            if self._model is not None or self._error is not None:
                return
            self._loading = True
            try:
                self._model = self._load()
                log.info("%s ready: %s", self.name, self.model_id)
            except Exception as e:  # ImportError, download failure, ...
                self._error = f"{type(e).__name__}: {e}"[:300]
                log.warning("%s unavailable: %s", self.name, self._error)
            finally:
                self._loading = False

    def start_loading(self) -> None:
        if self.enabled and self._model is None and self._error is None and not self._loading:
            self._loading = True
            threading.Thread(target=self._do_load, name=f"load-{self.name}", daemon=True).start()

    def get(self, block: bool = True):
        """Return the model. With block=False, never wait: start loading and return None until ready."""
        if not self.enabled or self._error is not None:
            return None
        if self._model is None:
            if block:
                self._do_load()
            else:
                self.start_loading()
        return self._model

    @property
    def state(self) -> str:
        if not self.enabled:
            return "disabled"
        if self._model is not None:
            return "ready"
        if self._error:
            return "error"
        return "loading" if self._loading else "idle"

    def status(self) -> ModelStatus:
        return ModelStatus(self.name, self.model_id, self._model is not None, self.state, self._error, self.license)


HINGLISH_PROMPT = ("Hinglish phone call to cyber police about UPI fraud. Sir mere paise kat gaye, saadhe paanch "
                   "hazaar, do lakh, PhonePe, Google Pay, SBI, at the rate okaxis, OTP, account number.")


class ASR(_Lazy):
    name = "asr"
    license = "MIT (faster-whisper, Whisper weights)"

    def _load(self):  # pragma: no cover
        from faster_whisper import WhisperModel
        return WhisperModel(self.model_id, device=settings.asr_device, compute_type=settings.asr_compute)

    def _language(self, m, audio: np.ndarray) -> str:
        """Fixed language, or auto-detect restricted to the allowed set (avoids 'jw', 'ur' ... mislabels)."""
        cfg = settings.asr_language
        if cfg != "auto":
            return cfg
        allowed = [x for x in settings.asr_languages if x]
        try:  # pragma: no cover - needs model
            _, _, probs = m.detect_language(audio)
            probs = dict(probs)
            return max(allowed, key=lambda l: probs.get(l, 0.0))
        except Exception:
            return allowed[0] if allowed else "en"

    def transcribe(self, audio: np.ndarray, offset: float = 0.0, language: str | None = None) -> tuple[list[dict], str | None]:
        m = self.get(block=True)
        if m is None:
            raise RuntimeError(f"ASR model not available ({self._error})")
        lang = language or self._language(m, audio)
        segs, info = m.transcribe(
            audio, language=lang, task="transcribe", vad_filter=True, word_timestamps=True, beam_size=5,
            condition_on_previous_text=False, initial_prompt=HINGLISH_PROMPT,
        )
        out = []
        for s in segs:
            text = s.text.strip()
            if not text:
                continue
            out.append({
                "start": round(s.start + offset, 2), "end": round(s.end + offset, 2), "text": text,
                "avg_logprob": s.avg_logprob, "no_speech_prob": s.no_speech_prob,
                "words": [{"word": w.word.strip(), "start": round(w.start + offset, 2), "end": round(w.end + offset, 2),
                           "p": round(w.probability, 3)} for w in (s.words or [])],
            })
        # report the spoken language for the distress track; English decoding of Hinglish is still "hi"
        return out, settings.asr_report_language or getattr(info, "language", lang)


class Emotion(_Lazy):
    name = "voice_emotion"
    license = "Check the emotion2vec+ model card (model-license) before commercial use"

    def _load(self):  # pragma: no cover
        from funasr import AutoModel
        hub = "hf" if self.model_id.startswith("emotion2vec/") else "ms"
        return AutoModel(model=self.model_id, hub=hub, disable_update=True, disable_pbar=True)

    def predict(self, audio: np.ndarray) -> dict[str, float] | None:
        m = self.get(block=False)  # never stall a live call waiting for a download
        if m is None:
            return None
        res = m.generate(audio.astype(np.float32), granularity="utterance", extract_embedding=False, disable_pbar=True)
        r = res[0] if isinstance(res, list) else res
        labels = [str(lbl).split("/")[-1].lower() for lbl in r["labels"]]
        return {lbl: round(float(s), 4) for lbl, s in zip(labels, r["scores"])}


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
        m = self.get(block=True)
        if m is None:
            return None
        import torch
        with torch.no_grad():
            e = m.encode_batch(torch.from_numpy(audio.astype(np.float32)).unsqueeze(0)).squeeze().cpu().numpy()
        e = e / (np.linalg.norm(e) + 1e-9)
        return [round(float(v), 6) for v in e]


asr = ASR(settings.asr_model, settings.enable_asr)
emotion = Emotion(settings.emotion_model, settings.enable_emotion)
speaker = Speaker("speechbrain/spkrec-ecapa-voxceleb", settings.enable_speaker)


def warmup() -> None:
    """Start loading every enabled model in the background (downloads on first run)."""
    for m in (asr, emotion, speaker):
        m.start_loading()


def statuses() -> list[dict]:
    return [s.status().__dict__ for s in (asr, emotion, speaker)]
