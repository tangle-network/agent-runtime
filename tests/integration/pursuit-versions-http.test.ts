/** Real public versions composition: local HTTP protocol, disk, Eval ledger and Node judge.
 * The peer supplies a fixed conversation; this does not measure hosted model quality.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyAgentProfileDiff,
  canonicalAgentProfileDigest,
  sha256Bytes,
} from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import {
  change,
  committedTree,
  model,
  profile,
  type runCase,
  runId,
} from './fixtures/pursuit-version-client'

type Summary = Awaited<ReturnType<typeof runCase>>
interface Message {
  role: string
  content?: unknown
  tool_call_id?: string
}

/** A new process reloads the exact composition and URL. Killing its process group also
 * cleans up an in-flight judge if the bounded child ever fails to terminate normally.
 */
async function child(root: string, url: string, mode: string) {
  const entry = fileURLToPath(new URL('./fixtures/pursuit-version-client.ts', import.meta.url))
  const proc = spawn(process.execPath, ['--import', 'tsx', entry, root, url, mode], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  for (const stream of [proc.stdout, proc.stderr]) {
    stream.on('data', (bytes: Buffer) => {
      if (output.length < 64_000) output += bytes.toString('utf8')
    })
  }
  const killGroup = () => {
    if (!proc.pid) return
    try {
      process.kill(-proc.pid, 'SIGKILL')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  const timer = setTimeout(killGroup, 35_000)
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      proc.once('error', reject)
      proc.once('close', resolve)
    })
    return { code, output }
  } finally {
    clearTimeout(timer)
    killGroup()
  }
}

it('forks two judged versions, replays a closed chain without compute, and rejects a changed seal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pursuit-versions-http-'))
  const peerErrors: unknown[] = []
  const requests: Array<{ version: number; tool: string }> = []
  const server = createServer((request, response) => {
    void (async () => {
      assert.equal(request.method, 'POST')
      assert.equal(request.url, '/v1/chat/completions')
      let raw = ''
      for await (const bytes of request) {
        raw += bytes.toString()
        assert(raw.length < 1_000_000)
      }
      const body = JSON.parse(raw) as {
        model: string
        messages: Message[]
        tools: Array<{ function: { name: string } }>
      }
      assert.equal(body.model, model)
      const version = JSON.stringify(body.messages).includes('VERSION_TWO') ? 2 : 1
      const evidenceCall = `evidence-${version}`
      const measured = body.messages.find(
        (message) => message.role === 'tool' && message.tool_call_id === evidenceCall,
      )
      const tool = measured ? 'submit_result' : 'write_evidence'
      assert(body.tools.some((entry) => entry.function.name === tool))
      assert(requests.length < 4, 'unexpected extra inference request')
      requests.push({ version, tool })
      // Submission uses the actual result of the filesystem tool, never a fixture-made path/hash.
      const args = measured
        ? { result: JSON.parse(String(measured.content)) }
        : { content: version === 1 ? 'version one\n' : 'version two\n' }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          model,
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: measured ? `submit-${version}` : evidenceCall,
                    type: 'function',
                    function: { name: tool, arguments: JSON.stringify(args) },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 5, cost_usd: 0 },
        }),
      )
    })().catch((error) => {
      peerErrors.push(error)
      response.writeHead(400).end(String(error))
    })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    const first = await child(root, url, 'initial')
    expect(first, first.output).toMatchObject({ code: 0 })
    expect(peerErrors).toEqual([])
    expect(requests).toEqual([
      { version: 1, tool: 'write_evidence' },
      { version: 1, tool: 'submit_result' },
      { version: 2, tool: 'write_evidence' },
      { version: 2, tool: 'submit_result' },
    ])
    const initial = JSON.parse(await readFile(join(root, 'initial.json'), 'utf8')) as Summary
    expect(initial.chain).toMatchObject({ reason: 'max-nodes', best: 2 })
    expect(initial.nodeCount).toBe(2)
    expect(initial.cells).toEqual([1, 1])
    expect(initial.chain.versions.map((version) => version.verdict.score)).toEqual([1, 2])
    expect(initial.chain.receipt.complete).toBe(true)
    const [v1, v2] = initial.chain.versions
    assert(v1 && v2)
    expect(v1.profile).toEqual(profile)
    expect(v2.profile).toEqual(applyAgentProfileDiff(profile, change))
    expect(v2.change).toEqual(change)
    expect(v2.parent).toEqual({ version: 1, runId, settleDigest: v1.settleDigest })
    expect(v2.result.execution?.correlation).toMatchObject({
      forkParentRunId: runId,
      forkParentSettleDigest: v1.settleDigest,
      forkProfileDiffId: change.id,
      lineageRootRunId: runId,
    })
    for (const version of [v1, v2]) {
      expect(version.result.kind).toBe('winner')
      assert(version.result.kind === 'winner')
      expect(version.result.out).toMatchObject({
        runId: version.runId,
        path: join(version.runDir, 'evidence.txt'),
        profileDigest: canonicalAgentProfileDigest(version.profile),
        sha256: sha256Bytes(await readFile(join(version.runDir, 'evidence.txt'))),
      })
      expect(sha256Bytes(await readFile(join(version.runDir, 'result.json')))).toBe(
        version.settleDigest,
      )
    }
    expect(await committedTree(v1.runDir)).toEqual(
      JSON.parse(await readFile(join(root, 'parent-at-first-judge.json'), 'utf8')),
    )
    const operations = await readFile(join(root, 'operations.jsonl'), 'utf8')
    const events = operations
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(events.filter((event) => event.kind === 'judge')).toHaveLength(2)
    expect(events.filter((event) => event.kind === 'next')).toHaveLength(1)
    expect(events.filter((event) => event.kind === 'write')).toHaveLength(2)
    expect(
      new Set(events.filter((event) => event.kind === 'judge').map((event) => event.pid)).size,
    ).toBe(2)
    const snapshot = async () => ({
      parent: await committedTree(v1.runDir),
      child: await committedTree(v2.runDir),
      search: await committedTree(`${v1.runDir}.search`),
    })
    const before = await snapshot()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    const replay = await child(root, url, 'replay')
    expect(replay, replay.output).toMatchObject({ code: 0 })
    const reread = JSON.parse(await readFile(join(root, 'replay.json'), 'utf8')) as Summary
    expect(reread.processId).not.toBe(initial.processId)
    expect(reread.chain).toEqual(initial.chain)
    expect(reread.result).toEqual(initial.result)
    expect(await snapshot()).toEqual(before)
    expect(await readFile(join(root, 'operations.jsonl'), 'utf8')).toBe(operations)
    // Valid JSON, different sealed bytes: the fresh public replay must actively detect tampering.
    await appendFile(join(v2.runDir, 'result.json'), '\n')
    const tampered = await snapshot()
    const rejected = await child(root, url, 'tamper')
    expect(rejected.code).not.toBe(0)
    expect(rejected.output).toContain('result.json changed after it was judged')
    expect(await snapshot()).toEqual(tampered)
    expect(await readFile(join(root, 'operations.jsonl'), 'utf8')).toBe(operations)
    expect(requests).toHaveLength(4)
  } finally {
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
}, 110_000)
