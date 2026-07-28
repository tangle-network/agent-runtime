import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { AgentImprovementProposal } from '@tangle-network/agent-interface'
import {
  type AgentProfileImprovementProposalFixture,
  loadAgentImprovementProposalFixture,
  loadAgentProfileImprovementProposalFixture,
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

describe('agent profile improvement proposal testing fixture', () => {
  it('round-trips an opaque profile comparison through production validation', () => {
    const proposal = loadAgentProfileImprovementProposalFixture()
    const roundTrip = JSON.parse(JSON.stringify(proposal)) as AgentProfileImprovementProposalFixture

    expect(proposal.evaluation.kind).toBe('agent-profile-improvement-measured-comparison')
    expect(proposal.evaluation.metadata).toMatchObject({
      fixture: 'agent-profile-improvement-proposal',
      runtimeVersion: runtimePackage.version,
    })
    expect(Object.keys(proposal.evaluation.experiment.baseline)).toEqual(['stateDigest'])
    expect(Object.keys(proposal.evaluation.experiment.candidate)).toEqual(['stateDigest'])
    expect(verifyAgentImprovementProposal(roundTrip)).toEqual(proposal)
  })

  it('rejects nested tampering and returns an isolated clone', () => {
    const loaded = loadAgentProfileImprovementProposalFixture()
    const proposal = JSON.parse(JSON.stringify(loaded)) as AgentProfileImprovementProposalFixture
    const prompt = proposal.evaluation.experiment.change[0]?.set.prompt
    if (!prompt) throw new Error('profile improvement fixture must include a prompt diff')
    prompt.systemPrompt = 'tampered profile improvement prompt'

    expect(() => verifyAgentImprovementProposal(proposal)).toThrow()
    const reloaded = loadAgentProfileImprovementProposalFixture()
    expect(reloaded).not.toBe(loaded)
    expect(reloaded.evaluation).not.toBe(loaded.evaluation)
    expect(reloaded.evaluation.experiment.change[0]?.set.prompt?.systemPrompt).toBe(
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
