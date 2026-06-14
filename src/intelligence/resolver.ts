/**
 * @experimental
 *
 * The capability resolver — the ONLY place that knows binding kinds. It lowers a
 * `CapabilityManifest` into a uniform `ResolvedSurface` consumed identically by
 * the in-process seam (`RouterToolsSeam.{tools, executeToolCall}` + a folded
 * prompt) and the sandbox seam (`AgentProfile`).
 *
 * The spine (zero new infra) resolves inline/file, mcp-stdio/mcp-remote, and
 * http tools for BOTH seams, reusing shipped primitives:
 *   - inline/context → `composeCertifiedPrompt` (delivery.ts) — byte-stable order;
 *   - http           → a `ToolSpec` + a host-side fetch `execute`;
 *   - mcp-stdio/remote → an `AgentProfileMcpServer` (the strict union widens to
 *     the SDK's flat shape — an always-valid lowering).
 *
 * The ladder rungs that need infra are INJECTED capabilities of the resolve
 * context (`runSandboxCode`, `provisionHost`), so the substrate-free caller wires
 * only what it can host — a binding that needs an absent provider throws loudly,
 * it is NEVER faked into a working surface. The not-yet-admitted arms (rag-index,
 * memory-store, wasm, a2a) throw {@link CapabilityNotAdmittedError}.
 *
 * Fail-closed by construction (mirroring `pullCertified`): a `null` manifest
 * returns the base surface only; a per-capability resolve failure DROPS that
 * capability (never a half-wired tool); a post-resolve drift check drops any tool
 * whose live names diverge from the certified interface.
 */

import type { AgentProfileMcpServer } from '@tangle-network/sandbox'
import type { ToolSpec } from '../runtime/router-client'
import {
  type CapabilityAuth,
  type CapabilityManifest,
  CapabilityNotAdmittedError,
  type CertifiedCapability,
  type ContentRef,
  type DeliveryBinding,
  type HostSpec,
  manifestFromProfile,
  type ResolvedHook,
  type ResolvedRetrieval,
  type ResolvedSubagent,
  type ResolvedSurface,
} from './capability'
import type { CertifiedArtifact, CertifiedProfile } from './delivery'
import { composeCertifiedPrompt, promptFoldTypes } from './delivery'

/** A live, provisioned host the resolver tore up for a `process-on-infra` arm.
 *  `teardown()` runs at `dispose()` in reverse provisioning order. */
export interface ProvisionedHost {
  /** Lower the inner binding's mcp connection now that the host is up; the URL/
   *  command points at the host. Absent when the host serves a non-mcp inner. */
  mcpConnection?: AgentProfileMcpServer
  teardown(): Promise<void>
}

/**
 * Per-call, per-tenant context the resolver reads. Everything that touches the
 * network, a secret, or an infra provisioner is INJECTED so the manifest carries
 * no live secret and the substrate-free caller wires only what it can host.
 */
export interface ResolveCtx {
  /** Stable tenant id — namespaces billing + teardown (`tenant#target`). */
  tenant?: string
  /** fetch impl for http tools. Defaults to global fetch; absent ⇒ http tools fail loud. */
  fetchImpl?: typeof fetch
  /**
   * Resolve a declared credential to a live secret for THIS tenant. Returns a
   * typed outcome — inspect `succeeded` before `value`. Absent ⇒ a binding that
   * declares non-`none` auth fails loud (never a request with no credential).
   */
  resolveSecret?: (
    auth: CapabilityAuth,
    tenant: string | undefined,
  ) => Promise<{ succeeded: true; value: string } | { succeeded: false; error: string }>
  /**
   * Run a `sandbox-code` body per call. Injected by the host that owns a sandbox
   * client (the spine does not import the sandbox executor). Absent ⇒
   * `sandbox-code` bindings fail loud.
   */
  runSandboxCode?: (
    code: ContentRef,
    entry: string,
    args: Record<string, unknown>,
    task: unknown,
  ) => Promise<string>
  /**
   * Provision a host for a `process-on-infra` binding, then serve the inner
   * binding inside it. Injected by the host that owns `createExecutor`. Absent ⇒
   * `process-on-infra` bindings fail loud. The provider resolves the inner
   * binding INSIDE the host and returns the connection + a teardown.
   */
  provisionHost?: (
    host: HostSpec,
    inner: DeliveryBinding,
    costTag: string,
  ) => Promise<ProvisionedHost>
  /**
   * Drift probe: return the LIVE tool names a resolved surface exposes for a
   * given capability id (a `tools/list` over an mcp connection, the agent's
   * actual registered tool names for a host tool). When present, the post-resolve
   * drift check drops any tool/mcp whose live names diverge from the certified
   * interface — the only callable surfaces are gate-blessed ones. Absent ⇒ the
   * check enforces only the host-side executor↔spec parity (no live probe).
   */
  probeLiveToolNames?: (capabilityId: string) => Promise<string[]>
  /**
   * Observe a DROPPED capability — a per-capability resolve failure that is
   * fail-closed (the capability is omitted, never half-wired). The drop is the
   * contract; this surfaces the diagnostic so it is never silently erased. NOT
   * called for {@link CapabilityNotAdmittedError} (that rethrows — a manifest
   * carrying an un-admitted binding kind is a hard error, not a soft drop).
   */
  onDrop?: (capabilityId: string, error: Error) => void
}

