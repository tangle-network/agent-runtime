/**
 * Offline EnterpriseOps-Gym adapter test. The judge needs a live, freshly-seeded
 * gym MCP server (Docker), not installed in CI, so this exercises the parts that
 * run offline (fixtures loadTasks, the transcript OutputAdapter, goldArtifact) and
 * asserts the judge FAILS LOUD with the documented docker fix when no server is
 * reachable — never a fake score. Run:
 *   EOPS_FIXTURES=1 npx tsx --test src/benchmarks/enterpriseops-gym.test.mts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEnterpriseOpsGymAdapter, enterpriseOpsTranscriptOutput } from './enterpriseops-gym'

process.env.EOPS_FIXTURES = '1'

type Events = Parameters<typeof enterpriseOpsTranscriptOutput.parse>[0]
const stream = (text: string): Events => [{ data: { finalText: text } }] as unknown as Events

const itsmId = 'task_20251212_172511_458_e6427839_47076c15'

test('loadTasks (fixtures) yields enterprise tasks with tool-list + SQL-verifier metadata', async () => {
  const a = createEnterpriseOpsGymAdapter()
  const tasks = await a.loadTasks({ ids: [itsmId] })
  assert.equal(tasks.length, 1)
  const t = tasks[0]
  assert.equal(t.id, itsmId)
  assert.equal(t.split, 'itsm')
  assert.match(t.prompt, /```json/)
  assert.match(t.prompt, /update_incident/)
  const md = t.metadata as Record<string, unknown>
  assert.equal(md.taskId, itsmId)
  assert.equal(md.domain, 'itsm')
  assert.ok(Array.isArray(md.servers) && (md.servers as unknown[]).length === 1)
  const verifiers = md.verifiers as Array<{ verifier_type: string; validation_config: { query: string } }>
  assert.equal(verifiers.length, 2)
  assert.equal(verifiers[0].verifier_type, 'database_state')
  assert.match(verifiers[0].validation_config.query, /SELECT COUNT/)
})

test('loadTasks scopes by domain split and limit', async () => {
  const a = createEnterpriseOpsGymAdapter()
  const cal = await a.loadTasks({ split: 'calendar' })
  assert.equal(cal.length, 1)
  assert.equal(cal[0].split, 'calendar')
  const capped = await a.loadTasks({ limit: 1 })
  assert.equal(capped.length, 1)
})

test('transcript OutputAdapter: last fenced ```json wins; fence-less falls back to trimmed text', () => {
  const fenced = enterpriseOpsTranscriptOutput.parse(
    stream('preamble\n```json\n{"calls":[{"tool":"update_incident","arguments":{}}]}\n```\n'),
  )
  assert.equal(fenced, '{"calls":[{"tool":"update_incident","arguments":{}}]}')
  const last = enterpriseOpsTranscriptOutput.parse(stream('```json\nFIRST\n```\nmid\n```json\nSECOND\n```'))
  assert.equal(last, 'SECOND')
  const raw = enterpriseOpsTranscriptOutput.parse(stream('  {"calls":[]}  '))
  assert.equal(raw, '{"calls":[]}')
})

test('goldArtifact is undefined — oracle is the seeded DB state, documented, not a fabricated transcript', async () => {
  const a = createEnterpriseOpsGymAdapter()
  const [t] = await a.loadTasks({ ids: [itsmId] })
  assert.equal(await a.goldArtifact(t), undefined)
})

test('judge FAILS LOUD with the docker fix when no gym server is reachable (no fake score)', async () => {
  const a = createEnterpriseOpsGymAdapter()
  const [t] = await a.loadTasks({ ids: [itsmId] })
  // Point the metadata at a definitely-dead port so the SQL-runner POST is refused.
  const md = t.metadata as Record<string, unknown>
  const servers = md.servers as Array<{ mcp_server_url: string }>
  servers[0].mcp_server_url = 'http://127.0.0.1:1'
  await assert.rejects(a.judge(t, '{"calls":[]}'), (e: Error) => {
    assert.match(e.message, /enterpriseops-gym judge failed/)
    assert.match(e.message, /docker pull shivakrishnareddyma225\/enterpriseops-gym-mcp-itsm/)
    return true
  })
})
