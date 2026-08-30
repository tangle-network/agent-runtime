> **Track:** Architecture (research) | **Role:** failure record | **Status:** active guardrail

# Failure 20260608-041142: Loop Facade Ahead Of The Substrate

Date: 2026-06-08
Severity: High - public API drift risk
Detection: four blind audits plus branch diff review on PR #194

## What Happened

The branch added a `defineLoop` authoring surface with its own artifacts,
messages, questions, trace slices, analysts, verifier, judge, control plane, docs,
example, and tests. The code mostly retyped existing substrate concepts:

- `Scope.spawn`, `Scope.next`, and `Scope.send`
- MCP coordination tools
- spawn journal and topology views
- `Validator` / `DefaultVerdict`
- runtime hooks and trace export
- git-backed workspace state

The facade did not prove the hard join: real substrate worker -> trace/state ->
observer finding -> corrective steer.

## Root Cause

The design optimized for a clean authoring grammar before proving that the
runtime join needed a new grammar. That inverted the correct order:

1. Prove the smallest real loop on the substrate.
2. Identify the irreducible repeated boilerplate.
3. Add only the facade that removes that boilerplate.

The facade happened before step 1, so it grew protocol code that could be tested
against fakes while remaining weakly connected to the real execution substrate.

## Fix

Commit `ab2823d` deleted the facade exports, docs, example, and tests:

- `src/runtime/define-loop.ts`
- `src/runtime/loop-types.ts`
- `src/runtime/loop-trace.ts`
- `docs/loop-authoring.md`
- `examples/define-loop/`
- `tests/loops/define-loop.test.ts`

The remaining loop story is substrate-first:

- fixed shapes: `fanout`, `pipeline`, `loopUntil`, `panel`
- sandbox loops: `runLoop`
- recursive dynamic trees: `Scope` + Supervisor
- sandbox driver binding: `createCoordinationTools`
- durable workspace: `gitWorkspace` over a `Shell`
- trace feedback: `observe`

The local demo that previously stood here (`bench/src/observe-steer-workspace-loop.mts`)
was removed in the deep-clean: it walked a real Supervisor/Scope through the
coordination MCP verbs (`run_analyst` → `observe()`, `steer_agent` → `Scope.send`,
fix-worker, fresh-clone test) but with MOCK executors, so it was a shape demo, not a
proof. The valid join proof is the live one over real endpoints (`openSandboxRun`
workers + a remote branch a sandbox clones and pushes).

## Prevention Rule

No new loop facade lands until a tiny executable proof shows the exact substrate
join the facade claims to simplify. The local proof for this thread is:

```txt
Scope.spawn -> coordination MCP -> gitWorkspace -> observe() finding -> Scope.send steer
```

The cloud proof still must add `openSandboxRun worker -> remote git branch`.

A proposed API fails review if it primarily renames existing substrate concepts
or needs fake agents to demonstrate its value. The accepted API is the smallest
wrapper over proven joins, not the nicest grammar imagined ahead of them.

## Recurrence 20260704: it happened again (`loop-executor.ts`)

On 2026-07-04 the same anti-pattern was rebuilt from scratch as
`src/runtime/supervise/loop-executor.ts` — a spawnable `role:'loop'` atom
(`defineLoop`/`loopChild`/`agents`) plus an `authorLoop` "codemode" seam and a
release (0.88.0). It hit **every** failure signature in this record:

- It renamed existing substrate concepts — the `agents` chain is a `for` loop over
  `Scope.spawn`/`Scope.next`; `loopUntil`/`fanout`/`pipeline` already cover "loop
  until a check passes".
- Its only demonstration used **fake, scripted agents** (a hardcoded proposer +
  verifier). No live-substrate join was ever shown. That alone should have failed
  review under the rule above.
- The physim use it claimed to unlock — verifying a subsystem's BOM — **already
  existed** as the deterministic delivery gate (`physimSubsystemDeliverable`).

Removed in 0.89.0 (`defineLoop`/`loopChild`/`agents`, `withLoop`, `authorLoop`, the
loop-atom docs + skill sections). The substrate-first loop story in the Fix section
above is unchanged and remains the answer.

