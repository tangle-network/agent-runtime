/**
 * CAD sandbox worker: one shot = a fresh 'universal' Tangle sandbox where a
 * coding agent authors OpenSCAD source for the task's brief. The sandbox's OWN
 * Nix-profile toolchain is the gate — `openscad` compiles + exports the STL and
 * renders a PNG inside the box; we read both back. The artifact (the `.scad`) is
 * scored by the cad-design judge; the produced trace (brief → code → compile →
 * render screenshot) drives run-capsule's conversation/code/terminal/screen
 * capsules.
 *
 * This is the "full rounded run": real sandbox, the real CAD kernel as the
 * verifiable reward, real geometry, and a screenshot-rich trace for the video.
 * Requires `openscad` + `xvfb-run` in the sandbox profile (universal has both).
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { acquireSandbox } from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'
import type { Span } from '@tangle-network/agent-eval'
import type { BenchTask } from './benchmarks/types'
import { DEFAULT_CAD_DIRECTIVE } from './directives'
import { runRefineLoop } from './refine-loop'

export { DEFAULT_CAD_DIRECTIVE } from './directives'

export interface CadWorkerConfig {
  sandboxBaseUrl: string
  sandboxKey: string
  routerBaseUrl: string
  routerKey: string
  model: string
  provider?: string
  timeoutMs?: number
}

export interface CadShotResult {
  /** The OpenSCAD source the agent wrote — the artifact the judge scores. */
  artifact: string
  /** Trace of the run for run-capsule: brief → code → compile → render. */
  trace: Span[]
  ok: boolean
  detail?: string
}

const SCAD_PATH = '/work/model.scad'
const STL_PATH = '/work/model.stl'
const PNG_PATH = '/work/model.png'

/** The acquired sandbox instance — the per-task execution Ctx for solveCadRefine. */
type SandboxBox = Awaited<ReturnType<typeof acquireSandbox>>

const randomSuffix = () => Math.random().toString(36).slice(2, 10)

