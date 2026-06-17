# Agent type unification — migration spec

Goal: one harness- and sandbox-neutral home for the **native** agent/trace vocabulary, so that
**router-backed agents** (the off-box owned loop) and **sandbox-backed agents** share one type set,
and the tool-call decoding logic stops being re-derived in three places.

This is the execution plan behind the "full migration" decision. It is grounded in a cross-repo
diff-map (agent-interface vs the sandbox SDK vs cli-bridge vs agent-eval), verified 2026-06-17.

## The two vocabularies (keep them separate)

| Vocabulary | Canonical home | Examples | Depends on |
|---|---|---|---|
| **native / wire** | `@tangle-network/agent-interface` (leaf, `zod`-only) | `Part`, `ToolPart`, `ToolState`, `BackendType`, `BackendConfig`, `SessionMessage`, `AgentProfile*` | nothing |
| **analysis** | `@tangle-network/agent-eval` (leaf, harness-agnostic) | `ToolSpan`, `RunRecord`, detectors, trajectory | nothing |
| **the bridge** | `agent-runtime` | `decodeToolPart`: native `Part` \| OpenAI tool_call → `ToolSpan` | both leaves |

agent-eval stays harness-agnostic — it must NOT import agent-interface. agent-runtime is the
confluence that maps native→analysis.

## Current state (the diff-map)

- **agent-interface already owns the full trace vocabulary**: `ToolPart` (`{type:'tool', callID?, tool, state}`),
  `ToolState` (pending/running/completed/error), `Part`, `ToolInvocation`, `BackendMessage`
  (`parts: Array<Part | InputPart | unknown>`). The opencode part shape that `trace-source.ts`
  reverse-engineered IS this `ToolPart`. → Half 1 needs **zero** type moves.
- **The neutral backend/session types live ONLY in the sandbox SDK** (`products/sandbox/sdk/src/types.ts`):
  `BackendType` (14 variants), `BackendConfig`, `SessionMessage`. The sandbox SDK does **not** import
  agent-interface; it defines these independently. → Half 2 moves.
- **`SessionMessage.parts: unknown[]`** (coarse) — this is the exact thing forcing every downstream
  consumer to defensively decode. Typing it `Part[]` is the single highest-leverage fix.
- **`AgentProfile` is split**: the canonical TS interface lives in the sandbox SDK
  (`agent-profile.ts`); agent-interface owns only the matching Zod schema (`profile-schema.ts`).
  Unifying these is delicate (fleet's most-used type) → its own staged PR, not folded into the sweep.
- **cli-bridge** re-derives all of this inline (`src/backends/types.ts` + 4× `extractToolUse`),
  depends on a stale `@tangle-network/sandbox ^0.0.3`.

## The release-engineering linchpin

agent-interface today publishes to **private GitHub Packages** (it is in the `SDK_PACKAGES` list in
`release-snapshot.yml`). Public npm gets only an allowlist (`@tangle-network/sandbox`, `sandbox-cli`)
via dedicated workflows. The release config explicitly warns against dual-publishing one name to both
registries (it strands versions).

For router-backed/public repos (agent-runtime, cli-bridge) to depend on agent-interface — and for the
public sandbox SDK to re-export from it — **agent-interface must move to public npm**:
1. Add `publish-agent-interface.yml` mirroring `publish-sandbox-sdk.yml` (OIDC trusted publishing).
2. Remove `packages/agent-interface` from the GH-Packages `SDK_PACKAGES` list (avoid dual-publish stranding).
3. The 15 in-repo consumers resolve it via `workspace:*` at build time and from public npm at install
   time — verify their `.npmrc` scope config doesn't pin `@tangle-network` to GH Packages only.

This is the one fleet-release decision the whole migration hinges on.

## Sequenced execution (each step its own PR, dependency-ordered)

**Half 1 — trace/tool vocabulary (low risk, solves the original problem + the router goal):**
1. **adc**: enable agent-interface on public npm (the linchpin above). No type changes. Publish (gated).
2. **agent-runtime**: `decodeToolPart` decodes against the real `ToolPart`/`ToolState` from
   agent-interface (delete the reverse-engineered shapes; keep the OpenAI tool_call adapter for the
   router path, which is genuinely a different shape).
3. **cli-bridge**: backend extractors consume agent-interface `Part`/`ToolPart`; delete the inline
   `ChatMessage` dup + the 4× `extractToolUse`.

**Half 2 — backend/session vocabulary (the "pull out of the sandbox" stretch, fleet-rippling):**
4. **adc**: move `BackendType` + `BackendConfig` into agent-interface; type `SessionMessage.parts` as
   `Part[]`; sandbox SDK re-exports all three (additive for its consumers). Republish sandbox SDK (gated).
5. **adc (separate, delicate)**: unify `AgentProfile` — make the sandbox SDK's TS interface and
   agent-interface's Zod schema one source of truth. Own PR, own review.

**Publishes are gated**: every npm publish here (agent-interface first-publish, sandbox SDK republish)
ripples to the fleet — operator-triggered, never fired automatically by this work.
