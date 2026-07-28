import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  type AgentImprovementProposal,
  applyAgentProfileDiff,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import {
  type AgentProfileImprovementFixture,
  loadAgentImprovementProposalFixture,
  loadAgentProfileImprovementFixture,
} from '@tangle-network/agent-runtime/testing'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { verifyAgentImprovementProposal } from '../src/intelligence/improvement-cycle'

const runtimePackage = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { version: string }

describe('agent improvement proposal testing fixture', () => {
  it('round-trips through JSON and production validation', () => {
    const proposal = loadAgentImprovementProposalFixture()
    const roundTrip = JSON.parse(JSON.stringify(proposal)) as AgentImprovementProposal

    expect(proposal.evaluation.kind).toBe('agent-improvement-measured-comparison')
    expect(proposal.evaluation.metadata).toMatchObject({
      fixture: 'agent-improvement-proposal',
      runtimeVersion: runtimePackage.version,
    })
    expect(verifyAgentImprovementProposal(roundTrip)).toEqual(proposal)
  })

  it('rejects nested tampering and returns an isolated clone', () => {
    const loaded = loadAgentImprovementProposalFixture()
    const proposal = JSON.parse(JSON.stringify(loaded)) as AgentImprovementProposal
    const prompt = proposal.evaluation.experiment.candidate.profile.prompt
    if (!prompt) throw new Error('testing fixture candidate must include a prompt')
    prompt.systemPrompt = 'tampered fixture prompt'

    expect(() => verifyAgentImprovementProposal(proposal)).toThrow()
    const reloaded = loadAgentImprovementProposalFixture()
    expect(reloaded).not.toBe(loaded)
    expect(reloaded.evaluation).not.toBe(loaded.evaluation)
    expect(reloaded.evaluation.experiment.candidate.profile.prompt?.systemPrompt).toBe(
      'Return the exact measured answer.',
    )
  })
})

describe('agent profile improvement testing fixture', () => {
  it('round-trips an opaque profile comparison through production validation', () => {
    const fixture = loadAgentProfileImprovementFixture()
    const roundTrip = JSON.parse(JSON.stringify(fixture)) as AgentProfileImprovementFixture
    const proposal = fixture.proposal

    expect(proposal.evaluation.kind).toBe('agent-profile-improvement-measured-comparison')
    expect(proposal.evaluation.metadata).toMatchObject({
      fixture: 'agent-profile-improvement-proposal',
      runtimeVersion: runtimePackage.version,
    })
    expect(Object.keys(proposal.evaluation.experiment.baseline)).toEqual(['stateDigest'])
    expect(Object.keys(proposal.evaluation.experiment.candidate)).toEqual(['stateDigest'])
    expect(verifyAgentImprovementProposal(roundTrip.proposal)).toEqual(proposal)
    expect(roundTrip).toEqual(fixture)
  })

  it('binds the private profiles and size to the proposal state digests', () => {
    const fixture = loadAgentProfileImprovementFixture()
    const experiment = fixture.proposal.evaluation.experiment
    const stateDigest = (profile: typeof fixture.baselineProfile) =>
      canonicalCandidateDigest({
        definition: profile,
        recommendedSize: fixture.recommendedSize,
      })

    expect(stateDigest(fixture.baselineProfile)).toBe(experiment.baseline.stateDigest)
    expect(stateDigest(fixture.candidateProfile)).toBe(experiment.candidate.stateDigest)
    expect(
      experiment.change.reduce(
        (profile, change) => applyAgentProfileDiff(profile, change),
        fixture.baselineProfile,
      ),
    ).toEqual(fixture.candidateProfile)
  })

  it('keeps every raw profile outside the serialized proposal', () => {
    const fixture = loadAgentProfileImprovementFixture()
    const proposal = fixture.proposal

    expect(objectKeyPaths(proposal, ['profile', 'baselineProfile', 'candidateProfile'])).toEqual([])
    expect(
      objectPathsWithDigest(proposal, canonicalCandidateDigest(fixture.baselineProfile)),
    ).toEqual([])
    expect(
      objectPathsWithDigest(proposal, canonicalCandidateDigest(fixture.candidateProfile)),
    ).toEqual([])
    expect(Object.keys(proposal.evaluation.experiment.baseline)).toEqual(['stateDigest'])
    expect(Object.keys(proposal.evaluation.experiment.candidate)).toEqual(['stateDigest'])
    expect(fixture.baselineProfile.name).toBe('support-agent')
    expect(fixture.candidateProfile.name).toBe('support-agent')
  })

  it('rejects nested proposal tampering and returns isolated immutable values', () => {
    const loaded = loadAgentProfileImprovementFixture()
    const proposal = JSON.parse(
      JSON.stringify(loaded.proposal),
    ) as AgentProfileImprovementFixture['proposal']
    const prompt = proposal.evaluation.experiment.change[0]?.set.prompt
    if (!prompt) throw new Error('profile improvement fixture must include a prompt diff')
    prompt.systemPrompt = 'tampered profile improvement prompt'

    expect(() => verifyAgentImprovementProposal(proposal)).toThrow()
    const reloaded = loadAgentProfileImprovementFixture()
    expect(reloaded).not.toBe(loaded)
    expect(reloaded.proposal).not.toBe(loaded.proposal)
    expect(reloaded.baselineProfile).not.toBe(loaded.baselineProfile)
    expect(reloaded.candidateProfile).not.toBe(loaded.candidateProfile)
    expect(Object.isFrozen(reloaded)).toBe(true)
    expect(Object.isFrozen(reloaded.baselineProfile)).toBe(true)
    expect(reloaded.proposal.evaluation.experiment.change[0]?.set.prompt?.systemPrompt).toBe(
      'Answer directly, cite the source, and state uncertainty.',
    )
  })
})

