/**
 *
 * The Capability-Delivery Manifest — the unified, future-proof structure for
 * delivering ONE certified unit of agent power = `{ interface, binding }`.
 *
 * The law that makes it future-proof: **interfaces are closed; bindings are
 * open.** The interface is the only thing the agent and the certify lane ever
 * reason about (a tool / an MCP toolset / a prompt-context / a retrieval surface
 * / a hook / a subagent). The binding is a tagged union over runtime kinds that
 * the resolver collapses (inline / file / http / sandbox-code / mcp-stdio /
 * mcp-remote / process-on-infra / rag-index / memory-store / wasm / a2a). A new
 * runtime kind = one new binding arm + one resolver case; nothing else moves.
 *
 * This module owns the manifest TYPES and the lowering of TODAY's wire
 * (`CertifiedProfile`) into a `CapabilityManifest`. The resolver — the single
 * place that knows binding kinds and produces a uniform `ResolvedSurface` — lives
 * in `./resolver`. The shipped prompt-only path (`composeCertifiedPrompt` in
 * `./delivery`) is preserved verbatim: a prompt is a `Capability{ surface:
 * 'context', binding:{ kind:'inline' } }`, so the existing
 * `pullCertified → composeCertifiedPrompt → fail-closed` lane is a strict subset.
 *
 * Layering: this depends DOWN on `@tangle-network/sandbox` (the SDK
 * `AgentProfileMcpServer` shape the mcp binding lowers to) and on the runtime's
 * own `ToolSpec`. It never imports agent-eval and never reaches upward.
 *
 * @experimental
 */

import type { AgentProfileMcpServer } from '@tangle-network/agent-interface'
import type { ToolSpec } from '../runtime/router-client'
import type { CertifiedArtifact, CertifiedProfile, CertifiedPromptSurface } from './delivery'

// ── AXIS 1 — INTERFACE (CLOSED) ────────────────────────────────────────────────

/** A JSON Schema object describing a tool's parameters. Kept structural — the
 *  resolver forwards it verbatim into a `ToolSpec` / MCP `tools/list` check. */
export type JsonSchema = Record<string, unknown>

/**
 * What the agent consumes. CLOSED — a new runtime kind NEVER extends this. Each
 * arm maps slot-for-slot onto `AgentProfile` + the host `RouterToolsSeam`.
 */
export type CapabilityInterface =
  | {
      surface: 'tool'
      name: string
      description?: string
      parameters: JsonSchema
      returns?: JsonSchema
    }
  | { surface: 'mcp'; serverName: string; toolset?: string[] }
  | { surface: 'context'; kind: 'prompt-surface' | 'skill' | 'instructions'; name: string }
  | { surface: 'retrieval'; name: string; description?: string; topK?: number }
  | { surface: 'hook'; event: string; matcher?: string }
  | { surface: 'subagent'; name: string; description?: string }

/** Every interface surface tag — the closed set the resolver fans into slots. */
export type CapabilitySurface = CapabilityInterface['surface']

// ── Content + credential REFERENCES (resolved lazily per-tenant) ────────────────

/**
 * Where a capability's bytes live. A leaked manifest carries no live secret and
 * no inlined blob: `github`/`blob` are pointers resolved at provision time.
 */
export type ContentRef =
  | { kind: 'inline'; content: string }
  | { kind: 'github'; repository?: string; path: string; ref?: string }
  | { kind: 'blob'; uri: string; sha256: string; bytes?: number }

/** A named secret a binding requires — declared, never carried. */
export interface CredentialRef {
  key: string
}

/**
 * How a binding authenticates at resolve time. Declared as a REQUIREMENT in the
 * manifest; the live secret is resolved per-tenant by the resolver context,
 * never inlined here.
 */
export type CapabilityAuth =
  | { mode: 'none' }
  | { mode: 'tangle-key' }
  | { mode: 'hub-connection'; providerId: string; scopes?: string[] }
  | { mode: 'secret-ref'; key: string }

// ── AXIS 2 — BINDING (OPEN tagged union) ────────────────────────────────────────

