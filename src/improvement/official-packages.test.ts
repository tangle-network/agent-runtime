import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const python = process.env.AGENT_EVAL_TEST_PYTHON
const runDirs: string[] = []

afterEach(() => {
  for (const runDir of runDirs.splice(0)) {
    rmSync(runDir, { recursive: true, force: true })
  }
})

function runDir(): string {
  const value = mkdtempSync(join(tmpdir(), 'runtime-official-package-'))
  runDirs.push(value)
  return value
}

function requiredPython(): string {
  if (!python) throw new Error('AGENT_EVAL_TEST_PYTHON is required')
  return python
}

function runPython(script: string, args: readonly string[] = []): unknown {
  const stdout = execFileSync(requiredPython(), ['-c', script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
    },
    timeout: 60_000,
  })
  return JSON.parse(stdout.trim()) as unknown
}

function inspectBridge(module: 'gepa_bridge' | 'skillopt_bridge'): Record<string, unknown> {
  const root = runDir()
  const inputPath = join(root, 'input.json')
  const outputPath = join(root, 'output.json')
  writeFileSync(
    inputPath,
    JSON.stringify({
      operation: 'inspect',
      ...(module === 'gepa_bridge' ? { engineModules: [] } : {}),
    }),
  )
  execFileSync(
    requiredPython(),
    ['-m', `agent_eval_rpc.${module}`, '--input', inputPath, '--output', outputPath],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
      },
      timeout: 60_000,
    },
  )
  return JSON.parse(readFileSync(outputPath, 'utf8')) as Record<string, unknown>
}

describe('documented official Python packages', () => {
  it.skipIf(!python)('loads the released GEPA 0.1.4 API and performs real work', () => {
    const stateRoot = runDir()
    const result = runPython(
      `
import contextlib
import io
import json
import sys
from importlib.metadata import version
from pathlib import Path
from gepa.optimize_anything import EngineConfig, GEPAConfig, ReflectionConfig, optimize_anything
from gepa.utils import ScoreThresholdStopper

class DeterministicModel:
    def __init__(self):
        self.calls = 0

    def __call__(self, prompt):
        self.calls += 1
        return "ALWAYS_RETURN_READY"

evaluations = []

def evaluate(candidate, example):
    evaluations.append([candidate, example["id"]])
    score = 1.0 if "ALWAYS_RETURN_READY" in candidate else 0.0
    return score, {"feedback": "Add ALWAYS_RETURN_READY."}

root = Path(sys.argv[1])
model = DeterministicModel()
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    result = optimize_anything(
        "BASELINE",
        evaluator=evaluate,
        dataset=[{"id": "train"}],
        valset=[{"id": "selection"}],
        objective="Add the required response rule.",
        config=GEPAConfig(
            engine=EngineConfig(
                capture_stdio=False,
                max_metric_calls=4,
                max_workers=1,
                parallel=False,
                raise_on_exception=True,
                run_dir=str(root / "state"),
                seed=7,
                use_cloudpickle=False,
            ),
            reflection=ReflectionConfig(
                reflection_lm=model,
                reflection_minibatch_size=1,
                skip_perfect_score=False,
            ),
            stop_callbacks=[ScoreThresholdStopper(1.0)],
        ),
    )

print(json.dumps({
    "version": version("gepa"),
    "bestCandidate": result.best_candidate,
    "bestScore": result.val_aggregate_scores[result.best_idx],
    "totalEvaluations": result.total_metric_calls,
    "modelCalls": model.calls,
    "evaluations": evaluations,
    "stateBytes": (root / "state" / "gepa_state.bin").stat().st_size,
    "candidateBytes": (root / "state" / "candidates.json").stat().st_size,
}))
`,
      [stateRoot],
    )

    expect(result).toEqual({
      version: '0.1.4',
      bestCandidate: 'ALWAYS_RETURN_READY',
      bestScore: 1,
      totalEvaluations: 4,
      modelCalls: 1,
      evaluations: [
        ['BASELINE', 'selection'],
        ['BASELINE', 'train'],
        ['ALWAYS_RETURN_READY', 'train'],
        ['ALWAYS_RETURN_READY', 'selection'],
      ],
      stateBytes: expect.any(Number),
      candidateBytes: expect.any(Number),
    })
    expect((result as { stateBytes: number }).stateBytes).toBeGreaterThan(0)
    expect((result as { candidateBytes: number }).candidateBytes).toBeGreaterThan(0)

    const inspected = inspectBridge('gepa_bridge') as {
      runtime: {
        bridge: { package: string; version: string; sourceSha256: string }
        optimizer: { package: string; version: string; sourceSha256: string }
      }
    }
    expect(inspected.runtime.bridge).toMatchObject({
      package: 'agent-eval-rpc',
      version: '0.129.0',
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(inspected.runtime.optimizer).toMatchObject({
      package: 'gepa',
      version: '0.1.4',
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it.skipIf(!python)('loads the pinned SkillOpt trainer and all required prompt files', () => {
    const result = runPython(`
import json
from importlib import resources
from importlib.metadata import distribution, version
from skillopt.engine.trainer import ReflACTTrainer

prompt_root = resources.files("skillopt.prompts")
prompts = sorted(
    entry.name
    for entry in prompt_root.iterdir()
    if entry.is_file() and entry.name.endswith(".md") and entry.read_text().strip()
)
direct_url = json.loads(distribution("skillopt").read_text("direct_url.json") or "{}")
print(json.dumps({
    "version": version("skillopt"),
    "trainer": ReflACTTrainer.__name__,
    "prompts": prompts,
    "revision": direct_url.get("vcs_info", {}).get("commit_id"),
}))
`)

    expect(result).toEqual({
      version: '0.2.0',
      trainer: 'ReflACTTrainer',
      prompts: [
        'analyst_error.md',
        'analyst_error_full_rewrite.md',
        'analyst_error_rewrite.md',
        'analyst_success.md',
        'analyst_success_full_rewrite.md',
        'analyst_success_rewrite.md',
        'lr_autonomous.md',
        'merge_failure.md',
        'merge_failure_full_rewrite.md',
        'merge_failure_rewrite.md',
        'merge_final.md',
        'merge_final_full_rewrite.md',
        'merge_final_rewrite.md',
        'merge_success.md',
        'merge_success_full_rewrite.md',
        'merge_success_rewrite.md',
        'meta_skill.md',
        'ranking.md',
        'ranking_rewrite.md',
        'rewrite_skill.md',
        'slow_update.md',
      ],
      revision: '61735e3922efc2b90c6d6cab561e62e98452ca90',
    })

    const inspected = inspectBridge('skillopt_bridge') as {
      runtime: {
        bridge: { package: string; version: string; sourceSha256: string }
        optimizer: { package: string; version: string; revision: string; sourceSha256: string }
      }
    }
    expect(inspected.runtime.bridge).toMatchObject({
      package: 'agent-eval-rpc',
      version: '0.129.0',
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(inspected.runtime.optimizer).toMatchObject({
      package: 'skillopt',
      version: '0.2.0',
      revision: '61735e3922efc2b90c6d6cab561e62e98452ca90',
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })
})
