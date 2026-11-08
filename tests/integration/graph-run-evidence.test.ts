// `runEvidence` over a directory `superviseGraphPursuit` wrote; `setGraphStrings` over each prompt shape.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { parse } from 'yaml'
import { runEvidence, superviseGraphPursuit } from '../../src/durable'
import type { MakeWorkerAgent } from '../../src/mcp/tools/coordination-contracts'
import { readGraphStrings, setGraphStrings } from '../../src/runtime'
import type { UsageEvent } from '../../src/runtime/supervise/types'
import { flowPipelineGraph } from '../helpers/durability/flow-conformance-graph'

const RED = '\x1b[31m'
const leaf: MakeWorkerAgent = (profile, context) => {
  const from = (context?.task as { from?: { result: { text: string } } } | undefined)?.from
  const out = {
    text: 'draft',
    notes: 'n'.repeat(1_000),
    ...(from && { published: from.result.text }),
  }
  const cmd = (n: number) => `${RED}step ${n} ${'a'.repeat(400)}`
  const p = (progress: unknown) => ({ kind: 'progress', progress }) as UsageEvent
  const execute = async function* () {
    yield p({ kind: 'text_delta', text: 'before tools' })
    for (const n of [1, 2, 3, 4]) {
      yield p({ kind: 'tool_call', toolName: `Bash${n}`, args: { command: cmd(n) } })
      yield p({ kind: 'tool_result', toolName: `Bash${n}`, status: 'ok' })
    }
    yield p({ kind: 'text_delta', text: `${RED}Done\x1b[0m ${'m'.repeat(2_000)}` })
    yield { kind: 'tokens', input: 50, output: 7 } as UsageEvent
  }
  const spent = { iterations: 1, tokens: { input: 50, output: 7 }, usd: 0, ms: 0 }
  const artifact = { outRef: 'x', out, verdict: { valid: true, score: 1 }, spent }
  const teardown = async () => ({ destroyed: true })
  const executor = { runtime: 'test', execute, teardown, resultArtifact: () => artifact }
  const executorSpec = { profile, harness: null, executor }
  return { name: profile.name, act: async () => undefined, executorSpec } as never
}

describe('runEvidence', () => {
  it('bounds each node of a written run, strips ANSI and caps the serialized result', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-evidence-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    const perWorker = { maxIterations: 10, maxTokens: 100_000 }
    const run = { pursuitId: 'e', runId: 'e', runDir: dir, workerSlots: 1, perWorker }
    await superviseGraphPursuit(flowPipelineGraph(), { ...run, makeLeafAgent: leaf })
    const evidence = await runEvidence(dir)
    expect(JSON.stringify(evidence)).not.toContain('\\u001b')
    const outcomes = evidence.nodes.map((node) => `${node.node}:${node.outcome}`)
    expect(outcomes).toEqual(['draft:done', 'edit:done', 'publish:done'])
    for (const node of evidence.nodes) {
      expect(node.toolCalls.map((call) => call.name)).toEqual(['Bash2', 'Bash3', 'Bash4'])
      expect(node.toolCalls[0]?.args).toMatch(/^\{"command":"step 2 a{130}…$/)
      expect(node.message).toMatch(/^Done m{794}…$/)
      expect(node.settled!.length).toBeLessThanOrEqual(600)
      expect(node.tokens).toMatchObject({ input: 50, output: 7 })
    }
    expect(evidence.truncated).toBe(true)
    const narrow = await runEvidence(dir, { toolCalls: 1, toolCallChars: 20, messageChars: 10 })
    expect(narrow.nodes[0]?.toolCalls).toEqual([{ name: 'Bash4', args: '{"command":"step 4 …' }])
    expect(narrow.nodes[0]?.message).toBe('Done mmmm…')
    for (const totalChars of [2_000, 400, 10]) {
      const capped = await runEvidence(dir, { totalChars })
      expect(capped.truncated).toBe(true)
      expect(JSON.stringify(capped).length).toBeLessThanOrEqual(Math.max(totalChars, 30))
    }
  })
})

const GRAPH = `nodes:
  - id: flow
    profile: { prompt: { systemPrompt: "it's \\"quoted\\"" }, name: flow }
  - id: folded
    profile:
      prompt:
        systemPrompt: >-
          folded line one
          folded line two
      name: folded
  - id: literal
    profile:
      prompt:
        systemPrompt: |
          literal line
            indented
      name: literal
  - id: append
    profile: { prompt: { appendSystemPrompt: plain words }, name: append }
  - id: anchor
    profile: { prompt: { systemPrompt: &shared shared words }, name: anchor }
  - id: alias
    profile: { prompt: { systemPrompt: *shared }, name: alias }
`
const masked = (text: string) => JSON.stringify(parse(text), (k, v) => (/Prompt$/.test(k) ? '' : v))

describe('setGraphStrings', () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal `${…}` is the hostile part.
  const hostile = 'He said "stop": ${params.x}\nnext: line\n  - not a list # nor a comment \\ end'

  it('rewrites flow, >-, | and appendSystemPrompt strings and nothing else', () => {
    const before = readGraphStrings(GRAPH)
    expect(Object.keys(before)).toEqual(['flow', 'folded', 'literal', 'append'])
    const map = Object.fromEntries(Object.keys(before).map((id) => [id, `${hostile} ${id}`]))
    const next = setGraphStrings(GRAPH, map)
    expect(readGraphStrings(next)).toEqual(map)
    expect(masked(next)).toEqual(masked(GRAPH))
    expect(next.split('\n').filter((line) => !GRAPH.includes(line))).toHaveLength(4)
    const one = setGraphStrings(GRAPH, { literal: hostile })
    expect(readGraphStrings(one)).toEqual({ ...before, literal: hostile })
  })

  it('refuses an anchored or aliased prompt and a node with no prompt', () => {
    expect(() => setGraphStrings(GRAPH, { anchor: 'x' })).toThrow(/unshared/)
    expect(() => setGraphStrings(GRAPH, { alias: 'x' })).toThrow(/unshared/)
    expect(() => setGraphStrings(GRAPH, { nobody: 'x' })).toThrow(/of its own/)
  })
})
