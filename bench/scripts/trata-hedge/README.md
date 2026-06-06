# trata-hedge-bench — evaluating our system against an LLM-judge benchmark

[trata-hedge-bench](https://github.com/Trata-Inc/trata-hedge-bench) is a 102-task
financial-analyst benchmark (Harbor format): the agent reads a company's data corpus
(earnings calls, 10-K/10-Q, financials, press releases) and writes an analysis; the
verifier is a **Gemini-3.1-pro 3-task cascade** (hallucination-check → per-move-hit →
synthesis) that grades *concept match* against the expert analyst's documented moves
(`ground_truth.txt`). Graded `score` is 0–4 (themes fully covered); `reward.txt` is
sparse (1 iff all themes). No deployable ground-truth checker — it's an **oracle judge**.

## What's admissible here (and what isn't)

- **NOT** the verifier-grounded selector gate (our HumanEval/commit0 headline). The only
  checker is the judge itself, so selecting by it = selecting by the eval metric (an
  oracle, a Goodhart trap). See `docs/results.md`.
- **IS** admissible: (1) more-compute headroom (pass@k), (2) the **improvement loop**
  (`selfImprove`/GEPA optimizing the analyst directive *against this judge*, held-out
  gated — the legitimate use of a judge domain), with the honest caveat that an
  LLM-judge can be *gamed*, so a held-out lift means "higher judge score," which without
  ground truth we can't independently certify as "better analysis."

## Status (2026-06-06): pipeline PROVEN end-to-end

Our solver → their **real** Gemini-3.1-pro judge → a genuine graded result. Every link
works. The naive **single-shot** baseline (gpt-4o, ~3 of N corpus files in one context
window) scores **0/4** — a floor: it hit only 1/3 moves on a few themes with
hallucinations flagged, because it could not explore the full corpus. The bench is built
for **agentic** exploration; a fair baseline needs our sandbox runtime as the solver
(browse + cite selectively), like the commit0 gate — pending sandbox-gateway health.

## Run it

```bash
# clone the bench once (102 envs, ~580MB; or sparse-checkout one env)
git clone https://github.com/Trata-Inc/trata-hedge-bench /tmp/thb

dotenvx run -f ~/company/devops/secrets/.env.keys -f ~/company/devops/secrets/agent-state.env -- \
  bash bench/scripts/trata-hedge/run.sh /tmp/thb/environments/<env-name> gpt-4o
```

## Gotchas (each cost a debugging cycle)

- **Use `GOOGLE_AI_KEY`, not `GEMINI_API_KEY`** — the latter in the secrets is
  `API_KEY_INVALID`; `GOOGLE_AI_KEY` is the working Gemini key (`gemini-3.1-pro-preview`
  returns 200). `run.sh` maps `GOOGLE_API_KEY=$GOOGLE_AI_KEY` for `grade.py`.
- The router is behind Cloudflare bot-fight: a default urllib User-Agent → 403 (CF 1010)
  on large bodies; the solver sends a browser UA.
- `grade.py` hardcodes `/app/answer.txt` (only that path); `/app` is sudo-writable.
  `DATA_DIR` / `GROUND_TRUTH_PATH` / `REWARD_PATH` / `DETAILS_PATH` are env-overridable, so
  the grader runs **unmodified** (faithful).

## Next steps

1. Agentic solver: our sandbox runtime browses the corpus + cites (fair baseline).
2. The improvement loop: `selfImprove` on the analyst directive vs this judge, held-out
   gated, across the 102 tasks — with the judge-gaming caveat stated.