/** Internal accumulator the resolver fills, then folds into a `ResolvedSurface`. */
interface SurfaceAccumulator {
  tools: ToolSpec[]
  executors: Map<string, (args: Record<string, unknown>, task: unknown) => Promise<string>>
  mcpConnections: Record<string, AgentProfileMcpServer>
  contextArtifacts: Record<string, CertifiedArtifact[]>
  files: Array<{ path: string; content: string; executable?: boolean }>
  retrieval: ResolvedRetrieval[]
  hooks: ResolvedHook[]
  subagents: ResolvedSubagent[]
  teardowns: Array<() => Promise<void>>
  /** Tool name → the capability id that certified it (drift probe key). */
  toolCapabilityId: Map<string, string>
  /** Mcp server name → the capability id + its certified tool names (drift). */
  mcpCapability: Map<string, { capabilityId: string; certifiedNames: string[] }>
}

function emptyAccumulator(): SurfaceAccumulator {
  return {
    tools: [],
    executors: new Map(),
    mcpConnections: {},
    contextArtifacts: {},
    files: [],
    retrieval: [],
    hooks: [],
    subagents: [],
    teardowns: [],
    toolCapabilityId: new Map(),
    mcpCapability: new Map(),
  }
}

/**
 * Compose a certified profile into a uniform `ResolvedSurface`. Additive over
 * `composeCertifiedPrompt`: the inline/context fold is delegated to
 * `composeCertifiedPrompt` so the byte-stable ordering (prompt surface first,
 * then type alphabetic, then path locale-compare) is reused EXACTLY — the
 * prompt-only path is a strict subset of this.
 *
 * Fail-closed: a `null` manifest returns the base surface only.
 */
export async function composeCertifiedProfile(
  base: { systemPrompt: string },
  manifest: CapabilityManifest | null,
  ctx: ResolveCtx = {},
): Promise<ResolvedSurface> {
  if (!manifest || manifest.capabilities.length === 0) {
    return baseSurface(base.systemPrompt, manifest?.promptSurface ?? null)
  }

  const acc = emptyAccumulator()
  for (const cap of manifest.capabilities) {
    try {
      await resolveCapability(cap, ctx, acc)
    } catch (err) {
      // An un-admitted binding kind is a hard error (the manifest is malformed
      // for this resolver); any other per-capability failure is a fail-closed
      // drop — the diagnostic is surfaced via `onDrop`, never erased.
      if (err instanceof CapabilityNotAdmittedError) throw err
      ctx.onDrop?.(cap.id, err instanceof Error ? err : new Error(String(err)))
    }
  }

  await driftDropTools(acc, ctx)

  const promptAdditions = collectPromptAdditions(manifest.promptSurface, acc.contextArtifacts)
  const systemPrompt = composeCertifiedPrompt(base.systemPrompt, {
    target: manifest.target,
    generatedAt: manifest.generatedAt,
    promptSurface: manifest.promptSurface,
    artifacts: acc.contextArtifacts,
  })

  const teardowns = acc.teardowns
  return {
    tools: acc.tools,
    async execute(name, args, task): Promise<string> {
      const fn = acc.executors.get(name)
      if (!fn) throw new Error(`composeCertifiedProfile.execute: unknown tool '${name}'`)
      return fn(args, task)
    },
    mcpConnections: acc.mcpConnections,
    promptAdditions,
    files: acc.files,
    retrieval: acc.retrieval,
    hooks: acc.hooks,
    subagents: acc.subagents,
    systemPrompt,
    async dispose(): Promise<void> {
      // Reverse dependency order: a host provisioned before its inner is torn
      // down after the inner's teardown ran.
      for (let i = teardowns.length - 1; i >= 0; i -= 1) {
        const teardown = teardowns[i]
        if (teardown) await teardown()
      }
    },
  }
}

