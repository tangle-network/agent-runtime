import { ValidationError } from './errors'

/** Inspect descriptors instead of invoking accessors; JSON has no getters, symbols, prototypes,
 * sparse arrays, undefined, closures or cycles. Repeated non-cyclic references remain JSON data. */
export function assertJsonData(
  value: unknown,
  context: string,
  visiting = new Set<object>(),
): void {
  function fail(message: string): never {
    throw new ValidationError(`${context}: ${message}`)
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (!value || typeof value !== 'object' || visiting.has(value))
    fail('expected finite, acyclic JSON data without executable values')
  const array = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
    fail('expected plain JSON objects and arrays')
  visiting.add(value)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const keys = Reflect.ownKeys(descriptors)
  if (array && keys.length !== value.length + 1) fail('sparse arrays are not canonical JSON')
  for (const key of keys) {
    if (array && key === 'length') continue
    const property = typeof key === 'string' ? descriptors[key] : undefined
    if (!property || !property.enumerable || !('value' in property))
      fail('JSON data cannot contain symbols, hidden properties or accessors')
    if (array && (!/^(0|[1-9]\d*)$/.test(key as string) || Number(key) >= value.length))
      fail('arrays may contain only indexed JSON values')
    assertJsonData(property.value, context, visiting)
  }
  visiting.delete(value)
}
