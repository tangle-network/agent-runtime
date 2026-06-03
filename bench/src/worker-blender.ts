/**
 * BlenderLLM / CADBench worker. The deliverable for a CADBench task is a Blender
 * `bpy` Python script that builds the described 3D model. We author it via the
 * router, execute it headless in Blender (Cycles CPU, no GPU), auto-frame the
 * produced geometry, and render N standardized views — the images the CADBench
 * criteria judge scores. The authoring directive is the GEPA-optimizable surface.
 *
 * Requires `blender` + `xvfb-run` on PATH (apt blender 4.x). No GPU: Cycles CPU
 * with denoising off (the apt build ships without OpenImageDenoise).
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Span } from '@tangle-network/agent-eval'
import type { BenchTask } from './benchmarks/types'

const execFileAsync = promisify(execFile)

async function runLocal(cmd: string, args: string[], cwd: string, timeoutMs = 180_000): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { cwd, maxBuffer: 1 << 26, timeout: timeoutMs })
    return { code: 0, stdout, stderr }
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string }
    return { code: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? String(err) }
  }
}

async function routerChatWithUsage(
  cfg: { routerBaseUrl: string; routerKey: string; model: string },
  messages: Array<{ role: string; content: string }>,
): Promise<{ content: string; usage: { input: number; output: number } }> {
  const res = await fetch(`${cfg.routerBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.routerKey}` },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.3 }),
  })
  if (!res.ok) throw new Error(`router ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
  }
}

/** Strip markdown fences so we keep just the Python. */
function extractPy(text: string): string {
  const fence = /```(?:python|py)?\s*\n([\s\S]*?)```/i.exec(text)
  return (fence ? fence[1] : text).trim()
}

/** Hand-written baseline bpy authoring directive — the GEPA-optimizable surface.
 *  Minimal on purpose (states the contract, not how to satisfy the criteria) so
 *  the optimizer has room to learn the modeling discipline. */
export const DEFAULT_BLENDER_DIRECTIVE =
  'You are an expert Blender Python (bpy) modeller. Output ONLY a complete bpy script — no prose, no markdown fences. The script must run under `blender --background --python` and build the described object as one or more mesh objects at the world origin. Do NOT add cameras, lights, or render calls; the harness adds those. Match the description.'

/**
 * The standardized Blender runner (written to a temp file per run). It clears the
 * scene, executes the agent's bpy script, auto-frames the produced meshes, sets
 * up neutral lighting, and renders N azimuth views with Cycles CPU.
 */
const RUNNER_PY = `
import bpy, sys, math, mathutils, traceback, os
agent_script, outdir, nviews = sys.argv[-3], sys.argv[-2], int(sys.argv[-1])
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
ok=True
try:
    g={'bpy':bpy,'math':math,'mathutils':mathutils,'__name__':'__main__'}
    exec(compile(open(agent_script).read(), agent_script, 'exec'), g)
except Exception as e:
    traceback.print_exc(); print('AGENT_SCRIPT_ERROR:'+repr(e)); ok=False
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
if not meshes:
    print('NO_MESH'); sys.exit(0 if ok else 3)
mn=[1e18]*3; mx=[-1e18]*3
for o in meshes:
    for c in o.bound_box:
        w=o.matrix_world @ mathutils.Vector(c)
        for i in range(3): mn[i]=min(mn[i],w[i]); mx[i]=max(mx[i],w[i])
center=mathutils.Vector(((mn[0]+mx[0])/2,(mn[1]+mx[1])/2,(mn[2]+mx[2])/2))
size=max(mx[i]-mn[i] for i in range(3)) or 1.0
# standardize: drop any agent-added cameras/lights
for o in list(bpy.context.scene.objects):
    if o.type in ('CAMERA','LIGHT'): bpy.data.objects.remove(o, do_unlink=True)
w=bpy.context.scene.world or bpy.data.worlds.new('W'); bpy.context.scene.world=w
w.use_nodes=True
try: w.node_tree.nodes['Background'].inputs[1].default_value=0.6
except Exception: pass
bpy.ops.object.light_add(type='SUN'); sun=bpy.context.object; sun.data.energy=4.0; sun.rotation_euler=mathutils.Euler((0.6,0.2,0.4))
bpy.ops.object.camera_add(); cam=bpy.context.object; bpy.context.scene.camera=cam
sc=bpy.context.scene
sc.render.engine='CYCLES'; sc.cycles.samples=20; sc.cycles.device='CPU'; sc.cycles.use_denoising=False
sc.render.resolution_x=640; sc.render.resolution_y=640; sc.render.film_transparent=False
dist=size*2.4
el=math.radians(58)
for v in range(nviews):
    az=math.radians(40 + v*360.0/nviews)
    cam.location=center+mathutils.Vector((math.cos(az)*math.sin(el), math.sin(az)*math.sin(el), math.cos(el)))*dist
    d=(center-cam.location); cam.rotation_euler=d.to_track_quat('-Z','Y').to_euler()
    sc.render.filepath=os.path.join(outdir, 'view_%d.png'%v); bpy.ops.render.render(write_still=True)
print('RENDER_DONE')
`.trim()

