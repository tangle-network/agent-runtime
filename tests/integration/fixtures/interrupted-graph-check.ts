import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runGraph } from '../../../src/runtime/supervise/graph'
import { loadGraphFile } from '../../../src/runtime/supervise/graph-file'
import { graphFromStored } from '../../../src/runtime/supervise/graph-registry'
import { createExecutor } from '../../../src/runtime/supervise/runtime'

const [directory, phase] = process.argv.slice(2)
if (!directory) throw new Error('expected a run directory')
const backend = {
  backend: 'bridge',
  bridgeUrl: 'http://127.0.0.1:1',
  bridgeBearer: '',
  cwd: join(directory, 'work'),
} as const
if (phase === 'start') await writeFile(join(directory, 'work', 'first-pid'), String(process.pid))
const { graph } = await loadGraphFile(join(directory, 'checks.yaml'))
const { result } = await runGraph(graphFromStored(graph), {
  backend,
  recoverExecutor: createExecutor(backend),
  runDir: join(directory, 'run'),
  runId: 'interrupted-check',
  resume: phase === 'resume',
})
if (result.kind !== 'winner') throw new Error(JSON.stringify(result))
