import { createHash } from 'node:crypto'

/** Stable content address shared by result and trace artifacts. */
export function contentAddress(artifact: unknown): string {
  const hex = createHash('sha256').update(stableStringify(artifact), 'utf-8').digest('hex')
  return `sha256:${hex}`
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}
