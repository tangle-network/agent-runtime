/**
 * CADBench / BlenderLLM adapter (FreedomIntelligence/CADBench, arXiv:2412.14203).
 * Task = NL instruction → a Blender `bpy` script. Score = the paper's criteria
 * eval: render the produced model to standardized views, then a vision judge
 * (GPT-4o-class) marks each per-task criterion bullet pass/fail against the
 * rendered images + the script text. score = fraction of criteria satisfied.
 *
 * Data: the published dataset's `criteria` flattened to a bullet list (700 tasks,
 * 500 Simulative + 200 Wild). Point CADBENCH_PATH at the cleaned JSONL
 * ({id,name,instruction,type,criteria:string[]} per line). Judge creds from
 * TANGLE_API_KEY / ROUTER_BASE / JUDGE_MODEL (default gpt-4o).
 */

import { readFile } from 'node:fs/promises'
import type { BenchScore, BenchTask, BenchmarkAdapter, LoadOptions } from './types'
import { renderBpy } from '../worker-blender'

interface CadBenchMeta {
  name: string
  type: string
  criteria: string[]
}

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required for the CADBench judge`)
  return v
}

/** One batched vision call: rendered views + the bpy script + the numbered
 *  criteria → a JSON array of booleans (true = satisfied). Faithful to the
 *  paper's combined image+script evaluation. Throws on transport failure (never
 *  a silent zero); a parse miss falls back to "all fail" with a note. */
async function judgeCriteria(
  instruction: string,
  script: string,
  criteria: string[],
  renders: string[],
): Promise<{ passed: boolean[]; note: string }> {
  const base = (process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1').replace(/\/$/, '')
  const key = must('TANGLE_API_KEY')
  const model = process.env.JUDGE_MODEL ?? 'gpt-4o'
  const numbered = criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
  const text =
    `You are strictly grading a 3D model that was built by a Blender bpy script for this instruction:\n"${instruction}"\n\n` +
    `Below are ${renders.length} rendered views of the produced model, and the script that built it. ` +
    `For EACH numbered criterion, decide whether it is satisfied (judge geometry/shape/proportion/structure from the IMAGES; judge color/size/material reasonableness from the SCRIPT where the images are ambiguous). ` +
    `Return ONLY a JSON array of exactly ${criteria.length} booleans (true=satisfied, false=not), in order, no prose.\n\nCRITERIA:\n${numbered}\n\nSCRIPT:\n\`\`\`python\n${script.slice(0, 6000)}\n\`\`\``
  const content: unknown[] = [{ type: 'text', text }]
  for (const url of renders) content.push({ type: 'image_url', image_url: { url } })
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: 1500, temperature: 0, messages: [{ role: 'user', content }] }),
  })
  if (!res.ok) throw new Error(`judge ${model} ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const raw = data.choices?.[0]?.message?.content ?? ''
  const m = /\[\s*(?:true|false)[\s\S]*?\]/i.exec(raw)
  if (!m) return { passed: criteria.map(() => false), note: `judge returned no parseable verdict: ${raw.slice(0, 80)}` }
  let arr: unknown
  try {
    arr = JSON.parse(m[0].toLowerCase())
  } catch {
    return { passed: criteria.map(() => false), note: 'judge verdict not valid JSON' }
  }
  const bools = Array.isArray(arr) ? arr.map((x) => x === true) : []
  // Pad/truncate to criteria length (a short array scores the missing as fail).
  const passed = criteria.map((_, i) => bools[i] === true)
  return { passed, note: `${passed.filter(Boolean).length}/${criteria.length} criteria` }
}

export function createCadBenchAdapter(): BenchmarkAdapter {
  let cache: Array<{ id: string; instruction: string; meta: CadBenchMeta }> | null = null

  async function load(): Promise<typeof cache & object> {
    if (cache) return cache
    const path = process.env.CADBENCH_PATH
    if (!path) throw new Error('CADBENCH_PATH must point at the cleaned CADBench JSONL ({id,instruction,type,criteria:[]} per line)')
    const text = await readFile(path, 'utf8')
    cache = text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        const r = JSON.parse(l) as { id: string; name?: string; instruction: string; type?: string; criteria: string[] }
        return { id: r.id, instruction: r.instruction, meta: { name: r.name ?? '', type: r.type ?? '', criteria: r.criteria } }
      })
    return cache
  }

  return {
    name: 'cadbench',

    async preflight() {
      const { execFile } = await import('node:child_process')
      const { promisify } = await import('node:util')
      const exec = promisify(execFile)
      try {
        await exec('xvfb-run', ['-a', 'blender', '--version'], { timeout: 30_000 })
      } catch (err) {
        throw new Error(
          `cadbench preflight failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}\n` +
            `Fix: install Blender + Xvfb (sudo apt-get install -y blender xvfb). The judge runs \`xvfb-run -a blender --background --python\`.`,
        )
      }
      await load()
    },

    async loadTasks(opts: LoadOptions = {}) {
      let rows = await load()
      if (opts.ids) rows = rows.filter((r) => opts.ids!.includes(r.id))
      // TYPE filter (Simulative|Wild) via env, applied before limit.
      const t = process.env.CADBENCH_TYPE
      if (t) rows = rows.filter((r) => r.meta.type.toLowerCase() === t.toLowerCase())
      if (opts.limit != null) rows = rows.slice(0, opts.limit)
      return rows.map((r): BenchTask => ({ id: r.id, prompt: r.instruction, metadata: r.meta as unknown as Record<string, unknown> }))
    },

    async goldArtifact() {
      return undefined // no reference bpy script ships with the benchmark
    },

    async judge(task: BenchTask, artifact: string): Promise<BenchScore> {
      const meta = task.metadata as unknown as CadBenchMeta
      const criteria = meta.criteria ?? []
      if (!artifact.trim()) return { resolved: false, score: 0, detail: 'empty artifact' }
      if (criteria.length === 0) return { resolved: false, score: 0, detail: 'task has no criteria' }
      const r = await renderBpy(artifact, { views: 4 })
      if (!r.built) return { resolved: false, score: 0, detail: `did not build/render: ${r.error ?? 'no mesh'}` }
      const { passed, note } = await judgeCriteria(task.prompt, artifact, criteria, r.renders)
      const score = passed.filter(Boolean).length / criteria.length
      return { resolved: score === 1, score, detail: note }
    },
  }
}
