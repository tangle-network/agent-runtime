/**
 * PHASE 5 — memory as a first-class profile surface.
 *
 * The published `AgentProfile` (`@tangle-network/agent-interface`; source repo
 * absent from this workspace) has NO `memory` field, so a trace-learned memory
 * had nothing to sit on. This module carries it as a LOCAL profile extension
 * and makes it LIVE through a field the profile DOES have:
 *
 *   - `profile.metadata[profileMemoryMetadataKey]` — the typed, auditable
 *     `AgentMemorySpec` record (`ProfileWithMemory` names the extension);
 *   - `profile.mcp[<key>]` — a stdio server entry (`memoryMcpServer`) that
 *     SERVES that spec via the in-repo memory bin (built on
 *     `createStdioToolServer`), which the same-host client
 *     (`materializeLocalMcp`) already boots — so
 *     `sweEvalRunner({ materializeMcp: true })` scores a memory-carrying
 *     profile with `memory_search`/`memory_get` live, with ZERO scorer changes.
 *
 * `applyArtifact`'s `memory` case mounts both at once (apply.ts).
 *
 * >>> CROSS-PACKAGE BOUNDARY (flagged): when agent-interface grows a real
 * `AgentProfile.memory` field, the metadata shim moves there; the mcp mount,
 * bin, and serving stay unchanged. Do NOT edit node_modules to fake the field.
 *
 * MEASURING memory-as-treatment: the with/without ablation IS
 *
 *   measureMarginalLift({
 *     baseline,
 *     candidate: registry.register(memoryArtifactFromLessons(lessons)),
 *     evalRunner: sweEvalRunner({ ...opts, materializeMcp: true }),
 *   })
 *
 * — the candidate arm runs with the memory served live, the baseline without.
 * agent-knowledge's `RetrievalHoldout` (the off-policy PER-RETRIEVAL
 * estimator) lives in a package this repo does not depend on; the seam it
 * needs — a per-query retrieval log — is `AgentMemorySpec.logPath` (JSONL, one
 * row per `memory_search`). Flagged as the remaining cross-package hop.
 *
 * WHERE LESSONS COME FROM: agent-eval's `memoryCurationProposer` writes a
 * delimited `curated-memory` block into its candidate surface;
 * `memoryArtifactFromCuratedSurface` parses that block into a `memory`
 * artifact (the store the proposer's lessons land in). The block markers are
 * duplicated here BY CONVENTION — agent-eval does not export them; flagged.
 * `memoryGenerator` is the native lifecycle path: a `CandidateGenerator` that
 * curates `ctx.findings` (observed analyst findings only — the judge firewall
 * holds) plus the baseline's carried memory into one candidate artifact.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentProfile, AgentProfileMcpServer } from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'
import {
  type AgentMemorySpec,
  MEMORY_FILE_ENV,
  MEMORY_ITEMS_ENV,
  MEMORY_LOG_ENV,
  type MemoryItem,
  readMemoryItemsFile,
} from '../mcp/memory-server'
import type { CandidateGenerator } from './generator'
import type { ArtifactInput } from './types'

export type { AgentMemorySpec, MemoryItem } from '../mcp/memory-server'

/** The `profile.metadata` key the typed memory spec rides under (the local
 *  extension standing in for the missing `AgentProfile.memory` field). */
export const profileMemoryMetadataKey = 'memory'

/** The local profile extension: `AgentProfile` plus the memory spec under
 *  `metadata.memory`. Purely a naming convenience — any `AgentProfile` a
 *  `memory` artifact was applied to satisfies it. */
export interface ProfileWithMemory extends AgentProfile {
  metadata?: Record<string, unknown> & { [profileMemoryMetadataKey]?: AgentMemorySpec }
}

/** Read (and validate) the memory spec a profile carries, if any. Malformed
 *  metadata throws — silently scoring a broken memory as "no memory" would
 *  fake the ablation. */
export function memoryOfProfile(profile: AgentProfile): AgentMemorySpec | undefined {
  const raw = profile.metadata?.[profileMemoryMetadataKey]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError(
      `memoryOfProfile: profile.metadata.${profileMemoryMetadataKey} is not a memory spec object`,
    )
  }
  const spec = raw as AgentMemorySpec
  validateMemorySpec(spec)
  return spec
}

