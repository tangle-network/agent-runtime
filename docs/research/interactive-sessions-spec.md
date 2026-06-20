# Spec — interactive (tmux) harness sessions + live streaming

**Vision (one sentence):** instead of headless one-shot CLI calls, each agent in a supervised run is a **live, interactive harness session in its own tmux window** (driveable, observable, resumable), the whole agent tree is one tmux session, and it streams to a browser — composing with the recorded animated replay.

**Why now:** the whole real chain already delivers — an opencode supervisor drives opencode workers via the coordination MCP, a real deployable check gates delivery (`bench/src/atom-mcp-e2e.mts`, `972707f`). What's missing is (a) the agents run *headless* (one prompt → output), so you can't watch or interact, and (b) the harness-specific glue lives in a bench script, not the substrate. This spec turns both into a real, generalized capability.

## Placement — who owns what (obeys the AgentProfile law + the layering)

The law: *an agent IS its AgentProfile; you change behavior by authoring the profile and letting the substrate materialize it — never specialize the runtime to a harness.* That decides the split cleanly:

| Layer | Owns | Why |
|---|---|---|
| **agent-runtime** (this repo) | The **recursion + the ports**: the coordination MCP over the Scope (`serveCoordinationMcp`, done), a generic **`session` Executor** that opens/drives/observes a session via the substrate's API (NOT tmux-aware), the shared `Workspace` seam, the journal→replay. | The runtime stays harness-agnostic. It drives; it never spawns tmux or knows what opencode is. |
| **agent-dev-container** (adc) | The **materialization**: given an `AgentProfile` + cwd + mcp config, stand up the harness as an **interactive tmux window** (the TUI, not `run`), materialize the FULL profile (skills as real SKILL.md files, tools, model, mcp), capture (`pipe-pane`) + stream (`ttyd`). Exposes a **session API** (create / send / observe / status / kill). | "the container where the agents actually live" — Drew. This is the harness-specific layer; it belongs in the substrate, never the runtime. |
| **cli-bridge** | Stays the *headless* harness materializer (the test target + the fast path). Optionally grows the same session API for local runs. | Already proven; the adc is the richer/interactive home. |
| **sandbox SDK** | The `AgentProfile` manifest + box abstraction the adc is a flavor of. | Where the profile shape + `resources.skills` materialization already live. |

**The seam** = a small **session API** the adc exposes and the runtime's `session` Executor consumes:
`POST /sessions {profile, cwd, mcp} → {id, ttydUrl}` · `POST /sessions/:id/send {text}` · `GET /sessions/:id/stream` (SSE: harness output + a done/settle signal) · `GET /sessions/:id/status` · `DELETE /sessions/:id`. The runtime drives the recursion through the coordination MCP; the substrate drives the *harness* through this API.

## Where the issue goes
- **Primary issue → `tangle-network/agent-dev-container`** (the materialization + the session API + ttyd). This spec is the design ref.
- **Companion issue → `tangle-network/agent-runtime`** (the generic `session` Executor + the shared `Workspace` wiring + replay-compose). Small; mostly the executor seam.
- **Track on `ops-board`** (lane: eng, owner: claude) with measurable done-criteria = the e2e checklist below.

## End-to-end checklist (the map to "done")

### Phase 0 — preconditions (DONE)
- [x] Coordination MCP over a live Scope (`serveCoordinationMcp`, real test).
- [x] Proof a coding harness mounts + calls it (`mcp-mount-probe`).
- [x] Whole headless e2e delivers (`atom-mcp-e2e`).
- [x] Standard `skills/supervise/SKILL.md`.

### Phase 1 — substrate: AgentProfile materialization (adc + bridge)  *(Drew's "materialize the entire profile")*
- [ ] Materialize `resources.skills` as real `SKILL.md` files in the harness skill dir (opencode `~/.config/opencode/skill/` + project `.opencode/skill/`; verify the exact dir per harness) — loaded natively, NOT a prompt note.
- [ ] Materialize tools, model, system prompt, mcp (mcp already works — `type:'http'`).
- [ ] One `materializeAgentProfile(profile, dir)` per harness; remove the bench script's cwd-writes.
- [ ] Exit: a profile with a skill drives behavior with zero prompt-stuffing (probe: agent uses a skill it was never told about in the prompt).

### Phase 2 — substrate: interactive tmux session + session API (adc)
- [ ] `tmux new-session`/`new-window` per run/agent; run the harness in **interactive** mode (TUI), one window per agent, named by agent id.
- [ ] Drive: send the prompt (send-keys or the harness's stdin protocol); detect completion (harness done-signal / sentinel) → emit a settle event.
- [ ] Capture: `pipe-pane` → a transcript stream (for the journal).
- [ ] The session API (create/send/stream/status/kill) over HTTP.
- [ ] Resource governance: max concurrent windows, per-session timeout, cleanup on settle/crash.
- [ ] Exit: `POST /sessions` with a profile → a live tmux window you can `tmux attach` to; `/stream` yields output + a done signal.

### Phase 3 — runtime: the generic `session` Executor (agent-runtime)
- [ ] A `session` backend on the `Executor` port: `execute` calls the substrate session API (create → send task → stream until done) and settles with the result; `deliver` → `/send` (steer); `teardown` → `/kill`. Harness-agnostic.
- [ ] Wire `makeWorkerAgent` (coordination MCP) → the `session` executor, selected by the worker's `AgentProfile.backend`.
- [ ] Exit: `spawn_agent` → a worker that runs as a live interactive session, settles on its deployable check.

### Phase 4 — shared workspace (agent-runtime)  *(the e2e's open design point)*
- [ ] Supervisor + its workers share ONE `Workspace` (gitWorkspace) — workers branch/worktree, deliver back so the supervisor (and the next worker) build on one artifact. Fixes the "files missing" confusion.
- [ ] Exit: a 2-worker run where worker-2 builds on worker-1's committed output.

### Phase 5 — streaming + viz (adc + the viewer)
- [ ] `ttyd` serves the run's tmux session over a websocket; auth (bearer); a stable URL per run.
- [ ] A viewer page: the live tmux stream (now) beside the **animated replay** (the recorded tree) + the topology — one screen, live + history.
- [ ] Exit: open the URL, watch the supervisor + worker panes work in real time; scrub the replay after.

### Phase 6 — prove it e2e (no mock)
- [ ] The whole chain on interactive sessions: supervisor (tmux) authors profiles → `spawn_agent` → worker (tmux) codes in the shared workspace → real test gates → delivered — all streamed live, all journaled, replayable.
- [ ] Retire `atom-mcp-e2e`'s harness-specific shortcuts (now: author profiles, the substrate materializes).
- [ ] Exit: a recorded run URL + the replay + green deployable check.

## Open design points (decide during Phase 2–4)
- **Interactive vs headless harness mode:** does opencode/claude-code expose a driveable interactive TUI, or do we run `run` *inside* the pane for the live-output view? (Headless-in-a-pane is the cheap first cut; true interactive is the goal.)
- **Completion detection** in a TUI (sentinel vs a harness done event).
- **Session lifecycle:** resume after a crash (the journal already supports replay/resume — extend to sessions).
- **Security:** ttyd exposure + the coordination MCP exposure (bind localhost / authd tunnel).
- **Concurrency:** N agents = N windows; the adc's resource limits.

## Net
The runtime is essentially done for this (coordination MCP + the executor port + replay). The new work is a **substrate capability in the adc** (interactive tmux sessions + full-profile materialization + ttyd), reached through one small session API and one generic `session` executor in the runtime. Nothing here specializes the runtime to a harness.
