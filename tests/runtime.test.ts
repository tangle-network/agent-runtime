import { describe, expect, it } from 'vitest'
import {
  createRuntimeEventCollector,
  decideKnowledgeReadiness,
  runAgentTask,
  sanitizeAgentRuntimeEvent,
  summarizeAgentTaskRun,
  type AgentAdapter,
  type AgentTaskSpec,
  type ControlEvalResult,
  type KnowledgeRequirement,
} from '../src/index'

interface State {
  count: number
}

type Action = { type: 'increment' }

const readyReq: KnowledgeRequirement = {
  id: 'build-command',
  description: 'Build command',
  requiredFor: ['test'],
  category: 'codebase_specific',
  acquisitionMode: 'inspect_repo',
  importance: 'blocking',
  freshness: 'weekly',
  sensitivity: 'public',
  confidenceNeeded: 0.8,
  currentConfidence: 0.9,
  evidenceIds: ['page:build'],
  fallbackPolicy: 'block',
}

function adapter(): AgentAdapter<State, Action, State, ControlEvalResult> {
  let current: State = { count: 0 }
  return {
    observe: () => current,
    validate: ({ state }) => [{
      id: 'count-ready',
      passed: state.count >= 1,
      score: state.count >= 1 ? 1 : 0,
      severity: 'info',
      objective: true,
    }],
    decide: ({ state }) => state.count >= 1
      ? { type: 'stop', pass: true, score: 1, reason: 'done' }
      : { type: 'continue', action: { type: 'increment' }, reason: 'need one step' },
    act: () => {
      current = { count: 1 }
      return current
    },
    shouldStop: ({ state }) => ({
      stop: state.count >= 1,
      pass: state.count >= 1,
      score: state.count >= 1 ? 1 : 0,
      reason: state.count >= 1 ? 'done' : 'continue',
    }),
  }
}

