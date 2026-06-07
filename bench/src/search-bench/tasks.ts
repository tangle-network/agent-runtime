/**
 * Fresh-docs coding tasks with DETERMINISTIC oracles — the substrate for
 * comparing web-search backends inside coding harnesses.
 *
 * Each task asks for code that hinges on a specific current API detail. The
 * oracle is a deterministic check on the agent's final answer (contains / omits
 * / regex) — no LLM judge, so a you.com-vs-native delta is defensible. A task
 * earns its place only if the detail is precise enough that a model guessing
 * from memory plausibly gets it wrong but a correct doc lookup gets it right.
 */

export interface TaskOracle {
  /** All of these (case-insensitive) must appear in the answer to pass. */
  containsAll?: string[]
  /** Passing answers must contain at least one of these (case-insensitive). */
  containsAny?: string[]
  /** None of these (e.g. hallucinated/deprecated APIs) may appear. */
  notContains?: string[]
  /** Every regex must match the answer. */
  regex?: string[]
}

export interface SearchTask {
  id: string
  domain: string
  /** The coding prompt sent to the agent. */
  prompt: string
  /** Why a correct answer depends on current documentation (provenance note). */
  needsFreshDocs: string
  oracle: TaskOracle
  /** Canonical query + expected authority for an optional retrieval-quality check. */
  searchQuery?: string
  expectedUrlIncludes?: string[]
  /** Primary-doc URL the correct answer was verified against (provenance). */
  sourceUrl?: string
  /** The verified correct answer (provenance — not shown to the agent). */
  correctAnswer?: string
}

const ANSWER_CONTRACT =
  'Answer with the exact code/identifiers requested. Cite the source URL(s) you used. Be precise — exact method, option, and import names matter.'

export function taskToPrompt(task: SearchTask): string {
  return `${task.prompt}\n\n${ANSWER_CONTRACT}`
}

/** Evaluate the deterministic oracle. Returns 1 (pass) or 0 (fail) + reasons. */
export function scoreTask(task: SearchTask, answer: string): { score: 0 | 1; reasons: string[] } {
  const hay = answer.toLowerCase()
  const reasons: string[] = []
  const o = task.oracle
  for (const s of o.containsAll ?? []) {
    if (!hay.includes(s.toLowerCase())) reasons.push(`missing required "${s}"`)
  }
  if (o.containsAny && !o.containsAny.some((s) => hay.includes(s.toLowerCase()))) {
    reasons.push(`missing any of [${o.containsAny.join(', ')}]`)
  }
  for (const s of o.notContains ?? []) {
    if (hay.includes(s.toLowerCase())) reasons.push(`contains forbidden "${s}"`)
  }
  for (const r of o.regex ?? []) {
    if (!new RegExp(r, 'i').test(answer)) reasons.push(`regex /${r}/ did not match`)
  }
  return { score: reasons.length === 0 ? 1 : 0, reasons }
}

/**
 * Seed tasks — stable, precisely-checkable current APIs. These prove the
 * pipeline; the discriminating fresh-docs set is generated + verified
 * separately (search-bench/generate). Answers verified against primary docs.
 */
export const seedTasks: SearchTask[] = [
  {
    id: 'cf-do-alarms',
    domain: 'cloudflare-workers',
    prompt:
      'In a Cloudflare Workers Durable Object, write the handler that runs when an alarm fires and the single line that schedules an alarm 60 seconds from now. Give the exact method names.',
    needsFreshDocs:
      'The DO alarm API (storage.setAlarm + the alarm() handler) is easy to misname (e.g. scheduleAlarm/onAlarm) without the current docs.',
    oracle: {
      containsAll: ['setAlarm', 'alarm('],
      notContains: ['scheduleAlarm', 'onAlarm'],
    },
    searchQuery: 'Cloudflare Workers Durable Objects alarms docs',
    expectedUrlIncludes: ['/durable-objects'],
  },
  {
    id: 'prisma-createmany-skipdup',
    domain: 'prisma',
    prompt:
      'Write a Prisma Client `createMany` call that inserts an array of users and silently skips rows that would violate a unique constraint. Give the exact option name.',
    needsFreshDocs:
      'The exact option is `skipDuplicates: true` — models often invent `ignoreDuplicates`/`onConflict`.',
    oracle: {
      containsAll: ['createmany', 'skipduplicates'],
      notContains: ['ignoreduplicates', 'onconflict'],
    },
    searchQuery: 'Prisma createMany skipDuplicates docs',
    expectedUrlIncludes: ['createmany', 'skipduplicates'],
  },
  {
    id: 'hono-middleware-header',
    domain: 'hono',
    prompt:
      'Using the Hono web framework (TypeScript), write a middleware that sets a custom response header and then continues to the next handler. Show the exact import and the call used to continue the chain.',
    needsFreshDocs:
      'Hono middleware uses `c.header(...)` + `await next()`; models confuse it with Express `res.set`/`next()`.',
    oracle: {
      containsAll: ['hono', 'c.header', 'next()'],
      notContains: ['res.set', 'res.setheader'],
    },
    searchQuery: 'Hono middleware TypeScript docs',
    expectedUrlIncludes: ['middleware'],
  },
  {
    id: 'vitest-vi-hoisted',
    domain: 'vitest',
    prompt:
      'In Vitest, you need a variable referenced inside a `vi.mock` factory to be initialized before the mock is hoisted. Show the exact API that makes a value run before hoisting, with a minimal example.',
    needsFreshDocs:
      'The exact API is `vi.hoisted(() => …)`; without docs models suggest top-level consts (which fail hoisting) or jest patterns.',
    oracle: {
      containsAll: ['vi.hoisted'],
      notContains: ['jest.mock'],
    },
    searchQuery: 'Vitest vi.hoisted docs',
    expectedUrlIncludes: ['vi.hoisted'],
  },
]
