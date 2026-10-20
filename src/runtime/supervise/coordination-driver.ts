/**
 *
 * `driverAgent` — the driver's BRAIN.
 *
 * The recursive driver-executor (`driver-executor.ts`) runs a driver `Agent.act` inside a
 * nested `Scope`; this is the intelligent `act`: it mounts the coordination MCP verbs
 * (`createCoordinationTools`) over that scope and runs an LLM tool-loop, so the driver
 * REASONS — spawn / observe / steer / await / stop — about how to drive its children,
 * instead of running a fixed script. Each turn: ask the driver LLM for tool calls, run them
 * against the live scope, fold the results back, repeat until the driver stops (no tool
 * calls) or the turn cap forces a keep-best finalize.
 *
 * Recursion composes through `makeWorkerAgent`: `spawn_worker` resolves a `profile` to a
 * worker LEAF or — when the profile is a driver — a `driverChild` wrapping ANOTHER
 * `driverAgent` over its own nested scope (see `driver-executor.ts`). So an agent
 * drives an agent that drives an agent, each an LLM tool-loop, all on one conserved-budget
 * tree.
 *
 * Two seams are INJECTED so the loop runs offline with no creds and stays decoupled:
 *  - `brain` (`ToolLoopChat`) — one driver-LLM turn over the canonical tool-loop seam; a test
 *    drives a scripted mock, production passes the router's tool-calling (`routerBrain`), a
 *    sandboxed harness drives the verbs as MCP tools. The same seam every tool-loop uses.
 *  - `systemPrompt` — the driver's stance (the agent-eval worker-driver prompt / the prompt
 *    generator). Injected, never hardcoded — the prompt is a pluggable role.
 *
 * @experimental
 */

export type { DriverAgentOptions } from './driver-agent-options'
export { driverAgent } from './driver-brain-agent'
export type { RootSteer } from './driver-control-acknowledgers'
export {
  createCancelAcknowledger,
  createSteerAcknowledger,
  steerAcknowledgementDetail,
} from './driver-control-acknowledgers'
export { validateDriverPromptCache } from './driver-prompt-cache'
export { finalizeBestDelivered } from './finalizer'
