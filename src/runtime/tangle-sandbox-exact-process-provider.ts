import { isDeepStrictEqual } from 'node:util'

import type { AgentCandidateTermination } from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
  AgentExactProcess,
  AgentExactProcessEnvironment,
  AgentExactProcessEnvironmentQuery,
  AgentExactProcessProvider,
  AgentExactProcessStatus,
  CreateAgentExactProcessEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import type {
  Process,
  ProcessStatus,
  Sandbox,
  SandboxInstance,
  SandboxResources,
} from '@tangle-network/sandbox'

export type SandboxControlClient = Pick<Sandbox, 'create' | 'get' | 'list'>

type ExactSandboxEgressPolicy =
  | { mode: 'blocked' }
  | { mode: 'strict'; allowDomains: string[]; includeImplicitDomains: false }

export interface CreateTangleSandboxExactProcessProviderOptions {
  name?: string
}

const exactProcessProviderMarker = 'agent-runtime.exact-process-provider'
const exactProcessEgressMarker = 'agent-runtime.exact-process-egress'

/**
 * Adapt Tangle Sandbox's managed control runtime to Runtime's exact-process provider.
 *
 * The adapter deliberately exposes no ordinary agent environment: an exact experiment
 * must start a fresh Sandbox with no managed agent and launch its declared argv directly.
 */