/** Assert an `AgentMemorySpec` is well-formed and servable. */
export function validateMemorySpec(spec: AgentMemorySpec): void {
  if (spec.store !== 'file' && spec.store !== 'mcp') {
    throw new ValidationError(
      `memory spec: store must be 'file' or 'mcp' (got '${String((spec as { store?: unknown }).store)}')`,
    )
  }
  if (spec.store === 'mcp' && !spec.server) {
    throw new ValidationError(
      "memory spec: store 'mcp' requires `server` (the external memory MCP)",
    )
  }
  if (spec.store === 'file' && !spec.path && (spec.items?.length ?? 0) === 0) {
    throw new ValidationError(
      "memory spec: store 'file' requires `path` and/or non-empty `items` — an empty memory is never mounted",
    )
  }
  const seen = new Set<string>()
  for (const item of spec.items ?? []) {
    if (!item.id?.trim() || !item.text?.trim()) {
      throw new ValidationError('memory spec: every item needs a non-empty id and text')
    }
    if (seen.has(item.id)) {
      throw new ValidationError(`memory spec: duplicate item id '${item.id}'`)
    }
    seen.add(item.id)
  }
}

/** Linux caps a single env string near 128KiB; refuse before the spawn does. */
const MAX_INLINE_MEMORY_CHARS = 100_000

export interface MemoryMcpServerOptions {
  /** Override the serve launch (e.g. the published `agent-runtime-memory-mcp`
   *  bin on PATH). Default: auto-resolve the in-repo bin — `dist/mcp/memory-bin.js`
   *  under node when built, the TS source through tsx in dev/test. */
  command?: string
  args?: string[]
}

/**
 * The `AgentProfileMcpServer` entry that SERVES a memory spec — what the
 * `memory` `applyArtifact` case mounts into `profile.mcp` so the same-host
 * client boots the memory during a scored run. `store:'mcp'` mounts the
 * external server verbatim; `store:'file'` launches the in-repo memory bin
 * with the spec carried on its env (`AGENT_MEMORY_FILE`/`AGENT_MEMORY_ITEMS`).
 *
 * NB the launch command resolves against THIS install (same-host, like the
 * worktree `cwd` a built MCP candidate bakes in) — a memory-mounted profile is
 * a same-host profile until the profile schema grows a portable memory field.
 */
export function memoryMcpServer(
  spec: AgentMemorySpec,
  opts: MemoryMcpServerOptions = {},
): AgentProfileMcpServer {
  validateMemorySpec(spec)
  if (spec.store === 'mcp') {
    const server = spec.server as AgentProfileMcpServer
    return { ...server, enabled: server.enabled ?? true }
  }
  const launch = opts.command
    ? { command: opts.command, args: opts.args ?? [] }
    : resolveMemoryBinLaunch()
  const inlineJson = spec.items && spec.items.length > 0 ? JSON.stringify(spec.items) : undefined
  if (inlineJson && inlineJson.length > MAX_INLINE_MEMORY_CHARS) {
    throw new ValidationError(
      `memoryMcpServer: inline items serialize to ${inlineJson.length} chars (> ${MAX_INLINE_MEMORY_CHARS}) — write them to a file store (writeMemoryStore) and reference it via spec.path`,
    )
  }
  return {
    transport: 'stdio',
    command: launch.command,
    ...(launch.args.length > 0 ? { args: launch.args } : {}),
    env: {
      ...(spec.path ? { [MEMORY_FILE_ENV]: spec.path } : {}),
      ...(inlineJson ? { [MEMORY_ITEMS_ENV]: inlineJson } : {}),
      ...(spec.logPath ? { [MEMORY_LOG_ENV]: spec.logPath } : {}),
    },
    enabled: true,
  }
}

/** Locate the memory bin for THIS install: the built `dist/mcp/memory-bin.js`
 *  when running from dist, else the TS source through tsx (dev/test). */
function resolveMemoryBinLaunch(): { command: string; args: string[] } {
  const dir = dirname(fileURLToPath(import.meta.url))
  // Built package: this module bundles into dist/*.js; the bin entry sits at
  // dist/mcp/memory-bin.js next to it.
  const distBin = join(dir, 'mcp', 'memory-bin.js')
  if (existsSync(distBin)) {
    return { command: process.execPath, args: [distBin] }
  }
  // Dev/test: this module runs from src/lifecycle; spawn the TS bin via tsx.
  const srcBin = join(dir, '..', 'mcp', 'memory-bin.ts')
  if (existsSync(srcBin)) {
    const tsxCli = createRequire(import.meta.url).resolve('tsx/cli')
    return { command: process.execPath, args: [tsxCli, srcBin] }
  }
  throw new ValidationError(
    'memoryMcpServer: cannot locate the memory bin (no dist/mcp/memory-bin.js, no src/mcp/memory-bin.ts) — pass an explicit `command`',
  )
}

