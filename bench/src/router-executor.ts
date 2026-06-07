/**
 * Router-backed `SandboxClient` — the "router" cost-dial backend the one-flow header
 * names (experiment.ts: "backend = the injected SandboxClient (router / local-bridge /
 * sandbox)"). Each box the kernel provisions runs ONE research shot per `streamPrompt`
 * (router web-search + answer, off-sandbox) and emits the terminal `{ finalText }` event
 * `answerOutput` already parses.
 *
 * Why off-sandbox: research is retrieval, not in-box code execution — it never needed a
 * box, and a real sandbox box reaches only the router (egress allowlist, ops-board #976),
 * so it cannot web-search natively anyway. Routing the executor through the router instead
 * of a box lets the REAL `runLoop` kernel drive research with full `rounds` + analyst
 * steering (multi-round, resumable-by-steer — the depth regime), search working, with no
 * sandbox dependency.
 *
 * No `criuStatus`/`describePlacement` ⇒ the kernel uses a fresh executor per iteration
 * (no fork, no live box across rounds); statefulness comes from the loop's across-round
 * steer (the arm reshapes round N's prompt from round N-1's trace), not a live session.
 */
import type { SandboxClient } from '@tangle-network/agent-runtime/loops'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { runResearchShot, type ShotCfg } from './research-shot'

export function routerSandboxClient(cfg: ShotCfg): SandboxClient {
  let seq = 0
  return {
    async create(_options?: CreateSandboxOptions): Promise<SandboxInstance> {
      const id = `router-research-${seq++}`
      return {
        id,
        async *streamPrompt(message: string): AsyncGenerator<SandboxEvent> {
          const shot = await runResearchShot(message, id, 0, cfg)
          yield {
            type: 'result',
            data: { finalText: shot.answer, success: shot.ok, searches: shot.searches },
          } satisfies SandboxEvent
        },
        async delete(): Promise<void> {},
      } as unknown as SandboxInstance
    },
  }
}
