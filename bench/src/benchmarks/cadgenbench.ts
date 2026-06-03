/**
 * CADGenBench adapter (huggingface/cadgenbench, Apache-2.0). Task = a part
 * description → a STEP B-rep solid (output.step). Score = the benchmark's OWN
 * deterministic geometric metric (cad_score): validity gate → PCA/ICP align to
 * the ground truth → point-cloud F1 + volume IoU + edge F1 + topology match.
 * NOT an LLM judge, NOT self-defined checks — the published CAD kernel decides.
 *
 * The official task set (private GT, server-side graded) isn't released yet, so
 * tasks here are seeded from the repo's dimension-named geometry fixtures (real
 * GT STEPs scored by the real scorer). When CADGENBENCH_DATA_DIR is set, swap
 * loadTasks to read the published fixtures' description.yaml + ground_truth.step.
 *
 * Requires the CADGenBench venv (CADGENBENCH_VENV) + clone (CADGENBENCH_DIR) +
 * xvfb (the scorer's alignment renders need a display).
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { BenchScore, BenchTask, BenchmarkAdapter, LoadOptions } from './types'
import { CGB_DIR, CGB_VENV_PY } from '../worker-build123d'

const execFileAsync = promisify(execFile)

/** Self-contained scorer wrapper (written to a temp file, run in the venv).
 *  Scores a candidate STEP against a ground-truth STEP via the benchmark's own
 *  evaluate_result, printing the cad_score line. */
const SCORE_PY = `
import sys, json, tempfile, shutil
from pathlib import Path
from cadgenbench.eval.evaluate import evaluate_result
cand, gt = Path(sys.argv[1]), Path(sys.argv[2])
with tempfile.TemporaryDirectory() as rd, tempfile.TemporaryDirectory() as gd:
    rd, gd = Path(rd), Path(gd)
    (rd / 'result.json').write_text('{}')
    shutil.copy(gt, gd / 'ground_truth.step')
    try:
        evaluate_result(rd, gd, candidate_step=cand)
        d = json.loads((rd / 'result.json').read_text())
        print('CGB_SCORE ' + json.dumps({'cad_score': d.get('cad_score', 0.0), 'status': d.get('status', 'unknown')}))
    except Exception as e:
        print('CGB_SCORE ' + json.dumps({'cad_score': 0.0, 'status': 'error', 'error': str(e)[:200]}))
`.trim()

interface CgbMeta {
  gtStep: string
  resolveThreshold: number
}

/** Fixture-seeded tasks (real GT STEPs from the repo, dim-named so the spec is
 *  exact). Replaced by the published dataset when CADGENBENCH_DATA_DIR is set. */
function fixtureTasks(): Array<{ id: string; prompt: string; gtStep: string }> {
  const g = join(CGB_DIR, 'tests/fixtures/geometry')
  return [
    { id: 'box-10x20x30', prompt: 'A rectangular solid box, 10 units wide (X), 20 units deep (Y), and 30 units tall (Z).', gtStep: join(g, 'box_10_20_30.step') },
    { id: 'cube-10', prompt: 'A cube, 10 units on every side.', gtStep: join(g, 'box_10_10_10.step') },
    { id: 'sphere-10', prompt: 'A sphere of radius 10 units, centered at the origin.', gtStep: join(g, 'sphere_10.step') },
  ]
}

export function createCadGenBenchAdapter(): BenchmarkAdapter {
  return {
    name: 'cadgenbench',

    async preflight() {
      const r = await execFileAsync(CGB_VENV_PY, ['-c', 'import cadgenbench.eval.evaluate, build123d, trimesh, manifold3d; print("ok")'], { timeout: 60_000 }).catch(
        (e) => ({ stdout: '', stderr: e instanceof Error ? e.message : String(e) }),
      )
      if (!/ok/.test(r.stdout)) {
        throw new Error(
          `cadgenbench preflight failed (venv=${CGB_VENV_PY}): ${r.stderr.slice(0, 200)}\n` +
            `Fix: git clone https://github.com/huggingface/cadgenbench ${CGB_DIR}; python3 -m venv $CADGENBENCH_VENV; $CADGENBENCH_VENV/bin/pip install -e ${CGB_DIR}`,
        )
      }
    },

    async loadTasks(opts: LoadOptions = {}) {
      // CGB_HARD_DIR (a dir with tasks.json = [{id,prompt,gtStep}]) overrides the
      // trivial fixture primitives with hard multi-feature parts (real headroom).
      let tasks = fixtureTasks()
      const hard = process.env.CGB_HARD_DIR
      if (hard) {
        const { readFile } = await import('node:fs/promises')
        tasks = JSON.parse(await readFile(join(hard, 'tasks.json'), 'utf8')) as Array<{ id: string; prompt: string; gtStep: string }>
      }
      if (opts.ids) tasks = tasks.filter((t) => opts.ids!.includes(t.id))
      if (opts.limit != null) tasks = tasks.slice(0, opts.limit)
      const meta = (gtStep: string): CgbMeta => ({ gtStep, resolveThreshold: Number(process.env.CGB_RESOLVE_THRESHOLD ?? 0.9) })
      return tasks.map((t): BenchTask => ({ id: t.id, prompt: t.prompt, metadata: meta(t.gtStep) as unknown as Record<string, unknown> }))
    },

    async goldArtifact() {
      return undefined // GT is a STEP file scored by the kernel, not a returnable artifact
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const { gtStep, resolveThreshold } = task.metadata as unknown as CgbMeta
      if (!artifact.includes('ISO-10303-21')) return { resolved: false, score: 0, detail: 'artifact is not a STEP file' }
      const dir = await mkdtemp(join(tmpdir(), 'cgb-judge-'))
      const cand = join(dir, 'candidate.step')
      const scorer = join(dir, 'score.py')
      try {
        await writeFile(cand, artifact)
        await writeFile(scorer, SCORE_PY)
        // xvfb: the scorer's alignment step renders; needs a display.
        const r = await execFileAsync('xvfb-run', ['-a', CGB_VENV_PY, scorer, cand, gtStep], { maxBuffer: 1 << 26, timeout: 180_000 }).catch(
          (e) => ({ stdout: (e as { stdout?: string }).stdout ?? '', stderr: e instanceof Error ? e.message : String(e) }),
        )
        const m = /CGB_SCORE (\{.*\})/.exec(r.stdout)
        if (!m) return { resolved: false, score: 0, detail: `scorer produced no verdict: ${(r.stderr || r.stdout).slice(0, 160)}` }
        const v = JSON.parse(m[1]) as { cad_score: number; status: string; error?: string }
        const score = typeof v.cad_score === 'number' ? v.cad_score : 0
        return { resolved: score >= resolveThreshold, score, detail: `cad_score=${score.toFixed(3)} status=${v.status}${v.error ? ` (${v.error})` : ''}` }
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    },
  }
}
