/**
 * Session lineage handed DOWN to a spawned worker: the `TANGLE_*` ids the operator's `lineage` tool
 * (tangle-tools `lineage/`) stamps at every launch, so a supervised tree shows up in the cross-box
 * session graph with each worker under the supervisor that spawned it.
 *
 * WHY NOT THE TRACE SEAM. `worker-trace.ts` joins a worker's SPANS to the supervisor's trace, and is
 * off unless the run exports spans. Lineage is a different question — which session started which —
 * and has to hold when tracing is off. It keys on the supervisor process's OWN lineage instead: the
 * ambient `TANGLE_RUN_ID` a launcher stamped on this process.
 *
 * OFF WHEN THE SUPERVISOR IS UNSTAMPED. No ambient `TANGLE_RUN_ID` ⇒ every function here returns an
 * empty record and writes nothing, so a runtime used outside a lineage-stamped launcher spawns
 * byte-identical environments to before this module existed.
 *
 * THE WIRE (contract v1, tangle-tools `lineage/README.md`):
 *   env      TANGLE_RUN_ID (fresh `run_<32 hex>` per worker), TANGLE_PARENT_RUN_ID (this process),
 *            TANGLE_ROOT_RUN_ID, TANGLE_EDGE_KIND=spawned, TANGLE_OPERATOR / TANGLE_PROJECT /
 *            TANGLE_ACCOUNT (inherited), TANGLE_HARNESS, TANGLE_HOST (local children only),
 *            OTEL_RESOURCE_ATTRIBUTES with the `tangle.*` keys replaced, and TANGLE_CLAUDE_SESSION
 *            cleared so a Claude Code worker takes the stamped run as its own.
 *   headers  `x-tangle-run-id` and siblings on the cli-bridge turn POST; the bridge stamps them into
 *            the harness child it spawns.
 *   event    one `node` line plus one `spawned` edge appended to
 *            `$LINEAGE_HOME/events/<host>.jsonl` (default `~/.local/state/lineage`), only when that
 *            directory already exists — the runtime never creates operator state on its own.
 *
 * Every failure to record is swallowed: lineage is observability and must never fail a spawn.
 */

import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, openSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'

/** Inherited from the supervisor process to every worker unchanged. */
const INHERITED = ['TANGLE_OPERATOR', 'TANGLE_PROJECT', 'TANGLE_ACCOUNT'] as const

const OTEL_KEYS: Record<string, string> = {
  TANGLE_RUN_ID: 'tangle.run.id',
  TANGLE_PARENT_RUN_ID: 'tangle.parent_run.id',
  TANGLE_ROOT_RUN_ID: 'tangle.root_run.id',
  TANGLE_EDGE_KIND: 'tangle.edge.kind',
  TANGLE_OPERATOR: 'tangle.operator',
  TANGLE_PROJECT: 'tangle.project',
  TANGLE_ACCOUNT: 'tangle.account',
  TANGLE_HARNESS: 'tangle.harness',
  TANGLE_HOST: 'host.name',
}

/** Harness names the lineage contract accepts, from a backend type or a CLI binary name. */
const HARNESS_ALIASES: Record<string, string> = {
  claude: 'claude-code',
  'claude-code': 'claude-code',
  codex: 'codex',
  opencode: 'opencode',
  pi: 'pi',
  kimi: 'kimi',
  'kimi-code': 'kimi',
}

export interface WorkerLineageOptions {
  /** Backend type (`claude-code`, `codex`, …) or the CLI binary path the worker runs. */
  readonly harness: string | null | undefined
  /** Runtime node id of the worker, recorded as its native id `runtime:<nodeId>`. */
  readonly nodeId?: string | undefined
  /** Human label for the run tree (the worker profile's name). */
  readonly label?: string | undefined
  /** True when the worker runs on this machine, so `TANGLE_HOST` names it. */
  readonly local: boolean
  /** Ambient environment of the supervisor; defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Clock, for tests. */
  readonly now?: () => Date
}

export interface WorkerLineage {
  /** Environment to merge into the worker's spawn env, below the caller's own seam env. */
  readonly env: Record<string, string>
  /** The same ids as cli-bridge request headers. */
  readonly headers: Record<string, string>
}

const EMPTY: WorkerLineage = { env: {}, headers: {} }

export function lineageHost(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const name = (env.LINEAGE_HOST || hostname()).trim().toLowerCase()
  return name.endsWith('.local') ? name.slice(0, -'.local'.length) : name
}

export function lineageHarness(harness: string | null | undefined): string {
  if (!harness) return 'agent-runtime'
  const base = harness.split(/[\\/]/).pop() ?? harness
  return HARNESS_ALIASES[base] ?? HARNESS_ALIASES[harness] ?? 'agent-runtime'
}

