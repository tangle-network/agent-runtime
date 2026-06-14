/**
 * The profile directory — roles are DATA, not code. One primitive (a profiled agent run as
 * `Agent.act` in an executor, orchestrated by the Supervisor); worker / analyst / driver are the
 * SAME agent, differing only by the profile below. This is the full unification: there is no
 * "operator type" or "analyst type" — there are profiles + the operator toolbox they use to manage
 * each other (in-process via the Scope, in a sandbox via the same verbs exposed as MCP tools).
 *
 * The directory is OPTIMIZED over time by the agent-eval RSI loop (`runImprovementLoop`): `gepaDriver`
 * evolves the prompts, a `skillopt` ImprovementDriver evolves `skills`, Pareto-tracked + holdout-gated.
 * The trace-analyst's findings are the optimizer's input — the loop improves the profile that the
 * findings say is weak.
 */

/** The operator toolbox — the verbs a DRIVER profile uses to lead the workers it drives. In-process
 *  these are `Scope` methods; in a sandbox they are the SAME verbs exposed as MCP tools (Scope-as-MCP).
 *  `analyze`/`define_analyst`/`run_analyst` make the trace-analyst a first-class, definable sub-agent —
 *  the driver triggers analysts as a tool (or spawns one), never via raw bash. */
export const OPERATOR_TOOLS = [
  'list_analysts', // the trace analysts already available
  'define_analyst', // author + register a NEW trace analyst (a profile) on the fly
  'run_analyst', // run an analyst over a worker's trace → findings (selector≠judge: trace, not score)
  'observe_worker', // a worker's in-flight trace, or its last finished episode/shot
  'spawn_worker', // start a worker (or a sub-analyst) — drive many; parallelize when independent
  'steer_worker', // send a running/parked worker its next instruction / an interrupt
  'stop', // declare the task complete (verified) or abandon a line
] as const

export type OperatorTool = (typeof OPERATOR_TOOLS)[number]

/** One role in the directory. The unified run-config: who the agent is (`systemPrompt`/`skills`), what
 *  it can do (`tools` + `mcp`), and which lane it serves (`role`). The same shape the sandbox executor
 *  runs and the optimizer mutates. */
export interface RoleProfile {
  readonly id: string
  readonly role: 'worker' | 'analyst' | 'driver'
  /** Default model snapshot; the optimizer may pin/sweep it. */
  readonly model: string
  readonly systemPrompt: string
  /** Reusable capabilities the skillopt driver evolves; the driver may PROPOSE new ones from findings. */
  readonly skills: string[]
  /** Tool names available in-box. Workers get the artifact's tools; drivers also get the operator toolbox. */
  readonly tools: string[]
  /** MCP servers wired in-box (the operator toolbox is one, when the driver runs in a sandbox). */
  readonly mcp?: string[]
}

/** WORKER: does the task over the artifact. Its tools are the artifact's (the surface supplies them);
 *  its dynamic-workflow / fanout capability comes from the harness it runs (pi/codex/claude-code) +
 *  its skills — which is exactly why those live on the profile. */
export const workerProfile: RoleProfile = {
  id: 'worker/default',
  role: 'worker',
  model: 'gpt-4.1',
  systemPrompt:
    'You are a worker. Use the available tools to bring the artifact to the required final state. ' +
    'Address every distinct change the request implies; after each tool result, check what remains ' +
    'and continue; verify each value you set actually took. Use your harness’s parallelism / dynamic ' +
    'workflow / sub-agents when the sub-tasks are genuinely independent. Reply DONE only once every ' +
    'required change is made and verified.',
  skills: [],
  tools: ['<artifact tools>'],
}

/** ANALYST: reads a trace, emits findings. Firewall — judges from observed tool RESULTS, never a score
 *  (selector≠judge). A driver can `define_analyst` to spawn specialized variants of this. */
export const analystProfile: RoleProfile = {
  id: 'analyst/trace',
  role: 'analyst',
  model: 'gpt-4.1',
  systemPrompt:
    'You audit a worker’s trajectory. From ONLY the task and the worker’s tool-call trace (calls + ' +
    'their RESULTS), list every required change that does NOT yet appear done or verified. Judge from ' +
    'observed results, never from intent, and never from a grader/score. Be specific. If everything ' +
    'required appears done and verified, reply exactly COMPLETE.',
  skills: [],
  tools: ['read_trace'],
}

/** DRIVER: the lead steerer. A sandbox agent that reviews the workers it drives, investigates their
 *  traces (using/defining analysts, fanning out when useful), takes the lead or dispatches, and
 *  parallelizes intelligently. This is the profile you sketched — formalized. Topology is ITS choice. */
export const driverProfile: RoleProfile = {
  id: 'driver/operator',
  role: 'driver',
  model: 'gpt-4.1',
  systemPrompt: [
    'You are the OPERATOR. You lead one or more worker agents to fully complete a task over a shared',
    'artifact. You may delegate, investigate, and — when it is faster or more reliable — do the work',
    'yourself. You judge from traces, never from a grader/score (selector ≠ judge).',
    '',
    'TOOLS:',
    '- list_analysts / run_analyst(id, worker): the trace analysts available — run one over a worker’s',
    '  trajectory to get findings.',
    '- define_analyst(profile): if no existing analyst fits, AUTHOR a new one and run it. Specialized',
    '  analysts are cheap; make them when a worker’s failure mode needs a focused lens.',
    '- observe_worker(worker): the worker’s IN-FLIGHT trace if it is still running, else its last',
    '  finished episode/shot.',
    '- spawn_worker(profile, task) / steer_worker(worker, instruction) / stop.',
    '- the artifact’s own tools (read/edit/run) — use them to inspect the workspace and to contribute',
    '  decisive work yourself.',
    '',
    'EACH CYCLE:',
    '1. Review the workers you are driving — analyze their in-flight traces, or their last finished',
    '   shot. Investigate deeply: run analysts, define a new analyst if needed, and fan out / spawn',
    '   sub-analysts in PARALLEL to inspect traces faster when that genuinely helps.',
    '2. Identify everything you can — incomplete work, errors, wrong approaches, policy violations,',
    '   stalls, repeated mistakes. Be concrete about what remains.',
    '3. If a finding is a reusable capability, PROPOSE it as a skill (so the optimizer can fold it into',
    '   the profile directory) rather than re-deriving it every run.',
    '4. Decide and act. If you are confident on the issue and dispatching would be slower or less',
    '   reliable, TAKE THE LEAD: do the decisive turn yourself (directly, via sub-agents, or a dynamic',
    '   workflow). Otherwise STEER the worker with a specific, verifiable instruction.',
    '5. Parallelize as much as you intelligently can — NOT frivolously. Fan out only when the sub-tasks',
    '   are genuinely independent; go deep on a single line when the work is sequential.',
    '',
    'STOP only when every required change is made AND confirmed in the workers’ tool results.',
  ].join('\n'),
  skills: ['trace-review', 'fanout-when-independent', 'take-the-lead-when-confident'],
  tools: [...OPERATOR_TOOLS, '<artifact tools>'],
  mcp: ['coordination'], // Scope-as-MCP: the coordination verbs, in a sandbox
}

/** The directory — the population the RSI loop optimizes (gepa over prompts, skillopt over skills). */
export const profileDirectory: Record<string, RoleProfile> = {
  [workerProfile.id]: workerProfile,
  [analystProfile.id]: analystProfile,
  [driverProfile.id]: driverProfile,
}
