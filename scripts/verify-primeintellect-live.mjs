import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { build } from 'tsdown'
import {
  createPrimeIntellectPackage,
  importPrimeIntellectTraces,
  parsePrimeIntellectTraces,
  writePrimeIntellectPackage,
} from '../dist/primeintellect/index.js'

const VERIFIERS =
  'verifiers @ git+https://github.com/PrimeIntellect-ai/verifiers.git@v0.2.0'
const model = process.env.PRIME_LIVE_MODEL ?? 'deepseek/deepseek-v4-flash'
const providerBaseUrl =
  process.env.PRIME_LIVE_BASE_URL ?? 'https://api.pinference.ai/api/v1'
const apiKeyVariable = process.env.PRIME_LIVE_API_KEY_VAR ?? 'PRIME_API_KEY'
const providerKey = process.env[apiKeyVariable]

if (!providerKey) {
  throw new Error(`Prime live verification requires ${apiKeyVariable}`)
}

const root = process.env.PRIME_LIVE_RUN_DIR
  ? resolve(process.env.PRIME_LIVE_RUN_DIR)
  : await mkdtemp(join(tmpdir(), 'agent-runtime-prime-live-'))
const bundleDirectory = join(root, 'bundle')
const packageDirectory = join(root, 'environment')
const outputDirectory = join(root, 'output')
const runnerSource = join(root, 'runner.ts')
const runnerBundle = join(bundleDirectory, 'runner.js')

await mkdir(root, { recursive: true })
await writeFile(runnerSource, renderRunner(), 'utf8')
await build({
  config: false,
  entry: { runner: runnerSource },
  outDir: bundleDirectory,
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outputOptions: { codeSplitting: false },
  clean: true,
  dts: false,
  sourcemap: false,
  minify: false,
  fixedExtension: false,
  deps: { alwaysBundle: [/.*/] },
  logLevel: 'silent',
})

const bundledRunner = await readFile(runnerBundle, 'utf8')
if (/from\s+["']@tangle-network\//.test(bundledRunner)) {
  throw new Error('Prime live runner retained an external Tangle package import')
}

const scoringProgram = `import json
import sys

request = json.load(sys.stdin)
assert request["kind"] == "tangle.primeintellect.score"
trace = request["trace"]
sampled = [node for node in trace["nodes"] if node.get("sampled") is True]
contents = [str((node.get("message") or {}).get("content") or "").strip() for node in sampled]
solver_handoff = bool(contents and "REVIEW REQUEST:" in contents[0])
exact_final = bool(contents and contents[-1] == "FINAL: 42")
multi_turn = len(sampled) >= 2
reward = float(multi_turn and solver_handoff and exact_final and not trace.get("errors"))
print(json.dumps({
    "reward": reward,
    "metrics": {
        "multi_turn": float(multi_turn),
        "sampled_turns": float(len(sampled)),
        "solver_handoff": float(solver_handoff),
        "exact_final": float(exact_final),
    },
}))
`

const taskPrompt = `Run this two-stage workflow.

The solver checks 17 + 25 and sends the reviewer a complete handoff beginning with REVIEW REQUEST:.
The reviewer independently checks that handoff and replies exactly FINAL: 42 with no other text.
Do not skip either stage.`

const environment = createPrimeIntellectPackage({
  name: 'tangle-runtime-live-v1',
  version: '1.0.0',
  description: 'Live multi-turn Tangle runtime execution through PrimeIntellect',
  tasks: [
    {
      id: 'train-two-stage-arithmetic',
      split: 'train',
      prompt: taskPrompt.replace('17 + 25', '19 + 23'),
    },
    {
      id: 'eval-two-stage-arithmetic',
      split: 'eval',
      prompt: taskPrompt,
    },
  ],
  scoring: {
    kind: 'command',
    command: ['python', 'scoring/score.py'],
    files: { 'score.py': scoringProgram },
    timeoutSeconds: 30,
  },
  runner: {
    image: 'node:22-bookworm-slim',
    command: ['node', 'runner.mjs'],
    files: { 'runner.mjs': bundledRunner },
  },
  maxTurns: 4,
  maxOutputTokens: 512,
  maxTotalTokens: 4_096,
  rolloutTimeoutSeconds: 180,
  scoringTimeoutSeconds: 30,
})
await writePrimeIntellectPackage(environment, packageDirectory)

const dryRun = runPrime([
  '--dry-run',
  'true',
  '--output-dir',
  outputDirectory,
])
if (dryRun.status !== 0) fail('Prime live config validation failed', dryRun)

const liveRun = runPrime([
  '--output-dir',
  outputDirectory,
  '--server',
  'true',
  '--pool.type',
  'static',
  '--pool.num-workers',
  '2',
  '--sampling.temperature',
  '0',
  '--sampling.max-tokens',
  '256',
])
if (liveRun.status !== 0) fail('Prime live rollout failed', liveRun)

const tracePath = join(outputDirectory, 'traces.jsonl')
const traceJsonl = await readFile(tracePath, 'utf8')
const traces = parsePrimeIntellectTraces(traceJsonl)
if (traces.length !== 1) throw new Error(`expected one Prime trace, received ${traces.length}`)

const commitSha = git('rev-parse', 'HEAD')
const observedDate = new Date().toISOString().slice(0, 10)
const records = importPrimeIntellectTraces(traceJsonl, {
  experimentId: `prime-live-${observedDate}`,
  candidateId: 'tangle-runtime-live-v1',
  seed: 0,
  model: `${model}@observed-${observedDate}`,
  promptHash: sha256(taskPrompt),
  configHash: sha256(environment.files['prime.eval.toml']),
  commitSha,
})
const trace = traces[0]
const record = records[0]
const raw = record.outcome.raw ?? {}
const reward = record.outcome.holdoutScore

if (trace.errors?.length) {
  throw new Error(`Prime trace contains errors: ${JSON.stringify(trace.errors)}`)
}
if (trace.runtime === undefined) throw new Error('Prime trace did not record its runtime')
if (reward !== 1) throw new Error(`Prime live reward was ${String(reward)}, expected 1`)
if ((raw['prime.turns'] ?? 0) < 2) {
  throw new Error(`Prime trace recorded ${String(raw['prime.turns'])} sampled turns, expected >= 2`)
}
for (const metric of ['multi_turn', 'solver_handoff', 'exact_final']) {
  if (raw[`metric.${metric}`] !== 1) {
    throw new Error(`Prime live metric ${metric} was ${String(raw[`metric.${metric}`])}`)
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      runDirectory: root,
      tracePath,
      model,
      workerMode: 'server',
      workerCount: 2,
      runtime: trace.runtime,
      reward,
      sampledTurns: raw['prime.turns'],
      branches: raw['prime.branches'],
      metrics: Object.fromEntries(
        Object.entries(raw).filter(([name]) => name.startsWith('metric.')),
      ),
      tokenUsage: record.tokenUsage,
      costUsd: record.costUsd,
      costProvenance: record.costProvenance,
      completed: raw['prime.completed'],
      errors: trace.errors ?? [],
      importedRunRecord: record.runId,
    },
    null,
    2,
  )}\n`,
)

function runPrime(extraArguments) {
  return spawnSync(
    'uv',
    [
      'run',
      '--project',
      packageDirectory,
      '--with',
      VERIFIERS,
      'eval',
      '@',
      'prime.eval.toml',
      '--model',
      model,
      '--num-tasks',
      '1',
      '--num-rollouts',
      '1',
      '--max-concurrent',
      '1',
      '--rich',
      'false',
      '--push',
      'false',
      '--client.base-url',
      providerBaseUrl,
      '--client.api-key-var',
      apiKeyVariable,
      ...extraArguments,
    ],
    {
      cwd: packageDirectory,
      env: { ...process.env, [apiKeyVariable]: providerKey },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  )
}

function fail(message, result) {
  const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  throw new Error(`${message}${detail ? `\n${detail}` : ''}`)
}

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  if (result.status !== 0) fail(`git ${args.join(' ')} failed`, result)
  return result.stdout.trim()
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function renderRunner() {
  const kernelEntry = resolve('dist/runtime/index.js')
  const primeEntry = resolve('dist/primeintellect/index.js')
  return `import { collectAgentTurn, createExecutor, streamAgentTurn } from ${JSON.stringify(kernelEntry)}
