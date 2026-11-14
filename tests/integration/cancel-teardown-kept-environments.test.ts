/**
 * Cancelling a finished multi-manager run returns its result within one release wait and keeps
 * every box its provider holds for retention.
 *
 * The answers below are a production provider's, recorded on 2026-11-13 for a cancelled run of 28
 * manager boxes whose work had finished: each box's delete answers in the order the provider gave
 * them. A held box is refused with an HTTP error naming the hold and stopped; asking it again
 * reconnects, wakes it, and times out waiting for it to run. That run's teardown took 1315 s from
 * cancel to its last receipt: it asked held boxes again at every level and retry pass, and the
 * root's own box waited behind its managers' boxes, each level with its own five-minute wait.
 */

import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { expect, it } from 'vitest'
import { loadSpawnForest } from '../../src/durable/spawn-journal/spawn-forest'
import { RunCancellationReason } from '../../src/runtime/supervise/abortable'
import { driverChild } from '../../src/runtime/supervise/driver-executor'
import {
  bindScopeRetainedOwnerProvider,
  prepareScopeRetainedOwnerTask,
  scopeRetainedOwnerContext,
} from '../../src/runtime/supervise/retained-scope-owner'
import { createInMemoryRunContext } from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Scope } from '../../src/runtime/supervise/types'
import { testAgentProfile } from '../kernel/test-agent-profile'

const RUN_ID = 'cancel-teardown'
const PROVIDER = 'tangle-sandbox'
/** A delete the run stopped waiting for: the replay never answers it. */
const NO_ANSWER = null
const DELETED = 'deleted'
/** A reconnect to a stopped box that timed out waiting for it to run. */
const WAKE = 'wake'
/** A reconnect refused while the provider removes the box's sidecar. */
const DEPROVISIONING = 'deprovisioning'
/** Each recorded answer: one of the above, or `hold@<heldAt>` for a retention-hold refusal. */
type Answer = string | typeof NO_ANSWER

/** The provider's words for each answer, as the run recorded them. */
function refusal(box: string, answer: string): string {
  if (answer === WAKE)
    return `Tangle sandbox ${box} did not reach running: Timed out waiting for sandbox to reach running: caused by TimeoutError: HTTP 504: Timed out waiting for sandbox to reach running`
  if (answer === DEPROVISIONING)
    return `Tangle native capture requires the current selected backend before reconnect: caused by ServerError: HTTP 503: Sidecar with id ${box} is not ready: project_deprovisioning`
  return `HTTP 500: Project ${box} is under retention hold ${box}@${answer.slice('hold@'.length)}`
}

/** Each box's delete answers, in order. A manager whose first answer came before the cancel had
 *  finished and was released at its own settlement; the others were first asked at the cancel. */
const ROOT_BOX = 'sandbox-5bb4f439e6db'
const RECORDED: ReadonlyArray<readonly [box: string, beforeCancel: boolean, answers: Answer[]]> = [
  ['sandbox-3ac408d86aac', true, ['hold@1794597224771', NO_ANSWER, 'hold@1794597224771']],
  ['sandbox-3b3d61b1c81a', true, ['hold@1794597332229', NO_ANSWER, 'hold@1794597332229']],
  ['sandbox-450033cbd62d', true, ['hold@1794597346938', WAKE, WAKE]],
  ['sandbox-e6036016a986', true, ['hold@1794597399474', WAKE, WAKE]],
  ['sandbox-41a219792071', true, [NO_ANSWER, NO_ANSWER, 'hold@1794597677460']],
  ['sandbox-cc321e510463', true, [NO_ANSWER, WAKE, WAKE]],
  ['sandbox-923aee591d9b', true, [NO_ANSWER, NO_ANSWER, NO_ANSWER]],
  ['sandbox-70dfb82b3fcb', true, [NO_ANSWER, NO_ANSWER, 'hold@1794597572163']],
  ['sandbox-e90d0d571273', true, ['hold@1794599543270', NO_ANSWER, 'hold@1794599543270']],
  ['sandbox-b8680ac394f7', true, ['hold@1794599583839', NO_ANSWER, 'hold@1794599583839']],
  ['sandbox-32ae05a2e811', true, ['hold@1794599709094', WAKE, WAKE]],
  ['sandbox-5032d2ed6a54', true, ['hold@1794599739205', NO_ANSWER, NO_ANSWER]],
  ['sandbox-cfb39a31e0a4', true, ['hold@1794599765832', NO_ANSWER, NO_ANSWER]],
  [
    'sandbox-a3f31ff5ed1f',
    true,
    ['hold@1794599822107', 'hold@1794599822107', 'hold@1794599822107'],
  ],
  ['sandbox-517c2438f90e', true, ['hold@1794599917745', WAKE, WAKE]],
  ['sandbox-d8ac32d12ea5', true, [NO_ANSWER, NO_ANSWER, DEPROVISIONING]],
  ['sandbox-1b927f597d37', true, [NO_ANSWER, WAKE, WAKE]],
  ['sandbox-f3dbc0183a31', true, ['hold@1794601719324', WAKE, WAKE]],
  ['sandbox-91f76270177d', true, [NO_ANSWER, WAKE, WAKE]],
  ['sandbox-4fba06273057', true, [NO_ANSWER, NO_ANSWER, DEPROVISIONING]],
  ['sandbox-2e2a882862f3', true, [NO_ANSWER, WAKE, WAKE]],
  ['sandbox-1713a766df41', true, [NO_ANSWER, WAKE, WAKE]],
  ['sandbox-us1-71f9a6f8282d', true, [NO_ANSWER, DEPROVISIONING, 'hold@1794601947209']],
  ['sandbox-1c283e18bc0b', true, ['hold@1794602580913', DELETED]],
  ['sandbox-380366c7a583', false, [DELETED]],
  ['sandbox-0f2f04f51300', false, [DELETED]],
  [
    'sandbox-045b63813a1b',
    false,
    ['hold@1794607244787', NO_ANSWER, 'hold@1794607244787', 'hold@1794607244787'],
  ],
  [ROOT_BOX, false, [NO_ANSWER, 'hold@1794608122021']],
]

