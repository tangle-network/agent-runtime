import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { isScalar, parseDocument, type Scalar } from 'yaml'
import { ValidationError } from '../../errors'

/** Parse graph YAML strictly: any YAML error, else any warning, refuses under `label`. */
export function parseGraphYaml(text: string, label: string) {
  const document = parseDocument(text, { uniqueKeys: true, strict: true })
  const problems = document.errors.length ? document.errors : document.warnings
  if (problems.length)
    throw new ValidationError(`${label}: ${problems.map((p) => p.message).join('; ')}`)
  return document
}

function parseGraph(text: string) {
  const document = parseGraphYaml(text, 'graph strings')
  // Each node's own `profile.prompt.systemPrompt`, else its `appendSystemPrompt`; an alias is not.
  const scalars = new Map<string, { path: string[]; scalar: Scalar }>()
  const nodes: unknown = document.toJS({ maxAliasCount: 100 })?.nodes
  for (const [index, node] of (Array.isArray(nodes) ? nodes : []).entries()) {
    const prefix =
      typeof node?.profile?.prompt?.systemPrompt === 'string' ? 'system' : 'appendSystem'
    const path = ['nodes', `${index}`, 'profile', 'prompt', `${prefix}Prompt`]
    const scalar = document.getIn(path, true)
    if (typeof node?.id === 'string' && isScalar(scalar)) scalars.set(node.id, { path, scalar })
  }
  return { document, own: scalars }
}

/** The graph's value with each node's own prompt blanked: what a strings-only change must keep. */
function maskedDigest({ document, own }: ReturnType<typeof parseGraph>): string {
  const value = document.toJS({ maxAliasCount: 100 })
  for (const { path } of own.values())
    path.slice(0, -1).reduce((at, key) => at[key], value)[path[4]!] = ''
  return canonicalCandidateDigest(value)
}

/** Node id → its prompt string, for each node whose prompt is its own and unshared: an anchored
 *  (`&shared`) or aliased (`*shared`) prompt is left out. */
export function readGraphStrings(graphText: string): Record<string, string> {
  return Object.fromEntries(
    [...parseGraph(graphText).own].flatMap(([id, { scalar }]) =>
      scalar.anchor ? [] : [[id, String(scalar.value)]],
    ),
  )
}

/**
 * Replace the named nodes' prompt strings in the graph's text and leave every other byte as it
 * was. Each string is written double-quoted over the old scalar's own span, so flow, quoted, `|`
 * and `>-` prompts are replaced alike. Throws `ValidationError` for a node without an unshared
 * prompt of its own, and when the masked graph changed or the strings do not read back as `map`.
 */
export function setGraphStrings(graphText: string, map: Readonly<Record<string, string>>): string {
  const parsed = parseGraph(graphText)
  const spans = Object.entries(map).map(([id, value]) => {
    const scalar = parsed.own.get(id)?.scalar
    if (!scalar?.range || scalar.anchor)
      throw new ValidationError(`graph strings: node ${id} has no unshared prompt of its own`)
    const [start, end] = scalar.range
    // A block scalar's span runs through its last line break; keeping it keeps the next key's line.
    const trailing = /\s*$/.exec(graphText.slice(start, end))![0].length
    return { start, end: end - trailing, text: JSON.stringify(value) }
  })
  let next = graphText
  for (const span of spans.sort((a, b) => b.start - a.start))
    next = next.slice(0, span.start) + span.text + next.slice(span.end)
  const expected = canonicalCandidateDigest({ ...readGraphStrings(graphText), ...map })
  if (
    maskedDigest(parseGraph(next)) !== maskedDigest(parsed) ||
    canonicalCandidateDigest(readGraphStrings(next)) !== expected
  )
    throw new ValidationError('graph strings: the write changed more than the named prompts')
  return next
}
