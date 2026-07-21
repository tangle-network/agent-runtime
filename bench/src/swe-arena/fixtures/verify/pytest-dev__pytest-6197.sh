set -euo pipefail
IMG="swebench/sweb.eval.x86_64.pytest-dev_1776_pytest-6197:latest"
WS="${1:-$PWD}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/repro.sh" <<'SH'
set -u
# Issue repro: a non-test package __init__.py under rootdir must NOT be
# imported during collection. At the regressed base, `pytest` errors out
# collecting foobar/__init__.py (assert False) and exits nonzero.
PROJ="$(mktemp -d)"
cd "$PROJ"
mkdir foobar
echo 'assert False' > foobar/__init__.py
cat > test_foo.py <<'EOF'
def test_foo():
    assert True
EOF
# pytest 5.2.x is a src layout; put the workspace checkout first on the path.
PYTHONPATH=/testbed/src python -m pytest -p no:cacheprovider
rc=$?
if [ "$rc" -ne 0 ]; then
    echo "VERIFY FAIL: pytest collected/imported foobar/__init__.py (rc=$rc)"
    exit 1
fi
echo "VERIFY PASS: pytest ran the test without touching the stray __init__.py"
exit 0
SH
exec timeout -k 10 240 docker run --rm --network none \
  -v "$WS":/testbed:ro -v "$TMP":/repro:ro -w /testbed \
  -e PYTHONDONTWRITEBYTECODE=1 \
  "$IMG" bash -lc 'source /opt/miniconda3/etc/profile.d/conda.sh && conda activate testbed && timeout -s KILL 180 bash /repro/repro.sh'
