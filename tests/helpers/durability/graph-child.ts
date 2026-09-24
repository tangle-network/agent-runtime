/**
 * One PHASE of the runGraph kill-and-resume conformance run, as its own OS process — the same
 * pattern as `tests/helpers/supervisor-resume-child.ts`, driven through `runGraph` instead of a
 * hand-built supervisor tree.
 *
 * Usage: `node --import tsx graph-child.ts <dir> <phase:1|2> [killAt]`
 *
 * Phase 1 runs the conformance graph against `runDir=<dir>` and SIGKILLs itself the instant the
 * run reaches `killAt` (a step-boundary or mid-step label). Phase 2 is a brand-new process whose
 * only inheritance is what survived on disk under `<dir>`; it resumes the SAME runId and prints
 * one JSON line describing what it re-ran and what it resumed.
 */

const [dir, phase, killAt] = process.argv.slice(2)
if (dir === undefined || (phase !== '1' && phase !== '2')) {
  throw new Error('usage: graph-child.ts <dir> <phase:1|2> [killAt]')
}
if (phase === '2' && killAt !== undefined) {
  throw new Error('usage: phase 2 resumes; it never arms a kill')
}

const { runGraphPhase } = await import('./conformance-graph')
await runGraphPhase(dir, phase, phase === '1' ? killAt : undefined)
