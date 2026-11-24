#!/usr/bin/env node
/**
 * agent-bench run <benchmark> --target <model:|app:|profile:> [--tasks N] [--task <publisher task id>]... [--out <dir>] [-- <runner args>]
 * agent-bench list
 *
 * Runs a published benchmark with its publisher's own runner and grader (src/published.ts), prints the score with what it
 * measured, and writes the run record to --out (default ./agent-bench-runs/<benchmark>-<time>).
 */
import path from 'node:path'
import { PUBLISHED_BENCHMARKS, runPublished } from './published'

const usage = 'usage: agent-bench run <benchmark> --target <model:<router model>|app:<agent app>@<harness/model>|profile:<harness/model>> [--tasks N] [--task <id>]... [--out <dir>] [-- <runner args>]\n       agent-bench list'

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (command === 'list') {
    for (const benchmark of Object.values(PUBLISHED_BENCHMARKS)) {
      console.log(`${benchmark.name} ${benchmark.version} ${benchmark.repository}@${benchmark.ref.slice(0, 12)} ${benchmark.measured} judge=${benchmark.judge ?? 'deterministic'} license=${benchmark.license}`)
    }
    return 0
  }
  if (command !== 'run' || !rest[0] || rest[0].startsWith('-')) {
    console.error(usage)
    return 2
  }
  const name = rest[0]
  const separator = rest.indexOf('--')
  const own = separator === -1 ? rest.slice(1) : rest.slice(1, separator)
  const runnerArgs = separator === -1 ? [] : rest.slice(separator + 1)
  let target: string | undefined
  let tasks: number | undefined
  const taskIds: string[] = []
  let out: string | undefined
  for (let i = 0; i < own.length; i++) {
    const flag = own[i]
    const value = own[i + 1]
    if (value === undefined) throw new Error(`${flag} needs a value\n${usage}`)
    if (flag === '--target') target = value
    else if (flag === '--tasks') tasks = Number.parseInt(value, 10)
    else if (flag === '--task') taskIds.push(value)
    else if (flag === '--out') out = value
    else throw new Error(`unknown option ${flag}\n${usage}`)
    i++
  }
  if (!target) throw new Error(`--target is required\n${usage}`)
  if (tasks !== undefined && !(Number.isSafeInteger(tasks) && tasks > 0)) throw new Error('--tasks must be a positive integer')
  const run = await runPublished(name, target, {
    ...(tasks === undefined ? {} : { tasks }),
    ...(taskIds.length ? { taskIds } : {}),
    args: runnerArgs,
    out: path.resolve(out ?? path.join('agent-bench-runs', `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`)),
  })
  console.log(`${run.benchmark} ${run.version} on ${run.target}: ${run.passed} of ${run.tasks} passed, score ${run.score.toFixed(3)}, measured ${run.measured}, judge ${run.judge === null ? 'deterministic' : run.judge} (${run.official ? 'official' : 'substituted'})`)
  if (run.app) {
    console.log(`app: ${run.app.app} profile ${run.app.profileName ?? '?'} ${run.app.profileVersion ?? ''} ${run.app.profileDigest.slice(0, 19)} from ${run.app.profileUrl}; ` +
      `its production model ${JSON.stringify(run.app.productionModel)} replaced by ${run.model}; its MCP servers not mounted: ${run.app.omittedMcp.join(', ') || 'none'}`)
  }
  console.log(`record: ${path.join(path.dirname(run.resultPath), `${run.benchmark}-run.json`)}`)
  return 0
}

main(process.argv.slice(2)).then((code) => process.exit(code), (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
