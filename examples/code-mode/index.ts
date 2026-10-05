/**
 * code-mode — a supervisor whose tool surface is `search` + `execute`, per the pattern Cloudflare
 * ("Code Mode") and Anthropic ("code execution with MCP") define: the coordination verbs are
 * presented as a GENERATED TypeScript API, the model writes one program against it, and the
 * program's calls cross the same kernel path the MCP verbs cross — pool, authorization, journal.
 *
 * The run below is offline and $0 (a scripted brain plays the model): it searches the API, then
 * ONE `execute` call spawns two workers, waits in code for both settlements, and returns the merged
 * result — work that costs five tool-calling round trips (spawn, spawn, wait, wait, compose) in one
 * model turn. The printed journal excerpt is the proof that the program's spawns were real
 * kernel spawns, not a bypass.
 *
 * Run:  pnpm tsx examples/code-mode/index.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import {
  codeModeSupervisorTools,
  unsafeInProcessRunner,
} from '../../src/runtime/supervise/code-mode'
import { superviseWithTestBrain } from '../../src/runtime/supervise/supervise'
import type { Agent, AgentSpec, Executor, ExecutorResult } from '../../src/runtime/supervise/types'
import { scriptedBrain } from '../../tests/kernel/scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from '../../tests/kernel/test-agent-profile'

/** Offline leaf: each worker settles `{ built: <name> }`, valid, through the kernel's own gate. */
function leafSeam(profileRaw: unknown): Agent<unknown, unknown> {
  const profile = profileRaw as AgentProfile
  const name = profile.name ?? 'worker'
  let artifact: ExecutorResult<unknown> | undefined
  const executor: Executor<unknown> = {
    runtime: 'inline',
    async execute() {
      artifact = {
        outRef: `w:${name}`,
        out: { built: name },
        verdict: { valid: true, score: 1 },
        spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
      }
      return artifact
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: () => {
      if (!artifact) throw new Error('leaf: resultArtifact before drain')
      return artifact
    },
  }
  return {
    name,
    act: async () => '',
    executorSpec: { profile, harness: null, executor } as AgentSpec,
  } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
}

/** What a competent model writes after reading `search`'s answer. */
const PROGRAM = `
  const parts = ['api-server', 'web-client']
  const ids = []
  for (const name of parts) {
    ids.push((await api.spawn_worker({ profile: { name }, task: 'build the ' + name })).workerId)
  }
  const settled = new Set()
  while (settled.size < ids.length) {
    const waiting = ids.filter((id) => !settled.has(id))
    for (const id of (await api.await_settlement({ workerIds: waiting })).settled) settled.add(id)
  }
  console.log('all', settled.size, 'workers settled')
  const statuses = []
  for (const workerId of ids) statuses.push((await api.observe_agent({ workerId })).status)
  return { built: parts, statuses }
`

export async function main(): Promise<void> {
  const journal = new InMemorySpawnJournal()
  const result = await superviseWithTestBrain(
    testAgentProfile('coordinator', {
      harness: 'cli-base',
      tools: runtimeToolDeclarations('spawn_worker', 'observe_agent', 'search', 'execute'),
    }),
    'build both halves of the service',
    {
      budget: { maxIterations: 30, maxTokens: 100_000 },
      journal,
      runId: 'code-mode-example',
      makeWorkerAgent: leafSeam,
      // The one line that turns a supervisor into a code-mode supervisor.
      // unsafeInProcessRunner is honest: this example TRUSTS its scripted brain. A real deployment
      // supplies a jailed runner for untrusted model output.
      resolveSupervisorTools: codeModeSupervisorTools(unsafeInProcessRunner()),
      brain: scriptedBrain([
        { toolCalls: [{ name: 'search', arguments: { query: 'spawn' } }] },
        { toolCalls: [{ name: 'execute', arguments: { code: PROGRAM } }] },
        { content: 'done' },
      ]),
    },
  )

  console.log(`\ncode-mode → ${result.kind}`)
  const events = (await journal.loadTree('code-mode-example')) ?? []
  const children = events.filter(
    (event) =>
      (event.kind === 'spawned' || event.kind === 'settled') && event.id !== 'code-mode-example',
  )
  console.log('  model turns: 3 (search, execute, done) — the tool-calling shape costs 6+')
  console.log('  kernel journal, child records (the proof the program did not bypass anything):')
  for (const event of children) {
    const label = event.kind === 'spawned' ? (event as { label: string }).label : ''
    console.log(`    ${event.kind} ${event.id} ${label}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
