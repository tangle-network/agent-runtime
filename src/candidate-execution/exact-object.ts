/** Reject unknown fields while requiring every declared non-optional field. */
export function assertExactObjectKeys(
  value: unknown,
  required: readonly string[],
  label: string,
  optional: readonly string[] = [],
): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const allowed = new Set([...required, ...optional])
  if (allowed.size !== required.length + optional.length) {
    throw new Error(`${label} exact-key contract contains duplicate fields`)
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}`)
  }
  for (const key of required) {
    if (!(key in value)) throw new Error(`${label} is missing field ${key}`)
  }
}

/**
 * Reject a string carrying a lone surrogate. A well-formed UTF-16 string round-trips through UTF-8
 * unchanged; a lone surrogate does not, so a value that passes here is safe to persist and re-read
 * as the same bytes.
 */
export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}
