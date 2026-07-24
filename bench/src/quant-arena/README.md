# QUANT-ARENA — a self-improving trading-strategy lab

A small, fully auditable research loop: an AI strategy author writes candidate strategies, every candidate is screened for look-ahead bias, backtested walk-forward on overlapping in-sample windows against pinned benchmarks, and judged by an acceptance rule whose bar **rises with every strategy tried**.
Every attempt — accepted, rejected, or killed for leaking — becomes a permanent row in a lab notebook.
The final two years of data are a locked out-of-sample set that only a separate certification command may touch, once.

Everything is plain TypeScript you can read in an afternoon: the backtester is one file with zero dependencies, the acceptance math is one file, the data is committed CSV.

## 1. Quickstart

```bash
# from bench/ (needs node >= 20, the `claude` CLI logged in, and `uv` on PATH
# — scoring runs in a pinned python environment, see "Two engines" below)
npx tsx src/quant-arena/quant-loop.mts --out /tmp/quant-demo --candidates 2
```

That runs a full research campaign: 2 strategy authors x 2 candidates each — the committed capture of exactly this command cost $1.65 of model spend across 8 metered calls; backtests are free.
No API? `--skip-llm-audit` keeps everything but the adversarial code review; the mechanical look-ahead check still runs.

Run the unit tests (backtester hand-computed cases, look-ahead detection, acceptance math, window reproducibility):

```bash
npx vitest run src/quant-arena
```

## 2. What happens when you run it

1. **Data loads.** ~8 years of daily bars for 11 tickers (an index `IDX` plus `S01`-`S10`) from `fixtures/data/insample/`. The final 2 years live in `fixtures/data/holdout/` and are **not** loaded — see step 8. The series are synthetic (regime-switching factor model, seeded, regenerable) because the free real-data source we checked licenses personal use only; `fixtures/data/PROVENANCE.md` has the details and how to drop in your own CSVs.
2. **Evaluation windows are drawn.** 8 overlapping 504-day (~2-year) blocks, block-bootstrap sampled from the in-sample years with a fixed seed — every candidate in the campaign is scored on the same windows, and reruns reproduce bit-identically.
3. **Benchmarks run.** Three pinned incumbents: buy-and-hold the index, equal-weight monthly rebalance, and a 20/100 moving-average crossover. Their per-window Sharpe ratios define the bar: "best benchmark" is the per-window maximum.
4. **Strategy authors write code.** Each author is a Claude call with a pinned identity (one plain, one with a quant-researcher system prompt). It gets the strategy contract, the universe summary, the benchmarks' per-window Sharpes, and the current acceptance bar — and must reply with one self-contained TypeScript module exporting `onBar(ctx)`: the harness calls it once per trading day with the bars **up to that day only** (the arrays are physically sliced, so reading the future is structurally impossible), plus the strategy's current holdings and equity, and it answers with target portfolio weights or "hold". Strategies never place orders — a single shared rebalancer (`oms.ts`) turns everyone's target weights into orders under the same sizing rule, LEAN-style `(targetWeight x equity - currentPosition) / price`, long-only. Model spend is metered into a durable cost log (`cost-ledger.jsonl`) with per-call receipts.
5. **Look-ahead screening, stage 1 (mechanical).** The candidate is re-run on data truncated at several cutoff days. Signals up to each cutoff must be bit-identical to the full-data run — any divergence proves the code read the future, and the candidate is killed with the divergence quoted.
6. **Look-ahead screening, stage 2 (adversarial).** A second, cheap model reads the source with one job: find look-ahead — indexing past `t`, whole-series statistics feeding per-day decisions, hardcoded dates that smell like memorization. Verdict is JSON; anything but a clean verdict kills the candidate, and an unparseable reply kills it too (the rule fails closed).
7. **Backtest and verdict.** Survivors are backtested over the whole in-sample period (next-day-open fills, 15 bps one-way costs, no shorting, no leverage) and scored per window. Two engines run: the one-file TypeScript reference engine first, as a fail-closed contract check, then the industry-standard **vectorbt** engine (a persistent python worker in a version-locked environment) produces the official numbers. A parity test suite holds the two engines to agreement on golden fixtures — exact on a no-trade book, within machine precision whenever the book holds cash, and within a documented 0.5% on fully-invested books (the engines differ only in whether fees may be financed by a slightly negative cash balance). The acceptance rule (section 3) decides. Accepted or not, the try is appended to `notebook.jsonl` with its window scores, audit evidence, code hash, and authoring cost.
8. **Certification, later and by hand.** When you believe a winner, run it once against the untouched final 2 years:

   ```bash
   npx tsx src/quant-arena/holdout-certify.mts --strategy <path>/strategy.ts --out /tmp/quant-demo
   ```

   It backtests in-sample + out-of-sample on one axis (so lookbacks are warm), scores only the out-of-sample days against the same three benchmarks, and appends the in-sample vs out-of-sample comparison to the notebook. A second run for the same strategy hash refuses without `--force` — an out-of-sample set answers once; re-rolling it until it agrees turns it into another in-sample set.

## 3. Why the acceptance rule is strict

If you test enough random strategies against the same data, the best one looks brilliant by luck alone.
Under the assumption of zero skill, the expected best Sharpe among N independent tries grows roughly like sqrt(2 ln N) — try 50 strategies and luck alone buys the winner a substantial edge.
So the bar a candidate must clear is not fixed: it is `0.10 + 0.15 * sqrt(2 ln N)` of mean excess Sharpe, where N counts **every** candidate ever tried in the campaign, including ones killed for leaking (this is a simplified, auditable version of the Deflated Sharpe Ratio of Bailey & Lopez de Prado, Journal of Portfolio Management, 2014).
A candidate must ALSO beat the best benchmark in at least 6 of the 8 windows, because one lucky two-year stretch should never carry a decision.
Every try is a permanent notebook row, so N can never be quietly reset — the price of another shot at the data is a higher bar for everyone after it.