/** Boxes whose last owner turn was dispatched and never returned a result, with that run's
 *  recorded execution id: a release stops such a harness unless the box is held. */
const UNFINISHED_RUNS = new Map([
  [
    'sandbox-cfb39a31e0a4',
    'retained-execution-5bfc554212c2f36a7cae5588b32be92b01910841abfb5ffdd830ae226a111a32',
  ],
  [
    'sandbox-f3dbc0183a31',
    'retained-execution-1839f7f74bf4beaaad7d0f8f4aae28965bb24d30380e7bdd971887da3b84a225',
  ],
  [
    'sandbox-045b63813a1b',
    'retained-execution-d2e01ff8ce7147fb3d09c0f939b63960856b9be518b94afde05b3b20743b6a2a',
  ],
])

/** A provider double that answers each box's deletes with its recorded answers, in order. */
function recordedProvider() {
  const answers = new Map(RECORDED.map(([box, , recorded]) => [box, recorded]))
  const destroys = new Map<string, number>()
  const wakes = new Map<string, number>()
  const stopped = new Set<string>()
  const removed = new Set<string>()
  // A native-run reconnect starts by reading the provider's capabilities; no delete does.
  let reconnects = 0
  const environment = (id: string): AgentEnvironment => ({
    id,
    provider: PROVIDER,
    status: async () => 'running',
    async *stream() {},
    async destroy() {
      const asked = destroys.get(id) ?? 0
      destroys.set(id, asked + 1)
      const answer = answers.get(id)?.[asked] ?? NO_ANSWER
      if (answer === NO_ANSWER) return await new Promise<void>(() => {})
      if (answer === DELETED) {
        removed.add(id)
        return
      }
      // The provider stops a box whose delete it refuses.
      if (answer.startsWith('hold@')) stopped.add(id)
      throw new Error(refusal(id, answer))
    },
  })
  const provider: AgentEnvironmentProvider = {
    name: PROVIDER,
    capabilities: async () => {
      reconnects += 1
      return {}
    },
    create: async () => {
      throw new Error('a release never creates an environment')
    },
    async get(id) {
      if (removed.has(id) || !answers.has(id)) return null
      // A reconnect to a stopped box resumes it and waits for it to run.
      if (stopped.has(id)) wakes.set(id, (wakes.get(id) ?? 0) + 1)
      return environment(id)
    },
  }
  return { provider, destroys, wakes, reconnects: () => reconnects }
}

