/**
 * Supervisor + coordinator MCP — workers on sandbox OR cli-bridge, ONE code path.
 *
 * A real coding-harness agent (opencode via the cli-bridge) IS the supervisor: it mounts the
 * coordination MCP (`serveCoordinationMcp`) over a LIVE `Scope` and calls the REAL `spawn_worker`
 * tool natively — a box driving boxes, not an emulated function-tool. Each spawned worker is a
 * leaf whose executor is `createExecutor({ backend })`, gated on a DEPLOYABLE check (a worker
 * writes `ANSWER=42` to a file; the check reads the file — no LLM judge).
 *
 * THE ONE KNOB — `WORKER_BACKEND`:
 * The worker executor is `createExecutor({ backend: process.env.WORKER_BACKEND ?? 'bridge', ...seam })`.
 * Flip `WORKER_BACKEND=sandbox` and the SAME supervisor + SAME coordination MCP + SAME `spawn_worker`
 * flow + SAME deployable check spawn workers in a cloud box instead of behind the local cli-bridge —
 * with zero other changes. The worker backend is the ONLY variable; everything else is identical.
 *
 * Run it (cli-bridge workers — the proven local path):
 *   cd ~/code/cli-bridge && pnpm start          # → http://127.0.0.1:3344
 *   pnpm build                                   # examples resolve @tangle-network/agent-runtime from dist/
 *   WORKER_BACKEND=bridge WORKER_MODEL=opencode/zai-coding-plan/glm-5.1 \
 *     pnpm dlx tsx examples/supervisor-loop/run-supervisor-mcp.ts
 *
 * Same code, sandbox workers (needs a real SandboxClient — key + base URL):
 *   WORKER_BACKEND=sandbox SANDBOX_BASE_URL=https://... TANGLE_API_KEY=sk-... \
 *     pnpm dlx tsx examples/supervisor-loop/run-supervisor-mcp.ts
 *
 * The supervisor BRAIN is fixed (not a variable): a real cli-bridge harness agent with the
 * coordination MCP mounted, exactly like bench/src/atom-mcp-e2e.mts. The bridge fronts full
 * agents that do their own native tool-use, so the supervisor calls `spawn_worker` through its
 * OWN harness tool-loop — that is what makes this the real MCP path, not a scripted driver.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type Agent,
  type AgentProfile,
  type AgentSpec,
  createExecutor,
  createExecutorRegistry,
  createSupervisor,
  type Executor,
  type ExecutorConfig,
  type ExecutorContext,
  gateOnDeliverable,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  type Scope,
  serveCoordinationMcp,
} from '@tangle-network/agent-runtime/loops'

// ── The deployable goal + check (no LLM judge) ──────────────────────────────────
// Every worker is asked to write the exact line `ANSWER=42` to its own output file.
// The check reads that file off disk and confirms the line landed — a real artifact,
// not the model's say-so. The same check decides DELIVERED on every backend.
const expectedAnswer = 'ANSWER=42'

/** A per-run scratch dir; each worker writes to `<dir>/worker-<n>.txt`. */
const runDir = mkdtempSync(join(tmpdir(), 'super-mcp-'))

/** The file path a worker numbered `n` must write — embedded in its task so the
 *  harness writes to a known absolute path regardless of its own cwd. */
function workerOutputPath(n: number): string {
  return join(runDir, `worker-${n}.txt`)
}

/** The deployable oracle: the worker's output file exists and contains `ANSWER=42`. */
function fileDelivered(path: string): boolean {
  try {
    return readFileSync(path, 'utf8').includes(expectedAnswer)
  } catch {
    return false // fail-closed: no file = not delivered
  }
}

// ── The worker leaf — the ONLY thing the backend knob changes ────────────────────

/**
 * Build the worker-leaf `ExecutorConfig` for the chosen backend. THIS is the swap seam:
 * the `backend` field, plus the matching per-backend seam fields. Nothing downstream cares
 * which one it is — `createExecutor` injects the seam and returns a uniform `Executor`.
 */
