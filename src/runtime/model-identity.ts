const SNAPSHOT_TOKEN = /^[A-Za-z0-9._-]+$/u

interface ModelIdentityParts {
  readonly base: string
  readonly snapshot?: string
}

/** Match equivalent bare and provider-qualified spellings without discarding observed identity. */
export function observedModelMatchesDeclared(observed: string, declared: string): boolean {
  const observedIdentity = modelIdentityParts(observed)
  const declaredIdentity = modelIdentityParts(declared)
  if (!observedIdentity || !declaredIdentity) return false
  if (
    declaredIdentity.snapshot !== undefined &&
    observedIdentity.snapshot !== declaredIdentity.snapshot
  ) {
    return false
  }
  return equivalentModelBase(observedIdentity.base, declaredIdentity.base)
}

/** Merge two observations of one served model while retaining a snapshot-bearing raw identity. */
export function mergeObservedModelIdentity(current: string, next: string): string | undefined {
  const currentIdentity = modelIdentityParts(current)
  const nextIdentity = modelIdentityParts(next)
  if (!currentIdentity || !nextIdentity) return undefined
  if (!equivalentModelBase(currentIdentity.base, nextIdentity.base)) return undefined
  if (
    currentIdentity.snapshot !== undefined &&
    nextIdentity.snapshot !== undefined &&
    currentIdentity.snapshot !== nextIdentity.snapshot
  ) {
    return undefined
  }
  return currentIdentity.snapshot === undefined && nextIdentity.snapshot !== undefined
    ? next
    : current
}

/** Canonicalize a served model for cross-route identity comparisons. */
export function canonicalObservedModel(model: string): string | undefined {
  const identity = modelIdentityParts(model)
  if (!identity) return undefined
  const base = identity.base.slice(identity.base.lastIndexOf('/') + 1)
  return identity.snapshot === undefined ? base : `${base}@${identity.snapshot}`
}

function modelIdentityParts(model: string): ModelIdentityParts | null {
  if (model.length === 0) return null
  const at = model.lastIndexOf('@')
  if (at < 0) return modelLeaf(model).length === 0 ? null : { base: model }
  const base = model.slice(0, at)
  const snapshot = model.slice(at + 1)
  if (base.length === 0 || modelLeaf(base).length === 0 || !SNAPSHOT_TOKEN.test(snapshot)) {
    return null
  }
  return { base, snapshot }
}

function equivalentModelBase(observed: string, declared: string): boolean {
  return modelLeaf(observed) === modelLeaf(declared)
}

function modelLeaf(model: string): string {
  return model.slice(model.lastIndexOf('/') + 1)
}
