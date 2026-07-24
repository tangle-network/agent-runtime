"""QUANT-ARENA vectorbt scoring worker.

Persistent process speaking JSON-lines over stdin/stdout. The TypeScript side
(vbt-client.ts) spawns ONE worker per campaign and streams score requests to
it; the worker replies with per-window stats plus the full-range equity curve.

Protocol (one JSON object per line):
  request  {"id": n, "op": "ping"}
  reply    {"id": n, "ok": true, "vbt": "<version>"}

  request  {"id": n, "op": "score",
            "open_prices":  [[T x N floats]],   # fill prices (next-open model)
            "close_prices": [[T x N floats]],   # valuation prices (close-marked equity)
            "weights":      [[N floats] | null, ... T rows],
                                                # decision at day t; null = no rebalance
                                                # (JSON has no NaN — null plays that role)
            "cost_bps": 10, "slippage_bps": 5,
            "windows": [[start, end], ...]}     # [start, end) day-index ranges
  reply    {"id": n, "ok": true,
            "windows": [{"totalReturn", "maxDD", "sharpe", "trades"}, ...],
            "full":    {same shape, over [0, T)},
            "equity":  [T floats]}              # group value, close-marked
  errors   {"id": n, "ok": false, "error": "<message>"}

Execution model (aligned with the TS reference engine, backtest.ts):
  - a decision at the close of day t fills at day t+1's open: the worker
    shifts the weights matrix down one row before handing it to vectorbt;
  - Portfolio.from_orders(size_type='targetpercent', group_by=True,
    cash_sharing=True, call_seq='auto'), fill price = open, valuation
    (val_price for sizing) = open — matching the TS engine's "target dollars
    are a fraction of equity marked at the fill's open";
  - the TS engine charges slippage as a bps FEE on traded dollars, so the
    worker folds slippage_bps into vectorbt's `fees` and passes slippage=0
    (vectorbt's own slippage perturbs the fill price — a different model);
  - stats replicate backtest.ts statsForRange exactly: sample-std (ddof=1)
    annualized Sharpe at 252 days, positive-convention max drawdown with the
    peak reset at each window start, trades counted on fill days inside
    (start, end).

Determinism: NUMBA_NUM_THREADS=1 is pinned before import so JIT-compiled
reductions run single-threaded; a warmup call at startup absorbs the numba
cold-JIT cost before the first real request.

License note: vectorbt is Apache-2.0 + Commons Clause. This worker is for
internal research use (scoring candidate strategies in the lab); it is not
sold or offered as a commercial service.
"""

from __future__ import annotations

import json
import math
import os
import sys

os.environ.setdefault("NUMBA_NUM_THREADS", "1")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import vectorbt as vbt  # noqa: E402

TRADING_DAYS_PER_YEAR = 252


def range_stats(equity: np.ndarray, order_days: np.ndarray, start: int, end: int) -> dict:
    """Mirror of backtest.ts statsForRange over a value curve."""
    if start < 0 or end > equity.shape[0] or end - start < 2:
        raise ValueError(f"bad range [{start}, {end}) over {equity.shape[0]} days")
    eq = equity[start:end]
    total_return = float(eq[-1] / eq[0] - 1.0)
    peak = -math.inf
    max_dd = 0.0
    for value in eq:
        if value > peak:
            peak = value
        dd = (peak - value) / peak
        if dd > max_dd:
            max_dd = dd
    returns = eq[1:] / eq[:-1] - 1.0
    n = returns.shape[0]
    mean = float(returns.mean())
    if n > 1:
        std = float(returns.std(ddof=1))
    else:
        std = 0.0
    sharpe = (mean / std) * math.sqrt(TRADING_DAYS_PER_YEAR) if std > 0 else 0.0
    trades = int(((order_days > start) & (order_days < end)).sum())
    return {
        "totalReturn": total_return,
        "maxDD": float(max_dd),
        "sharpe": float(sharpe),
        "trades": trades,
    }


def run_portfolio(req: dict) -> tuple[np.ndarray, np.ndarray]:
    """Returns (equity curve close-marked, order fill-day indices)."""
    opens = np.asarray(req["open_prices"], dtype=np.float64)
    closes = np.asarray(req["close_prices"], dtype=np.float64)
    if opens.shape != closes.shape or opens.ndim != 2:
        raise ValueError(f"price shape mismatch: open {opens.shape} vs close {closes.shape}")
    T, N = opens.shape
    weights_rows = req["weights"]
    if len(weights_rows) != T:
        raise ValueError(f"weights has {len(weights_rows)} rows for {T} days")

    # Decision at close of t -> order row t+1, filled at t+1's open.
    size = np.full((T, N), np.nan)
    for t, row in enumerate(weights_rows):
        if row is None:
            continue
        if t + 1 >= T:
            continue  # a decision on the final bar can never fill
        if len(row) != N:
            raise ValueError(f"decision at t={t} has {len(row)} weights for {N} assets")
        size[t + 1] = row

    fee_rate = (float(req["cost_bps"]) + float(req["slippage_bps"])) / 10_000.0
    columns = [f"A{k}" for k in range(N)]
    close_df = pd.DataFrame(closes, columns=columns)
    open_df = pd.DataFrame(opens, columns=columns)
    size_df = pd.DataFrame(size, columns=columns)

    pf = vbt.Portfolio.from_orders(
        close=close_df,
        size=size_df,
        price=open_df,
        val_price=open_df,
        size_type="targetpercent",
        group_by=True,
        cash_sharing=True,
        call_seq="auto",
        fees=fee_rate,
        slippage=0.0,
        init_cash=1.0,
        freq="1D",
    )
    equity = np.asarray(pf.value().values, dtype=np.float64)
    order_days = np.asarray(pf.orders.records["idx"], dtype=np.int64)
    return equity, order_days


def score(req: dict) -> dict:
    equity, order_days = run_portfolio(req)
    T = equity.shape[0]
    windows = [range_stats(equity, order_days, int(w[0]), int(w[1])) for w in req["windows"]]
    return {
        "windows": windows,
        "full": range_stats(equity, order_days, 0, T),
        "equity": [float(v) for v in equity],
    }


def warmup() -> None:
    req = {
        "open_prices": [[100.0, 50.0]] * 8,
        "close_prices": [[101.0, 49.5]] * 8,
        "weights": [None, [0.5, 0.4], None, None, [0.2, 0.1], None, None, None],
        "cost_bps": 10,
        "slippage_bps": 5,
        "windows": [[0, 8]],
    }
    score(req)


def main() -> None:
    warmup()
    sys.stdout.write(json.dumps({"ready": True, "vbt": vbt.__version__}) + "\n")
    sys.stdout.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            op = req.get("op")
            if op == "ping":
                reply = {"id": rid, "ok": True, "vbt": vbt.__version__}
            elif op == "score":
                reply = {"id": rid, "ok": True, **score(req)}
            else:
                reply = {"id": rid, "ok": False, "error": f"unknown op {op!r}"}
        except Exception as exc:  # fail per-request, keep serving
            reply = {"id": rid, "ok": False, "error": f"{type(exc).__name__}: {exc}"}
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
