import type {
  AgentCandidateModelAccessNetwork,
  AgentCandidateResolvedModel,
  Sha256Digest,
} from '@tangle-network/agent-interface'

import { canonicalCandidateDigest, immutableCandidateValue } from './digest'
import { assertExactObjectKeys } from './exact-object'
import { sealAgentCandidateModelSettlement, usdToNanos } from './model-settlement'
import type {
  AgentCandidateModelLimits,
  AgentCandidateModelPort,
  AgentCandidateProtectedModelActivation,
  AgentCandidateProtectedModelReservation,
  AgentCandidateProtectedModelSettlement,
} from './types'

export type AgentCandidateModelGrantReserveInput = Parameters<
  AgentCandidateModelPort['reserveGrant']
>[0]
export type AgentCandidateModelGrantActivateInput = Parameters<
  AgentCandidateModelPort['activateGrant']
>[0]
export type AgentCandidateModelGrantSettleInput = Parameters<
  AgentCandidateModelPort['settleGrant']
>[0]

/** Secret-free response from the service's reservation endpoint. */
export type AgentCandidateModelGrantReservation = AgentCandidateProtectedModelReservation

/**
 * Narrow transport contract for a service that owns scoped model credentials
 * and the authoritative per-call usage ledger.
 *
 * An HTTP client can bind these methods to control-plane endpoints. Keeping
 * transport out of the runtime prevents parent credentials, endpoint paths,
 * and retry policy from becoming part of the portable candidate contract.
 */
export interface AgentCandidateModelGrantClient {
  reserve(input: AgentCandidateModelGrantReserveInput): Promise<AgentCandidateModelGrantReservation>
  activate(
    input: AgentCandidateModelGrantActivateInput,
  ): Promise<AgentCandidateProtectedModelActivation>
  settle(
    input: AgentCandidateModelGrantSettleInput,
  ): Promise<AgentCandidateProtectedModelSettlement>
}

export interface CreateProtectedAgentCandidateModelPortOptions {
  client: AgentCandidateModelGrantClient
  /** Catalog/snapshot resolution stays separate from credential issuance. */
  resolveModel: AgentCandidateModelPort['resolve']
  /** The only public DNS name candidate processes may reach for inference. */
  gatewayDomain: string
  /** Exact environment names the activation endpoint must return, no more or fewer. */
  activationEnvNames: readonly string[]
}

interface RememberedReservation {
  requestDigest: Sha256Digest
  responseDigest: Sha256Digest
  executionId: string
  preparationId: string
  grantDigest: Sha256Digest
  expiresAtMs: number
  resolved: AgentCandidateResolvedModel
  limits: AgentCandidateModelLimits
  maxCostUsdNanos: number
  activation: 'reserved' | 'activating' | 'activated'
  settlementDigest?: Sha256Digest
  settlementReason?: AgentCandidateModelGrantSettleInput['reason']
}

interface RememberedSettlement {
  settlementDigest: Sha256Digest
  settlementReason: AgentCandidateModelGrantSettleInput['reason']
  expiresAtMs: number
}

const MAX_RECENT_SETTLEMENTS = 4_096
const RECOVERED_SETTLEMENT_RETENTION_MS = 15 * 60 * 1_000

/**
 * Bind a protected model-grant service to the immutable candidate runtime.
 *
 * The service remains the authority for expiry, admission, revocation, and
 * metering. This adapter independently checks every response before allowing
 * it to cross into candidate execution or durable receipt finalization.
 */
