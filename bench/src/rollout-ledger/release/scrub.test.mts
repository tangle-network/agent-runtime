import { describe, expect, it } from 'vitest'
import { fixtureRolloutLine } from '../fixtures.mts'
import { validateRolloutLine } from '../types.ts'
import { emptyScrubCounts, scrubLines, scrubRolloutLine, scrubText } from './scrub.mts'

function scrub(text: string): { text: string; counts: Record<string, number> } {
  const counts = emptyScrubCounts()
  return { text: scrubText(text, counts), counts }
}

describe('path scrubbing', () => {
  it('rewrites /home/<user> and /Users/<user> prefixes to $WORK', () => {
    const { text, counts } = scrub('read /home/drew/code/repo/a.py and /Users/alice/work/b.py')
    expect(text).toBe('read $WORK/code/repo/a.py and $WORK/work/b.py')
    expect(counts['home-path']).toBe(2)
  })

  it('rewrites dash-encoded harness-store home segments', () => {
    const { text, counts } = scrub('/tmp/claude-1000/-home-drew-code-supervisor-lab/session/x.jsonl')
    expect(text).toBe('/tmp/claude-1000/$WORK-code-supervisor-lab/session/x.jsonl')
    expect(counts['home-path-encoded']).toBe(1)
  })

  it('normalizes per-user pytest tmpdirs', () => {
    const { text, counts } = scrub("from '/tmp/pytest-of-drew/pytest-84/target/enums.py'")
    expect(text).toBe("from '/tmp/pytest-of-$USER/pytest-84/target/enums.py'")
    expect(counts['tmp-user-dir']).toBe(1)
  })

  it('normalizes ls -l owner/group columns', () => {
    const listing = 'drwxrwxr-x  4 drew drew     4096 Jul 22 12:39 .github\n-rw-rw-r--  1 drew staff     8998 Jul 22 12:39 LICENSE'
    const { text, counts } = scrub(listing)
    expect(text).toBe('drwxrwxr-x  4 user user     4096 Jul 22 12:39 .github\n-rw-rw-r--  1 user user     8998 Jul 22 12:39 LICENSE')
    expect(counts['ls-owner']).toBe(2)
  })
})

describe('secret scrubbing', () => {
  it('redacts env-var-shaped secrets keeping the name', () => {
    const { text, counts } = scrub('export HF_TOKEN=hf_abc123 DREW_GH_TOKEN="ghp_zzz" DB_PASSWORD=hunter2')
    expect(text).toBe('export HF_TOKEN=[REDACTED:env] DREW_GH_TOKEN=[REDACTED:env] DB_PASSWORD=[REDACTED:env]')
    expect(counts['env-secret']).toBe(3)
    expect(counts['api-key']).toBe(0)
  })

  it('redacts bearer tokens', () => {
    const { text, counts } = scrub('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig')
    expect(text).toBe('Authorization: Bearer [REDACTED:bearer]')
    expect(counts['bearer-token']).toBe(1)
  })

  it('redacts bare provider-prefixed keys', () => {
    const { text, counts } = scrub(
      'sk-proj-abcdefghij0123456789 then ghp_ABCDEFGHIJKLMNOP1234 then hf_ABCDEFGHIJKLMNOPQRST then AKIAIOSFODNN7EXAMPLE',
    )
    expect(text).toBe('[REDACTED:api-key] then [REDACTED:api-key] then [REDACTED:api-key] then [REDACTED:api-key]')
    expect(counts['api-key']).toBe(4)
  })

  it('leaves ordinary KEY=value config alone', () => {
    const { text, counts } = scrub('NODE_ENV=production PORT=3000 model=glm-5.2')
    expect(text).toBe('NODE_ENV=production PORT=3000 model=glm-5.2')
    expect(Object.values(counts).every((count) => count === 0)).toBe(true)
  })
})

