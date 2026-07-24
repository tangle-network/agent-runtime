import { describe, expect, it } from 'vitest'
import {
  captureProposerProvenance,
  claudeSettingsModel,
  type VersionExec,
} from './proposer-provenance.mts'
import type { ProposerSpec } from './proposer-fanout.mts'

const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' })

const gen4ish: ProposerSpec[] = [
  { name: 'claude-author', profile: 'default-author.profile.json', harness: 'claude' },
  { name: 'glm-author', harness: 'opencode', model: 'zai-coding-plan/glm-5.2' },
  { name: 'codex-author', harness: 'codex' },
  { name: 'merge-author', profile: 'default-author.profile.json', harness: 'claude', merge: true },
]

describe('captureProposerProvenance', () => {
  const exec: VersionExec = async (command, args) => {
    if (args[0] === '--version') return ok(`${command}-version 9.9.9`)
    if (command === 'codex' && args[0] === 'login') return ok('Logged in using ChatGPT')
    throw new Error(`unexpected exec ${command} ${args.join(' ')}`)
  }

  it('records pinned model, harness version, settings model, and codex auth per seat', async () => {
    const record = await captureProposerProvenance(gen4ish, {
      exec,
      readSettingsModel: () => 'claude-fable-5',
    })
    expect(record.schema).toBe('swe-arena.proposer-provenance.v1')
    const byName = Object.fromEntries(record.proposers.map((p) => [p.name, p]))
    // Claude seat: no pin — the CLI's resolved settings model is the record.
    expect(byName['claude-author']).toMatchObject({
      harness: 'claude',
      pinnedModel: null,
      settingsModel: 'claude-fable-5',
      harnessVersion: 'claude-version 9.9.9',
      authStatus: null,
      merge: false,
    })
    // Pinned opencode seat: explicit model id, settings model not consulted.
    expect(byName['glm-author']).toMatchObject({
      harness: 'opencode',
      pinnedModel: 'zai-coding-plan/glm-5.2',
      settingsModel: null,
      harnessVersion: 'opencode-version 9.9.9',
    })
    // Codex seat: version + auth status captured.
    expect(byName['codex-author']).toMatchObject({
      harness: 'codex',
      pinnedModel: null,
      authStatus: 'Logged in using ChatGPT',
    })
    expect(byName['merge-author']!.merge).toBe(true)
  })

  it('fails loud when a configured harness binary is missing', async () => {
    const broken: VersionExec = async (command, args) =>
      command === 'codex' ? { code: 127, stdout: '', stderr: 'not found' } : exec(command, args)
    await expect(
      captureProposerProvenance(gen4ish, { exec: broken, readSettingsModel: () => null }),
    ).rejects.toThrow(/'codex --version' failed/)
  })

  it('fails loud when the codex seat is not logged in', async () => {
    const loggedOut: VersionExec = async (command, args) => {
      if (args[0] === '--version') return ok(`${command} 1.0.0`)
      return ok('Not logged in')
    }
    await expect(
      captureProposerProvenance([{ name: 'codex-author', harness: 'codex' }], {
        exec: loggedOut,
        readSettingsModel: () => null,
      }),
    ).rejects.toThrow(/not authed/)
  })

  it('runs one version probe per harness, not per proposer', async () => {
    const calls: string[] = []
    const counting: VersionExec = async (command, args) => {
      calls.push(`${command} ${args.join(' ')}`)
      if (args[0] === '--version') return ok(`${command} 1`)
      return ok('Logged in using ChatGPT')
    }
    await captureProposerProvenance(gen4ish, { exec: counting, readSettingsModel: () => null })
    expect(calls.filter((c) => c === 'claude --version')).toHaveLength(1)
    expect(calls.filter((c) => c === 'codex --version')).toHaveLength(1)
    expect(calls.filter((c) => c === 'codex login status')).toHaveLength(1)
  })
})

describe('claudeSettingsModel', () => {
  it('reads the settings model field', () => {
    expect(claudeSettingsModel(() => JSON.stringify({ model: 'claude-fable-5' }), '/x')).toBe('claude-fable-5')
  })

  it('returns null on unreadable/missing/blank settings', () => {
    expect(
      claudeSettingsModel(() => {
        throw new Error('ENOENT')
      }, '/x'),
    ).toBeNull()
    expect(claudeSettingsModel(() => JSON.stringify({}), '/x')).toBeNull()
    expect(claudeSettingsModel(() => JSON.stringify({ model: '' }), '/x')).toBeNull()
  })
})
