/**
 * Lean prover-verifier gate — a real "prover-verifier loop" for MATH, the pipeline-math pattern
 * on this substrate. It is `math-demo.mts` with the `check` swapped from a numeric compare to the
 * REAL Lean 4 compiler: a prover model proposes a proof, Lean verifies it (ground truth, cannot be
 * fooled), the error feeds back, and it retries. There is NO new "loop" primitive — the loop is the
 * existing `refine` strategy over `createVerifierEnvironment`; the only new thing is the verifier.
 *
 * Two loops stack: within a turn the model calls the `lean_check` tool (real compiler) to fix its
 * proof (the humaneval-repair pattern), and across shots `refine` carries the failure forward.
 *
 * Run the DETERMINISTIC VERIFIER right now, no model, no key (proves the judge is real):
 *   tsx src/examples/lean-proof-gate.mts --verify-only
 *
 * Run the FULL prover-verifier loop (real agent iterating against Lean):
 *   TANGLE_API_KEY=… WORKER_MODEL=gpt-4.1 BUDGET=3 tsx src/examples/lean-proof-gate.mts
 */
import {
  type AgenticTask,
  createVerifierEnvironment,
  printBenchmarkReport,
  refine,
  runBenchmark,
  sample,
  sampleThenRefine,
} from '@tangle-network/agent-runtime/kernel'
import { ensureLeanImage, leanCheck } from './lean-verify.js'

// Real, mathlib-free Lean 4 theorems (compile in core Lean). `header` is everything up to `:=`;
// the prover supplies the proof term / tactic block. `reference` is a known-good proof used only
// by --verify-only to prove the verifier — the graded run never sees it.
interface ProofTask {
  id: string
  header: string
  statement: string
  reference: string
}

const PROBLEMS: ProofTask[] = [
  {
    id: 'and-swap',
    header: 'theorem and_swap (p q : Prop) (h : p ∧ q) : q ∧ p',
    statement: 'From a proof of `p ∧ q`, produce a proof of `q ∧ p`.',
    reference: '⟨h.2, h.1⟩',
  },
  {
    id: 'or-swap',
    header: 'theorem or_swap (p q : Prop) (h : p ∨ q) : q ∨ p',
    statement: 'From a proof of `p ∨ q`, produce a proof of `q ∨ p`.',
    reference: 'h.symm',
  },
  {
    id: 'add-comm',
    header: 'theorem add_comm_nat (a b : Nat) : a + b = b + a',
    statement: 'Addition of natural numbers is commutative.',
    reference: 'by omega',
  },
  {
    id: 'mul-one',
    header: 'theorem mul_one_nat (n : Nat) : n * 1 = n',
    statement: 'Multiplying a natural number by one gives the number.',
    reference: 'by simp',
  },
  {
    id: 'reverse-reverse',
    header: 'theorem reverse_reverse {α : Type} (l : List α) : l.reverse.reverse = l',
    statement: 'Reversing a list twice returns the original list.',
    reference: 'by simp',
  },
]

const SYSTEM =
  'You are a Lean 4 theorem prover. Prove the theorem. You have a `lean_check` tool that runs the ' +
  'REAL Lean compiler on a candidate proof and returns the exact error — call it to iterate until ' +
  'it compiles. Then submit ONLY the proof (everything that goes after `:=`, e.g. `⟨h.2, h.1⟩` or ' +
  '`by omega`) with `submit_answer`. Never use `sorry`, `admit`, or `native_decide`.'

const tasks: AgenticTask[] = PROBLEMS.map((p) => ({
  id: p.id,
  systemPrompt: SYSTEM,
  userPrompt: `Prove this Lean 4 theorem.\n\n${p.header} := ?\n\nStatement: ${p.statement}`,
  meta: { header: p.header },
}))

const leanEnv = createVerifierEnvironment({
  name: 'lean-proofs',
  // THE VERIFIER — real Lean, deterministic. settled.valid ⟺ Lean accepts a real (non-sorry) proof.
  check: async (task, answer) => {
    const header = (task.meta as { header: string }).header
    const r = await leanCheck(header, answer)
    return { passes: r.passed ? 1 : 0, total: 1, errored: 0 }
  },
  // The prover's mid-turn verifier tool — it compiles a candidate against real Lean and returns the error.
  extraTools: [
    {
      type: 'function',
      function: {
        name: 'lean_check',
        description:
          'Compile a candidate proof with the real Lean 4 compiler. Returns ACCEPTED, or the Lean error to fix. Pass only the proof (what follows `:=`).',
        parameters: {
          type: 'object',
          properties: { proof: { type: 'string', description: 'The proof term or `by ...` tactic block.' } },
          required: ['proof'],
        },
      },
    },
  ],
  callExtra: async (task, name, args) => {
    if (name !== 'lean_check') return `ERROR: unknown tool ${name}`
    const header = (task.meta as { header: string }).header
    const r = await leanCheck(header, String(args.proof ?? ''))
    return r.passed
      ? 'ACCEPTED by Lean. Submit this exact proof with submit_answer.'
      : `LEAN REJECTED:\n${r.error}\n\nFix the proof and call lean_check again.`
  },
})

/** Prove the verifier itself — no model, no key. Every reference proof must PASS; a mangled one must FAIL. */
async function verifyOnly(): Promise<void> {
  await ensureLeanImage()
  let ok = 0
  for (const p of PROBLEMS) {
    const good = await leanCheck(p.header, p.reference)
    console.log(`${good.passed ? 'PASS' : 'FAIL'}  ${p.id}  (reference: ${p.reference})`)
    if (good.passed) ok++
    else console.log(`      ${good.error.split('\n')[0]}`)
  }
  // Negative control: break the first proof, expect a FAIL — proves the judge rejects wrong proofs.
  const bad = await leanCheck(PROBLEMS[0].header, '⟨h.1, h.2⟩')
  console.log(`\nnegative control (deliberately wrong): ${bad.passed ? 'PASS (BUG!)' : 'FAIL ✓ rejected'}`)
  console.log(`      ${bad.error.split('\n').slice(0, 2).join(' ')}`)
  console.log(`\nverifier: ${ok}/${PROBLEMS.length} reference proofs accepted, wrong proof rejected=${!bad.passed}`)
  if (ok !== PROBLEMS.length || bad.passed) process.exit(1)
}

async function main(): Promise<void> {
  if (process.argv.includes('--verify-only')) return verifyOnly()

  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) throw new Error('set TANGLE_API_KEY to run the live prover-verifier loop (or pass --verify-only to prove just the verifier)')
  await ensureLeanImage() // fail loud before spending model budget if Lean can't run
  const report = await runBenchmark({
    environment: leanEnv,
    tasks,
    worker: {
      routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
      routerKey,
      model: process.env.WORKER_MODEL ?? 'gpt-4.1',
      innerTurns: 8, // room to call lean_check and fix
      temperature: 0.4,
    },
    strategies: [sample, refine, sampleThenRefine],
    budget: Number(process.env.BUDGET ?? 3),
    concurrency: 2,
  })
  printBenchmarkReport(report)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