function baseSurface(
  systemPrompt: string,
  promptSurface: CapabilityManifest['promptSurface'],
): ResolvedSurface {
  const folded = composeCertifiedPrompt(systemPrompt, {
    target: '',
    generatedAt: '',
    promptSurface,
    artifacts: {},
  })
  return {
    tools: [],
    async execute(name): Promise<string> {
      throw new Error(`composeCertifiedProfile.execute: unknown tool '${name}'`)
    },
    mcpConnections: {},
    promptAdditions: collectPromptAdditions(promptSurface, {}),
    files: [],
    retrieval: [],
    hooks: [],
    subagents: [],
    systemPrompt: folded,
    async dispose(): Promise<void> {},
  }
}

/** The byte-stable prompt additions a viewer/debugger can inspect — the same
 *  parts `composeCertifiedPrompt` joins into the folded prompt, in the same fold
 *  order (`promptFoldTypes`). */
function collectPromptAdditions(
  promptSurface: CapabilityManifest['promptSurface'],
  contextArtifacts: Record<string, CertifiedArtifact[]>,
): string[] {
  const parts: string[] = []
  if (promptSurface?.surface.trim()) parts.push(promptSurface.surface.trim())
  for (const type of promptFoldTypes) {
    const bucket = contextArtifacts[type] ?? []
    for (const a of [...bucket].sort((x, y) => (x.path ?? '').localeCompare(y.path ?? ''))) {
      if (a.content.trim()) parts.push(a.content.trim())
    }
  }
  return parts
}

async function resolveCapability(
  cap: CertifiedCapability,
  ctx: ResolveCtx,
  acc: SurfaceAccumulator,
): Promise<void> {
  await resolveBinding(cap, cap.binding, ctx, acc)
}

async function resolveBinding(
  cap: CertifiedCapability,
  binding: DeliveryBinding,
  ctx: ResolveCtx,
  acc: SurfaceAccumulator,
): Promise<void> {
  switch (binding.kind) {
    case 'inline':
      resolveInline(cap, binding, acc)
      return
    case 'file':
      resolveFile(cap, binding, acc)
      return
    case 'http':
      resolveHttp(cap, binding, ctx, acc)
      return
    case 'mcp-stdio':
    case 'mcp-remote':
      resolveMcp(cap, binding, acc)
      return
    case 'sandbox-code':
      resolveSandboxCode(cap, binding, ctx, acc)
      return
    case 'process-on-infra':
      await resolveProcessOnInfra(cap, binding, ctx, acc, new Set())
      return
    case 'rag-index':
      throw new CapabilityNotAdmittedError(
        binding.kind,
        cap.id,
        'rag retrieval lift must clear the E3 score-superiority admission bar before a store is trusted (memory/e3-certified-memory-verdict)',
      )
    case 'memory-store':
      throw new CapabilityNotAdmittedError(
        binding.kind,
        cap.id,
        'memory-store admission is gated on the E3 score-superiority bar (memory/e3-certified-memory-verdict)',
      )
    case 'wasm':
      throw new CapabilityNotAdmittedError(
        binding.kind,
        cap.id,
        'wasm is an extension-point arm, not yet admitted',
      )
    case 'a2a':
      throw new CapabilityNotAdmittedError(
        binding.kind,
        cap.id,
        'a2a is an extension-point arm, not yet admitted',
      )
  }
}

/** inline → a context artifact (prompt-surface/skill folded) or an inline tool
 *  def. Context capabilities feed the byte-stable prompt fold; an inline `tool`
 *  interface registers a host-side tool whose body is the inlined JSON spec. */
function resolveInline(
  cap: CertifiedCapability,
  binding: Extract<DeliveryBinding, { kind: 'inline' }>,
  acc: SurfaceAccumulator,
): void {
  const content = inlineContent(cap, binding.content)
  if (cap.iface.surface === 'context') {
    pushContextArtifact(acc, cap, content)
    return
  }
  if (cap.iface.surface === 'tool') {
    registerInlineTool(cap, content, acc)
    return
  }
  // Any other surface delivered inline folds as prompt context (the fail-safe —
  // the bytes still reach the agent, never silently dropped).
  pushContextArtifact(acc, cap, content)
}

