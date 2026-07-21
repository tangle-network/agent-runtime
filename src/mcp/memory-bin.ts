#!/usr/bin/env node

/**
 * `agent-runtime-memory-mcp` — stdio memory MCP server entry point.
 *
 * Serves `memory_search` / `memory_get` over an agent's curated memory rows,
 * on the generic in-repo JSON-RPC core (`createStdioToolServer`). This is the
 * process `memoryMcpServer` (lifecycle/memory.ts) mounts into `profile.mcp`,
 * which the same-host client (`materializeLocalMcp`) spawns next to the
 * driven worker during a scored run.
 *
 * Environment variables (the `memoryMcpServer` contract):
 *   AGENT_MEMORY_FILE    optional — path to the durable row store (JSON array
 *                        or JSONL of MemoryItem).
 *   AGENT_MEMORY_ITEMS   optional — inline JSON array of MemoryItem rows;
 *                        wins over file rows on id collision.
 *   AGENT_MEMORY_LOG     optional — JSONL retrieval log, one row per
 *                        memory_search (the retrieval-holdout seam).
 *   AGENT_MEMORY_NAME    optional — server display name (default 'agent-memory').
 *
 * At least one of AGENT_MEMORY_FILE / AGENT_MEMORY_ITEMS must resolve rows:
 * an EMPTY memory refuses to boot (fail-closed, so a memory-carrying profile
 * whose store is missing fails the materialization, never a silent no-tool run).
 *
 * @experimental
 */

import { createMemoryToolServer, resolveMemoryFromEnv } from './memory-server'

async function main(): Promise<void> {
  const { items, serverName, logPath } = resolveMemoryFromEnv(process.env)
  const server = createMemoryToolServer({
    items,
    ...(serverName ? { serverName } : {}),
    ...(logPath ? { logPath } : {}),
  })
  await server.serve()
}

main().catch((err: unknown) => {
  console.error(`agent-runtime-memory-mcp: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
