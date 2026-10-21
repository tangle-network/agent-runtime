/**
 *
 * `reflectiveGenerator` — the cheap, no-sandbox `CandidateGenerator`. It drafts
 * surface edits via the existing improvement proposer (`proposeFromFindings`,
 * one LLM patch per finding) and applies them as ONE coherent improvement into
 * the candidate worktree. `maxShots` is ignored — reflection is single-shot by
 * construction (the patches are already drafted).
 *
 * This is the `shots=1, sandbox=off` code-candidate setting.
 * `agenticGenerator` supplies the multi-shot verify-in-session setting.
 *
 * @stable
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { SurfaceImprovementEdit } from '../agent/improvement-adapter'
import type { ImprovementProposalSource } from '../analyst-loop/types'
import type { CandidateGenerator } from './improvement-driver'

export interface ReflectiveGeneratorOptions {
  /** Bind proposal reads and paid calls to this candidate's worktree and account. */
  createImprovementProposalSource(
    context: Parameters<CandidateGenerator['generate']>[0],
  ): ImprovementProposalSource<SurfaceImprovementEdit>
}

/** Cheap no-sandbox `CandidateGenerator` (the `shots=1` setting): draft surface edits via the improvement adapter and apply them as one coherent candidate. */
export function reflectiveGenerator(opts: ReflectiveGeneratorOptions): CandidateGenerator {
  return {
    kind: 'reflective',
    async generate(context) {
      const { worktreePath, findings, signal } = context
      signal.throwIfAborted()
      const source = opts.createImprovementProposalSource(context)
      const batch = await source.proposeFromFindings(findings)
      signal.throwIfAborted()
      if (batch.errors.length > 0) {
        throw new AggregateError(
          batch.errors.map((error) => new Error(`${error.findingId}: ${error.message}`)),
          `reflectiveGenerator: proposal failed: ${batch.errors.map((error) => error.message).join('; ')}`,
        )
      }
      if (batch.edits.length === 0) return { applied: false, summary: '' }

      for (const edit of batch.edits) {
        assertPatchTarget(edit, worktreePath)
        assertCurrentBase(edit, worktreePath)
      }
      applyPatches(batch.edits, worktreePath)
      signal.throwIfAborted()

      const summary =
        batch.edits.length === 1
          ? batch.edits[0]!.summary
          : `analyst: ${batch.edits.length} surface edits`
      return { applied: true, summary }
    },
  }
}

function assertPatchTarget(edit: SurfaceImprovementEdit, cwd: string): void {
  // Reverse statistics include the source path of a rename or copy.
  for (const reverse of [false, true]) {
    const result = spawnSync(
      'git',
      ['apply', '--numstat', '-z', '-p0', ...(reverse ? ['--reverse'] : []), '-'],
      { cwd, input: edit.patch, encoding: 'utf8' },
    )
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`reflectiveGenerator: invalid patch: ${result.stderr.trim()}`)
    }
    const paths = result.stdout
      .split('\0')
      .filter(Boolean)
      .map((entry) => entry.slice(entry.indexOf('\t', entry.indexOf('\t') + 1) + 1))
    const target = resolve(cwd, edit.target.repoRelativePath)
    if (paths.length === 0 || paths.some((path) => resolve(cwd, path) !== target)) {
      throw new Error('reflectiveGenerator: patch paths do not match the declared target')
    }
  }
}

function assertCurrentBase(edit: SurfaceImprovementEdit, cwd: string): void {
  const root = realpathSync(cwd)
  const path = resolve(root, edit.target.repoRelativePath)
  assertWithinWorktree(root, path)
  let content: string
  try {
    assertWithinWorktree(root, realpathSync(path))
    content = readFileSync(path, 'utf8')
  } catch (error) {
    if (
      edit.target.intent !== 'create-new' ||
      !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
    ) {
      throw error
    }
    content = ''
  }
  const actual = createHash('sha256').update(content, 'utf8').digest('hex')
  if (actual !== edit.baseSha256) {
    throw new Error(`reflectiveGenerator: stale proposal base for ${edit.target.repoRelativePath}`)
  }
}

function assertWithinWorktree(root: string, path: string): void {
  const local = relative(root, path)
  if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error('reflectiveGenerator: proposal target is outside the candidate worktree')
  }
}

function applyPatches(edits: SurfaceImprovementEdit[], cwd: string): void {
  // Git applies the complete batch atomically unless --reject is requested.
  const result = spawnSync('git', ['apply', '-p0', '-'], {
    cwd,
    input: edits.map((edit) => `${edit.patch.trimEnd()}\n`).join(''),
    encoding: 'utf-8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`reflectiveGenerator: patch batch failed: ${result.stderr.trim()}`)
  }
}