describe('runAgentTask', () => {
  it('runs a ready task through the shared control lifecycle', async () => {
    const task: AgentTaskSpec = {
      id: 'task-1',
      intent: 'increment once',
      domain: 'test',
      requiredKnowledge: [readyReq],
      budget: { maxSteps: 3 },
    }

    const result = await runAgentTask({ task, adapter: adapter() })

    expect(result.knowledge.readinessScore).toBe(1)
    expect(result.control.pass).toBe(true)
    expect(result.control.steps).toHaveLength(1)
    expect(result.control.finalState?.count).toBe(1)
  })

  it('blocks before action when required knowledge is missing', async () => {
    const task: AgentTaskSpec = {
      id: 'task-2',
      intent: 'deploy',
      domain: 'legal',
      requiredKnowledge: [{
        ...readyReq,
        id: 'customer-secret',
        description: 'Customer credential',
        category: 'credential_or_secret',
        acquisitionMode: 'ask_user',
        sensitivity: 'secret',
        currentConfidence: 0,
      }],
      budget: { maxSteps: 3 },
    }
    let acted = false

    const events: string[] = []
    const result = await runAgentTask({
      task,
      onEvent: (event) => {
        events.push(event.type)
      },
      adapter: {
        ...adapter(),
        act: () => {
          acted = true
          return { count: 1 }
        },
      },
    })

    expect(acted).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.control.pass).toBe(false)
    expect(result.control.reason).toContain('knowledge readiness blocked')
    expect(result.questions[0]?.answerType).toBe('credential')
    expect(result.acquisitionPlans[0]?.mode).toBe('ask_user')
    expect(events).toContain('task_start')
    expect(events).toContain('readiness_end')
    expect(events).toContain('control_start')
    expect(events).toContain('task_end')
  })

  it('lets adapters convert knowledge blocks into domain actions', async () => {
    const task: AgentTaskSpec = {
      id: 'task-3',
      intent: 'ask for missing info',
      requiredKnowledge: [{ ...readyReq, currentConfidence: 0, acquisitionMode: 'ask_user' }],
      budget: { maxSteps: 1 },
    }

    const result = await runAgentTask({
      task,
      adapter: {
        ...adapter(),
        onKnowledgeBlocked: ({ questions }) => ({
          type: 'stop',
          pass: false,
          reason: `ask: ${questions[0]?.question}`,
        }),
      },
    })

    expect(result.control.reason).toContain('ask:')
    expect(result.control.reason).toContain('Build command')
  })

  it('runs knowledge question/acquisition hooks and refreshes readiness before control', async () => {
    const task: AgentTaskSpec = {
      id: 'task-4',
      intent: 'collect missing context then run',
      requiredKnowledge: [{ ...readyReq, currentConfidence: 0, acquisitionMode: 'ask_user' }],
      budget: { maxSteps: 3 },
    }
    const events: string[] = []

    const result = await runAgentTask({
      task,
      adapter: adapter(),
      onEvent: (event) => events.push(event.type),
      knowledge: {
        answerQuestions: () => ({ question_build: 'Use pnpm typecheck.' }),
        executeAcquisitionPlans: () => ['page:build'],
        refreshReadiness: ({ previous }) => ({
          ...previous,
          readinessScore: 1,
          blockingMissingRequirements: [],
          nonBlockingGaps: [],
          reason: 'Knowledge was collected during preflight.',
          severity: 'info',
          recommendedAction: 'run_agent',
          bundle: {
            ...previous.bundle,
            readinessScore: 1,
            missing: [],
            evidenceIds: ['page:build'],
            userAnswers: { question_build: 'Use pnpm typecheck.' },
          },
        }),
      },
    })

    expect(result.status).toBe('completed')
    expect(result.userAnswers.question_build).toContain('pnpm')
    expect(result.acquiredEvidenceIds).toEqual(['page:build'])
    expect(result.knowledge.readinessScore).toBe(1)
    expect(events).toEqual(expect.arrayContaining([
      'questions_start',
      'questions_end',
      'acquisition_start',
      'acquisition_end',
      'control_step',
    ]))
  })

  it('summarizes runs without exposing task inputs or user answers', async () => {
    const task: AgentTaskSpec = {
      id: 'task-5',
      intent: 'collect secret then run',
      domain: 'test',
      inputs: { apiKey: 'sk-secret' },
      requiredKnowledge: [{
        ...readyReq,
        id: 'api-key',
        description: 'Customer API key',
        category: 'credential_or_secret',
        acquisitionMode: 'ask_user',
        sensitivity: 'secret',
        currentConfidence: 0,
      }],
      budget: { maxSteps: 3 },
    }
    const collector = createRuntimeEventCollector()

    const result = await runAgentTask({
      task,
      adapter: adapter(),
      onEvent: collector.onEvent,
      knowledge: {
        answerQuestions: () => ({ question_api_key: 'sk-real-secret' }),
        refreshReadiness: ({ previous }) => ({
          ...previous,
          readinessScore: 1,
          blockingMissingRequirements: [],
          nonBlockingGaps: [],
          reason: 'Secret was supplied.',
          severity: 'info',
          recommendedAction: 'run_agent',
          bundle: {
            ...previous.bundle,
            readinessScore: 1,
            missing: [],
            userAnswers: { question_api_key: 'sk-real-secret' },
          },
        }),
      },
    })

    const summary = summarizeAgentTaskRun(result)
    const serializedEvents = JSON.stringify(collector.events)

    expect(summary.status).toBe('completed')
    expect(summary.readinessStatus).toBe('ready')
    expect(summary.blockingGapIds).toEqual([])
    expect(summary.questionCount).toBe(1)
    expect(serializedEvents).not.toContain('sk-secret')
    expect(serializedEvents).not.toContain('sk-real-secret')
    expect(serializedEvents).not.toContain('Customer API key')
    expect(serializedEvents).toContain('[redacted]')
  })

  it('can opt into richer sanitized telemetry for private diagnostics', () => {
    const event = {
      type: 'questions_end' as const,
      task: {
        id: 'task-6',
        intent: 'diagnose',
        inputs: { customer: 'Acme' },
        requiredKnowledge: [readyReq],
      },
      questions: [{
        id: 'q1',
        question: 'Please provide: Build command',
        reason: 'Required for test.',
        requirementId: 'build-command',
        importance: 'blocking' as const,
        answerType: 'free_text' as const,
        impactIfUnknown: 'The agent should not run until this is known.',
      }],
      userAnswers: { q1: 'pnpm test' },
    }

    const sanitized = sanitizeAgentRuntimeEvent(event, {
      includeInputs: true,
      includeRequirementDescriptions: true,
      includeUserAnswers: true,
      includeEvidenceIds: true,
    })
    const serialized = JSON.stringify(sanitized)

    expect(serialized).toContain('Acme')
    expect(serialized).toContain('Build command')
    expect(serialized).toContain('pnpm test')
    expect(serialized).toContain('page:build')
  })

  it('returns a stable readiness decision for ready, blocked, and caveat states', async () => {
    const readyTask: AgentTaskSpec = {
      id: 'task-7',
      intent: 'ready',
      requiredKnowledge: [readyReq],
    }
    const blockedTask: AgentTaskSpec = {
      id: 'task-8',
      intent: 'blocked',
      requiredKnowledge: [{ ...readyReq, currentConfidence: 0, fallbackPolicy: 'block' }],
    }
    const caveatTask: AgentTaskSpec = {
      id: 'task-9',
      intent: 'caveat',
      requiredKnowledge: [{
        ...readyReq,
        importance: 'medium',
        currentConfidence: 0.2,
        fallbackPolicy: 'continue_with_caveat',
      }],
    }

    const ready = await runAgentTask({ task: readyTask, adapter: adapter() })
    const blocked = await runAgentTask({ task: blockedTask, adapter: adapter() })
    const caveat = await runAgentTask({ task: caveatTask, adapter: adapter(), minimumReadinessScore: 0 })

    expect(decideKnowledgeReadiness(ready.knowledge).status).toBe('ready')
    expect(decideKnowledgeReadiness(blocked.knowledge).status).toBe('blocked')
    expect(decideKnowledgeReadiness(caveat.knowledge, { minimumScore: 0.9 }).status).toBe('caveat')
  })
})
