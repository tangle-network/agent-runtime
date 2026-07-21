/**
 * Judge child entrypoint — the experiment's `judge.mts`, tracked. One patch,
 * one official swebench verdict, printed as a single `JUDGE_RESULT {...}` line
 * that serialized-judge.ts parses. Runs as a CHILD process (not in-process) so
 * the judge ceiling can SIGKILL a hung swebench run without taking the
 * experiment down, exactly like the bash `timeout N node judge.mts`.
 *
 * usage: node --import tsx src/swe-arena/judge-child.mts <instance_id> <patchPath>
 */

import { readFileSync } from 'node:fs'
import { createSweBenchAdapter } from '../benchmarks/swe-bench.ts'

const [, , iid, patchPath] = process.argv
if (!iid || !patchPath) {
  console.error('usage: node --import tsx judge-child.mts <instance_id> <patchPath>')
  process.exit(2)
}
const patch = readFileSync(patchPath, 'utf8')
const adapter = createSweBenchAdapter()
const [task] = await adapter.loadTasks({ ids: [iid], split: 'test' })
if (!task) {
  console.log(JSON.stringify({ iid, error: 'no-task' }))
  process.exit(2)
}
const t0 = Date.now()
const score = await adapter.judge(task, patch)
console.log(
  'JUDGE_RESULT ' +
    JSON.stringify({
      iid,
      resolved: score.resolved,
      score: score.score,
      secs: Math.round((Date.now() - t0) / 1000),
      patch_bytes: patch.length,
    }),
)
