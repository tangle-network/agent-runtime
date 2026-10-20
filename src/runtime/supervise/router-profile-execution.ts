import {
  type AgentProfile,
  type AgentProfileResourceRef,
  profileMaterializationAxes,
  type ReasoningEffort,
} from '@tangle-network/agent-interface'
import {
  assertProfileMaterialization,
  defineProfileMaterializationContract,
} from '../../agent/profile-materialization'
import { ValidationError } from '../../errors'
import { agentHarness } from '../harness-role'
import {
  assertExecutableAgentProfile,
  enforceTokenLimits,
  type ProfileCodeModeSettings,
  type ProfileModelExecutionSettings,
  profileModelExecutionSettings,
  profileProviderModel,
  type TokenLimitDecision,
} from './model-policy'
import type { RouterSeam } from './runtime-seams'
import { taskToPrompt } from './task-prompt'
import type { AgentSpec } from './types'

/**
 * Materialization contract for one direct Router turn.
 *
 * `resourceFailOnError` is carried: this executor has no workspace, so it inlines resource content
 * into the system prompt and applies the profile's own resource-failure policy while it does so
 * (`renderRouterProfilePrompt`). No value of the field is dropped — a strict profile fails closed
 * on a resource that cannot be inlined, and a best-effort profile is refused because this path has
 * no way to report a skipped resource.
 */
const routerTurnProfileMaterialization = defineProfileMaterializationContract({
  name: 'router-profile-turn',
  axes: [
    'name',
    'description',
    'version',
    'tags',
    'systemPrompt',
    'instructions',
    'modelDefault',
    'modelProvider',
    'modelReasoningEffort',
    'modelMaxVisibleOutputTokens',
    'modelMaxTotalOutputTokens',
    'modelMetadata',
    'harness',
    'tools',
    'files',
    'resourceTools',
    'skills',
    'resourceAgents',
    'commands',
    'resourceInstructions',
    'resourceFailOnError',
    'metadata',
  ],
})

export interface RouterProfileExecution {
  systemPrompt: string
  reasoningEffort?: ReasoningEffort
  temperature?: number
  /** Ceilings this path was asked to enforce and the request fields it sends them as. */
  tokenLimits: TokenLimitDecision
  retry?: ProfileModelExecutionSettings['retry']
  seed?: number
  toolChoice?: 'auto' | 'required' | 'none'
  extraBody?: Readonly<Record<string, unknown>>
  maxTurns?: number
  stream?: boolean
  codeMode?: boolean | ProfileCodeModeSettings
}

/** Validate and render every AgentProfile axis the direct Router path claims to carry.
 * Unsupported behavioral axes fail before the HTTP request; inline resources become
 * named system-prompt attachments because this executor has no workspace to mount. */
export function routerProfileExecution(
  profile: AgentProfile,
  seam: RouterSeam,
  mode: { multiTurn: boolean },
): RouterProfileExecution {
  assertProfileMaterialization({
    contract: routerTurnProfileMaterialization,
    changedAxes: profileMaterializationAxes(profile),
    context: 'routerInlineExecutor',
  })

  if (agentHarness(profile.harness) !== undefined) {
    throw new ValidationError(
      `routerInlineExecutor: AgentProfile.harness ${JSON.stringify(profile.harness)} requires a harness executor; the direct Router executor cannot materialize it`,
    )
  }

  const profileEffort = profile.model?.reasoningEffort
  const settings = profileModelExecutionSettings(profile, 'routerInlineExecutor')

  if (!mode.multiTurn && settings.maxTurns !== undefined) {
    throw new ValidationError(
      'routerInlineExecutor: AgentProfile.model.metadata.maxTurns requires the router-tools backend',
    )
  }
  if (!mode.multiTurn && settings.codeMode !== undefined) {
    throw new ValidationError(
      'routerInlineExecutor: AgentProfile.model.metadata.codeMode requires the router-tools backend',
    )
  }
  if (settings.stream === true && seam.complete !== undefined) {
    throw new ValidationError(
      'routerInlineExecutor: AgentProfile.model.metadata.stream requires the HTTP Router transport; RouterSeam.complete returns one buffered completion and cannot serve a stream',
    )
  }

  const declaredTools = profile.tools ?? {}
  const suppliedTools = seam.tools ?? []
  if (settings.toolChoice !== undefined && suppliedTools.length === 0) {
    throw new ValidationError(
      'routerInlineExecutor: AgentProfile.model.metadata.toolChoice requires at least one enabled tool',
    )
  }
  const suppliedNames = new Set<string>()
  for (const tool of suppliedTools) {
    const name = tool.function.name
    if (!name || suppliedNames.has(name)) {
      throw new ValidationError(
        `routerInlineExecutor: caller tool names must be non-empty and unique (${JSON.stringify(name)})`,
      )
    }
    suppliedNames.add(name)
    if (declaredTools[name] !== true) {
      throw new ValidationError(
        `routerInlineExecutor: caller tool ${JSON.stringify(name)} is not enabled by AgentProfile.tools`,
      )
    }
  }
  for (const [name, enabled] of Object.entries(declaredTools)) {
    if (enabled && !suppliedNames.has(name)) {
      throw new ValidationError(
        `routerInlineExecutor: AgentProfile enables tool ${JSON.stringify(name)} but the caller supplied no matching schema`,
      )
    }
    if (!enabled && suppliedNames.has(name)) {
      throw new ValidationError(
        `routerInlineExecutor: AgentProfile disables tool ${JSON.stringify(name)}`,
      )
    }
  }

  const { tokenLimits, ...rest } = settings
  return {
    systemPrompt: renderRouterProfilePrompt(profile),
    ...(profileEffort ? { reasoningEffort: profileEffort } : {}),
    ...rest,
    tokenLimits: enforceTokenLimits(tokenLimits, 'router', 'routerInlineExecutor'),
  }
}