/** An inline `tool` interface registers a host-side `ToolSpec` whose body is the
 *  static inlined content (a fixed response / canned handler). Its `execute`
 *  returns the content verbatim — the agent calls it like any other tool. */
function registerInlineTool(
  cap: CertifiedCapability,
  content: string,
  acc: SurfaceAccumulator,
): void {
  if (cap.iface.surface !== 'tool') return
  const iface = cap.iface
  acc.tools.push({
    type: 'function',
    function: {
      name: iface.name,
      ...(iface.description ? { description: iface.description } : {}),
      parameters: iface.parameters,
    },
  })
  acc.toolCapabilityId.set(iface.name, cap.id)
  acc.executors.set(iface.name, async () => content)
}

/** file → a workspace file mount (+ a prompt fold when the file is context). */
function resolveFile(
  cap: CertifiedCapability,
  binding: Extract<DeliveryBinding, { kind: 'file' }>,
  acc: SurfaceAccumulator,
): void {
  const content = inlineContent(cap, binding.content)
  acc.files.push({
    path: binding.path,
    content,
    ...(binding.executable ? { executable: true } : {}),
  })
  if (cap.iface.surface === 'context') pushContextArtifact(acc, cap, content)
}

/** mcp-stdio/mcp-remote → an `AgentProfileMcpServer`. The strict discriminated
 *  union widens to the SDK's flat shape — an always-valid lowering, no translation. */
function resolveMcp(
  cap: CertifiedCapability,
  binding: Extract<DeliveryBinding, { kind: 'mcp-stdio' | 'mcp-remote' }>,
  acc: SurfaceAccumulator,
): void {
  const serverName = cap.iface.surface === 'mcp' ? cap.iface.serverName : cap.id
  acc.mcpConnections[serverName] = mcpServerFromBinding(binding, cap)
  acc.mcpCapability.set(serverName, {
    capabilityId: cap.id,
    certifiedNames: cap.iface.surface === 'mcp' ? (cap.iface.toolset ?? []) : [],
  })
}

function mcpServerFromBinding(
  binding: Extract<DeliveryBinding, { kind: 'mcp-stdio' | 'mcp-remote' }>,
  cap: CertifiedCapability,
): AgentProfileMcpServer {
  const metadata: Record<string, unknown> = { capabilityId: cap.id }
  if (cap.iface.surface === 'mcp' && cap.iface.toolset) metadata.tools = cap.iface.toolset
  if (binding.kind === 'mcp-stdio') {
    return {
      transport: 'stdio',
      command: binding.command,
      ...(binding.args ? { args: binding.args } : {}),
      ...(binding.env ? { env: binding.env } : {}),
      ...(binding.cwd ? { cwd: binding.cwd } : {}),
      enabled: true,
      metadata,
    }
  }
  return {
    transport: binding.transport,
    url: binding.url,
    ...(binding.headers ? { headers: binding.headers } : {}),
    enabled: true,
    metadata,
  }
}

/** http → a `ToolSpec` + a host-side fetch `execute`. THE host seam: an http
 *  tool is callable in-process, never injected into a sandbox profile. */
function resolveHttp(
  cap: CertifiedCapability,
  binding: Extract<DeliveryBinding, { kind: 'http' }>,
  ctx: ResolveCtx,
  acc: SurfaceAccumulator,
): void {
  if (cap.iface.surface !== 'tool') {
    throw new Error(`capability '${cap.id}': http binding requires a 'tool' interface`)
  }
  const iface = cap.iface
  acc.tools.push({
    type: 'function',
    function: {
      name: iface.name,
      ...(iface.description ? { description: iface.description } : {}),
      parameters: iface.parameters,
    },
  })
  acc.toolCapabilityId.set(iface.name, cap.id)
  const method = binding.method ?? 'POST'
  const auth = binding.auth ?? cap.auth
  acc.executors.set(iface.name, async (args) => {
    const doFetch = ctx.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined)
    if (!doFetch) throw new Error(`capability '${cap.id}': no fetch implementation for http tool`)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (auth.mode !== 'none') {
      if (!ctx.resolveSecret) {
        throw new Error(
          `capability '${cap.id}': http auth '${auth.mode}' requires ResolveCtx.resolveSecret`,
        )
      }
      const secret = await ctx.resolveSecret(auth, ctx.tenant)
      if (!secret.succeeded) {
        throw new Error(`capability '${cap.id}': secret resolution failed — ${secret.error}`)
      }
      headers.authorization = `Bearer ${secret.value}`
    }
    const res = await doFetch(binding.url, {
      method,
      headers,
      ...(method === 'GET' ? {} : { body: JSON.stringify(args) }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`capability '${cap.id}': http ${res.status}: ${body.slice(0, 200)}`)
    }
    return res.text()
  })
}

