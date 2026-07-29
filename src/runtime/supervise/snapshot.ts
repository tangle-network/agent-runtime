import { ValidationError } from '../../errors'

/** Deeply detach and freeze untrusted data at a runtime decision boundary. The clone prevents the
 * caller from mutating it later; the freeze prevents downstream code from mutating the snapshot. */
export function detachedSnapshot<T>(value: T, context: string): T {
  try {
    return deepFreeze(structuredClone(value))
  } catch (error) {
    throw new ValidationError(`${context}: input must be structured-cloneable`, { cause: error })
  }
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen)
  return Object.freeze(value)
}