export function createProtectedAgentCandidateModelPort(
  options: CreateProtectedAgentCandidateModelPortOptions,
): AgentCandidateModelPort {
  const gatewayDomain = assertGatewayDomain(options.gatewayDomain)
  const activationEnvNames = exactEnvironmentNames(options.activationEnvNames)
  const reservations = new Map<string, RememberedReservation>()
  const recentSettlements = new Map<string, RememberedSettlement>()

  return {
    resolve: async (input) => {
      const request = immutableCandidateValue(input)
      const resolved = validateResolvedModel(await options.resolveModel(request), request)
      return immutableCandidateValue(resolved)
    },

    reserveGrant: async (input) => {
      pruneExpiredState(reservations, recentSettlements, Date.now())
      const request = immutableCandidateValue(input)
      validateReserveInput(request)
      const requestDigest = canonicalCandidateDigest(request)
      const key = reservationKey(request.executionId, request.preparationId)
      if (recentSettlements.has(key)) {
        throw new Error('protected model reservation is already settled')
      }
      const previous = reservations.get(key)
      if (previous && previous.requestDigest !== requestDigest) {
        throw new Error('protected model reservation retry changed immutable input')
      }

      const reservation = validateReservation(
        await options.client.reserve(request),
        request,
        gatewayDomain,
      )
      const responseDigest = canonicalCandidateDigest(reservation)
      if (recentSettlements.has(key)) {
        throw new Error('protected model reservation completed after the grant was settled')
      }
      const recorded = previous ?? reservations.get(key)
      if (recorded && recorded.requestDigest !== requestDigest) {
        throw new Error('protected model reservation retry changed immutable input')
      }
      if (recorded && recorded.responseDigest !== responseDigest) {
        throw new Error('protected model reservation retry returned different evidence')
      }
      if (!recorded) {
        reservations.set(key, {
          requestDigest,
          responseDigest,
          executionId: request.executionId,
          preparationId: request.preparationId,
          grantDigest: reservation.digest,
          expiresAtMs: request.expiresAtMs,
          resolved: immutableCandidateValue(request.resolved),
          limits: immutableCandidateValue(request.limits),
          maxCostUsdNanos: usdToNanos(request.limits.maxCostUsd, 'reserved maxCostUsd'),
          activation: 'reserved',
        })
      }
      return reservation
    },

    activateGrant: async (input) => {
      pruneExpiredState(reservations, recentSettlements, Date.now())
      const request = immutableCandidateValue(input)
      const key = reservationKey(request.executionId, request.preparationId)
      if (recentSettlements.has(key)) throw new Error('protected model grant is already settled')
      const state = reservations.get(key)
      if (!state) throw new Error('protected model grant was not reserved by this port')
      assertGrantIdentity(state, request)
      if (state.settlementDigest) throw new Error('protected model grant is already settled')
      if (state.activation !== 'reserved') {
        throw new Error('protected model grant activation is single-use')
      }
      if (!Number.isSafeInteger(request.deadlineAtMs) || request.deadlineAtMs <= 0) {
        throw new Error('protected model activation deadline must be a positive safe integer')
      }
      if (request.deadlineAtMs <= Date.now()) {
        throw new Error('protected model activation deadline must be in the future')
      }
      if (request.deadlineAtMs > state.expiresAtMs) {
        throw new Error('protected model activation deadline exceeds the reserved expiry')
      }
      state.activation = 'activating'
      try {
        const activation = validateActivation(
          await options.client.activate(request),
          state.limits.maxModelCalls === 0 ? [] : activationEnvNames,
        )
        if (recentSettlements.has(key) || reservations.get(key) !== state) {
          throw new Error('protected model grant settled while activation was in flight')
        }
        state.activation = 'activated'
        return activation
      } catch (error) {
        state.activation = 'reserved'
        throw error
      }
    },

    settleGrant: async (input) => {
      const now = Date.now()
      pruneExpiredState(reservations, recentSettlements, now)
      const request = immutableCandidateValue(input)
      const key = reservationKey(request.executionId, request.preparationId)
      const state = reservations.get(key)
      if (state) assertGrantIdentity(state, request)
      const remembered = state ?? recentSettlements.get(key)
      if (remembered?.settlementReason && remembered.settlementReason !== request.reason) {
        throw new Error('protected model settlement retry changed the termination reason')
      }

      const sealed = sealAgentCandidateModelSettlement(await options.client.settle(request), {
        preparationId: request.preparationId,
        grantDigest: request.grantDigest,
        model: request.resolved.model,
      })
      if (state) assertWithinReservedLimits(sealed.fixedUsage, state)

      const settlementDigest = canonicalCandidateDigest(sealed.value)
      if (remembered?.settlementDigest && remembered.settlementDigest !== settlementDigest) {
        throw new Error('protected model settlement retry returned a different final ledger')
      }
      if (remembered?.settlementReason && remembered.settlementReason !== request.reason) {
        throw new Error('protected model settlement retry changed the termination reason')
      }
      const expiresAtMs = state?.expiresAtMs ?? now + RECOVERED_SETTLEMENT_RETENTION_MS
      if (state) {
        state.settlementDigest = settlementDigest
        state.settlementReason = request.reason
      }
      reservations.delete(key)
      rememberSettlement(recentSettlements, key, {
        settlementDigest,
        settlementReason: request.reason,
        expiresAtMs,
      })
      return sealed.value
    },
  }
}

