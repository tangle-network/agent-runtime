import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentProfile,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { expect, it, onTestFinished } from 'vitest'
import { parse } from 'yaml'
import {
  loadGraphFile,
  readGraphProfile,
  setGraphProfile,
  setGraphStrings,
} from '../../src/runtime'

const SOURCE = `# Keep the authored graph and this comment.
graph: measured-profiles
params:
  iterations: { type: integer, default: 5 }
nodes:
  - id: build
    profile:
      harness: cli-base
      model: { provider: offline, default: offline/local-process }
      prompt: { systemPrompt: "Build the requested artifact." }
      tools: { Read: true, Bash: false }
  # The reviewer, deterministic check and policy are outside the candidate.
  - id: review
    profile: { harness: cli-base, model: { provider: offline, default: offline/local-process }, prompt: { systemPrompt: "Review independently." } }
  - id: verify
    check: { command: "printf 'verified\\n'", timeoutMs: 1000 }
entry: [build]
edges:
  - { kind: routes, from: build, to: review, directive: { surface: delegates/worker-brief, version: 1 } }
  - { kind: routes, from: review, to: verify, directive: { surface: delegates/worker-brief, version: 1 } }
budget: { maxIterations: "\${params.iterations}", maxTokens: 10000 }
check: { node: verify, pointer: /pass, equals: true }
on: [{ schedule: { cron: "0 * * * *" } }]
`