**Why it recurred:** this guardrail lives in `docs/research/`, which was not read
before building. The prevention rule is sound; its DISCOVERABILITY was the gap.
Loop/orchestration primitives are governed by the `canonical-api.md` §2 decision
table — that table now points here, and any "new loop primitive" idea must clear
this record's executable-proof-with-real-agents bar before a line is written.

## Audit 20260816: the entries are four families, not one duplicated grammar

Issue #874 carried the opposite reading of this record.
It counted ten symbols on the published surface, called five of them "loop entries" and four of them rival graph runtimes, and ruled that consolidation should leave two.
The audit measured the surface instead of the symbol names, and the ruling did not survive it.

Two of the five named entries were not public when the ledger listed them.

`runLoop` had already been consolidated, which is the outcome the ledger asked for.
It was a deprecated alias for `runAgentRounds`, renamed in #614 and deleted with the other superseded loop aliases in #720, which shipped in 0.127.0 on 2026-08-03.
`runAgentRounds` is the surviving entry and is still public on `/kernel`.
The 0.135.2 the ledger measured carries zero occurrences of `runLoop` in its `dist` types.

`routerToolLoop` is a `src/runtime/router-client.ts` internal that no barrel exports; the three hits in `dist` are prose inside doc comments.

Both counts came from grepping mentions in `.d.ts` text rather than reading the export lists.
The ledger's own figures show it: the counts it published for `loopDispatch`, `loopCampaignDispatch`, and `routerToolLoop` match the mention totals for those names exactly, and a name with no mentions left carried no count at all.

The remaining eight are four families with different reasons to exist:

| Entry | Family | What it is |
|---|---|---|
| `loopUntil` | combinator | one step child per round until the stop gate passes |
| `pipeline` | combinator | ordered stages, each stage fed the previous deliverable |
| `worktreeFanout` | combinator preset | returns `fanout(...)` over worktree-CLI leaves |
| `loopDispatch` | eval adapter | returns a `ProfileDispatchFn` for `runProfileMatrix` |
| `loopCampaignDispatch` | eval adapter | returns a `DispatchFn` for `runCampaign` |
| `runGraph` | graph runtime | a model-decided topology over `supervise()` |
| `replaySpawnTree` | durable replay | re-feeds a journaled tree as `Settled[]` |
| `runTree` | view merge | folds a resumed run's committed nodes into the live view |

No combinator is subsumed by `runGraph`, and the reason is behavioural rather than stylistic.
`runPersonified` accepts no brain, no router, and no model configuration, so a combinator's order is a property of the program.
`runGraph` always routes delegation through a model, whether the caller supplies a `brain`, places a `driverBackend` harness, or falls through to the root profile's router brain.
`tests/kernel/composition-families.test.ts` holds the distinction: one two-node graph runs its worker when the scripted brain emits `spawn_worker` and runs nothing when the same brain declines.
A `pipeline` stage cannot be skipped that way, so the two entries do not express the same behaviour.

The dispatch pair already shares one core, `runLoopWithCampaignContext`.
The two public faces exist because agent-eval has two entry points with different signatures, and both remain live.
They stay.

`replaySpawnTree` is not subsumed either, and its signature settles it.
It takes a journal, a blob store, and a root id, and it returns the settlements already recorded.
There is no executor, no profile, and no brain in that call, so it runs no agent at all.
`runGraph` cannot return a past run's settlements without executing the run again.

`runTree` was the one genuine removal, and it was never a runtime.
It is nine lines that merge a resumed run's prior nodes into the live view, the supervisor applies it before returning, and `SupervisedResult.tree` therefore already carries the merged tree.
No consumer imported it: verified across 23 first-party repositories and the only published dependent.
It left the `/kernel` barrel in 0.138.0 and stayed as a supervisor internal.

Scan both forms when checking for consumers.
The first pass here read `import ... from` only and undercounted, because agent-dev-container reaches `loopUntil` through an `export ... from` re-export in `packages/workflow-script-runtime/src/loops.ts`.
Counting both forms raised the statement total from 255 to 328 and left `runTree` at zero.

**Why this recurred:** the ledger reasoned from names.
A `run*` prefix on a pure view merge, and two `loop*` prefixes on eval adapters, read as duplicated runtimes to a reader counting symbols.
Before proposing that two entries consolidate, read both implementations and name the behaviour that separates them.
If no behaviour separates them, a test must be able to tell the surviving entry from the deleted one.
