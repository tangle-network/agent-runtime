# Harness × capability matrix — what a driver can actually steer

> Research capture (2026-06-15). Ground truth = local `--help` + cli-bridge source + vendor docs (cited). Living doc — extend per harness as the fleet grows.

**BLUF: none of claude-code / codex / opencode has a `/goal` command.** "Run until done" is NOT a native primitive on any harness — it is emergent behavior from *(non-interactive exec) + (full-auto / skip-permissions) + (the model choosing to keep going)*. That emergent loop is the **runaway surface a driver must gate**, not a feature it dispatches into. cli-bridge today runs all three **single-shot** (`claude -p` / `codex exec` / `opencode run`), so runaway is currently capped at the bridge by `timeoutMs` + `killTree`.

Harnesses wired via cli-bridge: **claude-code** (2.1.177), **codex** (0.139.0), **opencode** (1.14.35), + gemini, claudish, kimi-code. Sidecar registry lists 12 bindings; these 3 are the load-bearing coding columns.

## Matrix

| Capability | claude-code | codex | opencode |
|---|---|---|---|
| **`/goal` / run-until-done** | **NO** — emergent under `--dangerously-skip-permissions`; no native step cap | **NO** — emergent via `codex exec` + bypass; GPT-5.x marketed for multi-hr autonomy | **NO** — but bounded by `steps` config (hard iteration ceiling) |
| **Auto/deep-research loop** | NO native (WebSearch+WebFetch, model loops) | NO native (model + web/MCP) | **PARTIAL** — built-in `scout` (read-only ext-docs) / `explore` (read-only code) subagents |
| **Sub-agent / spawn** | **YES** — Task tool (`run_in_background`), `--agents`; ~10 parallel soft cap | **YES** — `max_threads=6`, **`max_depth=1`** (no nesting) default | **YES** — `task` tool / `@mention`; no documented concurrency cap |
| **Parallelization** | YES (parallel tools + bg Tasks) | YES (up to ~8, capped by max_threads) | YES (parallel subagents, isolated contexts) |
| **MCP (stdio/http)** | YES both — `--mcp-config` + `--strict-mcp-config` | YES both — **no flag**; `config.toml [mcp_servers]` via synthetic `CODEX_HOME` | YES both — **no flag**; `OPENCODE_CONFIG` env; http key = `"type":"remote"` |
| **Disable native tools (arm isolation)** | **YES** — `--disallowed-tools` (the only clean per-tool disable) | **WEAK** — only `--sandbox` modes; cli-bridge fail-closes hosted-safe | **PARTIAL** — `permission` map in config; cli-bridge fail-closes hosted-safe |
| **Hooks / resume / durability** | YES — `--resume`, `--from-pr`, hooks | YES — `codex exec resume`, fork/archive, `--ephemeral` | YES — `-s` resume, fork, export/import, `serve`+`attach` |
| **Slash / skills** | YES — full skills + plugins ecosystem | YES — `/plan /exec /review /agent`, skills TOML | YES — agents/variants/plugins as config |

## Driver-relevant warnings (the steering inputs)

1. **No `/goal` anywhere** → the driver *constructs* the loop. Decision = bounded single-exec (cli-bridge default, safe) vs full-auto (unbounded, needs an external wall).
2. **Runaway ranking (high→low):** codex (bypass = zero gates, full shell) ≈ claude (skip-perms, no step cap) **>** opencode (`steps` = in-band ceiling). If autonomy is on, codex/claude need an *external* wall-clock/token budget; opencode can be bounded in-band.
3. **Sub-agent fan-out is the second runaway surface.** codex `max_depth=1` by default — **do not raise casually** (token blowup, vendor-warned); claude ~10 soft; opencode unbounded. A delegating driver must set its own cap.
4. **Clean A/B tool-isolation only on claude** (`--disallowed-tools`). codex/opencode have no per-tool disable → cli-bridge correctly fail-closes hosted-safe rather than faking it.
5. **Three different MCP wiring mechanisms** (file-flag / synthetic-HOME-TOML / env-config-file) — no uniform `--mcp-config`. opencode http = `"type":"remote"`+`url` (the MEMORY `transport:'http'` note is the *claude/kimi* `--mcp-config` layer, a different file).
6. **Resume identity differs per harness** (claude uuid / codex thread_id / opencode session id) — a driver resuming across a sandbox boundary must keep the external→internal id map per-harness; ids are not cross-harness valid.

## Pending columns

- **prime** — Prime Intellect's agent OS (persistent IPython kernel, native `rlm(…)`
  subagents, `/refine` continual-harness edits, daemon-backed session trees). The id
  shipped in `agent-interface` `HarnessType` + the sandbox backend enum; see
  [design/prime-agent-harness-integration.md](../design/prime-agent-harness-integration.md).
  **Do not inherit `pi`'s row** — Prime is Pi-lineage but the fork's wire protocol has
  diverged (its daemon rejects pi-line clients); every cell must be measured against the
  real CLI before this column fills in.
  Expected steering-relevant deltas to verify: native subagent fan-out cap and whether it
  is configurable (runaway surface #3), whether the daemon protocol allows mid-step
  interrupt (black-box harnesses today degrade `steer_agent({interrupt:true})` to next
  spawn), and whether tool activity surfaces as structured parts or only via the kernel.

## Files
`~/code/cli-bridge/src/backends/{claude,codex,opencode}.ts` (invocation), `.../profile-support.ts` (MCP materializers), `.../modes.ts` (byob/hosted-safe gating); `~/code/agent-dev-container` sidecar registry (12 bindings).
