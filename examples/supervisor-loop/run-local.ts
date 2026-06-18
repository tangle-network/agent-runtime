/**
 * THE HEADLINE "test it locally" path — runs at $0 with NO infra and NO creds.
 *
 *   pnpm tsx examples/supervisor-loop/run-local.ts
 *   LOOP_BACKEND=cli pnpm tsx examples/supervisor-loop/run-local.ts   # the same thing
 *
 * The REAL `coordinationDriverAgent` brain drives the loop — we just inject the two seams
 * it abstracts so nothing needs the network:
 *   - the driver-LLM seam (`DriverChat`) is SCRIPTED — a fixed sequence of tool-call turns,
 *     the same offline seam the driver's own unit tests use. The brain still REASONS the
 *     loop (spawn → await → stop) against a live `Scope`; only the inference is mocked.
 *   - the worker leaf comes from `createExecutor({ backend: 'cli', ... })` — a real local
 *     subprocess (a tiny `node` solver), graded by a real deployable check. No box, no key.
 *
 * Flip `LOOP_BACKEND` to `router-tools` / `sandbox` / `bridge` to run the IDENTICAL
 * supervisor over a real backend (see `run-router.ts` / `run-sandbox.ts` / `run-bridge.ts`).
 */

import type {
  DriverChat,
  DriverMessage,
  DriverTurn,
  ExecutorConfig,
} from '@tangle-network/agent-runtime/loops'
import { reportResult, runSupervisorLoop, type SupervisorTask } from './loop'

// The goal: each worker must emit a line `ANSWER=<x>` solving its slice. The deployable
// check (the completion oracle) confirms the worker's stdout actually carries it.
const EXPECTED = 'ANSWER=42'

const task: SupervisorTask = {
  goal: `Produce the line "${EXPECTED}".`,
  check: (out) => {
    const content =
      out && typeof out === 'object' && 'content' in out
        ? String((out as { content: unknown }).content)
        : String(out)
    return content.includes(EXPECTED)
  },
}

// The local worker backend: a real subprocess. This `node` solver reads the task prompt on
// stdin and prints the answer line — a genuine (if trivial) "worker that does the work",
// gated by `task.check`. Swapping the backend tag is the only change other runners make.
const cliBackend: ExecutorConfig = {
  backend: 'cli',
  bin: process.execPath, // the running node binary — always present
  args: [
    '-e',
    // Read stdin (the task prompt), then emit the solution. A real worker would compute;
    // this one demonstrates the subprocess round-trip + the checked settle at $0.
    `let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{process.stdout.write('worked on: '+s.slice(0,40)+'\\n${EXPECTED}\\n')})`,
  ],
}

/**
 * A scripted driver-LLM: spawn THREE workers (the "drive N workers" shape), await each
 * settlement, then stop. This is the exact `DriverChat` contract `routerDriverChat` fills
 * in production — here it returns a fixed turn sequence so the brain runs offline.
 */
function scriptedChat(workerCount: number): DriverChat {
  const turns: DriverTurn[] = []
  // One spawn_worker turn per worker — the supervisor authors a small profile for each.
  for (let i = 0; i < workerCount; i += 1) {
    turns.push({
      content: `delegating slice ${i}`,
      toolCalls: [
        {
          name: 'spawn_worker',
          arguments: {
            profile: { name: `solver-${i}`, systemPrompt: `Solve slice ${i}.` },
            task: `Emit ${EXPECTED} for slice ${i}.`,
            label: `solver-${i}`,
          },
        },
      ],
    })
  }
  // Await each settlement (one await_event per spawned worker), then stop (no tool calls).
  for (let i = 0; i < workerCount; i += 1) {
    turns.push({
      content: 'awaiting a worker',
      toolCalls: [{ name: 'await_event', arguments: {} }],
    })
  }
  turns.push({ content: 'all workers delivered — stopping' })

  let i = 0
  return {
    next: (input: { messages: ReadonlyArray<DriverMessage> }) => {
      // A real DriverChat reads `input.messages` (the folded tool results) to decide; the
      // scripted one just advances its fixed plan. We touch `input` so the shape is exercised.
      void input.messages.length
      const turn = turns[Math.min(i, turns.length - 1)] ?? {}
      i += 1
      return Promise.resolve(turn)
    },
  }
}

async function main(): Promise<void> {
  const backendTag = process.env.LOOP_BACKEND ?? 'cli'
  if (backendTag !== 'cli') {
    console.error(
      `run-local is the no-creds path (backend 'cli'); LOOP_BACKEND=${backendTag} needs its own runner (run-${backendTag}.ts).`,
    )
    process.exit(1)
  }
  console.log('supervisor-loop · LOCAL · backend=cli · scripted driver · $0, no creds, no infra')

  const result = await runSupervisorLoop({
    task,
    backend: cliBackend,
    chat: scriptedChat(3),
    systemPrompt:
      'You are a supervisor. Decompose the goal into slices, spawn one worker per slice, ' +
      'await each, and stop once a worker has delivered (valid).',
    perWorker: { maxIterations: 1, maxTokens: 10_000 },
    budget: { maxIterations: 100, maxTokens: 1_000_000 },
    runId: 'supervisor-loop-local',
  })

  reportResult(result, 'cli')
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
