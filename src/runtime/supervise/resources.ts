import type { Budget, ResourceSpend, Spend } from './types'

/** Validate caller-owned names and units without assigning domain meaning to them. */
export function assertResources(
  resources: Budget['resources'] | Spend['resources'],
  kind: 'limit' | 'amount',
  label: string,
): void {
  if (resources === undefined) return
  if (resources === null || typeof resources !== 'object' || Array.isArray(resources)) {
    throw new Error(`${label} must be a resource map`)
  }
  for (const [name, resource] of Object.entries(resources)) {
    if (
      !name.trim() ||
      !resource ||
      typeof resource !== 'object' ||
      typeof resource.unit !== 'string' ||
      !resource.unit.trim()
    ) {
      throw new Error(`${label}: resource names and units must be non-empty strings`)
    }
    const value =
      kind === 'limit'
        ? 'limit' in resource
          ? resource.limit
          : undefined
        : 'amount' in resource
          ? resource.amount
          : undefined
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`${label}.${name}.${kind} must be a non-negative finite number`)
    }
    if (kind === 'amount' && (!('known' in resource) || typeof resource.known !== 'boolean')) {
      throw new Error(`${label}.${name}.known must be a boolean`)
    }
  }
}

/** Missing contributors are not usage claims; enforced omissions are marked before aggregation. */
export function addResourceSpend(...maps: ReadonlyArray<Spend['resources']>): {
  resources?: Record<string, ResourceSpend>
} {
  const totals = new Map<string, ResourceSpend>()
  for (const resources of maps) {
    assertResources(resources, 'amount', 'resource spend')
    for (const [name, resource] of Object.entries(resources ?? {})) {
      const prior = totals.get(name)
      if (prior && prior.unit !== resource.unit) throw new Error(`resource ${name}: unit mismatch`)
      const amount = (prior?.amount ?? 0) + resource.amount
      if (!Number.isFinite(amount)) throw new Error(`resource ${name}: amount overflow`)
      totals.set(name, {
        unit: resource.unit,
        amount,
        known: (prior?.known ?? true) && resource.known,
      })
    }
  }
  return totals.size ? { resources: Object.fromEntries(totals) } : {}
}

/** A terminal omission under an enforced ceiling is unknown, never measured zero. */
export function withBudgetResources(
  spend: Spend,
  budget: Pick<Budget, 'resources'>,
  notStarted = false,
): Spend {
  const resources = new Map(Object.entries(addResourceSpend(spend.resources).resources ?? {}))
  for (const [name, limit] of Object.entries(budget.resources ?? {})) {
    const observed = resources.get(name)
    if (observed && observed.unit !== limit.unit) throw new Error(`resource ${name}: unit mismatch`)
    if (!observed) resources.set(name, { unit: limit.unit, amount: 0, known: notStarted })
  }
  return resources.size ? { ...spend, resources: Object.fromEntries(resources) } : spend
}

/** Stream increments and a terminal total describe the same work; never sum them twice. */
export function resourceTelemetry(streamed: Spend, terminal: Spend): Pick<Spend, 'resources'> {
  const resources = new Map(Object.entries(addResourceSpend(terminal.resources).resources ?? {}))
  for (const [name, value] of Object.entries(streamed.resources ?? {})) {
    const other = resources.get(name)
    if (other && other.unit !== value.unit) throw new Error(`resource ${name}: unit mismatch`)
    resources.set(name, {
      ...value,
      amount: Math.max(value.amount, other?.amount ?? 0),
      known:
        value.known &&
        (other?.known ?? true) &&
        (other === undefined || other.amount === value.amount),
    })
  }
  return addResourceSpend(Object.fromEntries(resources))
}
