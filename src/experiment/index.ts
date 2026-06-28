/**
 * `@tangle-network/agent-runtime/experiment`
 *
 * Typed deliberation-policy experiment substrate: an append-only campaign ledger
 * that records one row per {task, target, arm, rep} of a compute-matched agent
 * comparison, with capture-integrity computed by construction. The optimized unit
 * is the induced deliberation policy ({@link DeliberationPolicyAxes}), realized as
 * an AgentProfile.
 */

export * from './integrity'
export * from './ledger'
export * from './types'
