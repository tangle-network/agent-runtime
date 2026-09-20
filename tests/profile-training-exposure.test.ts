import { campaignScenarioIdentity } from '@tangle-network/agent-eval/campaign'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { improve } from '../src/improvement/improve'
import { improvementFinding, improvementOptions } from './helpers/improvement-method-fixture'
import { trainedProfile } from './helpers/trained-profile'

describe('training exposure in method evaluation', () => {
  for (const inherited of [false, true]) {
    it(`refuses exposed final tasks from ${inherited ? 'ancestor' : 'current'} training before method construction`, async () => {
      const options = improvementOptions()
      let factoryCalls = 0
      let agentCalls = 0
      let profile = trainedProfile({ prompt: { systemPrompt: 'BASELINE' } }, [
        {
          benchmark: 'export',
          task: 'alias',
          contentDigest: campaignScenarioIdentity(options.testScenarios[0]!).scenarioDigest,
        },
      ])
      if (inherited)
        profile = trainedProfile(profile, [
          { benchmark: 'fresh', task: 'fresh', contentDigest: canonicalCandidateDigest('fresh') },
        ])
      await expect(
        improve(profile, {
          ...options,
          findings: [improvementFinding],
          method: (context) => {
            factoryCalls++
            return options.method(context)
          },
          agent: async (...args) => {
            agentCalls++
            return options.agent(...args)
          },
        }),
      ).rejects.toThrow(/training exposure/)
      expect(factoryCalls).toBe(0)
      expect(agentCalls).toBe(0)
    })
  }

  for (const exposedToFinal of [true, false]) {
    it(`${exposedToFinal ? 'refuses' : 'accepts'} an optimizer-selected trained profile ${exposedToFinal ? 'exposed to final test content' : 'exposed only to development content'}`, async () => {
      const options = improvementOptions()
      const profile: AgentProfile = { prompt: { systemPrompt: 'BASELINE' } }
      const trainingScenario = exposedToFinal
        ? options.testScenarios[0]!
        : options.trainScenarios[0]!
      const candidate = trainedProfile({ prompt: { systemPrompt: 'PROMOTED' } }, [
        {
          benchmark: 'export',
          task: 'alias',
          contentDigest: campaignScenarioIdentity(trainingScenario).scenarioDigest,
        },
      ])
      let trainedAgentCalls = 0
      const result = improve(profile, {
        ...options,
        surface: 'agent-profile',
        findings: [improvementFinding],
        method: (context) => {
          const method = options.method(context)
          return {
            ...method,
            async optimize(input) {
              return { ...(await method.optimize(input)), winnerSurface: JSON.stringify(candidate) }
            },
          }
        },
        agent: async (candidate, scenario, context) => {
          if (candidate.metadata?.training) trainedAgentCalls++
          return options.agent(candidate, scenario, context)
        },
      })
      if (exposedToFinal) {
        await expect(result).rejects.toThrow(/training exposure/)
        expect(trainedAgentCalls).toBe(0)
      } else {
        const measured = await result
        expect(measured.decision).toBe('ship')
        expect(trainedAgentCalls).toBeGreaterThan(0)
        await measured.dispose()
      }
    })
  }
})