describe('testing entrypoint isolation', () => {
  it('keeps normal source files from importing the testing entrypoint', () => {
    const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
    const testingRoot = resolve(sourceRoot, 'testing')
    const violations: string[] = []

    for (const file of sourceFiles(sourceRoot)) {
      if (isWithin(file, testingRoot)) continue
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      )
      for (const specifier of moduleSpecifiers(source)) {
        const resolvesToTesting =
          specifier === '@tangle-network/agent-runtime/testing' ||
          (specifier.startsWith('.') && isWithin(resolve(dirname(file), specifier), testingRoot))
        if (resolvesToTesting) {
          violations.push(`${relative(sourceRoot, file)} -> ${specifier}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('recognizes TypeScript import types', () => {
    const source = ts.createSourceFile(
      'production.ts',
      "type Fixture = typeof import('../testing')",
      ts.ScriptTarget.Latest,
      true,
    )

    expect(moduleSpecifiers(source)).toEqual(['../testing'])
  })
})

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() &&
      /\.[cm]?tsx?$/.test(entry.name) &&
      !/\.(?:test|spec)\.[cm]?tsx?$/.test(entry.name)
      ? [path]
      : []
  })
}

function objectKeyPaths(value: unknown, expectedKeys: readonly string[], path = '$'): string[] {
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => objectKeyPaths(item, expectedKeys, `${path}[${index}]`))
  }
  return Object.entries(value).flatMap(([key, item]) => [
    ...(expectedKeys.includes(key) ? [`${path}.${key}`] : []),
    ...objectKeyPaths(item, expectedKeys, `${path}.${key}`),
  ])
}

function objectPathsWithDigest(value: unknown, expectedDigest: string, path = '$'): string[] {
  if (value === null || typeof value !== 'object') return []
  const matches = canonicalCandidateDigest(value) === expectedDigest ? [path] : []
  if (Array.isArray(value)) {
    return [
      ...matches,
      ...value.flatMap((item, index) =>
        objectPathsWithDigest(item, expectedDigest, `${path}[${index}]`),
      ),
    ]
  }
  return [
    ...matches,
    ...Object.entries(value).flatMap(([key, item]) =>
      objectPathsWithDigest(item, expectedDigest, `${path}.${key}`),
    ),
  ]
}

function moduleSpecifiers(source: ts.SourceFile): string[] {
  const specifiers: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`)
}
