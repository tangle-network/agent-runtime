import { fnv1a32Hex } from './util'

/**
 * Stable hash for the trace payload. Not cryptographic — only used so
 * downstream eval pipelines can group iterations whose task / output is the
 * same. Bare structural hash; non-JSON values stringify via their `toString`.
 */
export function hashJson(value: unknown): string {
  const str = jsonContentText(value)
  return fnv1a32Hex(str)
}

/** JSON text with String fallback, including quoted JSON strings and cyclic values. */
export function jsonContentText(value: unknown): string {
  let str: string
  try {
    str = JSON.stringify(value) ?? String(value)
  } catch {
    str = String(value)
  }
  return str
}
