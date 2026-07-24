/**
 * Rollout-ledger file API — append-only JSONL of validated `tangle.rollout.v1`
 * lines. Writes validate BEFORE touching disk (a bad line never lands);
 * reads validate line-by-line and fail loud with the line number, because a
 * silently-skipped rollout is a corrupted dataset.
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { assertRolloutLine, type RolloutLine } from './types.ts'

function serialize(lines: RolloutLine[]): string {
  lines.forEach((line, i) => assertRolloutLine(line, `rollout line [${i}]`))
  return lines.map((line) => JSON.stringify(line)).join('\n') + (lines.length > 0 ? '\n' : '')
}

/** Replace the ledger file with exactly `lines`. */
export async function writeRolloutLedger(path: string, lines: RolloutLine[]): Promise<void> {
  const payload = serialize(lines)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, payload)
}

/** Append `lines` to the ledger file (created if absent). */
export async function appendRolloutLines(path: string, lines: RolloutLine[]): Promise<void> {
  if (lines.length === 0) return
  const payload = serialize(lines)
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, payload)
}

/**
 * Read and validate every line. Throws on the first malformed/invalid line
 * (with its 1-based line number) — fail-closed, never a silent drop.
 */
export async function readRolloutLedger(path: string): Promise<RolloutLine[]> {
  const raw = await readFile(path, 'utf8')
  const lines: RolloutLine[] = []
  const rawLines = raw.split('\n')
  for (let i = 0; i < rawLines.length; i++) {
    const text = rawLines[i]
    if (!text || !text.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new Error(`${path}:${i + 1}: malformed JSON — ${error instanceof Error ? error.message : String(error)}`)
    }
    assertRolloutLine(parsed, `${path}:${i + 1}`)
    lines.push(parsed)
  }
  return lines
}
