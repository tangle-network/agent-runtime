> **Track:** Architecture (research) · **Role:** layer stress-test · **Status:** architecture decision — export-only today; the across-run layer's natural home

# Layer: intelligence serving — self-hosted vs platform-served

**The question (operator-posed):** today the loop *self-hosts* its intelligence
gathering (`observe()` runs in-process, the `Corpus` is a local JSONL). Should **Tangle
Intelligence** instead *serve* intelligence to agents and agent teams — and is what we
built pointing toward that or away from it?

## Ground truth: what Tangle Intelligence is today

Verified against the code (otel-export.ts, examples/intelligence-export,
agents-of-all-shapes, the sandbox SDK):

| surface | direction | shape |
|---|---|---|
| `createOtelExporter` → `/v1/traces` | **export only** | OTel GenAI spans (loop topology, usage, cost) |
| `exportEvalRuns` → `/v1/ingest/eval-runs` | **export only** | eval provenance (baselines, generations, gates, InsightReport) |
| sandbox `createIntelligenceReport` / `createAgenticIntelligenceReport` | async pull | fleet/box-level report, `queued→completed`, dashboard-shaped |
| `/v1/insights/outputs?kind=report` | human dashboard | no programmatic agent contract |

**Verdict: export-only.** Nothing in `src/` reads Intelligence back into a loop. The
in-loop intelligence is entirely `observe()` (per-run, synchronous, ~1 LLM call,
firewalled) + `Corpus` (local durable facts, `corpus.query()` → next-run priming).

## The two systems are layered, not duplicates

| | `observe()` + `Corpus` (in-process) | Tangle Intelligence (hosted) |
|---|---|---|
| granularity | one run's trace → findings *now* | fleet-scale, multi-run clustering, lift CIs, Pareto |
| latency | in-loop (<1s need) | async (seconds–minutes) |
| store | local JSONL per product | server-side, tenant-wide |
| consumer | the very next shot/run | humans (dashboards) |
| firewall | **structural** (`derived_from_judge:false`; input carries no score) | **none** — InsightReport embeds judge-derived stats |

So the answer to "are we self-hosting what Intelligence should serve?" is: **partially,
and the split should be by timescale.** The *within-run* critic must stay in-process
(latency, firewall, per-run context). The *across-run* memory — the corpus, the fleet
patterns, the "what do we know about failures like this" query — is exactly what a
hosted service does better: amortized analysis across every run of every product in the
tenant, cached, one place to curate. **Tangle Intelligence is the natural home of the
across-run layer** (`layer-across-run.md`), and today's local JSONL corpus is the
self-hosted stopgap for a read-back API that doesn't exist yet.

## What's missing to make Intelligence "serve the agents" (the gap list)

1. **A read-back API** — `GET` findings by subject/window/tags, agent-consumable shape
   (`AnalystFinding[]`-like: area, claim, recommended_action, confidence), not
   dashboard-shaped reports. Sub-second from cache.
2. **Pre-computed/cached findings** — computed on ingest or scheduled, not
   generate-on-request; an agent priming a run cannot wait minutes.
3. **The firewall, server-side** — this is the hard constraint, and it is
   non-negotiable: InsightReport today mixes judge-derived statistics. If agents steer
   on served intelligence that embeds judge verdicts, the keystone discipline
   (selector ≠ judge, judge write-only — learning-flywheel: "the keystone of the entire
   stack") breaks *at the platform level*, silently, for every consumer. The served
   slice must be trace-derived-only, enforced where the report is built, with
   `derived_from_judge` provenance on every served claim.
4. **Uptake telemetry** — served findings should carry IDs so the loop can report back
   "injected, followed, outcome" — closing Intelligence's own improvement loop.

## Stress test

- *"Why not keep it all local — it works?"* Local corpora silo learning per product and
  per machine; the moat claim is *cross*-run, cross-product transfer, which only a
  shared service realizes. Also: ops (curation, decay, dedup) done five times badly vs
  once well.
- *"Why not move observe() to the platform too?"* Latency + context: the in-loop critic
  needs the live trace within the shot cadence, and shipping full traces mid-loop is
  cost + privacy surface. Per-run critic local, cross-run memory hosted — clean split.
- *"Does a hosted dependency break offline/dev?"* The `Corpus` port stays; the hosted
  service is one implementation behind it (`IntelligenceCorpus` beside `FileCorpus`).
  Degrade to local, never fail closed on a network read.
- *"Is there a business here or just plumbing?"* The primed-vs-cold A/B answers both at
  once: if priming lifts outcomes, "intelligence served to agents" has measurable value
  per query — eval-substrate's sellable-exhaust thesis, applied to the corpus itself.

## Decision + sequence

1. Run the corpus A/B locally first (no platform work) — it gates everything: no lift,
   no service.
2. On a positive: define the served-findings contract (the `Corpus` port already exists
   — implement it over Intelligence read-back), with the firewall enforced server-side.
3. The product playbook's Phase 3 (see `product-integration-playbook.md`) then swaps
   each product's local corpus for the served one — one port, no loop changes.