describe('hostname scrubbing', () => {
  it('normalizes infra hostnames preserving the subdomain', () => {
    const { text, counts } = scrub('POST https://router.tangle.tools/v1 and rpc.tangle.network and bare tangle.tools')
    expect(text).toBe('POST https://router.internal.example/v1 and rpc.internal.example and bare internal.example')
    expect(counts['infra-host']).toBe(3)
  })

  it('normalizes known workstation hostnames but not the plain verb', () => {
    const { text, counts } = scrub('Message-ID: <123@drew-GTR-Pro> — the canvas drew first')
    expect(text).toBe('Message-ID: <123@workstation> — the canvas drew first')
    expect(counts['machine-host']).toBe(1)
  })

  it('does not touch unrelated hosts', () => {
    const { text } = scrub('https://huggingface.co/datasets and github.com/tangle-network/repo')
    expect(text).toBe('https://huggingface.co/datasets and github.com/tangle-network/repo')
  })
})

describe('determinism and idempotency', () => {
  const dirty = [
    '/home/drew/x with HF_TOKEN=hf_secret1234 calling Bearer abcdefgh12345678',
    'sk-abcdefghijklmnop1234 at router.tangle.tools via /Users/bob/y',
    '-rw-rw-r--  1 drew drew  842 Jul 22 12:39 /tmp/pytest-of-drew/conftest.py',
  ].join('\n')

  it('same input produces byte-identical output', () => {
    expect(scrub(dirty).text).toBe(scrub(dirty).text)
    expect(scrub(dirty).counts).toEqual(scrub(dirty).counts)
  })

  it('a second pass changes nothing and counts zero', () => {
    const first = scrub(dirty)
    const second = scrub(first.text)
    expect(second.text).toBe(first.text)
    expect(Object.values(second.counts).every((count) => count === 0)).toBe(true)
  })
})

describe('line scrubbing', () => {
  it('scrubs every string field and the result is still a valid line', () => {
    const line = fixtureRolloutLine({
      run_id: '/home/drew/runs/gen3#1',
      messages: [
        { role: 'system', content: 'cwd is /home/drew/code/supervisor-lab' },
        { role: 'user', content: 'use OPENAI_API_KEY=sk-abcdefghijklmnop1234 against router.tangle.tools' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"cmd":"ls /Users/drew/data"}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', name: 'bash', content: '/Users/drew/data/a.csv' },
      ],
      artifacts: {
        patch_path: '/home/drew/patches/fix.patch',
        run_dir: '/home/drew/runs/R4',
        transcript_ref: '/tmp/claude-1000/-home-drew-code-supervisor-lab/t.jsonl',
      },
    })
    const counts = emptyScrubCounts()
    const scrubbed = scrubRolloutLine(line, counts)

    expect(scrubbed.run_id).toBe('$WORK/runs/gen3#1')
    expect(scrubbed.messages[0].content).toBe('cwd is $WORK/code/supervisor-lab')
    expect(scrubbed.messages[1].content).toBe('use OPENAI_API_KEY=[REDACTED:env] against router.internal.example')
    expect(scrubbed.messages[2].tool_calls?.[0].function.arguments).toBe('{"cmd":"ls $WORK/data"}')
    expect(scrubbed.messages[3].content).toBe('$WORK/data/a.csv')
    expect(scrubbed.artifacts).toEqual({
      patch_path: '$WORK/patches/fix.patch',
      run_dir: '$WORK/runs/R4',
      transcript_ref: '/tmp/claude-1000/$WORK-code-supervisor-lab/t.jsonl',
    })
    expect(counts['home-path']).toBe(6)
    expect(counts['home-path-encoded']).toBe(1)
    expect(counts['env-secret']).toBe(1)
    expect(counts['infra-host']).toBe(1)

    // The scrubbed line must still validate (scrubbing never breaks structure).
    expect(validateRolloutLine(scrubbed)).toEqual([])
  })

  it('scrubLines reports totals across lines', () => {
    const a = fixtureRolloutLine({ run_id: '/home/drew/a' })
    const b = fixtureRolloutLine({ run_id: '/home/drew/b' })
    const { lines, counts } = scrubLines([a, b])
    expect(lines.map((line) => line.run_id)).toEqual(['$WORK/a', '$WORK/b'])
    expect(counts['home-path']).toBe(2)
  })
})
