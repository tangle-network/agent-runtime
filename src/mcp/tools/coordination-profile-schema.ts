import { agentProfileSchema } from '@tangle-network/agent-interface'
import { registry } from 'zod'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import type { SuperviseProfileEntry } from './coordination-contracts'

/**
 * Strip zod's object-KEY CODEC artifact from a derived JSON Schema, at every depth.
 *
 * `z.record(z.string(), …)` converts to `propertyNames: { type: 'string', pattern:
 * '^u(?:[0-9a-f]{4})*$' }` — a marker of the lossy key round-trip, not a constraint anything
 * enforces: `agentProfileSchema.safeParse({ name: 'r', tools: { bash: true, Read: false } })`
 * succeeds with those plain keys. Published verbatim it reads to a model as "every key must be a
 * run of hex quads", and the model either emits hex-encoded garbage keys or drops the field —
 * on `tools`, `permissions`, `metadata`, `mcp`, `mcp.*.env`, and `model.metadata`, which is most
 * of what a parent actually configures.
 *
 * Every `propertyNames` in the canonical profile schema is this artifact (25 of 25 at Interface
 * 0.40), and the canonical schema constrains no key by pattern, so dropping the keyword outright
 * loses nothing real and cannot be defeated by zod changing the encoding's exact regex.
 *
 * Rebuilds rather than mutates: the canonical conversion output must stay untouched for callers
 * that compare against it.
 */
export const stripKeyCodecArtifacts = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(stripKeyCodecArtifacts)
  if (!node || typeof node !== 'object') return node
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>)
      .filter(([key]) => key !== 'propertyNames')
      .map(([key, value]) => [key, stripKeyCodecArtifacts(value)]),
  )
}

/** One field of the published child-profile shape: the canonical field it mirrors, the one-line
 *  description a model can act on (what it is, what a child typically sets), and — for the two
 *  fields whose canonical sub-tree dwarfs the rest of the tool surface — the BRIEF schema published
 *  in place of that sub-tree. */
export interface PublishedProfileField {
  readonly name: string
  readonly description: string
  readonly brief?: Record<string, unknown>
}

/** The canonical profile fields a spawning parent actually sets on a child, in the order a reader
 *  needs them, each with the description published alongside it. Everything else stays legal to
 *  pass — see {@link deriveSpawnProfileArg}.
 *
 *  Why these eleven, with the measured numbers (serialized JSON bytes, Interface 0.40). The
 *  canonical `properties` map is 10629 bytes, against 2424 bytes for every argument of every other
 *  coordination tool COMBINED — publishing it whole makes one parameter four times the rest of the
 *  surface a driver re-reads each turn. Of the seven omitted fields (tags, connections, subagents,
 *  hooks, modes, confidential, extensions) none is something a parent hands a worker; `permissions`
 *  (321 bytes) IS, so it is published — a child that must not touch the network or the filesystem
 *  is fenced there and nowhere else. `mcp` (2663 bytes) and `resources` (3122 bytes) are the two a
 *  parent is least likely to author inline and were together 85% of the published cost, so they
 *  carry a brief shape plus a description naming the full form instead of the canonical sub-tree. */