/**
 * The host a `process-on-infra` binding provisions before its inner binding.
 * Reuses `createExecutor`'s backend-as-data vocabulary — no new runtime invented.
 * `image` is the sandbox image tag; `warm`/`idleTtlMs`/`costTag` meter standing
 * cost; `ports` are the inner server's listen ports the host must expose.
 */
export interface HostSpec {
  backend: 'sandbox' | 'router' | 'cli'
  image?: string
  ports?: number[]
  warm?: boolean
  idleTtlMs?: number
  costTag?: string
}

/**
 * How a capability is backed. OPEN tagged union — THE extension point. All arms
 * are typed even when the resolver does not yet admit them; an un-admitted arm
 * throws {@link CapabilityNotAdmittedError} at resolve, never silently no-ops.
 */
export type DeliveryBinding =
  // FILE class — deliver = write bytes (the shipped path).
  | { kind: 'inline'; content: ContentRef }
  | { kind: 'file'; path: string; content: ContentRef; executable?: boolean }
  // TOOL-CODE class — deliver = code the agent calls.
  | { kind: 'http'; url: string; method?: string; auth?: CapabilityAuth }
  | { kind: 'sandbox-code'; entry: string; code: ContentRef; runtime?: string; harness?: string }
  // PROCESS class — deliver = a running server. STRICT discriminated union over
  // the SDK's flat `AgentProfileMcpServer.transport` vocabulary.
  | {
      kind: 'mcp-stdio'
      command: string
      args?: string[]
      env?: Record<string, string>
      cwd?: string
    }
  | { kind: 'mcp-remote'; url: string; transport: 'http' | 'sse'; headers?: Record<string, string> }
  // COMPOSED — a binding whose host must itself be provisioned. RECURSIVE.
  // "a certified MCP hosted in a sandbox" === this. Resolve depth-first: host
  // before inner.
  | { kind: 'process-on-infra'; host: HostSpec; inner: DeliveryBinding }
  // INFRA class — deliver = a provisioned store + a connection (standing cost).
  | { kind: 'rag-index'; index: ContentRef; embedModel: string; topK?: number }
  | { kind: 'memory-store'; provision: 'sqlite' | 'neo4j' | 'vector'; seed?: ContentRef }
  // EXTENSION POINTS — future arms, additive and agent-invisible.
  | { kind: 'wasm'; module: ContentRef; exports: string[] }
  | { kind: 'a2a'; endpoint: string; card: ContentRef; auth?: CapabilityAuth }

/** Every binding kind — the open set the resolver dispatches over. */
export type DeliveryBindingKind = DeliveryBinding['kind']

// ── Provenance + the manifest ───────────────────────────────────────────────────

/**
 * The certify lane's held-out lift travelling WITH delivery. The shipped
 * `CertifiedArtifact` envelope minus its content (which moves into the binding
 * arm): `version`/`contentHash`/`lift` are stamped by the promote step, never
 * the author.
 *
 * `sourcePath` is the artifact's ORIGINAL path (including `null`). It is the
 * byte-stable fold sort key — the resolver folds context artifacts in
 * `composeCertifiedPrompt` order, which sorts by `path ?? ''`, so a `null` path
 * is load-bearing and MUST round-trip exactly. It is distinct from a context
 * `iface.name` (display only): collapsing the two flips the fold order for a
 * mix of null-path and non-null-path artifacts.
 */
export interface CertProvenance {
  contentHash: string
  version: number | null
  lift: string | null
  promotedAt: string
  sourcePath: string | null
}

/** One certified unit of agent power. */
export interface CertifiedCapability {
  id: string
  iface: CapabilityInterface
  binding: DeliveryBinding
  auth: CapabilityAuth
  provenance: CertProvenance
}

/**
 * The strict generalization of `CertifiedProfile`. `promptSurface` is kept
 * during the migration window (the shipped pull lane still emits it); new
 * capabilities live in `capabilities`.
 */
export interface CapabilityManifest {
  target: string
  generatedAt: string
  promptSurface: CertifiedPromptSurface | null
  capabilities: CertifiedCapability[]
}

// ── The resolved surface — one shape, both seams ────────────────────────────────

