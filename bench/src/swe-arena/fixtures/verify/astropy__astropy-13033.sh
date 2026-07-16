#!/usr/bin/env bash
# Self-repro verify for astropy__astropy-13033 — AUTHORED FROM THE PROBLEM
# STATEMENT ONLY (honesty firewall: gold patch never read by the author; it is
# applied mechanically by calibration). Exit 0 = fixed, nonzero = bug present.
#
# Issue: removing a required column from a TimeSeries raises a MISLEADING
# ValueError ("expected 'time' as the first columns but found 'time'") instead
# of telling the user which required columns are missing.
#
# Runs inside the instance's swebench image (conda testbed env) with the
# CURRENT worktree ($PWD) mounted read-only over /testbed — the same jail
# pattern as the repro calibrator (PYTHONPATH=/testbed is load-bearing).
set -euo pipefail
IMG="swebench/sweb.eval.x86_64.astropy_1776_astropy-13033:latest"
WS="${1:-$PWD}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/repro.py" <<'PY'
import sys
import numpy as np
from astropy.time import Time
from astropy.timeseries import TimeSeries

time = Time(np.arange(100000, 100003), format='jd')
ts = TimeSeries(time=time, data={"flux": [99.9, 99.8, 99.7]})
ts._required_columns = ["time", "flux"]
try:
    ts.remove_column("flux")
except ValueError as e:
    msg = str(e)
    print("ValueError:", msg)
    # Fixed behavior: the exception tells the user required column(s) are
    # missing — it must name the missing column ('flux') or say "missing".
    if "flux" in msg or "missing" in msg.lower():
        print("VERIFY PASS: exception names the missing required column")
        sys.exit(0)
    print("VERIFY FAIL: misleading exception (does not name the missing required column)")
    sys.exit(1)
except Exception as e:  # any other exception type is not the informative error either
    print("VERIFY FAIL: unexpected exception:", type(e).__name__, e)
    sys.exit(1)
print("VERIFY FAIL: no exception raised on removing a required column")
sys.exit(1)
PY
exec timeout -k 10 240 docker run --rm --network none \
  -v "$WS":/testbed:ro -v "$TMP":/repro:ro -w /testbed \
  -e PYTHONDONTWRITEBYTECODE=1 \
  "$IMG" bash -lc 'source /opt/miniconda3/etc/profile.d/conda.sh && conda activate testbed && cd /testbed && timeout -s KILL 180 env PYTHONPATH=/testbed python /repro/repro.py'
