import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collidesWithHarnessNativeTool } from '../../src/mcp/harness-native-tools'

/**
 * The shipped skills are PROMPT TEXT. A model reads a tool name out of one as a bare word, so a
 * skill is the carrier a harness-native collision travels on — a guard that only reads TypeScript
 * misses it entirely. These files also leave the repository: `package.json` `files` puts `skills`
 * in the npm tarball, and `bench/src/atom-mcp-e2e.mts` injects `skills/supervise/SKILL.md`
 * verbatim into a real driver's prompt.
 */
const packageRoot = resolve(__dirname, '../..')
const skillsRoot = join(packageRoot, 'skills')

function skillFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return skillFiles(path)
    return entry === 'SKILL.md' ? [path] : []
  })
}

/**
 * Tool words a model could act on: every backticked span, plus the bare `word(` call form skills
 * use in numbered steps. A span is kept only if it looks like a tool name — one identifier, no
 * whitespace or path separators — and a call form contributes just the callee. `api.spawn_worker`
 * contributes its last segment, because that is the word a reader lifts out of it.
 */
function toolWords(markdown: string): ReadonlyArray<string> {
  const words = new Set<string>()
  for (const [, span] of markdown.matchAll(/`([^`\n]+)`/g)) {
    const call = span.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*\(/)
    const bare = call ? call[1] : span
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(bare)) continue
    words.add(bare.slice(bare.lastIndexOf('.') + 1))
  }
  for (const [, callee] of markdown.matchAll(/(?<![`\w.])([a-z_][a-z0-9_]{2,})\s*\(/g)) {
    words.add(callee)
  }
  return [...words]
}

describe('shipped skills name no harness-native tool', () => {
  const files = skillFiles(skillsRoot)

  it('finds the shipped skills on disk', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('no skill names a tool word a harness publishes natively', () => {
    const collisions = files.flatMap((file) => {
      const markdown = readFileSync(file, 'utf8')
      return toolWords(markdown).flatMap((word) =>
        collidesWithHarnessNativeTool(word).map((harness) => ({
          file: relative(packageRoot, file),
          word,
          harness,
        })),
      )
    })
    expect(
      collisions,
      collisions
        .map(
          ({ file, word, harness }) =>
            `${file} names the tool "${word}", which the ${harness} harness publishes natively. ` +
            "This file is prompt text: a model reads that bare word and calls the HARNESS's tool, " +
            "so the runtime's tool is never called and the work it starts gets no journal row, no " +
            'reservation from the conserved budget pool, and no grade. Name the runtime tool ' +
            'instead.',
        )
        .join('\n'),
    ).toEqual([])
  })
})

describe('supervise skill recursive authority', () => {
  const supervise = readFileSync(join(skillsRoot, 'supervise', 'SKILL.md'), 'utf8')

  it('teaches the profile-owned spawn signal and complete skill propagation', () => {
    expect(supervise).toContain('tools.agent_runtime_coordination_spawn_worker: true')
    expect(supervise).toContain(
      'Every profile with spawn authority must carry the complete authoring skill',
    )
    expect(supervise).toContain('"name": "profile-authoring"')
    expect(supervise).toContain('"failOnError": true')
  })

  it('does not grant recursion through role metadata', () => {
    expect(supervise).not.toMatch(/metadata\.role|role\s*:\s*['"]driver['"]|"role"\s*:\s*"driver"/)
  })
})