/** One retrieval handle. The agent never learns vector vs graph vs index. */
export interface ResolvedRetrieval {
  name: string
  retrieve(query: string, k?: number): Promise<Array<{ text: string; score?: number }>>
}

/** One resolved hook — event + the command/matcher the seam folds into
 *  `AgentProfile.hooks`. */
export interface ResolvedHook {
  event: string
  command: string
  matcher?: string
}

/** One resolved subagent — folded into `AgentProfile.subagents`. */
export interface ResolvedSubagent {
  name: string
  description?: string
  prompt?: string
}

/**
 * What `composeCertifiedProfile` produces. Every binding fans into the same
 * slots, consumed identically by the in-process seam (`RouterToolsSeam.{tools,
 * executeToolCall}` + folded prompt) and the sandbox seam (`AgentProfile`).
 * `dispose()` tears provisioned hosts down in REVERSE dependency order.
 */
export interface ResolvedSurface {
  /** Host-side tool defs → `RouterToolsSeam.tools` / agent-app `extraTools`. */
  tools: ToolSpec[]
  /** Host-side dispatch for a resolved tool. Throws when `name` is unknown so a
   *  mis-dispatch is loud, never a silent empty string. */
  execute(name: string, args: Record<string, unknown>, task: unknown): Promise<string>
  /** Sandbox-side tool delivery → `AgentProfile.mcp` / in-proc `createMcpEnvironment`. */
  mcpConnections: Record<string, AgentProfileMcpServer>
  /** Prompt-context additions, byte-stable-ordered → folded system prompt. */
  promptAdditions: string[]
  /** Workspace files → `AgentProfile.resources.files`. */
  files: Array<{ path: string; content: string; executable?: boolean }>
  /** Uniform retrieval handles. */
  retrieval: ResolvedRetrieval[]
  /** Hooks → `AgentProfile.hooks`. */
  hooks: ResolvedHook[]
  /** Subagents → `AgentProfile.subagents`. */
  subagents: ResolvedSubagent[]
  /** The folded system prompt — base + the byte-stable prompt additions, exactly
   *  as `composeCertifiedPrompt` renders the inline/context capabilities. */
  systemPrompt: string
  /** Tear down provisioned hosts (reverse dependency order). */
  dispose(): Promise<void>
}

// ── Errors ──────────────────────────────────────────────────────────────────────

/**
 * A binding kind whose resolver case is typed but not yet admitted (rag-index,
 * memory-store, wasm, a2a). Thrown by the resolver — NEVER faked into a working
 * surface. The TYPE arms exist so the union is closed against the spec; the
 * resolver grows them later behind their lifecycle + admission gate.
 */
export class CapabilityNotAdmittedError extends Error {
  readonly kind: DeliveryBindingKind
  readonly capabilityId: string
  constructor(kind: DeliveryBindingKind, capabilityId: string, reason: string) {
    super(`capability '${capabilityId}': binding '${kind}' not admitted — ${reason}`)
    this.name = 'CapabilityNotAdmittedError'
    this.kind = kind
    this.capabilityId = capabilityId
  }
}

// ── Lowering today's wire (`CertifiedProfile`) → `CapabilityManifest` ───────────

const provenanceFromArtifact = (a: CertifiedArtifact): CertProvenance => ({
  contentHash: a.contentHash,
  version: a.version,
  lift: a.lift,
  promotedAt: a.promotedAt,
  sourcePath: a.path,
})

const contextKindForType = (type: string): 'prompt-surface' | 'skill' | 'instructions' =>
  type === 'prompt-surface' || type === 'skill' ? type : 'instructions'

/**
 * Heuristic shape-inference for a non-context artifact. The plane stores
 * `artifactType` as a free string today, so a tool/mcp-shaped artifact arrives
 * as opaque content. We infer the narrowest binding that is always-valid:
 *   - a parseable OpenAI-tool JSON (`{ name, parameters, url? }`) → an `http`
 *     tool when it carries a `url`, else an inline `tool` definition;
 *   - a parseable MCP-server JSON (`{ command }` or `{ url, transport }`) → the
 *     matching strict mcp binding;
 *   - anything else → `context`/inline (the fail-safe — the bytes still reach the
 *     agent as prompt context, never dropped).
 */