/** The owner's turn as a retained run journals it: its input, its intent, then its box. */
async function admitBox(
  scope: Scope<unknown>,
  provider: AgentEnvironmentProvider,
  box: string,
  task: unknown,
): Promise<void> {
  bindScopeRetainedOwnerProvider(scope, provider)
  await prepareScopeRetainedOwnerTask(scope, task)
  const owner = scopeRetainedOwnerContext(scope)!
  const identity = {
    provider: provider.name,
    idempotencyKey: `${box}:key`,
    turnId: `${box}:turn`,
    sessionId: `${box}:session`,
    executionId: `${box}:execution`,
  }
  await owner.onAdmission({
    phase: 'intent',
    ...identity,
    runId: RUN_ID,
    requestedProfileDigest: canonicalCandidateDigest({ box }),
    requestDigest: canonicalCandidateDigest({ box, task }),
  })
  await owner.onAdmission({ phase: 'environment', ...identity, environmentId: box })
  const executionId = UNFINISHED_RUNS.get(box)
  if (executionId === undefined) return
  await owner.onAdmission({
    phase: 'dispatched',
    idempotencyKey: identity.idempotencyKey,
    turnId: identity.turnId,
    controlRef: {
      provider: provider.name,
      environmentId: box,
      sessionId: identity.sessionId,
      executionId,
      runId: executionId,
      requestDigest: canonicalCandidateDigest({ box, task }),
    },
  })
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

it('returns a cancelled 28-box run within one release wait and keeps every held box', async () => {
  const fixture = recordedProvider()
  const context = createInMemoryRunContext({ withDriver: true })
  const controller = new AbortController()
  const managers = RECORDED.filter(([box]) => box !== ROOT_BOX)
  const finished = managers.filter(([, beforeCancel]) => beforeCancel).map(([box]) => box)
  let finishedAsked = (): void => {}
  const asked = new Promise<void>((resolve) => {
    finishedAsked = resolve
  })
  let cancelledAt = 0
  const result = await createSupervisor<unknown, unknown>().run(
    {
      name: 'root',
      async act(task, scope) {
        await admitBox(scope, fixture.provider, ROOT_BOX, task)
        for (const [box, beforeCancel] of managers) {
          const manager = driverChild(
            testAgentProfile(`${box}-manager`),
            {
              name: `${box}-manager`,
              async act(managerTask, managerScope) {
                await admitBox(managerScope, fixture.provider, box, managerTask)
                if (!beforeCancel) await aborted(managerScope.signal)
                return box
              },
            },
            context.journal,
          )
          const spawned = scope.spawn(manager, 'work', {
            key: box,
            budget: { maxTokens: 100, maxIterations: 5 },
          })
          if (!spawned.ok) throw new Error(`spawn refused: ${spawned.reason}`)
        }
        for (const _ of finished) await scope.next()
        // Every finished manager's release has asked for its box before the cancel.
        const poll = setInterval(() => {
          if (finished.every((box) => fixture.destroys.has(box))) finishedAsked()
        }, 5)
        await asked
        clearInterval(poll)
        cancelledAt = Date.now()
        controller.abort(new RunCancellationReason('operator', 'stop the finished run'))
        return await aborted(scope.signal)
      },
    },
    'task',
    {
      ...context,
      runId: RUN_ID,
      budget: { maxTokens: 10_000, maxIterations: 500 },
      workerSlots: RECORDED.length,
      signal: controller.signal,
    },
  )
  const cancelToResultMs = Date.now() - cancelledAt
  const forest = await loadSpawnForest(context.journal, RUN_ID)

  const firstAnswer = new Map(RECORDED.map(([box, , answers]) => [box, answers[0]]))
  const boxesAnswered = (match: (answer: Answer) => boolean) =>
    [...firstAnswer].filter(([, answer]) => match(answer)).map(([box]) => box)
  const heldBoxes = boxesAnswered((answer) => answer?.startsWith('hold@') === true)
  const unanswered = boxesAnswered((answer) => answer === NO_ANSWER)
  const deleted = boxesAnswered((answer) => answer === DELETED)
  expect([heldBoxes.length, unanswered.length, deleted.length]).toEqual([14, 12, 2])

  // One release wait (90 s), where the recorded teardown took 1315 s.
  const measured = `cancel-to-result ${cancelToResultMs} ms for ${RECORDED.length} boxes`
  console.log(measured)
  expect(cancelToResultMs, measured).toBeLessThan(120_000)
  // Each box is asked once: a held box is never reconnected to, not even to stop its harness, and
  // a delete still in flight is joined, not asked again.
  expect(Object.fromEntries(fixture.destroys)).toEqual(
    Object.fromEntries(RECORDED.map(([box]) => [box, 1])),
  )
  expect(Object.fromEntries(fixture.wakes)).toEqual({})
  expect(fixture.reconnects()).toBe(0)

  const unconfirmed = result.teardownUnconfirmed ?? []
  const nodeOf = (box: string) =>
    unconfirmed.find((node) =>
      [...(node.environments ?? []), ...(node.kept ?? [])].some((ref) => ref.environmentId === box),
    )
  // Every held box is kept as evidence, named with the provider's own refusal, and never left
  // for a sweeper to delete.
  for (const box of heldBoxes) {
    const node = nodeOf(box)
    expect(node?.kept, box).toContainEqual({
      provider: PROVIDER,
      environmentId: box,
      keptFor: 'evidence',
    })
    expect(node?.detail, box).toContain(refusal(box, firstAnswer.get(box)!))
  }
  // A held box's unfinished harness is named as not stopped, never as stopped.
  for (const [box, executionId] of UNFINISHED_RUNS) {
    expect(heldBoxes, box).toContain(box)
    const detail = nodeOf(box)?.detail ?? ''
    expect(detail, box).toContain(`native execution ${executionId} stop not attempted`)
    expect(detail, box).toContain('it may still be running')
    expect(detail, box).not.toContain(`native execution ${executionId} stopped`)
  }
  // A delete that never answered is unconfirmed and named for a sweeper; none is kept.
  expect(
    unconfirmed
      .flatMap((node) => node.environments ?? [])
      .map((ref) => ref.environmentId)
      .sort(),
  ).toEqual([...unanswered].sort())
  // Only a delete the provider confirmed is journaled as destroyed.
  const receipts = forest.events.flatMap(({ event }) =>
    event.kind === 'environment-teardown' ? [event] : [],
  )
  expect(
    [...new Set(receipts.filter((r) => r.destroyed).map((r) => r.environmentId))].sort(),
  ).toEqual([...deleted].sort())
}, 180_000)
