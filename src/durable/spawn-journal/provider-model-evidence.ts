import type {
  NodeId,
  ProviderModelAttemptEvidence,
  ProviderModelExecutionEvidence,
  SpawnEvent,
} from '../../runtime/supervise/types'
import type { SpawnForest, SpawnForestNode } from './spawn-forest'

/**
 * Aggregate provider-served model evidence across one recursively owned journal forest.
 *
 * The parent tree records an owned driver's terminal summary, while that driver's own inference
 * and descendants live in its owned tree. This reducer follows the forest reader's explicit tree
 * edges and consumes each tree's metered attempts plus terminal leaf settlements exactly once.
 * A summary node is skipped because its owned tree supplies the source records. Plan materialization
 * is intentionally not read: it proves only what Runtime requested, not what a provider served.
 *
 * Missing legacy evidence, an unfinished node, an unopened owned tree, an identity conflict, and a
 * paid attempt without a qualified served snapshot all return unknown. An explicit
 * `providerDispatch: "not_started"` arm and Runtime accounting-only metered records are ignored
 * for served-model identity, while absent or malformed legacy data remains unknown here.
 */
export function aggregateProviderModelEvidence(
  forest: SpawnForest,
): ProviderModelExecutionEvidence {
  const attempts: ProviderModelAttemptEvidence[] = []
  const observedModels = new Set<string>()
  const canonicalModels = new Set<string>()
  const nodes = new Map<string, SpawnForestNode>()
  let reason: 'provider-model-missing' | 'provider-model-conflict' | undefined
  let sawProviderEvidence = false

  for (const node of forest.nodes) nodes.set(forestNodeKey(node.treeRoot, node.id), node)
  if (forest.missingTrees.length > 0 || forest.inDoubt.length > 0) {
    reason = 'provider-model-missing'
  }

  const markMissing = () => {
    reason ??= 'provider-model-missing'
  }
  const markConflict = () => {
    reason = 'provider-model-conflict'
  }

  const append = (raw: unknown): void => {
    sawProviderEvidence = true
    if (!isProviderEvidenceObject(raw)) {
      markMissing()
      return
    }
    if (raw.status === 'unknown') {
      if (raw.reason === 'provider-model-conflict') {
        markConflict()
      } else if (!hasOnlyNotStartedAttempts(raw)) {
        markMissing()
      }
    } else if (raw.status !== 'known') {
      markMissing()
      return
    }
    if (!Array.isArray(raw.attempts) || !Array.isArray(raw.models)) {
      markMissing()
      return
    }

    const declared = new Set<string>()
    for (const model of raw.models) {
      if (typeof model !== 'string' || model.length === 0) {
        markMissing()
      } else {
        declared.add(model)
      }
    }
    const observedInRecord = new Set<string>()
    for (const rawAttempt of raw.attempts) {
      if (!isProviderAttemptEvidence(rawAttempt)) {
        markMissing()
        continue
      }
      if (rawAttempt.identityConflict === true) markConflict()
      const observations = [...rawAttempt.observations]
      if (rawAttempt.providerDispatch === 'not_started') {
        if (observations.length > 0) markMissing()
        attempts.push(
          Object.freeze({
            observations: Object.freeze([]),
            providerDispatch: 'not_started' as const,
            ...(rawAttempt.identityConflict === true ? { identityConflict: true } : {}),
          }),
        )
        continue
      }
      if (observations.length === 0) {
        markMissing()
        attempts.push(
          Object.freeze({
            observations: Object.freeze([]),
            ...(rawAttempt.identityConflict === true ? { identityConflict: true } : {}),
          }),
        )
        continue
      }
      let base: string | undefined
      let snapshot: string | undefined
      for (const model of observations) {
        if (typeof model !== 'string' || model.length === 0) {
          markMissing()
          continue
        }
        observedInRecord.add(model)
        observedModels.add(model)
        const identity = servedIdentityParts(model)
        if (identity === undefined) {
          markMissing()
          continue
        }
        if (base !== undefined && base !== identity.base) markConflict()
        if (
          snapshot !== undefined &&
          identity.snapshot !== undefined &&
          snapshot !== identity.snapshot
        ) {
          markConflict()
        }
        base = identity.base
        snapshot ??= identity.snapshot
        if (identity.snapshot !== undefined) {
          canonicalModels.add(`${identity.base}@${identity.snapshot}`)
          if (canonicalModels.size > 1) markConflict()
        }
      }
      if (base === undefined || snapshot === undefined) markMissing()
      attempts.push(
        Object.freeze({
          observations: Object.freeze(observations),
          ...(rawAttempt.identityConflict === true ? { identityConflict: true } : {}),
        }),
      )
    }
    if (
      declared.size !== observedInRecord.size ||
      [...declared].some((model) => !observedInRecord.has(model))
    ) {
      markMissing()
    }
  }

  const terminal = (
    treeRoot: NodeId,
    event: Extract<SpawnEvent, { kind: 'settled' | 'cancelled' }>,
  ) => {
    const node = nodes.get(forestNodeKey(treeRoot, event.id))
    if (node === undefined) {
      markMissing()
      return
    }
    // This event is a parent-side summary. Its owned tree is the authoritative source and is
    // traversed above; consuming its summary here would count nested attempts twice.
    if (node.ownedTreeRoot !== undefined) return
    if (event.kind === 'cancelled' && event.providerModel === undefined) {
      markMissing()
      return
    }
    append(event.providerModel ?? node.providerModel)
  }

  for (const tree of forest.trees) {
    for (const event of tree.events) {
      if (event.kind === 'metered') {
        if (event.accountingOnly === true) {
          if (event.providerModel !== undefined) markMissing()
          continue
        }
        // The parent scope re-homes a driver's nested metered spend onto the driver's parent node.
        // Its owned tree carries the provider attempts; consuming this summary would both
        // double-count and treat the spend-only legacy summary as missing identity evidence.
        const summaryNode = nodes.get(forestNodeKey(tree.root, event.id))
        if (summaryNode?.ownedTreeRoot !== undefined) continue
        const evidence = (event as SpawnEvent & { providerModel?: unknown }).providerModel
        if (evidence === undefined) markMissing()
        else append(evidence)
      } else if (event.kind === 'settled' || event.kind === 'cancelled') {
        terminal(tree.root, event)
      }
    }
  }

  if (!sawProviderEvidence || attempts.length === 0 || observedModels.size === 0) {
    reason ??= 'provider-model-missing'
  }
  const models = Object.freeze([...observedModels])
  const frozenAttempts = Object.freeze(attempts)
  return Object.freeze(
    reason === undefined
      ? { status: 'known' as const, attempts: frozenAttempts, models }
      : { status: 'unknown' as const, attempts: frozenAttempts, models, reason },
  )
}

