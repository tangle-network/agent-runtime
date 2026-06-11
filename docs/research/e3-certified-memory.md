> **Track:** Experiments (research) · **Role:** E3 — the memory form-factor experiment
> (the OG flywheel line's next datapoint) · **Status:** SPEC — harness is assembly of
> existing pieces; gated behind the running cost verdict

# E3 — certified-program memory vs prose-fact memory

The across-run question, sharpened by two measured cells: naive prose facts **hurt**
(−11.6pp, worsening slope); relevance-weighted prose facts are **inert** (+4.2pp n.s.,
slope shrinking, holdout +0.0). S3 (leapfrog-program.md) predicts the positive cell is
**verifier-certified, executable memory** — store programs that won their gates, not
sentences about tasks. E3 tests exactly that.

## The arms (same A/B harness as the corpus runs — `eops-corpus-ab.mts` extended)

| arm | what accumulates across the stream | read-side at task t |
|---|---|---|
| cold | nothing | — |
| prose (control, already measured) | `observe()` findings, relevance-weighted | top-k facts → system prompt |
| **certified** | promoted strategy artifacts + their ~64-word reproducer summaries + per-task-class win records | the best-matching CERTIFIED strategy runs the task (program retrieval, not prompt injection) |

Key design distinctions from the prose arms:
- **Admission is gated, not free**: an item enters certified memory ONLY via a
  promotion-gate win (superiority or non-inferiority) — the gate certifies what the
  flywheel may remember. Prose memory admits anything the analyst said.
- **Retrieval is execution, not context**: the certified arm retrieves a *program* and
  runs it; the prose arm injects text and hopes. This is the Voyager/AWM cell.
- **Matching is by task-class** (the EOPS task family / verifier signature), embedding
  similarity as fallback.

## Measurements (the flywheel signature, pre-registered)

1. Paired lift per arm vs cold across the stream (n≥16), seeded bootstrap as ever.
2. **The slope**: first-half vs second-half lift — the thesis REQUIRES growth for the
   certified arm; flat/shrinking = the cell is falsified too.
3. Disjoint holdout with the accumulated memory (read-only) — across-task transfer.
4. Cost/latency per arm (memory reads are billed like everything else).

## Falsifiers

- Certified-arm slope flat or negative at n≥16 ⇒ S3's positive cell fails on this
  domain; the flywheel thesis loses its last designed read-side and needs re-derivation.
- Certified beats prose but not cold ⇒ memory form-factor matters less than memory
  presence; the lift is selection, not accumulation.

## Assembly notes (what exists / what's new)

Exists: the A/B harness (stream + holdout + paired stats), `promotionGate` verdicts,
authored artifacts on disk with gzip-bits + reproducer summaries, task metadata for
matching. New (~a day): the certified store (a jsonl of `{taskClass, file, summary,
verdict}` rows), the retrieval-and-run read side in the A/B runner, and seeding the
store from this week's promoted artifacts (steer+compress configs; any cost-run winner).
