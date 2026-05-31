# The Tangle Agent Spine

> One agent, defined once, runnable in any environment, scored by any benchmark, self-improving on the union — with **no forks** between what we evaluate, what we self-improve, and what users get.

This is agent-runtime's canonical agent architecture. **agent-runtime owns the execution model** (`runLoop`, `loopDispatch`, and the `ExecutionEnvironment` seam in `src/loops/`). It consumes — strictly *downward* — agent-eval's `AgentProfile` (the optimizable identity), `RunRecord` (the trace), and the self-improvement drivers/gates. The layering is fixed: `agent-runtime → agent-eval`, never the reverse. The spine doc lives here because the keystone (`runLoop` + `ExecutionEnvironment`) is here.

This is deliberately the multi-month version. Phase 0 (portable identity) is shipping; the rest is sequenced below.

## The problem it solves

Today a "product agent" is three disconnected things:

1. A **system prompt** bolted to a specific runtime (a Cloudflare Worker chat loop).
2. An **eval** that scores a *different* surface (a bench worker, a persona harness) than production runs.
3. A **self-improvement loop** that optimizes an artifact production may not even read.

So "is our legal agent good at real lawyer work?" cannot be answered: the agent that serves users is not the agent the benchmark scores, and the thing the loop improves is not the thing that ships. External benchmarks (Harvey LAB, TaxCalcBench) look like "different universes" only because the agent's *runtime* is welded to its product environment.

## The model

```
Agent       = AgentProfile  ×  runLoop  ×  ExecutionEnvironment   →   Artifacts + Trace (RunRecord)
Benchmark   = TaskSource     ×  ExecutionEnvironment  ×  Scorer
SelfImprove = Driver optimizes ONE evolvable AgentProfile section,
              scored over the UNION of benchmarks, gated, promoted → the SAME profile production ships.
```

Four orthogonal pieces. The agent is defined **once** (`AgentProfile`), runs through **one** kernel (`runLoop`), and the only thing that varies between "chat product", "Harvey task", and "persona eval" is the **`ExecutionEnvironment`** it's handed.

Ownership across the two packages:

| Piece | Home | Why |
|---|---|---|
| `AgentProfile` (identity, optimizable) | **agent-eval** `src/profile/` | it is the prompt CONTENT the self-improve loop varies; meaningful without a running loop → substrate |
| `RunRecord` (trace/outcome) | **agent-eval** `src/run-record.ts` | substrate measurement primitive |
| drivers (`gepa`/`skillOpt`), gates, benchmarks | **agent-eval** | the measurement + self-improvement substrate |
| `runLoop`, `loopDispatch`, delegation | **agent-runtime** `src/loops/` | the execution kernel |
| **`ExecutionEnvironment`** (the seam) | **agent-runtime** `src/loops/` | execution concern — tools/sandbox/filesystem |

### 1. `AgentProfile` — the portable identity  *(Phase 0 — shipped for legal, tax, creative; gtm verifying)*

The system prompt as named, addressable zones (in agent-eval, consumed here):

```
role            domain-expert headline  +  principal-operator/researcher discipline
environment     the sandbox/tools/workspace the agent operates in
toolConventions how to use the tools
skills[]        the skill roster (+ playbook bodies where they live in-prompt)
domain[]        deep domain guidance — fixed sections + ONE `evolvable: true` learned-guidance section
```

`renderProfile(profile)` emits the prompt. The `learned-guidance` section is the single surface the self-improvement loop may patch (`applyDomainPatch`) and the single surface production renders. Identity is portable — the same profile is the system prompt in a Worker, a podman sandbox, or an eval dispatch.

### 2. `runLoop` — the recursive kernel  *(exists: `src/loops/run-loop.ts`)*

A generic, planner-optional, multi-turn loop: given a profile + a task + an environment, it runs the conversation, calls tools, and produces artifacts. **Recursive**: a worker step may itself be a `runLoop` (delegating to a coder / researcher / auditor sub-agent via `delegate_code` / `delegate_research`). Conversation-preserving and distribution-friendly by construction.

### 3. `ExecutionEnvironment` — THE SEAM  *(Phase 1 — the keystone, new in `src/loops/`)*

The agent calls **abstract** capabilities; the environment **provides** them:

```ts
export interface ExecutionEnvironment {
  tools(): ToolDefinition[]                       // read/write/shell/produce_docx/...
  invoke(call: ToolCall): Promise<ToolResult>     // run one tool call against the real backend
  workspace: WorkspaceHandle                      // input docs in, artifacts out
  artifacts(): Promise<Artifact[]>                // the files the agent produced
}
```

