/**
 * The decisive de-risk: does a git-backed shared workspace make accumulating,
 * resumable, multi-worker loops REAL on a share-nothing substrate?
 *
 * The red-team's fatal finding: each cloud worker is a fresh box with no shared
 * filesystem, so "worker N+1 builds on worker N's code" is impossible and resume
 * restores decisions, not the mutated workspace. The proposed fix: a git-backed
 * contract. This proves or kills it on 3 dependency-ordered modules (a←b←c).
 *
 *   - The DURABLE WORKSPACE = a bare git repo (models a GitHub branch in cloud).
 *   - Each WORKER = a FRESH temp clone (models a fresh box's empty FS), torn down
 *     after it commits+pushes. State survives ONLY because git persisted it.
 *   - THE PROOF: a worker asserts its dependency's file is on disk in its fresh
 *     clone. Fails on share-nothing (names-in-a-string); passes on the git seam.
 *
 * Test (a) — does it link?   full run → integration test imports a←b←c, must pass.
 * Test (b) — resume?         KILL_AFTER=b, then RESUME=1: c clones a repo that
 *                            HAS a+b committed (durable), re-runs ONLY c, links.
 *
 *   pnpm exec tsx src/workspace-loop.mts                 # (a) happy path
 *   KILL_AFTER=b pnpm exec tsx src/workspace-loop.mts    # die after b
 *   RESUME=1 pnpm exec tsx src/workspace-loop.mts        # (b) resume → finish c
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BARE = '/tmp/workspace-loop.git' // the durable shared workspace (≈ a remote branch)
const JOURNAL = '/tmp/workspace-loop.journal' // the decision record (which modules are committed)

const sh = (cmd: string, args: string[], cwd?: string): string =>
  execFileSync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf-8' })
const git = (args: string[], cwd?: string): string =>
  // hooksPath=/dev/null: these are throwaway test clones, not project repos — the
  // operator's global ai-agent-hooks must not run on them.
  sh('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.email=loop@tangle', '-c', 'user.name=loop', ...args], cwd)

/** a←b←c: c.top(1) = ((1+1)*2)+3 = 7. The integration test imports the whole chain,
 *  so it passes ONLY if all three files accumulated in the workspace. */
const modules = [
  { id: 'a', file: 'a.py', dep: null as string | null, code: 'def base(x):\n    return x + 1\n' },
  { id: 'b', file: 'b.py', dep: 'a', code: 'from a import base\n\ndef mid(x):\n    return base(x) * 2\n' },
  { id: 'c', file: 'c.py', dep: 'b', code: 'from b import mid\n\ndef top(x):\n    return mid(x) + 3\n' },
]
const depFile = (id: string): string => modules.find((m) => m.id === id)!.file

function initWorkspace(): void {
  rmSync(BARE, { recursive: true, force: true })
  rmSync(JOURNAL, { force: true })
  git(['init', '--bare', '-b', 'main', BARE])
  // seed: the integration test, on the branch from commit 0.
  const seed = mkdtempSync(join(tmpdir(), 'wl-seed-'))
  git(['clone', BARE, seed])
  writeFileSync(join(seed, 'test_all.py'), 'from c import top\n\nassert top(1) == 7, top(1)\nprint("INTEGRATION OK")\n')
  git(['add', '-A'], seed)
  git(['commit', '-m', 'seed: integration test'], seed)
  git(['push', 'origin', 'main'], seed)
  rmSync(seed, { recursive: true, force: true })
}

function loadJournal(): Set<string> {
  if (!existsSync(JOURNAL)) return new Set()
  return new Set(readFileSync(JOURNAL, 'utf-8').split('\n').filter(Boolean))
}

/** One worker: fresh clone (empty box FS) → verify dep is ON DISK → port → push → torn down. */
function runWorker(m: (typeof modules)[number]): void {
  const work = mkdtempSync(join(tmpdir(), `wl-${m.id}-`))
  try {
    git(['clone', BARE, work]) // a brand-new, otherwise-empty box
    // THE PROOF: did the durable workspace carry my dependency's code to this fresh box?
    if (m.dep) {
      const present = existsSync(join(work, depFile(m.dep)))
      console.error(`  [${m.id}] fresh clone — dependency ${depFile(m.dep)} on disk? ${present ? 'YES ✓ (git carried it)' : 'NO ✗ (share-nothing)'}`)
      if (!present) throw new Error(`SHARE-NOTHING: ${m.id} cannot see ${m.dep} — the seam is broken`)
    } else {
      console.error(`  [${m.id}] fresh clone — root module, no dependency`)
    }
    writeFileSync(join(work, m.file), m.code) // port the module
    git(['add', '-A'], work)
    git(['commit', '-m', `port ${m.id}`], work)
    git(['push', 'origin', 'main'], work) // accumulate into the durable workspace
    appendFileSync(JOURNAL, `${m.id}\n`) // record the decision durably
    console.error(`  [${m.id}] ported + committed + pushed → torn down`)
  } finally {
    rmSync(work, { recursive: true, force: true }) // teardown — the box dies, git survives
  }
}

/** Test (a): a fresh clone of the durable workspace must pass the integration test. */
function integrationLinks(): boolean {
  const check = mkdtempSync(join(tmpdir(), 'wl-check-'))
  try {
    git(['clone', BARE, check])
    const out = sh('python3', ['test_all.py'], check)
    console.error(`  integration: ${out.trim()}`)
    return out.includes('INTEGRATION OK')
  } catch (e) {
    console.error(`  integration FAILED: ${e instanceof Error ? e.message.split('\n').slice(-3).join(' ') : e}`)
    return false
  } finally {
    rmSync(check, { recursive: true, force: true })
  }
}

function main(): void {
  const resume = process.env.RESUME === '1'
  const killAfter = process.env.KILL_AFTER
  if (!resume) initWorkspace()
  const done = loadJournal()
  console.error(`\n=== git-backed workspace loop · ${resume ? 'RESUME' : 'fresh'}${done.size ? ` (done: ${[...done].join(',')})` : ''} ===`)

  for (const m of modules) {
    if (done.has(m.id)) {
      console.error(`  [${m.id}] skip — already committed (resumed from durable git)`)
      continue
    }
    if (m.dep && !loadJournal().has(m.dep)) throw new Error(`${m.id} blocked: dependency ${m.dep} not done (topo order)`)
    runWorker(m)
    if (killAfter === m.id) {
      console.error(`\n💥 KILLED after ${m.id} (orchestrator death). Durable git has: ${[...loadJournal()].join(',')}. Re-run with RESUME=1.\n`)
      process.exit(1)
    }
  }

  const links = integrationLinks()
  console.error(`\n=== ${links ? '✅ LINKS — git-backed workspace + resume is REAL' : '❌ does not link'} ===`)
  process.exit(links ? 0 : 1)
}

main()
