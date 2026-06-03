// Step A (increment 1) of the trajectory-capture pipeline: turn a Claude Code session
// transcript (you driving the top-level agent) into the human-driving signal — the
// (intent, steer-move, fan-out) half — and emit FeedbackTrajectory-SHAPED records plus a
// driving-policy summary. This is the imitation corpus: "what Drew steers toward."
//
// Increment 1 = the MAIN transcript's human signal (intent turns, short steers, the
// explicit AskUserQuestion forks, and per-turn subagent/workflow fan-out). Increment 2
// joins the subagent/workflow subtrees + attaches outcomes, and wires agent-eval's real
// FeedbackTrajectory type + summarizePreferenceMemory. Plain Node ESM (streams big files).
//
//   node trajectory-assemble.mjs [transcript.jsonl] [outDir]

import { createReadStream, mkdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const TRANSCRIPT =
  process.argv[2] ??
  '/home/drew/.claude/projects/-home-drew-code-agent-runtime/52d557cf-89a5-45b8-b590-8c598fb378ab.jsonl'
const OUT_DIR = process.argv[3] ?? '/tmp/trajectory'

// A short imperative/approval turn is a STEER (a course-correction on the prior move);
// a longer turn is a fresh INTENT. Crude but matches how driving reads on the wire.
const STEER_MAX = 160
const STEER_HINT = /^(yes|yep|yeah|yalla|ok|okay|do it|go|sure|nah|no|stop|push|merge|continue|keep going|build it|ship it|lgtm|sounds good|great|perfect|exactly|right)/i

const intents = [] // { uuid, promptId, ts, text, kind: 'intent'|'steer' }
const asks = [] // { ts, promptId, toolUseId, questions:[{q,header,options[]}], chosen }
const spawnsByPrompt = new Map() // promptId -> { agents, workflows }
const toolCounts = new Map()
let assistantTurns = 0

const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1)

const rl = createInterface({ input: createReadStream(TRANSCRIPT), crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.trim()) continue
  let r
  try {
    r = JSON.parse(line)
  } catch {
    continue
  }
  const c = r?.message?.content
  if (r.type === 'user' && typeof c === 'string' && r.isSidechain !== true) {
    const text = c.trim()
    if (!text) continue
    const kind = text.length <= STEER_MAX && STEER_HINT.test(text) ? 'steer' : 'intent'
    intents.push({ uuid: r.uuid, promptId: r.promptId, ts: r.timestamp, text, kind })
  } else if (r.type === 'assistant' && Array.isArray(c)) {
    assistantTurns += 1
    for (const b of c) {
      if (b?.type !== 'tool_use') continue
      bump(toolCounts, b.name)
      if (b.name === 'Agent' || b.name === 'Workflow') {
        const pid = r.promptId ?? 'unknown'
        const cur = spawnsByPrompt.get(pid) ?? { agents: 0, workflows: 0 }
        if (b.name === 'Agent') cur.agents += 1
        else cur.workflows += 1
        spawnsByPrompt.set(pid, cur)
      }
      if (b.name === 'AskUserQuestion') {
        const questions = (b.input?.questions ?? []).map((q) => ({
          q: q.question,
          header: q.header,
          options: (q.options ?? []).map((o) => o.label),
        }))
        asks.push({ ts: r.timestamp, promptId: r.promptId, toolUseId: b.id, questions, chosen: null })
      }
    }
  } else if (r.type === 'user' && Array.isArray(c)) {
    for (const b of c) {
      if (b?.type !== 'tool_result') continue
      const tur = r.toolUseResult
      const a = asks.find((x) => x.toolUseId === b.tool_use_id && x.chosen === null)
      if (a && tur && (tur.answers || tur.metadata)) a.chosen = tur.answers ?? null
    }
  }
}

const steers = intents.filter((i) => i.kind === 'steer')
const realIntents = intents.filter((i) => i.kind === 'intent')
const fanouts = [...spawnsByPrompt.entries()]
  .map(([pid, v]) => ({ pid, ...v, total: v.agents + v.workflows }))
  .filter((x) => x.total >= 2)
  .sort((a, b) => b.total - a.total)

// FeedbackTrajectory-SHAPED records (one per human turn) — the imitation corpus root nodes.
const trajectory = intents.map((i) => ({
  id: i.uuid,
  createdAt: i.ts,
  task: { intent: i.text },
  labels: [{ source: 'user', kind: i.kind, value: i.text }],
  tags: { promptId: i.promptId, fanout: spawnsByPrompt.get(i.promptId) ?? null },
  attempts: [], // increment 2: join the assistant actions + subagent subtrees here
  outcome: null, // increment 2: label success (verifiable reward / later approval)
}))

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(`${OUT_DIR}/trajectory.jsonl`, `${trajectory.map((t) => JSON.stringify(t)).join('\n')}\n`)

const top = (m, n) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join('  ')

console.log(`\n=== DRIVING-POLICY EXTRACT (${TRANSCRIPT.split('/').pop()}) ===`)
console.log(`human turns: ${intents.length}  (intents ${realIntents.length} · steers ${steers.length})`)
console.log(`assistant turns: ${assistantTurns}   tool calls: ${top(toolCounts, 12)}`)
console.log(`explicit forks (AskUserQuestion): ${asks.length}   parallel fan-out turns (>=2 spawns): ${fanouts.length}`)

console.log(`\n--- the explicit decisions you made at forks (your steering policy, labeled) ---`)
for (const a of asks.slice(0, 30)) {
  for (const q of a.questions) {
    const chosenLabel = a.chosen ? Object.values(a.chosen).map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' / ') : '(unmatched)'
    console.log(`  [${q.header ?? '?'}] ${String(q.q).slice(0, 80)}`)
    console.log(`      options: ${q.options.join(' | ')}`)
    console.log(`      CHOSE:   ${chosenLabel}`)
  }
}

console.log(`\n--- your recurring short steers (the corrections you repeat) ---`)
const steerCounts = new Map()
for (const s of steers) bump(steerCounts, s.text.toLowerCase().slice(0, 40))
for (const [phrase, n] of [...steerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${n}x  ${phrase}`)
}

console.log(`\n--- biggest parallel fan-outs (one intent → N concurrent agents/workflows) ---`)
for (const f of fanouts.slice(0, 8)) console.log(`  ${f.total} spawns (agents ${f.agents}, workflows ${f.workflows})  promptId ${String(f.pid).slice(0, 12)}`)

console.log(`\nwrote ${trajectory.length} FeedbackTrajectory-shaped records → ${OUT_DIR}/trajectory.jsonl`)
console.log(`(increment 2: join subagent/workflow subtrees + outcome labels + agent-eval FeedbackTrajectory/summarizePreferenceMemory)`)
