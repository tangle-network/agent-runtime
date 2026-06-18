[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / LoopLineageOptions

# Interface: LoopLineageOptions

Defined in: [runtime/types.ts:267](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L267)

**`Experimental`**

Opt-in box-lineage controls for `runLoop`. Default OFF — with both flags
unset the kernel's per-iteration behavior is byte-identical to acquiring a
fresh box, streaming once, and tearing it down. The independence of N fresh
boxes (e.g. `random@k`) is a compute-control invariant; these flags must
never apply to it. Enable them ONLY on a steered loop (refine / planner-driven
fanout) where reusing the parent's context is intended.

Live-box footprint: the lineage keeps every box it starts or forks alive
across rounds so a later round can descend from it, and tears them down at
loop end. When the driver's branch point is kernel-inferred (no
`describePlan` — refine, fanout-vote), the kernel prunes boxes no future
round can reach after each round, so the live set tracks the active frontier.
When the driver authors its own branch point (`describePlan().parentIndex`),
it may descend from any prior
iteration, so no box is pruned and the live-box count rises to the total
iterations across all rounds. Size `forkFanout` runs accordingly (CRIU forks
are copy-on-write, but each is still a live box until loop end).

## Properties

### sessionContinuity?

> `optional` **sessionContinuity?**: `boolean`

Defined in: [runtime/types.ts:282](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L282)

**`Experimental`**

When true, a refine round (1 planned task) descending from a prior round
CONTINUES the parent iteration's session on the SAME box
(`streamPrompt({ sessionId })`) instead of acquiring a fresh box and
re-injecting prior context as prompt text. Round 0 (no parent) always
starts fresh. Usable on any single-task path, not just the refine driver.

Requires a platform that honors a client-supplied `sessionId`. The lineage
mints the id and `continue` asserts the session is still live
(`box.session(id).status()`), failing loud if the platform dropped it — so a
non-honoring platform errors instead of silently running contextless turns.
Verify continuity against the live platform before enabling: the assertion
proves the session EXISTS server-side, not that prior turns replay into it.

***

### forkFanout?

> `optional` **forkFanout?**: `boolean`

Defined in: [runtime/types.ts:297](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L297)

**`Experimental`**

When true AND the platform reports CRIU fork support, a fanout round (N
planned tasks) descending from a prior round FORKS the parent iteration's
checkpoint so all N branches inherit a shared context prefix. Without fork
support it degrades to N independent fresh boxes (same result, no prefix).
Round 0 always starts fresh. NEVER set this for a `random@k` control arm —
forking would couple the independent samples.

A real fork inherits the parent's IMAGE/PROFILE: per-branch `AgentRunSpec`
profiles are honored only on the degraded fresh-box path, so a
heterogeneous-profile fanout silently homogenizes to the parent's profile
when fork is available. Use this for same-profile branching; for
different-per-branch profiles use the unforked fanout path.

***

### streaming?

> `optional` **streaming?**: `"sse"` \| `"poll"`

Defined in: [runtime/types.ts:309](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L309)

**`Experimental`**

Per-turn sandbox streaming mode. Default `'sse'` (live `streamPrompt` —
low-latency, full per-token trace; best for interactive chat). `'poll'`
fire-and-detaches via `dispatchPrompt` and awaits the terminal result by
status-polling, so a long, quiet in-box turn (clone + build + test) never
holds a live stream a proxy idle-timeout can drop mid-execution. Lower trace
fidelity (one terminal event), so it is opt-in — intended for BATCH eval
runs, which don't need live streaming and were losing long turns to the
idle-drop. Applies to the default fresh-box path too, not only when
`sessionContinuity`/`forkFanout` are on.
