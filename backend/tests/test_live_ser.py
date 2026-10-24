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


def test_a_complainant_is_never_read_as_happy():
    happy = {"happy": 0.7, "neutral": 0.2, "fearful": 0.1}
    v = live_ser.adjust_for_role(happy, "victim")
    assert "happy" not in v and abs(sum(v.values()) - 1) < 1e-3 and v["fearful"] > 0.1
    assert live_ser.adjust_for_role(happy, "suspect") == happy  # suspects are not adjusted
    tr = live_ser.LiveEmotionTracker(predict=lambda x: happy, role="victim")
    assert tr.analyse(_voice(3, 0.1), 0)["label"] != "happy"


def test_distress_rises_with_words_and_situation_even_when_voice_is_flat():
    from anvesh import distress
    flat = [distress.Window(i * 3, i * 3 + 3, {"neutral": 0.9, "sad": 0.1},
                            {"pitch_std": 20, "rms": 0.1, "speech_rate": 3, "pause_ratio": 0.2, "snr_db": 30})
            for i in range(6)]
    calm = distress.assess("victim", flat, [], [], language="hi")
    words = [{"phrase": "please help"}, {"phrase": "dar lag raha"}]
    tense = distress.assess("victim", flat, words, [], language="hi", coercion=True, loss_reported=True)
    assert calm.level == "low" and tense.level in ("elevated", "high") and tense.score > calm.score
    old_happy = [distress.Window(0, 3, {"happy": 0.9, "neutral": 0.1}, None)]
    assert all(p["label"] != "happy" for p in distress.assess("victim", old_happy, [], []).timeline)
