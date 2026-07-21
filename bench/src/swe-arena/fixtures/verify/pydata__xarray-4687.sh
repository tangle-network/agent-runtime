set -euo pipefail
IMG="swebench/sweb.eval.x86_64.pydata_1776_xarray-4687:latest"
WS="${1:-$PWD}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/repro.py" <<'PY'
import sys

import xarray as xr

# Issue: xr.where drops the attributes of its DataArray argument. Expected
# behavior per the report: "Attributes should be preserved or at least there
# should be a choice (e.g. ... keep_attrs=True)". Accept either design: attrs
# preserved on a plain call (from whichever DataArray argument carries them),
# or preserved when explicitly requested via keep_attrs=True. At the buggy
# base ALL variants drop attrs (and keep_attrs is not accepted), so this
# fails; a fix satisfying the issue makes at least one variant preserve them.
da = xr.DataArray(1)
da.attrs['foo'] = 'bar'

def attempts():
    yield 'default, attrs on y', lambda: xr.where(da == 0, -1, da)
    yield 'default, attrs on x', lambda: xr.where(da == 1, da, -1)
    yield 'keep_attrs=True, attrs on y', lambda: xr.where(da == 0, -1, da, keep_attrs=True)
    yield 'keep_attrs=True, attrs on x', lambda: xr.where(da == 1, da, -1, keep_attrs=True)

for label, call in attempts():
    try:
        res = call()
    except TypeError as err:
        print(f"variant skipped ({label}): {err}")
        continue
    if res.attrs.get('foo') == 'bar':
        print(f"VERIFY PASS: xr.where preserves DataArray attributes ({label})")
        sys.exit(0)
    print(f"variant dropped attrs ({label}): got {dict(res.attrs)!r}")

print("VERIFY FAIL: no xr.where invocation preserves DataArray attributes")
sys.exit(1)
PY
exec timeout -k 10 240 docker run --rm --network none \
  -v "$WS":/testbed:ro -v "$TMP":/repro:ro -w /testbed \
  -e PYTHONDONTWRITEBYTECODE=1 \
  "$IMG" bash -lc 'source /opt/miniconda3/etc/profile.d/conda.sh && conda activate testbed && cd /testbed && timeout -s KILL 180 env PYTHONPATH=/testbed python /repro/repro.py'
