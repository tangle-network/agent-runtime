---
name: generate-eval
description: Author ONE execution-certifiable, search-discriminating eval task for a given target (library@version, repo, or release-notes URL). The runtime certifies — your job is to produce a candidate that survives both gates.
---

# generate-eval — author a certifiable eval task

You are authoring a benchmark task that measures whether web search helps a
coding agent get a **current API detail exactly right**. Your candidate is
admitted only if an independent certifier confirms BOTH gates:

1. **Grounding** — your reference solution executes and passes in a clean
   workspace against the real pinned target (the library is the oracle, not
   your memory).
2. **Discrimination** — a strong model WITHOUT search fails your oracle (a
   task models already know measures nothing).

## Inputs

- `TARGET` — a library + version (`hono@4.6`), a repo, or a release-notes URL.
- `OUT` — the file path where you write exactly one candidate JSON object.

## Procedure

1. **Find the discriminating detail.** Use web search on the target's release
   notes / changelog / current docs. Pick ONE precise, recent-or-niche detail:
   an exact method name, option key, config field, or flag — ideally one where
   the *plausible wrong guess* is specific (e.g. models guess `maxRetries`
   where the real key is `limit`). Record the primary-doc URL.
2. **Author the task** as JSON with `schemaVersion: 1` and fields:
   - `id` (kebab-case), `domain`, `prompt` — ask for the exact identifiers and
     a minimal runnable usage; the answer must be gradable from its TEXT.
   - `needsFreshDocs` — the specific fact + the wrong guess models make.
   - `oracle` — `containsAll`: distinctive exact identifiers a correct answer
     must contain (specific enough that a wrong answer can't contain them by
     accident); `notContains`: the plausible wrong/deprecated forms; optional
     `regex` for structure. No generic words.
   - `searchQuery`, `expectedUrlIncludes`, `sourceUrl` — retrieval provenance.
   - `setup` — commands that provision a CLEAN workspace and PIN the target
     (`npm init -y`, `npm i hono@4.6.3` / `pip install pkg==x.y`). The
     certifier replays these from scratch.
   - `reference` — `files` (minimal code exercising the detail against the
     real installed target) + `cmd` (exits 0 only when the API is used
     correctly) + `stdoutContains` (print a value derived from the real API
     call, so an empty no-op can't pass).
3. **Self-check before emitting** (you have a shell — use it):
   - Run `setup` + `reference.cmd` yourself; fix until they pass.
   - Write the correct answer to your own prompt; confirm every
     `containsAll` string appears in it and none of `notContains` does.
   - Write the *plausible wrong* answer; confirm the oracle FAILS it.
4. **Emit** exactly one JSON object to `OUT`. No prose around it.

## Hard rules

- **Never mock or stub the target.** The reference must import and exercise
  the real installed library. A mocked reference is a void candidate.
- Expect repair feedback: the certifier returns gate diagnostics (compile
  errors, oracle misses). Iterating is normal — fix and re-emit.
- One candidate per invocation. Quality over quantity: a rejected candidate
  costs a full certification cycle.
