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
