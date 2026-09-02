import { harnessTypeSchema } from '@tangle-network/agent-interface'

const SNAPSHOT_TOKEN = /^[A-Za-z0-9._-]+$/u
const datedIsoSuffix = /^(.*)-(\d{4})-(\d{2})-(\d{2})$/u
const datedCompactSuffix = /^(.*)-(\d{4})(\d{2})(\d{2})$/u
const datedMonthSuffix = /^(.*)-(\d{4})-(\d{2})$/u

type SnapshotKind = 'date' | 'opaque'

interface ModelIdentityParts {
  readonly base: string
  readonly snapshot?: string
  readonly snapshotKind?: SnapshotKind
}

export interface CanonicalObservedModelParts {
  readonly base: string
  readonly snapshot?: string
  readonly snapshotKind?: SnapshotKind
  readonly canonical: string
}

/** Match equivalent bare and provider-qualified spellings without discarding observed identity. */
export function observedModelMatchesDeclared(observed: string, declared: string): boolean {
  const observedIdentity = modelIdentityParts(observed)
  const declaredIdentity = modelIdentityParts(declared)
  if (!observedIdentity || !declaredIdentity) return false
  if (
    declaredIdentity.snapshot !== undefined &&
    (observedIdentity.snapshot !== declaredIdentity.snapshot ||
      observedIdentity.snapshotKind !== declaredIdentity.snapshotKind)
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
    (currentIdentity.snapshot !== nextIdentity.snapshot ||
      currentIdentity.snapshotKind !== nextIdentity.snapshotKind)
  ) {
    return undefined
  }
  return currentIdentity.snapshot === undefined && nextIdentity.snapshot !== undefined
    ? next
    : current
}

/** Canonicalize a served model for cross-route identity comparisons. */
export function canonicalObservedModel(model: string): string | undefined {
  return canonicalObservedModelParts(model)?.canonical
}

/** Return the canonical model and its validated snapshot kind for runtime evidence reduction. */
export function canonicalObservedModelParts(
  model: string,
): CanonicalObservedModelParts | undefined {
  const identity = modelIdentityParts(model)
  if (!identity) return undefined
  const base = identity.base.slice(identity.base.lastIndexOf('/') + 1)
  const canonical =
    identity.snapshot === undefined
      ? base
      : identity.snapshotKind === 'date'
        ? `${base}-${identity.snapshot}`
        : `${base}@${identity.snapshot}`
  return {
    base,
    ...(identity.snapshot !== undefined ? { snapshot: identity.snapshot } : {}),
    ...(identity.snapshotKind !== undefined ? { snapshotKind: identity.snapshotKind } : {}),
    canonical,
  }
}

/** Return whether an observed identity includes a provider snapshot. */
export function observedModelHasSnapshot(model: string): boolean {
  return modelIdentityParts(model)?.snapshot !== undefined
}

function modelIdentityParts(model: string): ModelIdentityParts | null {
  if (model.length === 0) return null
  const at = model.lastIndexOf('@')
  if (at < 0) {
    const dated = datedModelIdentity(model)
    if (dated !== undefined) return dated
    return modelLeaf(model).length === 0 ? null : { base: model }
  }
  const base = model.slice(0, at)
  const snapshot = model.slice(at + 1)
  if (base.length === 0 || modelLeaf(base).length === 0 || !SNAPSHOT_TOKEN.test(snapshot)) {
    return null
  }
  return { base, snapshot, snapshotKind: 'opaque' }
}

function equivalentModelBase(observed: string, declared: string): boolean {
  const observedPath = modelBaseParts(observed)
  const declaredPath = modelBaseParts(declared)
  if (!samePath(observedPath.path, declaredPath.path)) return false

  // A bare id omits provider routing. It can match an explicitly qualified spelling
  // only when the model path is otherwise identical.
  if (
    observedPath.provider === undefined ||
    declaredPath.provider === undefined ||
    observedPath.provider === declaredPath.provider
  ) {
    return true
  }

  // Tangle Router may report the upstream provider's qualified spelling. Preserve this
  // one documented alias without allowing arbitrary provider-to-provider substitutions.
  if (observedPath.provider === 'tangle-router' || declaredPath.provider === 'tangle-router') {
    const router = observedPath.provider === 'tangle-router' ? observedPath : declaredPath
    const upstream = observedPath.provider === 'tangle-router' ? declaredPath : observedPath
    if (upstream.provider === undefined) return false
    return (
      samePath(router.path, upstream.path) ||
      (router.path[0] === upstream.provider && samePath(router.path.slice(1), upstream.path))
    )
  }

  return false
}

interface ModelBaseParts {
  readonly provider: string | undefined
  readonly path: ReadonlyArray<string>
}

function modelBaseParts(model: string): ModelBaseParts {
  const segments = model.split('/')
  const normalized =
    segments.length > 1 && isHarnessPrefix(segments[0]) ? segments.slice(1) : segments
  if (normalized.length === 1) return { provider: undefined, path: normalized }
  return { provider: normalized[0], path: normalized.slice(1) }
}

function isHarnessPrefix(segment: string | undefined): boolean {
  return segment !== undefined && harnessTypeSchema.safeParse(segment).success
}

function samePath(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index])
}

function modelLeaf(model: string): string {
  return model.slice(model.lastIndexOf('/') + 1)
}

/**
 * Parse the provider's documented dated snapshot forms.
 *
 * `undefined` means that the model has no dated shape and must be treated as a normal base.
 * `null` means that it has a dated shape but the date is invalid, so identity matching fails.
 */
function datedModelIdentity(model: string): ModelIdentityParts | null | undefined {
  const iso = datedIsoSuffix.exec(model)
  if (iso) {
    const [, base, yearText, monthText, dayText] = iso
    return buildDatedIdentity(
      base,
      `${yearText}-${monthText}-${dayText}`,
      isValidCalendarDate(yearText, monthText, dayText),
    )
  }

  const compact = datedCompactSuffix.exec(model)
  if (compact) {
    const [, base, yearText, monthText, dayText] = compact
    return buildDatedIdentity(
      base,
      `${yearText}-${monthText}-${dayText}`,
      isValidCalendarDate(yearText, monthText, dayText),
    )
  }

  const month = datedMonthSuffix.exec(model)
  if (month) {
    const [, base, yearText, monthText] = month
    return buildDatedIdentity(
      base,
      `${yearText}-${monthText}`,
      isValidCalendarMonth(yearText, monthText),
    )
  }

  return undefined
}

function buildDatedIdentity(
  base: string | undefined,
  snapshot: string,
  valid: boolean,
): ModelIdentityParts | null | undefined {
  // A date that is the entire model segment is not a snapshot suffix.
  if (base === undefined || base.length === 0 || base.endsWith('/')) return undefined
  return valid ? { base, snapshot, snapshotKind: 'date' } : null
}

function isValidCalendarDate(
  yearText: string | undefined,
  monthText: string | undefined,
  dayText: string | undefined,
): boolean {
  if (yearText === undefined || monthText === undefined || dayText === undefined) return false
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function isValidCalendarMonth(
  yearText: string | undefined,
  monthText: string | undefined,
): boolean {
  if (yearText === undefined || monthText === undefined) return false
  const year = Number(yearText)
  const month = Number(monthText)
  return year >= 2000 && year <= 2099 && month >= 1 && month <= 12
}
