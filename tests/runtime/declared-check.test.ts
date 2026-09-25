import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkProgramDigest,
  type DeclaredCheck,
  type DeclaredCheckPlacement,
  declaredCheckDeliverable,
  declaredCheckJudge,
  readDeclaredCheck,
} from '../../src/runtime/declared-check'
import type { IsolatedCheckBox } from '../../src/runtime/isolated-checker'
import { CheckUnavailableError } from '../../src/runtime/supervise/continuation'

/**
 * A Sandbox client whose boxes are local directories. It runs the real `runIsolatedCheck` box
 * path: fresh-box receipt, egress read-back, verified upload, exact spawn, delete. Each create is
 * recorded so a test can read the egress policy the check asked for.
 */
function localBoxes(root: string) {
  const created: Array<{ egressPolicy: unknown; environment: unknown }> = []
  let boxes = 0
  const client = {
    getIdentity: async () => ({ customerId: 'cust_check' }),
    createIsolated: async (options: { egressPolicy?: unknown; environment?: unknown }) => {
      created.push({ egressPolicy: options.egressPolicy, environment: options.environment })
      boxes += 1
      const dir = join(root, `box-${boxes}`)
      await mkdir(dir, { recursive: true })
      return {
        id: `box-${boxes}`,
        createReceipt: () => ({
          outcome: 'created',
          ownerContext: 'isolated',
          injectedSecrets: [],
        }),
        egress: { get: async () => ({ policy: options.egressPolicy }) },
        fs: {
          mkdir: async (path: string) => {
            await mkdir(join(dir, path), { recursive: true })
          },
          uploadData: async (path: string, bytes: Uint8Array, opts: { mode: number }) => {
            await mkdir(dirname(join(dir, path)), { recursive: true })
            await writeFile(join(dir, path), bytes, { mode: opts.mode })
            return {
              hash: createHash('sha256').update(bytes).digest('hex'),
              size: bytes.byteLength,
            }
          },
        },
        process: {
          spawnExact: async (
            executable: string,
            args: string[],
            opts: { cwd: string; env: Record<string, string> },
          ) => {
            const child = spawn(executable, args, {
              cwd: join(dir, opts.cwd),
              env: { ...opts.env, PATH: process.env.PATH ?? '' },
            })
            const exit = new Promise<number>((resolve) =>
              child.on('close', (code) => resolve(code ?? 1)),
            )
            const text = async function* (stream: NodeJS.ReadableStream) {
              for await (const chunk of stream) yield String(chunk)
            }
            return {
              stdout: () => text(child.stdout),
              stderr: () => text(child.stderr),
              wait: () => exit,
              status: async () => ({ exitSignal: undefined }),
              kill: async () => {
                child.kill('SIGKILL')
              },
            }
          },
        },
        delete: async () => {
          await rm(dir, { recursive: true, force: true })
        },
      }
    },
  } as unknown as IsolatedCheckBox['client']
  return { client, created }
}

/** The program: items `answer` and `sealed-case`; it prints one JudgeScore on its last line. */
const PROGRAM = `
import { readFileSync } from 'node:fs'
const result = process.env.CHECK_RESULT ? JSON.parse(readFileSync(process.env.CHECK_RESULT, 'utf8')) : null
const set = process.env.CHECK_SET
if (process.env.CHECK_TOKEN !== 'token-value') { console.log('no token'); process.exit(3) }
const dimensions = { answer: result?.answer === 42 ? 1 : 0 }
const notes = []
if (dimensions.answer < 1) notes.push('FAIL answer result.json: ' + (result ? 'answer is ' + result.answer : 'nothing submitted'))
if (set === 'sealed') {
  const hidden = readFileSync('_sealed/case.txt', 'utf8').trim()
  dimensions['sealed-case'] = hidden === 'hidden' ? 1 : 0
}
if (process.env.CHECK_STATE) {
  const output = readFileSync(process.env.CHECK_STATE + '/out/output.txt', 'utf8').trim()
  dimensions.state = output === 'done' ? 1 : 0
  if (dimensions.state < 1) notes.push('FAIL state out/output.txt: holds ' + output)
}
console.log('reading the result')
const values = Object.values(dimensions)
console.log(JSON.stringify({ dimensions, composite: values.reduce((a, b) => a + b, 0) / values.length, notes: notes.join('\\n') }))
`

