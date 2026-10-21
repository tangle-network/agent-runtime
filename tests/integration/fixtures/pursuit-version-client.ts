/** Public composition shared by the initial run and fresh-process closed replay.
 * The loopback protocol peer is deterministic; Runtime, Eval, disk and Node are real.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  assertSearchHistoryMatchesState,
  createSearchHistoryReceipt,
  openSearchLedger,
} from '@tangle-network/agent-eval/campaign'
import {
  type AgentProfile,
  type AgentProfileDiff,
  applyAgentProfileDiff,
  canonicalAgentProfileDigest,
  sha256Bytes,
} from '@tangle-network/agent-interface'
import { supervisePursuit, type VersionJudge } from '../../../src/durable/index'
import type {
  DeliverableSpec,
  ResolveSupervisorTools,
  SupervisorNodeContext,
} from '../../../src/runtime/index'

export const runId = 'run:versions-http'
export const model = 'versions-protocol-model'
const firstVersionSystemPrompt = 'VERSION_ONE: write evidence, then submit its exact manifest.'
export const profile: AgentProfile = {
  name: 'versions-http',
  harness: 'cli-base',
  model: { provider: 'tangle-router', default: model },
  prompt: { systemPrompt: firstVersionSystemPrompt },
  tools: {
    agent_runtime_coordination_submit_result: true,
    agent_runtime_coordination_write_evidence: true,
  },
}
export const change: AgentProfileDiff = {
  kind: 'agent-profile-diff',
  id: 'prompt:version-two',
  set: {
    prompt: {
      systemPrompt: `${firstVersionSystemPrompt}\n\nVERSION_TWO: improve the evidence to version two.`,
    },
  },
}
const task = 'Write evidence in your own run directory and submit the read-back manifest.'
const budget = { maxIterations: 8, maxTokens: 20_000, maxUsd: 1, deadlineMs: 20_000 }
const stop = { maxVersions: 2, patience: 2, minImprovement: 0, maxUsd: 3, deadlineMs: 30_000 }
const execute = promisify(execFile)

interface Manifest {
  runId: string
  nodeId: string
  profileDigest: string
  path: string
  sha256: string
}

/** Excludes only Runtime/Eval's ephemeral lock and mutation guard paths. */
export async function committedTree(dir: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {}
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(join(dir, relative), { withFileTypes: true })) {
      if (/^(supervise\.lock(?:\.guard)?|.*\.run\.lock(?:\.guard)?)$/.test(entry.name)) continue
      const name = join(relative, entry.name)
      if (entry.isDirectory()) await visit(name)
      else {
        assert(entry.isFile(), `unexpected non-file: ${name}`)
        entries[name] = sha256Bytes(await readFile(join(dir, name)))
      }
    }
  }
  await visit('')
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)))
}

function checkedManifest(raw: unknown): Manifest {
  assert(raw && typeof raw === 'object' && !Array.isArray(raw))
  const value = raw as Record<string, unknown>
  assert.deepEqual(Object.keys(value).sort(), [
    'nodeId',
    'path',
    'profileDigest',
    'runId',
    'sha256',
  ])
  for (const member of Object.values(value)) assert.equal(typeof member, 'string')
  return value as unknown as Manifest
}

/** Actual judge subprocess: independently reads the sealed result and artifact bytes.
 * This shares the host user, so it makes no OS isolation or hosted-model claim.
 */
const judgeProgram = `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const [dir, runId, seal, artifactPath, profileDigest] = process.argv.slice(1);
const hash = bytes => 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(require('node:path').join(dir, 'result.json'));
assert.equal(hash(bytes), seal);
const result = JSON.parse(bytes);
assert.equal(result.kind, 'winner');
const manifest = result.out;
assert.equal(manifest.runId, runId);
assert.equal(manifest.path, artifactPath);
assert.equal(manifest.profileDigest, profileDigest);
assert.equal(typeof manifest.nodeId, 'string');
const artifact = fs.readFileSync(artifactPath);
assert.equal(hash(artifact), manifest.sha256);
const content = artifact.toString('utf8');
assert(['version one\\n', 'version two\\n'].includes(content));
process.stdout.write(JSON.stringify({ score: content === 'version two\\n' ? 2 : 1,
  pid: process.pid, seal, artifactHash: hash(artifact), artifactPath }));
`

