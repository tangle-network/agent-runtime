/**
 * HuggingFace dataset-card (README.md) generation for a rollout-ledger release.
 *
 * The card is a pure function of the SCRUBBED lines plus the release options —
 * no timestamps, no environment reads — so rebuilding from the same ledger
 * yields byte-identical output. It documents the schema, provenance (run ids,
 * generations, the official judge), per-role reward semantics including the
 * inherited/contribution caveat, and a role × reward counts table.
 */

import { ROLLOUT_LEDGER_SCHEMA, ROLLOUT_ROLES, type RolloutLine, type RolloutRole } from '../types.ts'
import type { ScrubCounts } from './scrub.mts'

export const RELEASE_FORMATS = ['sft', 'verifiers', 'rft', 'raw'] as const
export type ReleaseFormat = (typeof RELEASE_FORMATS)[number]

/** Format → data file path inside the dataset dir (train split only). */
export const FORMAT_FILES: Record<ReleaseFormat, string> = {
  sft: 'sft/train.jsonl',
  verifiers: 'verifiers/train.jsonl',
  rft: 'rft/train.jsonl',
  raw: 'raw/train.jsonl',
}

const FORMAT_DESCRIPTIONS: Record<ReleaseFormat, string> = {
  sft: 'Successful train-split transcripts (`reward == 1`) as `{messages}` chat JSONL.',
  verifiers: 'Prime Intellect verifiers `RolloutOutput`: prompt/completion split at the first assistant turn, plus reward, metrics, tool defs, and token usage.',
  rft: 'OpenAI RFT items: prompt turns plus `reference.*` verdict fields for a grader (completions are re-sampled during RFT).',
  raw: `Full \`${ROLLOUT_LEDGER_SCHEMA}\` ledger lines (scrubbed), one per agent invocation.`,
}

export interface DatasetCardInputs {
  /** Scrubbed, release-filtered lines (what actually ships). */
  lines: RolloutLine[]
  formats: ReleaseFormat[]
  includeProposers: boolean
  /** Source ledger basenames, for provenance. */
  sourceFiles: string[]
  scrubTotals: ScrubCounts
  excluded: { proposers: number; nonTrain: number }
  formatCounts: Partial<Record<ReleaseFormat, number>>
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => v !== null))].sort()
}

function formatReward(reward: number | null): string {
  if (reward === null) return 'null'
  return Number.isInteger(reward) ? String(reward) : reward.toFixed(4)
}

