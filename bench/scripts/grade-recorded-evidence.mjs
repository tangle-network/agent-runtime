// Re-grades the retained agent outputs of a recorded proof with each benchmark's official judge,
// run from the installed package: SWE-bench judges the recorded patch, and Terminal-Bench replays
// the recorded tool calls as the adapter's script artifact. No model is called.
// Each grade must reproduce its recorded official verdict; a missing or unmeasured grade throws.
import assert from 'node:assert/strict'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveAdapter } from '@tangle-network/agent-bench'

const evidence = process.argv[2]
if (!evidence) throw new Error('usage: grade-recorded-evidence.mjs <evidence directory>')
const read = (...parts) => readFileSync(join(evidence, ...parts), 'utf8')
const base64 = (text) => `echo ${Buffer.from(text).toString('base64')} | base64 -d`
const decoded = (text) => `"$(${base64(text)})"`

function replayScript(task) {
  const lines = ['set -e']
  for (const line of read('terminal', task, 'opencode-events.jsonl').split('\n').filter(Boolean)) {
    const part = JSON.parse(line).part
    if (part?.type !== 'tool') continue
    const { command, workdir, filePath, content } = part.state?.input ?? {}
    if (part.tool === 'bash') lines.push(`(${workdir ? `cd ${decoded(workdir)} && ` : ''}eval ${decoded(command)})`)
    else if (part.tool === 'write') lines.push(`mkdir -p "$(dirname ${decoded(filePath)})" && ${base64(content)} > ${decoded(filePath)}`)
    else if (part.tool === 'read') lines.push(`cat ${decoded(filePath)}`)
    else throw new Error(`terminal ${task}: no replay for recorded tool ${part.tool}`)
  }
  return `${lines.join('\n')}\n`
}

const terminal = (task) => {
  const [recorded] = JSON.parse(read('terminal', task, 'results.json')).results
  return ['terminal-bench', task, replayScript(task), recorded.is_resolved, recorded.parser_results]
}
const swe = (task) => ['swe-bench', task, read('swe', task, 'patch.diff'),
  JSON.parse(read('swe', task, 'official-summary.json')).resolved_ids.includes(task)]

for (const [benchmark, id, artifact, resolved, parserResults] of [
  terminal('hello-world'), terminal('fix-permissions'), swe('astropy__astropy-12907'),
]) {
  const adapter = resolveAdapter(benchmark)
  await adapter.preflight()
  const [task] = await adapter.loadTasks({ ids: [id] })
  assert.equal(task?.id, id, `${benchmark} did not load ${id}`)
  const score = await adapter.judge(task, artifact)
  const line = `official grade ${benchmark} ${id}: ${score.resolved ? 'resolved' : 'unresolved'} ${score.detail}`
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`)
  assert.equal(score.resolved, resolved, `${id} grade differs from its recorded official verdict`)
  if (parserResults) assert.deepEqual(JSON.parse(score.detail), parserResults, `${id} checks differ from the recorded run`)
}
