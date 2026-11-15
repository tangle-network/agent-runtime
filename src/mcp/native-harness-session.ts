/**
 * The local OpenCode 2.3.0 response boundary. The CLI owns execution and session storage;
 * Runtime retains its exact JSONL and export, validates the execution binding, and projects
 * the terminal response. This is deliberately not a second native-session database reader.
 *
 * The export's model is turn context, not a provider-served identity. Its cost combines
 * provider charges and catalog estimates without provenance. Neither becomes observed billing.
 */
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type { WorkspacePlan } from '@tangle-network/agent-profile-materialize'
import { recordValue } from '../record-value'
import { profileProviderModel } from '../runtime/supervise/model-policy'
import type { LocalHarnessResult, runLocalHarness } from './local-harness-process'

const CONTRACT_VERSION = '2.3.0'
const SESSION_ID = /^ses_[A-Za-z0-9_-]+$/u
const EXPORT_TIMEOUT_MS = 15_000
const EXPORT_MAX_BYTES = 8 * 1024 * 1024

/** Native session tokens with disjoint cache and output classes. A normalized zero
 * cannot distinguish absent provider usage from measured zero and remains null. @experimental */
export interface NativeSessionUsage {
  readonly input: number | null
  readonly output: number | null
  readonly freshInput: number | null
  readonly visibleOutput: number | null
  readonly reasoningOutput: number | null
  readonly cachedInput: number | null
  readonly cacheWriteInput: number | null
}

/** A bound OpenCode 2.3.0 response with raw native records and explicit evidence limits. @experimental */
export interface NativeHarnessSessionEvidence {
  readonly kind: 'opencode-native-session'
  readonly cliVersion: '2.3.0'
  readonly sessionId: string | null
  readonly workspacePath: string
  readonly nativeModel: string | null
  readonly nativeAgent: string | null
  readonly nativeVariant: string | null
  readonly modelSource: 'turn-context'
  readonly servedModel: null
  readonly status: 'completed' | 'failed' | 'unavailable'
  readonly finishReason: string | null
  readonly finalText: string
  readonly usage: NativeSessionUsage | null
  readonly usageScope: 'exported-native-session'
  readonly tokensKnown: boolean
  readonly billedCostUsd: null
  /** Native amount has no provider-versus-catalog attribution; never a bill. */
  readonly reportedCostUsd: number | null
  readonly visibleOutputLimit?: {
    readonly tokens: number
    readonly wireField: 'max_tokens'
    readonly scope: 'per-completion'
    readonly observed: 'within-limit' | 'exceeded' | 'unknown'
  }
  readonly error?: string
  readonly nativeError?: unknown
  readonly skillInvocations: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly callId: string
    readonly outputText: string
    readonly outputSha256: string
    /** Present only when the actual loaded body and directory match the mounted profile resource. */
    readonly resourceDigest?: string
    readonly mountedContentDigest?: string
  }>
  readonly toolNames: ReadonlyArray<string>
  readonly events: { readonly sha256: string; readonly text: string }
  readonly sessionExport: { readonly sha256: string; readonly text: string } | null
}

interface NativeProcessContext {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly runHarness: typeof runLocalHarness
  readonly signal?: AbortSignal
  readonly skills?: ReadonlyArray<NativeSkillBinding>
  readonly expectedAgent?: string
  readonly expectedVariant?: string
  readonly maxVisibleOutputTokens?: number
}

/** Lower the exact profile's visible ceiling through OpenCode 2.3.0's native model policy.
 * The normal protocol emits only max_tokens; reasoning and total ceilings remain unsupported. */
