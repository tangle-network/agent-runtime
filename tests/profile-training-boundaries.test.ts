import assert from 'node:assert/strict'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { type AgentProfile, sha256Bytes, sha256Utf8 } from '@tangle-network/agent-interface'
import { afterEach, describe, it, vi } from 'vitest'
import {
  type CheckpointServingPort,
  type ImproveTrainingOptions,
  type ProfileTrainer,
  runProfileTraining,
  type TrainingDatasetDocument,
} from '../src/improvement/training'

const faults = vi.hoisted(() => ({
  afterWrite: undefined as ((path: string) => void) | undefined,
  afterSync: undefined as ((path: string) => void) | undefined,
  afterPublication: undefined as ((path: string) => void) | undefined,
  publications: [] as string[],
  syncedDirectories: [] as string[],
}))

// Keep real files and real fsyncs; inject cancellation at the exact I/O boundary.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    async writeFile(...args: Parameters<typeof actual.writeFile>) {
      await actual.writeFile(...args)
      faults.afterWrite?.(String(args[0]))
    },
    async open(...args: Parameters<typeof actual.open>) {
      const handle = await actual.open(...args)
      const sync = handle.sync.bind(handle)
      handle.sync = async () => {
        await sync()
        faults.afterSync?.(String(args[0]))
      }
      return handle
    },
  }
})

vi.mock('../src/runtime/supervise/durable-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/runtime/supervise/durable-file')>()
  return {
    ...actual,
    syncDurableDirectory(path: string) {
      actual.syncDurableDirectory(path)
      faults.syncedDirectories.push(path)
    },
    publishExclusiveDurableFile(...args: Parameters<typeof actual.publishExclusiveDurableFile>) {
      const published = actual.publishExclusiveDurableFile(...args)
      if (published) faults.publications.push(args[0])
      faults.afterPublication?.(args[0])
      return published
    },
  }
})

let root: string | undefined