function workerBackend(): ExecutorConfig {
  const backend = process.env.WORKER_BACKEND ?? 'bridge'
  if (backend === 'sandbox') {
    // The sandbox seam is wired but only RUN when a real SandboxClient is supplied. The
    // example proves the bridge path; flipping WORKER_BACKEND=sandbox routes the SAME
    // spawn_worker through createExecutor({backend:'sandbox'}) with zero other changes.
    throw new Error(
      'WORKER_BACKEND=sandbox needs a real SandboxClient (key + base URL). Construct it from\n' +
        '  @tangle-network/sandbox and return { backend: "sandbox", sandboxClient } here — the\n' +
        '  supervisor, MCP, spawn_worker, and the deployable check are identical to the bridge path.\n' +
        'Run the proven path: WORKER_BACKEND=bridge WORKER_MODEL=opencode/zai-coding-plan/glm-5.1',
    )
  }
  if (backend !== 'bridge') {
    throw new Error(`WORKER_BACKEND must be "bridge" or "sandbox" (got ${JSON.stringify(backend)})`)
  }
  const model = process.env.WORKER_MODEL
  if (!model) {
    throw new Error(
      'WORKER_BACKEND=bridge needs WORKER_MODEL=<harness>/<model> the bridge can serve,\n' +
        '  e.g. WORKER_MODEL=opencode/zai-coding-plan/glm-5.1\n' +
        'Start the bridge first: cd ~/code/cli-bridge && pnpm start  (→ http://127.0.0.1:3344)',
    )
  }
  return {
    backend: 'bridge',
    bridgeUrl: process.env.BRIDGE_URL ?? 'http://127.0.0.1:3344',
    bridgeBearer: process.env.BRIDGE_BEARER ?? 'local',
    model,
    timeoutMs: 180_000,
  }
}

/**
 * Resolve whatever the supervisor authored in `spawn_worker` to a worker `Agent`. The leaf's
 * executor is `createExecutor({ backend })` (the single code path), gated on the deployable
 * file check. The authored `profile.systemPrompt` rides onto the leaf's `AgentProfile` so the
 * backend folds it into its prompt the same way it would in production.
 */
function makeWorker(
  rawProfile: unknown,
  backend: ExecutorConfig,
  counter: { n: number },
): Agent<unknown, unknown> {
  const p = (rawProfile ?? {}) as { name?: unknown; systemPrompt?: unknown }
  const n = counter.n++
  const name = typeof p.name === 'string' && p.name.length > 0 ? p.name : `worker-${n}`
  const authored = typeof p.systemPrompt === 'string' ? p.systemPrompt : ''
  const outPath = workerOutputPath(n)

  // The worker's standing instruction: do the authored work AND write the artifact the check
  // reads. The deployable goal is the same on every backend, so it lives here, not in the seam.
  const systemPrompt =
    `${authored}\n\nWrite the exact text "${expectedAnswer}" (and nothing else) to the file at the ` +
    `absolute path ${outPath}. Use your file-writing tool. Do it now.`

  const profile: AgentProfile = { name, prompt: { systemPrompt } } as AgentProfile
  // harness:null — the BYO executor below overrides harness-based resolution entirely.
  const spec: AgentSpec = { profile, harness: null }

  // The ONE code path: build the leaf from the chosen backend, then gate its settle on the
  // deployable check. createExecutor injects its own seam; the construction ctx only needs an
  // abort signal (the real per-child abort is the one the scope passes to execute()).
  const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
  const leaf: Executor<unknown> = createExecutor(backend)(spec, ctx)
  const gated = gateOnDeliverable(leaf, {
    check: () => fileDelivered(outPath),
    describe: `worker writes ${expectedAnswer} to ${outPath}`,
  })

  return {
    name,
    // A spawned worker runs THROUGH its executor (scope.spawn → executorSpec.executor.execute),
    // never as a root act().
    act: async () => '',
    executorSpec: { ...spec, executor: gated },
  } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
}

// ── The supervisor: a real cli-bridge harness agent calling spawn_worker via the MCP ──