function markdownTable(header: string[], rows: string[][]): string {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function roleRewardRows(lines: RolloutLine[]): string[][] {
  const counts = new Map<RolloutRole, Map<string, number>>()
  for (const line of lines) {
    const byReward = counts.get(line.role) ?? new Map<string, number>()
    const key = formatReward(line.outcome.reward)
    byReward.set(key, (byReward.get(key) ?? 0) + 1)
    counts.set(line.role, byReward)
  }
  const rows: string[][] = []
  for (const role of ROLLOUT_ROLES) {
    const byReward = counts.get(role)
    if (!byReward) continue
    const keys = [...byReward.keys()].sort((a, b) => {
      if (a === 'null') return 1
      if (b === 'null') return -1
      return Number(b) - Number(a)
    })
    for (const key of keys) rows.push([role, key, String(byReward.get(key))])
  }
  return rows
}

export function buildDatasetCard(inputs: DatasetCardInputs): string {
  const { lines, formats, includeProposers, sourceFiles, scrubTotals, excluded, formatCounts } = inputs

  const runIds = unique(lines.map((line) => line.run_id))
  const generations = [...new Set(lines.map((line) => line.generation))].sort((a, b) => a - b)
  const models = unique(lines.map((line) => line.policy.model))
  const harnesses = unique(lines.map((line) => line.policy.harness))
  const captures = unique(lines.map((line) => line.provenance.capture))
  const rewardSources = unique(lines.map((line) => line.outcome.reward_source))
  const gapLines = lines.filter((line) => line.messages.length === 0).length

  const configs = formats
    .map((format) =>
      [
        `  - config_name: ${format}`,
        '    data_files:',
        '      - split: train',
        `        path: ${FORMAT_FILES[format]}`,
      ].join('\n'),
    )
    .join('\n')

  const frontmatter = [
    '---',
    'license: unknown',
    'pretty_name: Tangle rollout ledger — agent trajectories',
    'configs:',
    configs,
    '---',
  ].join('\n')

  const formatsTable = markdownTable(
    ['config', 'path', 'rows', 'contents'],
    formats.map((format) => [
      format,
      `\`${FORMAT_FILES[format]}\``,
      String(formatCounts[format] ?? 0),
      FORMAT_DESCRIPTIONS[format],
    ]),
  )

  const countsTable = markdownTable(['role', 'reward', 'lines'], roleRewardRows(lines))

  const scrubTable = markdownTable(
    ['rule', 'rewrites'],
    Object.entries(scrubTotals).map(([rule, count]) => [rule, String(count)]),
  )

  const proposerNote = includeProposers
    ? 'Proposer sessions are INCLUDED (`--include-proposers`); their transcripts contain improvement-loop harness source.'
    : `Proposer sessions are excluded by default (${excluded.proposers} lines dropped); they contain improvement-loop harness source. Rebuild with \`--include-proposers\` to keep them.`

  return `${frontmatter}

# Tangle rollout ledger — agent trajectories

One line per agent invocation (supervisor episode, worker session, proposer shot, judge call, analyst pass) captured by the \`${ROLLOUT_LEDGER_SCHEMA}\` rollout ledger, labeled with improvement-loop coordinates and the official-judge reward, with the full message transcript inline.

This release contains the **train split only**. Holdout and canary splits are structurally excluded at build time (never exported), and the build additionally drops any non-train line as a fail-closed filter (${excluded.nonTrain} dropped here).

## Formats

${formatsTable}

## Schema (\`${ROLLOUT_LEDGER_SCHEMA}\`)

Each raw line carries:

- \`rollout_id\` / \`parent_rollout_id\` — invocation identity; workers point at their spawning supervisor episode.
- \`run_id\`, \`generation\`, \`candidate_index\` — improvement-loop coordinates (\`-1\` = baseline campaign).
- \`role\` — one of ${ROLLOUT_ROLES.map((role) => `\`${role}\``).join(', ')}.
- \`task\` — suite, instance id, split, seed, replicate index.
- \`policy\` — harness, model, provider, profile commit, sampling params.
- \`messages\` / \`tool_defs\` — full transcript in canonical OpenAI chat-with-tools form (including \`reasoning_content\`). An empty \`messages\` array is a labeled gap line; \`provenance.gap\` says why the transcript could not be recovered (${gapLines} gap lines in this release).
- \`outcome\` — \`reward\` (the single scalar), \`reward_source\`, the verbatim judge \`verdict\`, and non-scalar \`metrics\`.
- \`cost\` — usd, token counts, wall time.
- \`artifacts\` / \`provenance\` — patch/run-dir/transcript pointers (scrubbed) and capture metadata.

## Provenance

- Source ledgers: ${sourceFiles.map((file) => `\`${file}\``).join(', ')}
- Run ids: ${runIds.map((id) => `\`${id}\``).join(', ')}
- Generations: ${generations.join(', ')} (\`-1\` = baseline campaign)
- Models: ${models.map((m) => `\`${m}\``).join(', ')}
- Harnesses: ${harnesses.map((h) => `\`${h}\``).join(', ')}
- Capture modes: ${captures.join(', ')}
- Judge: the official SWE-bench docker evaluator — every reward traces to its verdict (reward sources: ${rewardSources.map((s) => `\`${s}\``).join(', ')}).

${proposerNote}

## Reward semantics per role

- **supervisor** — the official-judge verdict on the episode's delivered patch (1 = resolved, 0 = not). \`reward_source: swe-arena-official-judge\`.
- **worker** — INHERITED from the parent supervisor episode (\`…/inherited\`). Caveat: reward 1 does not establish this worker's individual contribution (sibling workers in the same episode share the episode outcome), and reward 0 does not prove this worker failed.
- **proposer** — the fraction of improvement-set instances the proposed candidate resolved (\`…/candidate-resolved-fraction\`); a scalar in [0, 1], not a binary verdict.
- **judge / analyst** — carry the episode verdict where one applies; otherwise \`reward: null\` (a labeled gap, never 0).

## Counts

${countsTable}

Total lines: ${lines.length}

## Scrubbing

Absolute home paths were rewritten to \`$WORK\`, credential-shaped strings were replaced with \`[REDACTED:<kind>]\` markers, internal hostnames were normalized to \`*.internal.example\`, and username-bearing incidentals (\`ls -l\` owner columns, per-user pytest tmpdirs) were normalized to \`user\` / \`$USER\`. Rewrite counts for this release (full per-file breakdown in \`scrub-report.json\`):

${scrubTable}

## License

\`license: unknown\` is a placeholder — the releasing operator must set the real SPDX license id in the frontmatter above before publishing.

## Citation

\`\`\`bibtex
@misc{tangle_rollout_ledger,
  title = {Tangle rollout ledger — agent trajectories},
  author = {{Tangle Network}},
  howpublished = {HuggingFace Datasets},
  note = {Operator: fill in the repository URL, authors, and year before publishing}
}
\`\`\`
`
}
