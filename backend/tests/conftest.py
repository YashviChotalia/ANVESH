import os
import sys
import tempfile
from pathlib import Path

# isolated data dir + DB per test session; no ML models in CI
_tmp = tempfile.mkdtemp(prefix="anvesh-test-")
os.environ.setdefault("ANVESH_DATA_DIR", _tmp)
os.environ.setdefault("ANVESH_ENABLE_ASR", "0")
os.environ.setdefault("ANVESH_ENABLE_EMOTION", "0")
os.environ.setdefault("ANVESH_ENABLE_SPEAKER", "0")
os.environ.setdefault("ANVESH_ENABLE_SPOOF", "0")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("ANVESH_KEY_DIR", tempfile.mkdtemp(prefix="anvesh-keys-"))