import { primeIntellectExecutorConfig, runPrimeIntellectProgram } from ${JSON.stringify(primeEntry)}

function exactProfile(name, instruction, model) {
  const provider = model.split('/')[0]
  if (!provider) throw new Error('Prime model must include an explicit provider prefix')
  return {
    name,
    harness: null,
    model: {
      provider,
      default: model,
      metadata: { temperature: 0, maxTokens: 192, maxRetries: 1 },
    },
    prompt: { systemPrompt: instruction },
  }
}

await runPrimeIntellectProgram(async (episode) => {
  if (typeof episode.task.prompt !== 'string') throw new Error('live proof expects a string prompt')
  const factory = createExecutor(primeIntellectExecutorConfig(episode))
  const solver = exactProfile(
    'prime-solver',
    'You are the solver. Calculate the arithmetic and send one complete handoff beginning with REVIEW REQUEST:. Do not emit FINAL:.',
    episode.model.name,
  )
  const reviewer = exactProfile(
    'prime-reviewer',
    'You are the reviewer. Independently check the arithmetic in the solver handoff. Reply exactly FINAL: 42 only when the handoff is correct, with no other text.',
    episode.model.name,
  )
  const first = await collectAgentTurn(
    streamAgentTurn({ kind: 'executor', profile: solver, factory }, episode.task.prompt, {
      timeoutMs: 60_000,
      callId: 'prime:' + episode.task.id + ':solver',
    }),
  )
  if (first.status !== 'completed') throw new Error('solver failed: ' + (first.error?.message ?? first.status))
  const second = await collectAgentTurn(
    streamAgentTurn(
      { kind: 'executor', profile: reviewer, factory },
      { messages: [{ role: 'user', content: episode.task.prompt }, { role: 'assistant', content: first.finalText }] },
      { timeoutMs: 60_000, callId: 'prime:' + episode.task.id + ':reviewer' },
    ),
  )
  if (second.status !== 'completed') throw new Error('reviewer failed: ' + (second.error?.message ?? second.status))
  process.stdout.write(JSON.stringify({ turns: 2, final: second.finalText }) + '\\n')
})
`
}
