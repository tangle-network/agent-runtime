/**
 * createVerifierEnvironment — ANY checkable task as an `Environment`, no tool surface
 * required. The generalization piece: EOPS/commit0-style domains have tools that mutate
 * an external artifact, but math problems, legal drafts, creative briefs, GTM copy, and
 * QA tasks have a different shape — the artifact IS the worker's answer, and the domain
 * is defined by one function: the deployable check over that answer.
 *
 *   const gsm8k = createVerifierEnvironment({
 *     name: 'gsm8k',
 *     check: (task, answer) => ({
 *       passes: extractFinalNumber(answer) === task.meta?.answer ? 1 : 0,
 *       total: 1,
 *       errored: 0,
 *     }),
 *   })
 *   await runBenchmark({ environment: gsm8k, tasks, worker })   // sample vs refine on math
 *
 * The worker gets one built-in tool — `submit_answer` — plus any read-only domain tools
 * the caller adds (a calculator, a retrieval call, a style guide lookup). Every
 * submission is kept; `score()` checks the BEST submission (keep-best is the measured
 * law: workers reach correct answers then revise past them). The refine strategy's
 * critic reads the submission trajectory like any other trace, so iterate-with-feedback
 * works unchanged on answer domains.
 *
 * The check can be graded (passes/total expresses partial credit — rubric points,
 * sub-answers, unit-test counts), and MUST be deployable (computable without an oracle
 * at serve time): exact/numeric match, schema validation, a compiled rubric — not a
 * peek at held-out labels the production system wouldn't have.
 */

import type { Environment } from './run-benchmark'
import type { AgenticTask, AgenticTool, ArtifactHandle, SurfaceScore } from './strategy'

export interface VerifierEnvironmentOptions {
  name: string
  /** The deployable check over a submitted answer. Graded via passes/total. */
  check(task: AgenticTask, answer: string): Promise<SurfaceScore> | SurfaceScore
  /** Extra domain tools (read-only helpers: calculator, retrieval, style lookup). */
  extraTools?: AgenticTool[]
  /** Executes the extra tools. Required when `extraTools` is set. */
  callExtra?(
    task: AgenticTask,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> | string
}

interface AnswerState {
  task: AgenticTask
  submissions: string[]
}

const submitTool: AgenticTool = {
  type: 'function',
  function: {
    name: 'submit_answer',
    description:
      'Submit your answer for evaluation. You may submit more than once — the best-scoring submission counts. Submit the COMPLETE final answer, not a fragment.',
    parameters: {
      type: 'object',
      properties: { answer: { type: 'string', description: 'The complete final answer.' } },
      required: ['answer'],
    },
  },
}

export function createVerifierEnvironment(opts: VerifierEnvironmentOptions): Environment {
  if (opts.extraTools?.length && !opts.callExtra) {
    throw new Error(`${opts.name}: extraTools requires callExtra`)
  }
  const states = new Map<string, AnswerState>()
  let seq = 0

  return {
    name: opts.name,

    async open(task) {
      seq += 1
      const handle: ArtifactHandle = { id: `${opts.name}-${seq}`, surface: opts.name }
      states.set(handle.id, { task, submissions: [] })
      return handle
    },

    async tools() {
      return [submitTool, ...(opts.extraTools ?? [])]
    },

    async call(handle, name, args) {
      const state = states.get(handle.id)
      if (!state) return 'ERROR: workspace closed'
      if (name === 'submit_answer') {
        const answer = String(args.answer ?? '').trim()
        if (!answer) return 'ERROR: empty answer'
        state.submissions.push(answer)
        return `submission ${state.submissions.length} recorded`
      }
      if (opts.callExtra && opts.extraTools?.some((t) => t.function.name === name)) {
        try {
          return await opts.callExtra(state.task, name, args)
        } catch (e) {
          return `ERROR: ${e instanceof Error ? e.message : String(e)}`
        }
      }
      return `ERROR: unknown tool ${name}`
    },

    // Keep-best across submissions — the measured law (workers reach correct answers,
    // then revise past them; final-state scoring undersells every strategy).
    async score(task, handle) {
      const state = states.get(handle.id)
      if (!state || state.submissions.length === 0) return { passes: 0, total: 1, errored: 0 }
      let best: SurfaceScore = { passes: 0, total: 1, errored: 0 }
      const ratio = (s: SurfaceScore) => (s.total > 0 ? s.passes / s.total : 0)
      for (const answer of state.submissions) {
        const s = await opts.check(task, answer)
        if (ratio(s) > ratio(best)) best = s
      }
      return best
    },

    async close(handle) {
      states.delete(handle.id)
    },
  }
}
