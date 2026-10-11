/**
 * One mind across coding harnesses. The store is the only truth; a harness's
 * native memory (CLAUDE.md, AGENTS.md, Claude Code's memory directory, pi
 * context) is a projection of it plus a capture source:
 *
 * - project: at session start the host writes {@link renderHarnessMemory} into
 *   each native location, between generated markers, never into anything hashed;
 * - capture: at turn end the host passes the native files from before and after
 *   the turn to {@link captureHarnessMemory}, which returns what the harness
 *   added outside the generated block;
 * - ingest: {@link ingestHarnessMemories} saves those facts through the memory
 *   policy with the harness and turn as provenance, skipping duplicates;
 * - verify: {@link memoryDivergence} counts every way the native copies and the
 *   store disagree. The target is 0.
 *
 * Pure functions over strings and the store port: Worker-safe, no file I/O.
 */
import type { WorkspaceEntry, WorkspaceStore } from './store'
import {
  guard,
  readTurnMemories,
  renderPinnedMemory,
  type WorkspaceToolContext,
  type WorkspaceTurn,
} from './tools'

export const HARNESS_MEMORY_BEGIN =
  '<!-- workspace-store:memory begin. Generated from the workspace store; save memories with memory.remember. -->'
export const HARNESS_MEMORY_END = '<!-- workspace-store:memory end -->'

/** The generated block a host writes into a harness's native memory location. */
export function renderHarnessMemory(
  entries: readonly WorkspaceEntry[],
  options: { maxTokens?: number } = {},
): string {
  return [HARNESS_MEMORY_BEGIN, renderPinnedMemory(entries, options), HARNESS_MEMORY_END].join('\n')
}

/** Replace the generated block in `native`, or append one; text outside it is kept byte for byte. */
export function projectHarnessMemory(native: string, block: string): string {
  const { before, after, found } = splitGenerated(native)
  if (found) return `${before}${block}${after}`
  return native.length === 0
    ? `${block}\n`
    : `${native}${native.endsWith('\n') ? '\n' : '\n\n'}${block}\n`
}

function splitGenerated(native: string): {
  before: string
  block: string
  after: string
  found: boolean
} {
  const start = native.indexOf(HARNESS_MEMORY_BEGIN)
  const end = start < 0 ? -1 : native.indexOf(HARNESS_MEMORY_END, start)
  if (start < 0 || end < 0) return { before: native, block: '', after: '', found: false }
  const stop = end + HARNESS_MEMORY_END.length
  return {
    before: native.slice(0, start),
    block: native.slice(start, stop),
    after: native.slice(stop),
    found: true,
  }
}

/** Ids listed in a generated block (`- [id] kind, scope: text`). */
function projectedIds(block: string): Map<string, string> {
  const ids = new Map<string, string>()
  for (const match of block.matchAll(
    /^- \[([A-Za-z0-9_-]{1,64})\] [a-z]+, (?:me|workspace): (.*)$/gm,
  )) {
    ids.set(match[1]!, match[2]!)
  }
  return ids
}

/** Native files keyed by path, as the host read them. A missing file is absent or `undefined`. */
export type HarnessNativeFiles = Readonly<Record<string, string | undefined>>

/** Lowercase, collapse spaces, drop a leading "Remember:" and trailing punctuation: the duplicate key. */
export function normalizeMemoryText(text: string): string {
  return text
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)?/, '')
    .replace(/^(?:remember|note)\b\s*(?:that\b)?\s*:?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!;,\s]+$/, '')
    .toLowerCase()
}

function stripFrontmatter(text: string): string {
  return text.startsWith('---\n')
    ? text.slice(text.indexOf('\n---', 4) + 4).replace(/^\n+/, '')
    : text
}

/** Lines that read as one memory: bullets and plain sentences, not headings, markers or fences. */
function memoryLines(text: string): string[] {
  const lines: string[] = []
  let fenced = false
  for (const raw of stripFrontmatter(text).split('\n')) {
    const line = raw.trim()
    if (line.startsWith('```')) {
      fenced = !fenced
      continue
    }
    if (fenced || !line || line.startsWith('#') || line.startsWith('<!--') || line.startsWith('@'))
      continue
    const fact = line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, '').trim()
    if (fact.length >= 3 && fact.length <= 1000) lines.push(fact)
  }
  return lines
}

/**
 * What the harness added during the turn, outside the generated block: new
 * lines in files that existed, and the body of new files (a Claude Code memory
 * directory entry). Lines removed or present before are ignored; a removal is
 * not a forget, which only `memory.forget` performs.
 */
export function captureHarnessMemory(
  before: HarnessNativeFiles,
  after: HarnessNativeFiles,
): string[] {
  const seen = new Set<string>()
  const facts: string[] = []
  for (const [path, next] of Object.entries(after)) {
    if (next === undefined) continue
    const old = new Set(memoryLines(outside(before[path] ?? '')).map(normalizeMemoryText))
    for (const fact of memoryLines(outside(next))) {
      const key = normalizeMemoryText(fact)
      if (!key || old.has(key) || seen.has(key)) continue
      seen.add(key)
      facts.push(fact)
    }
  }
  return facts
}

function outside(native: string): string {
  const { before, after, found } = splitGenerated(native)
  return found ? `${before}\n${after}` : native
}

