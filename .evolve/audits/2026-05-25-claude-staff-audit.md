# Staff audit — agent-runtime
Reviewer: Claude (foreground while subagents run)
Date: 2026-05-25
Overall code+docs+DX score: **6/10**

## TL;DR — single highest-leverage fix

**The 17 examples teach a surface nobody actually uses in production.** Real consumers across 6 product repos (gtm/creative/legal/tax/agent-builder/agent-eval) import `handleChatTurn`, `defineAgent`, `runAnalystLoop`, `PlatformHubClient`, `DefaultVerdict` — but the examples lead with `runAgentTask`, `coderProfile`, `createFanoutVoteDriver`, `runLoop`, `createFleetWorkspaceExecutor`. There are zero consumer imports of `coderProfile`, `runLoop`, `createFanoutVoteDriver`, or `runAgentTask` in the grep. The pedagogy is teaching the wrong thing first.

**Fix:** reorder examples so the FIRST one is `handleChatTurn` + a chat handler skeleton (that's what every product is built around). Loops + profiles move to "advanced / when you need fanout."

## Per-area scores

| area | score | top issue |
|---|---|---|
| First impression / README 60s | 4 | 551-line README, 6-row "What you get" table dumped immediately |
| Example incremental learning | 3 | 17 examples, no progression, leads with the wrong primitive |
| Example→production fidelity | 3 | All examples use synthetic `sandboxClient` — none show real production wiring |
| API surface coherence | 6 | 6 subpath exports, some justified (`/platform`, `/analyst-loop`), some redundant (`/loops` vs root) |
| Comment quality (examples) | 4 | Headers are 11+ line block comments narrating what the example IS — belongs in README |
| Comment quality (src) | 7 | src/ comments are generally constraint-explaining (good) |
| Test coverage | 7 | 283 passing tests, but edge cases in kernel are thin |
| Bloat | 5 | 9643 LOC src; `backends.ts` 897, `sanitize.ts` 593, `run-loop.ts` 583, `types.ts` 560 |

## Top 10 findings

### 1. Examples teach the wrong primary surface
**Evidence:** consumer import grep across 6 product repos shows 0 imports of `runAgentTask`, `coderProfile`, `runLoop`, `createFanoutVoteDriver`. Real-use top imports: `handleChatTurn` / `defineAgent` (via `/agent`) / `runAnalystLoop` (via `/analyst-loop`) / `PlatformHubClient` (via `/platform`) / `DefaultVerdict` (via `/loops`) / `RuntimeStreamEvent` / `KnowledgeRequirement` / `RuntimeRunRow` / `startRuntimeRun` / `createOpenAICompatibleBackend`.

**Fix:** reorder `examples/README.md`:
- **Hello world**: `chat-handler/` (currently 86 LOC — perfect size) — `handleChatTurn` is what every product uses
- **+1 concept**: `with-knowledge-readiness/` — `requiredKnowledge`
- **+1**: `sanitized-telemetry-streaming/` — observability
- **+1**: `runtime-run/` — production persistence
- **+1**: `mcp-delegation/` — tool/MCP integration
- **Advanced**: coder-loop / researcher-loop / fleet-delegation — multi-agent fanout
- **Delete/merge**: `basic-task/` + `sanitized-telemetry/` (redundant with their streaming siblings); `sandbox-stream-backend/` (synthetic, no realistic value); `agent-into-reviewer/` (esoteric "2-runtime" pattern — move to docs/advanced.md)

**Effort:** 1-2 days. **Impact:** every new user lands on the relevant first example instead of one that teaches a primitive their product won't use.

### 2. 17 examples is 2x too many
**File:** `examples/README.md` (89 lines listing 14 examples)
**Issue:** "primitive library has 17 examples" is a docs anti-pattern. New users can't pick one. The redundant pairs (`basic-task` + `with-knowledge-readiness`, `sanitized-telemetry` + `sanitized-telemetry-streaming`, `sandbox-stream-backend` + `openai-stream-backend`) double the surface for no pedagogical gain.

**Fix:** consolidate to **8 examples** organized as a progression:
1. `chat-handler/` (hello world)
2. `chat-handler-with-knowledge/` (merge `with-knowledge-readiness` into chat handler)
3. `chat-handler-with-telemetry/` (merge `sanitized-telemetry-streaming` into chat handler)
4. `mcp-delegation/`
5. `runtime-run/` (production persistence)
6. `coder-loop/` (advanced — multi-agent fanout)
7. `researcher-loop/` (advanced)
8. `fleet-delegation/` (advanced — multi-machine)

Delete `basic-task`, `sandbox-stream-backend`, `sse-stream`, `openai-stream-backend`, `sanitized-telemetry`, `agent-into-reviewer`, `with-knowledge-readiness`, `sanitized-telemetry-streaming` as standalone (folded into chat-handler progression).

**Effort:** 2 days. **Impact:** new user reads ONE example and gets it.

### 3. Example header comments narrate instead of code-talking
**File:** `examples/coder-loop/coder-loop.ts:1-16` — 16-line block comment explaining what the example does. Same in `examples/researcher-loop/researcher-loop.ts:1-15`, `examples/mcp-delegation/mcp-delegation.ts:1-20+`, `examples/fleet-delegation/*`.

**Issue:** all narrative belongs in the example's README. The .ts file should be code with minimal inline `// WHY` comments. Today the header is 16 lines (10% of a 131-LOC file).

**Fix:** replace 16-line header with one line:
```ts
// coderProfile + runLoop + FanoutVote — minimum end-to-end coder loop. See README.md for context.
```

**Effort:** trivial. **Impact:** code looks like code, not a tutorial blog post.

### 4. `backends.ts` is 897 LOC — needs split
**File:** `src/backends.ts` — 897 LOC, single file, multiple concerns.

**Likely split:**
- `src/backends/openai-compat.ts` — `createOpenAICompatibleBackend`
- `src/backends/sandbox-prompt.ts` — `createSandboxPromptBackend`
- `src/backends/iterable.ts` — `createIterableBackend` helper
- `src/backends/errors.ts` — `BackendErrorDetail` typed-outcome types
- `src/backends/index.ts` — re-exports

**Effort:** 4-6 hours. **Impact:** discoverability + per-backend test isolation.

### 5. `runAgentTask` vs `runAgentTaskStream` vs `runLoop` vs `handleChatTurn` — 4 entry points doing variants of the same thing
**File:** `README.md:18-29` (the "What you get" table)
**Issue:** New users see 4-5 entry points immediately and can't tell which to use. The table calls each "an entry point" without saying which scenario picks which.

**Fix:** add a decision tree at the top of README:
```
For a chat product?         → handleChatTurn (production chat handler)
For per-turn streaming?      → runAgentTaskStream (lower-level, when handleChatTurn doesn't fit)
For one-shot batch tasks?    → runAgentTask
For multi-iteration fanout?  → runLoop + a Driver + a Profile
For a declarative manifest?  → defineAgent (top of every product agent file)
```

**Effort:** trivial. **Impact:** new user picks the right primitive on first read.

### 6. Defaults are NOWHERE documented
**Files searched:** all examples + README + JSDoc in `src/index.ts`.
**Issue:** when an example or product calls `runChatThroughRuntime({ model: undefined })` what model fires? When `runLoop({ driver })` runs with no `maxIterations`, what's the cap? When `createOpenAICompatibleBackend({})` gets no `kind`, what's the kind? Currently you have to read source.

**Fix:** add `## Defaults` section to README:
| Knob | Default | Override via |
|---|---|---|
| Agent model | gpt-4o-mini | env `MODEL_NAME` or `runChatThroughRuntime({ model })` |
| Driver model | (same as agent) | `MODEL_NAME` |
| Driver provider | openai-compat when `TANGLE_API_KEY` present | env `MODEL_PROVIDER` |
| Max loop iterations | (read kernel default) | `runLoop({ maxIterations })` |
| ... |

**Effort:** half-day to document, write the table, audit each. **Impact:** every "what's the default" question answers itself.

### 7. README is 551 lines — should be 100-150
**File:** `README.md` (551 lines)
**Issue:** scrolling 500+ lines on landing is a docs anti-pattern. Half the content belongs in `docs/` or per-example READMEs.

**Fix:** target README structure:
1. What this is (3 lines)
2. Install (2 lines)
3. Hello world — 30-line `handleChatTurn` snippet
4. Decision tree (finding #5 above)
5. Defaults table (finding #6)
6. Where to go next (link to docs/, examples/, agent-eval-adoption skill)

Everything else → `docs/{api.md,advanced.md,migration.md}`.

**Effort:** 1 day. **Impact:** 30-second first impression actually works.

### 8. `/loops` subpath export is mostly used for `DefaultVerdict` type — internal-leak candidate
**Evidence:** consumer grep: `/loops` imports are 10 mentions, of which 7 are `DefaultVerdict` (a type). The `runLoop` + `createFanoutVoteDriver` + `Driver` / `Validator` are imported maybe twice across the entire org.

**Recommendation:** consider whether the public `runLoop` API is actually used or if it's example-only. If example-only, move loops out of the top-level surface and treat as an advanced/library opt-in.

**Effort:** investigation 1 hour; refactor 1 day. **Impact:** smaller, more honest public surface.

### 9. JSDoc on public exports is patchy
**Files:** `src/index.ts` re-exports many things. Sample 10:
- `runAgentTask` — has TSDoc with `@example` ✓
- `runAgentTaskStream` — has TSDoc ✓
- `handleChatTurn` — has TSDoc ✓
- `defineAgent` — re-exported from `./agent`; check its JSDoc
- `startRuntimeRun` — TSDoc?
- `createOpenAICompatibleBackend` — TSDoc?
- `createSandboxPromptBackend` — TSDoc?
- `RuntimeStreamEvent` (type) — comment?
- `KnowledgeRequirement` (type) — comment?
- `DefaultVerdict` (from /loops) — comment?

Run `grep -B5 "^export " src/index.ts | head -200` and audit each. Suspect ~50% have minimal or stale JSDoc.

**Fix:** sweep `src/index.ts` re-exports + the source files. Every public-surface symbol gets: 1-line summary + `@param` + `@returns` + `@example` (short).

**Effort:** 1 day. **Impact:** IDE intellisense + autogenerated reference docs come alive.

### 10. Tax/legal/gtm/creative agents are at 4 different runtime versions
**Evidence:** lockfiles show:
- gtm-agent: 0.23.1 (post-multishot PR)
- legal-agent: 0.23.1 (post-PR #106)
- creative-agent: 0.18.0 (stale)
- tax-agent: TBD (implementer just spawned to bump)
- agent-builder: TBD

**Issue:** the substrate ships features (OTEL export, judge tracing) but consumers don't pick them up automatically. Three OOM-different surface gaps right now.

**Fix:** add a `pnpm bump:substrate` script to the agent-stack-adoption skill template that bumps all `@tangle-network/*` to latest in one command. Then run it across all 5 products weekly via the production-loop CI.

**Effort:** 2 hours. **Impact:** version drift disappears.

## Examples I'd KEEP, REWRITE, or DELETE

| Example | Verdict | Rationale |
|---|---|---|
| `chat-handler/` | **KEEP** as hello world | What every product uses |
| `with-knowledge-readiness/` | **MERGE into chat-handler** | Adds 1 concept, can be a code branch in chat-handler |
| `sanitized-telemetry-streaming/` | **MERGE into chat-handler** | Adds telemetry; same merge logic |
| `runtime-run/` | **KEEP** | Production persistence is a real concern |
| `mcp-delegation/` | **KEEP** | Tool integration is core |
| `coder-loop/` | **KEEP** as advanced | Multi-agent fanout |
| `researcher-loop/` | **KEEP** as advanced | Same |
| `fleet-delegation/` | **KEEP** as advanced | Multi-machine pattern |
| `basic-task/` | **DELETE** | Redundant with chat-handler |
| `sanitized-telemetry/` | **DELETE** | Redundant with streaming version |
| `sandbox-stream-backend/` | **DELETE** | Synthetic-only, no production value |
| `sse-stream/` | **DELETE** | Belongs in `docs/advanced/browser-routes.md` |
| `openai-stream-backend/` | **DELETE** | Same — pure backend wiring belongs in docs |
| `agent-into-reviewer/` | **DELETE** | Esoteric, belongs in docs/advanced |

**8 examples** post-consolidation (down from 17).

## Composition with agent-eval / agent-knowledge / sandbox

**Major gap:** no example shows the full self-improving loop composition. The README mentions `agent-runtime + agent-eval` in the install line but never shows:
- `runProductionLoop` from agent-eval consuming runtime traces
- `runAnalystLoop` from runtime feeding back into agent-eval surfaces
- `defineAgent` manifest mounting MCP servers + knowledge providers + matrix tests

**Fix:** ONE new example `examples/self-improving-loop/` that wires all four packages together for a tiny use case (5-10 personas × baseline profile, traces captured, analyst proposes one mutation, gate decides ship/no-ship). This is the marketing demo and the documentation centerpiece simultaneously.

**Effort:** 2 days. **Impact:** the "100x post-worthy" demo Drew wants exists.

## What needs to ship to reach 9/10

1. Reorder examples + delete redundant ones (top fix)
2. README cut to 150 lines + defaults table + decision tree
3. Split `backends.ts` (897→~5 files)
4. Add `self-improving-loop` composition example
5. Sweep JSDoc on all public exports
6. Add `pnpm bump:substrate` to skill + cron
7. Add 1 decision-tree image at top of README
8. Migration note for consumers still on 0.18.x

Estimated: 1 week of focused refactor work. After: this is launchable.