describe('a declared check', () => {
  let root: string
  let check: DeclaredCheck
  let placement: DeclaredCheckPlacement
  let boxes: ReturnType<typeof localBoxes>
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'declared-check-'))
    const program = join(root, 'program')
    await mkdir(program)
    await writeFile(join(program, 'judge.mjs'), PROGRAM)
    const sealed = join(root, 'sealed')
    await mkdir(sealed)
    await writeFile(join(sealed, 'case.txt'), 'hidden\n')
    check = {
      program: { dir: program, digest: await checkProgramDigest(program) },
      command: [process.execPath, 'judge.mjs'],
      environment: 'node-22',
      egress: ['kb.example.test'],
      secrets: ['CHECK_TOKEN'],
      pass: 1,
      feedback: 'verbatim',
      sealed: { dir: sealed, digest: await checkProgramDigest(sealed) },
      describe: 'an answer of 42',
    }
    boxes = localBoxes(join(root, 'boxes'))
    placement = {
      client: boxes.client,
      builderAccounts: ['cust_builder'],
      env: { CHECK_TOKEN: 'token-value' },
    }
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads the submitted result in a fresh box with strict egress, and returns located failures', async () => {
    const verdict = await readDeclaredCheck(check, placement, {
      result: { answer: 41 },
      set: 'development',
    })
    expect(verdict).toEqual({
      pass: false,
      items: { answer: 0 },
      composite: 0,
      threshold: 1,
      failures: ['FAIL answer result.json: answer is 41'],
    })
    expect(boxes.created[0]).toEqual({
      egressPolicy: {
        mode: 'strict',
        allowDomains: ['kb.example.test'],
        includeImplicitDomains: false,
      },
      environment: 'node-22',
    })
  })

  it('is the manager deliverable: submits pass on development cases, and a state read has no result', async () => {
    const deliverable = declaredCheckDeliverable(check, placement)
    expect(deliverable).toMatchObject({
      feedback: 'verbatim',
      sealed: true,
      describe: 'an answer of 42',
    })
    expect(await deliverable.check({ answer: 42 })).toMatchObject({
      pass: true,
      items: { answer: 1 },
    })
    expect(await deliverable.checkState?.()).toMatchObject({
      pass: false,
      failures: ['FAIL answer result.json: nothing submitted'],
    })
  })

  it('reads the run state the host captures before each read, beside the submitted result', async () => {
    const captured: string[] = []
    let output = 'draft'
    const deliverable = declaredCheckDeliverable(check, placement, {
      state: async (into) => {
        captured.push(into)
        await mkdir(join(into, 'out'))
        await writeFile(join(into, 'out', 'output.txt'), `${output}\n`)
      },
    })
    expect(await deliverable.checkState?.()).toMatchObject({
      pass: false,
      items: { answer: 0, state: 0 },
      failures: [
        'FAIL answer result.json: nothing submitted',
        'FAIL state out/output.txt: holds draft',
      ],
    })
    output = 'done'
    expect(await deliverable.check({ answer: 42 })).toMatchObject({
      pass: true,
      items: { answer: 1, state: 1 },
    })
    expect(captured).toHaveLength(2)
    // Each capture directory is Runtime's own and is gone after its read.
    for (const into of captured) await expect(access(into)).rejects.toThrow()
  })

  it('gives no verdict when the state cannot be captured, and creates no box', async () => {
    const deliverable = declaredCheckDeliverable(check, placement, {
      state: async () => {
        throw new Error('the root box has no container task')
      },
    })
    await expect(deliverable.check({ answer: 42 })).rejects.toThrow(
      /the run's state could not be captured: the root box has no container task/,
    )
    await expect(deliverable.checkState?.()).rejects.toThrow(CheckUnavailableError)
    expect(boxes.created).toHaveLength(0)
  })

  it('scores a version on the sealed cases, which no in-run read ever mounts', async () => {
    const judge = declaredCheckJudge(check, placement)
    const verdict = await judge.judge(
      {
        version: 1,
        runId: 'r',
        runDir: root,
        settleDigest: `sha256:${'0'.repeat(64)}`,
        result: { kind: 'winner', out: { answer: 42 } } as never,
        profile: {} as never,
      },
      new AbortController().signal,
    )
    expect(verdict).toMatchObject({
      score: 1,
      judgeDigest: judge.digest,
      check: { pass: true, items: { answer: 1, 'sealed-case': 1 } },
    })
  })

  it('treats a program that cannot run as no verdict, never as a zero', async () => {
    await expect(
      readDeclaredCheck(check, { ...placement, env: {} }, { set: 'development' }),
    ).rejects.toThrow(CheckUnavailableError)
    await expect(
      readDeclaredCheck({ ...check, secrets: [] }, placement, { set: 'development' }),
    ).rejects.toThrow(/the check program failed/)
    const judge = declaredCheckJudge({ ...check, secrets: [] }, placement)
    const verdict = await judge.judge(
      { version: 1, result: { kind: 'no-winner' } } as never,
      new AbortController().signal,
    )
    expect(verdict.score).toBeNull()
  })

  it('refuses a program whose files are not the ones the record names', async () => {
    await writeFile(join(check.program.dir, 'judge.mjs'), `${PROGRAM}\n// edited`)
    await expect(readDeclaredCheck(check, placement, { set: 'development' })).rejects.toThrow(
      /the record names sha256:/,
    )
    expect(boxes.created).toHaveLength(0)
  })

  it('refuses a check box on an account the judged run holds a key to', async () => {
    await expect(
      readDeclaredCheck(
        check,
        { ...placement, builderAccounts: ['cust_check'] },
        { set: 'development' },
      ),
    ).rejects.toThrow(CheckUnavailableError)
    expect(boxes.created).toHaveLength(0)
  })
})
