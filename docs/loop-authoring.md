# Loop Authoring

Reference / developer guide. This is the blessed loop authoring direction:
define a loop, then run it.

```ts
const loop = defineLoop({
  name: 'secure-build',
  run: async (task, ctx) => {
    // spawn / converse / coordinate through the runtime primitives you need
    // record every worker/subloop/conversation turn as a packet
    return output
  },
  analysts: [traceCompleteness],
  verifier: executableGate,
  judge: heldOutScore,
  questionPolicy: 'failClosed',
})

const result = await loop.run(task, { onEvent })
```

## Design Goals

| Goal | Contract |
|---|---|
| Simple loops stay simple | A loop is `defineLoop(...).run(task)`; no MCP required for library code. |
| Complex loops stay powerful | The loop body can use conversations, `Scope`, MCP coordination tools, sandbox sessions, analyst loops, or delegated modes. |
| Everything is inspectable | The result contains packets, trace graph, events, messages, questions, findings, verifier verdict, judge verdict, blockers, timings, and output. |
| Trace subsets are first-class | Run analysts over one agent, one packet, a pairwise interaction, or the full loop. |
| Messages have recorded delivery | Every message is `delivered`, `queued`, or `rejected`; no silent side channel. |
| Questions move up the chain | Blocking questions are records, not prose hidden in model output. |
| Judges cannot steer | Verifiers gate shippability in-loop; judges score held-out quality after the loop body finishes. |

## Mental Model

```txt
user / Pi
  -> defineLoop(...).start(task)
      -> loop body
      -> conversations / Scope / MCP / sandbox runs / delegated loops
        -> loop packets
        -> trace analysts
        -> questions + messages
    -> verifier verdict
    -> held-out judge verdict
    -> complete result envelope
```

MCP is a binding, not the architecture. Use it when a sandbox agent needs
tools. Use the TypeScript API when a developer or product service owns the
loop directly. Use a CLI for CI and human operations.

## Result Shape

Every loop returns `LoopRunResult<Output>`:

```ts
type LoopRunResult<Output> = {
  ok: boolean
  status: 'completed' | 'blocked' | 'failed'
  output?: Output
  packets: LoopPacket[]
  trace: LoopTraceGraph
  events: LoopGraphEvent[]
  findings: LoopFinding[]
  questions: LoopQuestion[]
  messages: LoopMessageRecord[]
  verifier?: LoopVerdict
  judge?: LoopVerdict
  blockers: string[]
}
```

The packet is the unit every subsystem can inspect:

```ts
await ctx.packet({
  nodeId: 'worker-a',
  label: 'implementation worker',
  kind: 'worker',
  status: 'done',
  output,
  trace,
  verdict,
  spent,
})
```

## Trace Subsets

Use `selectLoopTrace` to analyze any slice:

```ts
selectLoopTrace(result, { nodeId: 'worker-a' })
selectLoopTrace(result, { pair: ['driver', 'worker-a'] })
selectLoopTrace(result, { packetId: result.packets[0].id })
selectLoopTrace(result, { types: ['conversation.turn', 'message.sent'] })
```

This is the trace substrate for repainting the execution graph: nodes are
agents/subloops/evaluators, edges are spawn/message/steer/analysis/verifier/judge
relationships, and events carry timestamps plus arbitrary payload data.

## Evaluator Placement

| Role | Timing | Can affect loop strategy? | Purpose |
|---|---:|---:|---|
| Trace analyst | after packet or final | yes, through questions/messages | Trace-derived diagnosis. |
| Loop analyst | after packet or final | yes, through questions/messages | Topology diagnosis across packet subsets. |
| Verifier | after loop body | yes, gates `ok` | Shippability: tests, lint, typecheck, real product/API checks. |
| Judge | after verifier | no | Held-out score for eval, promotion, GEPA/HALO/autoresearch. |

The rule: verifier verdicts may block success; judge verdicts may not steer the
current loop. Use judge scores for comparing loop designs, prompts, skills, and
model choices across runs.

## Messages

`loop.start(task)` returns a live handle:

```ts
const handle = loop.start(task, { messageRouter })
await handle.control.send({
  from: 'pi-root',
  to: 'worker-a',
  kind: 'steer',
  body: 'Use the simpler API surface.',
  mode: 'immediate',
})
const result = await handle.result
```

The first-class `control` object is the stable Pi/root surface: `send`,
`answerQuestion`, `trace`, `packets`, `questions`, `messages`, `events`, and
`snapshot`. The handle itself only carries `runId`, `control`, and `result`.

The message router is the transport seam. In-process it can call `Scope.send`.
Across sandboxes it can write into session messaging. If no router is wired,
messages are recorded as `queued`; the runtime does not fake delivery.

## Ladder Of Power

| Need | Use |
|---|---|
| One persistent sandbox session | `openSandboxRun` |
| Simulated user/product-agent eval | `defineConversation` + `runConversation` inside `defineLoop` |
| Static topology | `fanout`, `pipeline`, `verify`, `panel`, `loopUntil` |
| Agent-authored topology | `dynamicLoopRunner` |
| Sandbox driver coordinating workers | `createCoordinationTools` via MCP |
| Codebase-mutating accumulation | git-backed workspace loop with typed merge outcomes |
| Trace DB audit/cross-run diff | `runAnalystLoop` / `agent-eval` analyst registry |

## Open Design Questions

These should remain explicit until proven by code or eval:

1. What is the canonical trace DB interface for arbitrary trace subsets:
   packet graph, OTEL spans, agent-eval `TraceStore`, or an adapter over all
   three?
2. What delivery guarantees should each transport expose for messages:
   immediate inbox, durable queue, rejected, stale target, or unsupported?
3. What authorization policy should govern root/Pi direct messages to
   descendants through `LoopControlPlane`?
4. What is the exact typed workspace result:
   `merged | conflict | stale-base | rejected | verifier-failed`?
5. Should loop analysts be allowed to spawn verifier workers, or should they
   only emit questions/messages for the driver to act on?
6. What result projection should product UIs render by default: packet tree,
   conversation transcript, evaluator timeline, or graph replay?
7. What is the smallest wow demo that proves the system: repo migration,
   protocol hardening, product-feature build, security audit loop, or
   agentic conversation eval?

## Smallest Wow Examples

- "Migrate this repo. Spawn workers by package, merge through git, run
  verifier loops until CI and product smoke tests pass."
- "Run a protocol hardening loop. Fan out auditors, synthesize findings,
  implement fixes, verify with non-mocked tests, then judge on held-out attack
  scenarios."
- "Run a simplification loop. Spawn designers to remove concepts, trace
  analysts to detect lost capability, verifier to prove tests still pass, judge
  to score developer experience."
- "Evaluate a product agent. Simulated user and product agent converse over
  multiple resumed turns; analysts inspect each participant and pairwise
  interaction; verifier checks task success; judge scores held-out quality."

See [`examples/define-loop/`](../examples/define-loop/) for an offline,
developer-facing example of the last pattern.