/** Write a durable JSONL memory store (one `MemoryItem` per line).
 *
 *  CONTAMINATION HAZARD: give every candidate its own path. Overwriting a file
 *  the BASELINE profile's spec also references changes the without-arm
 *  mid-ablation and fakes the lift. `memoryGenerator` avoids files entirely
 *  (inline items are immutable in the artifact) for exactly this reason. */
export function writeMemoryStore(path: string, items: readonly MemoryItem[]): void {
  if (items.length === 0) {
    throw new ValidationError('writeMemoryStore: refusing to write an EMPTY memory store')
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${items.map((i) => JSON.stringify(i)).join('\n')}\n`, 'utf8')
}

/** Re-exported so lifecycle callers can read a store without reaching into mcp/. */
export { readMemoryItemsFile }

/**
 * The opening delimiter agent-eval's `memoryCurationProposer` writes its
 * curated block after. Duplicated BY CONVENTION — agent-eval does not export
 * it (flagged cross-package coupling; a marker drift breaks
 * `lessonsFromCuratedSurface`, whose tests pin the published block shape).
 */
export const CURATED_MEMORY_BLOCK_START =
  '<!-- BEGIN curated-memory (auto-managed by memoryCurationProposer) -->'
/** The closing delimiter of the proposer's curated block (see
 *  `CURATED_MEMORY_BLOCK_START` for the convention-coupling flag). */
export const CURATED_MEMORY_BLOCK_END = '<!-- END curated-memory -->'

/** Extract the lesson lines from a surface carrying a curated-memory block.
 *  Returns `[]` when the surface has no block (gen 0 — nothing learned yet). */
export function lessonsFromCuratedSurface(surfaceText: string): string[] {
  const start = surfaceText.indexOf(CURATED_MEMORY_BLOCK_START)
  if (start < 0) return []
  const bodyStart = start + CURATED_MEMORY_BLOCK_START.length
  const end = surfaceText.indexOf(CURATED_MEMORY_BLOCK_END, bodyStart)
  const body = end < 0 ? surfaceText.slice(bodyStart) : surfaceText.slice(bodyStart, end)
  return body
    .split('\n')
    .map((line) => line.replace(/^\s*-\s+/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

export interface MemoryArtifactOptions {
  /** The `profile.mcp` key / artifact key the memory mounts under. Default 'memory'. */
  key?: string
  /** Artifact display name. Default 'curated-memory'. */
  name?: string
  /** Write the items to this JSONL store and reference it via `spec.path`
   *  (durable, file-backed). Omitted: items ride INLINE in the spec (immutable
   *  in the artifact — the safe default; see `writeMemoryStore`'s hazard note). */
  storePath?: string
  /** Retrieval-log path baked into the spec (`AGENT_MEMORY_LOG`). */
  logPath?: string
  /** Provenance stamped on each item. Default 'memory-curation'. */
  source?: string
}

/**
 * The curated-lessons → memory-artifact adapter (the seam that gives
 * `memoryCurationProposer` a store to write to). Lessons are normalized,
 * deduplicated, and content-addressed (`mem-<sha256/12>`), so the same lesson
 * gets the same id across generations. Throws on zero usable lessons — a
 * memory artifact must never mount an empty memory.
 */
export function memoryArtifactFromLessons(
  lessons: readonly string[],
  opts: MemoryArtifactOptions = {},
): ArtifactInput<'memory'> {
  const items = itemsFromLessons(lessons, opts.source ?? 'memory-curation')
  if (items.length === 0) {
    throw new ValidationError(
      'memoryArtifactFromLessons: no non-empty lessons — gen 0 simply has no memory artifact',
    )
  }
  if (opts.storePath) writeMemoryStore(opts.storePath, items)
  const spec: AgentMemorySpec = {
    store: 'file',
    ...(opts.storePath ? { path: opts.storePath } : { items }),
    ...(opts.logPath ? { logPath: opts.logPath } : {}),
  }
  return {
    kind: 'memory',
    key: opts.key ?? 'memory',
    name: opts.name ?? 'curated-memory',
    description: `curated memory of ${items.length} lesson(s), served live as memory_search/memory_get`,
    payload: { spec },
    metadata: {
      lessonCount: items.length,
      ...(opts.storePath ? { storePath: opts.storePath } : {}),
    },
  }
}

/** Parse a proposer surface and build the artifact in one step. Returns
 *  `undefined` when the surface carries no curated block (nothing learned). */
export function memoryArtifactFromCuratedSurface(
  surfaceText: string,
  opts: MemoryArtifactOptions = {},
): ArtifactInput<'memory'> | undefined {
  const lessons = lessonsFromCuratedSurface(surfaceText)
  if (lessons.length === 0) return undefined
  return memoryArtifactFromLessons(lessons, opts)
}

export interface MemoryGeneratorOptions {
  /** Top-K lessons kept per generation. Default 12 (mirrors `memoryCurationProposer`). */
  maxLessons?: number
  /** The `profile.mcp` key / artifact key. Default 'memory'. */
  key?: string
  /** Retrieval-log path baked into every candidate spec. */
  logPath?: string
}

/**
 * The `memory` surface's `CandidateGenerator` — the native lifecycle path for
 * memory-as-treatment. Mirrors `memoryCurationProposer`'s semantics on the
 * artifact plane:
 *
 *   1. fresh lessons ← `ctx.findings` (`recommended_action` else `claim`),
 *      OBSERVED findings only — `derived_from_judge` rows are dropped (the
 *      judge firewall: a held-out verdict must never steer the loop);
 *   2. carried lessons ← the baseline profile's existing memory (inline items
 *      plus its file store, when readable), so memory ACCUMULATES;
 *   3. curate: normalize, dedupe, rank by recurrence, keep top-K;
 *   4. emit ONE inline-items candidate — or `[]` when nothing new was learned
 *      (the curated set equals what the baseline already carries).
 *
 * `runLifecycle` then measures it with the SAME `sweEvalRunner` as every other
 * surface (`materializeMcp: true` makes the memory live in the candidate arm).
 */
export function memoryGenerator(opts: MemoryGeneratorOptions = {}): CandidateGenerator<'memory'> {
  const maxLessons = opts.maxLessons ?? 12
  if (maxLessons < 1) {
    throw new ValidationError(`memoryGenerator: maxLessons must be >= 1 (got ${maxLessons})`)
  }
  return {
    kind: 'memory',
    async generate(ctx): Promise<ArtifactInput<'memory'>[]> {
      const fresh: string[] = []
      for (const finding of ctx.findings) {
        if (finding.derived_from_judge) continue
        const lesson = (finding.recommended_action ?? finding.claim ?? '').trim()
        if (lesson) fresh.push(lesson)
      }
      const carried = carriedLessons(ctx.baseline)
      if (fresh.length === 0 && carried.length === 0) return []

      // Rank by recurrence: carried lessons seed at 1; every fresh repeat
      // increments. A lesson seen across many findings outranks a one-off.
      const byKey = new Map<string, { text: string; count: number }>()
      for (const text of carried) {
        const k = normalizeLesson(text)
        if (k && !byKey.has(k)) byKey.set(k, { text, count: 1 })
      }
      for (const text of fresh) {
        const k = normalizeLesson(text)
        if (!k) continue
        const entry = byKey.get(k)
        if (entry) entry.count += 1
        else byKey.set(k, { text, count: 1 })
      }
      const curated = [...byKey.values()]
        .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
        .slice(0, maxLessons)
        .map((e) => e.text)
      if (curated.length === 0) return []

      // Nothing learned: the curated set is exactly the carried set — the
      // candidate would mount an identical memory, a guaranteed zero-delta.
      const carriedKeys = new Set(carried.map(normalizeLesson).filter((k) => k.length > 0))
      const curatedKeys = new Set(curated.map(normalizeLesson))
      if (
        curatedKeys.size === carriedKeys.size &&
        [...curatedKeys].every((k) => carriedKeys.has(k))
      ) {
        return []
      }

      return [
        memoryArtifactFromLessons(curated, {
          ...(opts.key ? { key: opts.key } : {}),
          ...(opts.logPath ? { logPath: opts.logPath } : {}),
          source: 'memory-generator',
        }),
      ]
    },
  }
}

/** The baseline's existing memory as lesson texts (inline items + file store). */
function carriedLessons(baseline: AgentProfile): string[] {
  const spec = memoryOfProfile(baseline)
  if (!spec) return []
  const items: MemoryItem[] = [...(spec.items ?? [])]
  if (spec.store === 'file' && spec.path && existsSync(spec.path)) {
    items.push(...readMemoryItemsFile(spec.path))
  }
  return items.map((i) => i.text)
}

/** Normalize a lesson for dedupe: lowercase, collapse whitespace, strip
 *  trailing punctuation — the same key `memoryCurationProposer` dedupes on. */
function normalizeLesson(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.;:!?\s]+$/, '')
    .trim()
}

/** Deterministic content-addressed items: `mem-<sha256(normalized)/12>`. */
function itemsFromLessons(lessons: readonly string[], source: string): MemoryItem[] {
  const byId = new Map<string, MemoryItem>()
  for (const lesson of lessons) {
    const text = lesson.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const id = `mem-${createHash('sha256').update(normalizeLesson(text)).digest('hex').slice(0, 12)}`
    if (!byId.has(id)) byId.set(id, { id, text, source })
  }
  return [...byId.values()]
}
