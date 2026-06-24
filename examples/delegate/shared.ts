/**
 * Shared fixtures for the delegate example + its regression test: a path-confined `write_file`
 * tool, a disk-truth deliverable oracle, a fresh scratch target, and the worker backend that
 * grants the tool. One definition, used by both `delegate.ts` (live) and the test.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { DeliverableSpec, ExecutorConfig } from '@tangle-network/agent-runtime/loops'

/** A fresh, isolated scratch dir + the relative/absolute target path the worker writes. */
export function scratchTarget(): { workDir: string; target: string; targetAbs: string } {
  const workDir = mkdtempSync(join(tmpdir(), 'delegate-'))
  const target = 'out.txt'
  return { workDir, target, targetAbs: join(workDir, target) }
}

/** A real filesystem write, confined to `workDir` — never escapes the scratch dir. */
export async function writeFileTool(
  workDir: string,
  args: Record<string, unknown>,
): Promise<string> {
  const rel = String(args.path ?? '')
  const content = String(args.content ?? '')
  const abs = resolve(workDir, rel)
  if (!abs.startsWith(resolve(workDir))) return 'error: path escapes the working directory'
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
  return `wrote ${content.length} bytes to ${rel}`
}

/** The deployable completion oracle: settle ONLY when the file actually exists with the right
 *  content. Reads disk — ground truth — never the worker judging itself. */
export function fileDeliverable(targetAbs: string, target: string): DeliverableSpec {
  return {
    check: () => existsSync(targetAbs) && readFileSync(targetAbs, 'utf8').trim() === 'hello',
    describe: `file ${target} exists and contains "hello"`,
  }
}

/** The worker-execution backend: off-box router tool-using agents granted the one `write_file`
 *  tool, with the implementation hosted here (the backend host). The supervisor authors the worker
 *  profile and decides to call this tool. */
export function makeWriteFileBackend(args: {
  workDir: string
  routerBaseUrl: string
  routerKey: string
  model: string
}): ExecutorConfig {
  return {
    backend: 'router-tools',
    routerBaseUrl: args.routerBaseUrl,
    routerKey: args.routerKey,
    model: args.model,
    tools: [
      {
        type: 'function' as const,
        function: {
          name: 'write_file',
          description: 'Write text content to a file path (relative to the working directory).',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative file path, e.g. out.txt' },
              content: { type: 'string', description: 'The exact text to write' },
            },
            required: ['path', 'content'],
            additionalProperties: false,
          },
        },
      },
    ],
    executeToolCall: async (name, toolArgs) =>
      name === 'write_file' ? writeFileTool(args.workDir, toolArgs) : `unknown tool ${name}`,
    maxTurns: 8,
  }
}