function forestNodeKey(treeRoot: NodeId, nodeId: NodeId): string {
  return `${treeRoot}\u0000${nodeId}`
}

function isProviderEvidenceObject(value: unknown): value is ProviderModelExecutionEvidence {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'status' in value
}

function hasOnlyNotStartedAttempts(evidence: ProviderModelExecutionEvidence): boolean {
  return (
    Array.isArray(evidence.attempts) &&
    evidence.attempts.length > 0 &&
    evidence.attempts.every(
      (attempt) =>
        isProviderAttemptEvidence(attempt) &&
        attempt.providerDispatch === 'not_started' &&
        attempt.observations.length === 0 &&
        attempt.identityConflict !== true,
    )
  )
}

function isProviderAttemptEvidence(value: unknown): value is ProviderModelAttemptEvidence {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as { observations?: unknown }).observations) &&
    ((value as { providerDispatch?: unknown }).providerDispatch === undefined ||
      (value as { providerDispatch?: unknown }).providerDispatch === 'not_started')
  )
}

function servedIdentityParts(
  model: string,
): { readonly base: string; readonly snapshot?: string } | undefined {
  const at = model.lastIndexOf('@')
  const rawBase = at < 0 ? model : model.slice(0, at)
  const base = rawBase.slice(rawBase.lastIndexOf('/') + 1)
  if (base.length === 0) return undefined
  const snapshot = at < 0 ? undefined : model.slice(at + 1)
  if (snapshot !== undefined && snapshot.length === 0) return undefined
  return snapshot === undefined ? { base } : { base, snapshot }
}
