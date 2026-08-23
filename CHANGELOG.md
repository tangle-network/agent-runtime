# Changelog

## 0.174.0

### `keepGoing` and `score`: spend the whole shot budget, ship the best tree

`agenticGenerator`'s `Verifier` answered one boolean, and `ok` carried two meanings at once — "this tree is shippable" and "stop now". The shot loop returned inside `if (result.ok)` and `AgenticGeneratorOptions` exposed no field to override it, so ordinary best-of-n could not be expressed: a caller who wanted to spend the shots it was given and keep the best tree had no way to say so.

A consumer building best-of-n hit exactly that and encoded it by hand (agent-lab's playproof study, `projects/playproof/verify-budget.ts`): reject every shot but the last whatever it measured, score each tree as it is produced, and physically write the best program back into the worktree just before the last shot is accepted — because with only one boolean, "ship the best tree" has to mean "make the best tree BE the worktree". Their measured runs are why it matters. Under first-acceptance-wins, 1 shot of 3 fired and the program that shipped was never once run by its author. Under the workaround, 3 of 3 fired and every shot ran its own program.

`VerifyResult` gains two optional fields, so three separate questions get three separate answers:

| field | question | omitted |
|---|---|---|
| `ok` | is this tree shippable | unchanged |
| `keepGoing` | should the budget stop here | the first passing tree ends the candidate, exactly as before |
| `score` | how does this tree rank against the other passing trees | every passing tree ties, so the later one wins |

- **The loop owns the restore, and that is the point.** A passing tree whose verifier asks for another shot is snapshotted as a Git tree object (staged into a private index, so the index the driver commits from is untouched). When the budget ends, the highest-scoring tree is put back into the worktree — content, added files, and the removal of files only a losing shot wrote — and the restore is proved by re-snapshotting and comparing tree ids before the candidate is returned. The caller ranks; the runtime moves the bytes. Without this half, every caller wanting best-of-n still hand-rolls the write-back, which is the thing being fixed.
- **Compatibility is an explicit gate, not a claim.** `tests/agentic-generator.test.ts` drives the real `agenticGenerator` with a verifier returning today's shape and asserts today's behaviour: 1 of 3 shots fires, the disposition stream is exactly `['accepted']` with `restoredFromShot: null`, and the accepted shot's own tree is what lands. A second gate holds the failure path — a verifier that never passes still feeds `verification FAILED` into the next shot and still ships nothing.
- **A last shot that breaks or reverts the change no longer costs the candidate.** A banked tree passed verification, so it ships even when the final shot ends on a broken or empty tree. The failing shot's own `rejected` disposition is still emitted first, so its evidence survives. The invariant is intact: a tree that failed verification is never what ships.
- **A tie keeps the LATER tree.** It is already on disk, so no restore is needed, and it is the author's own refinement of the tree it tied with.
- **A set of trees that cannot be ordered fails the run.** Scoring one passing tree and not another throws rather than guessing an order, and a non-finite score throws. A tree that FAILED verification is never ranked, whatever it scored.
- **`onShotDisposition` gains `kept`**, the shot that passed and was sent back: it carries the `score`, whether the tree `best`s the candidate so far, and the verifier's `feedback`. `accepted` gains `restoredFromShot` — non-null is the record that best-of-n moved bytes rather than only ranking them.
- **The next-shot note is new text for a new state.** A passing tree sent back is told `verification PASSED`, that shots remain, and that the best version it produces is the one that ships — not the `verification FAILED` note, which would be a lie.
- **`cli-worktree`, `cli-in-place` and `commandVerifier` are unchanged.** This is the verify/shot-loop contract only; `commandVerifier` still answers `{ok:true}` / `{ok:false, feedback}` and still stops at the first passing tree.

## 0.173.0

### `cli-in-place`: a local coding CLI on the worktree you hand it

`agenticGenerator` asks for one thing from `executorForWorktree(worktreePath)`: compute that edits **that** directory. The whole multi-shot loop rests on it — a shot that dirties the tree but fails `verify` feeds the failure into the next shot, and the next shot resumes on top of its own broken edits because the worktree persisted. Until now no published placement did that for a local coding CLI, which a consumer measured backend by backend:

| backend | measured behaviour |
|---|---|
| `cli` | refused at admission — "streamAgentTurn: exact executor did not materialize a known model identity" |
| `cli-worktree` | cuts a worktree of its **own** under the path it is handed; the author's edits never reach the supplied directory, so every shot reads as an empty tree |
| `bridge` | the documented in-place placement, but it needs a running cli-bridge |
| `provider` | the open extension point, and it does declare a model — but `harnessInvocation` and `runLocalHarness` are exported from no entry point, so the mapping cannot be built outside this package |

`createExecutor({ backend: 'cli-in-place', workspacePath })` closes it. It runs claude-code / codex / opencode / pi in the directory it is given: the edits **are** that directory, and they are still there for the next spawn. `createInPlaceCliExecutor` is the same leaf as a direct `Executor`.

- **`cli-worktree` is unchanged.** Cutting its own worktree is correct for a fanout of candidate authors that must not clobber each other, and for a caller whose deliverable is the patch. This is a second placement beside it, not a change to it. The two share one physical act — the same profile materializer, the same `harnessInvocation` mapper, the same spawn — so neither re-derives argv.
- **The workspace holds the author's edits and nothing else.** Because the directory persists, so would the profile inputs materialized into it, and an untracked settings file would read as an author edit. They are removed before the call returns, whether the run succeeded, threw, or was cancelled. `existingFiles: 'reject'` is what makes that removal safe: a plan file whose path is already occupied refuses the run before the harness starts, so nothing removed can be a file the caller put there. A directory the harness put its own work in is kept.
- **The admission check is untouched.** A raw `cli` placement is still refused for declaring no model identity. This leaf declares its concrete profile model, so it satisfies the same check and the shot receipt names the harness, provider and model that ran. Its `Spend` marks `tokensKnown: false`, because a harness CLI reports no usage receipt and `{0,0}` is a floor, not a measurement.
- **`agenticGenerator` checks the binding before it spends.** A `cli-in-place` placement whose `workspacePath` is not the candidate worktree is refused, the way a `bridge` placement with the wrong `cwd` already was. Both comparisons now resolve the two paths first, so a macOS `/var` → `/private/var` symlink is not a false mismatch.
- **No reproducible-Codex mode here.** That mode stages an executable and a write probe into its working directory, which a caller-owned workspace is not the place for; use `cli-worktree` with `codexReproducible` for the isolated, metered Codex run.

## 0.172.0

### The run's deadline is a wall-clock instant, taken from one expression

A graph run that declared any `budget.deadlineMs` lost every child at spawn (#995). The journal showed the whole life of a worker in five milliseconds: `spawned`, `materialized status unknown`, `settled status down reason "child deadline exceeded" spent.ms 0`. The run ended `no-winner/all-children-down` about three seconds after launch. A resumed run was correct, and a run with no deadline was correct, which is why the suites stayed green.

Two clock domains met inside one number. `createBudgetPool` derived its absolute deadline as `restore.absoluteDeadlineMs ?? now() + root.deadlineMs`: an instant when the caller supplied one, whatever `now()` returned plus a duration when the caller did not. `openGraphRun` passed a RUN-RELATIVE clock (`args.now() - runEpochMs`, which starts at ~0) and supplied `absoluteDeadlineMs` only on the resume path. So a fresh pool read `10800000` where the scope reads an epoch instant — `1970-01-01T03:00:00Z`, long past — and `armDeadlineTimer` fired at delay `0` for every child. Dropping the CHILD deadline changed nothing, because `boundedChildDeadlineAt` returns the parent bound when the child bound is absent and `Math.min(parent, child)` when both are present: the mis-scaled parent won either way.

`createBudgetPool(root, runStartedAtMs, restore?)` now takes the run's start INSTANT in place of a clock, and derives `runStartedAtMs + root.deadlineMs` (or `0` for a root that declares no deadline). One expression serves the fresh path and the resume path, so the two cannot disagree. `BudgetPoolRestore.absoluteDeadlineMs` is deleted: a resumed pool passes the ORIGINAL root instant, which is what "restart never slides the deadline" always meant, and the pool now holds no clock at all — a caller cannot hand it a run-relative one and read a duration back where an instant is expected. A non-finite or negative instant is refused at construction.

**Breaking for a direct `createBudgetPool` caller**: pass an instant (`Date.now()`) where a clock (`Date.now`) was passed, and drop `restore.absoluteDeadlineMs`.

## 0.171.0

### Code mode over the coordination verbs — the pattern, and an honest boundary

Replaces the router-only CodeAct node from 0.169/0.170 with code mode as Cloudflare ("Code Mode") and Anthropic ("code execution with MCP") define it: generate a typed API from the tools' schemas, expose exactly two tools (`search`, `execute`), and let the model write one program instead of paying a round trip per call.

`codeModeSupervisorTools(runner, options?)` (new, `/kernel`) returns a `ResolveSupervisorTools` that puts a supervisor in code mode:

- **`search`** answers TypeScript declarations GENERATED from the live grant — `context.coordinationTools()` (new on `SupervisorToolInvocationContext`) exposes the static face of the same descriptor objects the verbs are served from, so the API cannot drift from what is mounted. Progressive disclosure: seven verb schemas leave the model's context; an optional `query` filters.
- **`execute`** lints the program and runs it through the `runner`. Every `api.<verb>(args)` call dispatches through `context.verbs` — the IDENTICAL kernel path an MCP verb crosses (authorization, the conserved pool, the journal; "there is no second spawn path"). Results are detached (JSON round-trip, the same copy the MCP transport makes) before they re-enter the program, so in-code calls cannot mutate live coordination state. A test proves the kernel path off the journal: ONE `execute` call spawns two workers, and two `spawned` + two `settled` child records appear in the run's tree. This is the coordination surface as a **dynamic workflow system** — the model authors the workflow as code at runtime and the kernel meters and records every edge.
- **The lifecycle verbs are not in the API, and `search` says why**: `submit_result`, `stop`, `ask_parent` stay model tools — a program that could settle the run would be a second brain.

**The execution boundary is a required, deliberate choice — not a fake default.** The sources isolate execution in a real boundary (Cloudflare a V8 isolate, Anthropic out of process); this is what makes "let the model write code" safe. This runtime ships no isolate, so `codeModeSupervisorTools` REQUIRES a `CodeModeRunner` — there is no silent default. `unsafeInProcessRunner()` is provided for TRUSTED output only (an eval harness, an offline test, a model you control) and is named for what it is: `node:vm` shares the host realm, so `api.<binding>.constructor` reaches the host `Function` — it is not a security boundary, and a test asserts that escape rather than hiding it. A whole-program deadline gates further `api` calls after it fires, but in-process code cannot be interrupted (a pure-microtask loop starves any timer), which is the same reason the sources isolate. For untrusted models, supply a jailed runner. An earlier draft shipped `vmCodeRunner` as the silent default and claimed the sandbox's only capability was the bindings; an adversarial audit proved that false, so the default was removed and the claim corrected.

`examples/code-mode/` runs the whole thing offline ($0) with `unsafeInProcessRunner()`: 3 model turns where the tool-calling shape pays 6+, journal excerpt printed as proof.

**Deleted:** `codemodeKind`, `CodeOperation`, `CodeAuthor`, `CodeRunner` (graph), `inlineCodeRunner`, `renderCodeApi`, the `RunGraphNodeOut` family, and `extractCodeBlock` (dead after the node's deletion), with their test and example. `assertAuthoredCode` stays exported from `./graph` (sourced from `runtime/authored-code`); its module doc no longer names the removed node. The graph engine's `supervisorKind` does not accept `resolveSupervisorTools` yet — `runGraph` forwards it to the root supervisor as a top-level option, but a node-kind config that throws would be worse than an honest gap.

## 0.170.0

### Code mode, mapped to what the ecosystem means by it

An audit of 0.169.0 against the term's mainstream usage (Cloudflare's Code Mode, Anthropic's "code execution with MCP", the CodeAct paper) found the release conflating two different things, and the repo missing the one that matters most here.

**The mainstream meaning is a tools-presentation change for an agent that already executes code**: project the granted tools as a typed code API, let the agent write programs against it, keep intermediates out of the context window. For a harness agent that capability is native — the integration is KNOWLEDGE, and per this repo's own doctrine ("you change an agent's behavior by changing its PROFILE") it ships as a skill. **`skills/codemode/SKILL.md` is new**: batch judgment-free tool stretches into one program, hold intermediates in files, return only the summary, and never script against the coordination verbs (that bypasses the pool and the journal). It is the sixth skill, beside `supervise`, `agent-graphs` and `loop-writer`.

**`codemodeKind` is the OTHER arm — CodeAct — and now says so.** Its `model` effect is a one-shot `complete()`, so it is router-only by construction; 0.169.0 never stated that, and its header implied it was "code mode for agent-runtime" generally. The rewritten header names the lineage, names the one genuinely novel property (per-operation spend metering into the kernel settlement — every pre-existing tool-execute seam returns a bare string), and points harness agents at the skill.

**The duplicate lint is gone.** 0.169.0's `assertAuthoredCode` bragged it "generalized" `assertStrategyContract` while leaving the original in place — two identical banned-construct tables that could drift. `src/runtime/authored-code.ts` is now the single copy; `assertStrategyContract` delegates to it (same refusal messages; marginally looser on purpose: any import FORM of the kernel module passes, since the lint gates which module, not the syntax) and `./graph` re-exports are unchanged.

Also filed from the same audit: #1000 — the new engine's analyzes edges deliver only the literal `trace of <node>: <hash>` string, so no engine node can read trace content today, where the old coordination layer rehydrates a full `TraceAnalysisStore` for lens analysts and inlines span JSON for agent analysts.

## 0.169.0

### `codemode`: a node whose action space is code, not tool calls

An `agent` node acts one JSON tool call per turn, so N steps cost N model round trips and every tool's schema sits in context. A `codemode` node asks the model once for a program written against the operations that node grants, then runs it: loops and branches happen inside the program and only the answer returns. `examples/engine/codemode.ts` runs one job both ways over the same operations table — **1 model turn against 8**, same 7 operation calls, same answer.

The runtime already did this once, hard-wired: `strategy-author.ts` has an LLM write an optimization strategy against a fixed contract, lints it, imports it, and runs it — safe because the authored body composes `shot()`/`critique()` and therefore spends through the Supervisor's pool. `codemodeKind()` generalizes that, and the three properties it keeps are exactly the ones a prompt-and-skill version cannot have:

- **The API is projected from the grant.** `renderCodeApi` generates what the model is shown from the same `operations` table the runner binds, so a documented-but-ungranted call cannot exist and a granted-but-undocumented one cannot hide.
- **The host owns the execution boundary.** The kind declares a `codeRunner` effect and executes nothing itself; the engine refuses before spending when the host supplied none. `inlineCodeRunner()` is offered for development and documented as what it is — `assertAuthoredCode` is a LINT, not a sandbox, and in-process code reaches whatever the process reaches.
- **Accounting passes through the kernel.** The node is an ordinary `Executor` under `Scope.spawn`; each operation reports its spend and the node totals it into the settlement. A test asserts this off the journal, not the return value: 100 input tokens from the one model call plus 1 from each of three metered operation calls arrive as `103` in the kernel's `settled` record.

`assertAuthoredCode(code, { allowedImports })` is the strategy-author contract check, generalized and exported: same banned constructs (`require`, dynamic `import`, `eval`, `new Function`, `process`, `globalThis`, `fetch`, node builtins), with the allowed-import list now a parameter instead of one hardcoded specifier.

## 0.168.0

### The first example authored against the ENGINE, and the wart it found

`examples/engine/review-loop.ts` is a PR review as an engine graph: a `build` node, three auditors fanned out on `data` edges, a `verdict` node joined `all` over them, and a guarded rebuild edge back to `build` capped at three traversals. Round 1 ships a hardcoded secret and security rejects it; round 2 leaves a bare `any` and style rejects it; round 3 is clean and ships. Every node is a `script` kind, so it runs offline, deterministically, with no credentials: `pnpm tsx examples/engine/review-loop.ts`.

It exists because until now nothing outside the engine's own tests authored an engine graph, and "it works" was a claim with no user. It exercises fan-out, `join: 'all'`, guards on both arms of the same output, a bounded cycle, one pure edge projection, and the terminal finalizer — in one run. `tests/examples/engine-review-loop.test.ts` pins all of it, including the arm a successful run cannot show: a build that never satisfies its reviewers is ended by the edge cap with `GraphEdgeCapError`, not left to spin.

**A second wart, same source:** `createGraphEngine({ coreKinds: [...] })` would not accept an array of differently-configured kinds. `NodeKind<Config>` puts `Config` in a parameter position, so it is contravariant and a heterogeneous set is not assignable to `ReadonlyArray<NodeKind<unknown>>` — every consumer composing a kind set needed a cast, which the example needed on its first line. `AnyNodeKind` now carries that cost once, inside the engine, where a registry is heterogeneous by definition and each kind validates its own config through `validateConfig` anyway.

**What writing it found first:** `GraphRunResult.settles` was grouped by node, not chronological, because `materializeSettles` flat-mapped over the node map. Any consumer reading a run in order — which is the obvious thing to do — got a wrong answer, and the example's join-ordering assertion caught it on first run. `GraphNodeSettle` now carries a run-wide `seq` assigned by the fold (so replay reproduces the same order) and `settles` is sorted by it. That is a behaviour change for anyone who depended on the grouping, which is why it is a minor.

## 0.167.0

### Correction: `runGraph` did NOT run on the engine, and now it honestly doesn't

0.166.0's entry said "`runGraph` runs on the engine". An audit says that was false in the way that matters. The preset scheduled exactly **one** node whose executor called `superviseAgentGraph` — the entire pre-engine implementation — while every worker node was marked `entry: false` and never scheduled. Execution was 100% the old path. What the wrapper did add was real: a second journal tree (`<runId>:engine`), a second budget pool over the same budget, a second `Scope`, and a capture cell to smuggle a typed error back out through the JSON admission boundary. A layer that moves no behaviour is a second source of truth, so it is deleted.

**`runGraph` calls `superviseAgentGraph` directly again**, as it did before 0.166.0. Its signature, options, result, refusal timing and journal tree are unchanged — the 58-case `tests/kernel/graph.test.ts` still passes unchanged, now for the honest reason that the code path is the one those tests were written against. `graphFromRunGraph(graph, options)` remains, and is what #975 actually asked for: a **pure compiler** that lowers an `AgentGraph` into an engine graph so a consumer can inspect it, diff it, and author natively from there. `tests/graph/preset-run-graph.test.ts` pins what it emits and proves `compileGraph` accepts the result. `preset-run-graph.ts` goes 267 → 82 lines; `RunGraphBody`, `RunGraphCapture`, `RunGraphNodeConfig`, `RunGraphNodeOut`, `runGraphKind`, `runGraphEngine` and `runGraphThroughEngine` are gone with the wrapper.

### `subgraph` runs: the engine nests

0.162.0 shipped `subgraph` as one of "the four core kinds" while its `run` threw `cannot run yet — the scheduler … lands in agent-runtime#980`. #980 shipped in 0.163.0 and the message was never updated, so the engine has been claiming four kinds and executing three.

A subgraph node now runs its inner graph as a full engine run on the SAME kinds and effects, with its own scope, pool and journal tree under a derived run id, and hands the inner result up as its output. `NodeKind.run` gains an optional `host: GraphHost` that the scheduler supplies — the contract a nesting kind needs, declared in `kind.ts` so the contract module stays dependency-free. A subgraph constructed outside a scheduler refuses by name instead of pretending.

### The model-fired edge, finally tested

`delegates` was declared MODEL-fired in 0.166.0 with no test exercising it through the scheduler; only `data` edges were covered. `tests/graph/scheduler.test.ts` now proves it: a delegation target is not an entry, is not a terminal, never runs on its own, and produces no ledger row, because only its supervisor may spawn it.

## 0.166.1

### The `agent-eval` peer range admits 0.170.0

`peerDependencies["@tangle-network/agent-eval"]` was `>=0.163.2 <0.164.0`, a range only one published version satisfies. agent-eval published 0.170.0, so a consumer that asked for the latest of both packages got an unsatisfiable set, and a consumer that resolved it stayed on 0.163.2. The range is now `>=0.163.2 <0.171.0`, and the workspace catalog resolves to 0.170.0 so CI builds and tests against it.

The ceiling was stale, not protective. agent-eval 0.170.0 removes six exports against 0.163.2, all from `@tangle-network/agent-eval/analyst`: `createJudgeAdapter`, `createRunCriticAdapter`, `createVerifierAdapter`, and their option types `JudgeAdapterOpts`, `RunCriticAdapterOpts` and `VerifierAdapterOpts`. This runtime imports none of them. Of the 241 distinct symbols it imports across 11 agent-eval entry points, 0.170.0 supplies all 241.

**What a consumer must do differently:** nothing. A consumer that pinned agent-eval to 0.163.2 to satisfy this peer can move to 0.170.0. One caveat outside this package: `@tangle-network/agent-knowledge@10.7.0`, a direct dependency here, still declares `>=0.163.2 <0.164.0`, so installing agent-eval 0.170.0 reports an unmet peer for agent-knowledge until that package publishes a widened range. The unmet peer is a warning, not an install failure, and no agent-knowledge code path here reads a removed symbol.

## 0.166.0

### `runGraph` runs on the engine (`@tangle-network/agent-runtime/graph`)

Engine build 4/4 (#982), and the migration decided in #975. **A `runGraph` caller changes nothing**: same signature, same `RunGraphOptions`, same `GraphResult`, same refusal timing, same journal tree under the same `runId`. `tests/kernel/graph.test.ts` — the 58-case compatibility bar — passes unchanged, as do the topology examples.

What changed underneath: `graphFromRunGraph(graph, options, run)` compiles an `AgentGraph` into an engine graph — one supervisor root carrying the graph, one pinned `agent` node per worker, the authored `delegates`/`analyzes` edges — and `runGraph` runs that. A `runGraph` graph is therefore a first-class engine graph now: compiled, type-checked, inspectable, and composable with `data` edges and `script` nodes. The root node's body is `superviseAgentGraph`, the same function `runGraph` always called, so every property #967 measured as load-bearing — the edge ledger, `maxTraversals` + `GraphEdgeCapError`, `continuity`, directives as registry data, node pinning — is preserved by construction rather than re-implemented.

Four contracts sharpened by making the preset work, each useful on its own:

- **`delegates` is the MODEL-fired edge kind** (#971). Its target is spawned by the source supervisor through the coordination protocol, with the pin and the directive applied inside the kernel's authorized path — the scheduler judges nothing and releases nothing for it. `data` and `analyzes` are engine-fired. `isEngineFired(edge)` names the distinction; a node reached only by delegation is never entered by the scheduler and is never one of its terminals.
- **`EngineGraphNode.entry`** forces a node out of (or into) the run's entry set, and **the declared `spec.root` is always an entry** — an edge feeding back into the root (a findings route to the driver, a cycle's closing edge) no longer means the graph cannot start.
- **`maxTraversals: 0` is legal**: an edge closed from the start, refused on its first consumption and ledgered `unpropagated`. The engine previously demanded a positive integer while `runGraph` accepted zero.
- **`assertRunGraphAuthoring`** is the authoring contract as one exported function, so a malformed graph still throws SYNCHRONOUSLY from `runGraph` even though execution now sits behind the engine's promise.

### The scheduler is six modules, not one file

`src/runtime/graph/scheduler.ts` was 1,180 lines and is now 791, with the parts that other code needs lifted out and reusable: `admit.ts` (edge payload admission), `ledger.ts` (the edge ledger), `join.ts` (the pure join rule), `suspension.ts` (the suspension vocabulary and token minting), `run-context.ts` (the journal/pool/scope bootstrap and the restart recipe), and `result.ts` (settle rehydration, the finalizer reduce, and no-winner classification). No behaviour changed; the preset consumes several of them directly.

### `claude-code` gets the model flag its CLI actually accepts

`HARNESS_INVOCATIONS['claude-code'].modelArgs` emitted `-m <model>`.
Claude Code removed that short form.
Measured on 2.1.239:

```
$ claude -p "hi" -m sonnet ; echo "exit=$?"
error: unknown option '-m'
exit=1
$ claude --help | grep -- --model
  --model <model>                       Model for the current session. Provide
```

Every delegation that carried an authored model therefore exited 1 before it read the prompt, and the run surfaced as an empty patch rather than as a bad flag.
A profile with no model was unaffected, which is why the suite stayed green: the flag is only emitted when `profile.model.default` is set.

The row now emits `--model`, the spelling the `pi` row already used.
The long form is the safe value across the table: `codex` 0.142.5 (`-m, --model <MODEL>`) and `opencode` 1.18.21 (`-m, --model`) accept both, while `claude-code` and `pi` accept only `--model`.
`codex` and `opencode` keep `-m`, which is measured working, so only the broken value changed.
The two remaining `-m` literals in `local-harness.ts` sit inside Codex-only functions and stay correct.

**What a consumer must do differently:** nothing, unless you asserted the exact argv of a `claude-code` invocation that carries a model, or passed a hand-built `invocation.args` using `-m` to `runLocalHarness` with `harness: 'claude-code'`.
Both must now spell it `--model`.

### A multi-turn bridge session survives its own token counters (`bridgeExecutor`)

cli-bridge's pi backend writes per-turn traffic and token counters into the profile-materialization receipt under `inference.observation` (`requests`, `generationRequests`, `usageReceipts`, and the `usage` token totals).
The bridge executor compared whole receipts across session turns with `JSON.stringify`, so two honest receipts from one session were never byte-equal: **every multi-turn pi worker died at the end of turn 2** with `bridgeExecutor: profile materialization changed across session turns`.
Measured on the live pair from worker `mitten` s0 (2026-08-22), the two receipts differ ONLY in that block — `requests` 34 vs 9, `usage.inputTokens` 1,313,406 vs 553,971 — while every identity field is equal.

The cross-turn comparison now removes `inference.observation`, and only that block, from both sides.
Everything that states identity is still compared: `schema`, `effectiveProfileDigest`, `harness`, `provider`, `model`, `reasoningEffort`, `workspacePlanDigest`, `files`, `unsupported`, and the stable inference identity (`effectiveEndpoint`, `apiMode`, `transport`, `appliedMaxTokens`).
A bridge that moves its model transport mid-session is refused exactly as before.
The within-run replay comparison is unchanged: a replayed event carries the recorded receipt, so it stays byte-compared.

## 0.165.0

### Kill it anywhere: journal fold, replay, suspensions (`@tangle-network/agent-runtime/graph`)

Engine build 3/4 (#981). The scheduler's state is now a pure function of the journal — fold, never checkpoint (#974). Every scheduling decision is journaled BEFORE its effect is visible (blob-then-journal where a ref is minted), then applied to live state through the SAME reducer (`applyGraphFoldEvent`) a restart replays the journal through. The bar, held by `tests/graph/replay.test.ts`: kill a file-journaled run at EVERY journal boundary — kernel events included — restart with the same journal, and zero settled nodes re-execute while an all-pure graph reproduces its result byte-identically.

- **Three fold events** join the journal union: `node-inputs-resolved` (the exact envelope one instance was given, pinned by `inputRef` before it spawns — `onCrash: 'restart'` re-runs from this, never through a transform someone has since changed), `edge-verdict` (what the scheduler DECIDED about one edge; `edge` stays delivery observability with its own ledger), and `join-state` (one release: which edges produced it, which in-flight edges the wave consumed-once). The planned `guard-decision` event is NOT needed: every guard is pure over journaled inputs, so the fold re-evaluates nothing and trusts only journaled verdicts. Kernel replay skips all three, exactly as it skips `edge`.
- **Idempotent recovery.** Each edge folds `judgedSourceSettles` — bumped by a verdict or an absorption — so a kill between a settle and its verdicts re-judges only the unaccounted edges, and an absorbed completion is never re-fired. A kill between a suspension's kernel settle and its `waiting` event is finished on recovery, never propagated as data.
- **Suspensions (#976).** A kind's executor returns `suspended({ onExpire, expiresInMs, default })` to park its node as a `waiting`/`woken` pair — the kernel's existing durable wait, extended with a `token` `WaitSpec` arm and `woken.by: 'expired'`. Tokens are engine-minted and content-addressed (recomputable from the journal; no token table). `createGraphRun` returns a handle: `resume(token, payload)` lands as `woken{by:'fired'}` blob-then-journal; `expire(token)` follows the suspension's `onExpire`. Offline, a fully-parked run returns `{ kind: 'suspended', tokens }` — a resumable artifact, not a hang — an `onExpire: 'default'` suspension auto-resolves, and a restart after the deadline transitions `fail`/`default` by the engine's own clock.
- **Restart is the kernel's own resume.** The engine journals a root anchor exactly like the supervisor, rebuilds the pool with committed spend and uncertain in-doubt reservations (`sumMeasuredSpendFromEvents`/`uncertainSpawnBudgets`, now exported), and hands `createScope` the same `resumeFrom` maxima the kernel supervisor uses, so a fresh spawn never reuses a journaled `seq`. Engine `woken` ordinals live in a reserved high band above the kernel's cursor counter.
## 0.164.0

### `pi` is a local harness, `opencode` gets its permission bypass, and reproducible Codex runs on darwin

Three capabilities the types advertised and the code refused.

`pi` was already a `HarnessType` with a system-prompt projection row, but it was excluded from `LocalHarness` and had no `HARNESS_INVOCATIONS` entry, so `AgentProfile.harness: 'pi'` failed at the executor. It is now one row like any other harness: `--print` for non-interactive, `--model` (not `-m`) for selection, `--thinking` for effort, and `--approve` as its permission bypass.

`opencode` declared no `permissionBypassArgs`, on the stated premise that `opencode run` has no approval gate. It does — `--auto`. Without it an unattended worktree run denies writes outside the working directory and reports "The user rejected permission", which reads as an agent that gave up rather than one that was never granted rights. Measured: three worktree runs of a policy-authoring loop produced three empty patches for exactly this reason.

`codexReproducible` refused every non-Linux host, though `@openai/codex` vendors darwin-arm64 and darwin-x64 builds. The vendor check also only understood static ELF, so a Mach-O binary could not have passed even with the gate removed. Target resolution is now a per-host table and the check reads the format the host vendors. On macOS the local-harness suite goes 33/48 to 48/48. Linux behaviour is unchanged: same triples, same static-ELF requirement, same argv.

**What a consumer must do differently:** nothing, unless you were relying on `opencode` running without `--auto` under `dangerouslySkipPermissions`, or on `codexReproducible` throwing on darwin. Both now do the thing they claimed to do.

## 0.163.0

### The graph runs: a scheduler over guarded, typed edges (`@tangle-network/agent-runtime/graph`)

Engine build 2/4 (#980). Build 1 gave a graph its vocabulary; this release makes a graph RUN. `compileGraph` lowers an authored `EngineGraphSpec` against an engine's kind registry, and `runEngineGraph` schedules it by hosting every node instance on one kernel `Scope` — the pool, the journal, the blob store and cancellation stay the kernel's; the scheduler owns only what a graph adds.

- **One predicate tree, one projection.** Every guard — on any edge kind — is the same bounded `all`/`any`/`not` tree over `{ path, op, value }` leaves (ten operators, no regex, 40-node/6-deep caps), adopted from ADC so a comparison can never mean two things on two surfaces. A `data` edge may carry exactly ONE pure projection (`path`/`pick`/`map`/`filter`/`first`/`last`/`count`); anything richer is a script NODE, journaled and typed.
- **Three edge kinds over typed ports.** `delegates` (directive appended to the target's task), `analyzes` (the source's `trace` into an oracle), `data` (port→port, engine-resolved, structurally type-checked at compile). Node-level `ports` merge over the kind's, so a script node declares its own surface. The compiler refuses before any spend: an unknown kind, a missing port, a schema that cannot fit, a `delegates`/`data` edge into an `oracle` node, a graph none of whose terminals carries a completion check.
- **ADC's join semantics, adopted whole.** `all | any | any_failed | all_done` decide release; an edge settles satisfied/dead/failed per its source's LATEST completion; a release consumes the wave (settled edges re-arm; an edge with an in-flight completion is consumed-once, so an OR-diamond's second completer never double-fires).
- **Two cycle bounds with distinct meaning (#973).** Per-edge `maxTraversals` refuses the consumption, ledgers `unpropagated`, and a run it leaves winnerless throws `GraphEdgeCapError`; per-node `maxVisits` (default 25, cap 100) fails the run `cycle-budget-exceeded`. The pool stays the real bound: a spawn that cannot reserve parks and retries after the next settle, never overcommits.
- **Terminals, honestly.** The result carries EVERY terminal settlement; the kernel's finalizer seam (`bestDelivered` default, `collectDelivered`, or custom) reduces them to `out`. A guarded route that can never fire marks its downstream `unreachable`, and a run whose terminal is among them ends `no-winner/unreachable-terminal` — the honest reason, not a stall.

The journal's `edge` event gains an additive `data` arm (`directive` optional, `port` recorded); replay skips edge events as before.

## 0.162.0

### A graph engine core: node kinds, registries, host effects (`@tangle-network/agent-runtime/graph`)

`runGraph` is a prompt brief over one supervisor, not a graph: the model decides whether an edge is taken, every node is an agent, and nothing in it can be a script, a judge over traces, or a nested graph (#966). This release lands the first quarter of the runtime-native engine that replaces that framing — the vocabulary a graph is built from, as data the kernel can host and a consumer can extend by registering, never by forking (#979):

- **`NodeKind`** — a declarative record: `id`/`version`, `validateConfig` (by name, no zod), typed `inputs`/`outputs` ports, declared `effects`, `onCrash` (`restart` | `resume`), `budget` (`metered` | `exempt`), and `run({ config, profile, inputs, effects })` returning the `Agent` the kernel's `Scope` spawns. `validateNodeKind` refuses implicit `out`/`trace` output ports, duplicate ports and unknown policies, naming the kind; `narrowEffects` hands a kind exactly the effects it declared, frozen, and refuses before the node runs when the host lacks one, listing what the host has.
- **`Registry<T>`** — enumerable, per-instance, refuses an unknown handle by listing what is registered; handles print as `<id>/v<n>`. Node kinds and host effects both live in one, so a host's `integration.invoke` sits beside the core kinds with no tier.
- **Four core kinds** — `agent` (wraps `workerFromBackend`), `supervisor` (wraps `supervisorAgent`), `script` (caller code over resolved inputs; `pure` scripts are budget-exempt and content-addressed; a metered script that reports no spend settles UNKNOWN, never free) and `subgraph` (validates and registers; running it waits for the scheduler, #980). `createGraphEngine({ coreKinds, kinds, effects })` seeds one registry with them and reports `missingEffects()` so a host learns what it owes before the first node runs. The engine source names no host-only kind — a test greps for it.

One kernel intake change makes a code leaf honest. `scope.spawn` required every `AgentSpec.profile` to select a harness and a concrete model, including a spec carrying a verbatim `executor` — which receives only the task and a signal, so nothing could fill it from ambient config anyway. A graph script runs no model; forcing it to claim one would have put a lie in the journal's identity. **A verbatim `executor` now needs a parsed profile, not an executable one**; the profile still digests into the node identity, and the script kind adds `execution.correlation.nodeKind` (`script/v1`) so two kinds sharing a node name never share an identity. Factories, harnesses and the router keep the full requirement, and the executor registry follows the same line.

A second kernel fix surfaced by the engine's budget contract: an executor whose terminal artifact carried no `Spend` crashed the child with a raw `TypeError` and **leaked its reservation** — the reconcile ran on the undefined spend and failed, so the tokens stayed reserved for the life of the run. `scope.spawn` now refuses such an artifact by name (`executor settled without a Spend`) before it can replace the live spend; the child goes down, its reservation reconciles on what was proven (the stream total, else zero), and the pool is sealed unknown exactly as on any crash. A metered node kind that forgets to report is therefore an engine error, never a free node.

## 0.161.0

### A graph node can be a supervisor

`runGraph` pinned node profiles inside `makeWorkerAgent`, and `supervise()` consults that seam **only after** it has decided whether a child is a leaf or a nested supervisor — from the profile the DRIVER wrote, which under a graph is always `{ name: '<node id>' }` with no metadata. So every node ran as a leaf no matter what its canonical profile declared, silently; a node declared `role: 'driver'` was never a supervisor (#965). Worse, supplying `makeWorkerAgent` skipped the kernel's entire authorized recursive path: no `profileSecurity`, no `authorizeSpawn`, no `isDriverProfile`, no nesting.

Pinning now lives in `authorizeSpawn`, which runs BEFORE that decision and substitutes the canonical node profile. The kernel then classifies the pinned profile: a `role: 'driver'` node becomes a real nested supervisor carrying its own prompt and model; a caller's `authorizeSpawn` sees the canonical profile (directive appended), never the driver's stub; and graph authority composes with the caller's exactly as `hooks` and `authorizeMessage` already do.

Two kernel additions make that possible and are useful on their own:

- **`SuperviseOptions.makeLeafAgent`** — override ONLY how an authorized LEAF executes, keeping profile security, spawn authorization, recursive-driver selection and nested supervisors in force. `makeWorkerAgent` still replaces the whole path for callers that want that; the two are refused together. Offline tests and pinning layers should use `makeLeafAgent`.
- **`SuperviseOptions.rootDriverFromBackend`** — `false` stops an external-harness root defaulting onto `backend` when `driverBackend` is absent. `runGraph` sets it, because a graph's `backend` places WORKER nodes only; the root driver stays an explicit choice, as before.

`authorizeSpawn`'s input now also carries `analyst` (set only by the runtime's analyst-on-settle hook) and `continuity` (the effective spawn mode), so a pinning authority can admit an analyst node and ledger how a hop continued.

**Breaking for `runGraph` callers:** `RunGraphOptions.makeWorkerAgent` is renamed `makeLeafAgent` — same shape, now slotted inside the kernel's authorized path. A graph with no `authorizeMessage` now passes steer/answer instructions through unchanged instead of having no message authority; only a caller filter can strip.

## 0.160.0

### A graph now honors every supervise option it does not own

`RunGraphOptions` restated a hand-picked subset of `SuperviseOptions`, and the hand lost: **25 of 49 keys never reached `supervise()` from a graph.** Each absence was found the same way — by losing a run. `resolveSupervisorTools` was one (a declared graph's root mounted no product tools, so five claims never reached the ledger); `childSettleGraceMs` and `driverRetry` were two more, and a transient root-driver failure tore down children that had **already computed the deliverable** (#963).

Every `SuperviseOptions` key is now classified into exactly one of four lists, and a compile-time check fails — **naming the key** — when a new option belongs to none of them. Adding an option to `supervise()` can no longer omit it from graphs silently; the omission has to be a decision someone writes down.

`RunGraphOptions` extends the forwarded set, so those members inherit their type *and* their documentation from `SuperviseOptions`. Newly reachable from a graph, among others: `childSettleGraceMs`, `driverRetry`, `onDriverAttempt`, `runDir`, `finalizer`, `stopRule`, `onProgressStop`, `probes`, `extraTools`, `executeExtraTool`, `authorizeSpawn`, `profileSecurity`, `coordination`, `peerMail`, `compaction`, `maxDepth`, `rootHandle`, `execution`, `resolveDeliverable`, `isDriverProfile`, `driveHarness`, `resolveDriveHarness`, `driveHarnessMaterialization`.

Two keys are deliberately not forwarded, and now say so in code rather than by omission:

- `backend` — a graph's `backend` places WORKER nodes and already became the worker seam, so the root driver stays an explicit `driverBackend` choice.
- `registry` — a NAME COLLISION, not a policy. `RunGraphOptions.registry` is the directive `PromptRegistry`; `SuperviseOptions.registry` is the `SuperviseRegistry` name→value table. Two types, one name; the graph's wins. Giving the supervise one a graph channel means renaming a public option.

No behavior changes for a caller who set nothing new.

## 0.159.0

### A tool-carrying model call no longer answers tool-free

`profileChatClient` and `profileOptimizerModelCall` forwarded only `req.messages` into the turn. A `ChatRequest` carrying `tools` reached the provider without them and came back with ordinary prose — indistinguishable, to the caller, from a model that chose not to call a tool. That is contaminated evidence on the one path agent-eval names Runtime as the owner of.

`tools` now reach the wire through the router seam, and the model's calls come back on `ChatResponse.toolCalls` in the canonical `{ id, name, argumentsJson }` shape. The OpenAI stop cause `tool_calls` is normalized to the canonical `tool_use`.

Three refusals, all before any transport runs, because a dropped tool must never look like an answer:

- A backend without a router seam cannot pass tools; a tool-carrying request names the backend and fails.
- `toolChoice` reaches the wire only from `AgentProfile.model.metadata.toolChoice`, so a request may restate that policy and never change it. A differing value is refused and the error names both sides.
- `toolChoice` with no `tools` is refused: the policy is meaningful only with tools.

Unchanged, and worth stating: `routerInlineExecutor` still requires `AgentProfile.tools` to enable every supplied schema by name, so a caller cannot smuggle a tool past the profile. A tool-carrying request restates what the profile already allows.

This is pass-through, not a tool loop. The caller executes the tools; Runtime owns the exact paid call.

## 0.158.0

### A declared graph can mount the product tools `supervise()` mounts

`RunGraphOptions` accepts `resolveSupervisorTools` and forwards it to the root's `supervise()` verbatim. Without it a graph root mounted only the coordination MCP, so a run whose lead was supposed to reach a product tool found nothing and wrote its output somewhere no ledger could grade — measured on a live declared-graph run where five claims landed inline in a findings file and zero reached the claim ledger.

The field's type is `SuperviseOptions['resolveSupervisorTools']`, so the graph option cannot drift from the option it forwards. Omit it and nothing changes: coordination verbs only.

## 0.157.0

### The bridge reasoning check refused runs it should have admitted

`bridgeExecutor` compared the effort a cli-bridge materialization receipt reports as `applied` against a private copy of the bridge's own mapping, and the copy was stale. It expected codex to apply `minimal` for `none` and `high` for both `xhigh` and `ultracode`; cli-bridge 0.3.0 applies `none`, `xhigh` and `ultra`. A mismatch throws `ValidationError`, so **three of the seven rungs refused a legitimate codex run**. The same switch's default arm asserted the canonical rung for eleven further harnesses, none of which plumbs a thinking flag, so their receipts carried `applied: null` and those runs were refused too.

The map now has one owner: `nativeReasoningControl` in `@tangle-network/agent-interface` 1.6.0, which the cli-bridge argv builders read as well. Interface moves to `^1.6.0` — a consumer that pins it itself must move it with this package.

### An in-process worker is no longer recorded as a sandbox sibling

`LoopSandboxPlacement.kind` and `LoopIterationDispatchPayload.placement` now carry `'in-process'`, and `PlacementInfo` maps it to its existing `'local'` kind. A consumer that switches exhaustively over either union must add the arm. In exchange, a cost or latency breakdown split by placement stops counting every local worktree-CLI iteration in the sandbox bucket.

### One word for a failed projection row

`PursuitRunStatus` and `PursuitNodeStatus` are replaced by one `PursuitStatus = 'running' | 'done' | 'down'`. They disagreed on the word for a failure in the same file, so a consumer joining run rows to node rows on `status` reported two failure populations where there is one. Read `PursuitStatus` and expect `down` on both.

### `improve()` can no longer produce a surface a proposal cannot name

`ImproveSurface` is now `Exclude<AgentImprovementSurface, 'knowledge'>`, and Interface 1.6.0 adds `rollout-policy` to the proposal vocabulary. A rollout-policy improvement can now reach a review or a gate. A consumer switching exhaustively over `AgentImprovementSurface` must add that arm.

### Removed

`Restart` and `SpawnOpts.restart` are gone. The supervisor never read the option, and the retry story already has an owner: a keyed spawn is idempotent per key, and a key whose prior attempt settled `down` spawns fresh and says so. A caller passing `restart` should use `key`.

`restartCount` is gone from the `down` settlement and from `PursuitNodeProjection`. Nothing could increment it, and replay overwrote whatever a journal carried with `0`.

`CoderReview.recommendation` is gone. Selection reads `approved` and `readiness`; a reviewer that wants a caller to read something puts it in `notes`.

`UsageClass` is gone. `UsageSplit` carries the same idea as two named number fields.

`DeliveryBinding`'s `memory-store` arm narrows `provision` to `'sqlite'`. Nothing provisioned the other two, and the whole arm is still refused at resolve time until it clears the E3 admission bar.

## 0.156.0

### Two MCP tool vocabularies now match what the tools accept

`delegation_history` filtered on `profile` and admitted `coder` and `researcher` in three copies — the agent-facing description, the JSON-Schema `enum`, and the runtime validator. The only tool in this package that submits a delegation record is `delegate_ui_audit`, and it submits `ui-auditor`. So an agent asking for its UI-audit history got a `TypeError`, and the two profiles it was allowed to ask for were written by nothing but tests.

`delegationProfiles` is now the one list. The description, the schema and the validator all read it, so a profile added there cannot be one a tool refuses, and the validator's message names the accepted set. `DelegationProfile` derives from the same list and keeps the same three members.

`QuestionDecision`'s escalate arm declared `to: 'parent' | 'user' | string`, which collapses to `string`, while `answer_question`'s schema and handler accepted exactly two targets. Any other value fell through to `answer_question: provide answer, deferReason, or escalateTo`, an error naming the wrong cause. The type narrows to the two the tool accepts, from the same list the schema reads, and a present-but-unaccepted `escalateTo` is refused with a message naming the value.

`delegationProfiles`, `questionEscalationTargets` and `QuestionEscalationTarget` are exported from `./mcp`: a consumer building a profile filter or an escalation control reads the list rather than restating it.

## 0.155.0

### The tool-part decoder registry is keyed by the harness names that arrive

`toolPartDecoders` held an entry under `kimi`. Nothing can produce that name: every in-repo caller reaches `decodeToolPart` through `SteerableSandboxSession.harness`, which is `BackendType`, and the harness kimi is served under is `kimi-code`. The entry was also wrong about the wire — it named the OpenAI decoder, while kimi-code streams an Anthropic `tool_use` content block AND a top-level OpenAI `tool_calls` entry on one session, so binding it to either decoder alone drops half of a worker's tool calls with no error.

Nothing was lost in practice, because an unknown harness falls through to the try-all path, which reaches both decoders. The defect was a trap: correcting the key to `kimi-code` while keeping the decoder it named would have made the specific adapter win and silenced the `tool_use` half.

The registry is now typed `Partial<Record<HarnessType, ToolPartDecoder>>`, so a key no caller can produce does not compile, and `kimi-code` maps to a decoder that reads both shapes. The three keys that were never harness names — `anthropic`, `openai`, `router` — are gone; a part carrying any of those wire shapes decodes identically through the try-all path.

`decodeToolPart`'s `harness` parameter and `sandboxSessionTraceSource`'s `harness` option narrow from `string` to `HarnessType`. A caller passing a harness this package does not register should omit the argument, which is what the try-all path is for.

## 0.154.0

### A promotion may not call a candidate cheaper on dollars nobody measured

`BenchmarkCell` carries `usd` and `usdKnown` as required siblings. `promotionGate` read `usd` from both arms and never read `usdKnown`, while non-inferiority mode promotes on a significant paired cost saving. A candidate whose dollars were a catalog estimate or an unreported floor could therefore be promoted for being cheaper than a receipted incumbent.

`Spend.usdKnown` states the rule: a false value must not be treated as a measurement when enforcing a dollar-denominated comparison or limit. Promotion on cost savings is that comparison.

`PromotionVerdict.reason` gains `'cost-unknown'`, and the verdict carries `costUnknownTasks` naming the tasks that caused the refusal. A caller that exhaustively switches on `reason` must handle the new member; a caller in `superiority` mode is unaffected, because only non-inferiority mode reads dollars.

## 0.153.2

### Eval 0.163.2 and Knowledge 10.7.0 reach this package

The Eval catalog range moves from `>=0.149.0 <0.150.0` to `>=0.163.2 <0.164.0`, and the Knowledge catalog range from `^8.0.10` to `^10.7.0`. Both were far enough behind to hide shipped work from every consumer of this package: Eval by fourteen minors, Knowledge by two majors.

Eval 0.160.0 removed every Eval-owned paid model transport. This package already owns that role through `profileChatClient` and `profileOptimizerModelCall`, so no runtime code path depended on the removed transports. The one place that still did was `examples/p1-parity`, which passed `apiKey` and `baseUrl` into `runMultishot` as inert placeholders because that function used to resolve them eagerly even when the caller injected both transports. `runMultishot` now takes the caller's transports and nothing else, so both fields are deleted from `MultishotArmBackend` and from the live and offline construction sites. The live arm still reaches its endpoint: `completionsTransport(profile, env.url, env.bearer)` carries the same URL and bearer it always did.

Knowledge 10.0.0 replaced the retrieval-receipt shape and split its verifiers. This package imports none of them — the Knowledge surface it uses is `hashKnowledgeBase`, the improvement-job and activation entry points, and `RagKnowledgeUpdateResult` — so the two majors cross with no source change here.

A consumer that pins `@tangle-network/agent-eval` or `@tangle-network/agent-knowledge` itself must move them together with this package: Eval to `0.163.2` or later within `0.163.x`, and Knowledge to `10.7.0` or later. Knowledge 10.7.0 is the first Knowledge release whose own Eval peer admits 0.163.x, so an older Knowledge beside this package is an unmet peer.

## 0.153.1

### The opencode.json materialization fix reaches this package

`@tangle-network/agent-profile-materialize@0.17.1` owns `opencode.json` as a path it generates and may replace. Before that release, re-applying a workspace plan whose child profile asked for a different combination of prompt files refused the turn, and the child died at zero tokens.

The catalog range moves from `>=0.16.0 <0.17.0` to `>=0.17.1 <0.18.0`. The floor is `0.17.1` because `0.17.0` still refuses.

A consumer that pins `@tangle-network/agent-profile-materialize` itself must move to `0.17.1` or later.

## 0.151.0

### Provider-native child tasks reach the turn stream

Agent Interface 1.4.0 publishes a `child-task` stream event: one observed update of a subagent or delegated task a runner started inside the same run, carrying the provider's stable `childId`, its `parentChildId`, status, times, runner, model, usage, and a `sourceEventId` for replay.

Runtime admits it. `child-task` joins the canonical stream-event vocabulary, so a sandbox- or provider-sourced update is decoded rather than dropped, executors publish it on the progress channel, and `streamAgentTurn` yields it verbatim — a client rebuilds the child tree from provider identity instead of inferring children from tool names, transcript text, or array position.

One dedupe covers every backend kind: a repeated `sourceEventId` is the same update, so a reconnect or replay publishes it once. A provider that cannot report a stable `childId` produces no event at all, because the Interface schema rejects it.

## 0.150.0

### A failed retained dispatch destroys only what that call created

The Interface peer range becomes `^1.4.0`, which is where `AgentEnvironment.creation` (`created` | `replayed`) arrives.

`startRetainedRun` wraps detached dispatch and exact-reference validation in cleanup that reads that receipt: an environment this call provisioned (`creation: 'created'`) is destroyed when dispatch or binding fails, and a `replayed` environment — or one whose creation the provider cannot prove — is kept, because another caller may hold it. A destroy that also fails raises an `AggregateError` carrying the dispatch error and the cleanup error, in that order.

Previously every post-create failure kept the environment, so a failed dispatch could leave one paid cloud environment alive until its external lifetime expired.

## 0.149.0

### Every usage cost states its provenance

The `cost` variant of `UsageEvent` becomes a discriminated union: `usdKnown: true` requires `provenance: 'provider-receipt' | 'billing-receipt'`, and `usdKnown: false` requires `provenance: 'catalog-estimate' | 'uncaptured'`. A cost with no provenance no longer compiles, so a dollar figure can never reach the conserved pool as measured spend without naming the receipt behind it.

Two paths change what they claim:

- The environment-provider executor reported a provider event's `usage.cost` as known dollars. No provider event carries a billing receipt, so both its cost events and its terminal `Spend` now read `usdKnown: false` with `uncaptured` provenance — an observed floor, never measured spend.
- `runBenchmark` recorded a thrown cell as `usd: 0, usdKnown: true, tokensKnown: true`. A cell that threw measured nothing, so both channels are now unknown and a comparison cannot sum them as a free cell.

The CLI Bridge carries the exact receipt kind (`provider-receipt` / `billing-receipt`) from its decode onto the emitted event, and the unreceipted-turn fallback keeps its catalog price labelled as an estimate.

## 0.148.0

### Provider-neutral executor cancellation

`Executor.cancel?(request)` asks a backend to stop and reports what it acknowledged: `status` (`accepted | rejected | already-terminal | unknown`), the run `effect` in the existing `RetainedRunEffect` vocabulary, `observedAt`, a `detail`, and backend `evidence`. `teardown` stays the resource verb and is unchanged.

Per arm:

- Router and the Router tool loop answer `unknown` / `cancel_requested`: the chat-completions API exposes no cancel operation, so the local request is aborted and `detail` says the provider may still bill the completion. A local abort is never presented as acceptance.
- The CLI Bridge posts its run cancel operation and answers from the terminal snapshot: `accepted` / `cancelled` when every live run reached terminal, `already-terminal` / `not_live` when none was live, and `unknown` / `cancel_requested` when the deadline passed first.
- The steerable Sandbox session interrupts the exact box session it holds: `accepted` / `cancelled` when the platform reports the execution cancelled, `already-terminal` / `not_live` when it reports none running.
- The composed Sandbox leaf and the environment-provider stream retain no exact control reference, so both answer `unknown` and say why.

`Scope.cancel(nodeId, request)` delegates to the child executor's operation, or aborts the child locally and answers `unknown` for a runtime that has none.

## 0.146.0

### Separate visible, reasoning, and total completion ceilings

`AgentProfile.model.maxVisibleOutputTokens`, `maxReasoningTokens`, and `maxTotalOutputTokens` (Agent Interface since 0.48.0) are now enforced. Measured through the Tangle Router on 2026-08-10: `glm-5.2` accepted `max_tokens: 8` and still billed 135 completion tokens — 132 reasoning, 3 visible — while `max_completion_tokens: 256` bounded the billed total. One number could not express both.

Per path:

- Router and OpenAI-compatible routes send the visible ceiling as `max_tokens` and the total as `max_completion_tokens`.
- The CLI Bridge carries the total as its single completion cap; a visible-only ceiling is refused there.
- The Sandbox and environment-provider paths expose no completion cap, so any ceiling is refused.
- No route publishes a reasoning-token budget, so `maxReasoningTokens` is refused on every path. `AgentProfile.model.reasoningEffort` remains an intensity dial, not a token bound.

A refusal is a `ConfigError` raised before any paid transport, and every planned execution declaration records `tokenLimits: { requested, applied }`, so the receipt says what was asked for and what was sent.

`AgentProfile.model.metadata.maxTokens` is removed. A profile that still sets it fails with an error naming the three fields that replace it. `superviseSurface` no longer derives a worker's token budget from that field: a per-completion ceiling is not a per-worker budget, so the budget comes from the conserved pool alone.

`profileChatClient` compares a caller's `maxTokens` against the visible ceiling the router path actually sends.

## 0.145.0

### A sandbox settle names its served backend and says what it produced

`SandboxLeafOut` and the steerable Sandbox session artifact carry `servedBackend` — the provider and model the platform reported serving the turn, read from the last `effectiveBackend` the event stream carried. It is absent when the platform reported nothing, and it is never filled from the request.

`content` becomes `string | undefined` and travels with an explicit `output` marker: `{ kind: 'text', bytes }`, `{ kind: 'empty' }`, or `{ kind: 'absent' }`. `empty` means a text-bearing event was observed and carried nothing; `absent` means no text-bearing event was observed at all. The previous `?? ''` collapsed those two into one blob, so a box that produced nothing looked exactly like a box whose answer was lost.

Both ride the executor artifact, so they reach `final.metadata.result` and the supervise settle record.

## 0.144.0

### Live executor output, one tool-call shape, and attested provider executors

`UsageEvent` gains a `progress` kind carrying an `ExecutorProgressEvent` — incremental text, reasoning, tool calls, tool results, and interaction requests.
The CLI Bridge session, the steerable Sandbox session, and the environment-provider executor publish it while a turn runs.
`streamAgentTurn` projects each progress event onto the public `text_delta`, `reasoning_delta`, `tool_call`, `tool_result`, and `interaction` events before the terminal `final`, so a client renders live harness activity without parsing raw backend output.
`collectAgentTurn` keeps those calls on replay.
Accounting is unchanged: only `tokens` and `cost` events meter a budget, and `meterUsageEvent` is now the one place that decides which kinds meter.

Every Runtime-owned executor reports terminal tool calls as `ExecutorToolCall` (`{ id?, name, arguments }`).
The CLI Bridge and the steerable Sandbox session previously published tool names only, and the Router tool loop published a count, so `streamAgentTurn` dropped their calls.
`streamAgentTurn` now refuses an artifact whose `toolCalls` is not that shape instead of silently dropping it.
`ExecutorToolCall` replaces `SandboxExecutorToolCall`, which 0.143.0 introduced one release earlier.
`sandboxProgressEvents` projects one Sandbox event onto the progress vocabulary through the existing event mappers.

`createExecutor({ backend: 'provider' })` now binds Runtime materialization and execution-binding evidence: a planned declaration before `provider.create`, finalized with the environment identity the provider issues.
The provider steering path keeps the Sandbox executor's evidence across its runtime rename.
Exact turn execution therefore accepts every executor `createExecutor` returns.

This is a minor release because `UsageEvent` widens and one public export is renamed.

## 0.143.0

### Sandbox moves to 0.31.0, and its run outcome is the one terminal result

The Sandbox peer range becomes `>=0.31.0 <0.32.0`, and the catalog requires Sandbox `0.31.0`.
Sandbox 0.31.0 publishes `createAgentRunOutcomeTracker` and `AgentRunOutcome` on its `runtime` subpath, and this package now requires them.
The Interface peer range becomes `^1.3.0` because Sandbox 0.31.0 requires Interface `^1.3.0`, so one consumer install resolves one Interface copy.
Bench moves to 0.8.19 with the same dependency cohort.

The round-synchronous leaf (`runAgentRounds`), `openSandboxRun`, the steerable sandbox session, and `streamAgentTurn` observe the complete Sandbox event stream with the public outcome tracker and read the terminal result from it.
A `failed` outcome fails the iteration or turn with the Sandbox error.
A `blocked_on_approval` or `awaiting_*` outcome settles as `blocked`.
A `success` outcome completes, so a recovered tool error no longer fails a completed turn.
The outcome rides `Iteration.sandboxOutcome`, `CollectedAgentTurn.sandboxOutcome`, and the final stream event's `metadata.sandboxOutcome`.
A failed or blocked turn keeps its measured token usage and cost.
`SandboxLeafOut` carries `content`, `toolCalls`, and `outcome` beside the raw `events`, so a consumer does not parse raw Sandbox events a second time; `SandboxExecutorToolCall` names one retained tool call.

`./kernel` drops `assertSandboxEventSucceeded` and `sandboxEventFailure`; the public Sandbox outcome tracker replaces that event-level failure parser.
This is a minor release because two public exports are removed.

## 0.142.3

### Sandbox 0.29 and 0.30 compatibility

The Sandbox peer range becomes `>=0.29.0 <0.31.0` because Sandbox 0.30 is additive.
The development catalog keeps Sandbox 0.30.0 while strict packed installs cover 0.29.0 and 0.30.0.
Bench moves to 0.8.18 with the same dependency cohort.

## 0.142.2

### Sandbox moves to 0.30.0

The Sandbox peer range becomes `>=0.30.0 <0.31.0`.
The development catalog uses the same range and resolves Sandbox 0.30.0.
Bench moves to 0.8.17 with the same dependency cohort.

## 0.142.1

### Retained turns no longer change environment creation identity

Headless and interactive retained runs now add only `retainedIdempotencyKey` to provider environment metadata.
Turn, session, execution, profile, and request identity remain in the durable admission records and dispatch requests that own them.
Providers can therefore reuse one environment across later turns without treating each turn as a conflicting create request.

## 0.142.0

### Eval moves to 0.149.0, Sandbox moves to 0.29.0, and Knowledge moves to 8.0.10

The Eval peer range becomes `>=0.149.0 <0.150.0`, and the catalog requires Eval `0.149.0`.
The Sandbox peer range becomes `>=0.29.0 <0.30.0`, and the catalog requires Sandbox `0.29.0`.
Knowledge moves to `8.0.10`, whose Eval peer range admits Eval `0.149.0`.
Bench moves to `0.8.16` with the same dependency cohort.

## 0.141.1

### Eval moves to 0.148.0, so the peer window moves with it

The Eval peer range becomes `>=0.148.0 <0.149.0`, and the catalog requires Eval `0.148.0`.
Eval 0.148.0 publishes `createEvidenceReceipt`, `verifyEvidenceReceipt`, and `isIndependentEvidence` on the `/experiment` subpath.
A new integration test binds one real recursive pursuit to an Eval evidence receipt through that surface.

Knowledge is a dependency of this package, so its own Eval peer had to admit 0.148.0 first; that is Knowledge 8.0.9, and the catalog floor moves to `^8.0.9`.

This release also carries the Sandbox truth fixes already on main (#896): sandbox workers receive the exact profile model, and an in-band sandbox execution failure fails the stream instead of settling clean. Their five exports (`SandboxServedBackend`, `assertSandboxEventSucceeded`, `assertSandboxServedModel`, `sandboxEventFailure`, `sandboxEventServedBackend`) ship for the first time in this version.

Bench moves to 0.8.15 because its catalog dependency window moves with the release.

## 0.138.1

### Eval moves to 0.146.0, so the peer window moves with it

The Eval peer range becomes `>=0.146.0 <0.147.0`, and the catalog requires Eval `0.146.0` and Knowledge `8.0.6`.

The window is derived, not chosen. `assertPeerMatchesDevelopmentDependency` holds the peer range to the shape the dependency's own versioning earns: a pre-1.0 dependency stops at its next minor, because npm locks a 0.x caret to its minor. Requiring Eval `0.145.21` therefore produced `>=0.145.21 <0.146.0` on its own.

Eval 0.146.0 adds the `multishot/golden` subpath and removes nothing. Diffing the two published type surfaces through the TypeScript checker, across every entry point in the `exports` map, 0.145.21 to 0.146.0 removes no entry point, no top-level export and no interface member, and adds 51 exports. The 20 signature changes are type-precision improvements on values that were `any`.

Knowledge is a dependency of this package, so its own Eval peer had to admit 0.146.0 first; that is Knowledge 8.0.6.

No API changes.

## 0.138.0

### `runTree` leaves the kernel surface; the composition families are now held by a test

`runTree` merges a resumed run's committed nodes into the live tree view.
The supervisor applies it before it returns, so `SupervisedResult.tree` already carries the merged tree and nothing outside this package needed to call it.
Its `run*` name was the real cost: on a surface that also exports `runGraph`, it read as a second graph runtime.

It is now a supervisor internal.
No consumer imported it, verified across 23 first-party repositories and the only published dependent, so no migration is required.
This is a minor release because a public export is removed.

`tests/kernel/composition-families.test.ts` is new, and it holds open the boundary between the two ways this package composes agents.
A combinator such as `pipeline` or `loopUntil` runs under `runPersonified`, which accepts no brain, no router, and no model configuration, so the order is a property of the program.
`runGraph` always routes delegation through a model.
The test runs one two-node graph twice: the worker runs when the scripted brain emits `spawn_agent`, and nothing runs when the same brain declines.
A pipeline stage cannot be skipped that way, so neither entry expresses the other.

The audit behind this release is recorded in `docs/research/loop-facade-postmortem.md`.
Two of the five entries an earlier ledger listed for consolidation were not public when it listed them.
`runLoop` had already been consolidated onto `runAgentRounds`: it was a deprecated alias, and 0.127.0 deleted it.
`routerToolLoop` is a router-client internal that no barrel exports.
The remaining entries are four families with distinct reasons to exist, and they stay.

## 0.137.0

### The agent-interface peer is a caret range

The peer moves from `>=0.53.0 <0.54.0` to `^1.0.0`.

Interface 1.0.0 publishes the surface of 0.56.0 unchanged and states a compatibility promise: a minor release is additive, a patch release is a fix, and only a major release removes or narrows.
A caret range reads that promise, so a later additive minor no longer needs a release here.

The one-generation window it replaces is why an app could not install this package beside `agent-knowledge` or `sandbox-ui`: those had moved past 0.53 and this had not, and the two ranges were disjoint.

The catalog moves with it, so one interface copy resolves for the whole tree:

| catalog entry | before | after |
| --- | --- | --- |
| `@tangle-network/agent-interface` | 0.53.0 | 1.0.0 |
| `@tangle-network/agent-core` | 0.9.0 | 0.9.4 |
| `@tangle-network/agent-eval` | 0.145.15 | 0.145.21 |
| `@tangle-network/agent-knowledge` | 8.0.1 | 8.0.5 |
| `@tangle-network/agent-profile-materialize` | 0.15.1 | 0.16.0 |
| `@tangle-network/sandbox` | 0.27.0 | 0.27.1 |

The `agent-eval` peer floor moves to `>=0.145.21 <0.146.0` with the catalog.
The `sandbox` peer floor moves to `>=0.27.1 <0.28.0` with the catalog. A consumer holding sandbox 0.27.0 must move to 0.27.1, which is the release that declares the interface caret range.

This is a minor release, not a patch: the interface range narrows, so a consumer still holding an interface below 1.0.0 stays on 0.136.0.

## 0.136.0

### Peer mail: workers can reach a live sibling, bounded and audited

Until now a worker could only be reached by its parent.
The inbox understood two kinds, `steer` and `answer`, both parent-authored, and the only worker-to-worker path fired at settle time through an analyst lens.
Two live workers could not compare results, one could not challenge another's claim, and a blocked worker could not ask the peer that already had the fact.

`CoordinationToolsOptions.peerMail` (and `serveCoordinationMcp({ peerMail })`) turns on a sibling channel.
Each spawn is minted a capability endpoint delivered on `WorkerSpawnContext.peerMailUrl`.
The endpoint serves exactly two tools, `send_mail` and `read_mail`, and speaks as one worker: the sender is bound to the capability and is never a tool argument.
Mount it on a worker the way `coordinationMcpUrl` is mounted on a driver.

- Envelopes are typed, not chat: `ask`, `tell`, `challenge`, `answer`. `tell` and `challenge` must cite evidence refs the receiver can re-check. Mail confers no verification.
- The parent audits but does not relay. Every attempt, delivered or refused, publishes a `mail` `CoordinationEvent` and persists to the coordination side-log as `PriorCoordination.mail`. `stopMailThread` ends one exchange.
- Bounds fail closed with a refusal the sender reads: a per-sender send quota, a per-RECEIVER inbox cap in count and bytes, a reply-depth ceiling, and hard caps on subject and body. Every attempt past the quota check spends one unit, refusals included.

### Authority separation in the worker inbox

- Peer mail renders in its own block, fenced with a per-fold nonce and attributed to its sender. A mixed drain now produces at most two blocks, so a peer message can no longer ride under the `[SUPERVISOR]` batch header.
- A body or subject that speaks as the supervisor is refused at intake (`forged-authority`).
- Peer mail can never be forceful: `interrupt` is written as `false` and the wire field is ignored, so a sibling cannot abort a sibling's in-flight turn.
- Peer mail never blocks a settle. The pre-settle fence now counts `Inbox.pendingAuthority()`, so a sibling cannot hold a finished worker open by keeping mail in flight.
- A supervisor answer now renders as `Answer from your supervisor to your question (id): …`. Every folded line names its sender, so "unattributed" is not a renderable state.
  A consumer asserting on the previous `Answer to your question (id):` wording must update it.

The mail listener is a separate port from the coordination MCP by design.
That server mounts `spawn_agent` / `steer_agent` / `stop` unauthenticated on loopback, so a worker handed its URL could send a real supervisor instruction to a sibling and the peer marking would mean nothing.
The boundary is between agents, not between processes: a worker that can read another worker's environment still holds that worker's capability.

## 0.135.3

- Move the `@tangle-network/agent-interface` peer range to `>=0.53.0 <0.54.0`.
`agent-knowledge` 8.x requires interface `>=0.53.0`, so the previous `>=0.52.0 <0.53.0` range made no published set installable for a consumer that carries both packages.
Interface 0.53.0 is additive over 0.52.0 (strict per-turn interaction requests on Sandbox backend prompt options); typecheck and the test suite pass against 0.53.0.
A consumer on interface 0.52.x must move to 0.53.x when it adopts this release.
- Move the `@tangle-network/agent-eval` peer floor to 0.145.15, the release `agent-knowledge` 8.0.1 requires (`>=0.145.14`).
The development catalog moves `agent-knowledge` to 8.0.1 for the same reason.
- Move the `@tangle-network/agent-core` dependency to 0.9.0, the version `agent-eval` 0.145.15 depends on, so a consumer install holds one copy.
- Move the Sandbox dependency and peer floor to 0.26.2.
No runtime behavior changes.

## 0.135.2

- Publish the 0.135.1 content.
The v0.135.1 tag never published: its release commit skipped `generate:testing-fixture`, so the Publish verify step failed on stale fixture versions, and the fixture fix (#870) moved the tip of `main` past the tag.
No runtime behavior changes.

## 0.135.1

### The caller-brain seam is production on `runGraph` (#694, option A)

`RunGraphOptions.brain` accepts a caller-owned `ToolLoopChat` on the `/kernel` production entry.
The root driver's inference becomes caller data: a deterministic conversation driver or a persona loop that makes its own LLM calls can drive a graph without a `/testing` detour, and the graph machinery around the seam — node pinning, directive delivery, the edge ledger, the journal twin — is the same shipped path.
This is the seam the multishot→`runGraph` consumer migrations require (issue #694, phase 4): strict-alternation driver orchestration must be caller-owned for the recorded artifacts to stay byte-compatible.

Graduation evidence per [docs/STABILITY.md](./docs/STABILITY.md):

- Tests: `tests/kernel/graph.test.ts` ("the caller-brain seam on the production surface") — a caller brain drives the 2-node graph to completion and the edge ledger plus its journal twin match the router-brained run row for row; the two refusals below are asserted; the router-brained default is proven unchanged.
- Curated doc: `docs/canonical-api.md` (the `/kernel` table's `runGraph(graph, { brain })` row).
- Consumer: `examples/graphs/user-sim-conversation.ts` runs the persona driver on the production surface end-to-end (`pnpm tsx examples/graphs/user-sim-conversation.ts`).
- Seam shape: `brain: ToolLoopChat` is unchanged since before 0.128.0; only its placement (test-only → production) moves in this release.

Contract details:

- Omitting `brain` leaves the router-brained default byte-identical: the root's model call derives from the root `AgentProfile` exactly as before.
- With a brain, the root profile keeps prompt control (`prompt-control-execution` materialization — `systemPrompt`/`instructions` still apply). Model selection, provider-identity validation (`expectedModel`), and per-turn usage reporting move to the caller.
- Fail-loud refusals before any compute: `brain` + `driverBackend` (two answers to who makes the root's model calls), and `brain` on a root whose profile declares an external harness (the harness IS that root's brain).
- `/kernel` re-exports `ToolLoopChat` / `ToolLoopCallContext` so a consumer can type its brain from the production entry.
- `supervise` and `supervisorAgent` keep refusing direct brain injection; the graduated surface is the graph root only. The `/testing` entry (`runGraphWithTestBrain`, `RunGraphTestOptions`) keeps working as an alias for tests written before this release.

## 0.135.0

### workerFromBackend honors `continuity: 'resume'` on the bridge backend

The backend-derived worker seam re-attaches cli-bridge sessions (#694, the chat-transport resume executor's bridge arm).
A bridge session id IS the harness conversation key — cli-bridge maps it to the CLI's own resume (opencode `-s <id>`, claude `--resume`) — so a resume spawn is real session re-attachment, never a fresh session wearing a `resume` stamp.

- `workerFromBackend` records the session id each supervised bridge spawn was bound to, keyed by the worker id the Scope assigned. A `continuity: 'resume'` spawn binds the prior worker's recorded session id (`spawnContext.resume.ofWorker`) instead of deriving a fresh one, so the new worker continues the exact harness conversation. A fresh → resume → resume chain stays on ONE session.
- The record is process-local by construction, which matches the kernel's documented resume boundary: a prior process's workers are not resume targets.
- Fail-loud contract unchanged everywhere else: a non-bridge backend still refuses a resume spawn (its executors have no re-attachable session), and a resume of a worker this seam never bound a session for refuses by name. Every refusal throws BEFORE a worker exists, so the kernel never ledgers `continuity: 'resume'` over a session that was not re-attached.
- `runGraph` handed a `backend: 'bridge'` config now honors a delegates edge's `continuity: 'resume'` natively — the revise-edge pattern (write fresh, revise by resuming the writer's session) runs without a custom `makeWorkerAgent`.
- FIX, found by the live proof: the derived external session id now scopes by the spawning manager node. Assignment ordinals restart at `ordinal:0` under every manager, so the unscoped digest mapped worker 1 of EVERY run — and of every sibling manager — to ONE bridge session id; on a bridge with a persistent session store, a `'fresh'` spawn then silently continued a foreign run's harness conversation (measured live: three separate runs shared one claude conversation, `turns: 6`). Durable recovery within a run is unchanged (a replay re-issues the same manager node id and assignments). Migration: a journaled run from an older version replayed under this version derives DIFFERENT session ids and will not re-attach its old harness sessions.

## 0.134.4

- Consume Core 0.8.0, Eval 0.145.11, Interface 0.52.0, Knowledge 7.2.6, Profile Materialize 0.14.2, and Sandbox 0.26.1 as one compatible dependency set.
- Use Sandbox 0.26's live `branch(count)` API for shared-context fanout while retaining the legacy checkpoint path for custom clients.
- Preserve the router's usage-limit result and accounted input tokens in signed model-settlement evidence required by Interface 0.52.

## 0.134.3

- Bridge terminal accounting no longer creates a second empty provider attempt when the billed dollar amount is unknown.
- Consumers that inspect `SpawnEvent` must ignore `metered` events with `accountingOnly: true` when counting provider executions.
- Continue rejecting genuine provider attempts without a provider model identity; this release does not weaken that check.

## 0.134.2

- Make the supervised token charge additive: `input - cacheRead + output`, which equals `freshInput + cacheWrite + output` under a complete cache split. A spend that folded a classified turn together with an unclassified one previously fell back to the rolled-up prompt total for the whole aggregate, so one unreported turn re-charged every cached prefix beside it.
- Credit no cache read whose reported classes do not fit inside the prompt total they partition, at the record AND in the fold: `addTokenUsage` no longer accumulates the classes of a turn that overflowed its own `input`, because the accumulator's larger total would otherwise absorb the overflow and charge the aggregate less than its records. The charge is never below the output tokens, and a zero prompt total charges no prompt tokens.
- The token channel trusts a reported cache read the same way it trusts a reported `input`. It is an accounting unit, not a trust boundary against a provider that misreports its own usage.
- Accept a `Spend` whose cache classes cover only part of `input` when it carries `cacheBreakdownKnown: false`. Requiring an exact partition there rejected the shape aggregation produces, and a resumed pool restored from such a record failed at construction. Classes that EXCEED `input` are still refused, and a spend claiming a complete split must still partition `input` exactly.
- `equalKOnCost` now rates a rolled-up arm at what the pool charged it, including trees where one node reported no cache split.

## 0.134.1

- Preserve a cli-bridge root's known profile materialization when Runtime exhausts the token budget after the bridge emits its terminal receipt.
- An accepted `submit_result` winner and the original budget diagnostic now survive together.
- Consumers that read failed-run trees must keep using a known materialization receipt when the result is `budget-exhausted`; they must not replace it with `unknown`.

## 0.134.0

- BEHAVIOR CHANGE: the supervised token budget now charges each token once, when it first enters the context — `freshInput + cacheWrite + output`. It previously charged the rolled-up prompt total, which counts a cached prefix again on every turn that reads it.
- Your existing `maxTokens` numbers are unchanged, but the unit they measure is not. On a 299-run fleet cache was 98.2% of the counted prompt total, so a run that died at about 1.8% of its declared budget now gets the budget it declared.
- Migration: a caller who lowered `maxTokens` to compensate for the old inflation will get much longer runs. Re-derive that ceiling from newly-presented tokens before the next campaign.
- `BudgetReadout` and `Scope.budget` gain `cacheBreakdownKnown`. It reads false once the pool charged a spend whose cache split it could not read; `tokensLeft` is then an upper bound on newly-presented work, not a measurement. A provider that reports no split still spends against the cap, exactly as an unreported token count does.
- `equalKOnCost` compares arms on the same charged unit, so two arms doing identical new work no longer read as unequal compute because their cache hit rates differed.
- The token cap no longer bounds the cost of cache reads. Dollars are bounded only by `maxUsd`, which is optional and unset on nearly every run today — budget it explicitly when cost matters.

## 0.133.8

- Stop an external supervisor's active harness after `submit_result` accepts a result or `stop` declares completion.
- Custom `DriveHarness` implementations should honor the new `stopSignal` so they stop provider work after completion.

## 0.133.7

- Preserve cli-bridge profile materialization receipts when a terminal provider error follows the receipt.
- Emit an explicit unknown dollar-usage event when a bridge turn has no trusted billed-cost receipt.
- Retry only an explicit `candidate_grant_draining` settlement response until the caller deadline.
- Consumers that require exact dollar settlement must treat `usdKnown: false` as unknown until a trusted provider or billing receipt is available.

## 0.133.6

- The direct protected model-grant port accepts an optional caller-declared `maxTotalTokens` cap across input and output tokens.
- Bind that cap into the exact reservation response and reject a final ledger that exceeds it or omits token usage.
- Signed execution plans in the Interface 0.47 cohort remain unchanged; only the direct protected model-grant port accepts this field.

## 0.133.3

- Preserve the provider-served model snapshot in official optimizer cost receipts so Eval can match the response, receipt, and execution evidence.

## 0.133.2

- Accept a routed response when its served-provider prefix differs from the profile's gateway prefix but its model name matches.
- Preserve the complete provider-qualified model and snapshot in execution evidence.
- Reject a different model name, a changed snapshot, or a missing snapshot when the profile pins one.

## 0.133.1

- Preserve provider-served model identity for every Runtime inference attempt, including paid executions that abort before terminal materialization.
- Keep provider identity separate from the planned materialization alias and replay it through settled tree records.
- Consumers that derive billing identity from supervised trees must use `providerModel` evidence and treat missing or conflicting attempts as unknown.

## 0.133.0

- Require an awaited `onAdmission` durability hook on `startRetainedRun`, called after environment creation and after dispatch, before the start promise resolves.
  Migration: every `startRetainedRun` caller must add `onAdmission` and persist each record before the hook returns.
- Mint deterministic dispatch identity from `(idempotencyKey, turnId)` when the caller omits `identity`, and verify after dispatch that the provider honored it; a mismatch fails with `RetainedRunDispatchBindingError` carrying the provider's returned reference.
- Add `recoverRetainedRun(...)`: from pre-dispatch admission coordinates it reports `recovered`, `not_found`, or `unverifiable`; `unverifiable` is never destroy-safe.
- Fail a start whose admission hook rejects with `RetainedRunAdmissionError` and keep the environment for recovery.
- Write the retained recovery keys into provider create metadata; the runtime keys overwrite same-named caller keys, and other caller keys stay preserved.

## 0.132.13

- Normalize official optimizer cost receipts to the requested profile model while preserving the provider-served identity in response evidence.

## 0.132.12

- Accept a provider-qualified served model when its base model and snapshot match the exact `AgentProfile` model.
- Use one model identity comparison for direct optimizer calls and recursive Eval dispatch.

## 0.132.11

- Consume Core 0.6.1, Eval 0.145.2, Interface 0.47.0, Knowledge 7.2.4, Profile Materialize 0.14.0, and Sandbox 0.21.1 as one compatible dependency set.
- Raise the Eval, Interface, and Sandbox peer ranges to the current shared release cohort.

## 0.132.10

- Send the request-scoped model gateway URL with its protected token on every bridge request and reconnect.
- Bind both protected credential digests to the durable bridge run identity.
- Reject token-only, changed-URL, and non-HTTPS protected routes without exposing secret values or private URL paths.

## 0.132.9

- Add `runProtectedAgentCandidateModelGrant(...)` for one bounded resolve, reserve, activate, execute, and settle lifecycle.
- Preserve callback and settlement failures together, and settle activated failures as `failed` or preparation failures as `preparation-failed`.

## 0.132.8

- Add request-scoped model credentials for loopback cli-bridge execution.
- Resolve the credential before each bridge POST and resend it after reconnect.
- Keep the credential value out of snapshots, artifacts, and errors.

## 0.132.7

- Make repeated finalization of the same root execution binding idempotent after a supported resume.
- Continue to reject a different binding for the same attempt as journal corruption.

## 0.132.6

- Settle moving model identities from provider receipts for external harness roots.
- Reject missing, bare, mixed, or mismatched root model evidence before Eval records a known receipt.

## 0.132.5

- Preserve the provider's served model and snapshot fingerprint in bridge execution receipts.
- Consume Agent Eval 0.145.0 and Agent Knowledge 7.2.3 as one compatible dependency set.

## 0.132.4

- Consume Agent Eval 0.144.13 and Agent Knowledge 7.2.2 as one compatible dependency set.

## 0.132.1

- Add `candidatePopulation` to `improve(...)` results so consumers can inspect every verified optimizer candidate, including its exact profile, Interface diffs, parent lineage, and selection score.
- Consume Agent Eval 0.144.12 and Agent Knowledge 7.2.1 as one compatible dependency set.

## 0.131.7

- Add `superviseDispatch(...)` so `agent-eval` profile matrices admit and record a recursive Runtime tree before it spends.
- Refuse a one-model Eval receipt when a supervised tree has mixed or unknown model identities.
- Preserve complete prompt cache read/write telemetry through bridge, supervisor, journal, and Eval cost receipts.
- Keep partial cache telemetry and missing token receipts explicit instead of treating them as zero.
- Consume Agent Eval 0.144.10 and Agent Knowledge 7.2.0.

## 0.131.6

- Consume Agent Eval 0.144.8 and Agent Knowledge 7.1.3 as one exact dependency set.

## 0.131.4

- Accept and preserve cli-bridge's positive applied completion-token cap in Runtime materialization evidence.
- Reject zero, negative, fractional, or non-numeric applied caps before the evidence enters the journal.

## 0.131.3

- Preserve cli-bridge inference transport and observation evidence in Runtime materialization receipts and journal digests.

## 0.131.2

- Forward each exact `AgentProfile` completion-token ceiling to every initial and resumed CLI bridge request.
- Record the ceiling in the planned execution evidence, while the conserved Runtime budget remains independent.

## 0.131.1

- Return scalar and array MCP tool results through text content, and reserve `structuredContent` for non-null JSON objects.
- Prove string and object responses over stdio with the official MCP SDK, and reject results that JSON cannot serialize.

## 0.131.0

- Consume agent-profile-materialize 0.13.1 and Sandbox 0.19.4 with Interface 0.46.1, Eval 0.144.6, and Knowledge 7.1.2.
- Bind candidate system-prompt launch controls through the native harness plan, including OpenCode's generated primary agent.
- Keep Codex and Gemini prompt delivery fail-closed, and preserve separate replacement and additive controls for Claude Code, Pi, and Prime.

## 0.130.0

### Stability contract + first graduation

[docs/STABILITY.md](./docs/STABILITY.md) defines what `@stable` / `@experimental` promise consumers, the graduation bar (substantive tests + a curated-doc section + at least one real consumer + a 30-day quiet API + a CHANGELOG graduation entry), and the demotion/removal policy. A symbol tag wins over its module tag; an untagged symbol in an untagged module is experimental by default. This entry is the initial graduation: each family below is promoted at its current post-0.129.0 exact-profile shape with the evidence that passed the bar, and the 30-day breaking-change clock applies to every `@stable` symbol from this release forward.

Promoted `@experimental` → `@stable` (per-symbol and module-level):

- `runAgentRounds` + the kernel contract (`Driver`, `Validator`, `OutputAdapter`, `Iteration`, `LoopResult`, `AgentRunSpec`, `SandboxClient`, `ExecCtx`, `LoopTraceEmitter`, `RunAgentRoundsOptions`, and the trace-event/provenance closure in `src/runtime/types.ts`) — tests: `tests/kernel/` (`run-loop-harden`, `loop-dispatch` + the kernel suite); doc: `docs/canonical-api.md`; consumers: `bench/src/research-shot.ts`, `bench/src/corpus.ts`.
- `supervise` / `Scope` / `Supervisor` (+ `createScope` / `createSupervisor` via their module tags) — tests: `tests/kernel/supervise.test.ts` (1,878 lines) + `coordination-driver` / `coordination-mcp`; docs: `docs/execution-model.md`, `docs/canonical-api.md`; consumers: `bench/src/gate.ts`, `examples/supervise`, `examples/supervisor-loop`.
- personify combinators `pipeline` / `fanout` / `loopUntil` / `panel` / `verify` / `widen` + `definePersona` / `runPersonified` — tests: `tests/kernel/personify.test.ts` (797 lines); doc: `docs/canonical-api.md`; consumers: `examples/graphs`, `bench/src/gate.ts`.
- the spawn journal family (`InMemorySpawnJournal`, `FileSpawnJournal`, `InMemoryResultBlobStore`, `FileResultBlobStore`, `replaySpawnTree`, the `SpawnForest*` views) — tests: `tests/runtime/spawn-journal-replay-identity.test.ts` + the kernel suite's journal assertions; doc: `docs/canonical-api.md`; consumers: `bench/src/gate.ts`, `examples/recursive-supervisor`.
- the `/mcp` delegation queue + stores + status tools (`DelegationTaskQueue`, the delegation store, the feedback store, `delegate`, `delegation_status`, `delegation_history`, `delegate_feedback`) — tests: `tests/mcp/` (`task-queue`, `task-queue-durable`, `delegation-store`, `delegation-status`, `delegation-history`, `delegate`, `delegate-feedback`); doc: `docs/agent-managed-compute/current-state.md`; consumers: the shipped `agent-runtime-mcp` server (`src/mcp/server.ts`) + `examples/supervisor-loop/run-supervisor-mcp.ts`.
- `/intelligence` (all six module-tagged modules: the barrel, `capability`, `delivery`, `effort`, `resolver`, `with-intelligence`) — tests: in-package (`capability` / `delivery` / `intelligence` / `with-intelligence`, ~1,969 lines); doc: `docs/intelligence-sdk.md`, whose status has been "shipped" since it landed; consumers: `examples/intelligence-recommend`, `examples/intelligence-webcode`, `examples/intelligence-drop-in`, `examples/self-improving-loop`.
- the improvement generators (`improve`, the agentic generator, the improvement driver, the raw-trace distiller, the reflective generator) — tests: `src/improvement/improve.test.ts` (919 lines) + the in-package suite; doc: `docs/canonical-api.md`; consumers: `bench/src/swe-bench-env.ts`, `examples/improve`.
- `streamAgentTurn` / `collectAgentTurn` + the turn types (`AgentTurnBackend`, `AgentTurnInput`, `AgentTurnUsage`, `CollectedAgentTurn`, `StreamAgentTurnOptions`) — tests: `src/runtime/stream-agent-turn.test.ts` (690 lines); doc: `docs/canonical-api.md`; consumers: `bench/src/router-turn.ts`, `bench/src/benchmarks/appworld.ts`, `examples/chat-handler`, `examples/runtime-run`.

Kept `@experimental`, each with the failing check:

- `Scope.resume` / `SupervisorOpts.resume` and `EventBus` / `createEventBus`: same-process replay only — live supervised-tree recovery after a coordinator restart and the durable cross-process mailbox are listed Not implemented in `docs/agent-managed-compute/README.md`.
- The detached/worktree delegation leaves (`src/mcp/delegates.ts`, `detached-coder`, `detached-turn`, the worktree harnesses, `local-harness`): the module doc records the unfinished `driveTurn`-over-a-detached-session resume path.
- The coordination MCP (`src/mcp/tools/coordination.ts`, `src/runtime/supervise/coordination-mcp.ts`): authenticated remote coordination is Not implemented.
- `LoopLineageOptions` / `RunAgentRoundsOptions.lineage` and the member-level extension points `Driver.selectWinner`, `SandboxClient.criuStatus`, `ExecCtx.onSandboxEvent`: opt-in surfaces whose platform contracts (session continuity, CRIU fork) are still being proven.

Newly tagged `@experimental` (previously untagged, unfinished):

- `src/agent/define-agent.ts` — manifests validate and load, but `runtime.act` is not wired end-to-end into the eval path (`unimplementedAgentRun` is the shipped default).
- `src/runtime/strategy-evolution.ts` — the multi-generation strategy search, a research surface.
- the `/candidate-execution` subpath barrel.
- the supervisor restart-recovery and event-bus durability members listed under "kept" above, now tagged explicitly at the symbol level.

Maturity now renders in the generated reference: `tsdoc.json` extends TypeDoc's base tag definitions, and each subpath barrel carries `@module`, so `docs/api/<subpath>.md` shows the module-level `Stable` / `Experimental` badge directly under the page title. Module-level tags previously rendered nowhere in `docs/api`.

## 0.129.0

- Require Agent Eval 0.144.4, Agent Interface 0.43.1, Agent Knowledge 7.0.11, and Sandbox 0.19.1 as one dependency set, and route the official-optimizer callback through Runtime's exact `AgentProfile` execution path.
- Reject model, provider, reasoning, prompt, tool, resource, harness, and generation-setting conflicts before transport; consumers must declare those fields in the profile.
- Require `defineLeaderboard` callers to supply an exact `baseProfile`; remove its `modelBackend` override so each matrix cell's profile remains the only model authority.
- Require generic coder, researcher, and supervised-knowledge paths to receive complete profiles; remove harness/model overlays and MCP environment alias ladders.
- Resolve Sandbox execution only from `AgentProfile.harness`; a backend type may confirm that choice but cannot replace it.
- Parse, detach, and deeply freeze a complete `AgentProfile` before Scope, registry, nested-driver, or personified execution can honor any built-in or caller-supplied executor.
- Require `driverChild(profile, ...)` and `worktreeLoopRunner({ rootProfile, ... })`; remove name-only driver and personified-root shortcuts.
- Remove the public `runLocalHarness` process shortcut; use `createWorktreeCliExecutor({ profile, ... })` directly or `createExecutor({ backend: 'cli-worktree', ... })` inside a supervised run so the CLI and model derive from one exact `AgentProfile`.
- Keep missing token usage and billed cost unknown, and report reasoning-token usage when the provider supplies it.

### Removed public execution shortcuts

- Remove `driverLoopGenerator`, `DriverLoopGeneratorOptions`, `buildDriverSystem`, and `researchDriverNote`; use `improve({ surface: 'code', code: { profile, executorForWorktree, buildPrompt } })` or `agenticGenerator` so every authoring call uses the exact declared profile through Runtime.
- Remove `AGENTIC_PROFILE_RESOURCE_ROOT`; profile resources now travel inside the exact `AgentProfile` and Runtime materializes them at execution.
- Remove `AgentBackendKind`, `ResolveAgentBackendOptions`, `resolveAgentBackend`, `createOpenAICompatibleBackend`, and `BackendRetryPolicy`; select a built-in transport with `ExecutorConfig` and `createExecutor(...)`, bind it to an exact profile with `createProfileExecutionBackend(...)` for `runAgentTaskStream` or conversation APIs, or pass both directly to `streamAgentTurn`.
- Move retry configuration into `AgentProfile.model.metadata.retry`, including attempt count, per-attempt timeout, retryable status codes, exponential-backoff bounds, and jitter, so deleting the parallel backend API does not delete caller control.
- Remove the public Router chat and tool-loop API (`RouterConfig`, `RouterChatResult`, `RouterChatToolsResult`, `RouterToolCall`, `RouterToolLoopResult`, `routerChatWithUsage`, `routerChatWithTools`, `streamRouterChatWithTools`, `routerToolLoop`, and `routerBrain`); use `createExecutor(...)` plus `streamAgentTurn` and `collectAgentTurn`, use `ToolLoopToolCall` for the provider-neutral tool-call record, use `profileChatClient` for Eval integrations, or use `supervise(...)` for a profiled supervisor.
- Replace `ShotPersona` with `ShotSpec.profile`, which carries a complete exact profile instead of a prompt/model-only override.
- Remove `canonicalizeAuthoredProfile`; inputs must already satisfy `agentProfileSchema`, with no flat legacy spelling that Runtime silently repairs.
- Remove `authoredWorker`; use `workerFromBackend(...)`, which admits each complete profile through the same executor path as every other supervised worker.
- Remove the public `chatCompletionsTransport` constructor; inject an offline completion function through `ChatTransportExecutorOptions.complete`, or use an exact profile with `createExecutor(...)` for real execution.
- Remove `createPrimeIntellectBackend`; use `primeIntellectExecutorConfig(context)` with `createExecutor(...)`, then execute an exact profile through `streamAgentTurn` or bind it with `createProfileExecutionBackend(...)` when an `AgentExecutionBackend` is required.
- Remove `uiAuditorProfile`, `createInProcessUiAuditClient`, and their browser/judge option types; author a normal `AgentProfile`, execute it through Runtime, and keep using `UiAuditTask`, `encodeAuditTaskEnvelope`, `formatAuditorPrompt`, `parseAuditorEvents`, and `createUiAuditorValidator` from `/profiles`.
- Remove the bundled UI-audit example and the Playwright peer dependency because browser placement belongs to the caller-owned execution environment, not a profile-specific Runtime client.
- Remove direct model injection from `SuperviseOptions`, `RunGraphOptions`, and `SupervisorAgentDeps`, and remove `driverAgent`, `DriverAgentOptions`, and `ToolLoopChat` from `/kernel`; production supervisor calls now derive model execution only from the exact root `AgentProfile`, while deterministic scripted calls live under the explicit `/testing` entrypoint.
- Bind every root Router turn to one Runtime-authored cancellation signal, call id, and correlation id; preserve provider-observed model, prompt-cache, retry-attempt, reasoning-token, and billed-cost evidence; meter a mismatched model response before refusing its output; and reuse one nonempty idempotency key across all physical retries of the logical call.

## 0.128.0

### chat-transport executor: workers on a bare chat-completions transport

A first-class `Executor` whose runtime is a plain OpenAI-compatible `/v1/chat/completions` transport — the worker IS a model conversation, not a sandboxed process (#721).
What every offline test faked through `AgentSpec.executor` is now a shipped, supported leaf: node pinning, conserved spend, settle/verdict, and the journal + edge ledger all apply to a chat worker.

New kernel exports (`src/runtime/supervise/chat-transport-executor.ts`):

- `chatTransportExecutor(options): Executor<string>` — one `execute` is one conversation SHOT: seed (fresh system prompt, or a resumed session's recorded history) + the task as the next user message, then completion → host tool calls → tool messages until the model answers without a tool call (or `maxTurnsPerShot`, default 200). Settles with the final assistant text as `out`. NON-streaming by design: the streaming `UsageEvent` channel cannot mark an unmetered turn (`tokens` has no `tokensKnown: false` twin — the documented limitation in `supervise/types`), while the one-shot `Spend` carries both honesty markers.
- Metering honesty: tokens from the transport's `usage` fields (`tokensKnown: false` when a turn omits them); dollars ONLY from the response's own cost fields (`usage.cost` / `usage.cost_usd` — `usdKnown: false` when absent). Never estimated from a local price table: this executor speaks to arbitrary endpoints whose models no local table can price.
- Fail-loud: transport failures (non-2xx, network faults, malformed completions) throw `ValidationError` — the scope's INFRA settle class — never a fake success. The turns that DID run are still recorded first, because resume-after-failure is a kernel-supported path.
- `ChatTransportTool` — the optional tool table: the OpenAI function spec the model sees plus the host-side `execute`; unknown tools and malformed arguments are fed back to the model as tool messages, never thrown.
- `chatCompletionsTransport({ url, bearer })` — the one buffered wire function (also the executor's default transport), exported so a paired harness can drive two arms through the SAME instance; `ChatTransportExecutorOptions.complete` injects a scripted transport for fully-offline runs (mirrors `RouterConfig.complete`).
- **Session continuity** — the executor is the resume consumer the kernel's `continuity: 'resume'` contract calls for: `createChatSessionStore()` keeps conversation histories keyed by settled worker id, `resume: WorkerResumeContext` continues `ofWorker`'s exact recorded message list (fails loud before any spend when the store has none — the same process-local resume boundary the kernel documents), and the finished conversation is recorded under `sessionKey` for the next resume.
- `chatWorkerSeam(options): MakeWorkerAgent` — the session-owning worker seam `workerFromBackend` refuses to be: profile model/prompt (including a graph's appended delegates directive) drive each spawn, `WorkerSpawnContext.resume` re-attaches through the seam's store keyed by kernel node ids, and an optional `deliverable` gates each settle through the existing `gateOnDeliverable` (settled ⟺ delivered).

New example + proof: `examples/graphs/user-sim-conversation.ts` — a CONVERSATION as a graph: a simulated user is a NODE (persona profile as the root), the product agent is a chat-transport worker, each dialogue turn is one ledgered `delegates` traversal with `continuity: 'resume'`, and the offline test (`tests/examples/user-sim-conversation.test.ts`) asserts the resumed message-history chain on the requests CAPTURED at the wire (turn k = turn k−1's whole message list + the prior assistant reply + the new user turn), the `fresh`/`resume`/`resume` ledger stamps, the executor-seam lineage, and the metered spend in the one conserved pool.

P1 parity live path fixed (the three audited #710 gaps, `examples/p1-parity`):

- Both arms' coders now share ONE substrate: the multishot arm's transport and the graph arm's `chatTransportExecutor` speak the same bare chat-completions endpoint with the same wire model, and the parity delegates edge declares `continuity: 'resume'` so the graph arm's shots continue one session exactly as `runMultishot`'s single transcript does. As previously wired the graph arm spawned a full cli-bridge harness worker against the multishot arm's bare chat calls — a substrate gap that invalidated any live parity number.
- The live graph arm now HAS a driver: the `'chat'` graph backend requires the reviewer brain's `RouterConfig` (previously the live arm shipped with neither `brain` nor `router` and could not run).
- No silent model fallback anywhere: the coder model rides its profile, the driver model is explicit per-arm substrate config (`MultishotArmBackend.driverModel` / `RouterConfig.model`), and the live entry requires `VB_CLI_BRIDGE_URL`, `VB_CLI_BRIDGE_BEARER`, `VB_PARITY_MODEL`, `VB_PARITY_ROUTER_URL`, `VB_PARITY_ROUTER_KEY`, `VB_PARITY_DRIVER_MODEL` — a missing variable fails loud; `'parity/unspecified'` is gone.

## 0.127.0

### Continuity is a first-class axis of delegates traversals

Fresh respawns, session RESUMES, and live steers are now all expressible as plain data, each a ledgered fact.

A `delegates` edge may declare `continuity: 'fresh' | 'resume'` — the default mode for that edge's spawn traversals (`'fresh'` is today's behavior; an edge without the field behaves byte-identically).
With `'resume'`, every spawn after the node's first re-attaches to the node's most recent SETTLED worker: the kernel spawns a NEW live worker bound to the SAME node whose spawn context carries `resume: { ofWorker, sequence }` (`WorkerSpawnContext.resume`, typed `WorkerResumeContext`), and the executor seam (`makeWorkerAgent`) owns the actual session re-attachment — e.g. mapping `ofWorker` to a backend session id.
The kernel keeps identity, ordering, ledger truth, and spend continuity: the resumed worker reserves from the same conserved pool, the ledger row's `workerId` is the NEW live worker, and the lineage rides the spawn context and the journal.
Traversal caps count resumes exactly like fresh spawns.

`spawn_agent` accepts a per-call `continuity` override that wins over the edge default in either direction, and resume fails closed with an actionable error at the tool:

- `resume-no-prior` — an explicit resume of a node with no settled prior worker (spawn it fresh first; the DECLARED edge default instead degrades to `'fresh'` on the node's first spawn).
- `resume-while-live` — a prior worker of the node is still live; steer is the live-worker channel, and the error says so.
- `resume-with-key` — a semantic key makes an assignment run-once; resume explicitly runs the node again.

`EdgeTraversal` and the journal `edge` event gain `continuity: 'fresh' | 'resume' | 'steer'` — spawn traversals stamp their effective mode, and every mid-run delivery into an already-live recipient (a driver steer leg, every analyzes delivery) stamps `'steer'` — zero ambiguity in the ledger about how each hop continued.
`validateGraph` refuses nonsense continuity values and analyzes edges carrying the field (analysts are spawned by the analyst machinery; every analyst run is a fresh session over settled evidence).

Threading: `SuperviseOptions` / `SupervisorAgentDeps` / `DriverAgentOptions` / `serveCoordinationMcp` / `CoordinationToolsOptions` gain `continuityByProfile?: Readonly<Record<string, ContinuityMode>>` (the per-profile-name default `runGraph` derives from delegates edges), and the kernel entry exports `ContinuityMode`, `WorkerResumeContext`, and `TraversalContinuity`.
Known limit, stated where it lives: resume lineage is PROCESS-LOCAL (the same boundary as the analyst-run marker) — workers settled by a prior process of a durable run are not resume targets. The built-in backend seam (`workerFromBackend`) cannot re-attach sessions and FAILS LOUD on a `'resume'` spawn rather than ledgering a resume that never happened; session-resuming `makeWorkerAgent` seams are the resume consumers. Resume after a FAILED prior worker is deliberately allowed — a crashed session may still be resumable, and the executor seam decides.

New example: `examples/graphs/shot-loop-resumed.ts` — the VB shot shape as data (reviewer root, coder node, `continuity: 'resume'`, `maxTraversals: 3`): shot 1 spawns `fresh`, shots 2–3 resume the prior settled session, proven offline in `tests/examples/graph-topologies.test.ts`.

### Python bridge install hints match the required Eval substrate

The documented `agent-eval-rpc` install commands — the `OfficialOptimizerUnavailableError` hint, the README's `officialGepa`/`officialSkillOpt` sections, and the bench GEPA seat hint — now pin `0.143.0`, the Python client published in lockstep with the `@tangle-network/agent-eval` range this package requires.
The previous hints pinned `0.131.0`/`0.133.0`, so following them installed a bridge older than the wire protocol the installed Eval package speaks.

## 0.126.0

### Runtime, Eval, and Knowledge use one truthful cost contract

- Runtime now requires `@tangle-network/agent-eval` `>=0.143.0 <0.144.0` and ships with `@tangle-network/agent-knowledge` `7.0.8`, so the installed stack records observed, estimated, and uncaptured campaign cost without a nested older Eval copy.
- Campaign caches written before Eval 0.143.0 without complete cost provenance stop default reuse.
  Callers may explicitly rerun only invalid cached cells or rerun the full campaign; Runtime does not guess that missing cost is zero.

### Steering policy is registry data; the loop-kernel steering-driver module is deleted

BREAKING. `src/runtime/steering-drivers.ts` is deleted, and with it the kernel exports `steeringDriver`, `naiveDriver`, `dumbDriver`, `SteeringDirectiveData`, `SteeringDecision`, `ApplyContinuation`, `NaiveDriverOptions`, and `DumbDriverOptions`.
The steering POLICY texts stay where the graph reads them — registry data (`delegates/naive-continuation`, `delegates/dumb-continuation-pass` / `-fail` in the kernel prompt registry) a `delegates` edge attaches as versioned directives — so the naive/dumb control policies remain optimizable data rows; only the loop-kernel interpreter function is gone.
`defineLeaderboard`'s per-cell retry — the module's one consumer — is now `naiveRetryDriver` in `define-leaderboard.ts` with identical observable behavior: the same `'naive'` trace name, the same plan/decide semantics (re-run the same case verbatim until a shot is `valid` or the shot cap; `pick-winner` on any valid shot, else `refine` under the cap, `fail` at it), and the same leak-free firewall (reads only `verdict.valid`, never `notes`/`scores`).

Callers to update: anything importing `steeringDriver` / `naiveDriver` / `dumbDriver` from the kernel entry writes the equivalent bare `Driver` literal at its call site (plan: re-issue the task with the continuation folded in until valid or cap; decide: `pick-winner` on any valid shot, else `refine` under the cap, `fail` at it), carrying its continuation texts as its own data or as prompt-registry entries.

### The analyst can be a tool-equipped agent, and graphs watch their workers

An `analyzes` edge may now name a graph NODE as its analyst (`analyst: '<node-id>'`).
On each matching settle, `runGraph` spawns that node's pinned profile as a real WORKER through the same spawn machinery every worker uses (`Scope.spawn` + the `makeWorkerAgent` seam): its task is the edge's registry directive plus the settled worker's tool-trace evidence, its spend reserves from the graph's one conserved budget, its node is journaled and traced like any worker, and its settle OUTPUT is the findings — published and routed per `to` exactly like registry-analyst findings, with the same ledger rows and canonicalization.
Oracle doctrine holds structurally: an analyst node with a delegates edge pointing at it is refused, the driver cannot spawn it (`spawn_agent` still rejects non-worker nodes), an id living in both the registry and the nodes is refused as ambiguous, and an analyzes edge OVER an analyst node is refused because it would silently never fire.

- `AnalyzeOnSettleRoute` gains `agent?: AgentProfile` — the coordination-layer form of the node analyst, usable by direct `supervise()` callers; lens routes still require the `analysts` registry, agent routes do not.
- `WorkerSpawnContext` gains `analyst?: string`, the runtime-authored marker a node-pinning `makeWorkerAgent` reads to admit an analyst run it would refuse as a driver-authored spawn.
- An analyst run's settlement never enters the settled-worker ledger or the finalizer and never re-fires the analyst hook, so an analyst cannot cascade onto itself; a refused analyst spawn publishes `{ analystSpawnRefused }` and a failed run `{ analystRunFailed }` as findings — observable, never silent.

`RunGraphOptions` gains `watchWorkers` (mirroring `SuperviseOptions.watchWorkers`): the online detector panel now runs under `runGraph` with no leaf-seam wiring, raising `finding` events on the coordination bus the moment a live worker loops or error-storms.
`examples/graphs/watchdog-steer.ts` now uses the passthrough, and the new `examples/graphs/analyst-agent-review.ts` shows a tool-equipped reviewer node analyzing an implementer.
The kernel entry additionally exports the `WorkerWatchOptions` type.

Known limit: durable-run resume does not yet compose with analyst-node graphs — an analyst spawned by a prior process settles as an ordinary worker on resume (documented at the in-flight map in `coordination.ts`).

## 0.123.0

### Current shared contracts and honest CLI accounting

- Runtime now develops and publishes against Agent Eval 0.142.2, Agent Interface 0.43.0, Agent Knowledge 7.0.7, the profile materializer 0.10.2, and Sandbox 0.17.2.
- Runtime requires Agent Interface 0.43.x so every package in this release set uses the same profile contract.
- Runtime passes the canonical Agent Interface profile directly through Sandbox now that both packages share the same contract.
- A CLI worker that reports no usage now leaves token and dollar cost unknown instead of recording a measured zero.
- The 0.122.0 agent-graph API, which reached `main` without a published tag, ships in this release.

## 0.122.0

### Agent graphs: loops as data, edges you can audit

`runGraph` (new, `src/runtime/supervise/graph.ts`) runs a typed agent graph — nodes are AgentProfiles, edges are `delegates`/`analyzes` data rows — by composing `supervise()`; there is no second scheduler.
Every traversal lands in an EDGE LEDGER (`delivered | stripped | empty | unpropagated`, with byte counts) on the result and as `edge` events in the run journal, so a directive that never reached its target is an artifact, not a mystery.
Node pinning means a driver cannot smuggle capabilities into a worker it did not define; termination is enforced by a conserved budget plus a mandatory deliverable; delegates caps fail loud via `GraphEdgeCapError` while analyzes caps stay observability-only.
Edge directives resolve through a new versioned prompt registry (`prompts/<surface>/v<n>`, immutable versions, no silent fallback), making every edge a prompt-optimization target.

Consumer-visible changes that pay for this version:

- New dependency `@tangle-network/agent-trace-contract` — `deriveHexId` is now the only trace-id derivation in OTLP export (replaces the internal `padTraceId`).
- Trace propagation reads W3C `TRACEPARENT` first and dual-writes the legacy `TRACE_ID`/`PARENT_SPAN_ID` pair during migration.
- `finding` coordination events are producer-canonicalized to finite RFC 8785 JSON (nested `undefined` stripped; a non-serializable payload becomes a record of that fact), so a digesting subscriber can never make an event vanish.

## 0.121.0

- `pnpm run check:version-bump` (new, in the `ci` job) fails any change that alters a consumer-visible package surface without raising that package's version. Compared: every field npm copies into the published manifest — `exports`, `files`, `bin`, `directories`, `engines`, `typesVersions`, `dependencies`, `peerDependencies`, install-lifecycle `scripts`, `private` — plus the `pnpm-workspace.yaml` catalog pins those resolve through. A `catalog:` specifier is compared by what it RESOLVES to, because a byte-identical `"catalog:"` hiding a moved version is exactly how 0.119.0 shipped its peer range twice. Packages are keyed by name, not path, so relocating one still compares against what that name already published.

### Runtime accepts the current Sandbox release

`@tangle-network/sandbox@0.16.0` was published after Runtime 0.120.0 with execution-bound session controls, but Runtime's peer range still ended below 0.16.0.
An installation that explicitly selected every latest package therefore failed with `ERESOLVE` before application code could run.

Runtime now requires Sandbox `>=0.16.0 <0.17.0`, and its development cohort tests against 0.16.0.
The narrow profile type adapter remains necessary because Sandbox 0.16.0 is compiled against Interface 0.38.0 while Runtime is compiled against Interface 0.40.0; the profile crosses that adapter unchanged as data.

## 0.120.0

### The runtime's own supervision journal is readable again

`src/durable/spawn-journal.ts` writes each supervision event wrapped in an envelope — `{kind:'event', root, event}`. Through agent-eval 0.140.0 `parseSupervisorTree` only understood the flat dialect, so it read `kind` as the literal string `event`, matched no tree event kind, and reported **zero spawns for every journal this package produces**. agent-eval 0.140.1 adds `readJournalRow`, which unwraps that envelope and tags the dialect `runtime-envelope`.

The fix therefore lives in agent-eval, but a consumer only receives it if this package's peer range admits it. The peer floor moves accordingly:

| Peer | 0.119.0 as published | 0.120.0 |
|---|---|---|
| `@tangle-network/agent-eval` | `>=0.139.2 <0.140.0` | `>=0.140.1 <0.141.0` |

`@tangle-network/agent-knowledge` moves `7.0.3` -> `7.0.4` in the same cohort because `scripts/verify-packed-cohort.mjs` asserts that knowledge's own agent-eval dependency EXACTLY equals the packed agent-eval version; `7.0.3` pins `0.139.2` and `7.0.4` pins `0.140.1`.

**Why this needed its own version.** The cohort move landed on main in #697 without a version bump, so main declared `0.119.0` — a version already on the registry carrying the OLD `>=0.139.2 <0.140.0` range. The publish workflow skips a version the registry already has, so re-tagging cannot correct it and the fix could not reach any consumer until this bump.

### Release checks no longer race the clock

- Three release checks no longer infer concurrency or process readiness from sub-second wall-clock sleeps; they wait for the event under test or allow their real container/process boundary to start.
- Candidate cleanup timeout coverage now advances a fake clock and observes the abort signal, while the Git-heavy knowledge activation checks use a process-boundary timeout that survives parallel CI load.

## 0.119.0

### No harness is special: eleven name branches become table rows

BREAKING. `LocalHarness` was a private three-member vocabulary (`'claude' | 'codex' | 'opencode'`) that spelled one harness differently from every other layer in the stack. It is now a narrowing of the shared `HarnessType`: **`'claude'` is renamed to `'claude-code'`**. `claude` remains the EXECUTABLE name and lives only in the harness table's `command` field.

Callers to update: `runLocalHarness({ harness })`, `harnessInvocation(harness, …)`, `runWorktreeHarness({ harness })`, `agenticGenerator({ harness })`, `createInProcessExecutor({ harnesses })`, `AuthoredHarness.harness`, and the `AGENT_RUNTIME_LOCAL_HARNESSES` env list. Anything that passed `'claude'` passes `'claude-code'`; `codex` and `opencode` are unchanged.

Deleting the alias removed `materializerHarness()` outright — a `LocalHarness` is now handed straight to the profile materializer with no translation.

**Reasoning effort now reaches claude-code and opencode.** `runWorktreeHarness` used to hard-REFUSE any profile carrying `model.reasoningEffort` unless the harness was codex, and `harnessInvocation` silently dropped it. Both read one capability table now:

- `claude-code` → `--effort <low|medium|high|xhigh|max>`; canonical `ultracode` is native `max`.
- `opencode` → `--variant <variant>`; canonical `ultracode` is `max`.
- `codex` → `-c model_reasoning_effort="…"`, unchanged.

A level a harness genuinely cannot express is still refused, and the refusal now lands in the pre-flight admission check (before any worktree exists) because the guard and the argv builder read the same rows. claude-code refuses `none` and `minimal` (its `--effort` has no such level); opencode refuses `none` (thinking-off is the absence of the flag).

**Permission bypass is a property of the workspace, not of one CLI.** `dangerouslySkipPermissions` was tested against `'claude'` in four places; three were caller-side duplication of the fourth, which dropped the flag for every other harness with no error. Each harness now declares its own bypass argv:

- `claude-code` → `--dangerously-skip-permissions` (unchanged).
- `codex` → `--sandbox workspace-write -c approval_policy="never"`. NEW: a codex worker in a disposable worktree previously had its bypass request silently dropped. It edits non-interactively now and **keeps its OS sandbox** — writes stay confined to the workspace. `--dangerously-bypass-approvals-and-sandbox` is deliberately NOT used: `codex exec` has no approval gate to stall on (`-a/--ask-for-approval` exists only on the top-level `codex`), so it would surrender the sandbox for nothing, and the sandbox is what keeps a worker's blast radius equal to its worktree.
- `opencode` → nothing; `opencode run` has no approval gate.
- Reproducible Codex is unchanged: its controlled config already pins `approval_policy="never"` with the sandbox intact, so the blanket bypass flag is suppressed rather than layered on top. Reproducible argv is byte-identical to 0.118.0.

**Other name branches replaced by rows, with no behaviour change:**

- `projectCandidateSystemPrompt`'s four-arm `switch (plan.harness)` and its conflicting-argument guard are now one `HARNESS_SYSTEM_PROMPTS` row per harness (executable + projection + conflict predicate). The guard's fail-OPEN default for an unlisted harness is gone: no row means the projection is refused.
- `harness === 'cli-base'` was re-derived at three call sites; it is now `harnessRunsAgent` / `agentHarness` in `src/runtime/harness-role.ts`.
- New exports on `@tangle-network/agent-runtime/mcp`: `DEFAULT_LOCAL_HARNESS`, `LOCAL_HARNESSES`, `localHarnessExecutable`, `harnessSupportsReasoningEffort`.

Deliberately KEPT: the `codexReproducible && harness !== 'codex'` guards (a codex-specific public option asserting caller self-consistency, not behaviour varying by name), and every `ExecutorConfig.backend` switch (a discriminated-union tag naming the materialization contract, not a harness name). Both now say so at the site.

## 0.118.0

Never published: the version bump landed on main but no tag was ever cut, so the registry went 0.117.0 -> 0.119.0. Everything below ships in 0.119.0.

### pi runs through the bridge, like every other harness

BREAKING. The bespoke pi executor is gone. cli-bridge already routes pi generically — `matches(m) => m === 'pi' || m.startsWith('pi/')` — so a second pi-only code path was duplication. A pi worker is now `createExecutor({ backend: 'bridge', bridgeUrl, bridgeBearer, model: 'pi/<provider>/<model>' })`, the same call every other harness uses.

Removed public exports: `piExecutor`, `PI_RUNTIME`, `piSeamKey`, `PiSeam`, `PiExecutorOutput`, `preparePiMcp`, `piMcpAdapterAvailable`, `buildPiMcpServers`, `PI_MCP_ADAPTER`, `PI_MCP_ADAPTER_ENV`, `PI_MCP_CONFIG_FLAG`, `PiMcpMount`, `PiMcpMountOptions`, `PiMcpPreparation`, `PiMcpReceipt`. The `{ backend: 'pi' }` arm of `ExecutorConfig` is removed, and the executor registry no longer pre-registers a `'pi'` runtime.

What the bridge path does BETTER, and the old executor dropped outright:

- `profile.model.reasoningEffort` is lowered to pi's `--thinking`.
- `profile.tools` is lowered to `--exclude-tools`.
- `profile.resources` (context / skills / commands / subagents / instructions) is materialized into the run directory.
- `profile.prompt.systemPrompt` is passed as a native `--system-prompt` file instead of being prepended to the task text.
- Consequently a pi backend is now held to `fullProfileMaterialization` in `workerFromBackend`, not the prompt-and-model-only contract. A profile that changes axes the old executor silently dropped is now honored rather than rejected.

What the bridge path does NOT do today, stated so no consumer is surprised:

- `Executor.progress()` and `Executor.traceSource()` are absent on `bridgeExecutor`. This is missing for every harness on the bridge, not only pi; tracked as #683.
- Mid-turn steering degrades. The bridge runs pi as `--print --mode json` with stdin closed, so a steer lands after the current run rather than at the next turn boundary, and an interrupt is a process-tree kill rather than pi's non-destructive injection.
- `PiSeam.args`, `PiSeam.env`, and a per-worker `bin` have no wire equivalent. A caller that pinned a specific pi binary or injected per-worker environment must configure it on the bridge server instead.
- `WORKER_TRACE_PROPAGATION` loses its `pi: true` row. The bridge has no environment channel to the worker, so a pi worker no longer inherits `TRACE_ID`/`PARENT_SPAN_ID` — honestly unpropagated rather than silently dropped, same as the other bridge-dispatched arms.
- MCP for pi is now the bridge's concern. agent-runtime no longer writes a `--mcp-config` file or checks for the `pi-mcp-adapter` extension.

Known consumers to migrate, none broken until they upgrade:

- `loops` — `src/pi-worker.ts` and `extensions/pi/loops.ts`. The largest migration: `pi-worker.ts` builds the executor directly, and steering is the part that changes behaviour rather than just call shape. Pinned at 0.111.0.
- `supervisor-lab` — `bench/deepswe/live.ts:193`. A single `backend: 'pi'` in a benchmark rig; a call-shape change. Pinned at 0.116.0.
- `agent-eval-runtime-run-reader` — two test files reference the pi backend.

## 0.117.0

- Run every supervisor, including the root, from one complete `AgentProfile`, preserve exact profile/task/candidate identity through recursive delegation, and reject execution paths that would silently drop profile fields.
- Expose node-scoped product tools, product authorization for exact spawns and continuations, awaited replay-safe coordination observation, structured worker traces, trace-derived failure guidance, and caller cancellation across the complete recursive run.
- Make durable run and assignment identity stable across restart while retaining exact materialization, accounting, delivery, and settlement evidence for each node.
- Add live root-manager steering, trusted post-authorization manager/leaf classification, per-assignment completion checks, a cold recursive forest reader, and public exact-profile candidate conversion helpers.

## 0.116.0

### A supervisor tree spans machines

- When span recording is on, a spawned worker's environment carries `TRACE_ID` and `PARENT_SPAN_ID` — the run's trace and the span of the node that spawned it — using the env-var convention `mcp/trace-propagation.ts` already ships and already reads. A worker on a remote sandbox emits spans that join its parent's trace, so one tree assembles across machines with no viewer change and no second propagation format.
- At depth the parent is the IMMEDIATE spawning driver's span, not the root's, so a deep tree nests correctly rather than flattening.
- A caller that sets its own `TRACE_ID`/`PARENT_SPAN_ID` wins; theirs is never overwritten.
- Off when recording is off: no stamping, no behavior change.
- `WORKER_TRACE_PROPAGATION` states which backend arms carry the context — `pi`, `cli`, and `sandbox` do; `router`, `router-tools`, `bridge`, `cli-worktree`, and `provider` have no environment channel to a worker and say so rather than dropping silently. It is `satisfies Record<ExecutorConfig['backend'], boolean>`, so a ninth arm cannot be added without classifying it.

## 0.115.1

### A failed reconcile no longer strands the child's reservation

- Every fail-loud path in `BudgetPool.reconcile` threw BEFORE `open.delete(ticket.id)`, so a child that overspent any channel left its whole reservation open — `assertNoOpenTickets` then failed the run at the join barrier, on the SUCCESS path. Reconcile now decides the violation, settles unconditionally in straight-line arithmetic that cannot throw, and raises last. The assertion is unchanged: it is what caught this.
- Over-spend paths now commit the ACTUAL spend and let `free` go honestly negative, keeping `total ≡ free + reserved + committed` exact, rather than stranding a reservation at its ceiling forever.
- A child that declares no `maxUsd` is no longer read as declaring a `$0` ceiling. `ReservationTicket.reserved.usdBudgeted` records whether a ceiling was actually declared; an undeclared child's real dollars are committed and debited from a capped root's balance — the same treatment `observe()` already gives driver inference — so the cap stays enforceable and admission still closes once it is crossed. The field is optional and reads as `true` when absent, so a hand-built ticket keeps the strict reading.
- `usdKnown`, `usdTainted`, and `tokensKnown` semantics are untouched, verified byte-identical against the previous release for every uncapped-root case.

## 0.115.0

### A supervisor tree is an OTLP trace

- `supervise({ otel })` records the whole recursion as OTLP spans: one span per node, opened at spawn and closed at settle, parented so arbitrary depth nests correctly, with driver inference as LLM child spans under whichever node metered it. Off unless `otel` is passed — a run that omits it allocates no recorder and is byte-identical to before.
- Built as a pure `RuntimeHooks` observer over events `scope.ts` already emits, through the existing `otel-export.ts`. No second exporter, no new event, no change to the journal or to `supervise`'s result. `makeNestedScopeSeam` already re-seeds hooks into nested scopes, so one observer sees the whole tree.
- The trace id derives deterministically from `runId`, so a RESUMED run rejoins its own trace instead of forking a new one; a caller may supply a 32-hex id to join an outer trace.
- Attributes reuse the vocabulary already in use (`openinference.span.kind`, `agent.name`, `inference.*`, `llm.token_count.*`), with supervisor-specific facts namespaced under `tangle.supervise.*`.
- **Unknown is never zero**: a spend carrying `tokensKnown: false` or `usdKnown: false` emits NO token or cost attribute and sets the corresponding `tangle.supervise.*_known` flag to false instead.
- Telemetry cannot fail the work: an exporter that throws, rejects, or is a hostile proxy leaves the run's result unchanged. A node still open at finish is closed as unsettled rather than dropped.
- `supervise` also gains a general `hooks` passthrough; it could not reach `SupervisorOpts.hooks` at all before.

### pi MCP tools register natively

- Servers written for pi carry `directTools: true`, registering their tools as native pi tools instead of leaving them behind the generic `mcp` tool. Without it an agent must connect to the server and describe each verb before calling one: a measured run spent 58 turns and 639,632 input tokens on that discovery before it could delegate once. The same fix is in cli-bridge's pi materializer, so both writers agree.

### Cached prompt tokens are priced as cached

- The router reports a `prompt_cache` block (`read_tokens`, `write_tokens`, `read_savings_usd`) that this client discarded, so a cached prefix was billed at full local price. `PromptCacheUsage` now carries it and the reported saving is subtracted from the local estimate rather than a discount being re-derived here. A supervisor re-sends a growing transcript every turn, so this is most of a long run's real cost.
- Absent cache reporting stays absent — an unreported cache is not a miss, and a miss is not a zero saving.

## 0.114.0

Two changes found by running a real recursive pursuit rather than by reading code: the supervisor's brain could not stream, and the `pi` backend silently discarded almost every profile dimension it was handed.

### The router-brained supervisor can stream

- `RouterConfig.stream` opts a supervisor turn into SSE. `streamRouterChatWithTools` accumulates `delta.content`, `delta.reasoning_content`, and index-keyed `delta.tool_calls`, then returns the same `RouterChatToolsResult` the buffered call does. The buffered path is unchanged and remains the default.
- Why it matters: every supervisor turn was one buffered POST that had to complete in full before a byte came back, which is what an origin idle-timeout kills. Six live runs died that way.
- Usage accounting is preserved across both transports through one shared metering helper. A stream that ends with no usage chunk sets `usageUnknown`, so a broken `include_usage` contract is distinguishable from a brain that never reports usage — never a silent free turn.
- `stream: true` together with the buffered `complete` seam throws rather than quietly taking the buffered path.

### A driver turn is always metered

- **BREAKING (behavior):** the `if (res.usage || res.costUsd !== undefined)` guard is gone, so every driver turn reaches `scope.meter`. A turn that reported nothing is metered as an UNKNOWN turn (`tokensKnown: false`, following the existing `usdKnown` precedent) instead of being skipped as free. Under a root budget declaring `maxUsd`, an unknown-cost turn now fails the run loudly rather than accruing zero — a scripted or mock brain that reports no usage under a dollar cap will newly surface `driver-failed`.
- `BudgetReadout.tokensKnown` and `Scope.budget.tokensKnown` are optional additions: present and `false` once a settled turn reported no tokens, meaning `tokensLeft` is a ceiling rather than a measurement.
- Known limitations, documented in place at `coordination-driver.ts` and `types.ts`: a turn that THROWS is still unmetered, the compaction distiller's catch swallows one turn's cost, and `UsageEvent` has no tokens-unknown variant so a streaming executor cannot yet report one.

### The `pi` backend materializes MCP

- A profile's `mcp` servers now reach pi. pi ships no MCP of its own: support comes from the `pi-mcp-adapter` extension, so the executor writes a canonical `{mcpServers}` config and passes it with `--mcp-config`, and injects the adapter into the resolved extension load list when a profile declares MCP without naming it. The injection is reported on `progress().derived`, which survives a failed run.
- Fail closed: a profile declaring MCP when the adapter is not installed throws before pi is spawned, naming the adapter and where it was sought. Previously the run started tool-less and scored zero for the wrong reason — observed live, where a root spent 545,095 tokens over 54 turns hunting for a `spawn_agent` verb it had never been given.
- One config file per worker execution, written to the OS temp directory and removed on both the settle and error paths. Deriving it from the seam's `cwd` would have made two concurrent workers collide on one file, and would have left scratch state inside the workspace the worker operates on.
- A profile with no MCP is unchanged: no file, no flag, no injected extension.

## 0.113.1

### A router-brained supervisor can raise its completion ceiling

- `RouterConfig` gains `maxTokens`, forwarded by `routerBrain` to the tool-calling completion. It was previously unreachable: `routerBrain` passed only `temperature` and `toolChoice`, and `SuperviseOptions.router` takes a `RouterConfig`, so no caller could set it.
- Why it matters: a reasoning model spends the ceiling on hidden thinking BEFORE emitting a visible token. Observed twice in a row on a live run — the model spent 8,188 tokens on hidden reasoning, hit the provider ceiling, and returned no content, so the supervisor failed with a truncation error it had no way to prevent. A thinking model was effectively unusable as a router-brained supervisor.
- The tool-calling path still sends no `max_tokens` when the config names none, leaving the provider's own default in charge; this adds a knob rather than changing a default.

## 0.113.0

### A refused spawn says which kind of refusal it is

- `budget-exhausted` no longer covers two opposite conditions. A dollar request against a root that declares no `maxUsd` is refused as **`usd-unbudgeted`**: unsatisfiable at any amount, cleared only by giving the ROOT a dollar ceiling. A genuinely depleted balance keeps `budget-exhausted`, which a smaller request may still fit.
- `spawn_agent` returns an actionable `hint` alongside `usd-unbudgeted`, telling the driver that retrying smaller will fail identically.
- Found live: a root agent tried to spawn one child, read `budget-exhausted`, correctly ruled out the concurrency fence from `freeSlots: 2`, walked its child's `maxUsd` down to $0.01, failed identically every time, and spent 68,546 tokens ($0.061) before stopping to ask its caller for help. The rule was right and the diagnosis was impossible.
- **BREAKING:** `SpawnRejection` gains `'usd-unbudgeted'`, so an exhaustive `switch` over it must handle the new member. A caller that branched on `'budget-exhausted'` to detect this case must branch on `'usd-unbudgeted'` instead. `ReservationRejection` is exported for the pool's own two-member result.

## 0.112.0

The supervisor's public contract closes six gaps found by running a real recursive pursuit against the published stack. Four of the changes below are BREAKING for a consumer on 0.111.x; each names the migration.

### The root accepts a canonical AgentProfile

- `SupervisorProfile.model` accepts `string | AgentProfileModelHints`, and `SupervisorProfile` accepts a canonical `prompt` block. A caller passing an `AgentProfile` previously had its `model` object forwarded verbatim into `RouterConfig.model` (a string), producing a request the provider rejects, and its `prompt.systemPrompt` silently ignored.
- New exported `resolveSupervisorProfile(profile)` normalizes the two spellings with one documented precedence: a string `model` is the id, an object `model` resolves to `default`, and `prompt.systemPrompt` outranks the top-level spelling. Hints that name no id are the documented "profile names no model" case — the router config's model applies — because `AgentProfileModelHints.default` is optional upstream.
- `prompt.instructions` and `resources.instructions` are appended to the active prompt rather than dropped. A profile naming only instructions keeps the arm's standing prompt and appends to it.
- Two system prompts that are both set and differ throw, rather than one silently winning.
- **BREAKING (type, read position):** `SupervisorProfile.model` is no longer `string`. Consumer code that reads it back — including from the `DriveHarness` argument — must narrow, or call `resolveSupervisorProfile(profile).modelId`.
- **BREAKING (new throw):** a caller that previously passed a canonical profile and had its extra fields ignored may now throw on two disagreeing prompts, or on a `github` instructions ref that cannot be materialized while building a supervisor synchronously.

### `DriveHarness` receives the resolved prompt

- The harness argument object gains `systemPrompt?: string`. The profile is handed through by identity and never spread with an injected top-level key, so a canonical profile stays valid under `agentProfileSchema`.

### Code-valued run options can be named

- `deliverable`, `finalizer`, `analysts`, and `probes` each additionally accept a `string` name resolved against a new `SuperviseOptions.registry`, whose four tables are resolver ports (`{ resolve(name) }`) matching `WaitProbeRegistry` — so a recorded run configuration names what it wants and the caller binds the implementation, and a table with a thousand entries constructs nothing it does not use.
- An unknown name and a name with no table both throw `ConfigError` naming the option and the requested name.
- **BREAKING (type, read position):** these four option types are widened with `| string`; a wrapper that reads a field back off `SuperviseOptions` must narrow.

### The coordination server fails closed on a remote bind

- `SuperviseOptions.coordination` carries `{ host?, port?, allowUnauthenticatedRemote? }`, and the rule is enforced inside `serveCoordinationMcp` itself, not only at the composition sites: the verbs mount `spawn_agent`/`steer_agent`/`stop` with no authentication, so a non-loopback bind lets anyone who reaches the port spend the run's budget. A non-loopback host now requires an explicit `allowUnauthenticatedRemote: true`.
- A coordination binding on a router-brained supervisor throws: that arm serves no MCP, so the binding would be silently ignored.
- **BREAKING (new throw on a public export):** `serveCoordinationMcp({ …, host: '0.0.0.0' })` bound and listened on 0.111.0; it now throws `ConfigError` unless the exposure is acknowledged.

### `spawn_agent` publishes the child-profile shape

- The tool's `profile` parameter carries a JSON Schema derived from the canonical `agentProfileSchema` with a description on every published field, instead of one line of prose. A spawning root is told what a child profile looks like.
- The schema is computed on first tool-definition access rather than at module load, and a renamed upstream field degrades the published shape instead of throwing at import — a tool description must never brick `import '@tangle-network/agent-runtime/kernel'`.
- The published object is deep-frozen: one memoized schema is shared by every coordination toolbox in the process.

### The driver's error survives

- BEHAVIORAL CHANGE — `SupervisedResult`'s no-winner result gains a fourth reason, `driver-failed`, and splits into a discriminated union. A run whose driver `act()` rejected with no child ever having gone down and no breaker/abort/budget cause previously returned `reason: 'all-children-down'` with `downCount: 0`; it now returns `reason: 'driver-failed'` carrying a required `error: NoWinnerError` (`{ name, message, stack? }`, with a non-`Error` rejection normalized to `{ name: 'NonError', message }`). Two consequences for consumers: an exhaustive `switch` over `reason` no longer compiles until it handles `'driver-failed'`, and any code that keyed off `all-children-down` to detect a failed driver must key off `driver-failed` instead. The `all-children-down`, `aborted`, and `budget-exhausted` arms are unchanged and declare `error?: never` — a driver rejection outranked by one of those lifecycle causes is not carried on the result. Precedence is unchanged otherwise: breaker, abort, budget exhaustion, and a real `down` child all still outrank `driver-failed`.
- Export `NoWinnerError` from the runtime entrypoint (`./runtime`, alongside `SupervisedResult`) so a consumer handling `reason: 'driver-failed'` names the shape instead of retyping `{ name; message; stack? }`.

### Configuration faults throw `ConfigError`

- **BREAKING:** the registry and coordination-binding guards throw `ConfigError`, matching `assertModelAllowed`, rather than `ValidationError`. A caller catching `ValidationError` for configuration faults should catch `ConfigError`.

## 0.111.0

- Publish the supervisor-run persistence contract (`<root>/.agent/supervisor/<id>` — the one dot-dir for agent-owned state; pre-rename runs under `.loops/…` stay readable via `legacySupervisorRunDir`) that `traces analyze --supervisor-run-dir` reads: run-dir and inbox paths, steer records, and tolerant NDJSON reads.
- Add `copyUntrackedIntoClone` and `withUntrackedArtifacts` so worker clones carry the source working tree's untracked build artifacts without ever committing them back to the shared ref.
- Add `composeWorkerEvidence`, `settledWorkerOut`, and `closingWorkerNote` — the bounded settle-evidence composers for the exported `CompletionEvidence` discipline.
- Repair the publish cohort checkouts to the versions the catalog already demands (Interface 0.40.0, Eval 0.139.2, Knowledge 7.0.3); the v0.110.0 tag failed release verification on the stale pins and never reached npm.

## 0.110.0

- Align Runtime with the current published stack: agent-eval 0.138.0, agent-interface 0.40.0, agent-knowledge 7.0.0; peer ranges widen to eval `>=0.138.0 <0.139.0` and interface `>=0.40.0 <0.41.0`.
- Adopt interface 0.40 `AgentProfileConfigValue` for MCP server `args`/`env`: `resolveMcpServerLaunch` resolves public values and env secret-refs through the KeyProvider fail-closed (with `bearer` formatting), refuses secret-refs in argv, and rejects an env var declared secret on both the env and legacy metadata channels.
- Candidate profile freeze/thaw preserves config values instead of unwrapping them to schema-invalid strings; certified intelligence bindings wrap through `defineAgentProfilePublicConfig`.
- Implement eval 0.138's `TraceAnalysisStore` contract on the iterations store: real `hasTrace`/`hasSpans`, byte-ceiling span continuation (`omitted_span_ids`/`has_more`), and `total_matches` removed from search results.
- Sandbox 0.15.2 remains typed against interface 0.36; profiles cross that boundary as data through one commented adapter pair (`profileAsSandboxProfile`), to be removed when sandbox releases against 0.40.

## 0.109.2

- Align Runtime with Eval 0.135.2 and Knowledge 6.1.11 so every improvement path uses the corrected paired promotion decisions.

## 0.109.1

- Move `runToolLoop` and `streamToolLoop` to the Worker-safe `@tangle-network/agent-runtime/tool-loop` entrypoint.
- Keep the tool-loop bundle free of static external imports and exercise the exact packed entrypoint before publishing.

## 0.109.0

- Rename the public `./loops` entrypoint to `./kernel` and remove the old entrypoint.
- Export the kernel's main execution types from the package root for discovery without adding root runtime weight.
- Align Runtime with Eval 0.135.1 and Knowledge 6.1.10.

## 0.108.1

- Align Runtime with Eval 0.134.2 and Knowledge 6.1.8 so every knowledge and runtime evaluation uses complete multishot judge cost accounting.
- Retain both judge scores and cost records in the self-improving-loop example.
- Declare temporary TypeScript coding workspaces as ESM so their real tests run on Node 24.

## 0.108.0

- Add the edge-safe `@tangle-network/agent-runtime/durable` entrypoint for resumable chat turns with stable retry identities.
- Resume built-in supervised runs without repeating completed keyed work, while carrying prior settlements, questions, findings, wait deadlines, output trees, and spent budget into the new process.
- Add pluggable finalization with built-in best-output and collect-all modes, and prevent finalizers from reading outputs that did not pass completion checks.
- Require profile-improvement proposals to cite typed findings with explicit search or production origin.
- Serialize Git worktree metadata changes per repository while keeping candidate evaluation parallel.
- Align Runtime with Eval 0.134.1, Interface 0.36.0, Knowledge 6.1.7, Materialize 0.9.2, and Sandbox 0.15.2.

## 0.107.5

- Replace the invalid paired t-test in benchmark reports with `@tangle-network/agent-eval`'s cross-checked Wilcoxon signed-rank test.
- Report non-zero pairs, test method, attainable p-value floor, raw p-value, adjusted q-value, and explicit ties for every profile comparison.
- Align Runtime with `@tangle-network/agent-eval` 0.133.3 and `@tangle-network/agent-knowledge` 6.1.5, and derive packaged comparison sizes from Eval's minimum.

## 0.107.4

- Pack `@tangle-network/agent-interface` from its exact source commit alongside Eval, Knowledge, and Runtime before merge and publish.
- Align Runtime with `@tangle-network/agent-eval` 0.133.2 and `@tangle-network/agent-knowledge` 6.1.4.
- Resolve local archive overrides at the pnpm workspace root for nested packages.

## 0.107.3

- Add public proposal and private activation fixtures for profile-improvement consumer tests.
- Verify the exact Eval, Knowledge, and Runtime package archives together before merge and publish.
- Align the tested package cohort with `@tangle-network/agent-eval` 0.133.1, `@tangle-network/agent-knowledge` 6.1.3, and `@tangle-network/sandbox` 0.15.1.

## 0.107.2

- Align Runtime's tested Sandbox dependency and public peer contract with `@tangle-network/sandbox` 0.15.0.

## 0.107.1

- Add a budget-bound profile improvement cycle that turns trace findings into exact, reviewable profile proposals.
- Preserve one shared cost budget and the final-test split through analysis, optimization, measurement, review, and activation.
- Align Runtime with `@tangle-network/agent-eval` 0.133.0, `@tangle-network/agent-interface` 0.36.0, and `@tangle-network/agent-knowledge` 6.1.2.
- Check the packed `proposeAgentProfileImprovement` export so the public entrypoint cannot disappear silently.

## 0.106.0

- Align Runtime with `@tangle-network/agent-eval` 0.131.0, `@tangle-network/agent-interface` 0.35.0, `@tangle-network/agent-knowledge` 6.1.1, `@tangle-network/agent-profile-materialize` 0.9.0, and `@tangle-network/sandbox` 0.14.0.
- Require maintained Node 22.13 or newer, use pnpm 11.17.0, and use the newest TypeScript supported by TypeDoc.
- Require the matching Runtime peer ranges so incompatible consumers fail installation instead of mixing profile contracts.
- Record the exact tool-step count in candidate receipts and validate optimizer evidence on both candidate and profile comparisons.
- Reject secret values hidden in Sandbox passthrough options and rank measured cost ahead of unknown cost when quality ties.
- Remove `reportLoopUsage`; campaign integrations must use `loopDispatch` or `loopCampaignDispatch` so Eval admits paid work before execution and records its receipt.

## 0.105.0

- Add `officialGepa(...)` and `officialSkillOpt(...)` as Runtime adapters over the upstream GEPA and Microsoft SkillOpt implementations in `@tangle-network/agent-eval`.
- Require one complete `OptimizationMethod` for profile improvement and keep final-test scenarios outside optimizer input.
- Authorize every exact execution-capable profile candidate before it reaches an agent.
- Preserve resumed optimizer spend, model identity, package provenance, and separate optimization versus final-test costs in activation receipts.
- Verify released Python packages, pinned source revisions, resume behavior, concurrency, and packed external installs in CI.
- Keep code improvement on Runtime-owned isolated Git worktrees.
- Remove the retired local prompt, profile-diff, campaign OTLP, and record-only optimizer paths.
- Require `@tangle-network/agent-eval` 0.126.x.

## 0.104.0

- Add the Tangle Sandbox exact-process environment provider for verified candidate execution.

## 0.103.1

- Declare and test compatibility with `@tangle-network/agent-eval` 0.125.x; runtime behavior is unchanged.
