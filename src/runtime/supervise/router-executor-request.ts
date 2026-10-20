import { ValidationError } from '../../errors'
import { observedModelMatchesDeclared } from '../model-identity'
import type { RouterConfig } from '../router-client'
import type { RouterProfileExecution } from './router-profile-execution'
import type { RouterSeam } from './runtime-seams'
import type { ExecutorContext } from './types'

export async function runRouterTransport<T>(context: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    throwRouterTransportFailure(context, error)
  }
}

export function throwRouterTransportFailure(context: string, error: unknown): never {
  if (
    error instanceof ValidationError ||
    (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
  ) {
    throw error
  }
  const message = error instanceof Error ? error.message : String(error)
  throw new ValidationError(`${context}: transport failed: ${message}`)
}

export function assertObservedRouterModel(
  observed: string | undefined,
  expected: string,
  context: string,
): void {
  if (observed !== undefined && !observedModelMatchesDeclared(observed, expected)) {
    throw new ValidationError(
      `${context}: provider reported model ${JSON.stringify(observed)} but AgentProfile requires ${JSON.stringify(expected)}`,
    )
  }
}

export function routerRequestIdentity(ctx: ExecutorContext): {
  readonly callId?: string
  readonly correlationId?: string
  readonly propagatedHeaders?: Readonly<Record<string, string>>
} {
  const correlation = ctx.node?.identity?.correlation
  return {
    ...(correlation?.callId ? { callId: correlation.callId } : {}),
    ...(correlation?.correlationId ? { correlationId: correlation.correlationId } : {}),
    ...(ctx.propagatedHeaders ? { propagatedHeaders: ctx.propagatedHeaders } : {}),
  }
}

export function routerTurnRequestIdentity(
  identity: {
    readonly callId?: string
    readonly correlationId?: string
    readonly propagatedHeaders?: Readonly<Record<string, string>>
  },
  turnIndex: number,
): {
  readonly callId?: string
  readonly correlationId?: string
  readonly propagatedHeaders?: Readonly<Record<string, string>>
} {
  return {
    ...(identity.callId ? { callId: `${identity.callId}:turn:${turnIndex + 1}` } : {}),
    ...(identity.correlationId ? { correlationId: identity.correlationId } : {}),
    ...(identity.propagatedHeaders ? { propagatedHeaders: identity.propagatedHeaders } : {}),
  }
}

/** Lower the profile's retry policy and host transport without introducing defaults. */
export function routerTransportConfig(
  seam: Pick<RouterSeam, 'routerBaseUrl' | 'routerKey' | 'routing' | 'complete'>,
  model: string,
  retry: RouterConfig['retry'],
): RouterConfig {
  return {
    routerBaseUrl: seam.routerBaseUrl,
    routerKey: seam.routerKey,
    ...(seam.routing ? { routing: seam.routing } : {}),
    model,
    ...(retry !== undefined ? { retry } : {}),
    ...(seam.complete ? { complete: seam.complete } : {}),
  }
}

/** Generation fields shared by plain and tool-calling turns, in their original request order. */
export function routerGenerationOptions(
  profileExecution: Pick<
    RouterProfileExecution,
    'tokenLimits' | 'seed' | 'reasoningEffort' | 'extraBody'
  >,
) {
  return {
    ...profileExecution.tokenLimits.applied,
    ...(profileExecution.seed !== undefined ? { seed: profileExecution.seed } : {}),
    ...(profileExecution.reasoningEffort
      ? { reasoningEffort: profileExecution.reasoningEffort }
      : {}),
    ...(profileExecution.extraBody ? { extraBody: profileExecution.extraBody } : {}),
  }
}
