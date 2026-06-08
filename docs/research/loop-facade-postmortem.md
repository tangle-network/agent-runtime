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

This branch now contains the smallest local proof of the missing join:

```bash
pnpm exec tsx bench/src/observe-steer-workspace-loop.mts
```

That script drives a real Supervisor/Scope through the coordination MCP verbs:
first worker commits a failing artifact to a git workspace, `run_analyst` calls
`observe()` on the settled trace/output, `steer_worker` delivers the finding via
`Scope.send`, a correction worker commits the fix, and a fresh clone passes the
integration test.

It is not the cloud proof. The remaining external proof is the same shape with
`openSandboxRun` workers and a remote branch that a sandbox can clone and push.

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
