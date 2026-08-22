/**
 * Edge payload admission (agent-runtime#971): every value crossing an edge is JSON round-tripped,
 * `undefined` stripped to absence, and a non-representable value (a cycle, a BigInt, a function)
 * becomes a RECORD of that fact. This is the kernel's existing findings-guard rule, and it is what
 * makes `inputRef` stable and `onCrash: 'restart'` well defined — a degraded record beats a
 * vanished edge.
 */
export function admitPayload(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    const text = JSON.stringify(value)
    // JSON.stringify answers `undefined` for a bare function or symbol — record it, never vanish.
    if (text === undefined) return { nonCanonical: `payload of type ${typeof value}` }
    return JSON.parse(text)
  } catch (error) {
    return { nonCanonical: error instanceof Error ? error.message : String(error) }
  }
}