## 4. Reading the notebook

`notebook.jsonl` is append-only JSON lines. Three row types:

- `quant-arena.baselines.v1` — the campaign header: seed, cost assumptions, the 8 windows with dates, and each benchmark's per-window Sharpe.
- `quant-arena.candidate.v1` — one per try. The fields that matter:
  - `nTried` — this try's position in the campaign; sets its acceptance bar.
  - `leakAudit.truncation` / `leakAudit.llm` — both screening verdicts with evidence.
  - `eval.perWindow` — Sharpe vs best-benchmark Sharpe for each window, with dates.
  - `verdict` — `accepted`, `rejected-no-edge` (failed the acceptance rule), `rejected-leak`, `rejected-contract` (didn't satisfy the module contract), or `rejected-error`.
  - `reasons` — the decision spelled out, numbers included.
- `quant-arena.certification.v1` — the one-shot out-of-sample result, in-sample stats side by side.

A real excerpt from the committed demo campaign (`fixtures/demo-campaign/`): try #4 cleared both look-ahead screens, then lost to the benchmarks in 7 of 8 windows — and after four tries the bar it would have needed had already risen to 0.35 (condensed for width):

```
{
  "candidateId": "cand-004-quant-researcher",
  "proposer": "quant-researcher",
  "nTried": 4,
  "leakAudit": {
    "truncation": {
      "clean": true
    },
    "llm": {
      "verdict": "clean"
    }
  },
  "eval": {
    "wins": 1,
    "requiredWins": 6,
    "meanExcessSharpe": -0.085,
    "threshold": 0.35,
    "perWindow": [
      {
        "startDate": "2017-04-06",
        "endDate": "2019-03-12",
        "sharpe": 0.94,
        "bestBaselineSharpe": 1.21,
        "excess": -0.27
      },
      {
        "startDate": "2018-04-18",
        "endDate": "2020-03-23",
        "sharpe": 0.56,
        "bestBaselineSharpe": 0.61,
        "excess": -0.05
      },
      {
        "startDate": "2018-08-06",
        "endDate": "2020-07-09",
        "sharpe": 0.2,
        "bestBaselineSharpe": 0.29,
        "excess": -0.08
      },
      "... 5 more windows"
    ]
  },
  "verdict": "rejected-no-edge",
  "reasons": [
    "consistency: beat the best baseline in only 1/8 windows (need 6)",
    "multiplicity: mean excess Sharpe -0.085 < required 0.350 (bar after 4 tried candidates)"
  ]
}
```

## 5. Plugging in your own backtester and data

Scoring goes through one narrow seam: a worker process that takes `{open prices, close prices, target-weight rows, costs, windows}` as JSON lines on stdin and answers `{per-window total return / max drawdown / Sharpe / trade count, full equity curve}` on stdout — see the protocol comment at the top of `python/vbt-worker.py` and the client in `vbt-client.ts`.
The shipped worker is vectorbt (`Portfolio.from_orders`, target-percent sizing, shared cash, sells before buys), version-locked by `python/pyproject.toml` + `python/uv.lock`; to swap in your own engine, speak the same protocol and keep the fill model (decide at close, fill at next open, bps fees on traded dollars) or re-derive the parity fixtures in `vbt-parity.test.mts` for your model.
Point the data loader at your own Stooq-format CSVs (one file per ticker, `IDX.csv` as the benchmark asset, an `insample/` and a `holdout/` directory).
Keep the physical in-sample/out-of-sample split and the once-only certification rule — they are the point, not an implementation detail.
A third engine is planned but not built: event-driven certification of a winner's order stream through Nautilus Trader (`nautilus-certify.ts` is the named stub).

## Files

| file | what it is |
| --- | --- |
| `types.ts` | the strategy contract (v2 `onBar` + the order types), including the no-look-ahead rule |
| `driver.ts` | the incremental harness: feeds `onBar` day by day with physically truncated history; wraps old batch strategies unchanged |
| `oms.ts` | the one shared rebalancer: target weights -> orders (strategies never place orders) |
| `backtest.ts` | the TypeScript reference engine: next-open fills, bps costs, no shorting — zero dependencies; contract prefilter |
| `vbt-client.ts` + `python/vbt-worker.py` | the official scorer: persistent vectorbt worker, pinned env (`python/uv.lock`), crash-safe request handling |
| `vbt-parity.test.mts` | the two engines held to agreement on golden fixtures (prints both curves on any disagreement) |
| `nautilus-certify.ts` | named stub for the planned event-driven certification engine (not implemented) |
| `windows.ts` | seeded block-bootstrap evaluation windows |
| `multiplicity.ts` | the rising acceptance bar (documented formula + citation) |
| `leak-audit.ts` | the mechanical truncation-invariance check |
| `quant-loop.mts` | the campaign: author -> screen -> backtest -> verdict -> notebook |
| `holdout-certify.mts` | the once-only out-of-sample certification |
| `strategies/` | the three pinned benchmarks |
| `fixtures/data/` | committed daily bars + provenance; `holdout/` is the locked final 2 years |
| `fixtures/demo-campaign/` | a real captured campaign against the v1 batch contract: notebook, authored strategies, cost receipts |
| `fixtures/demo-campaign-v2/` | a real captured campaign against the v2 `onBar` contract (1 candidate, honestly rejected: 0/8 windows) |
