/**
 * `Registry<T>` — the ONE name→thing shape for the graph engine.
 *
 * The kernel grew fourteen of these (agent-runtime#978) that differ in three properties:
 * whether names can be listed, what a miss does, and whether the table is global. This one
 * fixes all three — enumerable, a miss is refused BY NAME listing what is registered, and every
 * registry is per-instance — and it is lifted from `AgentEnvironmentProviderRegistry`, the
 * richest and best-tested of the fourteen, not invented.
 *
 * Entries are addressed by a versioned handle, `<id>/v<n>`, the same way the prompt registry
 * addresses directives. A graph names a kind by handle; a host registers exact versions; a
 * missing version is refused, never served by a newer one.
 */

import { ValidationError } from '../../errors'

/** A versioned name: what a graph writes and what a host registers. */
export interface RegistryHandle {
  readonly id: string
  readonly version: number
}

/** `<id>/v<n>` — the only spelling a handle has on the wire, in a journal, or in an error. */
export function formatRegistryHandle(handle: RegistryHandle): string {
  return `${handle.id}/v${handle.version}`
}

/** Parse the wire spelling back. Refuses anything that is not exactly `<id>/v<n>`. */
export function parseRegistryHandle(text: string, context: string): RegistryHandle {
  const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\/v(\d+)$/u.exec(text)
  if (!match) {
    throw new ValidationError(
      `${context}: ${JSON.stringify(text)} is not a registry handle; expected "<id>/v<n>"`,
    )
  }
  const version = Number(match[2])
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ValidationError(`${context}: handle version must be a positive integer`)
  }
  return { id: match[1] as string, version }
}

/** Anything a registry holds carries its own handle, so the table cannot drift from the entry. */
export interface Registered extends RegistryHandle {}

export interface Registry<T extends Registered> {
  /** Add one entry. A second entry under the same handle is refused unless `replace` is set —
   *  silently shadowing a registered kind is how a key no caller could produce once survived. */
  register(entry: T, options?: { readonly replace?: boolean }): void
  has(handle: RegistryHandle): boolean
  get(handle: RegistryHandle): T | undefined
  /** The entry, or a refusal that names the handle AND lists every registered handle — a miss
   *  must be diagnosable from its message alone. */
  require(handle: RegistryHandle, context?: string): T
  /** Every registered handle, sorted, as wire spellings. The thing the fourteen predecessors
   *  mostly could not do and four callers needed. */
  names(): string[]
  /** Every entry, in `names()` order. */
  entries(): T[]
}

/**
 * Create a registry. Per-instance by construction: two engines in one process may hold
 * different kind sets, a test is hermetic, and a run can print its own table. There is
 * deliberately no module-level singleton — `builtinShapes` was the one mutable global in the
 * kernel and it had zero tests.
 */
export function createRegistry<T extends Registered>(
  label: string,
  seed: Iterable<T> = [],
): Registry<T> {
  const table = new Map<string, T>()
  const registry: Registry<T> = {
    register(entry, options = {}): void {
      if (typeof entry.id !== 'string' || entry.id.length === 0) {
        throw new ValidationError(`${label}: an entry must carry a non-empty id`)
      }
      if (!Number.isSafeInteger(entry.version) || entry.version < 1) {
        throw new ValidationError(
          `${label}: ${JSON.stringify(entry.id)} must carry a positive integer version`,
        )
      }
      const key = formatRegistryHandle(entry)
      if (!options.replace && table.has(key)) {
        throw new ValidationError(`${label}: ${JSON.stringify(key)} is already registered`)
      }
      table.set(key, entry)
    },
    has(handle): boolean {
      return table.has(formatRegistryHandle(handle))
    },
    get(handle): T | undefined {
      return table.get(formatRegistryHandle(handle))
    },
    require(handle, context = label): T {
      const key = formatRegistryHandle(handle)
      const entry = table.get(key)
      if (entry === undefined) {
        const known = registry.names()
        const suffix =
          known.length > 0 ? `; registered: ${known.join(', ')}` : '; nothing is registered'
        throw new ValidationError(`${context}: ${JSON.stringify(key)} is not registered${suffix}`)
      }
      return entry
    },
    names(): string[] {
      return Array.from(table.keys()).sort()
    },
    entries(): T[] {
      return registry.names().map((key) => table.get(key) as T)
    },
  }
  for (const entry of seed) registry.register(entry)
  return registry
}
