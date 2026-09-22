import type {
  AgentEnvironmentCapabilities,
  AgentEnvironmentStatus,
  AgentSessionStatus,
} from '@tangle-network/agent-interface/environment-provider'
import type {
  PromptInputPart,
  PromptOptions,
  PromptResult,
  SandboxEvent,
  ExecResult as SandboxExecResult,
  SandboxInstance,
} from '@tangle-network/sandbox'
import type { LoopSandboxPlacement, SandboxClient } from './types'

export interface SandboxSessionLike {
  readonly id: string
  status(): Promise<unknown | null>
  events(options?: {
    since?: string
    executionId?: string
    signal?: AbortSignal
  }): AsyncIterable<SandboxEvent>
  result(options?: { executionId?: string }): Promise<PromptResult>
  prompt(message: string | PromptInputPart[], options?: PromptOptions): Promise<PromptResult>
  interrupt(options?: { executionId?: string }): Promise<unknown>
}

export function statusFromUnknown(status: unknown): AgentEnvironmentStatus {
  if (status === 'pending' || status === 'provisioning' || status === 'running') return status
  if (status === 'stopped' || status === 'failed' || status === 'expired') return status
  if (status === 'completed' || status === 'cancelled') return 'stopped'
  return 'unknown'
}

export function sessionStatusFromUnknown(status: unknown): AgentSessionStatus | null {
  if (status === 'completed' || status === 'cancelled') return status
  return statusFromUnknown(status)
}

export function readBoxStatus(box: SandboxInstance): unknown {
  return (box as unknown as { status?: unknown }).status
}

export function readBoxMetadata(box: SandboxInstance): Record<string, unknown> | undefined {
  const metadata = (box as unknown as { metadata?: unknown }).metadata
  return metadata && typeof metadata === 'object'
    ? (metadata as Record<string, unknown>)
    : undefined
}

export async function maybeRefresh(box: SandboxInstance): Promise<void> {
  const refresh = (box as unknown as { refresh?: () => Promise<void> }).refresh
  if (typeof refresh === 'function') await refresh.call(box)
}

export async function destroyBox(box: SandboxInstance): Promise<void> {
  const deleteBox = (box as unknown as { delete?: () => Promise<void> }).delete
  if (typeof deleteBox === 'function') await deleteBox.call(box)
}

export function placementInfoFromLoopPlacement(
  placement: LoopSandboxPlacement | undefined,
  box: SandboxInstance,
): { kind: 'sandbox' | 'fleet'; sandboxId?: string; fleetId?: string; machineId?: string } {
  if (!placement) return { kind: 'sandbox', sandboxId: String(box.id) }
  return {
    kind: placement.kind === 'fleet' ? 'fleet' : 'sandbox',
    ...(placement.sandboxId ? { sandboxId: placement.sandboxId } : { sandboxId: String(box.id) }),
    ...(placement.fleetId ? { fleetId: placement.fleetId } : {}),
    ...(placement.machineId ? { machineId: placement.machineId } : {}),
  }
}

export function defaultTangleSandboxCapabilities(options: {
  namedProfiles: boolean
  reconstructable: boolean
}): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: options.namedProfiles,
      systemPrompt: true,
      instructions: true,
      tools: true,
      permissions: true,
      mcp: true,
      subagents: true,
      resources: {
        files: true,
        instructions: true,
        tools: true,
        skills: true,
        agents: true,
        commands: true,
      },
      hooks: true,
      modes: true,
      runtimeUpdate: true,
      validation: true,
    },
    streaming: {
      live: true,
      replay: false,
      detach: false,
      turnIdempotency: options.reconstructable,
    },
    sessions: { continue: false, list: true, messages: true },
    workspace: { read: true, write: true, exec: true, git: true, upload: true, download: true },
    branching: { checkpoint: true, fork: true },
    placement: true,
    usage: true,
    confidential: true,
  }
}

export function downgradeSandboxCapabilities(
  capabilities: AgentEnvironmentCapabilities,
): AgentEnvironmentCapabilities {
  const {
    nativeContinuation: _nativeContinuation,
    retainedControl: _retainedControl,
    interactions: _interactions,
    ...withoutUnsupportedClaims
  } = capabilities
  return {
    ...withoutUnsupportedClaims,
    streaming: { ...capabilities.streaming, replay: false, detach: false, turnIdempotency: false },
    sessions: { ...capabilities.sessions, continue: false },
  }
}

export interface LinkedAbortSignal {
  signal: AbortSignal
  dispose: () => void
}

export function mergeAbortSignals(a: AbortSignal, b: AbortSignal): LinkedAbortSignal {
  const controller = new AbortController()
  const cleanup = () => {
    a.removeEventListener('abort', onA)
    b.removeEventListener('abort', onB)
  }
  const abort = (reason: unknown) => {
    if (controller.signal.aborted) return
    cleanup()
    controller.abort(reason)
  }
  const onA = () => abort(a.reason)
  const onB = () => abort(b.reason)
  if (a.aborted) abort(a.reason)
  else if (b.aborted) abort(b.reason)
  else {
    a.addEventListener('abort', onA, { once: true })
    b.addEventListener('abort', onB, { once: true })
  }
  return { signal: controller.signal, dispose: cleanup }
}

export function contentRef(prefix: string, value: unknown): string {
  let text: string
  try {
    text = JSON.stringify(value) ?? String(value)
  } catch {
    text = String(value)
  }
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${prefix}:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function hasGet(
  client: SandboxClient,
): client is SandboxClient & { get(id: string): Promise<SandboxInstance | null> } {
  return typeof (client as { get?: unknown }).get === 'function'
}

export function hasList(
  client: SandboxClient,
): client is SandboxClient & { list(options?: unknown): Promise<SandboxInstance[]> } {
  return typeof (client as { list?: unknown }).list === 'function'
}

export function hasDispatchPrompt(box: SandboxInstance): box is SandboxInstance & {
  dispatchPrompt(message: string | PromptInputPart[], options?: PromptOptions): Promise<unknown>
} {
  return typeof (box as { dispatchPrompt?: unknown }).dispatchPrompt === 'function'
}

export function hasSession(
  box: SandboxInstance,
): box is SandboxInstance & { session(id: string): SandboxSessionLike } {
  return typeof (box as { session?: unknown }).session === 'function'
}

export function hasRead(box: SandboxInstance): box is SandboxInstance & {
  read(path: string, options?: { sessionId?: string }): Promise<string>
} {
  return typeof (box as { read?: unknown }).read === 'function'
}

export function hasWrite(box: SandboxInstance): box is SandboxInstance & {
  write(path: string, content: string): Promise<void>
} {
  return typeof (box as { write?: unknown }).write === 'function'
}

export function hasExec(box: SandboxInstance): box is SandboxInstance & {
  exec(command: string, options?: unknown): Promise<SandboxExecResult>
} {
  return typeof (box as { exec?: unknown }).exec === 'function'
}
