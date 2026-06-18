[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / AgentManifest

# Interface: AgentManifest\<TPersona, TRunOutput\>

Defined in: [agent/define-agent.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L35)

The full agent manifest. Each agent ships ONE of these.

Generics:
  `TPersona` — the agent's persona shape (loaded from
    `surfaces.personas`). Defaults to `unknown` so the substrate's
    persona discovery (`loadPersonas`) can accept anything; per-agent
    code re-narrows when it matters.
  `TRunOutput` — the shape `runtime.act` returns. Used by the rubric
    scorers and emitted into the trace.

## Type Parameters

### TPersona

`TPersona` = `unknown`

### TRunOutput

`TRunOutput` = `unknown`

## Properties

### id

> **id**: `string`

Defined in: [agent/define-agent.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L42)

Stable identifier — used as `projectId` in traces, as the analyst
loop's `runId` prefix, and as the namespace under which findings
are persisted. MUST match the agent's repo name to keep
cross-repo telemetry joinable.

***

### repoRoot

> **repoRoot**: `string`

Defined in: [agent/define-agent.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L50)

Filesystem root the substrate resolves surface paths against.
Typically `process.cwd()` or a fixed absolute path. Use an
absolute path when the agent's tests may run from subdirectories
(vitest sometimes shifts cwd).

***

### surfaces

> **surfaces**: [`AgentSurfaces`](AgentSurfaces.md)

Defined in: [agent/define-agent.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L61)

Map of mutable surfaces the self-improvement loop can edit. See
`AgentSurfaces` — required: `systemPrompt`, `tools`, `rubric`,
`knowledge`, `personas`. Optional: `scaffolding`, `memory`, `rag`,
`outputSchema`.

Every required path is validated at `defineAgent` time. Missing
paths throw with the full list of offenders.

***

### rubric

> **rubric**: [`AgentRubric`](AgentRubric.md)\<`TRunOutput`\>

Defined in: [agent/define-agent.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L68)

Rubric the substrate uses to score each run. Dimensions × weights
× judges. The substrate computes the weighted composite and
stamps it into the RunRecord.

***

### runtime

> **runtime**: [`AgentRuntime`](AgentRuntime.md)\<`TPersona`, `TRunOutput`\>

Defined in: [agent/define-agent.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L79)

Runtime adapter — how the substrate INVOKES the agent against a
persona. The `act` function takes a persona + a context (with the
tracer the substrate threads through for span emission) and
returns the run output the rubric will score.

The agent's existing production runtime goes in here; the
substrate is intentionally thin around it.

***

### personas

> **personas**: () => `Promise`\<readonly `TPersona`[]\>

Defined in: [agent/define-agent.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L87)

Persona discovery — the substrate loads personas via this function
at eval start. Can read from `surfaces.personas`, an API, or be
hardcoded. The substrate calls it once per `runAgentEval` call;
persona ordering is preserved.

#### Returns

`Promise`\<readonly `TPersona`[]\>

***

### analystKinds

> **analystKinds**: readonly `TraceAnalystKindSpec`[]

Defined in: [agent/define-agent.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L97)

Analyst kinds the substrate runs against each persona's trace.
Defaults to `DEFAULT_TRACE_ANALYST_KINDS` from agent-eval. Per-agent
authors can prune (e.g. skip `knowledge-poisoning` when there's no
knowledge base) or extend (custom domain kinds).

Empty array disables the loop — useful for `pnpm eval --no-analyst`.

***

### analyst

> **analyst**: [`AnalystConfig`](AnalystConfig.md)

Defined in: [agent/define-agent.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L103)

Analyst LLM configuration. The substrate uses these for all four
kinds (override per-kind via `analystKinds` if needed).

***

### autoApply?

> `optional` **autoApply?**: [`AutoApplyPolicy`](AutoApplyPolicy.md)

Defined in: [agent/define-agent.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L115)

Auto-apply policy. Knowledge / improvement edits land only when
`enabled === true` AND the source finding's confidence meets the
threshold. `mode` controls how applies happen: `'write'` mutates
files in-place; `'open-pr'` writes to a branch and opens a PR.

Default: knowledge auto-applies at confidence ≥0.85 in `'write'`
mode (wiki edits are git-reversible); improvement stays at
`enabled: false` until the agent author has measured precision.
