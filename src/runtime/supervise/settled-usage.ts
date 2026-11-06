import type { AgentProfile } from '@tangle-network/agent-interface'
import type { SpawnForest } from '../../durable/spawn-journal/spawn-forest'
import type { ProviderModelExecutionEvidence, SpawnEvent, Spend } from './types'

/** Measured tokens remain usable without claiming the unreported remainder is zero. */
export interface SettledUsage {
  readonly tokens: {
    readonly status: 'known' | 'lower-bound' | 'unknown'
    readonly input: number | null
    readonly output: number | null
    /** Null when legacy or unfinished work does not establish the number of attempts. */
    readonly unknownAttempts: number | null
  }
  readonly requestedModel: {
    readonly id: string | null
    readonly harness: string | null
    readonly provider: string | null
  }
  /** Observations only; providerModel separately states whether served identity is complete. */
  readonly observedModels: ReadonlyArray<string>
}

/** Use ownership edges to avoid counting parent summaries as additional inference attempts. */
export function settledUsage(
  forest: SpawnForest,
  spent: Spend,
  providerModel: ProviderModelExecutionEvidence,
  profile?: AgentProfile,
): SettledUsage {
  let unknownAttempts: number | null = 0
  const nodes = new Map(forest.nodes.map((node) => [`${node.treeRoot}\0${node.id}`, node]))
  for (const tree of forest.trees) {
    const metered = new Set(
      tree.events
        .filter((event) => event.kind === 'metered' && !event.accountingOnly)
        .map((event) => event.id),
    )
    for (const event of tree.events) {
      if (nodes.get(`${tree.root}\0${event.id}`)?.ownedTreeRoot !== undefined) continue
      if (event.kind === 'metered' && event.accountingOnly) {
        if (event.spend.tokensKnown === false || event.spend.tokens.tokensKnown === false)
          unknownAttempts = null
        continue
      }
      let spend: Spend | undefined
      if (event.kind === 'metered' && !event.accountingOnly) spend = event.spend
      else if ((event.kind === 'settled' || event.kind === 'cancelled') && !metered.has(event.id))
        spend = event.spent
      else continue
      if (spend && spend.tokensKnown !== false && spend.tokens.tokensKnown !== false) continue
      const evidence = (event as SpawnEvent & { providerModel?: ProviderModelExecutionEvidence })
        .providerModel
      // A legacy aggregate without attempt identity cannot tell how many calls are missing.
      if (evidence?.attempts?.length !== 1) unknownAttempts = null
      else if (unknownAttempts !== null && evidence.attempts[0]?.providerDispatch !== 'not_started')
        unknownAttempts++
    }
  }
  if (forest.inDoubt.length || forest.missingTrees.length) unknownAttempts = null
  const status =
    spent.tokensKnown === true
      ? 'known'
      : spent.tokens.input > 0 || spent.tokens.output > 0
        ? 'lower-bound'
        : 'unknown'
  return {
    tokens: {
      status,
      input: status === 'unknown' ? null : spent.tokens.input,
      output: status === 'unknown' ? null : spent.tokens.output,
      unknownAttempts: status === 'known' ? 0 : unknownAttempts === 0 ? null : unknownAttempts,
    },
    requestedModel: {
      id: profile?.model?.default ?? null,
      harness: profile?.harness ?? null,
      provider: profile?.model?.provider ?? null,
    },
    observedModels: providerModel.models,
  }
}