function validateReserveInput(input: AgentCandidateModelGrantReserveInput): void {
  if (!Number.isSafeInteger(input.expiresAtMs) || input.expiresAtMs <= 0) {
    throw new Error('protected model reservation expiry must be a positive safe integer')
  }
  if (input.expiresAtMs <= Date.now()) {
    throw new Error('protected model reservation expiry must be in the future')
  }
  for (const [name, value] of [
    ['maxModelCalls', input.limits.maxModelCalls],
    ['maxInputTokens', input.limits.maxInputTokens],
    ['maxOutputTokens', input.limits.maxOutputTokens],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`protected model reservation ${name} must be a nonnegative safe integer`)
    }
  }
  usdToNanos(input.limits.maxCostUsd, 'reserved maxCostUsd')
}

function validateReservation(
  value: unknown,
  expected: AgentCandidateModelGrantReserveInput,
  gatewayDomain: string,
): AgentCandidateModelGrantReservation {
  const source = exactRecord(
    value,
    ['preparationId', 'digest', 'expiresAtMs', 'enforcedLimits', 'network'],
    'protected model reservation response',
  )
  if (source.preparationId !== expected.preparationId) {
    throw new Error('protected model reservation response changed preparation identity')
  }
  if (!isSha256Digest(source.digest)) {
    throw new Error('protected model reservation response has an invalid digest')
  }
  if (source.expiresAtMs !== expected.expiresAtMs) {
    throw new Error('protected model reservation response changed expiry')
  }
  exactRecord(
    source.enforcedLimits,
    ['maxModelCalls', 'maxInputTokens', 'maxOutputTokens', 'maxCostUsd'],
    'protected model reservation enforced limits',
  )
  if (
    canonicalCandidateDigest(source.enforcedLimits) !== canonicalCandidateDigest(expected.limits)
  ) {
    throw new Error('protected model reservation response changed enforced limits')
  }

  const network = validateReservationNetwork(
    source.network,
    expected.limits.maxModelCalls,
    gatewayDomain,
  )
  return immutableCandidateValue({
    preparationId: source.preparationId,
    digest: source.digest,
    expiresAtMs: source.expiresAtMs,
    enforcedLimits: source.enforcedLimits,
    network,
  }) as AgentCandidateModelGrantReservation
}

function validateReservationNetwork(
  value: unknown,
  maxModelCalls: number,
  gatewayDomain: string,
): AgentCandidateModelAccessNetwork {
  if (maxModelCalls === 0) {
    const source = exactRecord(value, ['mode'], 'protected model reservation network')
    if (source.mode !== 'disabled') {
      throw new Error('zero-call protected model reservation must disable gateway access')
    }
    return { mode: 'disabled' }
  }

  const source = exactRecord(value, ['mode', 'domains'], 'protected model reservation network')
  if (source.mode !== 'gateway-only') {
    throw new Error('protected model reservation must allow only its model gateway')
  }
  if (
    !Array.isArray(source.domains) ||
    source.domains.length !== 1 ||
    source.domains[0] !== gatewayDomain
  ) {
    throw new Error('protected model reservation returned an unexpected gateway domain')
  }
  return { mode: 'gateway-only', domains: [gatewayDomain] }
}

function validateActivation(
  value: unknown,
  expectedNames: readonly string[],
): AgentCandidateProtectedModelActivation {
  const source = exactRecord(value, ['env'], 'protected model activation response')
  const env = record(source.env, 'protected model activation environment')
  const actualNames = Object.keys(env).sort()
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error('protected model activation returned unexpected environment names')
  }
  const detached: Record<string, string> = Object.create(null) as Record<string, string>
  for (const name of expectedNames) {
    const value = env[name]
    if (typeof value !== 'string' || value.length < 8 || value.length > 65_536) {
      throw new Error(`protected model activation ${name} must be a non-empty protected value`)
    }
    detached[name] = value
  }
  return Object.freeze({ env: Object.freeze(detached) })
}

