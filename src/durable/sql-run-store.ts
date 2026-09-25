import { createHash, randomUUID } from 'node:crypto'
import type { SqlAdapter } from '../conversation/journal-sql'

/** @internal The SQL run context owns the payload schema; this store owns publication. */
export interface SqlRunStoreOptions {
  readonly tablePrefix?: string
  readonly leaseMs?: number
  readonly heartbeatMs?: number
}

interface Head {
  run_id: string
  owner: string
  generation: number
  pulse: number
  head: string
  revision: number
  lease_ms: number
  namespace: string
}

interface RecordRow {
  id: string
  parent: string
  revision: number
  payload: string
}

/** Refuses a competing or stale SQL run owner before it can publish new work. */
export class SqlRunOwnershipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SqlRunOwnershipError'
  }
}

/** @internal An immutable ownership capability. Never rebound to a later generation. */
export interface SqlRunLease<Payload> {
  readonly signal: AbortSignal
  readonly records: readonly Payload[]
  append(payload: Payload): Promise<void>
  release(): Promise<void>
}

/**
 * Append-only immutable records, published by ONE compare-and-set of the run's head.
 *
 * SqlAdapter has no pinned-connection transaction API. INSERT ... SELECT owner is NOT a
 * fence on MVCC databases: its snapshot can outlive a takeover. Here both publication and
 * takeover UPDATE the SAME row. Unpublished records are harmless, unreachable staging.
 * Healthy appends write only their new payload and one fixed-size head, never the history.
 *
 * Liveness uses a persisted progress counter, not incomparable host clocks. A contender must
 * observe the SAME generation/counter for leaseMs before replacing it with a CAS. Every
 * heartbeat and publication advances that counter. The interval is stored per run so a
 * differently configured contender cannot shorten an existing owner's lease.
 * @internal
 */
