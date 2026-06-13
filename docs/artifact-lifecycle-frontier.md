# Artifact lifecycle frontier — proposing tools, MCPs, memory & RAG, not just skills

Design map produced alongside the Gen-7 `agenticGenerator` verify-loop pursuit. Companion to
[agent-runtime#267](https://github.com/tangle-network/agent-runtime/issues/267) (the runtime kernel)
and `products/intelligence/IMPROVEMENT-PLANE.md` (the hosted plane). This enumerates exactly what
remains to make every artifact type a first-class citizen of the improvement loop.

## The keystone: every type rides one lane; types differ in only two stages

The lifecycle is `generate → verify → certify → promote → compose → deliver`. Five of those six
stages are **type-agnostic and already built** (the lane, evidence rows, promotion policy, versioning,
the composed-profile read — all shipped in the intelligence plane; the replay/ablation fitness
function in #2035). An artifact type is defined by exactly **two** answers:

1. **Generate** — what produces a candidate of this type.
2. **Verify** — its *fitness function*: a two-level checker = (a) **intrinsic validity** (does it
   compile / serve / retrieve at all?) and (b) **marginal lift** (does an agent *with* it beat one
   *without* on held-out work? — `replayAblation`, built and R2-calibrated).

So "support a new artifact type" reduces to: pick a generator, write its intrinsic checker. Marginal
lift is already universal.

## The realization that collapses most of the work

**`agenticGenerator` + `commandVerifier` (shipped this generation) is the universal buildable-artifact
factory.** "Build code in a worktree, re-try until a verifier passes" is exactly what a tool, an MCP
server, a hook script, and a RAG ingestion pipeline all need. They do not need bespoke generators —
they need the right verifier handed to the loop:

| Artifact | Generator | Intrinsic verifier handed to the loop |
|---|---|---|
| tool (code + tests) | `agenticGenerator` | `commandVerifier('tsc','--noEmit')` then the tool's own tests |
| mcp-server | `agenticGenerator` | **boot-and-probe** (start it, MCP handshake, `tools/list` answers) — *new* |
| hook | `agenticGenerator` | run on representative inputs, exit 0, session still healthy — *new, small* |
| rag-db (built index) | `agenticGenerator` (writes the ingest pipeline) | build succeeds + **retrieval precision/recall on a labeled query set** — *new* |

So the frontier is **writing per-type intrinsic verifiers**, not per-type generators. That is a much
smaller surface than the issue's original framing implied.

## Per-type question map

For each type: who generates, the intrinsic checker (the real open question), how lift is measured,
and how it's *delivered* (the second genuinely-new axis — see §"Delivery is where statefulness bites").

### skill / prompt-surface — DONE
Generate: `reflectiveGenerator` (distill) or `agenticGenerator`. Verify: marginal lift via
`replayAblation`. Deliver: text into the composed profile. **No open questions** — this is the shipped path.

### tool (executable code + tests)
- Generate: `agenticGenerator` with `commandVerifier` — *available now*.
- Intrinsic: compiles + the tool's own generated tests pass. **Q: who writes the tool's tests — the
  same agentic session, or a separate test-author pass?** (A test the implementer wrote can be
  vacuous; a separate adversarial test-author is the honest version.)
- Lift: agent-with-tool vs agent-without on tasks that need it. **Q: how do we synthesize tasks that
  exercise a *new* tool when no logged episodes use it yet?** (cold-start for tool lift.)
- Deliver: the file + its registration in the agent's tool manifest. Mostly text — tractable.

### mcp-server
- Generate: `agenticGenerator` — scaffold → implement → compile.
- Intrinsic: **boot-and-probe** — the hardest new checker. **Q: where does it boot?** (a sandbox, per
  the `sandbox` executor backend) **and what's "serves" exactly?** (process starts, MCP `initialize`
  handshake, `tools/list` returns the declared tools, one tool call round-trips). This is a real
  harness to build — propose `mcpServeVerifier(spec)`.
- Lift: agent-with-MCP-mounted vs without.
- Deliver: **not a file — a running process.** The composed profile can't "paste" an MCP; it must
  carry a config entry *and* a provisioning instruction. See §statefulness.

### hook (pre/post-toolcall script)
- Generate: `agenticGenerator`. Intrinsic: runs on representative tool-call inputs without error and
  doesn't wedge the session (`commandVerifier`-shaped). Lift: does the hook's enforcement reduce a
  named failure class (e.g. "reply lacks citation")? **Q: hooks are *guardrails* — their lift may be
  a reduction in a failure rate, not a score increase. Does the ablation metric capture
  failure-class reduction, or do hooks need a different fitness signal?**

### subagent (persona + tool allowlist + model)
- Generate: `reflectiveGenerator` (it's mostly config) or `agenticGenerator` if it ships scaffolding.
- Intrinsic: the composition instantiates and completes its scoped tasks. Lift: delegating-to-it vs
  not. **Q: a subagent's value is compositional — its lift depends on the *parent's* routing. Is
  marginal lift measured with a fixed parent, and does that generalize?**

### memory-db / research DB
- Generate: distill facts from traces (the prose path) **or** certify programs (the E3 path).
- Intrinsic: **retrieval quality** — querying it returns relevant entries (a retrieval eval over a
  labeled query set). Lift: agent-with-memory vs cold — *this is exactly the E3 read-side test,
  already run*. **Q: E3's hard-won laws apply — admission must BE the promotion gate, the read must be
  out-of-sample, score floor anchored to cold. Do those transfer from certified-program memory to
  free-text research DBs, where prose memory was negative ×4?**
- Deliver: a queryable store mounted/connected at provision.

### rag-db (built RAG database)
- Generate: `agenticGenerator` writes the ingestion+embedding+index pipeline; the *output* is the
  built index, not the code.
- Intrinsic: build succeeds (ingest+embed+index without error) **and** retrieval precision/recall on a
  labeled query set. **Q: this is the first artifact whose content is not text but gigabytes of
  index** — the lane stores a content-*ref* to blob storage, not an inline string. Schema impact.
- Lift: downstream task lift with the RAG retriever wired in.
- Deliver: a connection string + the provisioned, kept-warm index. Pure statefulness — see below.

## Delivery is where statefulness bites (the genuinely new plane question)

The composed profile today materializes *text* (skills, prompts) into a workspace at spawn. That model
breaks for the new types along a clean gradient:

- **File artifacts** (skill, prompt, tool code, hook): deliver = write content into the workspace. *Done.*
- **Process artifacts** (mcp-server, subagent): deliver = the profile carries a config entry, and
  *something must start the process*. The composed-profile read returns a spec; provisioning must act on it.
- **Infrastructure artifacts** (memory-db, rag-db): deliver = provision storage, load the index, hand
  back a connection, keep it warm, and meter its standing cost.

**The open question that spans the whole frontier: the composed profile must evolve from "materialized
text" to "a manifest of {inline content | process to start | infrastructure to provision}", and the
sandbox provisioner must learn to act on each kind.** That is the single largest piece of new work,
and it is a *delivery-plane* (products/sandbox + products/intelligence) concern, not a runtime one.

## Cross-cutting questions, split by plane

**agent-runtime (the system) — kernel, per #267's rescoped boundary:**
1. The per-type intrinsic verifiers as composable functions: `mcpServeVerifier`, `retrievalVerifier`,
   `hookSafetyVerifier` — all shaped like `Verifier` (shipped) or `replayAblation`.
2. `AgentSurfaces` extended from doc-dirs to buildable+stateful surface kinds (the type union is open
   already; the *validation* per kind is not).
3. `composeProfile` returning a manifest of mixed delivery kinds, not a flat text bundle.
4. Cost accounting for build *and* serve — an MCP/RAG artifact has standing runtime cost, not just a
   one-time build cost. The budget pool currently meters generation; it must meter *operation*.

**products/intelligence + products/sandbox (the plane):**
5. Lane storage for non-text artifacts: content-ref to blob for RAG indices; a process/infra spec, not
   a string, in `promotedArtifacts.content`.
6. The provisioner acting on a delivery manifest (start MCP, mount memory, wire RAG) — the write-back
   arc, now type-polymorphic.
7. Standing-cost billing: a promoted RAG db or MCP server bills while it runs, not just when built —
   new cost dimension beyond the per-call router metering.
8. Lifecycle for stateful artifacts: a retired RAG db must be *torn down*, not just dereferenced;
   drift-watch must re-test retrieval quality as the corpus ages.

## Sequencing (cheapest-first, each earns the next)

1. **tool** — `agenticGenerator` + `commandVerifier` is the whole generator; only the test-authorship
   and cold-start-task questions are open. Lowest new surface, immediate value. *Do first.*
2. **memory-db** — generation + the read-side fitness test already exist (E3); the open work is
   applying E3's admission laws. Reuses the most.
3. **mcp-server** — needs `mcpServeVerifier` (boot-and-probe) and the first *process* delivery. The
   first genuinely-new harness.
4. **rag-db** — needs blob-ref lane storage + infrastructure delivery + standing-cost billing. The
   heaviest; do last, after process-delivery is proven on MCP.
5. **hook / subagent** — small but their fitness signals are non-standard (failure-class reduction;
   compositional lift); fold in opportunistically.

The thesis in one line: **we already shipped the universal buildable-artifact factory (generate-and-
verify-in-session) and the universal fitness function (replay ablation); the remaining lifecycle work
is (a) one intrinsic verifier per non-code type and (b) teaching the composed profile + provisioner to
deliver process and infrastructure artifacts, not just text.**
