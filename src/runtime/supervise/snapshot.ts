import { ValidationError } from '../../errors'

/** Deeply detach and freeze untrusted data at a runtime decision boundary. The clone prevents the
 * caller from mutating it later; the freeze prevents downstream code from mutating the snapshot.
 * Strings are immutable, so the snapshot shares the caller's strings instead of copying them. */
export function detachedSnapshot<T>(value: T, context: string): T {
  let clone: T
  try {
    clone = structuredClone(value)
  } catch (error) {
    throw new ValidationError(`${context}: input must be structured-cloneable`, { cause: error })
  }
  return deepFreeze(shareSourceStrings(value, clone))
}

/** Detach a value from its caller and freeze it, without the `ValidationError` framing
 *  {@link detachedSnapshot} adds. For a boundary that has already validated its input. */
export function detachedFrozen<T>(value: T): T {
  return deepFreeze(shareSourceStrings(value, structuredClone(value)))
}

/**
 * Point each string in a fresh structured clone at the equal string in its source.
 *
 * `structuredClone` copies every string, and a copied string buys no isolation: only objects and
 * arrays can change through a shared reference. A spawned profile passes several boundaries, and
 * each one kept its own copy: in a reproduction of Discovery's hosted coordinator, a child profile
 * that mounts a 5.3 MB file packet was held four times per spawned child. A scope keeps every
 * child it spawned, so the heap grew about 22 MB per spawn, and hosted coordinators died with V8
 * heap OOM after 37 spawns.
 *
 * The walk pairs only own data properties of plain objects and arrays. Accessors, Maps, Sets and
 * other cloned types keep the clone's values. A string is replaced only by a string equal to it,
 * so the snapshot holds exactly the clone's value. The snapshot keeps the source's strings alive.
 */
function shareSourceStrings<T>(source: unknown, clone: T): T {
  const visited = new Set<object>()
  const visit = (from: unknown, to: unknown): void => {
    if (from === null || to === null || typeof from !== 'object' || typeof to !== 'object') return
    const array = Array.isArray(to)
    if (array !== Array.isArray(from)) return
    if (!array && Object.getPrototypeOf(to) !== Object.prototype) return
    if (visited.has(to)) return
    visited.add(to)
    const target = to as Record<string, unknown>
    for (const key of Object.keys(target)) {
      const own = Object.getOwnPropertyDescriptor(from, key)
      if (own === undefined || !('value' in own)) continue
      const cloned = target[key]
      if (typeof cloned === 'string') {
        if (own.value === cloned) target[key] = own.value
      } else visit(own.value, cloned)
    }
  }
  visit(source, clone)
  return clone
}

/**
 * Replace each string in a freshly parsed JSON value with an equal string already in `pool`, and
 * add the new ones. One recovery pass parses every interrupted child's profile from its own blob,
 * so children that carry the same file packet would otherwise hold one copy each. The value is
 * updated in place, so it must belong to the caller; frozen objects are left as they are.
 */
export function shareParsedStrings<T>(value: T, pool: Map<string, string>): T {
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || Object.isFrozen(node)) return
    if (!Array.isArray(node) && Object.getPrototypeOf(node) !== Object.prototype) return
    const target = node as Record<string, unknown>
    for (const key of Object.keys(target)) {
      const item = target[key]
      if (typeof item !== 'string') {
        visit(item)
        continue
      }
      const shared = pool.get(item)
      if (shared === undefined) pool.set(item, item)
      else target[key] = shared
    }
  }
  visit(value)
  return value
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  // `Object.freeze` throws `TypeError: Cannot freeze array buffer views with elements` on any
  // non-empty TypedArray or Buffer, so binary inside a payload must be handed back untouched
  // rather than frozen. Its bytes are already detached by the `structuredClone` above.
  if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value) || seen.has(value)) {
    return value
  }
  seen.add(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen)
  return Object.freeze(value)
}