function validateResolvedModel(
  value: unknown,
  expected: Parameters<AgentCandidateModelPort['resolve']>[0],
): AgentCandidateResolvedModel {
  const source = exactRecord(
    value,
    ['requested', 'provider', 'model', 'snapshot', 'reasoningEffort'],
    'resolved candidate model',
  )
  if (source.requested !== expected.requested) {
    throw new Error('model resolver changed the evaluator-owned request')
  }
  if (source.reasoningEffort !== expected.reasoningEffort) {
    throw new Error('model resolver changed the evaluator-owned reasoning effort')
  }
  for (const name of ['requested', 'provider', 'model', 'snapshot'] as const) {
    if (typeof source[name] !== 'string' || source[name].length === 0) {
      throw new Error(`resolved candidate model ${name} must be non-empty`)
    }
  }
  return source as unknown as AgentCandidateResolvedModel
}

function assertGrantIdentity(
  expected: RememberedReservation,
  actual: AgentCandidateModelGrantActivateInput | AgentCandidateModelGrantSettleInput,
): void {
  if (
    actual.executionId !== expected.executionId ||
    actual.preparationId !== expected.preparationId ||
    actual.grantDigest !== expected.grantDigest ||
    canonicalCandidateDigest(actual.resolved) !== canonicalCandidateDigest(expected.resolved)
  ) {
    throw new Error('protected model grant input does not match its immutable reservation')
  }
}

function assertWithinReservedLimits(
  usage: {
    modelCalls: number
    inputTokens: number
    outputTokens: number
    costUsdNanos: number
  },
  reservation: RememberedReservation,
): void {
  for (const [name, actual, limit] of [
    ['model calls', usage.modelCalls, reservation.limits.maxModelCalls],
    ['input tokens', usage.inputTokens, reservation.limits.maxInputTokens],
    ['output tokens', usage.outputTokens, reservation.limits.maxOutputTokens],
    ['cost USD nanos', usage.costUsdNanos, reservation.maxCostUsdNanos],
  ] as const) {
    if (actual > limit) {
      throw new Error(`protected model settlement ${name} ${actual} exceeds reserved ${limit}`)
    }
  }
}

function exactEnvironmentNames(values: readonly string[]): readonly string[] {
  if (values.length === 0) {
    throw new Error('protected model activation environment names must not be empty')
  }
  const names = [...values].sort()
  if (new Set(names).size !== names.length) {
    throw new Error('protected model activation environment names must be unique')
  }
  for (const name of names) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
      ['__proto__', 'constructor', 'prototype'].includes(name)
    ) {
      throw new Error(`protected model activation environment name is invalid: ${name}`)
    }
  }
  return Object.freeze(names)
}

function assertGatewayDomain(value: string): string {
  if (
    value.length > 253 ||
    value !== value.toLowerCase() ||
    value.endsWith('.') ||
    value.includes(':') ||
    value === 'localhost' ||
    value.endsWith('.localhost') ||
    value === 'metadata.google' ||
    value === 'metadata.google.internal'
  ) {
    throw new Error('protected model gateway must be an exact lowercase public DNS name')
  }
  const labels = value.split('.')
  if (
    labels.length < 2 ||
    !labels.every(
      (label) =>
        label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    ) ||
    !/[a-z]/.test(labels.at(-1) ?? '')
  ) {
    throw new Error('protected model gateway must be an exact lowercase public DNS name')
  }
  return value
}

function reservationKey(executionId: string, preparationId: string): string {
  return canonicalCandidateDigest({ executionId, preparationId })
}

function pruneExpiredState(
  reservations: Map<string, RememberedReservation>,
  settlements: Map<string, RememberedSettlement>,
  now: number,
): void {
  for (const [key, value] of reservations) {
    if (value.expiresAtMs <= now) reservations.delete(key)
  }
  for (const [key, value] of settlements) {
    if (value.expiresAtMs <= now) settlements.delete(key)
  }
}

function rememberSettlement(
  settlements: Map<string, RememberedSettlement>,
  key: string,
  value: RememberedSettlement,
): void {
  settlements.delete(key)
  settlements.set(key, value)
  while (settlements.size > MAX_RECENT_SETTLEMENTS) {
    const oldest = settlements.keys().next().value
    if (oldest === undefined) return
    settlements.delete(oldest)
  }
}

function isSha256Digest(value: unknown): value is Sha256Digest {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  const source = record(value, label)
  assertExactObjectKeys(source, keys, label)
  return source
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object`)
  }
  return value as Record<string, unknown>
}
