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

/** Detach a value from its caller and freeze it, without the `ValidationError` framing
 *  {@link detachedSnapshot} adds. For a boundary that has already validated its input. */
export function detachedFrozen<T>(value: T): T {
  return deepFreeze(structuredClone(value))
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
