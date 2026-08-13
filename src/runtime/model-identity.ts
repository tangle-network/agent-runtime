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
  if (at < 0) return { base: model }
  const base = model.slice(0, at)
  const snapshot = model.slice(at + 1)
  if (base.length === 0 || !SNAPSHOT_TOKEN.test(snapshot)) return null
  return { base, snapshot }
}

function equivalentModelBase(observed: string, declared: string): boolean {
  return (
    observed === declared || observed.endsWith(`/${declared}`) || declared.endsWith(`/${observed}`)
  )
}
