#!/usr/bin/env node
/**
 * Run the durability kill-and-resume conformance suites and write the machine-readable results
 * (`conformance/durability/results.json`). The human verdict lives in
 * `conformance/durability/STATUS.md`; this script refreshes the evidence that verdict cites.
 *
 * Usage: node scripts/run-durability-conformance.mjs [--out <file>]
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const outFlag = args.indexOf('--out')
const outFile =
  outFlag >= 0 ? resolve(repoRoot, args[outFlag + 1] ?? '') : join(repoRoot, 'conformance/durability/results.json')

const testFiles = [
  'tests/durability/graph-rundir-journal.test.ts',
  'tests/durability/graph-kill-resume.test.ts',
  'tests/durability/session-reattach.test.ts',
  'tests/durability/sql-kill-resume.test.ts',
  'tests/durability/conversation-kill-resume.test.ts',
  'tests/durability/known-defects.test.ts',
  'tests/durability/inotify-invariant.test.ts',
]

const tmp = mkdtempSync(join(tmpdir(), 'durability-conformance-'))
try {
  const outputFile = join(tmp, 'results.json')
  try {
    execFileSync(
      'pnpm',
      ['exec', 'vitest', 'run', '--reporter=json', `--outputFile=${outputFile}`, ...testFiles],
      { cwd: repoRoot, stdio: ['ignore', 'inherit', 'inherit'], env: process.env },
    )
  } catch (error) {
    // A failing case is a result, not a crash: collect whatever the reporter wrote.
    if (!error.status) throw error
  }
  const report = JSON.parse(readFileSync(outputFile, 'utf8'))
  const cases = []
  for (const suite of report.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      cases.push({
        file: suite.name.replace(/^.*?(tests\/)/, '$1'),
        suite: assertion.ancestorTitles?.join(' > ') ?? '',
        title: assertion.title,
        status: assertion.status,
        durationMs: assertion.duration ?? null,
        failureMessages: assertion.failureMessages?.length ? assertion.failureMessages : undefined,
      })
    }
  }
  const passed = cases.filter((c) => c.status === 'passed').length
  const failed = cases.filter((c) => c.status === 'failed').length
  const expectedFail = cases.filter((c) => c.status === 'failed' && /known defect: 2026-09-16/.test(c.suite)).length
  const result = {
    schema: 'agent-runtime/durability-conformance-results/v1',
    generatedAt: new Date().toISOString(),
    files: testFiles,
    totals: {
      cases: cases.length,
      passed,
      failed,
      // `it.fails` shows as failed in the JSON reporter while the suite stays green; the
      // 2026-09-16 re-entry contract is intentionally in that state until the fix lands.
      expectedFailed: expectedFail,
    },
    cases,
  }
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(
    `\ndurability conformance: ${passed} passed, ${failed} failed (${expectedFail} expected-fail) ` +
      `→ ${outFile}\n`,
  )
  for (const c of cases.filter((c) => c.status === 'failed')) {
    process.stdout.write(`  FAIL ${c.file} > ${c.suite} > ${c.title}\n`)
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
