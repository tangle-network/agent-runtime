import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { ValidationError } from '../errors'
import type { AgentRunSpec, MountRecorder } from './types'
import { destroyEnvironmentSafe, throwIfAborted } from './util'

/** Create and prepare one provider-neutral agent environment. */
export async function createEnvironmentForSpec<Task>(
  provider: AgentEnvironmentProvider,
  spec: AgentRunSpec<Task>,
  signal: AbortSignal,
  recordMount?: MountRecorder,
): Promise<AgentEnvironment> {
  throwIfAborted(signal)

  const validation = await provider.validateProfile?.(spec.profile)
  if (validation && !validation.ok) {
    const details = validation.issues
      .filter((issue) => issue.level === 'error')
      .map((issue) => `${issue.path ? `${issue.path}: ` : ''}${issue.message}`)
      .join('; ')
    throw new ValidationError(
      `runAgentRounds: provider "${provider.name}" rejected profile "${spec.profile.name}"${
        details ? `: ${details}` : ''
      }`,
    )
  }

  throwIfAborted(signal)
  const environment = await provider.create({
    ...(spec.environment ?? {}),
    profile: validation?.normalizedProfile ?? spec.profile,
    signal,
  })
  try {
    throwIfAborted(signal)
    await spec.prepareEnvironment?.(environment, {
      signal,
      recordMount: recordMount ?? noopMountRecorder,
    })
    throwIfAborted(signal)
    return environment
  } catch (error) {
    await destroyEnvironmentSafe(environment)
    throw error
  }
}

const noopMountRecorder: MountRecorder = () => {}