/** Execute a bpy script headless + render N standardized views — no authoring.
 *  Used by the CADBench judge to render an artifact before vision-scoring it. */
export async function renderBpy(script: string, opts: { views?: number } = {}): Promise<{ built: boolean; renders: string[]; error?: string }> {
  const views = Math.max(1, opts.views ?? 4)
  const dir = await mkdtemp(join(tmpdir(), 'blender-judge-'))
  const runnerPath = join(dir, 'runner.py')
  const scriptPath = join(dir, 'model.py')
  try {
    await writeFile(runnerPath, RUNNER_PY)
    await writeFile(scriptPath, script)
    const run = await runLocal('xvfb-run', ['-a', 'blender', '--background', '--python', runnerPath, '--', scriptPath, dir, String(views)], dir)
    const out = `${run.stdout}\n${run.stderr}`
    const built = /RENDER_DONE/.test(out)
    if (!built) return { built: false, renders: [], error: (/(AGENT_SCRIPT_ERROR:.*|NO_MESH)/.exec(out)?.[0] ?? out.trim().slice(-400)) }
    const renders: string[] = []
    for (let v = 0; v < views; v++) {
      const buf = await readFile(join(dir, `view_${v}.png`)).catch(() => undefined)
      if (buf) renders.push(`data:image/png;base64,${buf.toString('base64')}`)
    }
    return { built: renders.length > 0, renders }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export interface BlenderLocalConfig {
  routerBaseUrl: string
  routerKey: string
  model: string
  rounds?: number
  /** N standardized views to render (CADBench uses 4). Default 4. */
  views?: number
  /** The bpy authoring directive — the GEPA-optimizable surface. */
  directive?: string
}

export interface BlenderShot {
  /** The bpy script the agent wrote — the artifact. */
  artifact: string
  /** Rendered view PNGs as data URIs (the images the criteria judge scores). */
  renders: string[]
  trace: Span[]
  usage: { input: number; output: number }
  ok: boolean
  /** True if the script executed and produced at least one mesh. */
  built: boolean
  detail?: string
}

/**
 * Author a bpy script for the task via the router, execute + render it headless
 * in Blender, refine on execution errors across rounds. Returns the script, the
 * rendered views, a screenshot-rich trace, and real token usage.
 */
export async function solveBlenderLocal(task: BenchTask, cfg: BlenderLocalConfig): Promise<BlenderShot> {
  const rounds = Math.max(1, cfg.rounds ?? 2)
  const views = Math.max(1, cfg.views ?? 4)
  const directive = cfg.directive ?? DEFAULT_BLENDER_DIRECTIVE
  const dir = await mkdtemp(join(tmpdir(), 'blender-'))
  const runnerPath = join(dir, 'runner.py')
  const scriptPath = join(dir, 'model.py')
  await writeFile(runnerPath, RUNNER_PY)
  const trace: Span[] = []
  const runId = `cadbench-${task.id}`
  let ts = Date.now()
  const tick = () => (ts += 1)
  const usage = { input: 0, output: 0 }
  let script = ''
  let renders: string[] = []
  let built = false
  let lastErr = ''

  trace.push({ spanId: 's-brief', runId, kind: 'llm', name: 'brief', model: cfg.model, messages: [{ role: 'user', content: task.prompt }], startedAt: tick(), endedAt: tick(), status: 'ok' } as Span)

  try {
    for (let round = 1; round <= rounds && !built; round++) {
      const user =
        round === 1
          ? task.prompt
          : `Your previous bpy script failed:\n${lastErr}\n\nPrevious script:\n${script}\n\nFix it so it runs under \`blender --background --python\` and builds the object as mesh(es). Brief:\n${task.prompt}`
      const { content, usage: u } = await routerChatWithUsage(cfg, [
        { role: 'system', content: directive },
        { role: 'user', content: user },
      ])
      usage.input += u.input
      usage.output += u.output
      script = extractPy(content)
      trace.push({ spanId: `s-author-${round}`, runId, kind: 'llm', name: `author r${round}`, model: cfg.model, messages: [{ role: 'user', content: round === 1 ? task.prompt : 'refine' }], output: content.slice(0, 600), startedAt: tick(), endedAt: tick(), status: 'ok' } as Span)
      trace.push({ spanId: `s-write-${round}`, runId, kind: 'tool', name: 'write_file', toolName: 'create_file', args: { path: 'model.py', content: script }, startedAt: tick(), endedAt: tick(), status: 'ok' } as Span)

      await writeFile(scriptPath, script)
      const run = await runLocal('xvfb-run', ['-a', 'blender', '--background', '--python', runnerPath, '--', scriptPath, dir, String(views)], dir)
      const out = `${run.stdout}\n${run.stderr}`
      built = /RENDER_DONE/.test(out)
      lastErr = built ? '' : (/(AGENT_SCRIPT_ERROR:.*|NO_MESH)/.exec(out)?.[0] ?? out.trim().slice(-800))
      trace.push({ spanId: `s-blender-${round}`, runId, kind: 'tool', name: `blender r${round}`, toolName: 'shell.exec', args: 'blender --background --python runner.py model.py', result: (built ? 'RENDER_DONE' : lastErr).slice(0, 1500), startedAt: tick(), endedAt: tick(), status: built ? 'ok' : 'error', error: built ? undefined : `exit ${run.code}` } as Span)

      if (built) {
        const collected: string[] = []
        for (let v = 0; v < views; v++) {
          const buf = await readFile(join(dir, `view_${v}.png`)).catch(() => undefined)
          if (buf) collected.push(`data:image/png;base64,${buf.toString('base64')}`)
        }
        renders = collected
        // first view carries the screen span (run-capsule reveal)
        trace.push({ spanId: `s-render-${round}`, runId, kind: 'tool', name: 'render', toolName: 'render.screenshot', args: { action: 'rendered model', url: 'view_0.png' }, attributes: collected[0] ? { screenshot: collected[0] } : {}, startedAt: tick(), endedAt: tick(), status: collected.length ? 'ok' : 'error', error: collected.length ? undefined : 'render produced no image' } as Span)
        built = collected.length > 0
      }
    }
    return {
      artifact: script,
      renders,
      trace,
      usage,
      ok: script.trim().length > 0,
      built,
      detail: built ? `built + rendered ${renders.length} views` : `did not build in ${rounds} rounds${lastErr ? `; last: ${lastErr.slice(0, 140)}` : ''}`,
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