export const spawnProfileFields: readonly PublishedProfileField[] = [
  {
    name: 'name',
    description:
      'Short identifier for this child, e.g. "researcher" or "patch-writer". A child normally ' +
      'sets it to its role; it shows up in traces and worker labels.',
  },
  {
    name: 'description',
    description:
      'One line saying what this child is for. Read by humans and by a parent listing its workers.',
  },
  {
    name: 'version',
    description:
      'Optional version string for this profile, so two revisions of the same role are ' +
      'distinguishable in evidence. A child usually omits it.',
  },
  {
    name: 'harness',
    description:
      'Which coding backend runs the child. Omit to inherit the run default; set it only when ' +
      'this child needs a specific backend (e.g. a long refactor on "claude-code").',
  },
  {
    name: 'model',
    description:
      'Model routing: `default` model id, optional `small` for cheap sub-calls, `provider`, and ' +
      '`reasoningEffort`. A child typically sets `default` and `reasoningEffort` — raise effort ' +
      'for a hard reasoning task, lower it for bulk mechanical work.',
  },
  {
    name: 'prompt',
    description:
      "The child's standing instructions: `systemPrompt` (who it is and how it works) and " +
      '`instructions` (durable rules). This is the role; the separate `task` argument carries ' +
      'what to do right now. A child with no systemPrompt has no role — always set one.',
  },
  {
    name: 'tools',
    description:
      'Per-tool on/off map keyed by tool name, e.g. `{ "bash": true, "webfetch": false }`. Omit ' +
      "to inherit the backend's default tool set; set it to narrow a child to the tools its task " +
      'needs. Keys are plain tool names.',
  },
  {
    name: 'permissions',
    description:
      'Per-tool permission decisions: each tool name maps to "allow", "deny", or "ask", or to a ' +
      'nested map of finer-grained rules. This is where a parent fences a child it does not fully ' +
      'trust — a read-only child denies write and network tools here, not in `tools`.',
  },
  {
    name: 'mcp',
    description:
      'MCP tool servers to mount for the child, keyed by server name. Brief form: each value is ' +
      'either `{ transport: "stdio", command, args?, env?, cwd? }` or ' +
      '`{ transport: "sse" | "http", url, headers? }`. A child normally sets this only when it ' +
      'needs a tool server the task requires; the canonical AgentProfile schema carries the full ' +
      'form (secret-ref values for env/headers, per-server metadata) and governs validation.',
    brief: { type: 'object', additionalProperties: { type: 'object' } },
  },
  {
    name: 'resources',
    description:
      'Files, tools, skills, and agents materialized into the child workspace before it starts. ' +
      'Brief form: `{ files?, tools?, skills?, agents? }`, each an array whose entries are ' +
      '`{ kind: "inline", name, content }`, `{ kind: "inline", name, path }`, or ' +
      '`{ kind: "github", repository?, path, ref? }` ' +
      '(`files` entries wrap that as `{ path, resource, executable? }`). An inline `path` is ' +
      'relative to YOUR workspace and is read by the runtime, so use it for any file over a few ' +
      'hundred bytes: content you retype in this call arrives truncated and altered, a path ' +
      'arrives byte-exact and the result reports its sha256. A child typically gets ' +
      '`files` for seed inputs and `skills` for a procedure it must follow; the canonical ' +
      'AgentProfile schema carries the full form and governs validation.',
    brief: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'object' } },
        tools: { type: 'array', items: { type: 'object' } },
        skills: { type: 'array', items: { type: 'object' } },
        agents: { type: 'array', items: { type: 'object' } },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'metadata',
    description:
      'Free-form key/value bag carried with the profile (plain string keys). Use it for run ' +
      'bookkeeping a reader will want later; it does not change how the child executes.',
  },
]

/**
 * Build the published shape of `spawn_worker`'s `profile` argument from the canonical
 * `agentProfileSchema` conversion's `properties` map, so it cannot drift from the profile the
 * runtime materializes.
 *
 * DEGRADES, never throws. A canonical field that is absent — renamed or removed upstream — is
 * simply omitted from the published shape, and a canonical schema that is no longer an object
 * publishes no properties at all. This function is reached from a statically-imported module, so a
 * throw here bricks `import '@tangle-network/agent-runtime/kernel'` for every consumer over an
 * upstream rename that costs them, at worst, one advisory field. The drift itself is still caught
 * loudly — as a test assertion in `tests/kernel/coordination.test.ts`, in CI, where it is our
 * problem rather than at a consumer's import, where it is theirs.
 *
 * Permissive on purpose: `additionalProperties: true` with no `required` list, so every canonical
 * field this shape omits stays legal to pass. This tool layer performs no profile validation.
 *
 * @internal exported for the drift and degradation tests; not part of the package's public API.
 */
export function deriveSpawnProfileArg(
  canonicalProperties: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const published: Array<[string, unknown]> = []
  for (const field of spawnProfileFields) {
    const canonical = canonicalProperties?.[field.name]
    if (canonical === undefined) continue
    const shape = field.brief ?? (stripKeyCodecArtifacts(canonical) as Record<string, unknown>)
    published.push([field.name, { ...shape, description: field.description }])
  }
  return {
    type: 'object',
    description:
      'The child agent profile to run — this is the shape the DEFAULT worker seam accepts; a run ' +
      'wired with a custom makeWorkerAgent may accept a different one. The properties below are ' +
      'derived from the canonical AgentProfile schema and reduced to what a spawning parent sets ' +
      '(`mcp` and `resources` in a brief form); every other canonical field — tags, connections, ' +
      'subagents, hooks, modes, confidential, extensions — may still be passed. This tool does ' +
      'not validate the profile: the canonical AgentProfile schema governs validation downstream.',
    properties: Object.fromEntries(published),
    additionalProperties: true,
  }
}

