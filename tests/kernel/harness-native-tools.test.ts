import { describe, expect, it } from 'vitest'
import {
  collidesWithHarnessNativeTool,
  harnessNativeToolNames,
  harnessNativeTools,
  sourcedHarnesses,
} from '../../src/mcp/harness-native-tools'
import { createMemoryToolServer } from '../../src/mcp/memory-server'
import { createMcpServer } from '../../src/mcp/server'
import { coordinationVerbNames, createCoordinationTools } from '../../src/mcp/tools/coordination'
import type { Agent, ResultBlobStore, Scope, Spend } from '../../src/runtime'
import {
  codeModeSupervisorTools,
  unsafeInProcessRunner,
} from '../../src/runtime/supervise/code-mode'
import {
  createPeerMailbox,
  peerMailTools,
  peerMailVerbNames,
} from '../../src/runtime/supervise/peer-mail'
import type { SupervisorNodeContext } from '../../src/runtime/supervise/supervisor-agent'

const zeroSpend = (): Spend => ({ iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 })

const blobs: ResultBlobStore = { get: async () => undefined, put: async () => {} }
const makeWorkerAgent = (): Agent<unknown, unknown> => ({ name: 'w', act: async () => 0 })

function stubScope(): Scope<unknown> {
  return {
    spawn: () => ({
      ok: true as const,
      handle: { id: 'w0', label: 'w', status: 'running' as const, abort() {} },
    }),
    next: async () => null,
    send: () => false,
    get view() {
      return { root: 'root', nodes: [], inFlight: 0 }
    },
    budget: { tokensLeft: 10, usdLeft: 0, deadlineMs: 0, reservedTokens: 0 },
    signal: new AbortController().signal,
    spent: zeroSpend(),
  } as unknown as Scope<unknown>
}

/** Every tool the coordination MCP can publish, read off the toolbox it actually builds. Every
 *  conditional family is switched on (`deliverable` mounts `submit_result`, `analysts` mounts the
 *  analyst pair, and an `analysts.register` mounts `define_analyst`) so no published name can hide
 *  from the sweep behind an unset option. */
function coordinationToolNames(): ReadonlyArray<string> {
  return createCoordinationTools({
    scope: stubScope(),
    blobs,
    makeWorkerAgent,
    perWorker: { maxIterations: 1, maxTokens: 10 },
    deliverable: { describe: 'anything', check: () => true },
    analysts: {
      kinds: [{ id: 'completeness', description: 'unfinished work', area: 'failure-mode' }],
      run: async () => [{ claim: 'x' }],
      register: (definition) => ({
        id: definition.id,
        description: definition.description,
        area: definition.area,
      }),
    },
  }).tools.map((tool) => tool.name)
}

/** The tools one peer-mail capability endpoint serves. */
function peerMailToolNames(): ReadonlyArray<string> {
  const mailbox = createPeerMailbox({ scope: stubScope(), publish: async () => {} })
  return peerMailTools(mailbox, 'capability-under-test').map((tool) => tool.name)
}

/** The delegation MCP server's tools, with both optional delegates wired so the conditional
 *  `delegate` and `delegate_ui_audit` mount. Neither handler runs: the server only needs each
 *  delegate to be present to decide whether to publish its tool. */
function delegationServerToolNames(): ReadonlyArray<string> {
  const server = createMcpServer({
    delegateSupervisor: {
      router: { kind: 'router', baseUrl: 'http://127.0.0.1:1', apiKey: 'k' },
      supervisorProfile: { name: 'lead' },
      backend: { backend: 'router' },
    },
    uiAuditorDelegate: async () => {
      throw new Error('the ui-audit delegate is never invoked by this sweep')
    },
  })
  return [...server.tools.keys()]
}

/** The memory MCP server's tools. It refuses to serve an empty memory, so it gets one row. */
function memoryServerToolNames(): ReadonlyArray<string> {
  const server = createMemoryToolServer({
    items: [{ id: 'm1', text: 'a lesson from a prior run' }],
  })
  return [...server.tools.keys()]
}

/** Code mode's two tools, read off the resolver `codeModeSupervisorTools` returns. */
async function codeModeToolNames(): Promise<ReadonlyArray<string>> {
  const resolve = codeModeSupervisorTools(unsafeInProcessRunner())
  const tools = await resolve({} as SupervisorNodeContext)
  return tools.map((tool) => tool.name)
}

/**
 * Every tool name this package publishes to a model, gathered from the real builders rather than
 * a hand-copied list. A name added to any of these surfaces enters the sweep on its own.
 */
async function publishedSurfaces(): Promise<ReadonlyArray<[string, ReadonlyArray<string>]>> {
  return [
    ['coordination MCP', coordinationToolNames()],
    ['peer mail', peerMailToolNames()],
    ['delegation MCP server', delegationServerToolNames()],
    ['memory MCP server', memoryServerToolNames()],
    ['code mode', await codeModeToolNames()],
  ]
}

describe('harness-native tool collisions', () => {
  it('the registry is populated and records the codex spawn verb', () => {
    expect(sourcedHarnesses.length).toBeGreaterThan(0)
    for (const harness of sourcedHarnesses) {
      expect(harnessNativeTools[harness].length).toBeGreaterThan(0)
    }
    // codex publishes `spawn_agent` natively, so no MCP server of ours may publish that word.
    // The sweep below is only meaningful while the registry carries it.
    expect(collidesWithHarnessNativeTool('spawn_agent')).toContain('codex')
    expect(harnessNativeToolNames('codex')).toContain('spawn_agent')
  })

  it('reports no sourced list for a harness nobody has checked', () => {
    // Absent is not empty: a caller must be able to tell "publishes nothing" from "not sourced".
    expect(harnessNativeToolNames('gemini')).toBeUndefined()
  })

  it('the coordination sweep sees every reserved verb', () => {
    // The reserved set and the built toolbox must agree, or a verb could escape the sweep.
    expect([...coordinationToolNames()].sort()).toEqual([...coordinationVerbNames].sort())
    expect([...peerMailToolNames()].sort()).toEqual([...peerMailVerbNames].sort())
  })

  it('every published tool name is clear of every harness-native tool', async () => {
    const surfaces = await publishedSurfaces()
    // A surface that built no tools would pass the sweep by having nothing in it.
    for (const [surface, names] of surfaces) {
      expect(names.length, `${surface} published no tools`).toBeGreaterThan(0)
    }

    const collisions = surfaces.flatMap(([surface, names]) =>
      names.flatMap((name) =>
        collidesWithHarnessNativeTool(name).map((harness) => ({ surface, name, harness })),
      ),
    )
    expect(
      collisions,
      collisions
        .map(
          ({ surface, name, harness }) =>
            `The ${surface} publishes "${name}", which the ${harness} harness also publishes ` +
            `natively. A prompt or profile that names the bare word "${name}" reaches the ` +
            "harness's own tool, so the runtime's tool is never called: the work it starts gets " +
            'no journal row, no reservation from the conserved budget pool, and no grade. Rename ' +
            'the runtime tool to a word no harness publishes.',
        )
        .join('\n'),
    ).toEqual([])
  })
})
