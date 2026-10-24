# Licence inventory

Verify every entry against the exact release you deploy. "Research" means fine for the hackathon demo;
it does not grant commercial rights.

| Asset | Used for | Licence (as understood) | Commercial use | Status |
|---|---|---|---|---|
| faster-whisper | ASR runtime | MIT | Yes | In use |
| Whisper weights (OpenAI) | ASR model | MIT | Yes | In use |
| emotion2vec+ (`iic/emotion2vec_plus_*`) | Voice emotion | "model-license" on the model card | **Unverified** | In use (research); verify before sale |
| FunASR | emotion2vec loader | MIT (code) | Yes (code) | In use |
| SpeechBrain ECAPA (`spkrec-ecapa-voxceleb`) | Speaker embeddings | Apache-2.0 | Yes | Optional |
| sentence-transformers multilingual MiniLM | Script similarity | Apache-2.0 | Yes | Optional |
| scikit-learn, FastAPI, SQLAlchemy, Next.js, React | Application | BSD / MIT | Yes | In use |
| RAVDESS | Possible fine-tuning | CC BY-NC-SA 4.0 | **No** | Not used in product |
| IEMOCAP | Possible evaluation | Academic licence | **No** | Not used |
| CREMA-D | Possible fine-tuning | Open Database Licence | Likely, check terms | Candidate |
| ICFD-31k | Scam-text development | "other" | Unknown | Not used yet |

No customer audio is used for training by default.