/** sandbox-code → a host-side tool whose body runs per-call in a box, via the
 *  injected `runSandboxCode` (the host owns the sandbox client). */
function resolveSandboxCode(
  cap: CertifiedCapability,
  binding: Extract<DeliveryBinding, { kind: 'sandbox-code' }>,
  ctx: ResolveCtx,
  acc: SurfaceAccumulator,
): void {
  if (cap.iface.surface !== 'tool') {
    throw new Error(`capability '${cap.id}': sandbox-code binding requires a 'tool' interface`)
  }
  const iface = cap.iface
  acc.tools.push({
    type: 'function',
    function: {
      name: iface.name,
      ...(iface.description ? { description: iface.description } : {}),
      parameters: iface.parameters,
    },
  })
  acc.toolCapabilityId.set(iface.name, cap.id)
  acc.executors.set(iface.name, async (args, task) => {
    if (!ctx.runSandboxCode) {
      throw new Error(
        `capability '${cap.id}': sandbox-code binding requires ResolveCtx.runSandboxCode`,
      )
    }
    return ctx.runSandboxCode(binding.code, binding.entry, args, task)
  })
}

/**
 * process-on-infra → provision the host FIRST (depth-first), then resolve the
 * inner binding inside it. The injected `provisionHost` owns `createExecutor`;
 * this resolver wires the returned connection + teardown (reverse dep order) and
 * the cost tag. A `visited` set guards against a self-referential host cycle.
 */
async function resolveProcessOnInfra(
  cap: CertifiedCapability,
  binding: Extract<DeliveryBinding, { kind: 'process-on-infra' }>,
  ctx: ResolveCtx,
  acc: SurfaceAccumulator,
  visited: Set<DeliveryBinding>,
): Promise<void> {
  if (visited.has(binding)) {
    throw new Error(`capability '${cap.id}': process-on-infra cycle detected`)
  }
  visited.add(binding)
  if (!ctx.provisionHost) {
    throw new Error(
      `capability '${cap.id}': process-on-infra binding requires ResolveCtx.provisionHost`,
    )
  }
  if (binding.inner.kind === 'process-on-infra') {
    // Nested provisioning: provision the OUTER host, then recurse the inner
    // process-on-infra inside the same provisioner contract (host before inner).
    const outer = await ctx.provisionHost(
      binding.host,
      binding.inner,
      hostCostTag(cap, binding.host),
    )
    acc.teardowns.push(() => outer.teardown())
    await resolveProcessOnInfra(cap, binding.inner, ctx, acc, visited)
    return
  }
  const provisioned = await ctx.provisionHost(
    binding.host,
    binding.inner,
    hostCostTag(cap, binding.host),
  )
  acc.teardowns.push(() => provisioned.teardown())
  if (provisioned.mcpConnection) {
    const serverName = cap.iface.surface === 'mcp' ? cap.iface.serverName : cap.id
    acc.mcpConnections[serverName] = provisioned.mcpConnection
    acc.mcpCapability.set(serverName, {
      capabilityId: cap.id,
      certifiedNames: cap.iface.surface === 'mcp' ? (cap.iface.toolset ?? []) : [],
    })
  }
}

function hostCostTag(cap: CertifiedCapability, host: HostSpec): string {
  return host.costTag ?? `capability/${cap.id}`
}

/**
 * Post-resolve drift check (fail-closed): a resolved surface's LIVE tool names
 * must equal the certified interface — mismatch → drop. The only callable tools
 * are gate-blessed ones. Two enforcement layers:
 *   1. host-side parity — every registered tool keeps a matching executor and
 *      vice-versa (a half-wired tool, e.g. one whose provision failed, is
 *      removed rather than exposed);
 *   2. live-name equality (when `ctx.probeLiveToolNames` is wired) — for each
 *      host tool the live name must contain the certified name; for each mcp
 *      server the live `tools/list` must equal the certified `toolset`.
 * A drop removes BOTH the tool spec and its executor (host) or the connection
 * (mcp); a capability that lost its drift check never reaches the agent.
 */
