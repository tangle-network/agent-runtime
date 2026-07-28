/**
 * The one-call delegation verb — `delegate(intent, opts)`.
 *
 * Hand `delegate` an INTENT and it routes that intent to a default authoring supervisor: a
 * router-brained supervisor that DECOMPOSES the intent and AUTHORS the worker profile it needs — no
 * hardcoded coder/researcher profile. It is a thin wrapper over `supervise()`, so the conserved-budget
 * pool, the completion oracle, and equal-compute accounting all come for free; `result.spentTotal`
 * reports what the whole delegation actually cost on BOTH paths (a `winner` carries the worker's
 * spend, a `no-winner` carries what it spent before failing).
 *
 * Here the intent is "write a file". The worker is granted ONE tool — a path-confined `write_file` —
 * and the deliverable is a DISK-TRUTH oracle: the run settles `winner` only when the file actually
 * exists with the right content, read off disk, never the worker judging itself.
 *
 * Run:  TANGLE_API_KEY=<router key>  pnpm tsx examples/delegate/delegate.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { delegate } from '@tangle-network/agent-runtime/kernel'
import { fileDeliverable, makeWriteFileBackend, scratchTarget } from './shared'

async function main(): Promise<void> {
  const routerBaseUrl = process.env.TANGLE_ROUTER_URL ?? 'https://router.tangle.tools/v1'
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) throw new Error('set TANGLE_API_KEY (your Tangle router key)')
  // Two roles: the WORKER does the filesystem task (a cheap model is fine); the supervisor BRAIN
  // must reliably tool-call spawn_agent / await_event, so it defaults to a stronger delegator model.
  const model = process.env.MODEL ?? process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
  const brainModel = process.env.MODEL ?? process.env.BRAIN_MODEL ?? model

  const { workDir, target, targetAbs } = scratchTarget()
  const backend = makeWriteFileBackend({ workDir, routerBaseUrl, routerKey, model })

  const result = await delegate(
    `Create a file named ${target} containing exactly the word hello (lowercase, no quotes). ` +
      `Call the write_file tool exactly once with path="${target}" and content="hello", then reply ` +
      `with the single word DONE and STOP — do not call any more tools after the file is written.`,
    {
      backend,
      router: { routerBaseUrl, routerKey, model: brainModel },
      model: brainModel,
      deliverable: fileDeliverable(targetAbs, target),
      budget: { maxIterations: 40, maxTokens: 200_000, maxUsd: 0.5 },
    },
  )

  const fileContent = existsSync(targetAbs) ? readFileSync(targetAbs, 'utf8') : '<missing>'
  console.log('=== delegate() ===')
  console.log('brain / worker :', brainModel, '/', model)
  console.log('result.kind    :', result.kind)
  console.log('file           :', JSON.stringify(fileContent), '@', targetAbs)
  console.log('spentTotal     :', JSON.stringify(result.spentTotal))
  if (result.kind === 'winner')
    console.log('worker out     :', JSON.stringify(String(result.out).slice(0, 200)))
  if (result.kind === 'no-winner') console.log('no winner      :', result.reason)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
