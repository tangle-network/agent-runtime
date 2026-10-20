import {
  type AgentProfile,
  agentProfileSchema,
  canonicalAgentProfileDigest,
} from '@tangle-network/agent-interface'
import { ConfigError, ValidationError } from '../../errors'
import type { AnalystRegistry, SuperviseProfileEntry } from '../../mcp/tools/coordination'
import type { DeliverableSpec } from './completion-gate'
import type { SupervisorFinalizer } from './finalizer'
import { assertExecutableAgentProfile, assertProfileModelsAllowed } from './model-policy'
import { freezeDetached } from './supervise-identity'

/** A name→value table in this package's resolver-port shape: construction stays the caller's,
 *  lookup stays lazy, and a table backed by a file, a plugin loader, or a plain object all
 *  satisfy one interface. */
export interface SuperviseRegistryTable<T> {
  resolve(name: string): T | undefined
  /** The names the table holds. The three code-valued tables may omit it, because a caller names
   *  their entries from data it already has. The profiles table must list them, because a
   *  director can choose only from a menu it can read. */
  names?(): readonly string[]
}

/**
 * The name→value tables that make the three CODE-valued options expressible as run DATA, and the
 * profiles a director may spawn by name.
 *
 * `deliverable` / `finalizer` / `analysts` are functions and registries, so a recorded
 * run configuration (a JSON row, a campaign spec, a resumed run's options) cannot carry them — and
 * a run with no `deliverable` cannot return a `winner` at all outside the sandbox backend, because
 * the finalizer keeps only children whose oracle passed and nothing else writes that verdict. A
 * caller that owns the code registers it here once and names it from data thereafter.
 *
 * `profiles` is the profiles table: named AgentProfiles that every manager in the tree may spawn
 * with `spawn_worker({ profile: '<name>' })` instead of retyping them. The table is read once, when
 * `supervise` is called: each entry is validated like a root profile and frozen, so every spawn by
 * a name starts from the same bytes. Unless `profileGuidance` or `authorizeSpawn` rewrites the
 * profile, the journal records the entry's digest for the child. Omit the table, or list no names,
 * and nothing about the run changes: `spawn_worker` keeps its object-only `profile`.
 */
export interface SuperviseRegistry {
  readonly deliverables?: SuperviseRegistryTable<DeliverableSpec<unknown>>
  readonly finalizers?: SuperviseRegistryTable<SupervisorFinalizer>
  readonly analysts?: SuperviseRegistryTable<AnalystRegistry>
  readonly profiles?: SuperviseRegistryTable<SuperviseProfileEntry> & {
    names(): readonly string[]
  }
}

/** Which registry table each nameable option resolves against. Indexing this map inside
 *  {@link resolveNamed} makes the pairing a type error to get wrong: `resolveNamed('analysts',
 *  'deliverables', …)` does not compile. */
interface SuperviseRegistryTableFor {
  readonly deliverable: 'deliverables'
  readonly finalizer: 'finalizers'
  readonly analysts: 'analysts'
}

/** Resolve one option that may be given as a value OR as a name into `opts.registry`. Both failure
 *  modes name the option, the requested name, and the table it was looked up in — a typo must not
 *  degrade into a silently unconfigured run (which for `deliverable` means "no run can ever
 *  deliver"). A resolver port cannot enumerate its names, so the message names the table instead of
 *  listing what was in it. */
export function resolveNamed<K extends keyof SuperviseRegistryTableFor, T extends object>(
  option: K,
  table: SuperviseRegistryTableFor[K],
  value: T | string | undefined,
  registry: SuperviseRegistryTable<T> | undefined,
): T | undefined {
  if (typeof value !== 'string') return value
  if (!registry) {
    throw new ConfigError(
      `supervise: opts.${option} = ${JSON.stringify(value)} names a registry entry, but no ` +
        `opts.registry.${table} was provided to resolve it against`,
    )
  }
  const entry = registry.resolve(value)
  if (entry === undefined) {
    throw new ConfigError(
      `supervise: opts.${option} = ${JSON.stringify(value)} is not in opts.registry.${table} — ` +
        'the table resolved no entry under that name',
    )
  }
  return entry
}

