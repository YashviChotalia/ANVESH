# Evaluation

## 1. Field extraction on spoken forms (automated, runs in CI)

`python backend/eval/run_eval.py` checks the Hinglish normaliser and extractor on
`backend/eval/cases.jsonl`: 20 scripted phrases, 38 field checks (amount, time, UPI, phone,
account, IFSC, UTR, bank, payment app, claimed agency).

**Current result: 38/38 on this set.** This is a *development* set written alongside the code, so it
shows the spoken forms are handled; it is **not** an estimate of accuracy on real calls or on
speech-to-text output. Before the final submission, add a held-out set written by a different team
member and report that number instead.

## 2. Unit and API tests

`pytest -q` covers: number words and identifiers, evidence span mapping, demanded-vs-lost amounts,
UTR/phone/account disambiguation, triage rules (emotion never changes financial priority), distress
role-gating and abstention, coercion/crisis scanning, Ring Linker, field correction stickiness,
audit-chain tamper detection, and the honest failure when no ASR model is installed.

## 3. To measure on the day (fill in, do not estimate)

| Metric | How | Result |
|---|---|---|
| ASR latency per 5 s chunk (laptop, `small`, int8) | backend log timings during a live session | _TBD_ |
| Field accuracy on recorded role-play calls | 15–20 scripted calls through ASR → compare to script | _TBD_ |
| False coercion/crisis alerts on emotional-but-harmless calls | 5 control calls | _TBD_ |
| Evidence-link accuracy | does each field's ▶ jump to the right words? | _TBD_ |
| Intake time: manual form vs Anvesh | stopwatch, same recorded call | _TBD_ |
| Per-language results | report only languages actually tested | _TBD_ |