/** Merge lineage ids into an OTEL_RESOURCE_ATTRIBUTES value, replacing earlier lineage keys. */
export function lineageOtelAttributes(
  existing: string | undefined,
  ids: Readonly<Record<string, string>>,
): string {
  const ours = new Set(Object.values(OTEL_KEYS))
  const kept = (existing ?? '')
    .split(',')
    .map((pair) => pair.trim())
    .filter((pair) => pair.length > 0 && !ours.has((pair.split('=', 1)[0] ?? '').trim()))
  for (const [envKey, attr] of Object.entries(OTEL_KEYS)) {
    const value = ids[envKey]
    if (value) kept.push(`${attr}=${encodeURIComponent(value)}`)
  }
  return kept.join(',')
}

/**
 * Mint the lineage ids for one worker and record its launch. Empty when the supervisor process
 * carries no `TANGLE_RUN_ID`.
 */
export function workerLineage(options: WorkerLineageOptions): WorkerLineage {
  const env = options.env ?? process.env
  const parent = env.TANGLE_RUN_ID
  if (!parent) return EMPTY
  const run = `run_${randomBytes(16).toString('hex')}`
  const harness = lineageHarness(options.harness)
  const ids: Record<string, string> = {
    TANGLE_RUN_ID: run,
    TANGLE_PARENT_RUN_ID: parent,
    TANGLE_ROOT_RUN_ID: env.TANGLE_ROOT_RUN_ID || parent,
    TANGLE_EDGE_KIND: 'spawned',
    TANGLE_HARNESS: harness,
  }
  for (const key of INHERITED) {
    const value = env[key]
    if (value) ids[key] = value
  }
  if (options.local) ids.TANGLE_HOST = lineageHost(env)
  const workerEnv: Record<string, string> = {
    ...ids,
    OTEL_RESOURCE_ATTRIBUTES: lineageOtelAttributes(env.OTEL_RESOURCE_ATTRIBUTES, ids),
    // A worker Claude Code must treat the stamped run as its own, not as a parent Claude's.
    TANGLE_CLAUDE_SESSION: '',
  }
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(ids)) {
    headers[`x-${key.toLowerCase().replace(/_/g, '-')}`] = value
  }
  recordLaunch(env, ids, options)
  return { env: workerEnv, headers }
}

function eventLine(event: Record<string, unknown>): string {
  const body = sortKeys(event)
  const id = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)
  return `${JSON.stringify(sortKeys({ ...body, id }))}\n`
}

function sortKeys(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const item = value[key]
    if (item === undefined || item === '') continue
    out[key] =
      item !== null && typeof item === 'object' && !Array.isArray(item)
        ? sortKeys(item as Record<string, unknown>)
        : item
  }
  return out
}

function recordLaunch(
  env: Readonly<Record<string, string | undefined>>,
  ids: Readonly<Record<string, string>>,
  options: WorkerLineageOptions,
): void {
  try {
    const home = env.LINEAGE_HOME || join(homedir(), '.local', 'state', 'lineage')
    const dir = join(home, 'events')
    if (!existsSync(dir)) return
    const host = lineageHost(env)
    const ts = (options.now?.() ?? new Date()).toISOString()
    const common = { v: 1, ts, host, source: 'runtime' }
    const node = eventLine({
      ...common,
      type: 'node',
      run: ids.TANGLE_RUN_ID,
      parent: ids.TANGLE_PARENT_RUN_ID,
      root: ids.TANGLE_ROOT_RUN_ID,
      harness: ids.TANGLE_HARNESS,
      project: ids.TANGLE_PROJECT,
      operator: ids.TANGLE_OPERATOR,
      account: ids.TANGLE_ACCOUNT,
      native: options.nodeId ? `runtime:${options.nodeId}` : undefined,
      label: options.label?.slice(0, 80),
      cwd: process.cwd(),
      attrs: options.local ? {} : { placement: 'remote' },
    })
    const edge = eventLine({
      ...common,
      type: 'edge',
      kind: 'spawned',
      src: ids.TANGLE_PARENT_RUN_ID,
      dst: ids.TANGLE_RUN_ID,
      attrs: {},
    })
    // One O_APPEND write per line (each well under PIPE_BUF), so concurrent writers never interleave.
    const fd = openSync(join(dir, `${host}.jsonl`), 'a', 0o600)
    try {
      appendFileSync(fd, node)
      appendFileSync(fd, edge)
    } finally {
      closeSync(fd)
    }
  } catch {
    // Lineage is observability; a full disk or a read-only home must not fail the spawn.
  }
}
