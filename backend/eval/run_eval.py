"""Field-extraction evaluation on a labelled set of scripted Hinglish/English phrases.

These phrases are written by the team (synthetic), so the score measures the
normaliser and extractor on known spoken forms. It is NOT a measure of
accuracy on real police calls or on speech-to-text output.
Usage: python eval/run_eval.py [path.jsonl]
"""
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from anvesh.nlp.extract import Segment, extract  # noqa: E402

NOW = datetime(2026, 10, 24, 15, 0)


def main(path: Path) -> int:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    per_field: dict[str, list[bool]] = {}
    failures = []
    for r in rows:
        f = extract([Segment("s0", 0, 6, r["text"], "caller")], NOW)
        for key, want in r["expect"].items():
            if key == "incident_minutes_ago":
                got_f = f.get("incident_time")
                got = None if not got_f else int((NOW - datetime.fromisoformat(got_f.value)).total_seconds() // 60)
                ok = got == want
            else:
                got_f = f.get(key)
                got = None if not got_f else got_f.value
                if isinstance(want, (int, float)) and got is not None:
                    ok = float(got) == float(want)
                else:
                    ok = (got == want) if want is not None else got is None
            per_field.setdefault(key, []).append(ok)
            if not ok:
                failures.append((r["id"], key, want, got))
    total = sum(len(v) for v in per_field.values())
    correct = sum(sum(v) for v in per_field.values())
    print(f"Synthetic phrase set: {len(rows)} phrases, {total} field checks")
    print(f"{'field':<22}{'correct':>8}{'total':>7}{'accuracy':>10}")
    for k, v in sorted(per_field.items()):
        print(f"{k:<22}{sum(v):>8}{len(v):>7}{sum(v) / len(v):>10.0%}")
    print(f"{'ALL':<22}{correct:>8}{total:>7}{correct / total:>10.0%}")
    for fid, key, want, got in failures:
        print(f"  MISS {fid} {key}: expected {want!r}, got {got!r}")
    return 0 if correct / total >= 0.85 else 1


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("cases.jsonl")))
