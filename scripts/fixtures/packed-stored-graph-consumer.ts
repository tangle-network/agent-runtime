import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  graphFromStored,
  graphRegistry,
  loadGraph,
  recordStoredGraphRun,
  type StoredGraphInput,
  validateStoredGraph,
} from '@tangle-network/agent-runtime/kernel'

const v10Graph = {
  nodes: [
    {
      id: 'manager',
      profile: {
        name: 'manager',
        harness: 'cli-base',
        model: { provider: 'offline', default: 'offline/manager' },
      },
    },
  ],
  edges: [],
  budget: { maxIterations: 2 },
  deliverable: { describe: 'reviewed result', checkRef: 'review' },
} satisfies StoredGraphInput

const description: string | undefined = v10Graph.deliverable.describe
const checkRef: string | undefined = v10Graph.deliverable.checkRef
const manager: string | undefined = v10Graph.nodes[0]?.id
const iterationLimit: number | undefined = v10Graph.budget.maxIterations
assert.equal(description, 'reviewed result')
assert.equal(checkRef, 'review')
assert.equal(manager, 'manager')
assert.equal(iterationLimit, 2)

const requireSubmission = (deliverable: StoredGraphInput['deliverable']): unknown =>
  'requireSubmission' in deliverable ? deliverable.requireSubmission : undefined
assert.equal(requireSubmission(v10Graph.deliverable), undefined)

const root = await mkdtemp(join(tmpdir(), 'packed-v10-stored-graph-'))
try {
  const registry = graphRegistry(root)
  const stored = await recordStoredGraphRun(registry, v10Graph)
  const serialized = JSON.stringify(stored)
  const validated = validateStoredGraph(JSON.parse(serialized), { checks: { review: () => true } })
  const loaded = await loadGraph(registry, stored.digest)
  assert.deepEqual(loaded, stored)
  assert.deepEqual(validated, stored)
  assert.equal(requireSubmission(loaded.deliverable), undefined)
  const replayed = graphFromStored(validated, () => true)
  assert.equal(replayed.deliverable.describe, description)
  assert.equal(requireSubmission(replayed.deliverable), undefined)
  console.log(JSON.stringify({ construction: 'v10', digest: stored.digest, roundTrip: true }))
} finally {
  await rm(root, { recursive: true, force: true })
}
