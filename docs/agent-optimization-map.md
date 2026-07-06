# The Agent Optimization Map

**What this document is.**
The one-page truth about optimizing agents on this substrate: every lever an `AgentProfile` exposes, what machinery exists to optimize or create each one, what is actually wired to the paved path, and what has been proven on live infrastructure.
Written to be read by humans and by agents configuring an improvement run.
Audited 2026-07-06 against `agent-interface`, `agent-eval`, `agent-runtime`, `agent-knowledge`, and the supervisor-lab live campaigns (runs 1–6).

## The mental model in three sentences

An **AgentProfile is the complete specification of an agent**: its brain-instructions, capabilities, and starting world.
**`improve()` is the one verb** that optimizes any single lever of that profile against an executable judge, with a statistical held-out gate deciding promotion.
Everything else in the stack is either a **proposer** (something that generates candidate lever-values), a **judge** (something that scores results), or a **loop** (something that runs proposers against judges until the gate ships or holds).

## Lever inventory — what an AgentProfile actually carries

| Lever (your words) | Profile field | In the type? |
|---|---|---|
| system prompt | `prompt.systemPrompt` (+ per-mode `modes`) | yes |
| skills | `resources.skills` (SKILL.md packages) | yes |
| tools | `tools` (enable/disable map) + `resources.tools` (file-based tool defs) | yes |
| MCP | `mcp` (server map) + `connections` | yes |
| knowledge base | no first-class field — lives as `resources.files` content or app-side (agent-knowledge KB store) | partial |
| resources | `resources.{instructions,agents,commands}` | yes |
| starting files | `resources.files` (materialized into the workspace before execution) | yes |
| full sandbox/VM state | backend/image choice + `extensions` (non-portable) + `resources.files` | partial — files yes, image/toolchain is the tcloud backend's, not the profile's |

Also in the type and often forgotten: `subagents` (native sub-agents), `permissions`, `model` hints, `hooks`.

## Optimization matrix — lever × machinery × wiring × proof

| Surface | Baseline/apply plumbing | Proposer that exists | Reachable from `improve()`? | Proven live? |
|---|---|---|---|---|
| `prompt` | yes | `gepaProposer` (Pareto frontier + crossover-merge + reflective mutation) | **yes (default)** | **yes — supervisor-lab runs 3–6, ~1,700 sandbox cells** |
| `skills` | yes | `skillOptProposer` (skill-document patching) | **yes (default)** | no live run anywhere yet |
| `tools` | yes (JSON string surface) | none wired; `parameterSweepProposer` is shape-compatible for toggle/config sweeps | no — fails loud, needs `generator` | no |
| `mcp` | yes (JSON string surface) | none | no — fails loud | no |
| `hooks` | yes (JSON string surface) | none | no — fails loud | no |
| `code` (tools/harness/anything in a repo) | yes | `improvementDriver` + `agenticGenerator` (real coding harness per candidate worktree, verify-gated) | **yes — `code: { repoRoot }` facade (#480)** | offline test only; live milestone pending |
| `resources.files` (starting world) | **no surface** | none | no | no |
| knowledge base | **no surface** | agent-knowledge loops exist (below) but nothing writes back into a profile | no | no |

**The one-sentence verdict: every lever you believe in is representable; two are optimizable-and-proven (prompt today, code as of #480); skills is one command away; tools/mcp/hooks are string surfaces awaiting a config proposer; files/knowledge aren't surfaces at all yet.**

## The proposer zoo — what each one is for (plain words)

| Proposer | What it does | Wired to paved path? |
|---|---|---|
| `gepaProposer` | evolves prompt text: keeps a frontier of variants that each win somewhere, merges them, mutates with evidence from best/worst trials | yes (prompt default) |
| `skillOptProposer` | same idea for skill documents (structured patches) | yes (skills default) |
| `fapoProposer` | **the meta-policy**: attribute each failure to a level, propose ONE scoped change, escalate prompt → parameters → structure only when the cheaper level is exhausted — with pluggable per-level generators | **no** — exported, zero consumers |
| `traceAnalystProposer` | turns trace-analyst findings (an Ax agent that reads execution traces with tools) into candidates | **no** — exported, zero consumers |
| `aceProposer` | append-only "playbook" curator: accumulates provenance-tagged lessons without ever summarizing old ones away (anti context-collapse) | no |
| `memoryCurationProposer` | the dedup-and-replace contrast to ACE | no |
| `parameterSweepProposer` | sweeps numeric/config parameters | no |
| `haloProposer` | hierarchical analyst-driven optimization | no |

Since #480/#310/#311 the paved path also has: per-generation **failure distiller** (the proposer automatically sees each generation's worst cells + judge reasons), **power preflight** (minimum detectable lift computed from baseline cells; structurally-hopeless budgets warn), durable `runDir`, and the statistical holdout gate everywhere (the point-estimate gate was folded away).

## Creation loops — making new things, not just mutating strings

What you asked for → what exists:

- **"Create new skills by mining traces"** — components all exist, composition does not: `trace-analyst` (reads traces, emits findings) → `skillOptProposer`/`aceProposer` (turn findings into skill-document content) → `improve(surface: 'skills')` (prove them). Nobody has connected the three. One composition, high value.
- **"Auto-research loops that write code"** — exists as of #480: `improve(surface: 'code', code: { repoRoot, verify })` runs a real coding harness per candidate in a worktree, gated by any executable judge. "Create a new tool" = point it at the repo where tools live.
- **"Knowledge discovery / find relevant OSS libraries / find MCPs"** — the research machinery exists in `agent-knowledge` (`runVerifiedResearchLoop`: two-agent verified research with claim-grounding; `discovery`; collection drivers) and is consumed by physim/legal/tax products — but **no bridge writes research results into an AgentProfile lever**. The missing primitive is small: a `knowledge → resources.files/skills` materializer, after which "research the ecosystem, propose an MCP server for the profile, prove it on the benchmark" is a normal `improve()` run over the `mcp` surface.
- **"Full sandbox initial state as a lever"** — `resources.files` covers workspace seeding; making it an `ImproveSurface` (candidate = a file-set, judge = task performance) is unbuilt but fits the existing surface contract exactly.

## The three gaps that matter (everything else is garnish)

1. **Reachability**: the zoo (FAPO, trace-analyst, ACE, sweep) needs one dial — `improve(..., { proposer: 'fapo' })` — instead of hand-assembly. FAPO especially: it *is* the "optimize everything, escalate sensibly" policy this document describes, already grounded in the paper, already pluggable.
2. **The knowledge bridge**: research loops produce verified knowledge; profiles can carry files/skills; nothing connects them.
3. **This document didn't exist.** Now it does; keep it honest — every row's "proven live" column only flips with a linked run.

## Recipes (copy-paste truth, today)

```ts
// Optimize a prompt against any executable judge (proven, runs 3–6):
await improve(profile, findings, { surface: 'prompt', scenarios, judge, agent, runDir })

// Optimize the skill documents:
await improve(profile, findings, { surface: 'skills', scenarios, judge, agent, runDir })

// Evolve CODE (tools, harnesses, algorithms) with a real coding agent per candidate:
await improve(profile, findings, {
  surface: 'code',
  code: { repoRoot, verify: commandVerifier({ command: 'pnpm', args: ['test'] }) },
  scenarios, judge, agent, runDir,
})

// Every result now carries result.power — read it BEFORE buying a bigger search.
```
