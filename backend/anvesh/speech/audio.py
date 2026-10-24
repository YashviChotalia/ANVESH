"""Audio decoding and cheap, explainable acoustic features (numpy only)."""

from __future__ import annotations

import io
import wave

import numpy as np

SR = 16_000


def _resample(x: np.ndarray, sr: int) -> np.ndarray:
    if sr == SR or len(x) == 0:
        return x.astype(np.float32)
    n = int(round(len(x) * SR / sr))
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def decode(data: bytes) -> np.ndarray:
    """Decode any common audio format to mono float32 at 16 kHz."""
    try:
        from faster_whisper.audio import decode_audio  # uses PyAV: wav, mp3, m4a, ogg, webm ...
        return decode_audio(io.BytesIO(data), sampling_rate=SR)
    except ImportError:
        pass
    with wave.open(io.BytesIO(data)) as w:
        sr, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    dtype = {1: np.uint8, 2: np.int16, 4: np.int32}[width]
    x = np.frombuffer(raw, dtype=dtype).astype(np.float32)
    if width == 1:
        x = (x - 128) / 128
    else:
        x /= float(2 ** (8 * width - 1))
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return _resample(x, sr)


def pcm16_to_float(data: bytes) -> np.ndarray:
    return np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0


def to_wav_bytes(x: np.ndarray, sr: int = SR) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
    return buf.getvalue()


def _pitch(frame: np.ndarray, sr: int = SR) -> float | None:
    frame = frame - frame.mean()
    if np.sqrt(np.mean(frame ** 2)) < 0.01:
        return None
    corr = np.correlate(frame, frame, mode="full")[len(frame) - 1:]
    lo, hi = int(sr / 400), int(sr / 70)  # 70-400 Hz voice range
    if hi >= len(corr):
        return None
    seg = corr[lo:hi]
    k = int(np.argmax(seg)) + lo
    if corr[0] <= 0 or corr[k] / corr[0] < 0.3:
        return None
    return sr / k


def features(x: np.ndarray, sr: int = SR) -> dict[str, float]:
    """Pitch variability, energy, a speaking-rate proxy, pause ratio and a rough SNR."""
    if len(x) < sr // 2:
        return {}
    win, hop = int(0.04 * sr), int(0.01 * sr)
    frames = np.lib.stride_tricks.sliding_window_view(x, win)[::hop]
    rms = np.sqrt(np.mean(frames ** 2, axis=1)) + 1e-9
    db = 20 * np.log10(rms)
    noise_floor, speech_level = np.percentile(db, 10), np.percentile(db, 90)
    voiced = db > (noise_floor + 0.5 * (speech_level - noise_floor))
    pitches = [p for f, v in zip(frames[::4], voiced[::4]) if v and (p := _pitch(f, sr))]
    # syllable-rate proxy: rising crossings of the voiced mask per second
    onsets = int(np.sum((~voiced[:-1]) & voiced[1:]))
    dur = len(x) / sr
    return {
        "pitch_mean": float(np.mean(pitches)) if pitches else 0.0,
        "pitch_std": float(np.std(pitches)) if len(pitches) > 2 else 0.0,
        "rms": float(np.mean(rms[voiced])) if voiced.any() else 0.0,
        "speech_rate": onsets / dur,
        "pause_ratio": float(1 - voiced.mean()),
        "snr_db": float(speech_level - noise_floor),
    }


def windows(x: np.ndarray, size_s: float = 3.0, sr: int = SR) -> list[tuple[float, float, np.ndarray]]:
    n = int(size_s * sr)
    out = []
    for i in range(0, max(len(x) - n // 2, 1), n):
        chunk = x[i:i + n]
        if len(chunk) >= sr:
            out.append((i / sr, (i + len(chunk)) / sr, chunk))
    return out
