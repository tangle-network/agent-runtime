import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  type AgentProfile,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
  sha256Bytes,
  sha256Utf8,
  trainedModelIdForArtifact,
} from '@tangle-network/agent-interface'
import { describe, it } from 'vitest'
import { improve } from '../src/improvement/improve'
import { createProfileImprovementHarness } from '../src/improvement/profile-improvement-harness'
import {
  type CheckpointServingPort,
  createCommandProfileTrainer,
  type ImproveTrainingOptions,
  type ProfileTrainer,
  type TrainingDatasetDocument,
} from '../src/improvement/training'

// A CPU-only learned scalar fixture. This proves training execution, not agent quality.
const TRAIN = `
const fs = require('node:fs');
let input = ''; process.stdin.on('data', b => input += b);
process.stdin.on('end', () => {
  const r = JSON.parse(input);
  if (process.env.P5_PRIVATE_CANARY) throw new Error('ambient environment leaked');
  const d = JSON.parse(fs.readFileSync(r.datasetPath, 'utf8'));
  let weight = 0;
  for (let epoch = 0; epoch < r.parameters.epochs; epoch++) {
    for (const row of d.rows.filter(row => row.partition === 'train')) {
      weight -= r.parameters.learningRate * 2 * row.data.x * (weight * row.data.x - row.data.y);
    }
  }
  fs.writeFileSync(r.checkpointPath, JSON.stringify({ weight }));
});
`

const parent = (): AgentProfile => ({
  name: 'coder',
  version: '1',
  harness: 'opencode',
  model: { provider: 'openai-compat', default: 'base-coder' },
  prompt: { instructions: ['Use the tools and build the artifact.'] },
})

const serve: CheckpointServingPort = {
  async serve(input) {
    const digest = sha256Bytes(await readFile(input.artifactPath))
    assert.equal(digest, input.artifactDigest)
    assert.equal(input.routerModelId, trainedModelIdForArtifact(digest))
    return {
      succeeded: true,
      value: {
        artifactDigest: digest,
        routerModelId: input.routerModelId,
        evidenceDigest: canonicalCandidateDigest({ fixture: 'independent-serving-port', digest }),
      },
    }
  },
}

