#!/usr/bin/env bash
# Self-repro verify for matplotlib__matplotlib-20826 — AUTHORED FROM THE
# PROBLEM STATEMENT ONLY (honesty firewall: gold patch never read by the
# author; it is applied mechanically by calibration). Exit 0 = fixed,
# nonzero = bug present.
#
# Issue: on shared axes (plt.subplots(2, 2, sharex=True, sharey=True)),
# ax.clear() un-hides tick labels that sharing should hide and adds extra
# top/right ticks. The problem statement's own control: with the clear() call
# removed, the plot is identical to the correct output. So the check is a
# paired comparison — per-subplot tick/label visibility state must be
# IDENTICAL between a cleared and an uncleared figure.
set -euo pipefail
IMG="swebench/sweb.eval.x86_64.matplotlib_1776_matplotlib-20826:latest"
WS="${1:-$PWD}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/repro.py" <<'PY'
import sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

x = np.arange(0.0, 2 * np.pi, 0.01)
y = np.sin(x)


def make(clear):
    fig, axes = plt.subplots(2, 2, sharex=True, sharey=True)
    for ax in axes.flatten():
        if clear:
            ax.clear()
        ax.plot(x, y)
    fig.canvas.draw()
    return fig, axes


def tick_state(ax):
    def axis_state(axis):
        return [
            (
                bool(t.tick1line.get_visible()),
                bool(t.tick2line.get_visible()),
                bool(t.label1.get_visible()),
                bool(t.label2.get_visible()),
            )
            for t in axis.get_major_ticks()
        ]
    return {'x': axis_state(ax.xaxis), 'y': axis_state(ax.yaxis)}


fig_ref, axes_ref = make(clear=False)
fig_test, axes_test = make(clear=True)

mismatches = []
for (i, j) in [(0, 0), (0, 1), (1, 0), (1, 1)]:
    ref = tick_state(axes_ref[i][j])
    test = tick_state(axes_test[i][j])
    if ref != test:
        mismatches.append((i, j, ref, test))

if mismatches:
    for i, j, ref, test in mismatches:
        print(f"VERIFY FAIL: axes[{i}][{j}] tick/label visibility differs after clear()")
        print("  without clear:", ref)
        print("  with clear:   ", test)
    sys.exit(1)
print("VERIFY PASS: clear() preserves shared-axis tick/label visibility")
sys.exit(0)
PY
exec timeout -k 10 240 docker run --rm --network none \
  -v "$WS":/testbed:ro -v "$TMP":/repro:ro -w /testbed \
  -e PYTHONDONTWRITEBYTECODE=1 \
  "$IMG" bash -lc 'source /opt/miniconda3/etc/profile.d/conda.sh && conda activate testbed && cd /testbed && timeout -s KILL 180 env PYTHONPATH=/testbed python /repro/repro.py'