export function nativeSessionModelPlan(plan: WorkspacePlan, profile: AgentProfile): WorkspacePlan {
  assertNativePrimaryDescription(plan, profile)
  const declared = profile.model?.default,
    provider = profile.model?.provider
  if (
    !declared ||
    !provider ||
    declared.includes('#') ||
    (declared.includes('/') && !declared.startsWith(`${provider}/`))
  ) {
    throw new Error(
      'native-session requires a matching explicit provider/model and a separate reasoningEffort variant',
    )
  }
  const cap = profile.model?.maxVisibleOutputTokens
  if (cap === undefined) return plan
  if (!Number.isSafeInteger(cap) || cap <= 0)
    throw new Error('native-session visible output cap must be a positive safe integer')
  const model = profileProviderModel(profile)
  if (!provider || !model) throw new Error('native-session requires an exact provider/model')
  if (provider !== 'opencode' || model !== 'glm-5.3-flash-free') {
    throw new Error(
      'native-session visible output caps are qualified only for opencode/glm-5.3-flash-free on OpenCode 2.3.0',
    )
  }
  const existing = plan.files.find((file) => file.relPath === 'opencode.json')
  if (existing && (existing.source !== 'generated' || typeof existing.content !== 'string')) {
    throw new Error('native-session model controls conflict with a profile-owned opencode.json')
  }
  const config = existing ? JSON.parse(existing.content as string) : {}
  if (recordValue(config) === undefined)
    throw new Error('native-session generated config must be an object')
  const providers = recordValue(config.providers) ?? {},
    providerConfig = recordValue(providers[provider]) ?? {}
  const models = recordValue(providerConfig.models) ?? {},
    modelConfig = recordValue(models[model]) ?? {}
  config.providers = {
    ...providers,
    [provider]: {
      ...providerConfig,
      models: {
        ...models,
        [model]: {
          ...modelConfig,
          limit: { ...(recordValue(modelConfig.limit) ?? {}), output: cap },
          compatibility: {
            ...(recordValue(modelConfig.compatibility) ?? {}),
            maxTokensField: 'max_tokens',
          },
          body: { ...(recordValue(modelConfig.body) ?? {}), max_tokens: cap },
        },
      },
    },
  }
  return {
    ...plan,
    files: [
      ...plan.files.filter((file) => file.relPath !== 'opencode.json'),
      {
        ...(existing ?? { relPath: 'opencode.json', source: 'generated' as const }),
        content: JSON.stringify(config, null, 2),
      },
    ],
  }
}

/** Older materializers omit this identity field. Qualify the selected native file before launch,
 * rather than admitting a description that exists only in the profile digest or prompt body. */
function assertNativePrimaryDescription(plan: WorkspacePlan, profile: AgentProfile): void {
  if (profile.description === undefined) return
  const agentFlag = plan.flags.indexOf('--agent')
  const agent = agentFlag < 0 ? undefined : plan.flags[agentFlag + 1]
  const file =
    typeof agent === 'string'
      ? plan.files.find(
          (entry) =>
            entry.relPath === `.opencode/agents/${agent}.md` &&
            entry.source === 'generated' &&
            (entry.root === undefined || entry.root === 'workspace'),
        )
      : undefined
  const frontmatter =
    typeof file?.content === 'string'
      ? /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(file.content)?.[1]
      : undefined
  if (!frontmatter?.split(/\r?\n/u).includes(`description: ${JSON.stringify(profile.description)}`))
    throw new Error(
      'native-session materializer did not preserve profile.description on the selected primary agent',
    )
}

interface NativeSkillBinding {
  readonly id: string
  readonly directory: string
  readonly body: string
  readonly resourceDigest: string
  readonly mountedContentDigest: string
}

/** Snapshot the exact mounted bytes before the model starts; never infer consumption from a name. */
export async function nativeSessionSkillBindings(
  cwd: string,
  profile: AgentProfile,
  writtenPaths: ReadonlyArray<string>,
): Promise<ReadonlyArray<NativeSkillBinding>> {
  const bindings: NativeSkillBinding[] = []
  for (const resource of profile.resources?.skills ?? []) {
    if (resource.kind !== 'inline' || typeof resource.name !== 'string') continue
    const path = `.opencode/skills/${resource.name}/SKILL.md`
    if (!writtenPaths.includes(path)) continue
    const content = await readFile(resolve(cwd, path), 'utf8')
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '').trim()
    if (!body) continue
    bindings.push({
      id: resource.name,
      directory: await realpath(dirname(resolve(cwd, path))),
      body,
      resourceDigest: canonicalCandidateDigest(resource),
      mountedContentDigest: sha256(content),
    })
  }
  return bindings
}

