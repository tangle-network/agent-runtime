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
