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

type EncodedWorkerOutput =
  | { readonly kind: 'missing' }
  | { readonly kind: 'page'; readonly text: string }
  | { readonly kind: 'small'; readonly output: unknown; readonly text: string }

interface WorkerOutputCacheEntry {
  readonly outRef: string
  readonly path: readonly string[]
  readonly result: Promise<EncodedWorkerOutput>
  activeReads: number
  releaseWhenIdle: boolean
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((field, index) => field === right[index])
}

function selectWorkerOutput(output: unknown, path: readonly string[]): unknown {
  let selected = output
  for (const field of path) {
    if (selected === null || typeof selected !== 'object' || !Object.hasOwn(selected, field)) {
      throw new Error('observe_agent outputPath does not identify a retained field')
    }
    selected = (selected as Record<string, unknown>)[field]
  }
  return selected
}

async function encodeWorkerOutput(
  blobs: Pick<ResultBlobStore, 'get'>,
  outRef: string,
  path: readonly string[],
): Promise<EncodedWorkerOutput> {
  const retained = await blobs.get(outRef)
  if (retained === undefined) return { kind: 'missing' }
  const output = selectWorkerOutput(retained, path)
  const text = JSON.stringify(output)
  if (text === undefined) throw new Error('observe_agent result blob is not JSON-serializable')
  // A paged result can never return its typed value: outputLimit is capped at this page size.
  // Drop the parsed selection after encoding so a large archive does not stay live beside its text.
  return text.length > WORKER_OUTPUT_PAGE_CHARS
    ? { kind: 'page', text }
    : { kind: 'small', output, text }
}

function readEncodedWorkerOutput(
  encoded: EncodedWorkerOutput,
  { offset, limit }: Pick<ReturnType<typeof workerOutputReadOptions>, 'offset' | 'limit'>,
): Record<string, unknown> {
  if (encoded.kind === 'missing') return { output: null, outputUnavailable: 'result-blob-missing' }
  const { text } = encoded
  if (offset > text.length)
    throw new Error('observe_agent outputOffset exceeds the retained output')
  if (encoded.kind === 'small' && offset === 0 && text.length <= limit) {
    return { output: encoded.output }
  }
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

export type WorkerOutputReader = (
  outRef: string | undefined,
  options: ReturnType<typeof workerOutputReadOptions>,
) => Promise<Record<string, unknown>>

/**
 * Create a manager-scoped reader for immutable retained artifacts.
 *
 * At most one selected `outRef` + path is retained. Concurrent reads for that selection share the
 * blob read and JSON encoding; missing blobs and rejected selections are evicted after all readers
 * leave so a transient failure cannot poison later observations.
 */
export function createWorkerOutputReader(blobs: Pick<ResultBlobStore, 'get'>): WorkerOutputReader {
  let cached: WorkerOutputCacheEntry | undefined

  return async (outRef, options) => {
    if (outRef === undefined) return { output: null }

    let entry = cached
    if (entry === undefined || entry.outRef !== outRef || !samePath(entry.path, options.path)) {
      const path = [...options.path]
      entry = {
        outRef,
        path,
        result: encodeWorkerOutput(blobs, outRef, path),
        activeReads: 0,
        releaseWhenIdle: false,
      }
      cached = entry
    }

    entry.activeReads += 1
    try {
      const encoded = await entry.result
      const reply = readEncodedWorkerOutput(encoded, options)
      if (encoded.kind === 'missing') {
        entry.releaseWhenIdle = true
      } else {
        const page = reply.outputPage as { readonly nextOffset?: number | null } | undefined
        if (page === undefined || page.nextOffset === null) entry.releaseWhenIdle = true
      }
      return reply
    } catch (error) {
      entry.releaseWhenIdle = true
      throw error
    } finally {
      entry.activeReads -= 1
      if (entry.releaseWhenIdle && entry.activeReads === 0 && cached === entry) cached = undefined
    }
  }
}