/** Refuse a different native wire contract before it can dispatch inference. */
export async function assertNativeSessionVersion(context: NativeProcessContext): Promise<void> {
  const result = await context.runHarness({
    harness: 'opencode',
    cwd: context.cwd,
    taskPrompt: '',
    invocation: { command: 'opencode', args: ['--version'] },
    env: context.env,
    timeoutMs: EXPORT_TIMEOUT_MS,
    maxOutputBytes: 4096,
    ...(context.signal ? { signal: context.signal } : {}),
  })
  const observedVersion = result.stdout.trim().replace(/^opencode v/u, '')
  if (result.exitCode !== 0 || result.timedOut || observedVersion !== CONTRACT_VERSION) {
    throw new Error(
      `native-session requires the validated OpenCode ${CONTRACT_VERSION} contract; observed ${JSON.stringify(result.stdout.trim())} (exit ${result.exitCode})`,
    )
  }
}

/** Export only the session named by this process; never discover or resume another session. */
export async function captureNativeSession(
  context: NativeProcessContext,
  run: LocalHarnessResult,
): Promise<NativeHarnessSessionEvidence> {
  const workspacePath = await realpath(context.cwd)
  const ids = new Set<string>()
  let nativeError: unknown
  let malformed = false
  for (const line of run.stdout.split(/\r?\n/u)) {
    if (!line.trim()) continue
    try {
      const event = recordValue(JSON.parse(line))
      if (!event) {
        malformed = true
        continue
      }
      if (typeof event.sessionID === 'string' && SESSION_ID.test(event.sessionID))
        ids.add(event.sessionID)
      if (event.type === 'error') nativeError = event.error
    } catch {
      malformed = true
    }
  }
  const sessionId = ids.size === 1 ? [...ids][0]! : null
  const base: NativeHarnessSessionEvidence = {
    kind: 'opencode-native-session' as const,
    cliVersion: CONTRACT_VERSION,
    sessionId,
    workspacePath,
    nativeModel: null,
    nativeAgent: null,
    nativeVariant: null,
    modelSource: 'turn-context' as const,
    servedModel: null,
    status: 'unavailable' as const,
    finishReason: null,
    finalText: '',
    usage: null,
    usageScope: 'exported-native-session' as const,
    tokensKnown: false,
    billedCostUsd: null,
    reportedCostUsd: null,
    skillInvocations: [],
    toolNames: [],
    events: { sha256: sha256(run.stdout), text: run.stdout },
    sessionExport: null,
    ...(nativeError === undefined ? {} : { nativeError }),
  }
  if (sessionId === null || malformed) {
    return { ...base, error: 'native-session JSONL did not bind one readable session' }
  }
  let exported: LocalHarnessResult
  try {
    exported = await context.runHarness({
      harness: 'opencode',
      cwd: context.cwd,
      taskPrompt: '',
      invocation: { command: 'opencode', args: ['session', 'export', sessionId, '--standalone'] },
      env: context.env,
      timeoutMs: EXPORT_TIMEOUT_MS,
      maxOutputBytes: EXPORT_MAX_BYTES,
      ...(context.signal ? { signal: context.signal } : {}),
    })
  } catch (error) {
    return { ...base, error: `native-session export failed: ${String(error)}` }
  }
  const sessionExport = { sha256: sha256(exported.stdout), text: exported.stdout }
  if (exported.exitCode !== 0 || exported.timedOut) {
    return { ...base, sessionExport, error: `native-session export exited ${exported.exitCode}` }
  }
  try {
    return projectNativeSession(
      { ...base, sessionExport },
      JSON.parse(exported.stdout),
      run,
      context.skills ?? [],
      context.expectedAgent,
      context.expectedVariant,
      context.maxVisibleOutputTokens,
    )
  } catch (error) {
    return { ...base, sessionExport, error: `native-session export unreadable: ${String(error)}` }
  }
}

