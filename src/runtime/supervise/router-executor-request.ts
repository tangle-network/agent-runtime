import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import { observedModelMatchesDeclared } from '../model-identity'
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
