# QUANT-ARENA — a self-improving trading-strategy lab

A small, fully auditable research loop: an AI strategy author writes candidate strategies, every candidate is screened for look-ahead bias, backtested walk-forward on overlapping in-sample windows against pinned benchmarks, and judged by an acceptance rule whose bar **rises with every strategy tried**.
Every attempt — accepted, rejected, or killed for leaking — becomes a permanent row in a lab notebook.
The final two years of data are a locked out-of-sample set that only a separate certification command may touch, once.

Everything is plain TypeScript you can read in an afternoon: the backtester is one file with zero dependencies, the acceptance math is one file, the data is committed CSV.

## 1. Quickstart

```bash
# from bench/ (needs node >= 20 and the `claude` CLI logged in)
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
4. **Strategy authors write code.** Each author is a Claude call with a pinned identity (one plain, one with a quant-researcher system prompt). It gets the strategy contract, the universe summary, the benchmarks' per-window Sharpes, and the current acceptance bar — and must reply with one self-contained TypeScript module exporting `generateSignals(bars)`. Model spend is metered into a durable cost log (`cost-ledger.jsonl`) with per-call receipts.
5. **Look-ahead screening, stage 1 (mechanical).** The candidate is re-run on data truncated at several cutoff days. Signals up to each cutoff must be bit-identical to the full-data run — any divergence proves the code read the future, and the candidate is killed with the divergence quoted.
6. **Look-ahead screening, stage 2 (adversarial).** A second, cheap model reads the source with one job: find look-ahead — indexing past `t`, whole-series statistics feeding per-day decisions, hardcoded dates that smell like memorization. Verdict is JSON; anything but a clean verdict kills the candidate, and an unparseable reply kills it too (the rule fails closed).
7. **Backtest and verdict.** Survivors are backtested once over the whole in-sample period (next-day-open fills, 15 bps one-way costs, no shorting, no leverage) and scored per window. The acceptance rule (section 3) decides. Accepted or not, the try is appended to `notebook.jsonl` with its window scores, audit evidence, code hash, and authoring cost.
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

The lab needs exactly two functions from a market-simulation stack; everything else (authors, screening, acceptance rule, notebook) is agnostic to where the numbers come from.

```ts
// 1. Simulate: your engine, your data, your cost model.
//    Must be deterministic for the same inputs.
type Backtest = (bars: Bar[][], signals: Signal[], config: { costBps: number; slippageBps: number }) => BacktestResult

// 2. Score a sub-range: lets the loop evaluate one simulation on many windows.
type StatsForRange = (result: BacktestResult, start: number, end: number) => { sharpe: number /* + your stats */ }
```

Replace the imports of `runBacktest` / `statsForRange` in `quant-loop.mts` and `holdout-certify.mts` with your implementations, and point the data loader at your own Stooq-format CSVs (one file per ticker, `IDX.csv` as the benchmark asset, an `insample/` and a `holdout/` directory).
Keep the physical in-sample/out-of-sample split and the once-only certification rule — they are the point, not an implementation detail.

## Files

| file | what it is |
| --- | --- |
| `backtest.ts` | the whole execution model: next-open fills, bps costs, no shorting — zero dependencies |
| `types.ts` | the strategy contract, including the no-look-ahead rule |
| `windows.ts` | seeded block-bootstrap evaluation windows |
| `multiplicity.ts` | the rising acceptance bar (documented formula + citation) |
| `leak-audit.ts` | the mechanical truncation-invariance check |
| `quant-loop.mts` | the campaign: author -> screen -> backtest -> verdict -> notebook |
| `holdout-certify.mts` | the once-only out-of-sample certification |
| `strategies/` | the three pinned benchmarks |
| `fixtures/data/` | committed daily bars + provenance; `holdout/` is the locked final 2 years |
| `fixtures/demo-campaign/` | a real captured campaign: notebook, authored strategies, cost receipts |
