# Capability-Delivery Manifest — the unified, future-proof structure

> **Track:** Reference · **Role:** the canonical delivery spec for [agent-runtime#267](https://github.com/tangle-network/agent-runtime/issues/267). Supersedes the prompt-only delivery in `src/intelligence/delivery.ts` (which folds only `prompt-surface` + `skill` into the system prompt). Designed via a judge-panel of four independent designs → adversarial synthesis. Builds on `docs/artifact-lifecycle-frontier.md`'s `{file|process|infra}` skeleton.

## 0. BLUF

One certified unit of agent power = **`{ interface, binding }`**.

- The **interface** is the only thing the agent and the certify lane ever reason about (a tool / an MCP toolset / a prompt-context / a retrieval surface / a hook / a subagent).
- The **binding** is a **tagged union over runtime kinds** that the delivery layer collapses (inline / file / http / sandbox-code / mcp-stdio / mcp-remote / process-on-infra / rag-index / memory-store / …).

A single `resolve()` lowers any binding into one uniform `ResolvedSurface`, consumed identically by the in-process seam (`RouterToolsSeam` / agent-app `extraTools`) and the sandbox seam (`AgentProfile`). **Composition — "an MCP that must be hosted in a sandbox" — is a recursive binding (`process-on-infra { inner }`), not a special case.** The manifest is a strict generalization of the shipped `CertifiedProfile`: a prompt is `Capability{ kind:'prompt', binding:{kind:'inline'} }`, so the existing `pullCertified → composeCertifiedPrompt → fail-closed` lane is preserved, not reshaped.

**The law that makes it future-proof: interfaces are closed; bindings are open.** A new runtime kind (WASM, A2A, k8s, TEE) = one new binding arm + one resolver case. Nothing else moves — not the interface taxonomy, the agent surface, the certify lane, or the wire shape.

## 1. The two axes

```typescript
// AXIS 1 — INTERFACE: what the agent consumes. CLOSED. (maps slot-for-slot onto
// AgentProfile + RouterToolsSeam.) A new runtime kind NEVER extends this.
type CapabilityInterface =
  // A `tool` LOWERS TWO WAYS by binding: in-process → a `ToolSpec` +
  // `executeToolCall` (the HOST seam: `RouterToolsSeam` / agent-app `extraTools`);
  // in a sandbox → an MCP server (`AgentProfileMcpServer`) or `sandbox-code`.
  // `AgentProfile.tools` is `Record<string,boolean>` BOX FLAGS and CANNOT carry
  // a tool def — so a certified tool reaches a box only via `mcpConnections`.
  | { surface: 'tool'; name; description; parameters: JSONSchema; returns? }
  | { surface: 'mcp'; serverName; toolset? }            // schemas inferred from tools/list
  | { surface: 'context'; kind: 'prompt-surface'|'skill'|'instructions'; name }
  | { surface: 'retrieval'; name; description; topK? }  // uniform retrieve(q)->hits
  | { surface: 'hook'; event; matcher? }
  | { surface: 'subagent'; name; description }

// AXIS 2 — BINDING: how it's backed. OPEN tagged union. THE extension point.
type DeliveryBinding =
  // FILE class — deliver = write bytes (the shipped path)
  | { kind: 'inline'; content: ContentRef }
  | { kind: 'file'; path; content: ContentRef; executable? }
  // TOOL-CODE class — deliver = code the agent calls
  | { kind: 'http'; url; method?; auth?: CredentialRef }            // OpenAI-schema HTTP tool
  | { kind: 'sandbox-code'; entry; code: ContentRef; runtime?; harness? }
  // PROCESS class — deliver = a running server. STRICT discriminated union; it
  // LOWERS to the SDK's FLAT `AgentProfileMcpServer` (all fields optional on one
  // shape, NO per-transport enforcement) — a narrowing→widening, always-valid.
  | { kind: 'mcp-stdio'; command; args?; env?; cwd? }               // → AgentProfileMcpServer{transport:'stdio'}
  | { kind: 'mcp-remote'; url; transport: 'http'|'sse'; headers? }  // → {transport:'http'|'sse'}
  // COMPOSED — a binding whose host must itself be provisioned. RECURSIVE.
  // "a certified MCP hosted in a sandbox" === this. Resolve depth-first: host before inner.
  | { kind: 'process-on-infra'; host: HostSpec; inner: DeliveryBinding }
  // INFRA class — deliver = provisioned store + a connection (stateful; standing cost lives here)
  | { kind: 'rag-index'; index: ContentRef; embedModel; topK? }
  | { kind: 'memory-store'; provision: 'sqlite'|'neo4j'|'vector'; seed? }
  // EXTENSION POINTS (future arms — additive, agent-invisible)
  | { kind: 'wasm'; module: ContentRef; exports }                  // → tools
  | { kind: 'a2a'; endpoint; card: ContentRef; auth? }             // → subagent

// HostSpec reuses createExecutor's backend-as-data enum — no new runtime invented.
interface HostSpec { backend: 'sandbox'|'router'|'cli'; image?: BackendType; ports?; warm?; idleTtlMs?; costTag? }

// Content + credentials are REFERENCES resolved lazily per-tenant — a leaked
// manifest carries no live secret.
type ContentRef = {kind:'inline';content} | {kind:'github';repository?;path;ref?} | {kind:'blob';uri;sha256;bytes}
type CapabilityAuth = {mode:'none'} | {mode:'tangle-key'} | {mode:'hub-connection';providerId;scopes?} | {mode:'secret-ref';key}

interface CertifiedCapability { id; iface: CapabilityInterface; binding: DeliveryBinding; auth: CapabilityAuth; provenance: CertProvenance }
interface CapabilityManifest { target; generatedAt; promptSurface: CertifiedPromptSurface|null; capabilities: CertifiedCapability[] }
```

`CertProvenance` = today's `CertifiedArtifact` envelope verbatim (`{contentHash, version, lift, promotedAt}`) — the gate's held-out lift travels with delivery; `version`/`hash`/`lift` are stamped by the promote step, never the author.

## 2. Composition — all forms, one shape

```typescript
// MCP-in-sandbox — process-on-infra is recursive: inner is an ordinary mcp-stdio,
// host provisions a box first. Schemas omitted → inferred from tools/list at resolve.
{ id:'ticketing', iface:{surface:'mcp', serverName:'ticketing'},
  auth:{mode:'hub-connection', providerId:'servicenow', scopes:['ticket.write']},
  binding:{ kind:'process-on-infra',
            host:{ backend:'sandbox', image:'cli-base', ports:[8931], warm:true, idleTtlMs:600_000, costTag:'mcp/ticketing' },
            inner:{ kind:'mcp-stdio', command:'node', args:['server.js'] } } }
// HTTP tool (OpenAI schema) — pure tool-code, no process/infra:
{ iface:{surface:'tool', name:'fx.convert', ...}, binding:{kind:'http', url:'…', auth:{secretRef:'FX_API_KEY'}} }
// Sandbox code blob — a tool whose body runs in a box per call:
{ iface:{surface:'tool', name:'pdf.extractTables', ...}, binding:{kind:'sandbox-code', entry:'extract.py', runtime:'python', code:{kind:'blob',…}} }
```

After `resolve`, the agent's tool list is `ticketing.*`, `fx.convert`, `pdf.extractTables` — **indistinguishable**. Re-binding `fx.convert` from `http` to `process-on-infra(mcp)` next week changes nothing in the agent program, prompt, or scorecard.

## 3. The resolver — one contract, both seams

`resolve(manifest, ctx) → ResolvedSurface` is the **only** place that knows binding kinds. It fans every binding into the same slots:

```typescript
interface ResolvedSurface {
  tools: ToolSpec[]                                  // → RouterToolsSeam.tools / agent-app extraTools
  execute(name, args, task): Promise<string>         // → executeToolCall / executeOtherTool
  mcpConnections: Record<string, AgentProfileMcpServer> // → AgentProfile.mcp / in-proc createMcpEnvironment
  promptAdditions: string[]                           // → composeCertifiedPrompt (generalized past prompt+skill)
  files: Array<{path, content, executable?}>          // → AgentProfile.resources.files
  retrieval: Array<{name, retrieve(q,k?)}>            // uniform; agent never learns vector vs graph
  hooks; subagents
  dispose(): Promise<void>                            // process/infra teardown (reverse dep order)
}
```

- **Depth-first nesting** (host before inner) with a **visited-set cycle guard** → `process-on-infra` falls out for free.
- **Per-arm lowering reuses shipped primitives** (no new transport machinery): `inline`→`composeCertifiedPrompt`; `http`→fetch tool (the HOST seam — a `ToolSpec` + `executeToolCall`, NOT a box profile entry, since `AgentProfile.tools` is `Record<string,boolean>` box flags); `sandbox-code`→`openSandboxRun`; `mcp-stdio`/`mcp-remote`→the strict union widens to the SDK's FLAT `AgentProfileMcpServer` (a trivial always-valid lowering, not a translation); `process-on-infra`→`createExecutor({backend:'sandbox'})` boot→serve→recurse; `rag/memory`→`createMcpEnvironment`-backed handle + `close()`.
- **Last mile is the ONLY seam difference:** sandbox → fold into an `AgentProfile` (generalize `composeProductionAgentProfile` from mcp-only to all slots); in-process → `RouterToolsSeam.{tools, executeToolCall}` + folded prompt + an in-proc `createMcpEnvironment` pool.
- **Post-resolve drift check (fail-closed):** every tool/mcp surface's live `tools/list` must equal the certified interface (names + sanitized schema hashes) — mismatch → drop. The only callable tools are gate-blessed ones.

## 4. The experiences

**Agent:** one flat tool list + a folded prompt + optional `retrieve()` handles + workspace files. It calls `fx.convert(...)` / `ticketing.open(...)` identically; `binding.kind` does not exist in its world. Unavailability is graceful (a capability that fails to provision is simply **absent** — `pullCertified`'s fail-closed posture, generalized). Seam-invariant: same surface + same scorecard in-process or in a sandbox.

**Dev:** `defineCapability({ iface, binding })` once; the binding is mostly **inferred** from artifact shape (`.md`→inline; dir+`package.json`+server→mcp-stdio; module+schema→http or sandbox-code; built index→rag-index). Auth declared as a **requirement**, never a secret. Certify is the existing lane unchanged (kind selects the intrinsic verifier → universal held-out `replayAblation` lift gate → promote stamps provenance). **Declare once, certify once, deliver anywhere** — the resolver, not the author, owns the seam. Re-binding (prototype as `http`, harden to hosted MCP) is a one-line edit; the gate re-runs the same verifier before promote.

## 5. Failure modes (handled by construction)

Auth (per-tenant at resolve, never inlined) · versioning (pin by contentHash so a mid-session promote can't swap wiring under a running agent) · provision failure (typed per-capability outcome → drop, never a half-wired tool) · tenancy (`tenant#target` namespacing for billing + teardown) · teardown (`dispose()` reverse-order + `idleTtlMs` reap) · standing cost (`HostSpec.{warm,costTag}` meters operation not just build) · cold-start (`warm:false` lazy / `warm:true` pre-provision; recurse only after healthy) · post-promotion drift (the `tools/list`-equals-certified check every provision).

## 6. Minimal buildable core + the ladder

**Slice 1 (the spine, ~zero new infra):** `capability.ts` types + the resolver for **inline/file**, **mcp-stdio/mcp-remote**, and **http** tools, for **both** seams. Achievable now — `composeCertifiedPrompt` already does inline; `buildDelegationMcpServer` already emits mcp-stdio; `AgentProfileMcpServer.transport` already does mcp-remote; `http` is a thin fetch tool. Concretely: `delivery.ts` returns `CapabilityManifest`; generalize `composeCertifiedPrompt` → `composeCertifiedProfile` (full `ResolvedSurface`, not a string); add `resolveMcp`/`resolveHttp`; `composeProductionAgentProfile` merges the slots. **Delivers the full profile (prompt+skill+tool+mcp) to both seams with no provisioning.**

**Ladder (each rung = one union arm + one resolver case + its lifecycle):**
1. `http(openai-tool)` — keyed-endpoint tools, zero standing cost (cheapest first).
2. `sandbox-code` — per-call code via `openSandboxRun`.
3. `mcp-stdio` in-process via `McpTransport` + `mcpServeVerifier` as the ready-probe.
4. `process-on-infra` — first provisioner (boot→serve→recurse + `dispose` + `costTag`). **MCP-in-sandbox lands here.**
5. `rag-index` / `memory-store` — `ContentRef.blob` + the retrieval slot + drift-watch + warm-keep. **Last**, gated on the E3 admission laws (retrieval lift must clear score-superiority — `memory/e3-certified-memory-verdict`).
6. `wasm` / `a2a` — extension-point proof arms.

## 7. Mapping onto the lane (deltas)

- `CertifiedArtifact` → preserved verbatim as `CertProvenance`; `path`/`content` move into the binding arm.
- `CertifiedProfile` → `CapabilityManifest` (`artifacts: Record<type,…>` → `capabilities: CertifiedCapability[]`); `promptSurface` kept during migration. `pullCertified` unchanged (still JSON; its 404/timeout fail-closed becomes the resolver's failure model).
- Plane `GET /v1/profiles/:target/composed` returns `CapabilityManifest`; free-string `artifactType` → typed `iface.surface`; `artifactVersions`/rollback reused for re-binding.
- `composeCertifiedPrompt` (`delivery.ts`) → one arm of `composeCertifiedProfile`; byte-stable ordering preserved for the `promptAdditions` slot.
- **Substrate boundary honored:** all in `src/intelligence/` + `src/runtime/`, depending down on `@tangle-network/sandbox` + `agent-eval`. The strict `mcp-stdio`/`mcp-remote` binding union LOWERS to the SDK's FLAT `AgentProfileMcpServer` (one shape, all fields optional, no per-transport enforcement) — a narrowing→widening, so "no translation" is precisely "a trivial always-valid lowering": a resolved sandbox delivery is valid `defineAgentProfile` input by construction.