/** Read the profiles table once, before anything is built or spent, and freeze what it returns.
 *  Every entry must parse as an AgentProfile (the schema refuses a credential written as a public
 *  value), be executable, use an allowed model, and carry its table name as `profile.name`.
 *  `assertMountable` applies the spawn path's own mount checks, so an entry that can never be
 *  mounted fails here instead of after a director spent a turn on it. A promoted entry's decision
 *  must promote, and a treatment arm of its sealed play must name the entry's canonical digest;
 *  the seal itself is verified by {@link verifyProfilePromotions}. An empty table is no table. */
export function snapshotProfileTable(
  table: SuperviseRegistry['profiles'],
  allowedModels: readonly string[] | undefined,
  assertMountable: ((profile: AgentProfile, context: string) => void) | undefined,
): ReadonlyMap<string, SuperviseProfileEntry> | undefined {
  if (table === undefined) return undefined
  if (typeof table.names !== 'function' || typeof table.resolve !== 'function') {
    throw new ConfigError(
      'supervise: opts.registry.profiles must implement resolve(name) and names(): a director ' +
        'can spawn only the names it is shown',
    )
  }
  const entries = new Map<string, SuperviseProfileEntry>()
  for (const name of table.names()) {
    const at = `opts.registry.profiles ${JSON.stringify(name)}`
    if (typeof name !== 'string' || name.trim().length === 0 || name !== name.trim()) {
      throw new ConfigError(`supervise: ${at} is not a non-empty trimmed name`)
    }
    if (entries.has(name)) throw new ConfigError(`supervise: ${at} is listed twice`)
    const entry = table.resolve(name)
    if (entry === undefined) {
      throw new ConfigError(`supervise: ${at} is listed, but the table resolved no entry under it`)
    }
    const parsed = agentProfileSchema.safeParse(entry.profile)
    if (!parsed.success) {
      throw new ValidationError(
        `supervise: ${at} is not a valid AgentProfile: ${parsed.error.message}`,
      )
    }
    const profile = freezeDetached(parsed.data)
    if (profile.name !== name) {
      throw new ValidationError(
        `supervise: ${at} holds profile.name ${JSON.stringify(profile.name)}; a table entry is ` +
          'spawned and continued by its name, so the two must be equal',
      )
    }
    assertExecutableAgentProfile(profile, `supervise: ${at}`)
    assertProfileModelsAllowed(profile, allowedModels)
    assertMountable?.(profile, `supervise: ${at} would be refused at mount`)
    const promotion = entry.promotion
    if (promotion !== undefined) {
      if (promotion.decision?.promote !== true) {
        throw new ValidationError(
          `supervise: ${at} cites a PairedPromotionDecision that did not promote; list it ` +
            'without promotion to run it as exploratory',
        )
      }
      const digest = canonicalAgentProfileDigest(profile)
      const arms = promotion.experiment?.spec?.arms ?? []
      if (!arms.some((arm) => arm.role === 'treatment' && arm.profileDigest === digest)) {
        throw new ValidationError(
          `supervise: ${at} cites sealed play ` +
            `${JSON.stringify(promotion.experiment?.spec?.id)}, but no treatment arm of it names ` +
            `this profile's digest ${digest}`,
        )
      }
    }
    entries.set(
      name,
      Object.freeze({
        profile,
        ...(promotion === undefined ? {} : { promotion: freezeDetached(promotion) }),
      }),
    )
  }
  return entries.size === 0 ? undefined : entries
}

/** Verify the seal of every promoted profiles-table entry. Eval's seal check is asynchronous, so it
 *  runs at the start of the run, before the first model call; a broken seal refuses the run. */
export async function verifyProfilePromotions(
  table: ReadonlyMap<string, SuperviseProfileEntry> | undefined,
): Promise<void> {
  const promoted = [...(table ?? [])].filter(([, entry]) => entry.promotion !== undefined)
  if (promoted.length === 0) return
  const { verifySealedExperiment } = await import('@tangle-network/agent-eval/experiment')
  for (const [name, entry] of promoted) {
    if (!(await verifySealedExperiment(entry.promotion!.experiment))) {
      throw new ValidationError(
        `supervise: opts.registry.profiles ${JSON.stringify(name)} cites a sealed play whose ` +
          'digest does not match its spec',
      )
    }
  }
}
