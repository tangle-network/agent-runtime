import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseCommittedJsonLines } from '../durable/jsonl-file'
import type { TopJournalEvent } from './top-snapshot'

/** Native workflows have no Runtime accounting. Translate recorded lifecycle only. */
export function workflowJournal(runDir: string, text: string) {
  const rows = parseCommittedJsonLines<Record<string, unknown>>(text, 'journal.jsonl')
  const events: TopJournalEvent[] = []
  const tails = new Map<string, { file: string; lines: string[] }>()
  let first: string | undefined
  let last: string | undefined
  for (const row of rows) {
    if (typeof row.agentId !== 'string' || !/^[\w-]+$/.test(row.agentId)) continue
    const id = row.agentId
    if (row.type === 'started') {
      const file = join(runDir, `agent-${id}.jsonl`)
      let start: string | undefined
      let end: string | undefined
      try {
        const fd = openSync(file, 'r')
        try {
          const size = statSync(file).size
          const prefix = Buffer.alloc(Math.min(size, 16_384))
          readSync(fd, prefix, 0, prefix.length, 0)
          start = /"timestamp":"([^"]+)"/.exec(prefix.toString())?.[1]
          const suffix = Buffer.alloc(Math.min(size, 65_536))
          readSync(fd, suffix, 0, suffix.length, Math.max(0, size - suffix.length))
          const raw = suffix.toString().split('\n')
          if (size > suffix.length) raw.shift()
          const lines = raw.filter(Boolean).slice(-8)
          const times = [...suffix.toString().matchAll(/"timestamp":"([^"]+)"/g)]
          end = times.at(-1)?.[1]
          tails.set(id, { file, lines })
        } finally { closeSync(fd) }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (start && (!first || start < first)) first = start
      if (end && (!last || end > last)) last = end
      events.push({ kind: 'spawned', id, label: typeof row.label === 'string' ? row.label : id, runtime: 'claude-code', ...(start ? { at: start } : {}) })
      events.push({ kind: 'metered', id, spend: { usdKnown: false, tokensKnown: false } })
    } else if (row.type === 'result' || row.type === 'error' || row.type === 'cancelled') {
      const line = tails.get(id)?.lines.at(-1)
      const at = line ? /"timestamp":"([^"]+)"/.exec(line)?.[1] : undefined
      events.push(row.type === 'cancelled' ? { kind: 'cancelled', id, ...(at ? { at } : {}) } : {
        kind: 'settled', id, status: row.type === 'error' ? 'down' : 'done', ...(at ? { at } : {}), spent: { usdKnown: false, tokensKnown: false },
      })
    }
  }
  return { id: basename(runDir), events, tails, first, last }
}