export async function runCase(root: string, routerBaseUrl: string) {
  const baseDir = join(root, 'version')
  const allowed = new Map([
    [runId, { dir: baseDir, profileDigest: canonicalAgentProfileDigest(profile) }],
    [
      `${runId}.v2`,
      {
        dir: `${baseDir}.v2`,
        profileDigest: canonicalAgentProfileDigest(applyAgentProfileDiff(profile, change)),
      },
    ],
  ])
  const audit = (event: unknown) =>
    appendFile(join(root, 'operations.jsonl'), `${JSON.stringify(event)}\n`)
  let current: { context: SupervisorNodeContext; manifest?: Manifest } | undefined
  const resolveSupervisorTools: ResolveSupervisorTools = (context) => {
    const target = allowed.get(context.runId)
    assert(target, `unknown runId: ${context.runId}`)
    assert.equal(context.depth, 0)
    assert.equal(context.identity.profileDigest, target.profileDigest)
    const bound = { context, manifest: undefined as Manifest | undefined }
    current = bound
    return [
      {
        name: 'write_evidence',
        description: 'Write evidence to this exact run directory and return its measured manifest.',
        inputSchema: {
          type: 'object',
          properties: { content: { type: 'string' } },
          required: ['content'],
          additionalProperties: false,
        },
        async handler(raw, invocation) {
          assert.equal(invocation.runId, context.runId)
          assert(raw && typeof raw === 'object' && !Array.isArray(raw))
          const args = raw as Record<string, unknown>
          assert.deepEqual(Object.keys(args), ['content'])
          assert.equal(typeof args.content, 'string')
          const path = join(target.dir, 'evidence.txt')
          await writeFile(path, args.content as string, { flag: 'wx' })
          bound.manifest = {
            runId: context.runId,
            nodeId: context.nodeId,
            profileDigest: target.profileDigest,
            path,
            sha256: sha256Bytes(await readFile(path)),
          }
          await audit({ kind: 'write', ...bound.manifest })
          return bound.manifest
        },
      },
    ]
  }
  const deliverable: DeliverableSpec = {
    describe: 'The exact manifest returned after writing and reading this run’s evidence file.',
    async check(out) {
      const manifest = checkedManifest(out)
      assert(current?.manifest)
      assert.equal(current.context.runId, manifest.runId)
      assert.deepEqual(manifest, current.manifest)
      assert.equal(sha256Bytes(await readFile(manifest.path)), manifest.sha256)
      await audit({ kind: 'check', runId: manifest.runId })
      return true
    },
  }
  const judge: VersionJudge = {
    digest: sha256Bytes(Buffer.from(judgeProgram)),
    async judge(version, signal) {
      const target = allowed.get(version.runId)
      assert(target)
      assert.equal(resolve(version.runDir), target.dir)
      assert.equal(canonicalAgentProfileDigest(version.profile), target.profileDigest)
      const { stdout } = await execute(
        process.execPath,
        [
          '-e',
          judgeProgram,
          version.runDir,
          version.runId,
          version.settleDigest,
          join(target.dir, 'evidence.txt'),
          target.profileDigest,
        ],
        { signal, timeout: 3_000, killSignal: 'SIGKILL', maxBuffer: 64_000 },
      )
      const detail = JSON.parse(stdout) as { score: number; pid: number }
      assert.notEqual(detail.pid, process.pid)
      await audit({ kind: 'judge', runId: version.runId, ...detail })
      if (version.version === 1) {
        await writeFile(
          join(root, 'parent-at-first-judge.json'),
          JSON.stringify(await committedTree(baseDir)),
        )
      }
      return { score: detail.score, judgeDigest: judge.digest, detail }
    },
  }
  const result = await supervisePursuit(profile, task, {
    pursuitId: 'pursuit:versions-http',
    runId,
    runDir: baseDir,
    budget,
    router: { routerBaseUrl, routerKey: 'local-protocol' },
    backend: { backend: 'router', routerBaseUrl, routerKey: 'local-protocol' },
    resolveSupervisorTools,
    deliverable,
    maxTurns: 3,
    versions: {
      judge,
      stop,
      async next() {
        await audit({ kind: 'next', id: change.id })
        return change
      },
    },
  })
  assert(result.versions)
  assert.equal(result.result.kind, 'winner')
  const state = await openSearchLedger({
    path: result.versions.ledgerPath,
    searchId: result.versions.searchId,
  }).state()
  assertSearchHistoryMatchesState(result.versions.receipt, state)
  assert.deepEqual(
    createSearchHistoryReceipt({
      producerId: result.versions.receipt.producerId,
      runId: result.versions.receipt.runId,
      ledger: { path: result.versions.ledgerPath, searchId: result.versions.searchId },
    }),
    result.versions.receipt,
  )
  const nodes = state.nodes()
  const cells = nodes.map((node) => state.cells({ nodeId: node.nodeId }).length)
  return {
    result: result.result,
    chain: result.versions,
    nodeCount: nodes.length,
    cells,
    processId: process.pid,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, url, mode] = process.argv.slice(2)
  assert(root && url && mode)
  runCase(root, url).then(
    async (summary) => {
      await writeFile(join(root, `${mode}.json`), JSON.stringify(summary))
    },
    (error) => {
      console.error(error)
      process.exitCode = 1
    },
  )
}
