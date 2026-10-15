import type { AgentProfile, ProxySecretBinding } from @tangle-network/agent-interface
import { describe, expect, it } from vitest
import { InMemorySpawnJournal } from ../../src/durable/spawn-journal
import { supervise, type SuperviseOptions } from ../../src/runtime/supervise/supervise
import type { Agent, AgentSpec, Executor, ExecutorResult } from ../../src/runtime/supervise/types
import { runtimeToolDeclarations, testAgentProfile } from ./test-agent-profile

const parentBinding: ProxySecretBinding = {
  envName: REPORTS_TOKEN,
  secretRef: { kind: secret-ref, key: reporting-api },
  hosts: [reports.example.com, archive.example.com],
  presentation: { type: bearer },
  methods: [GET, POST],
  paths: [/v1/events, /v1/archive],
  ttlSeconds: 300,
}
const childBinding: ProxySecretBinding = {
  ...parentBinding,
  hosts: [reports.example.com],
  methods: [POST],
  paths: [/v1/events],
  ttlSeconds: 120,
}

function profile(name: string, bindings?: ProxySecretBinding[], manager = false): AgentProfile {
  return testAgentProfile(name, {
    ...(bindings === undefined ? {} : { proxySecrets: bindings }),
    ...(manager ? { tools: runtimeToolDeclarations(spawn_worker, stop) } : {}),
  })
}

async function call(url: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(url, {
    method: POST,
    headers: { content-type: application/json },
    body: JSON.stringify({
      jsonrpc: 2.0, id: name, method: tools/call, params: { name, arguments: args },
    }),
  })
  return response.json()
}

/** A caller-owned execution port records the exact admitted profile; no model or sandbox is called. */
function leaf(authored: AgentProfile, seen: AgentProfile[]): Agent<unknown, unknown> {
  seen.push(authored)
  const result: ExecutorResult<unknown> = {
    outRef: `proxy-secret-test:${authored.name}`, out: { ok: true },
    verdict: { valid: true, score: 1 },
    spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
  }
  const executor: Executor<unknown> = {
    runtime: proxy-secret-test,
    execute: async () => result,
    teardown: async () => ({ destroyed: true }),
    resultArtifact: () => result,
  }
  const executorSpec: AgentSpec = { profile: authored, harness: null, executor }
  return { name: authored.name, act: async () => result.out, executorSpec } as Agent<unknown, unknown>
}

async function spawnOne(
  requested: AgentProfile,
  authorizeSpawn: SuperviseOptions[authorizeSpawn] | null = ({ profile: child }) => ({ profile: child }),
) {
  const seen: AgentProfile[] = []
  const journal = new InMemorySpawnJournal()
  const replies: unknown[] = []
  let turns = 0
  await supervise(profile(root, [parentBinding], true), delegate, {
    budget: { maxIterations: 20, maxTokens: 20_000 },
    perWorker: { maxIterations: 2, maxTokens: 1_000 },
    inheritSpawnRights: false,
    makeLeafAgent: (child) => leaf(child, seen),
    ...(authorizeSpawn ? { authorizeSpawn } : {}),
    journal, runId: proxy-descendant,
    driveHarness: async ({ coordinationMcpUrl }) => {
      if (turns++ === 0) replies.push(await call(coordinationMcpUrl, spawn_worker, {
        profile: requested, task: post events,
      }))
      else await call(coordinationMcpUrl, stop, {})
    },
  })
  return { seen, replies, events: await journal.loadTree(proxy-descendant) }
}

describe(public supervise proxy-secret descendant admission, () => {
  it(requires product authorization before admitting a child reference, async () => {
    const { seen, replies } = await spawnOne(profile(child, [childBinding]), null)
    expect(seen).toEqual([])
    expect(JSON.stringify(replies)).toContain(proxySecrets)
    expect(JSON.stringify(replies)).toContain(authorizeSpawn)
  })

  it.each([
    [host, { hosts: [attacker.example.com] }],
    [method, { methods: [DELETE] }],
    [omitted method, { methods: undefined }],
    [path, { paths: [/v1/admin] }],
    [omitted path, { paths: undefined }],
    [TTL, { ttlSeconds: 301 }],
    [omitted TTL, { ttlSeconds: undefined }],
    [secret identity, { secretRef: { kind: secret-ref, key: another-secret } }],
    [presentation, { presentation: { type: header, name: X-Api-Key } }],
  ] as const)(refuses widened %s before journal admission or execution, async (_field, change) => {
    const widened = { ...childBinding, ...change } as ProxySecretBinding
    const { seen, replies, events } = await spawnOne(profile(child, [widened]))
    expect(seen).toEqual([])
    expect(JSON.stringify(replies)).toContain(proxySecrets)
    expect(events?.filter((event) => event.kind === spawned)).toHaveLength(1)
  })

  it(checks the final profile returned by authorizeSpawn, async () => {
    const { seen, replies } = await spawnOne(profile(child, [childBinding]), ({ profile: child }) => ({
      profile: { ...child, proxySecrets: [{ ...childBinding, hosts: [attacker.example.com] }] },
    }))
    expect(seen).toEqual([])
    expect(JSON.stringify(replies)).toContain(proxySecrets)
  })

  it.each([undefined, []])(does not inherit parent bindings when child bindings are %j, async (bindings) => {
    const { seen } = await spawnOne(profile(child, bindings))
    expect(seen).toHaveLength(1)
    expect(seen[0]?.proxySecrets).toEqual(bindings)
  })

  it(executes explicit root-child-grandchild narrowing and refuses a grandchild widening, async () => {
    const seen: AgentProfile[] = []
    const journal = new InMemorySpawnJournal()
    const replies: unknown[] = []
    const turns = new Map<string, number>()
    const grandchild = profile(grandchild, [{ ...childBinding, ttlSeconds: 30 }])
    const authorizations: string[] = []
    await supervise(profile(root, [parentBinding], true), delegate recursively, {
      budget: { maxIterations: 40, maxTokens: 40_000 },
      perWorker: { maxIterations: 10, maxTokens: 10_000 },
      inheritSpawnRights: false,
      makeLeafAgent: (child) => leaf(child, seen),
      authorizeSpawn: (input) => {
        authorizations.push(`${input.parent.name}:${input.profile.name}`)
        return { profile: input.profile }
      },
      journal, runId: proxy-tree,
      driveHarness: async ({ profile: manager, coordinationMcpUrl }) => {
        const turn = turns.get(manager.name) ?? 0
        turns.set(manager.name, turn + 1)
        if (turn > 0) { await call(coordinationMcpUrl, stop, {}); return }
        if (manager.name === root) {
          await call(coordinationMcpUrl, spawn_worker, {
            profile: profile(child, [childBinding], true), task: delegate,
          })
        } else {
          replies.push(await call(coordinationMcpUrl, spawn_worker, {
            profile: profile(widened, [parentBinding]), task: must refuse,
          }))
          replies.push(await call(coordinationMcpUrl, spawn_worker, {
            profile: grandchild, task: post events,
          }))
        }
      },
    })
    expect(seen).toEqual([grandchild])
    expect(authorizations).toContain(root:child)
    expect(authorizations).toContain(child:grandchild)
    expect(JSON.stringify(replies[0])).toContain(proxySecrets)
    const serializedJournal = JSON.stringify(await journal.loadTree(proxy-tree))
    expect(serializedJournal).toContain(reporting-api)
    expect(serializedJournal).not.toContain(Authorization)
  })
})
