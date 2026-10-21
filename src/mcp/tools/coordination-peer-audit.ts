import type { McpToolDescriptor } from '../server'
import type { CoordinationToolsOptions } from './coordination-contracts'
import { obj, str } from './coordination-input'

/**
 * Let `observe_agent` and `read_journal` read a peer root's own record when the run enables peer
 * audit, then register this manager's tools with the peer registry. Mutates the two tools in place.
 */
export function mountPeerAudit({
  opts,
  tools,
  readJournal,
}: {
  readonly opts: CoordinationToolsOptions & {
    readonly peerAudit: NonNullable<CoordinationToolsOptions['peerAudit']>
  }
  readonly tools: McpToolDescriptor[]
  readonly readJournal: (raw: unknown, trackOwnRead?: boolean) => unknown
}): void {
  for (const tool of tools) {
    if (tool.name !== 'observe_agent' && tool.name !== 'read_journal') continue
    const ownHandler = tool.handler
    const name = tool.name
    const schema = tool.inputSchema as { properties?: Record<string, unknown> }
    schema.properties = {
      ...schema.properties,
      peerId: {
        type: 'string',
        description:
          "Read a peer root's own record, using its workerId from read_mail.peers. Read-only; omit for your own tree.",
      },
    }
    tool.handler = async (raw) => {
      const args = obj(raw)
      if (args.peerId === undefined) return ownHandler(raw)
      const peerId = str(args.peerId, 'peerId')
      const { peerId: _peerId, ...readArgs } = args
      return opts.peerAudit?.read(peerId, name, readArgs)
    }
  }
  // A peer read must not claim that this manager has consumed its own journal.
  opts.peerAudit.register(
    opts.scope.view.root,
    tools.map((tool) =>
      tool.name === 'read_journal'
        ? { ...tool, handler: async (raw) => readJournal(raw, false) }
        : tool,
    ),
  )
}
