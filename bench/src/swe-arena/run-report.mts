/**
 * CLI over the supervisor-run reader. NO metric logic lives here.
 *
 * The reader itself is `@tangle-network/agent-eval/supervisor-run` — a
 * supervision tree is a rollout trace with one more dimension, so it sits in
 * the trace-analysis layer next to single-rollout analysis, beside the
 * `tangle.rollout.v1` ledger whose row type its tree nodes ARE. This file is
 * only argv parsing plus the entry points the arenas already call.
 *
 * Harness-session view of the same run (model calls, latency, stuck loops,
 * tool errors):
 * `npx @tangle-network/traces analyze --harness opencode --cwd <worker-clone-cwd>`.
 */

import { pathToFileURL } from 'node:url'
import {
  renderSupervisorRunMarkdown,
  reportSupervisorRound,
  type WriteSupervisorRunOptions,
  writeSupervisorRunReport,
} from '@tangle-network/agent-eval/supervisor-run'

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const args = process.argv.slice(2)
  const usage =
    'usage:\n' +
    '  tsx run-report.mts <cellDir> [--log <run.log>] [--patch <file>] [--ledger <ledger.jsonl>] [--report-dir <dir>] [--no-opencode]\n' +
    '  tsx run-report.mts --round <outDir> [--log <run.log>] [--ledger <ledger.jsonl>] [--report-dir <dir>] [--no-opencode]\n' +
    '\n--report-dir writes the reports outside the run directory (use it when the run dir is READ-ONLY).\n'
  const noOpencode = args.includes('--no-opencode')
  const flagValue = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const appendHeadlineTo = flagValue('--log')
  const patchPath = flagValue('--patch')
  const reportDir = flagValue('--report-dir')
  const ledgerPath = flagValue('--ledger')
  const flagValueIndices = new Set(
    ['--log', '--patch', '--report-dir', '--ledger', '--round']
      .map((f) => args.indexOf(f))
      .filter((i) => i >= 0)
      .map((i) => i + 1),
  )
  const positional = args.filter((a, i) => !a.startsWith('--') && !flagValueIndices.has(i))
  const roundIdx = args.indexOf('--round')
  const opts: WriteSupervisorRunOptions = {
    ...(appendHeadlineTo !== undefined ? { appendHeadlineTo } : {}),
    ...(patchPath !== undefined ? { patchPath } : {}),
    ...(reportDir !== undefined ? { reportDir } : {}),
    ...(ledgerPath !== undefined ? { ledgerPath } : {}),
    ...(noOpencode ? { opencodeDb: null } : {}),
    echo: true,
  }
  if (roundIdx >= 0) {
    const outDir = args[roundIdx + 1]
    if (outDir === undefined) {
      console.error(usage)
      process.exit(2)
    }
    await reportSupervisorRound(outDir, opts)
  } else {
    const cellDir = positional[0]
    if (cellDir === undefined) {
      console.error(usage)
      process.exit(2)
    }
    const report = await writeSupervisorRunReport(cellDir, opts)
    console.log('')
    console.log(renderSupervisorRunMarkdown(report))
  }
}