/** The canonical field names this module publishes, in published order — the drift test's input.
 *
 * @internal */
export const spawnProfileFieldNames: readonly string[] = spawnProfileFields.map((f) => f.name)

export let spawnProfileArgCache: Record<string, unknown> | undefined

/** The published `profile` shape, computed on FIRST tool-definition access and memoized — not at
 *  module load. The conversion walks the whole canonical profile tree, and the strip walk rebuilds
 *  it: 3.5ms on the first `createCoordinationTools`, 0.017ms on every later one (measured, Interface
 *  0.40, node 24). `src/runtime/index.ts` imports this module statically, so paying that at import
 *  taxes every consumer of the kernel entrypoint — including the ones that never build a
 *  coordination toolbox. The memo keeps it at once per process for the ones that do.
 *
 *  Conversion choices. `io: 'input'` is the CALLER's view — pre-default, pre-transform — which is
 *  what a spawning parent may pass, not what the runtime ends up holding. `unrepresentable: 'any'`
 *  keeps the conversion total: the canonical schema contains transforms with no JSON Schema form,
 *  and zod's default is to throw on them, which would leave the tool with no published shape. */
export function spawnProfileArg(): Record<string, unknown> {
  if (!spawnProfileArgCache) {
    const canonical = agentProfileSchema.toJSONSchema({
      // Runtime's API metadata contains ids and output schemas. Derive this input shape
      // without that shared registry so import order cannot replace properties with a ref.
      metadata: registry(),
      io: 'input',
      target: 'draft-07',
      unrepresentable: 'any',
    })
    // Deep-frozen because ONE memoized object is handed to every coordination toolbox in the
    // process: an unfrozen shared schema lets one consumer's mutation corrupt every later one.
    spawnProfileArgCache = detachedFrozen(deriveSpawnProfileArg(canonical.properties))
  }
  return spawnProfileArgCache
}

/** `spawn_worker`'s `profile` argument when the run has a profiles table: one of the table's names,
 *  listed with each entry's description and whether a sealed verdict promoted it, or a profile the
 *  manager authors. Without a table the argument is the authored shape alone, byte for byte. */
export function spawnProfileArgWithTable(
  profiles: ReadonlyMap<string, SuperviseProfileEntry>,
): Record<string, unknown> {
  const menu = [...profiles].map(([name, entry]) => {
    const description =
      typeof entry.profile.description === 'string' && entry.profile.description.length > 0
        ? ` — ${entry.profile.description}`
        : ''
    const status = entry.promotion
      ? `promoted by sealed play ${JSON.stringify(entry.promotion.experiment.spec.id)}`
      : 'exploratory'
    return `- '${name}'${description} (${status})`
  })
  return {
    anyOf: [
      {
        type: 'string',
        enum: [...profiles.keys()],
        description:
          "The name of a profile in this run's profiles table. The runtime runs that exact " +
          'profile, so do not retype it; other profile fields cannot be added to a name. ' +
          'Promoted entries beat their control in a sealed comparison; exploratory ones have no ' +
          `verdict yet.\n${menu.join('\n')}`,
      },
      spawnProfileArg(),
    ],
  }
}

/** Why `spawn_worker` cannot use this `profile` argument against the profiles table, or
 *  `undefined` when it can. A name must be in the table. An authored profile must not take a table
 *  name: continuity and every per-name record key on `profile.name`, so one name must mean one
 *  profile. Without a table nothing is refused here, and the canonical schema answers as before. */
export function profileTableRefusal(
  table: ReadonlyMap<string, SuperviseProfileEntry> | undefined,
  profile: unknown,
): string | undefined {
  if (table === undefined) return undefined
  if (typeof profile === 'string') {
    if (table.has(profile)) return undefined
    return `profile ${JSON.stringify(profile)} is not in this run's profiles table, which holds ${[
      ...table.keys(),
    ]
      .map((name) => JSON.stringify(name))
      .join(', ')}`
  }
  const name =
    typeof profile === 'object' && profile !== null
      ? (profile as { readonly name?: unknown }).name
      : undefined
  if (typeof name !== 'string' || !table.has(name)) return undefined
  return `profile.name ${JSON.stringify(name)} is a profiles-table entry: pass profile: ${JSON.stringify(name)} to run that exact profile, or give the profile you wrote another name`
}
