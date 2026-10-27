// Public flow admission -> real child process/file output; no model or native coding harness.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  type Agent,
  type AgentGraph,
  type AgentSpec,
  contentAddress,
  type Executor,
  type ExecutorResult,
  FileSpawnJournal,
  type MakeWorkerAgent,
  runGraph,
  supervise,
} from '@tangle-network/agent-runtime/kernel'
import { expect, it } from 'vitest'

const exec = promisify(execFile)
const allowed = 'gpt-6.1-sol'

it('admits a model-free coordinator while enforcing its actual leaf model allowlist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flow-model-admission-'))
  try {
    const output = join(root, 'digest.txt'),
      input = 'Retained flow admission evidence.'
    const digest = createHash('sha256').update(input).digest('hex')
    let processes = 0
    const makeLeafAgent: MakeWorkerAgent = (profile) => {
      let artifact: ExecutorResult<unknown> | undefined
      const executor: Executor<unknown> = {
        runtime: 'inline',
        async execute(_task, signal) {
          processes += 1
          await exec(
            process.execPath,
            [
              '--input-type=module',
              '-e',
              `
            import {createHash} from 'node:crypto'; import {writeFileSync} from 'node:fs';
            writeFileSync(process.argv[1], createHash('sha256').update(process.argv[2]).digest('hex'));
          `,
              output,
              input,
            ],
            { signal, timeout: 10_000 },
          )
          const out = await readFile(output, 'utf8')
          artifact = {
            outRef: contentAddress(out),
            out,
            verdict: { valid: out === digest },
            spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
          }
          return artifact
        },
        teardown: () => Promise.resolve({ destroyed: true }),
        resultArtifact: () => {
          if (!artifact) throw new Error('No process result was produced')
          return artifact
        },
      }
      return {
        name: profile.name,
        act: async () => undefined,
        executorSpec: { profile, harness: null, executor } satisfies AgentSpec,
      } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    }
    const graph = (model: string): AgentGraph => ({
      nodes: [
        {
          id: 'digest',
          profile: {
            name: 'digest',
            harness: 'cli-base',
            model: { provider: 'openai', default: model },
          },
        },
      ],
      entry: [{ node: 'digest', task: input }],
      edges: [],
      deliverable: { describe: 'Compute the supplied digest.', check: () => true },
      budget: { maxIterations: 8, maxTokens: 1000, deadlineMs: 15_000 },
    })
    const options = { allowedModels: [allowed], makeLeafAgent, workerSlots: 1 }
    const result = await runGraph(graph(allowed), {
      ...options,
      runId: 'allowed-flow',
      runDir: join(root, 'allowed'),
    })
    expect(result.result.kind).toBe('winner')
    expect(processes).toBe(1)
    expect(await readFile(output, 'utf8')).toBe(digest)
    const journal = await new FileSpawnJournal(
      join(root, 'allowed', 'spawn-journal.jsonl'),
    ).loadTree('allowed-flow')
    expect(journal?.filter((event) => event.kind === 'spawned')).toHaveLength(2)
    await expect(
      runGraph(graph('disallowed-model'), { ...options, runId: 'denied-flow' }),
    ).rejects.toThrow(/model "disallowed-model" is not in the allowed set/u)
    expect(processes).toBe(1)
    await expect(async () =>
      supervise({ name: 'ordinary-root', harness: 'cli-base' }, input, {
        ...options,
        budget: graph(allowed).budget,
      }),
    ).rejects.toThrow('AgentProfile.model.default is missing')
    expect(processes).toBe(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