afterEach(async () => {
  faults.afterWrite = undefined
  faults.afterSync = undefined
  faults.afterPublication = undefined
  faults.publications.length = 0
  faults.syncedDirectories.length = 0
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function fixture() {
  root = await mkdtemp(join(tmpdir(), 'training-boundaries-'))
  const controller = new AbortController()
  const profile: AgentProfile = {
    name: 'training-boundary-fixture',
    harness: 'opencode',
    model: { provider: 'openai-compat', default: 'base-model' },
  }
  const document: TrainingDatasetDocument = {
    version: 1,
    format: 'sft',
    rows: [
      {
        task: { benchmark: 'fixture', task: 'train', contentDigest: sha256Utf8('task') },
        partition: 'train',
        data: { messages: [{ role: 'assistant', content: 'captured transcript' }] },
      },
    ],
  }
  const bytes = Buffer.from(JSON.stringify(document))
  const path = join(root, 'source.json')
  await writeFile(path, bytes)
  const execute = vi.fn<ProfileTrainer['execute']>(async (request) => {
    await writeFile(request.checkpointPath, 'weights')
    return { succeeded: true, value: undefined }
  })
  const serve = vi.fn<CheckpointServingPort['serve']>(async (input) => ({
    succeeded: true,
    value: {
      artifactDigest: sha256Bytes(await readFile(input.artifactPath)),
      routerModelId: input.routerModelId,
      evidenceDigest: sha256Utf8('serving evidence'),
    },
  }))
  const options: ImproveTrainingOptions = {
    mode: 'training',
    trainer: {
      identity: { mode: 'managed', id: 'fixture', revision: sha256Utf8('trainer') },
      execute,
    },
    dataset: { path, digest: sha256Bytes(bytes) },
    parameters: {},
    executionRef: sha256Utf8('bound execution'),
    serving: { serve },
    outputDirectory: join(root, 'outputs'),
    maxCheckpointBytes: 1024,
    timeoutMs: 10_000,
    signal: controller.signal,
  }
  return { profile, options, controller, execute, serve }
}

async function assertNoProfile(outputDirectory: string | undefined) {
  if (outputDirectory)
    await assert.rejects(readFile(join(outputDirectory, 'profile.json')), { code: 'ENOENT' })
}

describe('training cancellation, checkpoint integrity and publication', () => {
  it('does not dispatch training when cancellation arrives during input persistence', async () => {
    const { profile, options, controller, execute, serve } = await fixture()
    faults.afterWrite = (path) => {
      if (path.endsWith('parent-profile.json')) controller.abort(new Error('cancelled in I/O'))
    }
    const result = await runProfileTraining(profile, options)
    assert(!result.succeeded)
    assert.equal(execute.mock.calls.length, 0)
    assert.equal(serve.mock.calls.length, 0)
    assert.equal(result.trainingMayExist, false)
    assert.equal(result.servingMayExist, false)
    assert.match(result.reason, /cancelled in I\/O/)
    await assertNoProfile(result.outputDirectory)
  })

  it('does not deploy after cancellation during checkpoint fsync', async () => {
    const { profile, options, controller, execute, serve } = await fixture()
    faults.afterSync = (path) => {
      if (path.endsWith('checkpoint.bin')) controller.abort(new Error('cancelled before serving'))
    }
    const result = await runProfileTraining(profile, options)
    assert(!result.succeeded)
    assert.equal(execute.mock.calls.length, 1)
    assert.equal(serve.mock.calls.length, 0)
    assert.equal(result.stage, 'serving')
    assert.equal(result.trainingMayExist, false)
    assert.equal(result.servingMayExist, false)
    await assertNoProfile(result.outputDirectory)
  })

  it('rejects checkpoint mutation by the candidate validator', async () => {
    const { profile, options, serve } = await fixture()
    options.validateCandidate = ({ isBaseline }) => {
      if (isBaseline) return
      const path = serve.mock.calls[0]![0].artifactPath
      chmodSync(path, 0o600)
      writeFileSync(path, 'different weights')
    }
    const result = await runProfileTraining(profile, options)
    assert(!result.succeeded)
    assert.equal(result.stage, 'profile')
    assert.match(result.reason, /checkpoint changed/)
    assert.equal(result.servingMayExist, true)
    await assertNoProfile(result.outputDirectory)
  })

  it('rejects checkpoint mutation by the serving adapter', async () => {
    const { profile, options, serve } = await fixture()
    serve.mockImplementation(async (input) => {
      chmodSync(input.artifactPath, 0o600)
      writeFileSync(input.artifactPath, 'different weights')
      return {
        succeeded: true,
        value: {
          artifactDigest: input.artifactDigest,
          routerModelId: input.routerModelId,
          evidenceDigest: sha256Utf8('evidence'),
        },
      }
    })
    const result = await runProfileTraining(profile, options)
    assert(!result.succeeded)
    assert.equal(result.stage, 'serving')
    assert.match(result.reason, /checkpoint changed/)
    await assertNoProfile(result.outputDirectory)
  })

  it('retains uncertainty when a serving adapter ignores cancellation', async () => {
    const { profile, options, controller, serve } = await fixture()
    serve.mockImplementation(() => {
      controller.abort(new Error('cancelled during serving'))
      return new Promise(() => {})
    })
    const result = await runProfileTraining(profile, options)
    assert(!result.succeeded)
    assert.equal(result.stage, 'serving')
    assert.equal(result.servingMayExist, true)
    assert.equal(result.trainingMayExist, false)
    assert.match(result.reason, /cancelled during serving/)
    await assertNoProfile(result.outputDirectory)
  })

  it('does not invoke either port for an already cancelled request', async () => {
    const { profile, options, controller, execute, serve } = await fixture()
    controller.abort(new Error('already cancelled'))
    const result = await runProfileTraining(profile, options)
    assert(!result.succeeded)
    assert.equal(result.stage, 'admission')
    assert.equal(execute.mock.calls.length, 0)
    assert.equal(serve.mock.calls.length, 0)
    assert.equal(result.outputDirectory, undefined)
  })

  it('contains synchronous adapter failures without publishing a profile', async () => {
    const { profile, options, execute } = await fixture()
    execute.mockImplementation(() => {
      throw new Error('adapter dispatch failed')
    })
    const result = await runProfileTraining(profile, options)
    assert(!result.succeeded)
    assert.equal(result.stage, 'training')
    assert.match(result.reason, /adapter dispatch failed/)
    assert.equal(result.trainingMayExist, true)
    await assertNoProfile(result.outputDirectory)
  })

  it('publishes the durable receipt before the profile through the shared writer', async () => {
    const { profile, options } = await fixture()
    faults.afterPublication = (path) => {
      if (path.endsWith('profile.json')) {
        const receipt = JSON.parse(readFileSync(join(dirname(path), 'receipt.json'), 'utf8'))
        assert.equal(receipt.dataset.digest, options.dataset.digest)
      }
    }
    const result = await runProfileTraining(profile, options)
    assert(result.succeeded, JSON.stringify(result))
    assert.deepEqual(faults.publications, [result.receiptPath, result.profilePath])
    assert(faults.syncedDirectories.includes(options.outputDirectory))
    assert.equal((await stat(result.profilePath)).mode & 0o777, 0o400)
    assert.equal((await stat(dirname(result.profilePath))).mode & 0o777, 0o700)
  })

  it('does not retract a committed profile for cancellation after publication', async () => {
    const { profile, options, controller } = await fixture()
    faults.afterPublication = (path) => {
      if (path.endsWith('profile.json')) controller.abort(new Error('cancelled after commit'))
    }
    const result = await runProfileTraining(profile, options)
    assert(controller.signal.aborted)
    assert(result.succeeded, JSON.stringify(result))
    assert.deepEqual(JSON.parse(await readFile(result.profilePath, 'utf8')), result.profile)
  })

  it('durably withdraws the profile when publication reports a storage failure', async () => {
    const { profile, options } = await fixture()
    faults.afterPublication = (path) => {
      if (path.endsWith('profile.json')) throw new Error('publication storage failure')
    }
    const result = await runProfileTraining(profile, options)
    assert(!result.succeeded)
    assert.equal(result.stage, 'persistence')
    assert.match(result.reason, /publication storage failure/)
    assert.equal(faults.syncedDirectories.at(-1), result.outputDirectory)
    await assertNoProfile(result.outputDirectory)
  })
})