/** Resolve the one model id that will cross the Router boundary from the exact profile only. */
export function exactRouterModel(profile: AgentProfile, context: string): string {
  assertExecutableAgentProfile(profile, context)
  if (agentHarness(profile.harness) !== undefined) {
    throw new ValidationError(
      `${context}: AgentProfile.harness ${JSON.stringify(profile.harness)} conflicts with direct Router execution; use "cli-base"`,
    )
  }
  const model = profileProviderModel(profile)
  if (!model) {
    throw new ValidationError(
      `${context}: AgentProfile.model.default must name a model after provider ${JSON.stringify(profile.model?.provider?.trim())}`,
    )
  }
  return model
}

/**
 * Render the profile prompt plus every resource this executor can inline.
 *
 * The profile's `resources.failOnError` policy decides what happens to a resource that cannot be
 * inlined. Strict (`true` or absent) is the canonical default and fails closed. Best-effort
 * (`false`) asks for the supported subset plus a warning about the rest; this executor has no
 * channel to carry that warning, so it refuses the value instead of silently running strict.
 */
function renderRouterProfilePrompt(profile: AgentProfile): string {
  const sections: string[] = [
    profile.prompt?.systemPrompt,
    ...(profile.prompt?.instructions ?? []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  const resources = profile.resources
  if (!resources) return sections.join('\n')
  if (resources.failOnError === false) {
    throw new ValidationError(
      'routerInlineExecutor: resources.failOnError: false requests a best-effort resource subset; ' +
        'the direct Router executor always fails closed on a resource it cannot inline and reports ' +
        'no skipped resource, so the best-effort policy is refused rather than applied as strict',
    )
  }

  if (typeof resources.instructions === 'string') {
    if (resources.instructions.trim()) sections.push(resources.instructions)
  } else if (resources.instructions) {
    sections.push(renderRouterResource('instructions', resources.instructions))
  }
  for (const file of resources.files ?? []) {
    if (file.executable === true) {
      throw new ValidationError(
        `routerInlineExecutor: executable resource ${JSON.stringify(file.path)} requires a workspace backend`,
      )
    }
    sections.push(renderRouterResource(`file ${file.path}`, file.resource))
  }
  for (const [kind, refs] of [
    ['tool', resources.tools],
    ['skill', resources.skills],
    ['agent', resources.agents],
    ['command', resources.commands],
  ] as const) {
    for (const ref of refs ?? []) sections.push(renderRouterResource(kind, ref))
  }
  return sections.join('\n\n')
}

function renderRouterResource(kind: string, resource: AgentProfileResourceRef): string {
  if (resource.kind !== 'inline') {
    throw new ValidationError(
      `routerInlineExecutor: ${kind} resource ${JSON.stringify(resource.name ?? resource.path)} is not inline and cannot be resolved by the direct Router executor`,
    )
  }
  return `## Attached ${kind}: ${resource.name}\n${resource.content}`
}

/** Router messages from the opaque task + every portable profile prompt instruction.
 * The profile prompt is always the immutable first message. Later system-role messages are
 * preserved as per-call task context; they cannot replace or precede the profile policy. */
export function taskToMessages(
  task: unknown,
  spec: AgentSpec,
  resolvedSystem?: string,
): Array<{ role: string; content: unknown } & Record<string, unknown>> {
  const system =
    resolvedSystem ??
    [spec.profile.prompt?.systemPrompt, ...(spec.profile.prompt?.instructions ?? [])]
      .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
      .join('\n')

  if (
    task &&
    typeof task === 'object' &&
    Array.isArray((task as { messages?: unknown }).messages)
  ) {
    const supplied = (task as { messages: unknown[] }).messages.map((value, index) => {
      if (!value || typeof value !== 'object') {
        throw new ValidationError(`routerInlineExecutor: messages[${index}] must be an object`)
      }
      const message = { ...(value as Record<string, unknown>) }
      if (typeof message.role !== 'string' || !('content' in message)) {
        throw new ValidationError(
          `routerInlineExecutor: messages[${index}] requires role and content`,
        )
      }
      return message as { role: string; content: unknown } & Record<string, unknown>
    })
    if (system.length > 0 && !(supplied[0]?.role === 'system' && supplied[0].content === system)) {
      return [{ role: 'system', content: system }, ...supplied]
    }
    return supplied
  }

  return [
    ...(system.length > 0 ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: taskToPrompt(task) },
  ]
}
