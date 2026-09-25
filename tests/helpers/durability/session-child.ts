/**
 * One PHASE of the re-attach (session-backed worker) conformance run, as its own OS process.
 *
 * Usage: `node --import tsx session-child.ts <dir> <phase:1|2> [killAt]`
 *
 * Identical to `graph-child.ts` except the three worker nodes execute as SESSION-BACKED leaves
 * (out-of-process doubles that journal retained admissions and re-attach after a coordinator
 * death via `runGraph({ recoverExecutor })`), so a mid-session SIGKILL must RESUME the session,
 * never restart it.
 */

const [dir, phase, killAt] = process.argv.slice(2)
if (dir === undefined || (phase !== '1' && phase !== '2')) {
  throw new Error('usage: session-child.ts <dir> <phase:1|2> [killAt]')
}
if (phase === '2' && killAt !== undefined) {
  throw new Error('usage: phase 2 resumes; it never arms a kill')
}

const { armKillSwitch } = await import('./kill-switch')
const { RUN_ID, ConductorPlanner, conformanceGraph, readExecLog } = await import(
  './conformance-graph'
)
const { openSideEffectSite, SIDE_EFFECT_TOOL_NAME, sideEffectToolSpec } = await import(
  './side-effect'
)
const { sessionBackedLeafSeam } = await import('./session-backed-leaf')
const { runGraph } = await import('../../../src/runtime/supervise/graph')

const kill = armKillSwitch({
  ...(killAt === undefined ? {} : { killAt }),
  labelsFile: `${dir}/labels-phase-${phase}.log`,
  killedFile: `${dir}/killed.log`,
})
const site = openSideEffectSite(dir)
const seam = sessionBackedLeafSeam(dir, phase, kill)
const planner = new ConductorPlanner()
let brainCalls = 0
const brain = async (messages: ReadonlyArray<Record<string, unknown>>) => {
  brainCalls += 1
  kill(`driver:turn:${brainCalls}:before`)
  const turn = planner.nextTurn(messages)
  kill(`driver:turn:${brainCalls}:after`)
  return turn
}
const result = await runGraph(conformanceGraph(), {
  runId: RUN_ID,
  runDir: dir,
  workerSlots: 3,
  maxTurns: 24,
  perWorker: { maxIterations: 60, maxTokens: 500_000 },
  brain,
  makeLeafAgent: seam.makeLeafAgent,
  recoverExecutor: seam.recoverExecutor,
  extraTools: [sideEffectToolSpec()],
  executeExtraTool: async (name, args) => {
    if (name !== SIDE_EFFECT_TOOL_NAME) return null
    kill('tool:commit:before')
    const receipt = site.commit(String(args.idempotencyKey), args.payload)
    kill('tool:commit:after-effect')
    return JSON.stringify(receipt)
  },
})
process.stdout.write(
  `${JSON.stringify({
    phase,
    kind: result.result.kind,
    ...(result.result.kind === 'winner' ? { out: result.result.out } : { out: null }),
    exec: readExecLog(dir, phase),
    escalations: planner.report().escalations,
    committedEffects: site.committedKeys(),
    steps: seam.stepLog(phase),
    reattached: seam.reattachLog(phase),
    driverTurns: planner.report().turns,
    ...('fatal' in planner.report() ? { fatal: planner.report().fatal } : {}),
  })}\n`,
)
