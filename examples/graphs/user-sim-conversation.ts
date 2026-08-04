/**
 * user-sim-conversation — a CONVERSATION as a graph (#721): a simulated user is a NODE, the
 * product agent is a chat-transport worker, and each dialogue turn is one ledgered traversal.
 *
 * The root ('user-sim') is a persona profile — an optimizable artifact, not harness code: its
 * driver brain plays the user, and each of its messages crosses the delegates edge as a spawn.
 * The edge declares `continuity: 'resume'`, so turn 1 spawns the product agent `fresh` and every
 * later turn RESUMES the same conversation: `chatWorkerSeam` (the session-owning executor seam
 * over `chatTransportExecutor`) loads the prior worker's recorded message list and the new turn
 * continues it — one growing OpenAI-shape message history, exactly like a chat session, while the
 * kernel keeps identity, ordering, the edge ledger, and one conserved spend pool.
 *
 * Fully offline: the driver brain is scripted, and the product agent runs the REAL
 * `chatTransportExecutor` through an injected scripted transport (zero network, $0) that captures
 * every wire request — the proof that the resumed history chain is what actually crossed the
 * transport. Run:  pnpm tsx examples/graphs/user-sim-conversation.ts
 */

import {
  type AgentGraph,
  chatWorkerSeam,
  promptHandle,
  type RunGraphOptions,
  runGraph,
  type WorkerSpawnContext,
} from '@tangle-network/agent-runtime/kernel'
import { offlineProfile, printLedger, scriptedBrain } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')

/** The product agent's scripted side of the dialogue, one reply per traversal. */
export const AGENT_REPLIES = [
  'Happy to help — do you want the Starter or the Pro plan?',
  'Pro is $49/user/month and includes SSO. Shall I place the order for 6 seats?',
  'ORDER-CONFIRMED: Pro plan, 6 seats with SSO — receipt #881.',
]

/** The simulated user's turns — the persona's half of the dialogue, driven by the root brain. */
export const USER_TURNS = [
  'Hi — I need a team plan with SSO for 6 people.',
  'Pro, if SSO is included. What does it cost?',
  'Yes — place the order.',
]

export function userSimConversation(): {
  graph: AgentGraph
  opts: RunGraphOptions
  /** Every OpenAI-shape request body the product agent's transport received, in order — the
   *  resumed message-history chain, captured at the wire. */
  requests: Array<Record<string, unknown>>
  /** Every spawn's kernel-authored context — the continuity/resume lineage the seam received. */
  contexts: Array<WorkerSpawnContext | undefined>
} {
  // ── The topology: a two-party conversation as plain data ──
  const graph: AgentGraph = {
    nodes: [
      {
        id: 'user-sim',
        profile: offlineProfile(
          'user-sim',
          'You are Ada, a busy founder buying a team plan. Terse. SSO is non-negotiable.',
        ),
      },
      {
        id: 'product-agent',
        profile: {
          name: 'product-agent',
          harness: 'cli-base',
          model: { provider: 'scripted', default: 'scripted/product-agent' },
          prompt: { systemPrompt: 'You are the product sales agent. Close honestly.' },
        },
      },
    ],
    edges: [
      {
        kind: 'delegates',
        from: 'user-sim',
        to: 'product-agent',
        directive: brief,
        maxTraversals: 3,
        continuity: 'resume',
      },
    ],
    deliverable: {
      describe: 'a confirmed order',
      check: (out) => typeof out === 'string' && out.includes('ORDER-CONFIRMED'),
    },
    budget: { maxIterations: 30, maxTokens: 100_000 },
  }

  // ── The seams: a scripted user brain, a REAL chat worker on a scripted transport ──
  const requests: Array<Record<string, unknown>> = []
  let replyIndex = 0
  const seam = chatWorkerSeam({
    url: 'http://offline.invalid',
    // The completion oracle: each turn's worker settles `valid` ⟺ the order confirmed, so the
    // keep-best finalizer crowns the confirming turn — same deliverable the graph declares.
    deliverable: graph.deliverable,
    // The injected transport IS the endpoint: capture the wire body, script the reply, meter
    // real usage fields (0.25 each — exact in binary — so spend continuity is assertable).
    complete: async (body) => {
      requests.push(structuredClone(body))
      const content = AGENT_REPLIES[Math.min(replyIndex, AGENT_REPLIES.length - 1)]
      replyIndex += 1
      return {
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 12, completion_tokens: 9, cost: 0.25 },
      }
    },
  })
  const contexts: Array<WorkerSpawnContext | undefined> = []
  const opts: RunGraphOptions = {
    runId: 'usim',
    makeWorkerAgent: (profile, context) => {
      contexts.push(context)
      return seam(profile, context)
    },
    brain: scriptedBrain([
      ...USER_TURNS.flatMap((turn) => [
        {
          toolCalls: [
            { name: 'spawn_agent', arguments: { profile: { name: 'product-agent' }, task: turn } },
          ],
        },
        { toolCalls: [{ name: 'await_event', arguments: {} }] },
      ]),
      { content: 'done' },
    ]),
  }
  return { graph, opts, requests, contexts }
}

export async function main(): Promise<void> {
  const { graph, opts, requests, contexts } = userSimConversation()
  const res = await runGraph(graph, opts)
  printLedger('user-sim-conversation', res)
  console.log('SPAWN CONTINUITY (what the executor seam received):')
  for (const context of contexts) {
    const lineage =
      context?.resume === undefined
        ? ''
        : ` resume.ofWorker=${context.resume.ofWorker} sequence=${context.resume.sequence}`
    console.log(`  ${context?.assignmentId}: ${context?.continuity ?? 'fresh'}${lineage}`)
  }
  console.log('MESSAGE-HISTORY CHAIN (messages per wire request):')
  for (const [i, req] of requests.entries()) {
    const messages = req.messages as Array<{ role: string }>
    console.log(
      `  turn ${i + 1}: ${messages.length} messages [${messages.map((m) => m.role).join(', ')}]`,
    )
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
