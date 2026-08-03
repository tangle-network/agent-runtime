/**
 * Router-backed research executor — the "router" cost-dial backend (experiment.ts:
 * "backend = the injected SandboxClient (router / bridge / sandbox)"). Each run is
 * ONE research shot (router web-search + answer, off-sandbox); its answer is the
 * terminal `finalText` the kernel's `answerOutput` parses.
 *
 * Why off-sandbox: research is retrieval, not in-box code execution — it never
 * needed a box, and a real sandbox box reaches only the router (egress allowlist,
 * ops-board #976), so it cannot web-search natively anyway. Driving the loop with
 * this executor instead of a box gives the REAL `runAgentRounds` kernel full `rounds` +
 * analyst steering (the depth regime), search working, no sandbox dependency.
 *
 * This is a BYO `Executor` over `runResearchShot`; `inlineSandboxClient` supplies
 * the one shared box-shell so this file owns only the research-shot specifics
 * (no hand-rolled create/streamPrompt/delete). A fresh executor per round ⇒ no
 * fork/live session; statefulness is the across-round steer, not a box.
 */
import {
  type ExecutorFactory,
  type ExecutorResult,
  inlineSandboxClient,
  type SandboxClient,
} from '@tangle-network/agent-runtime/kernel'
import { runResearchShot, type ShotCfg } from './research-shot'

export function routerSandboxClient(cfg: ShotCfg): SandboxClient {
  let seq = 0
  const factory: ExecutorFactory<unknown> = () => {
    const id = `router-research-${seq++}`
    let artifact: ExecutorResult<unknown> | undefined
    return {
      runtime: 'router',
      async execute(task): Promise<ExecutorResult<unknown>> {
        const started = Date.now()
        const shot = await runResearchShot(String(task), id, 0, cfg)
        artifact = {
          outRef: `router-research:${id}`,
          out: { content: shot.answer },
          spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: Date.now() - started },
        }
        return artifact
      },
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact() {
        if (!artifact) throw new Error('routerSandboxClient: resultArtifact() read before execute()')
        return artifact
      },
    }
  }
  return inlineSandboxClient(factory)
}
