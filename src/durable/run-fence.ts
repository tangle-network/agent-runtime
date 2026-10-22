import { AsyncLocalStorage } from 'node:async_hooks'
import { closeSync, existsSync, fstatSync, openSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tryAcquireAtomicFileLock } from '@tangle-network/agent-eval/ledger-core'
import type { LockIdentity } from '@tangle-network/agent-eval/lock-holder'

/** The immutable claim carried by every write in one directory execution. @internal */
export interface RunWriteClaim {
  readonly path: string
  readonly generation: number
  readonly lock: LockIdentity
}

const claims = new AsyncLocalStorage<RunWriteClaim | undefined>()
const publications = new AsyncLocalStorage<{ readonly claim: RunWriteClaim; active: boolean }>()

/** Bind asynchronous work, including callbacks, to the generation that admitted it. @internal */
export function runWithWriteClaim<T>(claim: RunWriteClaim, operation: () => T): T {
  return claims.run(claim, operation)
}

/** Capture a store's acquisition once, even when later called from an unrelated emitter. @internal */
export function captureRunWriteContext(): <T>(operation: () => T) => T {
  let claim = claims.getStore()
  return <T>(operation: () => T): T => {
    claim ??= claims.getStore()
    return claims.run(claim, operation)
  }
}

/** Serialize claim changes and file mutations under the same cross-process guard. @internal */
export function mutateRunClaim<T>(path: string, operation: () => T): T {
  // Old writers use an unowned directory guard. Never race one or guess that it is stale.
  const legacyGuard = `${path}.guard`
  if (existsSync(legacyGuard)) {
    throw new Error(
      `supervisePursuit: cannot mutate ${path}; inspect ${legacyGuard} and remove it only after confirming no lock mutation is active`,
    )
  }
  const deadline = performance.now() + 5_000
  const sleeper = new Int32Array(new SharedArrayBuffer(4))
  for (;;) {
    const acquisition = tryAcquireAtomicFileLock({ lockPath: `${path}.mutation` })
    if (acquisition.acquired) {
      try {
        return operation()
      } finally {
        acquisition.lock.release()
      }
    }
    if (performance.now() >= deadline) throw new Error(`run directory mutation is held: ${path}`)
    Atomics.wait(sleeper, 0, 0, 10)
  }
}

/**
 * Fence an actual file mutation, not an earlier advisory check. No await occurs between the
 * ownership check and publication, and acquire/release use this same guard. Unclaimed standalone
 * stores retain their existing single-writer contract; pursuit-owned work always carries a claim.
 * @internal
 */
export function fenceRunWrite<T>(operation: () => T): T {
  const claim = claims.getStore()
  if (claim === undefined) return operation()
  const publication = publications.getStore()
  if (
    publication?.active &&
    publication.claim.path === claim.path &&
    publication.claim.generation === claim.generation
  )
    return operation()
  return mutateRunClaim(claim.path, () => {
    let holder: Partial<RunWriteClaim> | undefined
    try {
      const fd = openSync(claim.path, 'r')
      try {
        const stat = fstatSync(fd, { bigint: true })
        if (
          stat.dev.toString() !== claim.lock.dev ||
          stat.ino.toString() !== claim.lock.ino ||
          stat.birthtimeNs.toString() !== claim.lock.birthtimeNs
        ) {
          throw new Error('run lock inode changed')
        }
        holder = JSON.parse(readFileSync(fd, 'utf8')) as Partial<RunWriteClaim>
      } finally {
        closeSync(fd)
      }
    } catch (cause) {
      throw new Error(`run directory generation ${claim.generation} lost its claim`, { cause })
    }
    if (
      holder?.generation !== claim.generation ||
      holder.lock?.dev !== claim.lock.dev ||
      holder.lock?.ino !== claim.lock.ino ||
      holder.lock?.birthtimeNs !== claim.lock.birthtimeNs
    ) {
      throw new Error(`run directory generation ${claim.generation} lost its claim`)
    }
    // Nested synchronous primitives share the guard. A callback queued here keeps its claim,
    // but cannot inherit a live guard after this publication has returned.
    const publication = { claim, active: true }
    try {
      return publications.run(publication, operation)
    } finally {
      publication.active = false
    }
  })
}

/** Persistent generation counter survives a clean release of supervise.lock. @internal */
export function runGenerationPath(runDir: string): string {
  return resolve(runDir, 'supervise.generation')
}
