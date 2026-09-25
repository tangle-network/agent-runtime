/**
 * The inotify budget invariant, pinned: ONE durable run holds AT MOST ONE inotify instance —
 * measured, not assumed.
 *
 * This is the standing answer to the recurring "per-runDir shared watcher" proposal. Measured
 * three ways (basic lifetime sampling; a process holding 4 open `fs.watch` handles measuring 1
 * fd; and the adversarial max-control-surface run below), a run peaks at exactly 1 instance:
 * the runtime's only `fs.watch` call site is the cancellation observer
 * (`src/runtime/supervise/run-cancellation.ts`), every other durable control surface (steer
 * acknowledgers, worker-control observers) already polls, and libuv multiplexes every watch in a
 * process over one inotify instance. The kernel's `max_user_instances` budget is consumed per
 * PROCESS, and a run is one process — so a shared watcher measures 1 → 1 and there is nothing
 * to share. The numbers and the rejected alternatives live in `conformance/durability/STATUS.md`
 * (§ Inotify).
 *
 * The test's value is its trigger: if a change adds a second `fs.watch` call site to the durable
 * run path, peak instances exceed 1 here — that is the moment a shared-watcher design becomes
 * necessary, and this red test is where it announces itself.
 *
 * Linux-only by construction (reads /proc/self/fd); skipped elsewhere.
 */

import { existsSync, readdirSync, readlinkSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runGraph } from '../../src/runtime/supervise/graph'
import { ConductorPlanner, conformanceGraph } from '../helpers/durability/conformance-graph'
import {
  openSideEffectSite,
  SIDE_EFFECT_TOOL_NAME,
  sideEffectToolSpec,
} from '../helpers/durability/side-effect'

const canReadProcFd = existsSync('/proc/self/fd')

function inotifyInstances(): number {
  return readdirSync('/proc/self/fd').filter((fd) => {
    try {
      return readlinkSync(`/proc/self/fd/${fd}`) === 'anon_inode:inotify'
    } catch {
      return false
    }
  }).length
}

describe.runIf(canReadProcFd)('inotify budget invariant (one run = at most one instance)', () => {
  it('a max-control-surface durable run peaks at <= 1 inotify instance', {
    timeout: 60_000,
  }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inotify-invariant-'))
    const steerDir = await mkdtemp(join(tmpdir(), 'inotify-invariant-steer-'))
    try {
      const before = inotifyInstances()
      const planner = new ConductorPlanner()
      let peak = before
      const sampler = setInterval(() => {
        peak = Math.max(peak, inotifyInstances())
      }, 25)
      try {
        const brain = async (messages: ReadonlyArray<Record<string, unknown>>) => {
          peak = Math.max(peak, inotifyInstances())
          return planner.nextTurn(messages)
        }
        const res = await runGraph(conformanceGraph(), {
          runId: 'inotify-invariant',
          runDir: dir,
          steerDir,
          workerSlots: 3,
          maxTurns: 24,
          perWorker: { maxIterations: 60, maxTokens: 500_000 },
          brain,
          // A done-only brain never spawns workers; the run still mounts every durable control
          // surface (cancellations watch, steer/control observers, interactive bindings).
          makeLeafAgent: () => {
            throw new Error('no workers should spawn from a done-only brain')
          },
          extraTools: [sideEffectToolSpec()],
          executeExtraTool: async (name, args) => {
            if (name !== SIDE_EFFECT_TOOL_NAME) return null
            return JSON.stringify(
              openSideEffectSite(dir).commit(String(args.idempotencyKey), args.payload),
            )
          },
        })
        expect(['winner', 'no-winner']).toContain(res.result.kind)
      } finally {
        clearInterval(sampler)
      }
      // THE invariant: before → peak grows by at most the ONE cancellation-observer instance.
      expect(peak - before).toBeLessThanOrEqual(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(steerDir, { recursive: true, force: true })
    }
  })
})
