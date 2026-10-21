/**
 * One PHASE of the flow-graph kill-and-resume conformance run, as its own OS process: the flow
 * twin of `graph-child.ts`, driven through `superviseGraphPursuit`.
 *
 * Usage: `[FLOW_GRAPH=pipeline] node --import tsx flow-graph-child.ts <dir> <phase:1|2> [killAt]`
 */

const [dir, phase, killAt] = process.argv.slice(2)
if (dir === undefined || (phase !== '1' && phase !== '2')) {
  throw new Error('usage: flow-graph-child.ts <dir> <phase:1|2> [killAt]')
}
if (phase === '2' && killAt !== undefined) {
  throw new Error('usage: phase 2 resumes; it never arms a kill')
}

const graph = process.env.FLOW_GRAPH === 'pipeline' ? 'pipeline' : 'conformance'

const { runFlowGraphPhase } = await import('./flow-conformance-graph')
await runFlowGraphPhase(dir, phase, phase === '1' && killAt !== '-' ? killAt : undefined, graph)
