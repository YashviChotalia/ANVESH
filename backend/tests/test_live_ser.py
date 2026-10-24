import numpy as np

from anvesh import live_ser

SR = 16000


def _voice(seconds, amp, f0=160, wobble=10, seed=0):
    rng = np.random.default_rng(seed)
    t = np.arange(int(SR * seconds)) / SR
    env = (np.sin(2 * np.pi * 3 * t) > -0.2).astype(float)  # syllable-like bursts
    x = amp * env * np.sin(2 * np.pi * (f0 + wobble * np.sin(2 * np.pi * 2 * t)) * t)
    return (x + rng.normal(0, 0.002, len(t))).astype(np.float32)


def test_arousal_is_relative_to_the_callers_own_baseline():
    tr = live_ser.LiveEmotionTracker(predict=None)
    calm = [tr.analyse(_voice(3, 0.05, seed=i), i * 3.0) for i in range(4)]
    loud = tr.analyse(_voice(3, 0.35, f0=230, wobble=60, seed=9), 12.0)
    assert all(not w["silent"] for w in calm)
    assert loud["arousal"] > 0.7 > calm[-1]["arousal"]
    assert loud["indicators"]["distress"] > calm[-1]["indicators"]["distress"]
    assert loud["label"] is None  # no model: arousal only, never a guessed emotion name


def test_silence_is_never_scored_and_low_confidence_is_uncertain():
    tr = live_ser.LiveEmotionTracker(predict=lambda x: {"neutral": 0.34, "fearful": 0.33, "sad": 0.33})
    assert tr.analyse(np.zeros(SR * 3, dtype=np.float32), 0)["silent"]
    w = tr.analyse(_voice(3, 0.1), 3)
    assert w["label"] == "uncertain"


def test_smoothing_stops_one_window_flipping_the_reading():
    seq = iter([{"neutral": 0.9, "fearful": 0.1}] * 3 + [{"angry": 0.95, "neutral": 0.05}])
    tr = live_ser.LiveEmotionTracker(predict=lambda x: next(seq))
    labels = [tr.analyse(_voice(3, 0.1, seed=i), i * 3.0)["label"] for i in range(4)]
    assert labels[:3] == ["neutral"] * 3 and labels[3] != "angry"


def test_chunker_cuts_at_a_pause_even_with_background_noise():
    ch = live_ser.Chunker(target_s=5)
    noise = (np.random.default_rng(1).normal(0, 0.01, SR * 2) * 32767).astype(np.int16).tobytes()
    ch.observe(noise)
    speech = (_voice(1, 0.3) * 32767).astype(np.int16).tobytes()
    assert not ch.should_cut(3.0, speech)          # still talking
    assert ch.should_cut(3.0, noise[: SR])         # paused (quiet relative to the room)
    assert ch.should_cut(8.0, speech)              # never wait longer than the max
    assert not ch.should_cut(1.0, noise[: SR])     # too short to be worth transcribing