function projectNativeSession(
  base: NativeHarnessSessionEvidence,
  value: unknown,
  run: LocalHarnessResult,
  skills: ReadonlyArray<NativeSkillBinding>,
  expectedAgent: string | undefined,
  expectedVariant: string | undefined,
  maxVisibleOutputTokens: number | undefined,
): NativeHarnessSessionEvidence {
  const document = recordValue(value)
  const info = recordValue(document?.info)
  const location = recordValue(info?.location)
  const model = recordValue(info?.model)
  if (
    info?.id !== base.sessionId ||
    typeof location?.directory !== 'string' ||
    resolve(location.directory) !== base.workspacePath ||
    typeof model?.id !== 'string' ||
    typeof model.providerID !== 'string' ||
    (expectedAgent !== undefined && info.agent !== expectedAgent) ||
    (expectedVariant !== undefined && model.variant !== expectedVariant) ||
    !Array.isArray(document?.messages)
  )
    throw new Error(
      'session id, workspace, agent, model route/variant or V2 message contract does not match',
    )
  const messages = document.messages.map(recordValue)
  if (messages.some((message) => message === undefined)) throw new Error('invalid V2 message')
  const assistants = messages.filter((message) => message?.type === 'assistant')
  const last = assistants.at(-1)
  const lastTime = recordValue(last?.time)
  const lastContent = Array.isArray(last?.content) ? last.content.map(recordValue) : []
  const nativeModel = `${model.providerID}/${model.id}`
  for (const assistant of assistants) {
    const selected = recordValue(assistant?.model)
    if (
      selected?.providerID !== model.providerID ||
      selected?.id !== model.id ||
      selected?.variant !== model.variant ||
      (expectedAgent !== undefined && assistant?.agent !== expectedAgent)
    ) {
      throw new Error('assistant agent or model route/variant changed within the session')
    }
  }
  const usage = readNativeUsage(info.tokens)
  const billable = messages.filter(
    (message) => message?.type === 'assistant' || message?.type === 'compaction',
  )
  const perMessage = billable.map((message) => {
    // A resumed/retried assistant can retain the previous attempt's token fields.
    // Only a settled response owns its counters; failed rows may retain stale usage.
    const settled =
      message?.type === 'compaction'
        ? message.status === 'completed'
        : typeof recordValue(message?.time)?.completed === 'number' &&
          typeof message?.finish === 'string' &&
          message.finish !== 'error' &&
          message.error === undefined &&
          message.retry === undefined
    return settled ? readNativeUsage(message?.tokens) : null
  })
  const usageComplete =
    usage !== null &&
    perMessage.length > 0 &&
    (Object.keys(usage) as Array<keyof NativeSessionUsage>).every(
      (key) =>
        usage[key] !== null &&
        perMessage.every((row) => row?.[key] !== null && row?.[key] !== undefined) &&
        perMessage.reduce((total, row) => total + row![key]!, 0) === usage[key],
    )
  const visibleComplete =
    usage?.visibleOutput !== null &&
    usage?.visibleOutput !== undefined &&
    perMessage.length > 0 &&
    perMessage.every((row) => row?.visibleOutput !== null && row?.visibleOutput !== undefined) &&
    perMessage.reduce((total, row) => total + row!.visibleOutput!, 0) === usage.visibleOutput
  const outputExceeded =
    maxVisibleOutputTokens !== undefined &&
    perMessage.some(
      (row) =>
        row?.visibleOutput !== null &&
        row?.visibleOutput !== undefined &&
        row.visibleOutput > maxVisibleOutputTokens,
    )
  const finalText = lastContent
    .filter((part) => part?.type === 'text')
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
  const tools = assistants
    .flatMap((message) => (Array.isArray(message?.content) ? message.content : []))
    .map(recordValue)
    .filter((part) => part?.type === 'tool')
  const toolNames = [
    ...new Set(
      tools.map((part) => part?.name).filter((name): name is string => typeof name === 'string'),
    ),
  ]
  const skillInvocations = tools.flatMap((part) => {
    const state = recordValue(part?.state)
    const input = recordValue(state?.input)
    const metadata = recordValue(state?.metadata)
    if (
      part?.name !== 'skill' ||
      state?.status !== 'completed' ||
      typeof part.id !== 'string' ||
      typeof input?.id !== 'string' ||
      typeof metadata?.name !== 'string' ||
      !Array.isArray(state.content)
    )
      return []
    const outputText = state.content
      .map(recordValue)
      .filter((item) => item?.type === 'text')
      .map((item) => (typeof item?.text === 'string' ? item.text : ''))
      .join('')
    if (!outputText) return []
    const binding = skills.find(
      (skill) =>
        skill.id === input.id &&
        metadata.directory === skill.directory &&
        outputText.startsWith(
          `<skill_content name="${metadata.name}">\n# Skill: ${metadata.name}\n\n${skill.body}\n\nBase directory for this skill: ${skill.directory}\nRelative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.\nNote: file list is sampled.\n\n<skill_files>\n`,
        ) &&
        outputText.endsWith('\n</skill_files>\n</skill_content>'),
    )
    return [
      {
        id: input.id,
        name: metadata.name,
        callId: part.id,
        outputText,
        outputSha256: sha256(outputText),
        ...(binding
          ? {
              resourceDigest: binding.resourceDigest,
              mountedContentDigest: binding.mountedContentDigest,
            }
          : {}),
      },
    ]
  })
  const lastError =
    last?.error ??
    messages.filter((message) => message?.type === 'idle').at(-1)?.error ??
    base.nativeError
  const completed =
    run.exitCode === 0 &&
    !run.timedOut &&
    !run.aborted &&
    info.outcome === 'succeeded' &&
    typeof lastTime?.completed === 'number' &&
    typeof last?.finish === 'string' &&
    last.finish !== 'error' &&
    !outputExceeded &&
    lastError === undefined
  // Session totals include native title/compaction work. Child sessions require their own export;
  // a local response does not claim to have captured that separate execution tree.
  const hasUncapturedChildren = toolNames.some((name) => name !== 'skill')
  return {
    ...base,
    nativeModel,
    nativeAgent: typeof info.agent === 'string' ? info.agent : null,
    nativeVariant: typeof model.variant === 'string' ? model.variant : null,
    status: completed ? 'completed' : 'failed',
    finishReason: typeof last?.finish === 'string' ? last.finish : null,
    finalText,
    usage,
    tokensKnown: usageComplete && !hasUncapturedChildren,
    reportedCostUsd:
      typeof info.cost === 'number' && Number.isFinite(info.cost) && info.cost >= 0
        ? info.cost
        : null,
    ...(maxVisibleOutputTokens === undefined
      ? {}
      : {
          visibleOutputLimit: {
            tokens: maxVisibleOutputTokens,
            wireField: 'max_tokens' as const,
            scope: 'per-completion' as const,
            observed: outputExceeded
              ? ('exceeded' as const)
              : visibleComplete
                ? ('within-limit' as const)
                : ('unknown' as const),
          },
        }),
    toolNames,
    skillInvocations,
    ...(lastError === undefined ? {} : { nativeError: lastError }),
    ...(completed
      ? {}
      : {
          error:
            (outputExceeded
              ? `OpenCode exceeded the visible per-completion output cap ${maxVisibleOutputTokens}`
              : nativeErrorText(lastError)) ??
            `OpenCode session ended ${String(info.outcome ?? last?.finish ?? 'without a terminal receipt')}`,
        }),
  }
}

