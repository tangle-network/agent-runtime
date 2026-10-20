/** Stringify a findings payload for a routed delivery; never throws (a cyclic payload degrades to
 *  its String form rather than killing the settle path). */
export function safeJsonText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
