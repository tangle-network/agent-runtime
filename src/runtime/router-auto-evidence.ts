import { ValidationError } from '../errors'
import { observedModelMatchesDeclared } from './model-identity'

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Router Auto requires an inline policy and routing receipt')
  }
  return value as Record<string, unknown>
}

/** Router owns policy parsing. Runtime requires visible model authority before dispatch. */
export function assertRouterAutoDeclaration(value: unknown, stream: boolean | undefined): void {
  const policy = object(value)
  if (stream === true) throw new ValidationError('Router Auto requires buffered transport')
  if (
    policy.version !== 1 ||
    typeof policy.id !== 'string' ||
    typeof policy.revision !== 'string' ||
    !Array.isArray(policy.strategies) ||
    policy.strategies.length === 0
  ) {
    throw new ValidationError(
      'Router Auto requires a versioned inline policy with concrete strategies',
    )
  }
  for (const raw of policy.strategies) {
    const strategy = object(raw)
    if (
      typeof strategy.id !== 'string' ||
      typeof strategy.model !== 'string' ||
      strategy.model === 'tangle/auto' ||
      strategy.model.length === 0
    ) {
      throw new ValidationError('Router Auto strategy model authority is missing')
    }
  }
  for (const phase of ['selector', 'review']) {
    if (policy[phase] !== undefined && typeof object(policy[phase]).model !== 'string') {
      throw new ValidationError('Router Auto assessment model authority is missing')
    }
  }
}

/** An alias does not waive identity checks. Every reported child must match its declared phase. */
export function assertRouterAutoResponse(
  policyValue: unknown,
  response: unknown,
  served: string | undefined,
): void {
  const policy = object(policyValue)
  const receipt = object(object(response).tangle_auto)
  const decision = object(receipt.decision)
  const strategies = policy.strategies as unknown[]
  const selected = strategies.map(object).find((strategy) => strategy.id === decision.strategyId)
  if (
    decision.requestedModel !== 'tangle/auto' ||
    decision.policyId !== policy.id ||
    decision.policyRevision !== policy.revision ||
    typeof decision.policyDigest !== 'string' ||
    !selected ||
    decision.selectedModel !== selected.model ||
    served === undefined ||
    !observedModelMatchesDeclared(served, String(selected.model))
  ) {
    throw new ValidationError(
      'Router Auto response does not match AgentProfile policy/model authority',
    )
  }
  if (!Array.isArray(receipt.calls) || receipt.calls.length === 0) {
    throw new ValidationError('Router Auto response is missing physical call receipts')
  }
  for (const raw of receipt.calls) {
    const call = object(raw)
    const declared =
      call.phase === 'selector'
        ? object(policy.selector).model
        : call.phase === 'review'
          ? object(policy.review).model
          : call.phase === 'initial' || call.phase === 'escalation'
            ? strategies.map(object).map((strategy) => strategy.model)
            : []
    const allowed = Array.isArray(declared) ? declared : [declared]
    if (
      typeof call.model !== 'string' ||
      !allowed.some(
        (model) =>
          typeof model === 'string' && observedModelMatchesDeclared(call.model as string, model),
      )
    )
      throw new ValidationError('Router Auto physical call exceeds AgentProfile model authority')
  }
}

/** The concrete authority declared by an inline Auto policy, including paid assessments. */
export function routerAutoDeclaredModels(value: unknown): readonly string[] {
  assertRouterAutoDeclaration(value, undefined)
  const policy = object(value)
  const models = (policy.strategies as unknown[]).map((raw) => String(object(raw).model))
  for (const phase of ['selector', 'review']) {
    if (policy[phase] !== undefined) models.push(String(object(policy[phase]).model))
  }
  return [...new Set(models)]
}