async function loader() {
  const dir = await mkdtemp(join(tmpdir(), 'graph-profile-source-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return (source: string, extension = 'yaml') =>
    loadGraphFile(join(dir, `candidate.${extension}`), { source })
}

it('loads the measured nonprompt and whole-profile candidates without changing another graph value', async () => {
  const load = await loader()
  const baseline = await load(SOURCE)
  const original = readGraphProfile(SOURCE, 'build')
  expect(canonicalAgentProfileDigest(original)).toBe(
    canonicalAgentProfileDigest(baseline.graph.nodes[0]!.profile),
  )
  const nonprompt: AgentProfile = { ...original, tools: { Read: true, Bash: true } }
  const complete: AgentProfile = {
    ...nonprompt,
    prompt: { systemPrompt: 'Execute the measured procedure.\nReport the evidence.' },
    mcp: { catalog: { command: 'catalog-server', args: [{ kind: 'public', value: '--public' }] } },
    hooks: { Stop: [{ command: 'node verify-result.mjs', blocking: true }] },
    subagents: { critic: { description: 'Find a confound', prompt: 'Challenge the result.' } },
    resources: {
      failOnError: true,
      instructions: 'Keep hypotheses separate from observations.',
      skills: [{ kind: 'inline', name: 'method', content: '# Method\nChange one variable.' }],
    },
    extensions: { 'structural-rollout': { k: 2, repairRounds: 1, testgen: 0 } },
    metadata: { family: 'measured-method' },
  }
  for (const candidate of [nonprompt, complete]) {
    const next = setGraphProfile(SOURCE, 'build', candidate)
    const compiled = await load(next)
    expect(canonicalAgentProfileDigest(compiled.graph.nodes[0]!.profile)).toBe(
      canonicalAgentProfileDigest(candidate),
    )
    expect(canonicalAgentProfileDigest(readGraphProfile(next, 'build'))).toBe(
      canonicalAgentProfileDigest(candidate),
    )
    expect(compiled.graph.digest).not.toBe(baseline.graph.digest)
    const withoutCandidate = (value: typeof baseline) => {
      const { digest: _digest, nodes, ...graph } = value.graph
      return canonicalCandidateDigest({
        ...value,
        graph: {
          ...graph,
          nodes: nodes.map((node, index) =>
            index === 0 ? { ...node, profile: { name: 'build' } } : node,
          ),
        },
      })
    }
    expect(withoutCandidate(compiled)).toBe(withoutCandidate(baseline))
    expect(next.slice(0, next.indexOf('    profile:'))).toBe(
      SOURCE.slice(0, SOURCE.indexOf('    profile:')),
    )
    const retained = '  # The reviewer'
    expect(next.slice(next.indexOf(retained))).toBe(SOURCE.slice(SOURCE.indexOf(retained)))
    expect(readGraphProfile(setGraphStrings(next, { build: 'Only the prompt.' }), 'build')).toEqual(
      {
        ...candidate,
        prompt: { systemPrompt: 'Only the prompt.' },
      },
    )
  }
})

it('materializes JSON and flow YAML profiles through the real loader too', async () => {
  const load = await loader()
  const baseline = readGraphProfile(SOURCE, 'review')
  const candidate: AgentProfile = { ...baseline, tools: { Bash: false } }
  const next = setGraphProfile(SOURCE, 'review', candidate)
  expect((await load(next)).graph.nodes[1]!.profile).toEqual(candidate)
  const pinned = `digest: ${(await load(SOURCE)).graph.digest}\n${SOURCE}`
  expect((await load(pinned)).graph.nodes[1]!.profile).toEqual(baseline)
  expect(setGraphProfile(pinned, 'review', baseline)).toBe(pinned)
  expect(() => setGraphProfile(pinned, 'review', candidate)).toThrow(/pinned graph digest/)
  const json = JSON.stringify(parse(SOURCE))
  const written = setGraphProfile(json, 'review', candidate)
  expect(JSON.parse(written).nodes[1].profile).toEqual(candidate)
  expect((await load(written, 'json')).graph.nodes[1]!.profile).toEqual(candidate)
})

it('refuses shared, host-dependent and malformed source instead of rewriting another owner', async () => {
  const load = await loader()
  const anchored = SOURCE.replace('    profile:\n', '    profile: &shared\n')
  // Native YAML loading permits this; exact candidate writes deliberately do not.
  expect((await load(anchored)).graph.nodes[0]!.profile.name).toBe('build')
  const candidates = [
    anchored,
    `&root\n${SOURCE}`,
    SOURCE.replace('nodes:\n', 'nodes: &nodes\n'),
    SOURCE.replace('  - id: build', '  - &node id: build'),
    SOURCE.replace('prompt: { systemPrompt:', 'prompt: &prompt { systemPrompt:'),
    anchored.replace(/ {4}profile: \{ harness: cli-base[^\n]+/, '    profile: *shared'),
    SOURCE.replace('    profile:\n', '    profile: profile.yaml\n    unused:\n'),
    SOURCE.replace('    profile:\n', '    seat: selected-by-host\n    profile:\n'),
    SOURCE.replace('    profile:\n', '    needs: [google-drive]\n    profile:\n'),
    SOURCE.replace('default: offline/local-process', 'default: "${params.model}"'),
    SOURCE.replace('harness: cli-base\n', ''),
    SOURCE.replace('  - id: review', '  - id: build'),
    SOURCE.replace('profile:\n', 'profile: !custom\n'),
    SOURCE.replace('tools: { Read: true, Bash: false }', 'tools: { Read: true, Read: false }'),
  ]
  const candidate = readGraphProfile(SOURCE, 'build')
  for (const [index, source] of candidates.entries()) {
    expect(() => readGraphProfile(source, 'build'), `source variant ${index}`).toThrow()
    expect(() => setGraphProfile(source, 'build', candidate), `source variant ${index}`).toThrow()
  }
  expect(() => readGraphProfile(SOURCE, 'verify')).toThrow()
  expect(() => readGraphProfile(SOURCE, 'absent')).toThrow()
})

it('refuses lossy or private candidates before any source is returned', () => {
  const baseline = readGraphProfile(SOURCE, 'build')
  let getterCalls = 0
  const candidates: unknown[] = [
    { ...baseline, name: 'another-node' },
    { ...baseline, unexpectedProfileField: true },
    { ...baseline, model: { default: 'offline/local-process' } },
    { ...baseline, prompt: { systemPrompt: '${trigger.message}' } },
    {
      ...baseline,
      mcp: { catalog: { command: 'catalog-server', env: { API_KEY: 'private-value' } } },
    },
    {
      ...baseline,
      get metadata() {
        getterCalls++
        return {}
      },
    },
  ]
  for (const candidate of candidates)
    expect(() => setGraphProfile(SOURCE, 'build', candidate as AgentProfile)).toThrow()
  expect(getterCalls).toBe(0)
  const privateSource = SOURCE.replace(
    '      tools: { Read: true, Bash: false }',
    '      mcp: { catalog: { command: catalog-server, env: { API_KEY: private-value } } }',
  )
  expect(() => readGraphProfile(privateSource, 'build')).toThrow(/private/)
})
