import { createHash } from 'node:crypto'

/**
 * The marker `@tangle-network/agent-profile-materialize` (>=0.20) puts on line 1
 * of every context file it generates from `prompt.instructions`, so the next
 * materialization can prove which bytes it is about to replace. It never goes on
 * a file whose bytes are the caller's own, such as an explicit profile resource
 * or a system-prompt replacement — those stay verbatim.
 *
 * Tests that pin the exact bytes or digest of a generated context file build
 * them here rather than each restating the marker's shape.
 */
export function materializedContextFile(body: string): string {
  const digest = createHash('sha256').update(body, 'utf8').digest('hex')
  return `<!-- tangle-agent-profile-materialize: generated sha256:${digest}; do not edit; the next profile materialization replaces this file -->\n${body}`
}
