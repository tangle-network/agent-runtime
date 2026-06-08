# Loop Authoring

Blessed direction: define a loop, then run it. The facade is intentionally
thin; the loop body still uses the runtime primitives that already exist.

```ts
const loop = defineLoop({
  name: 'secure-build',
  async run(task, ctx) {
    // use conversations, Scope, runLoop, MCP tools, sandboxes, or delegated loops
    await ctx.record({ source: 'worker-a', output, trace, verdict })
    return output
  },
  analysts: [traceCompleteness],
  verifier: executableGate,
  judge: heldOutScore,
  questionPolicy: 'failClosed',
})

const result = await loop.run(task)
```

## Design Contract

| Goal | Contract |
|---|---|
| Simple loops stay simple | `defineLoop(...).run(task)` is ordinary async TypeScript. |
| Complex loops stay powerful | The body composes `Scope`, conversations, `runLoop`, MCP coordination tools, sandboxes, or delegated modes. |
| Results are inspectable | Result contains artifacts, events, findings, questions, messages, verifier, judge, blockers, timing, and output. |
| Trace subsets are first-class | `selectLoopTrace` slices the flat artifact/event stream by source, pair, kind, or artifact id. |
| Messages are explicit | `handle.control.send(...)` records `delivered`, `queued`, or `rejected`; delivery is delegated to the configured router. |
| Questions move up the chain | Blocking questions are records, not hidden prose. |
| Judges cannot steer | Verifiers gate `ok`; judges are held-out scorers for comparison and optimization. |

## Mental Model

```txt
user / Pi
  -> defineLoop(...).start(task)
      -> loop body chooses primitives
      -> ctx.record(...) artifacts + ctx.event(...) events
      -> analysts may emit findings/questions/messages
    -> verifier verdict
    -> held-out judge verdict
    -> result envelope
```

MCP is a binding, not the architecture. Use it when a sandbox agent needs tools.
Use the TypeScript API when a developer or product service owns the loop
directly. Use a CLI for CI and human operations.

## Result Shape

```ts
type LoopRunResult<Output> = {
  ok: boolean
  status: 'completed' | 'blocked' | 'failed'
  output?: Output
  artifacts: LoopArtifact[]
  events: LoopEvent[]
  trace: LoopTraceSlice
  findings: LoopFinding[]
  questions: LoopQuestion[]
  messages: LoopMessageRecord[]
  verifier?: DefaultVerdict
  judge?: DefaultVerdict
  blockers: string[]
}
```

`LoopArtifact` is a record of something the loop produced or inspected:

```ts
await ctx.record({
  source: 'worker-a',
  label: 'implementation worker',
  kind: 'worker',
  output,
  trace,
  verdict,
  spent,
})
```

It is deliberately not a scheduler, graph node, workspace abstraction, or
transport. Those already exist in `Scope`, `runLoop`, runtime hooks, topology
views, journals, and MCP coordination.

## Trace Subsets

```ts
selectLoopTrace(result, { source: 'worker-a' })
selectLoopTrace(result, { pair: ['driver', 'worker-a'] })
selectLoopTrace(result, { artifactId: result.artifacts[0].id })
selectLoopTrace(result, { kinds: ['conversation.turn', 'message.sent'] })
```

The slice returns `{ runId, artifacts, events }`. Product UIs that need a graph
should project from the existing runtime hooks/topology view or trace store,
not from a second loop graph type.

## Evaluator Placement

| Role | Timing | Can affect current loop? | Purpose |
|---|---:|---:|---|
| Analyst | after `record` or final | yes, through questions/messages/blockers | Trace-derived diagnosis. |
| Verifier | after loop body | yes, gates `ok` | Shippability: tests, typecheck, lint, real product/API checks. |
| Judge | after verifier | no | Held-out score for GEPA/HALO/autoresearch and release comparison. |

The rule: verifier verdicts may block success; judge verdicts may not steer the
current run.

## Live Control

```ts
const handle = loop.start(task, { messageRouter })
await handle.control.send({
  from: 'pi-root',
  to: 'worker-a',
  kind: 'steer',
  body: 'Use the simpler API surface.',
})
const result = await handle.result
```

`control` exposes `send`, `answerQuestion`, `trace`, `artifacts`, `questions`,
`messages`, `events`, and `snapshot`. If no message router is wired, messages
are recorded as `queued`; the facade does not fake delivery.

## Ladder Of Power

| Need | Use |
|---|---|
| One persistent sandbox session | `openSandboxRun` |
| Simulated user/product-agent eval | `defineConversation` + `runConversation` inside `defineLoop` |
| Static topology | `fanout`, `pipeline`, `verify`, `panel`, `loopUntil` |
| Agent-authored topology | `dynamicLoopRunner` or `createDriver` |
| Sandbox driver coordinating workers | `createCoordinationTools` via MCP |
| Codebase-mutating accumulation | git-backed branch/clone loop with typed merge outcomes |
| Trace DB audit/cross-run diff | `runAnalystLoop` / agent-eval trace stores |

## Open Design Questions

1. What is the canonical persisted trace subset interface: runtime hooks,
   OTEL spans, agent-eval `TraceStore`, or an adapter over all three?
2. What delivery guarantees should each transport expose for messages:
   immediate inbox, durable queue, rejected, stale target, or unsupported?
3. What authorization policy should govern root/Pi direct messages to
   descendants through `LoopControlPlane`?
4. What is the exact typed workspace result:
   `merged | conflict | stale-base | rejected | verifier-failed`?
5. What result projection should product UIs render by default: topology tree,
   transcript, evaluator timeline, or graph replay?

## Smallest Wow Examples

- "Migrate this repo. Spawn workers by package, merge through git, run
  verifier loops until CI and product smoke tests pass."
- "Run a protocol hardening loop. Fan out auditors, synthesize findings,
  implement fixes, verify with non-mocked tests, then judge held-out attacks."
- "Run a simplification loop. Remove concepts, prove tests still pass, and
  judge developer experience."
- "Evaluate a product agent. Simulated user and product agent converse over
  resumed turns; analysts inspect traces; verifier checks success; judge scores
  held-out quality."

See [`examples/define-loop/`](../examples/define-loop/) for an offline example.
