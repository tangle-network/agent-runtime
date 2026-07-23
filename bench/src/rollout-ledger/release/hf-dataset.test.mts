import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureRolloutLine } from '../fixtures.mts'
import { writeRolloutLedger } from '../ledger.mts'
import type { RolloutLine } from '../types.ts'
import { buildHfDataset, parseCliArgs, planPushCommand } from './hf-dataset.mts'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-release-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function pilotLines(): RolloutLine[] {
  const base = fixtureRolloutLine()
  return [
    fixtureRolloutLine({
      role: 'worker',
      run_id: '/home/drew/runs/gen3#1',
      messages: [
        { role: 'system', content: 'cwd /home/drew/code/repo' },
        { role: 'user', content: 'HF_TOKEN=hf_abcdef123456 leaked here, hit router.tangle.tools' },
        { role: 'assistant', content: 'done' },
      ],
    }),
    fixtureRolloutLine({ rollout_id: 'supervisor-1', role: 'supervisor', parent_rollout_id: null }),
    fixtureRolloutLine({
      rollout_id: 'proposer-1',
      role: 'proposer',
      outcome: { ...base.outcome, reward: 0.5, reward_source: 'swe-arena-official-judge/candidate-resolved-fraction' },
    }),
    fixtureRolloutLine({ rollout_id: 'holdout-1', task: { ...base.task, split: 'holdout' } }),
    fixtureRolloutLine({
      rollout_id: 'gap-1',
      messages: [],
      outcome: { ...base.outcome, reward: 0 },
      provenance: { captured_at: '2026-07-23T00:00:00.000Z', capture: 'backfill', gap: 'store unavailable' },
    }),
  ]
}

async function writePilotLedger(): Promise<string> {
  const dir = await makeTempDir()
  const path = join(dir, 'ledger.jsonl')
  await writeRolloutLedger(path, pilotLines())
  return path
}

async function readJsonl(path: string): Promise<unknown[]> {
  const raw = await readFile(path, 'utf8')
  return raw.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))
}

