import {
  createCollaborationHub,
  supervise,
  type CollaborationConfig,
} from '@tangle-network/agent-runtime'

// Supply real profiles, backends, tasks, and budgets in an application.
declare const supervisor: Parameters<typeof supervise>[0]
declare const task: Parameters<typeof supervise>[1]
declare const backend: NonNullable<Parameters<typeof supervise>[2]>['backend']
declare const budget: NonNullable<Parameters<typeof supervise>[2]>['budget']

// Manager + direct children. Nested leads belong to their parent team and form
// another team with their own children.
await supervise(supervisor, task, {
  backend,
  budget,
  collaboration: true,
})

// Every actor in one recursive supervision graph.
await supervise(supervisor, task, {
  backend,
  budget,
  collaboration: { scope: 'graph' },
})

// Explicit cross-graph federation: same hub plus same custom group.
const hub = createCollaborationHub()
const collaboration: CollaborationConfig = {
  hub,
  scope: 'none',
  groupsForActor: () => ['joint-investigation'],
}

await Promise.all([
  supervise(supervisor, task, { backend, budget, collaboration }),
  supervise(supervisor, task, { backend, budget, collaboration }),
])