/** Minimal openai-compatible chat call against the router (no new dep). */
async function routerChat(
  cfg: CadWorkerConfig,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const res = await fetch(`${cfg.routerBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.routerKey}` },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2 }),
  })
  if (!res.ok) throw new Error(`router ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content ?? ''
}

/** Strip markdown fences / prose so we keep just the OpenSCAD source. */
function extractScad(text: string): string {
  const fence = /```(?:openscad|scad|c|cpp)?\s*\n([\s\S]*?)```/i.exec(text)
  return (fence ? fence[1] : text).trim()
}

const execFileAsync = promisify(execFile)

/** Router chat that also returns token usage — the campaign's backend-integrity
 *  guard needs REAL tokens reported (never a fabricated zero), so the optimizer
 *  sees a real backend, not a stub. */
async function routerChatWithUsage(
  cfg: { routerBaseUrl: string; routerKey: string; model: string },
  messages: Array<{ role: string; content: string }>,
): Promise<{ content: string; usage: { input: number; output: number } }> {
  const res = await fetch(`${cfg.routerBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.routerKey}` },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2 }),
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

/** Run a local command, returning exit code + streams (never throws on nonzero —
 *  the geometry gate is the arbiter, so a failed compile still yields its error). */
async function runLocal(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { cwd, maxBuffer: 1 << 26, timeout: 120_000 })
    return { code: 0, stdout, stderr }
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string }
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? String(err) }
  }
}

export interface CadLocalConfig {
  routerBaseUrl: string
  routerKey: string
  model: string
  rounds?: number
  /** The authoring directive (system prompt) — the GEPA-optimizable surface. */
  directive?: string
}

export interface CadLocalShot {
  /** Final OpenSCAD source — the artifact the judge scores. */
  artifact: string
  /** First-round source (the blind shot, before any refine). */
  round1Artifact: string
  trace: Span[]
  /** Per-compiling-round render PNGs as data URIs (run-capsule reveal/orbit). */
  renders: string[]
  usage: { input: number; output: number }
  ok: boolean
  detail?: string
}

/**
 * LOCAL CAD refine loop — the staging-independent twin of `solveCadRefine`. The
 * model authors the `.scad` via the router under `directive`, the LOCAL openscad
 * kernel (`xvfb-run -a openscad`) gates + renders each round, and compiler
 * feedback drives the next round. Returns the final source, per-round renders, a
 * screenshot-rich trace, and REAL token usage. This is the seam the GEPA loop
 * drives: `directive` is the surface, the deterministic geometry gate is the reward.
 */
export async function solveCadRefineLocal(task: BenchTask, cfg: CadLocalConfig): Promise<CadLocalShot> {
  const rounds = Math.max(1, cfg.rounds ?? 3)
  const directive = cfg.directive ?? DEFAULT_CAD_DIRECTIVE
  const trace: Span[] = []
  const renders: string[] = []
  const runId = `cad-${task.id}`
  let ts = Date.now()
  const tick = () => (ts += 1)
  const usage = { input: 0, output: 0 }
  // Carried across rounds in closures (the round Artifact is the .scad source; the
  // lastErr steer + resolved early-stop persist outside the loop). usage is REAL.
  let lastErr = ''
  let resolved = false

  trace.push({ spanId: 's-brief', runId, kind: 'llm', name: 'brief', model: cfg.model, messages: [{ role: 'user', content: task.prompt }], startedAt: tick(), endedAt: tick(), status: 'ok' } as Span)

  // Migrated onto runRefineLoop: the mkdtemp dir is the Ctx; resolved (compiles AND
  // has geometry) is the early-stop, modeled as a judge so default-decide stops the
  // loop. The round-2+ steer carries lastErr + the prior source verbatim.
  const res = await runRefineLoop<string, string>({
    rounds,
    setup: () => mkdtemp(join(tmpdir(), 'cad-local-')),
    prompt: (round, history) =>
      round === 1
        ? task.prompt
        : `Your previous OpenSCAD had this problem:\n${lastErr}\n\nHere is the previous source:\n${history[history.length - 1]?.artifact ?? ''}\n\nFix it so it compiles AND better matches the brief:\n${task.prompt}`,
    runShot: async (user, round, dir) => {
      const scadPath = join(dir, 'model.scad')
      const stlPath = join(dir, 'model.stl')
      const pngPath = join(dir, 'model.png')
      const { content, usage: u } = await routerChatWithUsage(cfg, [
        { role: 'system', content: directive },
        { role: 'user', content: user },
      ])
      usage.input += u.input
      usage.output += u.output
      const scad = extractScad(content)
      trace.push({ spanId: `s-reply-${round}`, runId, kind: 'llm', name: `author r${round}`, model: cfg.model, messages: [{ role: 'user', content: round === 1 ? task.prompt : 'refine' }], output: content.slice(0, 600), startedAt: tick(), endedAt: tick(), status: 'ok' } as Span)
      trace.push({ spanId: `s-write-${round}`, runId, kind: 'tool', name: 'write_file', toolName: 'create_file', args: { path: 'model.scad', content: scad }, startedAt: tick(), endedAt: tick(), status: 'ok' } as Span)

      await writeFile(scadPath, scad)
      const compile = await runLocal('xvfb-run', ['-a', 'openscad', '-o', stlPath, scadPath], dir)
      const compileOk = compile.code === 0
      lastErr = compileOk ? '' : `${compile.stdout}\n${compile.stderr}`.trim().slice(0, 800)
      trace.push({ spanId: `s-compile-${round}`, runId, kind: 'tool', name: `openscad r${round}`, toolName: 'shell.exec', args: 'openscad -o model.stl model.scad', result: (compileOk ? compile.stderr : lastErr).slice(0, 1500) || 'ok', startedAt: tick(), endedAt: tick(), status: compileOk ? 'ok' : 'error', error: compileOk ? undefined : `exit ${compile.code}` } as Span)

      let screenshot: string | undefined
      if (compileOk) {
        // Full CGAL --render (not preview): clean coplanar faces, no z-fighting
        // speckle on the window/door cutouts. Dark Tomorrow-Night palette to match
        // the film; --autocenter --viewall frames any model regardless of its
        // dimensions (so the same command flatters every task in the set).
        const render = await runLocal('xvfb-run', ['-a', 'openscad', '-o', pngPath, '--render', '--imgsize=1280,960', '--colorscheme=Tomorrow Night', '--projection=perspective', '--autocenter', '--viewall', '--camera=0,0,0,60,0,25,0', scadPath], dir)
        if (render.code === 0) {
          const buf = await readFile(pngPath).catch(() => undefined)
          if (buf) {
            screenshot = `data:image/png;base64,${buf.toString('base64')}`
            renders.push(screenshot)
          }
        }
        const stl = await readFile(stlPath, 'utf8').catch(() => '')
        resolved = stl.length > 0 && /facet normal/.test(stl)
      }
      trace.push({ spanId: `s-render-${round}`, runId, kind: 'tool', name: `render r${round}`, toolName: 'render.screenshot', args: { action: `rendered round ${round}`, url: 'model.png' }, attributes: screenshot ? { screenshot } : {}, startedAt: tick(), endedAt: tick(), status: screenshot ? 'ok' : 'error', error: screenshot ? undefined : (compileOk ? 'render produced no image' : 'skipped — did not compile') } as Span)
      return { artifact: scad }
    },
    judge: async () => ({ valid: resolved }),
    teardown: (dir) => rm(dir, { recursive: true, force: true }).then(() => {}, () => {}),
  })

  return {
    artifact: res.final.artifact,
    round1Artifact: res.blind.artifact,
    trace,
    renders,
    usage,
    ok: res.final.artifact.trim().length > 0,
    detail: resolved ? `compiled in ≤${rounds} rounds` : `did not compile cleanly in ${rounds} rounds${lastErr ? `; last: ${lastErr.slice(0, 120)}` : ''}`,
  }
}

export interface CadRefineConfig extends CadWorkerConfig {
  /** Max author→gate→refine rounds. Default 3. */
  rounds?: number
}

/**
 * Orchestrated CAD refine loop: a BARE universal sandbox is the CAD compute +
 * render environment (reliable to provision); the model authors the `.scad` via
 * the router, the box's own openscad gates + renders each round, and the
 * compiler/geometry feedback drives the next round until it passes or rounds run
 * out. This is the "design in a loop" path — every round's render is captured,
 * so the trace shows the model improving the house across attempts.
 */
export async function solveCadRefine(task: BenchTask, cfg: CadRefineConfig): Promise<CadShotResult> {
  const rounds = cfg.rounds ?? 3
  const client = new Sandbox({ baseUrl: cfg.sandboxBaseUrl, apiKey: cfg.sandboxKey })
  const t0 = Date.now()
  const trace: Span[] = []
  const runId = `cad-${task.id}`
  let ts = t0
  const tick = () => (ts += 1)
  // The authoring system prompt for the orchestrated sandbox path — kept verbatim,
  // distinct from DEFAULT_CAD_DIRECTIVE (the local path's GEPA surface).
  const sys = 'You are an expert OpenSCAD engineer. Output ONLY valid OpenSCAD source — no prose, no markdown fences. The model must compile with `openscad -o out.stl model.scad`.'
  // Carried across rounds in closures (the round Artifact is the .scad source; the
  // lastErr steer + resolved early-stop persist outside the loop).
  let lastErr = ''
  let resolved = false

  // Migrated onto runRefineLoop: the universal sandbox box is the Ctx (acquired once,
  // /work created in setup, torn down in teardown). resolved (compiles AND has
  // geometry) is the early-stop, modeled as a judge so default-decide stops the loop.
  // The round-2+ steer carries lastErr + the prior source verbatim.
  const res = await runRefineLoop<string, SandboxBox>({
    rounds,
    setup: async () => {
      const box = await acquireSandbox(client, {
        name: `cad-${task.id}-${randomSuffix()}`.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 60),
        environment: 'universal',
      })
      await box.exec('mkdir -p /work', { timeoutMs: 30_000 })
      // The brief frames the title card (understood_task).
      trace.push({ spanId: 's-brief', runId, kind: 'llm', name: 'brief', model: cfg.model, messages: [{ role: 'user', content: task.prompt }], startedAt: tick(), endedAt: tick(), status: 'ok' } as Span)
      return box
    },
    prompt: (round, history) =>
      round === 1
        ? task.prompt
        : `Your previous OpenSCAD had this problem:\n${lastErr}\n\nHere is the previous source:\n${history[history.length - 1]?.artifact ?? ''}\n\nFix it so it compiles AND better matches the brief:\n${task.prompt}`,
    runShot: async (user, round, box) => {
      const reply = await routerChat(cfg, [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ])
      const scad = extractScad(reply)
      trace.push({ spanId: `s-reply-${round}`, runId, kind: 'llm', name: `author r${round}`, model: cfg.model, messages: [{ role: 'user', content: round === 1 ? task.prompt : 'refine' }], output: reply.slice(0, 600), startedAt: tick(), endedAt: tick(), status: 'ok' } as Span)
      trace.push({ spanId: `s-write-${round}`, runId, kind: 'tool', name: 'write_file', toolName: 'create_file', args: { path: 'model.scad', content: scad }, startedAt: tick(), endedAt: tick(), status: 'ok' } as Span)

      await box.fs.write(SCAD_PATH, scad)
      const compile = await box.exec(`xvfb-run -a openscad -o ${STL_PATH} ${SCAD_PATH}`, { timeoutMs: 120_000 })
      const compileOk = compile.exitCode === 0
      lastErr = compileOk ? '' : `${compile.stdout}\n${compile.stderr}`.trim().slice(0, 800)
      trace.push({ spanId: `s-compile-${round}`, runId, kind: 'tool', name: `openscad r${round}`, toolName: 'shell.exec', args: 'openscad -o model.stl model.scad', result: (compileOk ? compile.stderr : lastErr).slice(0, 1500) || 'ok', startedAt: tick(), endedAt: tick(), status: compileOk ? 'ok' : 'error', error: compileOk ? undefined : `exit ${compile.exitCode}` } as Span)

      let screenshot: string | undefined
      if (compileOk) {
        const render = await box.exec(`xvfb-run -a openscad -o ${PNG_PATH} --imgsize=1100,850 --camera=40,30,40,55,0,25,260 --colorscheme=Tomorrow ${SCAD_PATH}`, { timeoutMs: 120_000 })
        if (render.exitCode === 0) {
          const localPng = join(tmpdir(), `cad-${task.id}-r${round}-${randomSuffix()}.png`)
          await box.fs.download(PNG_PATH, localPng).catch(() => undefined)
          const buf = await readFile(localPng).catch(() => undefined)
          if (buf) screenshot = `data:image/png;base64,${buf.toString('base64')}`
        }
        // Geometry gate: read STL back + check it's non-trivial (the adapter judge
        // does the full spec scoring; here we just decide whether to stop refining).
        const stl = await box.fs.read(STL_PATH).catch(() => '')
        resolved = stl.length > 0 && /facet normal/.test(stl)
      }
      trace.push({ spanId: `s-render-${round}`, runId, kind: 'tool', name: `render r${round}`, toolName: 'render.screenshot', args: { action: `rendered round ${round}`, url: 'model.png' }, attributes: screenshot ? { screenshot } : {}, startedAt: tick(), endedAt: tick(), status: screenshot ? 'ok' : 'error', error: screenshot ? undefined : (compileOk ? 'render produced no image' : 'skipped — did not compile') } as Span)
      return { artifact: scad }
    },
    judge: async () => ({ valid: resolved }),
    teardown: async (box) => {
      try {
        await box.delete()
      } catch {
        // staging reaps on expiry
      }
    },
  })

  const artifact = res.final.artifact
  return { artifact, trace, ok: artifact.trim().length > 0, detail: resolved ? `resolved in ≤${rounds} rounds` : `did not fully resolve in ${rounds} rounds${lastErr ? `; last: ${lastErr.slice(0, 120)}` : ''}` }
}

/** Run one CAD authoring shot in a real sandbox, gating with the box's own
 *  openscad and capturing a screenshot-rich trace. */
export async function solveCadShot(task: BenchTask, cfg: CadWorkerConfig): Promise<CadShotResult> {
  const client = new Sandbox({ baseUrl: cfg.sandboxBaseUrl, apiKey: cfg.sandboxKey })
  const box = await acquireSandbox(client, {
    name: `cad-${task.id}-${randomSuffix()}`.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 60),
    environment: 'universal',
    backend: {
      type: 'opencode',
      model: {
        provider: cfg.provider ?? 'openai',
        model: cfg.model,
        baseUrl: cfg.routerBaseUrl,
        apiKey: cfg.routerKey,
      },
    },
  })

  const t0 = Date.now()
  const trace: Span[] = []
  const runId = `cad-${task.id}`

  try {
    const prompt = [
      task.prompt,
      '',
      `Write the OpenSCAD source to ${SCAD_PATH} (create the /work directory if needed).`,
      `Then verify it compiles by running: xvfb-run -a openscad -o ${STL_PATH} ${SCAD_PATH}`,
      `Fix any errors until it compiles cleanly and the geometry matches the brief. Then stop.`,
      `The file at ${SCAD_PATH} is the deliverable.`,
    ].join('\n')

    // Conversation: the brief (understood_task) + the agent's reply.
    trace.push({
      spanId: 's-brief',
      runId,
      kind: 'llm',
      name: 'brief',
      model: cfg.model,
      messages: [{ role: 'user', content: task.prompt }],
      startedAt: t0,
      endedAt: t0,
      status: 'ok',
    } as Span)

    const signal = cfg.timeoutMs ? AbortSignal.timeout(cfg.timeoutMs) : undefined
    let lastErr: string | undefined
    let agentText = ''
    for await (const ev of box.streamPrompt(prompt, signal ? { signal } : {})) {
      if (ev?.type === 'error') lastErr = JSON.stringify(ev.data).slice(0, 300)
      const text = typeof (ev as { text?: unknown })?.text === 'string' ? (ev as unknown as { text: string }).text : ''
      if (text) agentText += text
    }

    const artifact = await box.fs.read(SCAD_PATH).catch(() => '')
    if (artifact.trim()) {
      trace.push({
        spanId: 's-write',
        runId,
        kind: 'tool',
        name: 'write_file',
        toolName: 'create_file',
        args: { path: 'model.scad', content: artifact },
        startedAt: t0 + 1,
        endedAt: t0 + 2,
        status: 'ok',
      } as Span)
    }

    // GATE + RENDER in the sandbox itself (the box's own openscad/xvfb).
    const compile = await box.exec(`xvfb-run -a openscad -o ${STL_PATH} ${SCAD_PATH}`, {
      timeoutMs: 120_000,
    })
    trace.push({
      spanId: 's-compile',
      runId,
      kind: 'tool',
      name: 'openscad compile',
      toolName: 'shell.exec',
      args: `openscad -o model.stl model.scad`,
      result: `${compile.stdout}\n${compile.stderr}`.trim().slice(0, 2000),
      startedAt: t0 + 3,
      endedAt: t0 + 4,
      status: compile.exitCode === 0 ? 'ok' : 'error',
      error: compile.exitCode === 0 ? undefined : `openscad exit ${compile.exitCode}`,
    } as Span)

    let screenshot: string | undefined
    if (compile.exitCode === 0) {
      const render = await box.exec(
        `xvfb-run -a openscad -o ${PNG_PATH} --imgsize=1100,850 --camera=40,30,40,55,0,25,260 --colorscheme=Tomorrow ${SCAD_PATH}`,
        { timeoutMs: 120_000 },
      )
      if (render.exitCode === 0) {
        const localPng = join(tmpdir(), `cad-${task.id}-${randomSuffix()}.png`)
        await box.fs.download(PNG_PATH, localPng).catch(() => undefined)
        const buf = await readFile(localPng).catch(() => undefined)
        if (buf) screenshot = `data:image/png;base64,${buf.toString('base64')}`
      }
    }
    // Screen span carrying the render — drives run-capsule's screen capsule.
    trace.push({
      spanId: 's-render',
      runId,
      kind: 'tool',
      name: 'render',
      toolName: 'render.screenshot',
      args: { action: 'rendered model.scad', url: 'model.png' },
      attributes: screenshot ? { screenshot } : {},
      startedAt: t0 + 5,
      endedAt: t0 + 6,
      status: screenshot ? 'ok' : 'error',
      error: screenshot ? undefined : 'render produced no image',
    } as Span)

    // Agent's closing reply (conversation capsule).
    if (agentText.trim()) {
      trace.push({
        spanId: 's-reply',
        runId,
        kind: 'llm',
        name: 'reply',
        model: cfg.model,
        messages: [{ role: 'user', content: task.prompt }],
        output: agentText.trim().slice(0, 600),
        startedAt: t0 + 7,
        endedAt: t0 + 8,
        status: 'ok',
      } as Span)
    }

    return {
      artifact,
      trace,
      ok: artifact.trim().length > 0 && compile.exitCode === 0,
      detail:
        artifact.trim().length === 0
          ? `no .scad written${lastErr ? `; lastError=${lastErr}` : ''}`
          : compile.exitCode === 0
            ? undefined
            : `compiled with exit ${compile.exitCode}`,
    }
  } finally {
    try {
      await box.delete()
    } catch {
      /* staging reaps on expiry */
    }
  }
}
