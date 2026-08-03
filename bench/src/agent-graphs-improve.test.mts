import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  baselineIsPublishable,
  buildAgentGraphsAuthorProfile,
  runAuthoredOffline,
} from './agent-graphs-improve.mts'

const here = dirname(fileURLToPath(import.meta.url))
const runner = join(here, 'agent-graphs-improve.mts')
const improvementRunner = join(here, 'agent-graphs-gen2.mts')

test('agent-graphs runner loads only its canonical working-tree inputs', () => {
  const source = readFileSync(runner, 'utf8')
  assert.doesNotMatch(source, /skills['"], ['"]codemode|codemode-/)
  for (const path of [runner, improvementRunner]) {
    const modelSource = readFileSync(path, 'utf8')
    assert.doesNotMatch(modelSource, /\bfetch\(|chat\/completions|max_tokens|AbortSignal\.timeout/)
  }
  const improvementSource = readFileSync(improvementRunner, 'utf8')
  assert.match(improvementSource, /buildAgentGraphsAuthorProfile/)
  assert.match(improvementSource, /dispatchWithSurface\(surface, scenario, AUTHOR_ENV\)/)
  assert.match(improvementSource, /callAuthor\(proposerProfile, prompt, PROPOSER_ENV\)/)

  const stdout = execFileSync(process.execPath, ['--import', 'tsx', runner], {
    cwd: join(here, '..'),
    encoding: 'utf8',
    env: { ...process.env, CASE: '__input-path-smoke__', SKILL_REF: undefined },
  })

  assert.match(stdout, /agent-graphs baseline: skill v1 \(.+source=working-tree\), 0 cases/)
  assert.match(stdout, /subset run \(CASE set\) — baseline artifact NOT written/)
})

test('agent-graphs author is a canonical, overridable Pi profile', () => {
  const baseline = buildAgentGraphsAuthorProfile('# Agent graphs\nUse the smallest correct form.\n', {})
  assert.equal(baseline.harness, 'pi')
  assert.deepEqual(baseline.model, {
    provider: 'tangle-router',
    default: 'deepseek-v4-flash',
    reasoningEffort: 'ultracode',
  })
  assert.match(baseline.prompt?.systemPrompt ?? '', /attached agent-graphs skill/)
  assert.match(baseline.prompt?.systemPrompt ?? '', /registered lens id or a graph node/)
  assert.doesNotMatch(baseline.prompt?.systemPrompt ?? '', /never node ids/)
  assert.deepEqual(baseline.resources?.skills, [
    {
      kind: 'inline',
      name: 'agent-graphs',
      content: '# Agent graphs\nUse the smallest correct form.\n',
    },
  ])

  const overridden = buildAgentGraphsAuthorProfile('custom', {
    AGENT_GRAPHS_AUTHOR_HARNESS: 'opencode',
    AGENT_GRAPHS_AUTHOR_PROVIDER: 'custom-provider',
    AGENT_GRAPHS_AUTHOR_MODEL: 'custom-model',
    AGENT_GRAPHS_AUTHOR_REASONING_EFFORT: 'low',
    AGENT_GRAPHS_AUTHOR_SYSTEM_PROMPT: 'custom system',
  })
  assert.equal(overridden.harness, 'opencode')
  assert.deepEqual(overridden.model, {
    provider: 'custom-provider',
    default: 'custom-model',
    reasoningEffort: 'low',
  })
  assert.equal(overridden.prompt?.systemPrompt, 'custom system')
})

test('offline scoring executes an analyst graph node through the real graph path', async () => {
  const result = await runAuthoredOffline(
    {
      nodes: [
        { id: 'driver', systemPrompt: 'Drive the work.' },
        { id: 'implementer', systemPrompt: 'Implement the change.' },
        { id: 'reviewer', systemPrompt: 'Review the trace.' },
      ],
      edges: [
        { kind: 'delegates', from: 'driver', to: 'implementer' },
        {
          kind: 'analyzes',
          analyst: 'reviewer',
          over: ['implementer'],
          to: 'driver',
        },
      ],
      budget: { maxIterations: 20, maxTokens: 200_000 },
      perWorker: { maxIterations: 4, maxTokens: 40_000 },
      deliverableDescribe: 'Implement the requested change and return the completed artifact.',
    },
    'agent-graphs-test-analyst-node',
  )

  assert.equal(result.resultKind, 'winner')
  assert.deepEqual(
    result.ledger.map((row) => [row.kind, row.outcome]),
    [
      ['delegates', 'delivered'],
      ['analyzes', 'delivered'],
    ],
  )
})

test('an incomplete full run cannot replace the canonical baseline', () => {
  assert.equal(baselineIsPublishable(undefined, [{}, {}]), true)
  assert.equal(baselineIsPublishable(undefined, [{}, { authorFailed: true }]), false)
  assert.equal(baselineIsPublishable('one-case', [{}]), false)
  assert.equal(baselineIsPublishable(undefined, []), false)
})