async function withFixture(
  run: (options: ImproveTrainingOptions, dir: string) => Promise<void>,
  script = TRAIN,
  maxOutputBytes = 4096,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'profile-training-test-'))
  try {
    const executable = await realpath(process.execPath)
    const scriptPath = join(dir, 'trainer.cjs')
    await writeFile(scriptPath, script)
    const dataset: TrainingDatasetDocument = {
      version: 1,
      format: 'sft',
      rows: [
        {
          task: { benchmark: 'fixture', task: 'train', contentDigest: sha256Utf8('train') },
          partition: 'train',
          data: { x: 1, y: 2 },
        },
        {
          task: {
            benchmark: 'fixture',
            task: 'development',
            contentDigest: sha256Utf8('development'),
          },
          partition: 'validation',
          data: { x: 2, y: 4 },
        },
      ],
    }
    const bytes = Buffer.from(JSON.stringify(dataset))
    const path = join(dir, 'source-dataset.json')
    await writeFile(path, bytes)
    const trainer = createCommandProfileTrainer({
      id: 'cpu-test-trainer',
      executable: { path: executable, digest: sha256Bytes(await readFile(executable)) },
      args: [scriptPath],
      inputs: [{ path: scriptPath, digest: sha256Utf8(script) }],
      environment: {},
      maxOutputBytes,
    })
    await run(
      {
        mode: 'training',
        trainer,
        dataset: { path, digest: sha256Bytes(bytes) },
        parameters: { epochs: 50, learningRate: 0.1 },
        executionRef: sha256Utf8('test-execution'),
        serving: serve,
        outputDirectory: join(dir, 'outputs'),
        timeoutMs: 10_000,
        maxCheckpointBytes: 4096,
      },
      dir,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function assertNoProfile(outputDirectory: string): Promise<void> {
  const names = await readdir(outputDirectory).catch(() => [])
  for (const name of names)
    assert(!(await readdir(join(outputDirectory, name))).includes('profile.json'))
}

describe('checkpoint training through improve', () => {
  it('executes a pinned command and persists a receipt before a frozen profile', async () => {
    await withFixture(async (options) => {
      const original = parent()
      const originalDigest = canonicalAgentProfileDigest(original)
      const result = await improve(original, options)
      assert(result.succeeded, JSON.stringify(result))
      const learned = JSON.parse(await readFile(result.artifactPath, 'utf8')) as { weight: number }
      assert(learned.weight > 1.99 && learned.weight < 2.01)
      assert.equal(result.receipt.parentProfileDigest, originalDigest)
      assert.equal(result.receipt.dataset.digest, options.dataset.digest)
      assert.deepEqual(
        result.receipt.dataset.tasks.map((task) => task.task),
        ['development', 'train'],
      )
      assert.deepEqual(result.receipt.trainer, {
        ...options.trainer.identity,
        parameters: options.parameters,
      })
      assert.equal(
        result.receipt.checkpoint.artifactDigest,
        sha256Bytes(await readFile(result.artifactPath)),
      )
      assert.equal(result.profile.model?.default, result.receipt.checkpoint.routerModelId)
      assert.equal(
        result.profileDigest,
        canonicalAgentProfileDigest(result.profile as AgentProfile),
      )
      assert.deepEqual(JSON.parse(await readFile(result.receiptPath, 'utf8')), result.receipt)
      assert.deepEqual(JSON.parse(await readFile(result.profilePath, 'utf8')), result.profile)
      assert(Object.isFrozen(result.profile.metadata?.training?.receipt))
      assert.equal(canonicalAgentProfileDigest(original), originalDigest)
      assert(!('decision' in result), 'training must not fabricate a ship verdict')
    })
  })

  it('does not inherit ambient credentials', async () => {
    const before = process.env.P5_PRIVATE_CANARY
    process.env.P5_PRIVATE_CANARY = 'private-test-value'
    try {
      await withFixture(async (options) => {
        assert((await improve(parent(), options)).succeeded)
      })
    } finally {
      if (before === undefined) delete process.env.P5_PRIVATE_CANARY
      else process.env.P5_PRIVATE_CANARY = before
    }
  })

  it('refuses a wrong dataset digest before invoking the trainer', async () => {
    await withFixture(async (options) => {
      let invoked = false
      options.trainer = {
        identity: options.trainer.identity,
        async execute() {
          invoked = true
          return { succeeded: true, value: undefined }
        },
      }
      options.dataset.digest = sha256Utf8('wrong')
      const result = await improve(parent(), options)
      assert(!result.succeeded)
      assert.equal(result.stage, 'dataset')
      assert.equal(invoked, false)
      await assertNoProfile(options.outputDirectory)
    })
  })

  for (const [name, script] of [
    ['nonzero exit', `process.stdin.resume(); process.stdin.on('end', () => process.exit(7));`],
    ['missing checkpoint', `process.stdin.resume();`],
    ['empty checkpoint', TRAIN.replace('JSON.stringify({ weight })', "''")],
    [
      'symlink checkpoint',
      TRAIN.replace(
        'fs.writeFileSync(r.checkpointPath, JSON.stringify({ weight }));',
        'fs.symlinkSync(r.datasetPath, r.checkpointPath);',
      ),
    ],
    [
      'excessive output',
      `process.stdin.resume(); process.stdin.on('end', () => console.log('x'.repeat(100000)));`,
    ],
    [
      'modified dataset',
      TRAIN.replace(
        'let weight = 0;',
        "fs.chmodSync(r.datasetPath, 0o600); fs.writeFileSync(r.datasetPath, '{}'); let weight = 0;",
      ),
    ],
  ]) {
    it(`refuses ${name} without producing a runnable profile`, async () => {
      await withFixture(async (options) => {
        const result = await improve(parent(), options)
        assert(!result.succeeded, name)
        await assertNoProfile(options.outputDirectory)
      }, script)
    })
  }

  it('refuses changed trainer inputs', async () => {
    await withFixture(async (options, dir) => {
      await writeFile(join(dir, 'trainer.cjs'), `${TRAIN}\n// changed after pinning`)
      const result = await improve(parent(), options)
      assert(!result.succeeded)
      assert.match(result.reason, /digest mismatch/)
      await assertNoProfile(options.outputDirectory)
    })
  })

  for (const kind of ['unverified', 'wrong-artifact', 'mutable-route'] as const) {
    it(`refuses ${kind} serving evidence`, async () => {
      await withFixture(async (options) => {
        options.serving = {
          async serve(input) {
            if (kind === 'unverified') return { succeeded: false, reason: 'route not verified' }
            return {
              succeeded: true,
              value: {
                artifactDigest:
                  kind === 'wrong-artifact' ? sha256Utf8('other') : input.artifactDigest,
                routerModelId: kind === 'mutable-route' ? 'fine-tune/latest' : input.routerModelId,
                evidenceDigest: sha256Utf8('evidence'),
              },
            }
          },
        }
        const result = await improve(parent(), options)
        assert(!result.succeeded)
        assert.equal(result.stage, 'serving')
        await assertNoProfile(options.outputDirectory)
      })
    })
  }

  it('bounds a managed trainer and reports unconfirmed remote cleanup', async () => {
    await withFixture(async (options) => {
      const managed: ProfileTrainer = {
        identity: { mode: 'managed', id: 'managed-test', revision: sha256Utf8('adapter') },
        execute: async () => new Promise(() => {}),
      }
      const result = await improve(parent(), { ...options, trainer: managed, timeoutMs: 500 })
      assert(!result.succeeded)
      assert.equal(result.stage, 'training')
      assert.equal(result.trainingMayExist, true)
      await assertNoProfile(options.outputDirectory)
    })
  })

  it('cancels the command process group including descendants', async () => {
    await withFixture(
      async (options, dir) => {
        const checkpointPath = join(dir, 'cancel-checkpoint')
        const controller = new AbortController()
        const pending = options.trainer.execute(
          {
            version: 1,
            invocationId: 'cancel-test',
            datasetPath: options.dataset.path,
            checkpointPath,
            parentProfilePath: options.dataset.path,
            parentProfileDigest: canonicalAgentProfileDigest(parent()),
            parameters: {},
            executionRef: options.executionRef,
          },
          controller.signal,
        )
        try {
          let ready = false
          for (let i = 0; i < 100 && !ready; i++) {
            ready = await readFile(`${checkpointPath}.ready`).then(
              () => true,
              () => false,
            )
            if (!ready) await sleep(20)
          }
          assert(ready, 'the parent must have actually spawned before cancellation')
          controller.abort()
          assert.equal((await pending).succeeded, false)
          await sleep(700)
          await assert.rejects(() => readFile(`${checkpointPath}.late`), { code: 'ENOENT' })
        } finally {
          controller.abort()
          await pending
        }
      },
      `
const fs = require('node:fs'), { spawn } = require('node:child_process');
let input = ''; process.stdin.on('data', b => input += b);
process.stdin.on('end', () => {
  const r = JSON.parse(input);
  spawn(process.execPath, ['-e', "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'late'), 600)", r.checkpointPath + '.late'], { stdio: 'ignore' });
  fs.writeFileSync(r.checkpointPath + '.ready', 'ready');
  setInterval(() => {}, 1000);
});
`,
    )
  })

  it('uses the bound harness parent identity execution reference and validator', async () => {
    await withFixture(async (options) => {
      const original = parent()
      const validations: boolean[] = []
      const harness = createProfileImprovementHarness({
        profile: original,
        executionRef: sha256Utf8('bound-executor'),
        agent: async () => {
          throw new Error('training must not execute a benchmark task')
        },
        validateCandidate: (input) => {
          validations.push(input.isBaseline)
        },
      })
      original.name = 'mutated-after-binding'
      const result = await harness.train(options)
      assert(result.succeeded, JSON.stringify(result))
      assert.equal(result.receipt.parentProfileDigest, harness.profileDigest)
      assert.equal(result.receipt.executionRef, harness.executionRef)
      assert.deepEqual(validations, [true, false])
    })
  })

  it('retains the complete ancestry when training a trained parent', async () => {
    await withFixture(async (options) => {
      const first = await improve(parent(), options)
      assert(first.succeeded)
      const second = await improve(first.profile, {
        ...options,
        parameters: { epochs: 30, learningRate: 0.1 },
      })
      assert(second.succeeded, JSON.stringify(second))
      assert.equal(second.receipt.parentProfileDigest, first.profileDigest)
      assert.equal(second.receipt.parentReceiptDigest, canonicalCandidateDigest(first.receipt))
      assert.deepEqual(second.profile.metadata?.training?.ancestors, [first.receipt])
    })
  })

  it('refuses training validation overlap before execution', async () => {
    await withFixture(async (options) => {
      const dataset = JSON.parse(
        await readFile(options.dataset.path, 'utf8'),
      ) as TrainingDatasetDocument
      dataset.rows[1]!.task = dataset.rows[0]!.task
      const bytes = Buffer.from(JSON.stringify(dataset))
      await writeFile(options.dataset.path, bytes)
      options.dataset.digest = sha256Bytes(bytes)
      const result = await improve(parent(), options)
      assert(!result.succeeded)
      assert.equal(result.stage, 'dataset')
      assert.match(result.reason, /partitions intersect/)
    })
  })

  it('refuses a candidate rejected by the existing validation hook', async () => {
    await withFixture(async (options) => {
      options.validateCandidate = ({ isBaseline }) => {
        if (!isBaseline) throw new Error('candidate refused')
      }
      const result = await improve(parent(), options)
      assert(!result.succeeded)
      assert.equal(result.stage, 'profile')
      await assertNoProfile(options.outputDirectory)
    })
  })
  it('snapshots a direct command request before asynchronous input verification', async () => {
    await withFixture(async (options, dir) => {
      const originalPath = join(dir, 'original-checkpoint')
      const request = {
        version: 1 as const,
        invocationId: 'direct-call',
        datasetPath: options.dataset.path,
        checkpointPath: originalPath,
        parentProfilePath: options.dataset.path,
        parentProfileDigest: canonicalAgentProfileDigest(parent()),
        parameters: options.parameters,
        executionRef: options.executionRef,
      }
      const pending = options.trainer.execute(request, new AbortController().signal)
      request.checkpointPath = join(dir, 'redirected-checkpoint')
      const result = await pending
      assert(result.succeeded, JSON.stringify(result))
      assert((await readFile(originalPath)).length > 0)
      await assert.rejects(readFile(request.checkpointPath), { code: 'ENOENT' })
    })
  })

  it('honors a caller output bound larger than sixteen MiB', async () => {
    await withFixture(
      async (options) => {
        const result = await improve(parent(), options)
        assert(result.succeeded, JSON.stringify(result))
      },
      TRAIN.replace(
        'let weight = 0;',
        "process.stdout.write('x'.repeat(17 * 1024 * 1024)); let weight = 0;",
      ),
      18 * 1024 * 1024,
    )
  })

  it('allows a byte-pinned empty configuration input while still requiring a nonempty checkpoint', async () => {
    await withFixture(async (options, dir) => {
      const executable = await realpath(process.execPath)
      const config = join(dir, 'empty-config')
      await writeFile(config, '')
      const trainer = createCommandProfileTrainer({
        id: 'empty-config-trainer',
        executable: { path: executable, digest: sha256Bytes(await readFile(executable)) },
        args: [join(dir, 'trainer.cjs')],
        inputs: [
          { path: join(dir, 'trainer.cjs'), digest: sha256Utf8(TRAIN) },
          { path: config, digest: sha256Utf8('') },
        ],
        environment: {},
        maxOutputBytes: 4096,
      })
      const result = await improve(parent(), { ...options, trainer })
      assert(result.succeeded, JSON.stringify(result))
    })
  })
  it('waits for a descendant to flush during shared process-group cleanup', async () => {
    await withFixture(
      async (options) => {
        const result = await improve(parent(), options)
        assert(result.succeeded, JSON.stringify(result))
        assert.equal(await readFile(result.artifactPath, 'utf8'), 'final child checkpoint')
      },
      `
const { spawn } = require('node:child_process');
let input = ''; process.stdin.on('data', b => input += b);
process.stdin.on('end', () => {
  const r = JSON.parse(input);
  const code = "process.on('SIGTERM', () => { require('node:fs').writeFileSync(process.argv[1], 'final child checkpoint'); process.exit(0); }); process.send('ready'); setInterval(() => {}, 1000);";
  const child = spawn(process.execPath, ['-e', code, r.checkpointPath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  child.on('message', () => { child.disconnect(); process.exit(0); });
});
`,
    )
  })
})