export function createTangleSandboxExactProcessProvider(
  client: SandboxControlClient,
  options: CreateTangleSandboxExactProcessProviderOptions = {},
): AgentEnvironmentProvider {
  const name = options.name ?? 'tangle-sandbox-exact-process'
  if (!name.trim()) throw new Error('Tangle Sandbox exact-process provider name must not be empty')

  const exactProcess: AgentExactProcessProvider = {
    async create(input: CreateAgentExactProcessEnvironmentInput) {
      throwIfAborted(input.signal)
      assertNoProviderOptions(input.providerOptions)
      const egressPolicy = sandboxEgressPolicy(input.egress)
      const metadata = exactMetadata(input.metadata, name, egressPolicy)
      const sandbox = await client.create(
        {
          environment: requiredText(input.image, 'exact-process image'),
          agent: false,
          bare: false,
          ephemeral: true,
          egressPolicy,
          resources: sandboxResources(input),
          maxLifetimeSeconds: sandboxLifetimeSeconds(input.maxLifetimeMs),
          metadata,
          idempotencyKey: requiredText(input.idempotencyKey, 'exact-process idempotency key'),
        },
        {
          ...(input.provisionTimeoutMs === undefined
            ? {}
            : { timeoutMs: positiveInteger(input.provisionTimeoutMs, 'provision timeout') }),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
      )
      try {
        throwIfAborted(input.signal)
        assertExactSandboxMetadata(sandbox, metadata)
        await assertExactSandboxEgress(sandbox, egressPolicy)
      } catch (error) {
        await discardInvalidSandbox(sandbox, error)
      }
      return sandboxAsExactProcessEnvironment(sandbox, name)
    },
    async get(id: string) {
      const sandbox = await client.get(id)
      if (!sandbox || !isExactSandbox(sandbox, name)) return null
      await assertExactSandboxEgress(sandbox, egressFromMetadata(sandbox.metadata))
      return sandboxAsExactProcessEnvironment(sandbox, name)
    },
    async list(query?: AgentExactProcessEnvironmentQuery) {
      assertNoProviderOptions(query?.providerOptions)
      const sandboxes = await client.list()
      return Promise.all(
        sandboxes
          .filter((sandbox) => isExactSandbox(sandbox, name))
          .filter((sandbox) => metadataMatches(sandbox.metadata, query?.metadata))
          .map(async (sandbox) => {
            await assertExactSandboxEgress(sandbox, egressFromMetadata(sandbox.metadata))
            return sandboxAsExactProcessEnvironment(sandbox, name)
          }),
      )
    },
  }

  return {
    name,
    exactProcess,
    capabilities: exactProcessOnlyCapabilities,
    async create() {
      throw new Error(`agent environment provider "${name}" supports exactProcess.create() only`)
    },
  }
}

function sandboxAsExactProcessEnvironment(
  sandbox: SandboxInstance,
  provider: string,
): AgentExactProcessEnvironment {
  return {
    id: requiredText(sandbox.id, 'Sandbox id'),
    provider,
    ...(sandbox.metadata ? { metadata: sandbox.metadata } : {}),
    process: {
      async list(): Promise<AgentExactProcessStatus[]> {
        return (await sandbox.process.list()).map((status) => exactProcessStatus(status))
      },
      async get(pid: number): Promise<AgentExactProcess | null> {
        const process = await sandbox.process.get(pid)
        return process ? sandboxProcessAsExactProcess(process) : null
      },
      async spawn(input, options): Promise<AgentExactProcess> {
        const process = await afterAbortCheck(options?.signal, () =>
          sandbox.process.spawnExact(input.executable, [...input.args], {
            cwd: input.cwd,
            env: { ...input.env },
            inheritEnv: false,
            ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
            timeoutMs: input.timeoutMs,
          }),
        )
        return sandboxProcessAsExactProcess(process)
      },
    },
    async writeFile(path, bytes, options): Promise<void> {
      if (sandbox.fs.supportsWriteMode !== true) {
        throw new Error('Tangle Sandbox does not declare exact file-mode support')
      }
      await afterAbortCheck(options.signal, () =>
        sandbox.fs.write(path, Buffer.from(bytes).toString('base64'), {
          encoding: 'base64',
          mode: fileMode(options.mode),
        }),
      )
    },
    async readFile(path, options): Promise<Uint8Array> {
      const maxBytes = nonnegativeInteger(options.maxBytes, 'exact-process file read maximum')
      const initialSize = nonnegativeInteger(
        (await afterAbortCheck(options.signal, () => sandbox.fs.stat(path))).size,
        `Tangle Sandbox file size for "${path}"`,
      )
      if (initialSize > maxBytes) {
        throw new Error(
          `Tangle Sandbox file "${path}" exceeds the ${maxBytes}-byte exact read maximum`,
        )
      }
      const result = await afterAbortCheck(options.signal, () =>
        sandbox.fs.readBatch([path], { encoding: 'base64' }),
      )
      const failure = result.errors.find((entry) => entry.path === path)
      if (failure) {
        throw new Error(`Tangle Sandbox failed to read "${path}": ${failure.error}`)
      }
      const files = result.files.filter((entry) => entry.path === path)
      if (files.length !== 1) {
        throw new Error(`Tangle Sandbox returned ${files.length} files for exact read "${path}"`)
      }
      const file = files[0]!
      if (file.encoding !== 'base64') {
        throw new Error(`Tangle Sandbox returned non-binary content for exact read "${path}"`)
      }
      const size = nonnegativeInteger(file.size, `Tangle Sandbox file size for "${path}"`)
      if (size !== initialSize) {
        throw new Error(`Tangle Sandbox file "${path}" changed during exact read`)
      }
      if (size > maxBytes) {
        throw new Error(
          `Tangle Sandbox file "${path}" exceeds the ${maxBytes}-byte exact read maximum`,
        )
      }
      const bytes = Buffer.from(file.content, 'base64')
      if (bytes.byteLength !== size || bytes.toString('base64') !== file.content) {
        throw new Error(
          `Tangle Sandbox returned an invalid binary payload for exact read "${path}"`,
        )
      }
      return Uint8Array.from(bytes)
    },
    async destroy(): Promise<void> {
      await sandbox.delete()
    },
  }
}

function sandboxProcessAsExactProcess(process: Process): AgentExactProcess {
  const pid = positiveInteger(process.pid, 'Tangle Sandbox process pid')
  return {
    pid,
    async status(): Promise<AgentExactProcessStatus> {
      return exactProcessStatus(await process.status(), pid)
    },
    async wait(): Promise<AgentCandidateTermination> {
      const waitExitCode = await process.wait()
      if (!Number.isSafeInteger(waitExitCode)) {
        throw new Error('Tangle Sandbox process wait returned an invalid exit code')
      }
      const status = exactProcessStatus(await process.status(), pid)
      if (status.running || !status.termination) {
        throw new Error('Tangle Sandbox process wait returned before terminal status')
      }
      if (status.termination.kind === 'exit' && status.termination.exitCode !== waitExitCode) {
        throw new Error('Tangle Sandbox process wait and status disagree on exit code')
      }
      return status.termination
    },
    async kill(): Promise<void> {
      await process.kill('SIGKILL', { tree: true })
    },
    async *stdout(): AsyncIterable<string> {
      yield* process.stdout()
    },
    async *stderr(): AsyncIterable<string> {
      yield* process.stderr()
    },
  }
}

function exactProcessStatus(status: ProcessStatus, expectedPid?: number): AgentExactProcessStatus {
  const pid = positiveInteger(status.pid, 'Tangle Sandbox process pid')
  if (expectedPid !== undefined && pid !== expectedPid) {
    throw new Error('Tangle Sandbox process status changed process identity')
  }
  if (typeof status.running !== 'boolean') {
    throw new Error('Tangle Sandbox process status is missing running state')
  }
  if (!Number.isSafeInteger(status.exitCode)) {
    throw new Error('Tangle Sandbox process status is missing an integer exit code')
  }
  const exitSignal = optionalText(status.exitSignal, 'Tangle Sandbox process exit signal')
  if (status.running) {
    if (status.exitCode !== -1) {
      throw new Error('Tangle Sandbox running process must report exit code -1')
    }
    if (exitSignal) {
      throw new Error('Tangle Sandbox running process must not report an exit signal')
    }
    return {
      pid,
      running: true,
      exitCode: -1,
    }
  }
  const termination = exitSignal
    ? ({ kind: 'signal', signal: exitSignal } as const)
    : status.exitCode >= 0
      ? ({ kind: 'exit', exitCode: status.exitCode } as const)
      : undefined
  if (!termination) {
    throw new Error('Tangle Sandbox stopped process has no terminal reason')
  }
  return {
    pid,
    running: false,
    exitCode: status.exitCode,
    ...(exitSignal ? { exitSignal } : {}),
    termination,
  }
}

function exactMetadata(
  metadata: Record<string, unknown>,
  provider: string,
  egressPolicy: ExactSandboxEgressPolicy,
): Record<string, unknown> {
  for (const marker of [exactProcessProviderMarker, exactProcessEgressMarker]) {
    if (Object.hasOwn(metadata, marker)) {
      throw new Error(`exact-process metadata must not set "${marker}"`)
    }
  }
  return {
    ...metadata,
    [exactProcessProviderMarker]: provider,
    [exactProcessEgressMarker]: serializeEgressPolicy(egressPolicy),
  }
}

function isExactSandbox(sandbox: SandboxInstance, provider: string): boolean {
  return sandbox.metadata?.[exactProcessProviderMarker] === provider
}

function metadataMatches(
  metadata: Record<string, unknown> | undefined,
  expected: Record<string, unknown> | undefined,
): boolean {
  return (
    expected === undefined ||
    Object.entries(expected).every(([key, value]) => isDeepStrictEqual(metadata?.[key], value))
  )
}

function assertExactSandboxMetadata(
  sandbox: SandboxInstance,
  expected: Record<string, unknown>,
): void {
  if (!metadataMatches(sandbox.metadata, expected)) {
    throw new Error('Tangle Sandbox did not persist exact-process metadata')
  }
}

function egressFromMetadata(
  metadata: Record<string, unknown> | undefined,
): ExactSandboxEgressPolicy {
  const encoded = metadata?.[exactProcessEgressMarker]
  if (typeof encoded !== 'string') {
    throw new Error('Tangle Sandbox exact-process environment is missing egress metadata')
  }
  try {
    const parsed: unknown = JSON.parse(encoded)
    if (!parsed || typeof parsed !== 'object') throw new Error('expected egress object')
    const policy = parsed as {
      mode?: unknown
      allowDomains?: unknown
      includeImplicitDomains?: unknown
    }
    if (policy.mode === 'blocked' && policy.allowDomains === undefined) return { mode: 'blocked' }
    if (
      policy.mode === 'strict' &&
      policy.includeImplicitDomains === false &&
      Array.isArray(policy.allowDomains) &&
      policy.allowDomains.every((domain): domain is string => typeof domain === 'string')
    ) {
      const allowDomains = sortedDomains(policy.allowDomains)
      if (new Set(allowDomains).size === allowDomains.length) {
        return { mode: 'strict', allowDomains, includeImplicitDomains: false }
      }
    }
  } catch {
    throw new Error('Tangle Sandbox exact-process environment has invalid egress metadata')
  }
  throw new Error('Tangle Sandbox exact-process environment has invalid egress metadata')
}

async function assertExactSandboxEgress(
  sandbox: SandboxInstance,
  expected: ExactSandboxEgressPolicy,
): Promise<void> {
  const actual = (await sandbox.egress.get()).policy
  if (actual.mode !== expected.mode) {
    throw new Error(
      `Tangle Sandbox egress mismatch: expected ${expected.mode}, received ${actual.mode}`,
    )
  }
  if (expected.mode === 'blocked') {
    const allowDomains = (actual as { allowDomains?: unknown }).allowDomains
    if (
      actual.mode === 'blocked' &&
      (allowDomains === undefined || (Array.isArray(allowDomains) && allowDomains.length === 0))
    ) {
      return
    }
    throw new Error('Tangle Sandbox blocked egress retained an allowlist')
  }
  if (actual.mode !== 'strict') {
    throw new Error('Tangle Sandbox did not return strict egress policy')
  }
  const expectedDomains = sortedDomains(expected.allowDomains)
  const actualDomains = sortedDomains(actual.allowDomains ?? [])
  if (!isDeepStrictEqual(actualDomains, expectedDomains)) {
    throw new Error('Tangle Sandbox strict egress differs from the exact allowlist')
  }
  if (actual.includeImplicitDomains !== false) {
    throw new Error('Tangle Sandbox strict egress retained implicit domains')
  }
}

function sandboxEgressPolicy(
  input: CreateAgentExactProcessEnvironmentInput['egress'],
): ExactSandboxEgressPolicy {
  if (input.mode === 'blocked') return { mode: 'blocked' }
  const allowDomains = input.allowDomains.map((domain) =>
    requiredText(domain, 'strict egress domain'),
  )
  if (new Set(allowDomains).size !== allowDomains.length) {
    throw new Error('strict egress domains must not contain duplicates')
  }
  return { mode: 'strict', allowDomains, includeImplicitDomains: false }
}

function serializeEgressPolicy(policy: ExactSandboxEgressPolicy): string {
  return JSON.stringify(
    policy.mode === 'blocked'
      ? { mode: 'blocked' }
      : {
          mode: 'strict',
          allowDomains: sortedDomains(policy.allowDomains),
          includeImplicitDomains: false,
        },
  )
}

function sandboxResources(input: CreateAgentExactProcessEnvironmentInput): SandboxResources {
  const cpuCores = positiveNumber(input.resources.cpu, 'exact-process cpu')
  const memoryMB = positiveInteger(input.resources.memoryMb, 'exact-process memory')
  const diskMb = positiveInteger(input.resources.diskMb, 'exact-process disk')
  if (diskMb % 1024 !== 0) {
    throw new Error('Tangle Sandbox exact-process disk must be a whole GiB')
  }
  return { cpuCores, memoryMB, diskGB: diskMb / 1024 }
}

function sandboxLifetimeSeconds(maxLifetimeMs: number): number {
  const milliseconds = positiveInteger(maxLifetimeMs, 'exact-process maximum lifetime')
  if (milliseconds % 1_000 !== 0) {
    throw new Error(
      'Tangle Sandbox exact-process maximum lifetime must be a whole number of seconds',
    )
  }
  return milliseconds / 1_000
}

function fileMode(value: number): number {
  const mode = nonnegativeInteger(value, 'exact-process file mode')
  if (mode > 0o7777) throw new Error('exact-process file mode exceeds POSIX mode bits')
  return mode
}

function assertNoProviderOptions(providerOptions: Record<string, unknown> | undefined): void {
  if (providerOptions && Object.keys(providerOptions).length > 0) {
    throw new Error('Tangle Sandbox exact-process provider does not accept providerOptions')
  }
}

function exactProcessOnlyCapabilities(): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: false,
      // Exact-process runs a command as given and interprets no part of a profile, so neither
      // spelling is honored and a profile carrying one is refused rather than silently dropped.
      systemPrompt: { replace: false, append: false },
      instructions: false,
      tools: false,
      permissions: false,
      mcp: false,
      subagents: false,
      resources: {
        files: false,
        instructions: false,
        tools: false,
        skills: false,
        agents: false,
        commands: false,
      },
      hooks: false,
      modes: false,
      runtimeUpdate: false,
      validation: false,
    },
    streaming: { live: false, replay: false, detach: false, turnIdempotency: false },
    sessions: { continue: false, list: false, messages: false },
    workspace: {
      read: false,
      write: false,
      exec: false,
      git: false,
      upload: false,
      download: false,
    },
    branching: { checkpoint: false, fork: false },
    placement: false,
    usage: false,
    confidential: false,
    exactProcess: { egress: ['blocked', 'strict'] },
  }
}

async function discardInvalidSandbox(sandbox: SandboxInstance, cause: unknown): Promise<never> {
  try {
    await sandbox.delete()
  } catch (destroyError) {
    throw new AggregateError(
      [cause, destroyError],
      'Tangle Sandbox exact-process creation failed and cleanup failed',
    )
  }
  throw cause
}

function sortedDomains(domains: readonly string[]): string[] {
  return [...domains].sort((left, right) => left.localeCompare(right))
}

function requiredText(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} must be a non-empty string`)
  return value
}

function optionalText(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined
  return requiredText(value, label)
}

function positiveNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`)
  return value
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive integer`)
  return value
}

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative integer`)
  return value
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted()
}

async function afterAbortCheck<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  throwIfAborted(signal)
  const result = await operation()
  throwIfAborted(signal)
  return result
}
