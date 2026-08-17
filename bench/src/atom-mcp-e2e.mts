/**
 * THE WHOLE REAL THING, end to end. No mock, no stub.
 *
 * An opencode SUPERVISOR (via the cli-bridge) mounts the coordination MCP over a live Scope and
 * carries the real `supervise` SKILL.md (a file in its cwd's skill dir — loaded natively by the
 * harness, not stapled into a prompt). It authors a worker profile and calls spawn_worker.
 * Each WORKER is an opencode coding session in its OWN cwd that edits files and is graded by a
 * REAL test it must pass (the deployable check = `valid`). The supervisor settles only on a
 * delivered worker. Real models (bridge non-Claude), real check, real driver↔worker transcripts.
 *
 *   ROUTER_BASE=http://127.0.0.1:3355/v1 TANGLE_API_KEY=<bridge-bearer> \
 *   WORKER_MODEL=opencode/zai-coding-plan/glm-5-turbo npx tsx bench/src/atom-mcp-e2e.mts
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Agent,
  type AgentProfile,
  type AgentSpec,
  collectAgentTurn,
  contentAddress,
  createExecutor,
  createExecutorRegistry,
  createSupervisor,
  type Executor,
  type ExecutorResult,
  gitWorkspace,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  runInWorkspace,
  type Scope,
  streamAgentTurn,
  type Workspace,
} from '../../src/runtime/index'
import { asAuthoredProfile } from '../../src/runtime/supervise/authoring'
import { serveCoordinationMcp } from '../../src/runtime/supervise/coordination-mcp'

const BRIDGE = (process.env.ROUTER_BASE ?? 'http://127.0.0.1:3355/v1').replace(/\/$/, '')
const BEARER = process.env.TANGLE_API_KEY ?? ''
const MODEL = process.env.WORKER_MODEL ?? 'opencode/zai-coding-plan/glm-5-turbo'
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKILL_MD = readFileSync(join(REPO, 'skills', 'supervise', 'SKILL.md'), 'utf8')

const TASK = 'In solution.py, implement add(a, b) so it returns the sum a + b and test_solution.py passes.'

/** Seed a bare git repo with the failing task — the SHARED workspace ref every worker clones. */
function seedWorkspaceRepo(): string {
  const git = (args: string[], cwd?: string): void => {
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd,
      stdio: 'pipe',
    })
  }
  const bare = `${mkdtempSync(join(tmpdir(), 'e2e-ws-'))}.git`
  git(['init', '--bare', '-b', 'main', bare])
  const seed = mkdtempSync(join(tmpdir(), 'e2e-seed-'))
  git(['clone', bare, seed])
  writeFileSync(join(seed, 'solution.py'), 'def add(a, b):\n    raise NotImplementedError\n')
  writeFileSync(
    join(seed, 'test_solution.py'),
    'from solution import add\nassert add(2, 3) == 5\nassert add(-1, 1) == 0\nassert add(0, 0) == 0\nprint("PASS")\n',
  )
  git(['add', '-A'], seed)
  git(['commit', '-m', 'task'], seed)
  git(['push', 'origin', 'main'], seed)
  rmSync(seed, { recursive: true, force: true })
  return bare
}

/** The deployable check: run the test in the worker's cwd. Exit 0 = delivered. No LLM judge. */
function checkPasses(cwd: string): boolean {
  try {
    execFileSync('python3', ['test_solution.py'], { cwd, stdio: 'pipe', timeout: 30_000 })
    return true
  } catch {
    return false
  }
}

async function bridgeChat(opts: {
  messages: Array<{ role: string; content: string }>
  cwd?: string
  mcpUrl?: string
}): Promise<string> {
  if (!BEARER) throw new Error('TANGLE_API_KEY is required')
  const profile: AgentProfile = {
    name: opts.mcpUrl ? 'atom-mcp-supervisor-turn' : 'atom-mcp-worker-turn',
    model: { default: MODEL },
    ...(opts.mcpUrl
      ? { mcp: { coordination: { transport: 'http', url: opts.mcpUrl } } }
      : {}),
  }
  const factory = createExecutor({
    backend: 'bridge',
    bridgeUrl: BRIDGE.replace(/\/v1$/u, ''),
    bridgeBearer: BEARER,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  })
  const turn = await collectAgentTurn(
    streamAgentTurn(
      { kind: 'executor', factory, profile },
      { prompt: opts.messages.map((message) => message.content).join('\n\n') },
    ),
  )
  if (turn.status !== 'completed') {
    throw new Error(turn.error?.message ?? `bridge turn ended with ${turn.status}`)
  }
  return turn.finalText
}

const transcripts: Array<{ who: string; said: string; delivered?: boolean }> = []

/** A WORKER = a real opencode coding session in a clone of the SHARED workspace, graded by the
 *  real test; its delivery is committed back so the next worker builds on it (not isolated). */