describe('buildHfDataset', () => {
  it('builds all formats with fail-closed filters and a scrub report', async () => {
    const ledger = await writePilotLedger()
    const out = join(await makeTempDir(), 'dataset')
    const summary = await buildHfDataset([ledger], { out, formats: ['sft', 'verifiers', 'rft', 'raw'], includeProposers: false })

    expect(summary.read).toBe(5)
    // holdout + proposer dropped: worker, supervisor, gap remain.
    expect(summary.kept).toBe(3)
    expect(summary.scrub.excluded).toEqual({ proposers: 1, nonTrain: 1 })
    expect(summary.formatCounts).toEqual({ sft: 2, verifiers: 2, rft: 2, raw: 3 })

    const raw = (await readJsonl(join(out, 'raw/train.jsonl'))) as RolloutLine[]
    expect(raw).toHaveLength(3)
    expect(raw.map((line) => line.task.split)).toEqual(['train', 'train', 'train'])
    expect(raw.some((line) => line.role === 'proposer')).toBe(false)
    expect(raw[0].run_id).toBe('$WORK/runs/gen3#1')
    expect(raw[0].messages[1].content).toBe('HF_TOKEN=[REDACTED:env] leaked here, hit router.internal.example')

    const sft = (await readJsonl(join(out, 'sft/train.jsonl'))) as Array<{ messages: unknown[] }>
    expect(sft).toHaveLength(2)
    for (const example of sft) expect(Object.keys(example)).toEqual(['messages'])

    const verifiers = (await readJsonl(join(out, 'verifiers/train.jsonl'))) as Array<{ prompt: unknown[]; completion: unknown[] }>
    expect(verifiers).toHaveLength(2)
    for (const output of verifiers) expect(output.prompt.length).toBeGreaterThan(0)

    const rft = (await readJsonl(join(out, 'rft/train.jsonl'))) as Array<{ reference: { split: string } }>
    expect(rft).toHaveLength(2)
    for (const item of rft) expect(item.reference.split).toBe('train')

    const report = JSON.parse(await readFile(join(out, 'scrub-report.json'), 'utf8'))
    expect(report.files[ledger]['home-path']).toBe(summary.scrub.totals['home-path'])
    expect(report.totals['env-secret']).toBe(1)
    expect(report.totals['infra-host']).toBe(1)

    const card = await readFile(join(out, 'README.md'), 'utf8')
    expect(card).toContain('Total lines: 3')
    expect(card).toContain('license: unknown')
  })

  it('includes proposer lines only with the flag', async () => {
    const ledger = await writePilotLedger()
    const out = join(await makeTempDir(), 'dataset')
    const summary = await buildHfDataset([ledger], { out, formats: ['raw'], includeProposers: true })
    expect(summary.kept).toBe(4)
    expect(summary.scrub.excluded.proposers).toBe(0)
    const raw = (await readJsonl(join(out, 'raw/train.jsonl'))) as RolloutLine[]
    expect(raw.some((line) => line.role === 'proposer')).toBe(true)
  })

  it('is deterministic: two builds from the same ledger are byte-identical', async () => {
    const ledger = await writePilotLedger()
    const outA = join(await makeTempDir(), 'a')
    const outB = join(await makeTempDir(), 'b')
    const options = { formats: ['sft', 'verifiers', 'rft', 'raw'] as const, includeProposers: false }
    await buildHfDataset([ledger], { out: outA, formats: [...options.formats], includeProposers: options.includeProposers })
    await buildHfDataset([ledger], { out: outB, formats: [...options.formats], includeProposers: options.includeProposers })
    for (const file of ['raw/train.jsonl', 'sft/train.jsonl', 'verifiers/train.jsonl', 'rft/train.jsonl', 'scrub-report.json', 'README.md']) {
      expect(await readFile(join(outA, file), 'utf8')).toBe(await readFile(join(outB, file), 'utf8'))
    }
  })

  it('rejects empty inputs and empty formats', async () => {
    const out = join(await makeTempDir(), 'dataset')
    await expect(buildHfDataset([], { out, formats: ['raw'], includeProposers: false })).rejects.toThrow('no input ledgers')
    const ledger = await writePilotLedger()
    await expect(buildHfDataset([ledger], { out, formats: [], includeProposers: false })).rejects.toThrow('no formats')
  })
})

describe('CLI arg parsing', () => {
  it('parses the documented one-command shape', () => {
    const args = parseCliArgs(['a.jsonl', 'b.jsonl', '--out', '/tmp/x', '--formats', 'sft,raw', '--include-proposers'])
    expect(args).toEqual({ inputs: ['a.jsonl', 'b.jsonl'], out: '/tmp/x', formats: ['sft', 'raw'], includeProposers: true, push: null })
  })

  it('defaults to all formats and no proposers', () => {
    const args = parseCliArgs(['a.jsonl', '--out', '/tmp/x'])
    expect(args.formats).toEqual(['sft', 'verifiers', 'rft', 'raw'])
    expect(args.includeProposers).toBe(false)
  })

  it('rejects unknown formats, unknown flags, missing out, bad push repo', () => {
    expect(() => parseCliArgs(['a.jsonl', '--out', '/tmp/x', '--formats', 'sft,nope'])).toThrow('unknown format "nope"')
    expect(() => parseCliArgs(['a.jsonl', '--out', '/tmp/x', '--frobnicate'])).toThrow('unknown flag')
    expect(() => parseCliArgs(['a.jsonl'])).toThrow('usage:')
    expect(() => parseCliArgs(['a.jsonl', '--out', '/tmp/x', '--push', 'not-a-repo'])).toThrow('--push expects <org/name>')
  })
})

describe('push dry-run', () => {
  it('plans the exact huggingface-cli upload argv without touching the network', () => {
    expect(planPushCommand('tangle/rollouts-gen3', '/tmp/x')).toEqual([
      'huggingface-cli',
      'upload',
      'tangle/rollouts-gen3',
      '/tmp/x',
      '.',
      '--repo-type',
      'dataset',
    ])
  })
})