export async function openSqlRunStore<Payload>(
  db: SqlAdapter,
  runId: string,
  options: SqlRunStoreOptions = {},
): Promise<{
  readonly namespace: string
  read(): Promise<readonly Payload[]>
  acquire(signal?: AbortSignal): Promise<SqlRunLease<Payload>>
}> {
  const prefix = options.tablePrefix ?? 'agent_run'
  const leaseMs = options.leaseMs ?? 30_000
  const heartbeatMs = options.heartbeatMs ?? Math.floor(leaseMs / 3)
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(prefix)) {
    throw new Error('SQL run context tablePrefix must be a SQL identifier of at most 40 characters')
  }
  if (typeof runId !== 'string' || runId.length === 0) throw new Error('SQL runId must be nonempty')
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 100 || leaseMs > 2_147_483_647) {
    throw new Error('SQL leaseMs must be an integer between 100 and 2147483647')
  }
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 1 || heartbeatMs > leaseMs / 3) {
    throw new Error('SQL heartbeatMs must be a positive integer no greater than leaseMs / 3')
  }
  const heads = `${prefix}_heads`
  const records = `${prefix}_records`
  await db.exec(`CREATE TABLE IF NOT EXISTS ${heads} (
    run_id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    generation INTEGER NOT NULL,
    pulse INTEGER NOT NULL,
    head TEXT NOT NULL,
    revision INTEGER NOT NULL,
    lease_ms INTEGER NOT NULL,
    namespace TEXT NOT NULL
  )`)
  await db.exec(`CREATE TABLE IF NOT EXISTS ${records} (
    run_id TEXT NOT NULL,
    id TEXT NOT NULL,
    parent TEXT NOT NULL,
    revision INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (run_id, id)
  )`)
  await db.exec(
    `INSERT INTO ${heads} (run_id, owner, generation, pulse, head, revision, lease_ms, namespace)
     VALUES (?, '', 0, 0, '', 0, ?, ?) ON CONFLICT (run_id) DO NOTHING`,
    [runId, leaseMs, randomUUID()],
  )

  async function readHead(): Promise<Head> {
    const [row] = await db.query<Head>(`SELECT * FROM ${heads} WHERE run_id = ?`, [runId])
    if (!row) throw new Error(`SQL run '${runId}' has no head`)
    for (const key of ['generation', 'pulse', 'revision', 'lease_ms'] as const) {
      row[key] = Number(row[key])
      if (!Number.isSafeInteger(row[key]) || row[key] < 0) {
        throw new Error(`SQL run '${runId}' has an invalid ${key}`)
      }
    }
    if (
      typeof row.namespace !== 'string' ||
      row.namespace.length === 0 ||
      typeof row.head !== 'string' ||
      typeof row.owner !== 'string' ||
      (row.head === '') !== (row.revision === 0)
    ) {
      throw new Error(`SQL run '${runId}' has an invalid head`)
    }
    if (row.lease_ms !== leaseMs) {
      throw new Error(
        `SQL run '${runId}' lease configuration differs: recorded ${row.lease_ms}ms, requested ${leaseMs}ms`,
      )
    }
    return row
  }

  async function load(head: Head): Promise<Payload[]> {
    if (head.revision === 0) return []
    // The head was committed AFTER every node it reaches. This reads a consistent immutable
    // cut without a multi-statement read transaction, even if another process appends now.
    const rows = await db.query<RecordRow>(
      `SELECT id, parent, revision, payload FROM ${records} WHERE run_id = ? AND revision <= ?`,
      [runId, head.revision],
    )
    const byId = new Map(rows.map((row) => [row.id, row]))
    const history: Payload[] = []
    let id = head.head
    for (let revision = head.revision; revision > 0; revision -= 1) {
      const row = byId.get(id)
      if (
        !row ||
        Number(row.revision) !== revision ||
        recordId(row.parent, revision, row.payload) !== id
      ) {
        throw new Error(
          `SQL run '${runId}' has a missing or corrupt committed record at revision ${revision}`,
        )
      }
      history.push(JSON.parse(row.payload) as Payload)
      id = row.parent
    }
    if (id !== '') throw new Error(`SQL run '${runId}' has an invalid history origin`)
    return history.reverse()
  }

  // Validate the shared policy at construction, before any caller can take ownership.
  const initial = await readHead()

  return {
    namespace: initial.namespace,
    async read() {
      return load(await readHead())
    },
    async acquire(signal) {
      signal?.throwIfAborted()
      const observed = await readHead()
      if (observed.owner !== '') await wait(leaseMs, signal)
      signal?.throwIfAborted()
      const owner = randomUUID()
      let claimed = false
      try {
        const result = await db.exec(
          `UPDATE ${heads} SET owner = ?, generation = generation + 1, pulse = pulse + 1
           WHERE run_id = ? AND owner = ? AND generation = ? AND pulse = ?`,
          [owner, runId, observed.owner, observed.generation, observed.pulse],
        )
        claimed = result.rowsAffected === 1
      } catch (error) {
        // A lost claim acknowledgement must not leak or accidentally mint two capabilities.
        const current = await readHead().catch(() => undefined)
        if (current?.owner !== owner) throw error
        claimed = true
      }
      if (!claimed)
        throw new SqlRunOwnershipError(`SQL run '${runId}' is owned by another live process`)
      const generation = observed.generation + 1
      const controller = new AbortController()
      let accepting = true
      let released: Promise<void> | undefined
      let tail: Promise<void> = Promise.resolve()
      let heartbeat: Promise<void> | undefined
      let progressAt = performance.now()
      let head = observed.head
      let revision = observed.revision
      let history: Payload[] = []
      const lose = (error: unknown) => {
        accepting = false
        clearInterval(timer)
        controller.abort(error)
      }
      const timer = setInterval(() => {
        if (controller.signal.aborted) return
        if (performance.now() - progressAt >= leaseMs) {
          lose(new SqlRunOwnershipError(`SQL run '${runId}' lease heartbeat expired`))
          return
        }
        if (heartbeat) return
        heartbeat = db
          .exec(
            `UPDATE ${heads} SET pulse = pulse + 1 WHERE run_id = ? AND owner = ? AND generation = ?`,
            [runId, owner, generation],
          )
          .then((result) => {
            if (result.rowsAffected !== 1)
              throw new SqlRunOwnershipError(`SQL run '${runId}' lease was replaced`)
            progressAt = performance.now()
          })
          .catch(lose)
          .finally(() => {
            heartbeat = undefined
          })
      }, heartbeatMs)
      timer.unref()

      const lease: SqlRunLease<Payload> = {
        signal: controller.signal,
        get records() {
          return JSON.parse(JSON.stringify(history)) as Payload[]
        },
        append(payload) {
          if (!accepting)
            return Promise.reject(
              controller.signal.reason ??
                new SqlRunOwnershipError(`SQL run '${runId}' lease is released`),
            )
          // Detach BEFORE queueing. Caller mutation cannot change a promised record.
          let encoded: string
          try {
            encoded = JSON.stringify(payload)
            if (encoded === undefined) throw new Error('SQL run records must be JSON serializable')
          } catch (error) {
            return Promise.reject(error)
          }
          const write = tail.then(async () => {
            controller.signal.throwIfAborted()
            const nextRevision = revision + 1
            const id = recordId(head, nextRevision, encoded)
            try {
              await db.exec(
                `INSERT INTO ${records} (run_id, id, parent, revision, payload) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (run_id, id) DO NOTHING`,
                [runId, id, head, nextRevision, encoded],
              )
            } catch (error) {
              const [staged] = await db
                .query<RecordRow>(
                  `SELECT id, parent, revision, payload FROM ${records} WHERE run_id = ? AND id = ?`,
                  [runId, id],
                )
                .catch(() => [])
              if (
                !staged ||
                staged.payload !== encoded ||
                staged.parent !== head ||
                Number(staged.revision) !== nextRevision
              )
                throw error
            }
            controller.signal.throwIfAborted()
            let published = false
            let failure: unknown
            try {
              const result = await db.exec(
                `UPDATE ${heads} SET head = ?, revision = ?, pulse = pulse + 1
                 WHERE run_id = ? AND owner = ? AND generation = ? AND head = ? AND revision = ?`,
                [id, nextRevision, runId, owner, generation, head, revision],
              )
              published = result.rowsAffected === 1
            } catch (error) {
              failure = error
            }
            if (!published) {
              const current = await readHead()
              if (current.owner !== owner || current.generation !== generation) {
                throw new SqlRunOwnershipError(
                  `SQL run '${runId}' lease was replaced before publication`,
                )
              }
              // The same committed head is the receipt for a lost UPDATE acknowledgement.
              if (current.head !== id || current.revision !== nextRevision) {
                throw (
                  failure ?? new SqlRunOwnershipError(`SQL run '${runId}' publication conflicted`)
                )
              }
            }
            controller.signal.throwIfAborted()
            head = id
            revision = nextRevision
            history.push(JSON.parse(encoded) as Payload)
            progressAt = performance.now()
          })
          tail = write.catch(lose)
          return write
        },
        release() {
          if (released) return released
          accepting = false
          released = (async () => {
            // Finish already-admitted writes while the heartbeat still protects their owner.
            await tail
            clearInterval(timer)
            // A stalled heartbeat cannot extend this capability after release: its UPDATE is fenced.
            try {
              await db.exec(
                `UPDATE ${heads} SET owner = '', pulse = pulse + 1 WHERE run_id = ? AND owner = ? AND generation = ?`,
                [runId, owner, generation],
              )
            } finally {
              controller.abort(new SqlRunOwnershipError(`SQL run '${runId}' lease is released`))
            }
          })()
          return released
        },
      }
      try {
        history = await load(observed)
        signal?.throwIfAborted()
        controller.signal.throwIfAborted()
        return lease
      } catch (error) {
        await lease.release().catch(() => undefined)
        throw error
      }
    },
  }
}

function recordId(parent: string, revision: number, payload: string): string {
  return createHash('sha256').update(`${revision}\0${parent}\0${payload}`).digest('hex')
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timer)
      cleanup()
      reject(signal?.reason)
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}