/** Where a captured memory came from. */
export interface HarnessProvenance {
  readonly harness: string
  readonly turnId: string
  readonly memberId: string
}

const ACTOR = /^harness:([a-z0-9][a-z0-9._-]{0,40})\/turn:([^/\s]{1,128})\/member:([^/\s]{1,128})$/

/** The entry `actor` for a captured memory, so `createdBy` carries its provenance. */
export function harnessActor({ harness, turnId, memberId }: HarnessProvenance): string {
  const actor = `harness:${harness}/turn:${turnId}/member:${memberId}`
  if (!ACTOR.test(actor)) throw new TypeError(`invalid harness provenance: ${actor}`)
  return actor
}

export function parseHarnessActor(actor: string): HarnessProvenance | null {
  const match = ACTOR.exec(actor)
  return match ? { harness: match[1]!, turnId: match[2]!, memberId: match[3]! } : null
}

export interface HarnessIngestResult {
  readonly saved: WorkspaceEntry[]
  /** Facts already in the store, by normalized text. */
  readonly duplicates: string[]
  /** Facts the policy refused, with the reason. */
  readonly refused: { text: string; reason: string }[]
}

/**
 * Save captured facts as workspace memories through the same policy as
 * `memory.remember`, with the harness and turn as the actor. Duplicates of a
 * memory the turn can see, or of an earlier fact in the batch, are skipped.
 */
export async function ingestHarnessMemories(
  context: WorkspaceToolContext,
  input: { harness: string; turnId: string; facts: readonly string[] },
): Promise<HarnessIngestResult> {
  const turn = await context.activeTurn()
  const actor = harnessActor({
    harness: input.harness,
    turnId: input.turnId,
    memberId: turn.memberId,
  })
  const newId = context.newId ?? (() => crypto.randomUUID())
  const known = new Set(
    (await readTurnMemories(context.store, turn)).map((entry) =>
      normalizeMemoryText(entry.content ?? ''),
    ),
  )
  const saved: WorkspaceEntry[] = []
  const duplicates: string[] = []
  const refused: { text: string; reason: string }[] = []
  for (const raw of input.facts) {
    const text = raw.replace(/\s+/g, ' ').trim()
    const key = normalizeMemoryText(text)
    if (!key) continue
    if (known.has(key)) {
      duplicates.push(text)
      continue
    }
    const id = newId()
    const path = `/memories/workspace/${id}`
    try {
      await guard(context, turn, { op: 'write', path, kind: 'fact' }, text)
    } catch (error) {
      refused.push({ text, reason: error instanceof Error ? error.message : String(error) })
      continue
    }
    known.add(key)
    saved.push(
      await context.store.put({
        workspaceId: turn.workspaceId,
        path,
        kind: 'fact',
        ifRevision: null,
        actor,
        content: text,
        id,
      }),
    )
  }
  return { saved, duplicates, refused }
}

export interface MemoryDivergence {
  /** Sum of the counts below; 0 means every native copy agrees with the store. */
  readonly total: number
  /** Store memories the turn sees that a native file's generated block omits. */
  readonly missing: number
  /** Generated-block lines whose id is gone from the store or whose text differs. */
  readonly stale: number
  /** Facts a harness wrote outside the generated block that the store does not hold. */
  readonly uncaptured: number
  readonly files: Record<string, { missing: string[]; stale: string[]; uncaptured: string[] }>
}

/**
 * Compare each native file with the store as `turn` sees it, after ingest ran.
 * `before` is the files as projected at session start, `after` as they are now:
 * only what the harness added since then can be uncaptured, so the profile's own
 * generated text in the same file never counts. Files that held a generated
 * block at session start are projection targets: losing the block counts every
 * visible memory as missing. Other files (a new memory-directory entry) can
 * only hold uncaptured facts.
 */
export async function memoryDivergence(
  store: WorkspaceStore,
  turn: WorkspaceTurn,
  before: HarnessNativeFiles,
  after: HarnessNativeFiles,
): Promise<MemoryDivergence> {
  const entries = (await readTurnMemories(store, turn)).filter(
    (entry) => entry.content !== undefined,
  )
  const byId = new Map(
    entries.map((entry) => [entry.id, entry.content!.replace(/\s+/g, ' ').trim()]),
  )
  const stored = new Set(entries.map((entry) => normalizeMemoryText(entry.content!)))
  const files: MemoryDivergence['files'] = {}
  let missing = 0
  let stale = 0
  let uncaptured = 0
  for (const [path, native] of Object.entries(after)) {
    if (native === undefined) continue
    const target = splitGenerated(before[path] ?? '').found || splitGenerated(native).found
    const listed = projectedIds(splitGenerated(native).block)
    const report = {
      missing: target ? [...byId.keys()].filter((id) => !listed.has(id)) : [],
      stale: [...listed].filter(([id, text]) => byId.get(id) !== text).map(([id]) => id),
      uncaptured: captureHarnessMemory({ [path]: before[path] }, { [path]: native }).filter(
        (fact) => !stored.has(normalizeMemoryText(fact)),
      ),
    }
    missing += report.missing.length
    stale += report.stale.length
    uncaptured += report.uncaptured.length
    files[path] = report
  }
  return { total: missing + stale + uncaptured, missing, stale, uncaptured, files }
}