async function driftDropTools(acc: SurfaceAccumulator, ctx: ResolveCtx): Promise<void> {
  // Layer 1 — host-side executor↔spec parity.
  const specNames = new Set(acc.tools.map((t) => t.function.name))
  for (const name of acc.executors.keys()) {
    if (!specNames.has(name)) acc.executors.delete(name)
  }
  acc.tools = acc.tools.filter((t) => acc.executors.has(t.function.name))

  if (!ctx.probeLiveToolNames) return

  // Layer 2 — live-name equality per capability.
  const droppedTools = new Set<string>()
  for (const tool of acc.tools) {
    const capId = acc.toolCapabilityId.get(tool.function.name)
    if (!capId) continue
    const live = await ctx.probeLiveToolNames(capId)
    if (!live.includes(tool.function.name)) droppedTools.add(tool.function.name)
  }
  for (const name of droppedTools) {
    acc.executors.delete(name)
  }
  acc.tools = acc.tools.filter((t) => !droppedTools.has(t.function.name))

  for (const [serverName, info] of acc.mcpCapability) {
    if (info.certifiedNames.length === 0) continue
    const live = await ctx.probeLiveToolNames(info.capabilityId)
    if (!setsEqual(new Set(live), new Set(info.certifiedNames))) {
      delete acc.mcpConnections[serverName]
      acc.mcpCapability.delete(serverName)
    }
  }
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

function inlineContent(cap: CertifiedCapability, ref: ContentRef): string {
  if (ref.kind === 'inline') return ref.content
  // github/blob refs are pointers the spine does not fetch — a binding that
  // declares one without an inline body cannot be folded into a prompt or file
  // here. Fail loud so the caller wires a fetcher rather than shipping an empty
  // capability.
  throw new Error(
    `capability '${cap.id}': content ref '${ref.kind}' is not inline — wire a content fetcher to resolve it`,
  )
}

function pushContextArtifact(
  acc: SurfaceAccumulator,
  cap: CertifiedCapability,
  content: string,
): void {
  const type = contextArtifactType(cap)
  const bucket = acc.contextArtifacts[type] ?? []
  acc.contextArtifacts[type] = bucket
  bucket.push({
    path: contextArtifactPath(cap),
    content,
    contentHash: cap.provenance.contentHash,
    version: cap.provenance.version,
    lift: cap.provenance.lift,
    promotedAt: cap.provenance.promotedAt,
  })
}

/** Map a context capability onto the artifact-type bucket `composeCertifiedPrompt`
 *  folds. The `prompt-surface`/`skill`/`instructions` buckets all fold into the
 *  prompt (see `promptFoldTypes`), so context bytes always reach the agent; a
 *  non-context surface lowered here as the fail-safe folds as `instructions`. */
function contextArtifactType(cap: CertifiedCapability): string {
  if (cap.iface.surface === 'context') {
    return cap.iface.kind === 'instructions' ? 'instructions' : cap.iface.kind
  }
  return 'instructions'
}

/** The artifact's byte-stable fold sort key — the ORIGINAL source path,
 *  including `null`, round-tripped through provenance. The resolver folds in
 *  `composeCertifiedPrompt` order (sort by `path ?? ''`), so `null` is
 *  load-bearing and must survive the manifest→resolve→fold trip unchanged. This
 *  is deliberately NOT `iface.name` (display only) — conflating the two flips
 *  the fold order against the gate-certified reference. */
function contextArtifactPath(cap: CertifiedCapability): string | null {
  return cap.provenance.sourcePath
}

/** Lower a plane `CertifiedProfile` straight into a `ResolvedSurface` via
 *  `manifestFromProfile` — the convenience the shipped pull lane calls when it
 *  already holds a `CertifiedProfile` (today's wire) rather than a manifest. */
export async function composeCertifiedProfileFromWire(
  base: { systemPrompt: string },
  profile: CertifiedProfile | null,
  ctx: ResolveCtx = {},
): Promise<ResolvedSurface> {
  if (!profile) return composeCertifiedProfile(base, null, ctx)
  return composeCertifiedProfile(base, manifestFromProfile(profile), ctx)
}