function makeWorker(rawProfile: unknown, ws: Workspace, n: number): Agent<unknown, unknown> {
  const p = asAuthoredProfile(rawProfile)
  const name = p?.name ?? `worker-${n}`
  let artifact: ExecutorResult<unknown> | undefined
  const inner: Executor<unknown> = {
    runtime: 'router',
    async execute() {
      const sys = p?.prompt.systemPrompt ?? TASK
      const run = await runInWorkspace(
        ws,
        async (cwd) => {
          const said = await bridgeChat({
            messages: [
              {
                role: 'user',
                content: `${sys}\n\nYou are working in the current directory (it already holds prior workers' committed progress). Edit the files so that running \`python3 test_solution.py\` prints PASS. Do it now.`,
              },
            ],
            cwd,
          })
          const valid = checkPasses(cwd)
          transcripts.push({ who: name, said: said.slice(0, 300), delivered: valid })
          return { valid, value: said.slice(0, 120), message: `${name}: ${valid ? 'delivered' : 'wip'}` }
        },
        { tmpPrefix: 'e2e-worker-', commitOnInvalid: true },
      )
      const delivered = run.valid
      artifact = {
        outRef: contentAddress(`${name}:${delivered}`),
        out: { worker: name, delivered, rev: run.commit?.ok ? run.commit.rev : undefined, profileSystemPrompt: sys.slice(0, 120) },
        verdict: { valid: delivered, score: delivered ? 1 : 0 },
        spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
      }
      return artifact
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: () => {
      if (!artifact) throw new Error('worker resultArtifact before execute')
      return artifact
    },
  }
  const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor: inner }
  return { name, act: async () => '', executorSpec: spec } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
}

async function main(): Promise<void> {
  console.log(`atom-mcp-e2e: model=${MODEL}  (real boxes, real MCP, real test, shared workspace)`)
  const bareRef = seedWorkspaceRepo()
  const ws = gitWorkspace({ ref: bareRef })
  const blobs = new InMemoryResultBlobStore()
  let n = 0

  const root: Agent<unknown, unknown> = {
    name: 'supervisor',
    async act(_t, scope: Scope<unknown>) {
      const mcp = await serveCoordinationMcp({
        scope,
        blobs,
        makeWorkerAgent: (raw) => makeWorker(raw, ws, n++),
        perWorker: { maxIterations: 2, maxTokens: 200_000 },
      })
      // The supervisor's cwd carries the REAL skill file (opencode loads it from the cwd skill dirs).
      const supCwd = mkdtempSync(join(tmpdir(), 'e2e-sup-'))
      for (const d of ['.opencode/skills/supervise', '.claude/skills/supervise']) {
        mkdirSync(join(supCwd, d), { recursive: true })
        writeFileSync(join(supCwd, d, 'SKILL.md'), SKILL_MD)
      }
      try {
        console.error(`[e2e] coordination MCP at ${mcp.url}; supervisor cwd=${supCwd}`)
        const said = await bridgeChat({
          messages: [
            {
              role: 'user',
              content: `${TASK}\n\nYou are a SUPERVISOR. You have the "supervise" skill and a "coordination" MCP with tools spawn_worker, await_event, stop. Do NOT write code yourself. Author a worker profile (a JSON object with name + a rich systemPrompt telling the worker exactly what to implement) and call spawn_worker with it, then await_event, and stop once a worker delivered (valid:true).`,
            },
          ],
          cwd: supCwd,
          mcpUrl: mcp.url,
        })
        transcripts.push({ who: 'supervisor', said: said.slice(0, 400) })
        const settled = mcp.settled()
        const delivered = settled.filter((w) => w.status === 'done' && w.valid === true)
        console.error(`[e2e] supervisor spawned ${settled.length} worker(s), ${delivered.length} delivered`)
        return delivered[0]?.outRef ? await blobs.get(delivered[0].outRef) : undefined
      } finally {
        await mcp.close()
        rmSync(supCwd, { recursive: true, force: true })
      }
    },
  }

  const result = await createSupervisor<unknown, unknown>().run(root, TASK, {
    budget: { maxIterations: 100, maxTokens: 2_000_000 },
    runId: 'e2e',
    journal: new InMemorySpawnJournal(),
    blobs,
    executors: createExecutorRegistry(),
    maxDepth: 4,
    now: () => Date.now(),
  })
  rmSync(bareRef, { recursive: true, force: true })

  console.log('\n── transcripts (real driver↔worker) ──')
  for (const t of transcripts) {
    console.log(`\n[${t.who}${t.delivered === undefined ? '' : t.delivered ? ' · DELIVERED' : ' · failed'}]`)
    console.log(`  ${t.said.replace(/\n/g, '\n  ')}`)
  }
  console.log('\n── verdict ──')
  console.log(
    result.kind === 'winner'
      ? `✅ REAL E2E DELIVERED — supervisor (via MCP + skill) drove an in-box worker that coded + passed the real test. out=${JSON.stringify(result.out)}`
      : `❌ no delivery (result=${result.kind}) — see transcripts above`,
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
