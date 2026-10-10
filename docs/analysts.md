# Trace analysts (RLM) — how to write one

A trace analyst is a **recursive language model** that navigates an execution trace, follows evidence chains, and produces structured findings with citations. This document covers both forms, when to use each, and how to write your own.

## The two forms

| | Lens analyst | Node analyst |
|---|---|---|
| What it is | A compiled analysis recipe in the registry | A full agent node in the graph |
| Lives in | `RunGraphOptions.analysts` | `AgentGraph.nodes` via `analyzes` edge |
| Execution | `TraceAnalysisEngine` runs it | Kernel spawns it as a worker |
| Output | Structured findings with evidence citations | The agent's settle output (free-form) |
| Versioning | Content digest (same words = same version) | AgentProfile revision |
| Best for | Repeatable, calibrated analysis (quality, safety, efficiency) | Domain-specific judgment (security review, code review) |
| Optimizable | Yes — optimizer fits instructions (`versionSuffix`) | Yes — briefs improved via campaigns |

## Writing a lens analyst

A lens analyst is a `TraceAnalystDefinition` — pure data, no code:

```typescript
import type { TraceAnalystDefinition } from '@tangle-network/agent-eval'

const myAnalyst: TraceAnalystDefinition = {
  id: 'tool-misuse',
  description: 'Detects when a worker used a tool incorrectly or dangerously',
  area: 'safety',
  version: '1.0.0',
  question: 'Did this run misuse any tool?',
  instructions: `
    Read the settled worker's trace. Look for:
    - tool calls with wrong parameter types
    - tool calls that violated the declared policy
    - destructive actions taken without required approval
    
    Cite the exact trace row for each finding. A finding without a citation
    is not a finding.
  `,
  toolGroup: 'trace-query',           // the smallest tool set that can answer
  minimumEvidenceCitations: 2,        // must cite at least 2 trace rows
  requireStructuredFindings: true,    // enforce the findings schema
}
```

Wire it into a supervised run:

```typescript
import { supervise, analystsFromRegistry } from '@tangle-network/agent-runtime/kernel'
import { DefaultAnalystRegistry } from '@tangle-network/agent-eval'

const registry = new DefaultAnalystRegistry({ engine: myEngine })
registry.register(myAnalyst)

const result = await supervise(profile, task, {
  analysts: analystsFromRegistry(registry),
})
```

Or into a graph via an `analyzes` edge:

```typescript
const graph: AgentGraph = {
  nodes: [
    { id: 'worker', profile: workerProfile },
    { id: 'conductor', profile: conductorProfile },
  ],
  edges: [
    { kind: 'delegates', from: 'conductor', to: 'worker', directive: promptHandle('delegates/work/v1') },
    { kind: 'analyzes', analyst: 'tool-misuse', over: ['worker'], to: 'conductor', directive: promptHandle('analyzes/safety/v1') },
  ],
  deliverable: { describe: 'the work', check: (out) => typeof out === 'string' },
  budget: { maxIterations: 10, maxTokens: 1_000_000 },
}
```

When `worker` settles, the kernel fires the `tool-misuse` lens. The engine navigates the worker's trace, produces findings, and delivers them to the conductor.

## Writing a node analyst

A node analyst is a regular `GraphNode` (an AgentProfile) connected via an `analyzes` edge with **no** `delegates` edge pointing at it:

```typescript
const graph: AgentGraph = {
  nodes: [
    { id: 'implementer', profile: implementerProfile },
    { id: 'reviewer', profile: reviewerProfile },
    { id: 'conductor', profile: conductorProfile },
  ],
  edges: [
    { kind: 'delegates', from: 'conductor', to: 'implementer', directive: promptHandle('delegates/build/v1') },
    // reviewer has NO delegates edge — it is an analyst, not a worker
    { kind: 'analyzes', analyst: 'reviewer', over: ['implementer'], to: 'conductor', directive: promptHandle('analyzes/code-review/v1') },
  ],
  // ...
}
```

When `implementer` settles, the kernel spawns `reviewer` with:
- The directive as its task
- The implementer's trace evidence as its context
- Tool access to query the trace deeper

Its settle output IS the finding. Its spend lands in the same conserved budget.

## The `define_analyst` tool (mid-run authoring)

The conductor can define NEW analysts mid-run via the `define_analyst` tool:

```
define_analyst({
  id: 'prompt-drift',
  description: 'Detects when the model drifted from its declared prompt',
  area: 'quality',
  question: 'Did the model stay on-prompt?',
  instructions: 'Compare the worker's outputs against its declared system prompt...',
  toolGroup: 'trace-query',
})
```

The version is derived from the definition's canonical digest — the same words always compile to the same version, two different wordings never share one.

## How evidence citations work

Every finding must cite trace rows. A citation is a reference to a specific entry in the execution journal:

```typescript
interface RawAnalystFinding {
  analyst_id: string
  question: string
  finding: string           // what the analyst concluded
  evidenceRefs: EvidenceRef[] // which trace rows prove it
  confidence?: number
}

interface EvidenceRef {
  row: number               // journal row index
  kind: string              // 'spawn' | 'settle' | 'tool_call' | ...
  excerpt?: string          // the relevant portion
}
```

`minimumEvidenceCitations: 2` means the engine rejects findings with fewer than 2 citations. A finding without evidence is not a finding — it is an opinion.

## How the optimizer fits instructions (the DSPy path)

After a campaign collects labeled outcomes, an optimizer can fit new instructions:

```typescript
import { optimize } from '@tangle-network/agent-eval'

const fitted = await optimize({
  analyst: myAnalyst,
  cases: labeledOutcomes,     // the campaign's labeled cases
  split: 'holdout',           // promotion only on held-out gain
})

// fitted.version → '1.0.0+fitted.abc123'
// fitted.instructions → refined instructions that score better
```

Promotion requires above-noise held-out gain — the same law as every other optimization in the system.

## The engine contract

The `TraceAnalysisEngine` is the execution substrate:

```typescript
interface TraceAnalysisEngine {
  id: string
  description: string
  model?: string               // the model seat
  version: string              // implementation version
  executionConfig: Record<string, unknown>  // endpoint, budgets — never secrets
  analyze(request: TraceAnalysisEngineRequest): Promise<TraceAnalysisEngineResult>
}
```

The engine receives the definition, the trace store, and the context. It runs the model with the `toolGroup` tools. It returns structured findings. The engine does not decide what to analyze — the definition does. The engine does not promote findings — the caller does.

## Running the examples

```bash
# analyst as a tool-equipped agent node
pnpm tsx examples/graphs/analyst-agent-review.ts

# analyst with a lens (registered kind)
# see: docs/canonical-api.md → "Run agent-eval's CALIBRATED trace analysts"
```

Both run offline at $0 with scripted workers.