function inferCapability(type: string, a: CertifiedArtifactWithIndex): CertifiedCapability {
  const id = `${type}:${a.path ?? a.index}`
  const provenance = provenanceFromArtifact(a)
  const parsed = tryParseJson(a.content)

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    if (typeof obj.command === 'string') {
      return {
        id,
        iface: { surface: 'mcp', serverName: String(obj.name ?? type) },
        binding: {
          kind: 'mcp-stdio',
          command: obj.command,
          ...(Array.isArray(obj.args) ? { args: obj.args.map(String) } : {}),
          ...(isStringRecord(obj.env) ? { env: obj.env } : {}),
          ...(typeof obj.cwd === 'string' ? { cwd: obj.cwd } : {}),
        },
        auth: { mode: 'none' },
        provenance,
      }
    }
    if (typeof obj.url === 'string' && (obj.transport === 'http' || obj.transport === 'sse')) {
      return {
        id,
        iface: { surface: 'mcp', serverName: String(obj.name ?? type) },
        binding: {
          kind: 'mcp-remote',
          url: obj.url,
          transport: obj.transport,
          ...(isStringRecord(obj.headers) ? { headers: obj.headers } : {}),
        },
        auth: { mode: 'none' },
        provenance,
      }
    }
    if (typeof obj.name === 'string' && isJsonSchema(obj.parameters)) {
      const iface: CapabilityInterface = {
        surface: 'tool',
        name: obj.name,
        ...(typeof obj.description === 'string' ? { description: obj.description } : {}),
        parameters: obj.parameters,
      }
      if (typeof obj.url === 'string') {
        return {
          id,
          iface,
          binding: {
            kind: 'http',
            url: obj.url,
            ...(typeof obj.method === 'string' ? { method: obj.method } : {}),
          },
          auth: { mode: 'none' },
          provenance,
        }
      }
      return {
        id,
        iface,
        binding: { kind: 'inline', content: { kind: 'inline', content: a.content } },
        auth: { mode: 'none' },
        provenance,
      }
    }
  }

  return {
    id,
    iface: { surface: 'context', kind: 'instructions', name: a.path ?? type },
    binding: { kind: 'inline', content: { kind: 'inline', content: a.content } },
    auth: { mode: 'none' },
    provenance,
  }
}

type CertifiedArtifactWithIndex = CertifiedArtifact & { index: number }

/**
 * Lower the EXISTING plane wire (`CertifiedProfile`) into a `CapabilityManifest`.
 * `prompt-surface`/`skill` artifacts → `context`/inline capabilities (the
 * shipped fold, generalized); any other artifact type → best-effort binding
 * inference (see {@link inferCapability}). `promptSurface` is carried through so
 * the resolver folds it first, exactly as `composeCertifiedPrompt` does today.
 * This delivers the spine against today's wire before the plane changes.
 */
export function manifestFromProfile(profile: CertifiedProfile): CapabilityManifest {
  const capabilities: CertifiedCapability[] = []
  for (const type of Object.keys(profile.artifacts).sort()) {
    const bucket = profile.artifacts[type] ?? []
    const sorted = [...bucket]
      .map((a, index) => ({ ...a, index }))
      .sort((x, y) => (x.path ?? '').localeCompare(y.path ?? ''))
    for (const a of sorted) {
      if (type === 'prompt-surface' || type === 'skill') {
        capabilities.push({
          id: `${type}:${a.path ?? a.index}`,
          iface: { surface: 'context', kind: contextKindForType(type), name: a.path ?? type },
          binding: { kind: 'inline', content: { kind: 'inline', content: a.content } },
          auth: { mode: 'none' },
          provenance: provenanceFromArtifact(a),
        })
      } else {
        capabilities.push(inferCapability(type, a))
      }
    }
  }
  return {
    target: profile.target,
    generatedAt: profile.generatedAt,
    promptSurface: profile.promptSurface,
    capabilities,
  }
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string')
  )
}

function isJsonSchema(v: unknown): v is JsonSchema {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
