from collections import Counter

from anvesh import official, synth


def test_generated_cases_follow_official_mix_and_are_labelled():
    cases = synth.generate(200, seed=1)
    assert len(cases) == 200 and synth.generate(5, seed=1) == cases[:5]  # deterministic
    assert all(c["caller"].endswith("(synthetic)") for c in cases)
    cats = Counter(c["category"] for c in cases)
    allowed = {t["category"] for t in official.summary()["scam_types"] if t["playbook"]}
    assert set(cats) <= allowed and cats.most_common(1)[0][0].startswith("KYC")  # largest Chakshu category
    assert all(official.context_for(c["district"]) for c in cases)  # every place has NCRB data