/** The supervisor's standing instructions — it delegates, it does not solve. */
const supervisorTask =
  `A worker must produce the exact line "${expectedAnswer}".\n\n` +
  'You are a SUPERVISOR with a "coordination" MCP exposing spawn_worker, await_event, and stop. ' +
  'Do NOT write the answer yourself. Author a worker profile (a JSON object with a "name" and a ' +
  'rich "systemPrompt") and call spawn_worker with { profile, task }. Then call await_event to ' +
  'wait for it to settle, and call stop once a worker has delivered (valid:true).'

/** One real bridge harness turn, with the coordination MCP mounted so the supervisor can call
 *  spawn_worker as a NATIVE tool. Same shape as bench/src/atom-mcp-e2e.mts's bridgeChat. */
async function supervisorBridgeChat(opts: { mcpUrl: string }): Promise<string> {
  const bridgeUrl = process.env.BRIDGE_URL ?? 'http://127.0.0.1:3344'
  const bridgeBearer = process.env.BRIDGE_BEARER ?? 'local'
  const model = process.env.SUPERVISOR_MODEL ?? process.env.WORKER_MODEL
  if (!model) throw new Error('supervisor needs SUPERVISOR_MODEL or WORKER_MODEL set')
  const res = await fetch(`${bridgeUrl.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bridgeBearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: supervisorTask }],
      // Mount the coordination MCP — the supervisor harness calls spawn_worker through it.
      mcp: { mcpServers: { coordination: { type: 'http', url: opts.mcpUrl } } },
    }),
  })
  if (!res.ok)
    throw new Error(`supervisor bridge ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return j.choices?.[0]?.message?.content ?? ''
}

async function main(): Promise<void> {
  const backend = workerBackend()
  const blobs = new InMemoryResultBlobStore()
  const counter = { n: 0 }

  console.log(
    `supervisor + coordination MCP · workers via createExecutor({ backend: "${backend.backend}" })` +
      `${backend.backend === 'bridge' ? ` (model=${(backend as { model: string }).model})` : ''}`,
  )

  // The supervisor agent: inside its act() we stand up the coordination MCP over the LIVE scope,
  // then hand the harness a tool it can call. This is the keystone — the harness IS the supervisor.
  const supervisor: Agent<unknown, unknown> = {
    name: 'supervisor',
    async act(_task, scope: Scope<unknown>) {
      const mcp = await serveCoordinationMcp({
        scope,
        blobs,
        // Every spawn_worker call lands here and builds a createExecutor({ backend }) leaf.
        makeWorkerAgent: (raw) => makeWorker(raw, backend, counter),
        perWorker: { maxIterations: 2, maxTokens: 200_000 },
      })
      try {
        console.log(`[mcp] coordination server at ${mcp.url}`)
        const said = await supervisorBridgeChat({ mcpUrl: mcp.url })
        console.log(`\n── supervisor said ──\n${said.slice(0, 800)}`)

        const settled = mcp.settled()
        const delivered = settled.filter((w) => w.status === 'done' && w.valid === true)
        console.log(
          `\n[mcp] spawn_worker calls observed: ${settled.length}; delivered (check passed): ${delivered.length}`,
        )
        console.log(
          `[mcp] bus events: ${mcp.history().length}; stats: ${JSON.stringify(mcp.stats())}`,
        )
        return delivered[0]?.outRef ? await blobs.get(delivered[0].outRef) : undefined
      } finally {
        await mcp.close()
      }
    },
  }

  const result = await createSupervisor<unknown, unknown>().run(supervisor, supervisorTask, {
    budget: { maxIterations: 100, maxTokens: 2_000_000, maxUsd: 1 },
    runId: 'supervisor-mcp',
    journal: new InMemorySpawnJournal(),
    blobs,
    executors: createExecutorRegistry(),
    maxDepth: 4,
    now: () => Date.now(),
  })

  console.log('\n── verdict ──')
  if (result.kind === 'winner') {
    console.log(
      `✅ supervisor drove a worker via the coordination MCP to a CHECKED delivery on backend "${backend.backend}".`,
    )
    console.log(`   winner output: ${JSON.stringify(result.out)}`)
  } else {
    console.log(`❌ no delivery (result=${result.kind}) — see supervisor transcript above`)
    process.exitCode = 1
  }
  rmSync(runDir, { recursive: true, force: true })
}

main().catch((e) => {
  rmSync(runDir, { recursive: true, force: true })
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
