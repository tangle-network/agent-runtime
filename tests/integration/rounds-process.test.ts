import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { inProcessSandboxClient, runAgentRounds } from '../../src/runtime'

const execute = promisify(execFile)
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

const worker = `
import { writeFileSync } from 'node:fs'
const task = JSON.parse(process.argv[2])
const value = task.input * task.input
writeFileSync('result.json', JSON.stringify({ value, target: task.target, pid: process.pid }))
process.stdout.write(JSON.stringify(value))
`
const scorer = `
import { readFileSync } from 'node:fs'
const result = JSON.parse(readFileSync('result.json', 'utf8'))
process.stdout.write(String(Number(result.value === result.target)))
`

// The callback supplies the local execution protocol; worker and scorer both run real Node processes.
it('runs successive rounds against process-written artifacts and removes every workspace', async () => {
  const workspaces = new Set<string>()
  const workerPids = new Set<number>()
  const client = inProcessSandboxClient({
    workdir: 'rounds-process',
    async onPrompt(prompt, context) {
      if (!context.workdir) throw new Error('the process worker needs a real workspace')
      workspaces.add(context.workdir)
      const { stdout } = await execute(process.execPath, ['worker.mjs', prompt], {
        cwd: context.workdir,
        encoding: 'utf8',
        signal: context.signal,
        timeout: 5_000,
      })
      const receipt: unknown = JSON.parse(
        await readFile(join(context.workdir, 'result.json'), 'utf8'),
      )
      if (
        typeof receipt !== 'object' ||
        receipt === null ||
        !('pid' in receipt) ||
        typeof receipt.pid !== 'number'
      )
        throw new Error('worker did not persist its process receipt')
      workerPids.add(receipt.pid)
      return [
        { type: 'result', data: { finalText: stdout } },
        { type: 'done', data: { outcome: { type: 'completed' } } },
      ]
    },
  })
  try {
    const result = await runAgentRounds<
      { input: number; target: number },
      number,
      'continue' | 'done'
    >({
      task: { input: 2, target: 9 },
      maxIterations: 2,
      maxConcurrency: 1,
      driver: {
        async plan(task, history) {
          const previous = history.at(-1)
          return [{ ...task, input: previous ? previous.task.input + 1 : task.input }]
        },
        decide: (history) =>
          history.some((iteration) => iteration.verdict?.valid) ? 'done' : 'continue',
      },
      agentRun: {
        profile: {
          name: 'local-process-worker',
          harness: 'opencode',
          model: { provider: 'offline', default: 'offline-test-model' },
        },
        taskToPrompt: JSON.stringify,
        async prepareBox(box) {
          const directory = await box.exec('pwd')
          if (directory.exitCode !== 0) throw new Error(directory.stderr)
          workspaces.add(directory.stdout.trim())
          await box.fs.write('worker.mjs', worker)
          await box.fs.write('score.mjs', scorer)
        },
      },
      output: {
        parse(events) {
          const text = events.find((event) => event.type === 'result')?.data?.finalText
          if (typeof text !== 'string') throw new Error('worker did not return its output')
          const value: unknown = JSON.parse(text)
          if (typeof value !== 'number') throw new Error('worker output must be numeric')
          return value
        },
      },
      validator: {
        async validate(output, context) {
          if (!context.box) throw new Error('scoring requires the live workspace')
          const receipt: unknown = JSON.parse(await context.box.fs.read('result.json'))
          if (typeof receipt !== 'object' || receipt === null || !('value' in receipt))
            throw new Error('scoring requires the persisted result')
          expect(receipt.value).toBe(output)
          const checked = await context.box.exec(`${shellQuote(process.execPath)} score.mjs`)
          if (checked.exitCode !== 0) throw new Error(checked.stderr)
          const score = Number(checked.stdout)
          if (score !== 0 && score !== 1) throw new Error('scorer returned an invalid score')
          return { valid: score === 1, score }
        },
      },
      ctx: { sandboxClient: client },
    })
    expect(result.decision).toBe('done')
    expect(
      result.iterations.map((iteration) => ({
        output: iteration.output,
        valid: iteration.verdict?.valid,
        error: iteration.error,
      })),
    ).toEqual([
      { output: 4, valid: false, error: undefined },
      { output: 9, valid: true, error: undefined },
    ])
    expect(result.winner?.output).toBe(9)
    expect(workerPids.size).toBe(2)
    expect(workerPids.has(process.pid)).toBe(false)
    expect(workspaces.size).toBe(2)
    expect([...workspaces].filter(existsSync)).toEqual([])
  } finally {
    await Promise.all(
      [...workspaces].map((directory) => rm(directory, { recursive: true, force: true })),
    )
  }
})