| Implementation | Backs | Tools | Filesystem |
|---|---|---|---|
| `WorkerEnv` | live chat product | integration MCP tools | vault (D1/R2) |
| `SandboxEnv` | benchmarks + real file work | shell, read/write, `produce_docx`, python | podman sandbox FS |
| `DispatchEnv` | the agent-eval campaign | the campaign's dispatch | run dir |

Same agent (profile + `runLoop`) in all three. **This is the single change that makes Harvey, TaxCalcBench, and delegated self-improve loops all work at once.**

### 4. Benchmark = `TaskSource × ExecutionEnvironment × Scorer`

A benchmark is not special: a source of tasks, an environment to run them in, a scorer for the artifacts.

- **Harvey LAB** = (24-practice-area task set) × `SandboxEnv` (podman, file tools) × (lawyer-authored rubric, LLM-judged). Our legal agent is the agent-under-test: inject `renderLegalSystemPrompt()` as the system prompt, hand it `SandboxEnv`, it produces the `.docx`, Harvey's rubric scores it. **No fork** — the same agent users get.
- **TaxCalcBench** = (1040 cases) × `SandboxEnv` × (objective XPath line-match).
- **Persona eval** = (persona scenarios) × `WorkerEnv`/`DispatchEnv` × (deterministic rubric).

### 5. Self-improvement over the union  *(Phase 3 — drivers + gates in agent-eval)*

The drivers (`gepaDriver`, `skillOptDriver`, `evolutionary`) optimize the profile's `learned-guidance` (or, for `skillOptDriver`, propose new **skills**), scored over the **union** of benchmarks — persona + Harvey + TaxCalcBench — each as a *separate* held-out campaign (never average 0–1 Harvey with 0–100 personas into mush). The trustworthy gate (bootstrap-CI + anti-Goodhart) promotes only real, non-regressing lift. The promoted section is **the same one production renders**. The recursion: the agent improving its own outputs by delegating to coder/researcher/auditor sub-loops, and a trace-analysis self-improver reading its own run traces.

## Why this is the proof, not a side-quest

It is the only architecture that can answer the question a funder (or a skeptic) actually asks: *"is your agent good at real, externally-graded domain work — and does it measurably get better?"* Our **one** production agent, doing real document-grounded lawyer/tax work, scored on **external ungameable rubrics**, self-improving on that score — and that improved agent is exactly what users get.

## Phased build

| Phase | What | Where | Status |
|---|---|---|---|
| **0 — Portable identity** | every product prompt → `AgentProfile`; prod == eval == self-improve target | product repos | legal ✅ live, tax ✅ live, creative ✅ verified, gtm ⏳ verifying |
| **1 — The seam** | `ExecutionEnvironment` interface; `runLoop` takes it; `WorkerEnv`/`SandboxEnv`/`DispatchEnv` | **agent-runtime** `src/loops/` | keystone — next |
| **2 — Benchmark adapters** | Harvey + TaxCalcBench as `(TaskSource × SandboxEnv × Scorer)`; our agents are the agents-under-test, no fork | agent-eval `benchmarks/` + product harnesses | the proof |
| **3 — Self-improve over the union** | drivers optimize the profile section scored across persona + Harvey + TaxCalcBench; delegated coder/researcher/auditor sub-loops; trace-analysis self-improver | agent-eval drivers/gates + agent-runtime delegation | the recursion |
| **4 — Distributed** | multi-sandbox agents communicating; planner stays optional; conversation-preserving | agent-runtime | the generic spine |

## Invariants (do not regress)

- **No fork**: production, eval, and self-improve render the *same* `AgentProfile`. A test in each product asserts `prodPrompt === renderProfile(profile)`.
- **Layering**: `agent-runtime → agent-eval` only. The `ExecutionEnvironment` seam and `runLoop` stay here; `AgentProfile`/`RunRecord`/drivers stay in agent-eval and are imported downward.
- **One evolvable surface**: only the `learned-guidance` section is patchable; fixed zones throw on patch. Anti-overfit is enforced by the held-out gate, not by trust.
- **Planner-optional**: the loop must run without a planner; a planner is an opt-in environment capability, never required.
- **Worker-safe**: no runtime `fs`/`process.env` for the evolvable surface in the product path — build-time inlined (`?raw` / generated const).
- **Honest scoring**: external-boundary calls return typed outcomes; benchmarks never average incommensurable scales.
