import type { ResultBlobStore } from '../../runtime/supervise/types'

// JSON escaping can expand each character sixfold; this page remains below a native tool frame.
export const WORKER_OUTPUT_PAGE_CHARS = 16_384

export function workerOutputReadOptions(raw: Record<string, unknown>): {
  offset: number
  limit: number
  path: readonly string[]
} {
  const offset = raw.outputOffset ?? 0
  const limit = raw.outputLimit ?? WORKER_OUTPUT_PAGE_CHARS
  const path = raw.outputPath === undefined ? [] : raw.outputPath
  if (!Array.isArray(path) || !path.every((part) => typeof part === 'string')) {
    throw new Error('observe_agent outputPath must be an array of field names')
  }
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('observe_agent outputOffset must be a nonnegative safe integer')
  }
  if (
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > WORKER_OUTPUT_PAGE_CHARS
  ) {
    throw new Error(
      `observe_agent outputLimit must be an integer from 1 to ${WORKER_OUTPUT_PAGE_CHARS}`,
    )
  }
  return { offset, limit, path }
}

/** Keep the durable artifact intact while bounding its agent-facing representation. */
export async function readWorkerOutput(
  blobs: ResultBlobStore,
  outRef: string | undefined,
  { offset, limit, path }: ReturnType<typeof workerOutputReadOptions>,
): Promise<Record<string, unknown>> {
  if (outRef === undefined) return { output: null }
  let output = await blobs.get(outRef)
  if (output === undefined) return { output: null, outputUnavailable: 'result-blob-missing' }
  for (const field of path) {
    if (output === null || typeof output !== 'object' || !Object.hasOwn(output, field)) {
      throw new Error('observe_agent outputPath does not identify a retained field')
    }
    output = (output as Record<string, unknown>)[field]
  }
  const text = JSON.stringify(output)
  if (text === undefined) throw new Error('observe_agent result blob is not JSON-serializable')
  if (offset > text.length)
    throw new Error('observe_agent outputOffset exceeds the retained output')
  if (offset === 0 && text.length <= limit) return { output }
  const end = Math.min(offset + limit, text.length)
  return {
    output: null,
    outputPage: {
      format: 'json',
      text: text.slice(offset, end),
      offset,
      nextOffset: end < text.length ? end : null,
      totalChars: text.length,
    },
  }
}
