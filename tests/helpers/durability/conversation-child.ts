/**
 * One PHASE of the conversation kill-and-resume conformance run, as its own OS process.
 *
 * Usage: `node --import tsx conversation-child.ts <dir> <phase:1|2> <backend:file|sqlite> [killAt]`
 *
 * Phase 1 runs the conformance conversation against the named journal backend and SIGKILLs itself
 * at `killAt` (a turn boundary or mid-turn label). Phase 2 is a brand-new process that resumes the
 * same runId against the same journal and prints one JSON line describing the completed run.
 */

const [dir, phase, backend, killAt] = process.argv.slice(2)
if (
  dir === undefined ||
  (phase !== '1' && phase !== '2') ||
  (backend !== 'file' && backend !== 'sqlite')
) {
  throw new Error('usage: conversation-child.ts <dir> <phase:1|2> <backend:file|sqlite> [killAt]')
}
if (phase === '2' && killAt !== undefined) {
  throw new Error('usage: phase 2 resumes; it never arms a kill')
}

const { runConversationPhase } = await import('./conformance-conversation')
const report = await runConversationPhase(dir, phase, backend, phase === '1' ? killAt : undefined)
process.stdout.write(`${JSON.stringify(report)}\n`)