/** OpenCode 2.3.0 SessionUsage.tokens defaults every absent class to zero. Positive
 * values are retained observations; neither normalized zero nor a sum proves a missing class. */
function readNativeUsage(value: unknown): NativeSessionUsage | null {
  const tokens = recordValue(value),
    cache = recordValue(tokens?.cache)
  const counts = [tokens?.input, tokens?.output, tokens?.reasoning, cache?.read, cache?.write]
  if (
    !counts.every(
      (count) =>
        count === undefined ||
        (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0),
    )
  )
    return null
  const observed = counts.map((count) => (typeof count === 'number' && count > 0 ? count : null))
  if (observed.every((count) => count === null)) return null
  const [freshInput, visibleOutput, reasoningOutput, cachedInput, cacheWriteInput] = observed
  const sum = (...values: Array<number | null | undefined>): number | null => {
    if (values.some((value) => value === null || value === undefined)) return null
    const total = values.reduce<number>((total, value) => total + value!, 0)
    return Number.isSafeInteger(total) ? total : null
  }
  return {
    input: sum(freshInput, cachedInput, cacheWriteInput),
    output: sum(visibleOutput, reasoningOutput),
    freshInput: freshInput!,
    visibleOutput: visibleOutput!,
    reasoningOutput: reasoningOutput!,
    cachedInput: cachedInput!,
    cacheWriteInput: cacheWriteInput!,
  }
}

function nativeErrorText(value: unknown): string | undefined {
  const error = recordValue(value)
  if (typeof error?.message !== 'string') return undefined
  return `${error.message}${typeof error.status === 'number' ? ` (HTTP ${error.status})` : ''}`
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}
