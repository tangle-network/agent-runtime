import { describe, expect, it } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../../src/durable/in-memory-spawn-stores'
import type { WorkerSpawnContext } from '../../src/mcp/tools/coordination-contracts'
import type { CoordinationEvent } from '../../src/mcp/tools/coordination-events'
import { serveCoordinationMcpForManager } from '../../src/runtime/supervise/coordination-mcp'
import { createInbox } from '../../src/runtime/supervise/inbox'
import type { PeerMailEvent, PeerMailLimits } from '../../src/runtime/supervise/peer-mail'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  Scope,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { testAgentProfile } from './test-agent-profile'

// ── shared helpers ────────────────────────────────────────────────────────────

async function jsonRpc(
  url: string,
  method: string,
  params: unknown,
): Promise<{ result?: unknown; error?: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return (await response.json()) as { result?: unknown; error?: unknown }
}

/** Call one tool on a peer-mail capability endpoint and return its structured reply. */
async function callMail(
  url: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const reply = await jsonRpc(url, 'tools/call', { name, arguments: args })
  const result = reply.result as { structuredContent?: Record<string, unknown> } | undefined
  if (!result?.structuredContent) {
    throw new Error(
      `peer-mail call ${name} returned no structured content: ${JSON.stringify(reply)}`,
    )
  }
  return result.structuredContent
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${label}`)
}

/** What one scripted worker is handed while it runs. */
interface WorkerRun {
  readonly name: string
  /** The capability endpoint this exact worker was minted, out of band on its spawn context. */
  readonly mailUrl: string | undefined
  /** Wait for at least one message, then drain and fold it exactly as a real backend turn does. */
  readonly foldNext: () => Promise<string>
}

/** A real leaf with a real `createInbox`, so a delivered envelope travels the production parse and
 *  render path rather than a test double of it. */
function scriptedWorker(
  name: string,
  context: WorkerSpawnContext | undefined,
  run: (worker: WorkerRun) => Promise<unknown>,
): Agent<unknown, unknown> {
  const inbox = createInbox()
  let out: unknown
  const executor: Executor<unknown> = {
    runtime: 'router',
    deliver: (message: unknown) => inbox.deliver(message),
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        out = await run({
          name,
          mailUrl: context?.peerMailUrl,
          foldNext: async () => {
            await waitFor(() => inbox.pending() > 0, `${name} to receive mail`)
            return inbox.fold(inbox.take().messages)
          },
        })
        yield { kind: 'tokens', input: 1, output: 1 } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `w:${name}`,
      out,
      verdict: { valid: true, score: 1 },
      spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor }
  return { name, act: async () => out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

interface PeerRunOutcome {
  readonly mail: ReadonlyArray<PeerMailEvent>
  readonly events: ReadonlyArray<CoordinationEvent>
  readonly workerIds: ReadonlyArray<string>
}

/**
 * Run two scripted siblings under a real supervisor with a real coordination MCP and a real
 * peer-mail listener, spawning both over HTTP exactly as an in-box driver would.
 */
async function runTwoSiblings(
  scripts: Record<string, (worker: WorkerRun) => Promise<unknown>>,
  limits?: Partial<PeerMailLimits>,
): Promise<PeerRunOutcome> {
  const blobs = new InMemoryResultBlobStore()
  const events: CoordinationEvent[] = []
  let outcome: PeerRunOutcome | undefined

  const driver: Agent<unknown, unknown> = {
    name: 'mail-driver',
    async act(_task, scope: Scope<unknown>) {
      const { handle: mcp, controls } = await serveCoordinationMcpForManager({
        scope,
        blobs,
        makeWorkerAgent: (profile, context) => {
          const name = profile.name ?? 'worker'
          const script = scripts[name]
          if (!script) throw new Error(`no script for worker ${name}`)
          return scriptedWorker(name, context, script)
        },
        perWorker: { maxIterations: 4, maxTokens: 1000 },
        toolNames: ['spawn_worker'],
        peerMail: limits ? { limits } : true,
        onEvent: (event) => {
          events.push(event)
        },
      })
      try {
        const workerIds: string[] = []
        for (const name of Object.keys(scripts)) {
          const spawned = await jsonRpc(mcp.url, 'tools/call', {
            name: 'spawn_worker',
            arguments: { profile: { name }, task: `run ${name}`, label: name },
          })
          const structured = (
            spawned.result as { structuredContent?: { workerId?: string; error?: string } }
          )?.structuredContent
          if (typeof structured?.workerId !== 'string') {
            throw new Error(`spawn of ${name} failed: ${JSON.stringify(spawned)}`)
          }
          workerIds.push(structured.workerId)
        }
        // Wake until nothing is open, so every worker's script has finished before we read the log.
        const wakeInput = {
          signal: new AbortController().signal,
          heartbeatMs: 60_000,
          debounceMs: 0,
        }
        while (await controls.awaitWake(wakeInput)) {}
        await mcp.drainResolved()
        outcome = { mail: mcp.mailHistory(), events: [...events], workerIds }
        return undefined
      } finally {
        await mcp.close()
      }
    },
  }

  await createSupervisor<unknown, unknown>().run(driver, 'peer mail', {
    budget: { maxIterations: 100, maxTokens: 100_000 },
    runId: 'peer-mail',
    journal: new InMemorySpawnJournal(),
    blobs,
    executors: createExecutorRegistry(),
    maxDepth: 4,
  })

  if (!outcome) throw new Error('the driver never completed')
  return outcome
}

// ── end-to-end: a peer message reaching a live sibling over the real transport ─

describe('peer mail end-to-end (HTTP capability → mailbox → Scope.send → sibling inbox)', () => {
  it('delivers a sibling message and renders it as PEER, never as SUPERVISOR', async () => {
    let foldedByReceiver = ''
    let senderReply: Record<string, unknown> = {}
    let seenPeers: unknown

    const outcome = await runTwoSiblings({
      // Spawned first, so it is live when the sender looks for peers.
      receiver: async (worker) => {
        foldedByReceiver = await worker.foldNext()
        return 'received'
      },
      sender: async (worker) => {
        if (!worker.mailUrl) throw new Error('sender was minted no peer-mail capability')
        const readout = (await callMail(worker.mailUrl, 'read_mail')) as {
          peers?: Array<{ workerId: string; label: string }>
          you?: string
        }
        seenPeers = readout.peers
        const target = readout.peers?.find((peer) => peer.label === 'receiver')
        if (!target) throw new Error(`no live receiver in peers: ${JSON.stringify(readout.peers)}`)
        senderReply = await callMail(worker.mailUrl, 'send_mail', {
          to: target.workerId,
          subject: 'wcwidth benchmark',
          body: 'measured 41ms on the jailed path, n=30',
          evidenceRefs: ['blob:bench-run-7'],
        })
        return 'sent'
      },
    })

    // The transport really carried it.
    expect(senderReply).toMatchObject({ delivered: true })
    expect(seenPeers).toEqual([expect.objectContaining({ label: 'receiver' })])

    // The receiver's own render: attributed to the peer, fenced, and free of any authority header.
    expect(foldedByReceiver).toContain('[PEER MAIL]')
    expect(foldedByReceiver).not.toContain('[SUPERVISOR]')
    expect(foldedByReceiver).toMatch(/<peer-mail nonce="[0-9a-f]{16}">/)
    expect(foldedByReceiver).toContain('measured 41ms on the jailed path, n=30')
    expect(foldedByReceiver).toContain('evidence: blob:bench-run-7')
    // The sender is named on the line, and it is the concrete worker id — never a caller-chosen one.
    const senderId = outcome.workerIds[1]
    expect(foldedByReceiver).toContain(`from=${senderId}`)

    // The parent audited it without relaying it.
    const delivered = outcome.mail.filter((event) => event.delivered)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.envelope).toMatchObject({
      from: senderId,
      to: outcome.workerIds[0],
      depth: 0,
    })
    expect(outcome.events.filter((event) => event.type === 'mail')).toHaveLength(1)
  })

  it('refuses past the send quota with a reason the sender can read', async () => {
    const replies: Array<Record<string, unknown>> = []

    await runTwoSiblings(
      {
        receiver: async (worker) => {
          await worker.foldNext()
          return 'received'
        },
        sender: async (worker) => {
          if (!worker.mailUrl) throw new Error('sender was minted no peer-mail capability')
          const readout = (await callMail(worker.mailUrl, 'read_mail')) as {
            peers?: Array<{ workerId: string; label: string }>
          }
          const target = readout.peers?.find((peer) => peer.label === 'receiver')
          if (!target) throw new Error('no live receiver')
          for (let attempt = 0; attempt < 2; attempt += 1) {
            replies.push(
              await callMail(worker.mailUrl, 'send_mail', {
                to: target.workerId,
                subject: `attempt ${attempt}`,
                body: 'a result worth sharing',
              }),
            )
          }
          return 'sent'
        },
      },
      { maxSentPerWorker: 1 },
    )

    expect(replies[0]).toMatchObject({ delivered: true })
    expect(replies[1]).toEqual({ delivered: false, outcome: 'send-quota-exhausted' })
  })

  it('breaks a ping-pong at the reply-depth cap', async () => {
    const replies: Array<Record<string, unknown>> = []
    let openerMailId = ''

    await runTwoSiblings(
      {
        // Answers once, which is depth 1 and still inside the cap.
        responder: async (worker) => {
          if (!worker.mailUrl) throw new Error('responder was minted no peer-mail capability')
          const folded = await worker.foldNext()
          const mailId = /mailId=(\S+)/.exec(folded)?.[1]
          if (!mailId) throw new Error(`no mailId in fold: ${folded}`)
          const readout = (await callMail(worker.mailUrl, 'read_mail')) as {
            inbox?: Array<{ from: string }>
          }
          const from = readout.inbox?.[0]?.from
          if (!from) throw new Error('responder received no envelope')
          replies.push(
            await callMail(worker.mailUrl, 'send_mail', {
              to: from,
              subject: 're: which build',
              body: 'the 0.135.3 build',
              replyTo: mailId,
            }),
          )
          return 'answered'
        },
        opener: async (worker) => {
          if (!worker.mailUrl) throw new Error('opener was minted no peer-mail capability')
          const readout = (await callMail(worker.mailUrl, 'read_mail')) as {
            peers?: Array<{ workerId: string; label: string }>
          }
          const target = readout.peers?.find((peer) => peer.label === 'responder')
          if (!target) throw new Error('no live responder')
          const opened = await callMail(worker.mailUrl, 'send_mail', {
            to: target.workerId,
            subject: 'which build',
            body: 'which build did you measure?',
          })
          openerMailId = String(opened.mailId)
          // Wait for the answer, then try to keep the thread going one hop too far.
          const folded = await worker.foldNext()
          const answerId = /mailId=(\S+)/.exec(folded)?.[1]
          if (!answerId) throw new Error(`no mailId in fold: ${folded}`)
          replies.push(
            await callMail(worker.mailUrl, 'send_mail', {
              to: target.workerId,
              subject: 're: re: which build',
              body: 'thanks, and one more thing',
              replyTo: answerId,
            }),
          )
          return 'done'
        },
      },
      { maxThreadDepth: 1 },
    )

    expect(openerMailId).not.toEqual('')
    // depth 1 lands; depth 2 is refused, so the exchange terminates instead of ping-ponging.
    expect(replies[0]).toMatchObject({ delivered: true })
    expect(replies[1]).toEqual({ delivered: false, outcome: 'thread-depth-exceeded' })
  })

  it('fails cleanly on a mail addressed to a worker that does not exist', async () => {
    let reply: Record<string, unknown> = {}

    const outcome = await runTwoSiblings({
      receiver: async (worker) => {
        await worker.foldNext()
        return 'received'
      },
      sender: async (worker) => {
        if (!worker.mailUrl) throw new Error('sender was minted no peer-mail capability')
        reply = await callMail(worker.mailUrl, 'send_mail', {
          to: 'root:s99',
          subject: 'are you there',
          body: 'anyone home?',
        })
        // Unblock the receiver so the run can finish.
        const readout = (await callMail(worker.mailUrl, 'read_mail')) as {
          peers?: Array<{ workerId: string; label: string }>
        }
        const target = readout.peers?.find((peer) => peer.label === 'receiver')
        if (!target) throw new Error('no live receiver')
        await callMail(worker.mailUrl, 'send_mail', {
          to: target.workerId,
          subject: 'ping',
          body: 'ping',
        })
        return 'sent'
      },
    })

    // No throw, a typed outcome, and the refusal is on the parent's audit trail.
    expect(reply).toEqual({ delivered: false, outcome: 'unknown-worker' })
    expect(outcome.mail.map((event) => event.outcome)).toEqual(['unknown-worker', 'delivered'])
  })
})
