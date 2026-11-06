import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { fileEscalateQuestion, supervisorRunDir } from '../../src/runtime'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { DriveHarness } from '../../src/runtime/supervise/types'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

async function callTool(url: string, name: string, args: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const body = (await response.json()) as { result?: { content?: Array<{ text?: string }> } }
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>
}

// The root's ask_parent lands as a file an out-of-process observer reads (#1165); the observer
// answers through the existing durable root steer (`writeWorkerSteer` on the root id).
it("writes the root's ask_parent question under the run directory for an outside observer", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'file-question-'))
  const runId = 'run:question'
  let reply: Record<string, unknown> = {}
  try {
    await supervise(
      testAgentProfile('root', { tools: runtimeToolDeclarations('ask_parent', 'stop') }),
      'ask',
      {
        runId,
        runDir: dir,
        budget: { maxIterations: 5, maxTokens: 10_000 },
        inheritSpawnRights: false,
        driverRetry: { enabled: false },
        makeLeafAgent: () => {
          throw new Error('no children in this fixture')
        },
        escalateQuestion: fileEscalateQuestion(dir, runId),
        driveHarness: (async ({ coordinationMcpUrl: url }) => {
          reply = await callTool(url, 'ask_parent', {
            from: 'root',
            level: 'driver',
            question: 'Which dataset is authoritative?',
            reason: 'two sources disagree',
            urgency: 'blocks-step',
          })
          await callTool(url, 'stop', {})
        }) as DriveHarness,
      },
    )
    const questions = join(supervisorRunDir(dir, runId), 'questions')
    const files = await readdir(questions)
    expect(files).toHaveLength(1)
    const written = JSON.parse(await readFile(join(questions, files[0] as string), 'utf8'))
    expect(written).toMatchObject({
      question: 'Which dataset is authoritative?',
      urgency: 'blocks-step',
    })
    expect(JSON.stringify(reply)).toContain(files[0] as string)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
