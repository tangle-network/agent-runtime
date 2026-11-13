import { redact } from '@tangle-network/agent-eval/traces'
import {
  type AgentProfile,
  agentProfileSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { isAlias, isMap, isScalar, isSeq, parseDocument, type Scalar, visit } from 'yaml'
import { ValidationError } from '../../errors'
import type { ReadonlyAgentProfile } from '../../improvement/profile-types'
import { assertJsonData } from '../../json-data'
import { graphFileSchema } from './graph-file-schema'
import { compileGraphParameters } from './graph-parameters'
import { assertExecutableAgentProfile } from './model-policy'

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

function exactProfile(value: unknown, nodeId: string): AgentProfile {
  assertJsonData(value, 'graph profile')
  if (redact(value).report.findings.length)
    throw new ValidationError('graph profile: private literal values are not portable candidates')
  const parsed = agentProfileSchema.safeParse(value)
  if (!parsed.success || canonicalCandidateDigest(value) !== canonicalCandidateDigest(parsed.data))
    throw new ValidationError('graph profile: requires an exact canonical AgentProfile')
  if (parsed.data.name !== nodeId)
    throw new ValidationError('graph profile: profile name must equal the node id')
  assertExecutableAgentProfile(parsed.data, 'graph profile')
  // Bound strings are data at execution, but authored templates would change this candidate.
  compileGraphParameters(parsed.data, {})
  return parsed.data
}

/** An alias, anchor or tag shares or reinterprets YAML another owner may also read. */
function sharedYaml(item: unknown): boolean {
  return (
    isAlias(item) || ((isMap(item) || isSeq(item) || isScalar(item)) && !!(item.anchor || item.tag))
  )
}

function ownProfile(graphText: string, nodeId: string) {
  const document = parseGraphYaml(graphText, 'graph profile')
  const value: unknown = document.toJS({ maxAliasCount: 100 })
  assertJsonData(value, 'graph profile')
  if (!isMap(document.contents))
    throw new ValidationError('graph profile: requires a graph mapping')
  // Other graph fields may still contain authored bindings; only this profile must be static.
  const graphNodes = graphFileSchema.shape.nodes.parse((value as Record<string, unknown>).nodes)
  const matches = graphNodes.flatMap((node, index) => (node.id === nodeId ? [index] : []))
  if (matches.length !== 1)
    throw new ValidationError('graph profile: requires exactly one matching node')
  const index = matches[0]!
  const node = graphNodes[index]!
  const nodes = document.getIn(['nodes'], true)
  const own = document.getIn(['nodes', index], true)
  const profile = document.getIn(['nodes', index, 'profile'], true)
  const parents = [document.contents, nodes, own]
  if (
    !isSeq(nodes) ||
    !isMap(own) ||
    !isMap(profile) ||
    parents.some(sharedYaml) ||
    node.seat !== undefined ||
    node.needs !== undefined ||
    node.check !== undefined
  )
    throw new ValidationError(
      'graph profile: requires an unshared inline agent profile without host overlays',
    )
  visit(own, (_key, item) => {
    if (sharedYaml(item))
      throw new ValidationError(
        'graph profile: aliases, anchors and tags are not owned profile data',
      )
  })
  const canonical = exactProfile({ ...node.profile, name: nodeId }, nodeId)
  return { document, index, profile, canonical }
}

/** Read the exact executable profile owned by one inline graph node. Refuses shared YAML,
 * host overlays, dynamic bindings, incomplete identities and private literals; never resolves them. */
export function readGraphProfile(graphText: string, nodeId: string): AgentProfile {
  return ownProfile(graphText, nodeId).canonical
}

/** Materialize a measured profile in its owning node. Other source bytes and graph semantics
 * remain unchanged. Load without seat/need overrides to execute this exact candidate. */
export function setGraphProfile(
  graphText: string,
  nodeId: string,
  profile: ReadonlyAgentProfile,
): string {
  const parsed = ownProfile(graphText, nodeId)
  const candidate = exactProfile(profile, nodeId)
  if (canonicalCandidateDigest(candidate) === canonicalCandidateDigest(parsed.canonical))
    return graphText
  if (parsed.document.has('digest'))
    throw new ValidationError('graph profile: a pinned graph digest requires its compilation owner')
  const range = parsed.profile.range
  if (!range) throw new ValidationError('graph profile: missing source range')
  const [start, end] = range
  const trailing = /\s*$/.exec(graphText.slice(start, end))![0].length
  const next =
    graphText.slice(0, start) + JSON.stringify(candidate) + graphText.slice(end - trailing)
  const readback = ownProfile(next, nodeId)
  const masked = (source: typeof parsed) => {
    const value = source.document.toJS({ maxAliasCount: 100 })
    value.nodes[source.index].profile = null
    return canonicalCandidateDigest(value)
  }
  if (
    masked(parsed) !== masked(readback) ||
    canonicalAgentProfileDigest(readback.canonical) !== canonicalAgentProfileDigest(candidate)
  )
    throw new ValidationError('graph profile: write changed more than the named profile')
  return next
}
