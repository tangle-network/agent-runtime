set -euo pipefail
IMG="swebench/sweb.eval.x86_64.sphinx-doc_1776_sphinx-9658:latest"
WS="${1:-$PWD}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/proj"
cat > "$TMP/proj/conf.py" <<'PY'
import os
import sys

sys.path.insert(0, os.path.abspath('.'))
extensions = ['sphinx.ext.autodoc']
# The issue: a class inheriting from a MOCKED base is documented with a
# truncated "Bases" entry ("mocklib.nn." instead of "mocklib.nn.Module").
autodoc_mock_imports = ['mocklib']
PY
cat > "$TMP/proj/mymod.py" <<'PY'
import mocklib


class DeepKernel(mocklib.nn.Module):
    """A kernel inheriting a mocked torch-style base class."""
PY
cat > "$TMP/proj/index.rst" <<'RST'
Test
====

.. autoclass:: mymod.DeepKernel
   :show-inheritance:
RST
cat > "$TMP/repro.sh" <<'SH'
set -u
PROJ="$(mktemp -d)"
cp /repro/proj/* "$PROJ"/
OUT="$(mktemp -d)"
PYTHONPATH=/testbed python -m sphinx -b text -q "$PROJ" "$OUT" || {
    echo "VERIFY FAIL: sphinx build errored"
    exit 1
}
cat "$OUT/index.txt"
if grep -q 'mocklib\.nn\.Module' "$OUT/index.txt"; then
    echo "VERIFY PASS: mocked base class documented as mocklib.nn.Module"
    exit 0
fi
echo "VERIFY FAIL: Bases entry does not name mocklib.nn.Module (mocked base truncated)"
exit 1
SH
exec timeout -k 10 240 docker run --rm --network none \
  -v "$WS":/testbed:ro -v "$TMP":/repro:ro -w /testbed \
  -e PYTHONDONTWRITEBYTECODE=1 \
  "$IMG" bash -lc 'source /opt/miniconda3/etc/profile.d/conda.sh && conda activate testbed && timeout -s KILL 180 bash /repro/repro.sh'
