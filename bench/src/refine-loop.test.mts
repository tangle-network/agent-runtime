/**
 * Self-checking test for runRefineLoop (bench is a tsx-script package — no vitest).
 *   tsx src/refine-loop.test.mts   (non-zero exit on failure)
 *
 * Regressions it defends — the behaviors the 7 forked loops all relied on, now
 * owned by ONE atom:
 *  - no judge → run all k rounds; prompt carries prior rounds (history) forward;
 *  - judge wired → stop on the first valid round (default decide), no extra shots;
 *  - a custom `decide` overrides;
 *  - the execution Ctx is created once and threaded to every prompt + shot;
 *  - teardown ALWAYS runs (finally), even when a shot throws.
 */
import assert from 'node:assert/strict'
import { runRefineLoop } from './refine-loop.ts'

async function run(): Promise<void> {
  // (1) no judge → all k rounds; carry-forward via history
  const prompts: string[] = []
  const r1 = await runRefineLoop<string>({
    rounds: 3,
    prompt: (round, history) => {
      const p = round === 1 ? 'base' : `base+prev:${history[history.length - 1]?.artifact}`
      prompts.push(p)
      return p
    },
    runShot: async (_p, round) => ({ artifact: `r${round}` }),
  })
  assert.equal(r1.rounds.length, 3, 'runs all k with no judge')
  assert.equal(r1.blind.artifact, 'r1')
  assert.equal(r1.final.artifact, 'r3')
  assert.equal(r1.resolved, false, 'no judge → not resolved')
  assert.equal(prompts[1], 'base+prev:r1', 'round 2 carries round 1 artifact')
  assert.equal(prompts[2], 'base+prev:r2', 'round 3 carries round 2 artifact')

  // (2) judge → stop on the first valid round, no extra shots
  let shots = 0
  const r2 = await runRefineLoop<string>({
    rounds: 5,
    prompt: () => 'p',
    runShot: async () => {
      shots += 1
      return { artifact: shots === 2 ? 'good' : 'bad' }
    },
    judge: async (a) => ({ valid: a === 'good', score: a === 'good' ? 1 : 0 }),
  })
  assert.equal(r2.rounds.length, 2, 'stops at the first valid round')
  assert.equal(r2.resolved, true)
  assert.equal(shots, 2, 'no extra shots after stop')

  // (3) a custom decide overrides the default
  const r3 = await runRefineLoop<number>({
    rounds: 9,
    prompt: () => 'p',
    runShot: async (_p, round) => ({ artifact: round }),
    decide: (h) => h.length >= 2,
  })
  assert.equal(r3.rounds.length, 2, 'custom decide stops at 2')

  // (4) Ctx created once + threaded to prompt and shot
  let tornDown = 0
  const seen: string[] = []
  await runRefineLoop<string, { id: string }>({
    rounds: 2,
    setup: async () => ({ id: 'ctx-1' }),
    prompt: (_r, _h, ctx) => {
      seen.push(`prompt:${ctx.id}`)
      return 'p'
    },
    runShot: async (_p, _r, ctx) => {
      seen.push(`shot:${ctx.id}`)
      return { artifact: 'a' }
    },
    teardown: async (ctx) => {
      assert.equal(ctx.id, 'ctx-1')
      tornDown += 1
    },
  })
  assert.equal(tornDown, 1, 'teardown runs exactly once')
  assert.ok(seen.includes('prompt:ctx-1') && seen.includes('shot:ctx-1'), 'ctx threaded to prompt + shot')

  // (5) teardown runs even when a shot throws (finally)
  let tornDown2 = 0
  await assert.rejects(
    runRefineLoop<string, { id: string }>({
      rounds: 3,
      setup: async () => ({ id: 'c' }),
      prompt: () => 'p',
      runShot: async (_p, round) => {
        if (round === 2) throw new Error('boom')
        return { artifact: 'a' }
      },
      teardown: async () => {
        tornDown2 += 1
      },
    }),
    /boom/,
  )
  assert.equal(tornDown2, 1, 'teardown runs on throw')

  console.log('refine-loop.test: all assertions passed')
}

run().catch((e) => {
  console.error('refine-loop.test FAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
