/** Admit non-null, non-array objects without restricting their prototype or member values. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
