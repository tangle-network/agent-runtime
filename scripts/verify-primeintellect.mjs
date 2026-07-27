import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createPrimeIntellectPackage,
  writePrimeIntellectPackage,
} from '../dist/primeintellect/index.js'

const root = mkdtempSync(join(tmpdir(), 'agent-runtime-primeintellect-'))
const output = join(root, 'strict-exact')
const referenceOutput = join(root, 'reference')
const commandOutput = join(root, 'command')

try {
  const bundle = createPrimeIntellectPackage({
    name: 'strict-exact',
    version: '1.0.0',
    tasks: [
      { id: 'train', split: 'train', prompt: 'Is a subscription refundable?', answer: 'No' },
      { id: 'eval', split: 'eval', prompt: 'Is a final-sale item refundable?', answer: 'No' },
    ],
    scoring: { kind: 'exact', normalization: 'trim-casefold' },
    runner: {
      image: 'node:22-bookworm-slim',
      command: ['node', 'runner.mjs'],
      files: { 'runner.mjs': 'process.exit(0)\n' },
    },
  })
  await writePrimeIntellectPackage(bundle, output)
  await writePrimeIntellectPackage(
    createPrimeIntellectPackage({
      name: 'reference',
      version: '1.0.0',
      tasks: [
        { id: 'train-ref', split: 'train', prompt: 'Practice reference?', answer: 'No' },
        { id: 'eval-ref', split: 'eval', prompt: 'Held-out reference?', answer: 'No' },
      ],
      scoring: { kind: 'reference-judge', model: 'openai/gpt-5.4-nano' },
      runner: {
        image: 'node:22-bookworm-slim',
        command: ['node', 'runner.mjs'],
        files: { 'runner.mjs': 'process.exit(0)\n' },
      },
    }),
    referenceOutput,
  )
  await writePrimeIntellectPackage(
    createPrimeIntellectPackage({
      name: 'command',
      version: '1.0.0',
      tasks: [
        { id: 'train-command', split: 'train', prompt: 'Practice command?' },
        { id: 'eval-command', split: 'eval', prompt: 'Held-out command?' },
      ],
      scoring: {
        kind: 'command',
        command: ['python', 'scoring/score.py'],
        files: {
          'score.py':
            'import json, sys\nrequest = json.load(sys.stdin)\nassert request["kind"] == "tangle.primeintellect.score"\nprint(json.dumps({"reward": 0.25, "metrics": {"custom": 0.75}}))\n',
        },
      },
      runner: {
        image: 'node:22-bookworm-slim',
        command: ['node', 'runner.mjs'],
        files: { 'runner.mjs': 'process.exit(0)\n' },
      },
    }),
    commandOutput,
  )
  const check = `
import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import verifiers.v1 as vf
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "reference"))
sys.path.insert(0, str(ROOT / "command"))
from command import TangleTaskset as CommandTaskset
from command.taskset import TangleTasksetConfig as CommandTasksetConfig
from reference import TangleTaskset as ReferenceTaskset
from reference.taskset import TangleTasksetConfig as ReferenceTasksetConfig
from strict_exact import TangleRuntimeHarness, TangleTaskset
from strict_exact.harness import TangleRuntimeHarnessConfig
from strict_exact.taskset import TangleTasksetConfig

train = TangleTaskset(TangleTasksetConfig(id="strict-exact", split="train")).load()
heldout = TangleTaskset(TangleTasksetConfig(id="strict-exact", split="eval")).load()
assert [task.data.name for task in train] == ["train"]
assert [task.data.name for task in heldout] == ["eval"]

class ScoreTrace:
    def __init__(self, reply):
        self.last_reply = reply

task = heldout[0]
assert asyncio.run(task.task_reward(ScoreTrace("No"))) == 1.0
assert asyncio.run(task.task_reward(ScoreTrace("No, but the policy allows it"))) == 0.0
assert asyncio.run(task.task_reward(ScoreTrace("Yes, it is allowed"))) == 0.0

reference_task = ReferenceTaskset(
    ReferenceTasksetConfig(id="reference", split="eval")
).load()[0]
reference_trace = SimpleNamespace(last_reply="", transcript="")
assert asyncio.run(reference_task.task_reward(reference_trace)) == 0.0

class CommandTrace:
    def __init__(self):
        self.recorded = {}
    def model_dump(self, **kwargs):
        return {"id": "command-trace", "nodes": []}
    def record_metrics(self, metrics):
        self.recorded.update(metrics)

command_task = CommandTaskset(
    CommandTasksetConfig(id="command", split="eval")
).load()[0]
command_trace = CommandTrace()
assert asyncio.run(command_task.task_reward(command_trace)) == 0.25
assert command_trace.recorded == {"custom": 0.75}

class Runtime:
    def __init__(self):
        self.env = None
        self.files = {}
    async def write(self, path, contents):
        self.files[path] = contents
    async def run(self, command, env):
        return vf.ProgramResult(exit_code=0, stdout="", stderr="")
    async def run_program(self, command, env):
        self.env = env
        return vf.ProgramResult(exit_code=0, stdout="", stderr="")

runtime = Runtime()
harness = TangleRuntimeHarness(TangleRuntimeHarnessConfig(id="strict-exact"))
asyncio.run(harness.setup(runtime))
asyncio.run(harness.launch(
    SimpleNamespace(model="openai/gpt-5.4-20260601"),
    SimpleNamespace(task=SimpleNamespace(data=task.data)),
    runtime,
    "http://127.0.0.1:9000/v1",
    "secret",
    {},
))
public = json.loads(runtime.env["TANGLE_PRIME_TASK_JSON"])
assert "answer" not in public
assert "reference" not in public
assert public["id"] == "eval"
assert runtime.files["runner.mjs"] == b"process.exit(0)\\n"
print(json.dumps({
    "train": len(train),
    "eval": len(heldout),
    "strict_scores": [1, 0, 0],
    "reference_empty": 0,
    "command_score": 0.25,
    "command_metric": 0.75,
}))
`
  const checkPath = join(output, 'verify.py')
  writeFileSync(checkPath, check)
  const result = spawnSync(
    'uv',
    [
      'run',
      '--project',
      output,
      '--with',
      'verifiers @ git+https://github.com/PrimeIntellect-ai/verifiers.git@v0.2.0',
      'python',
      checkPath,
    ],
    { cwd: output, encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error(
      [
        'PrimeIntellect Verifiers v0.2.0 integration check failed',
        result.error instanceof Error
          ? `${result.error.name}: ${result.error.message}`
          : undefined,
        result.signal ? `terminated by signal ${result.signal}` : undefined,
        typeof result.stdout === 'string' ? result.stdout.trim() : undefined,
        typeof result.stderr === 'string' ? result.stderr.trim() : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  process.stdout.write(result.stdout ?? '')
} finally {
  rmSync(root, { recursive: true, force: true })
}
