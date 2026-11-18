import { readFileSync } from 'node:fs'
import { Worker } from 'node:worker_threads'

export const MAX_EVENT_LOOP_GAP_MS = 100
const PERIOD_MS = 5
const stamp = () => Number(process.hrtime.bigint()) / 1e6

function runqueueWait(): bigint | undefined {
  if (process.platform !== 'linux') return undefined
  try {
    return BigInt(readFileSync('/proc/thread-self/schedstat', 'utf8').trim().split(/\s+/)[1]!)
  } catch {
    return undefined
  }
}

function mainBeat() {
  const before = runqueueWait()
  return { before, at: stamp(), after: runqueueWait() }
}

/** Compare main-loop progress with an independently scheduled thread, not process-wide CPU. */
export async function createEventLoopHeartbeat() {
  const worker = new Worker(
    `const { parentPort } = require('node:worker_threads');
     const stamp = () => Number(process.hrtime.bigint()) / 1e6;
     const beats = [stamp()];
     setInterval(() => beats.push(stamp()), ${PERIOD_MS});
     parentPort.on('message', ({ start, end }) => {
       beats.push(stamp());
       const first = beats.findLastIndex(at => at <= start);
       const last = beats.findIndex(at => at >= end);
       parentPort.postMessage(beats.slice(first, last + 1));
       beats.splice(0, last);
     });
     parentPort.postMessage('ready');`,
    { eval: true },
  )
  const receive = () =>
    new Promise<unknown>((resolve, reject) => {
      const cleanup = () => {
        worker.off('message', message).off('error', failed).off('exit', exited)
      }
      const message = (value: unknown) => {
        cleanup()
        resolve(value)
      }
      const failed = (error: Error) => {
        cleanup()
        reject(error)
      }
      const exited = (code: number) => failed(new Error(`heartbeat worker exited ${code}`))
      worker.once('message', message).once('error', failed).once('exit', exited)
    })
  if ((await receive()) !== 'ready') throw new Error('heartbeat worker did not become ready')
  let timer: ReturnType<typeof setInterval> | undefined
  let closed = false
  return {
    start() {
      if (closed || timer) throw new Error('heartbeat is closed or already measuring')
      const beats = [mainBeat()]
      timer = setInterval(() => beats.push(mainBeat()), PERIOD_MS)
      const measure = async () => {
        clearInterval(timer)
        timer = undefined
        beats.push(mainBeat())
        const reply = receive()
        worker.postMessage({ start: beats[0]!.at, end: beats.at(-1)!.at })
        const sentinel = (await reply) as number[]
        if (
          sentinel.length < 2 ||
          sentinel[0]! > beats[0]!.at ||
          sentinel.at(-1)! < beats.at(-1)!.at
        )
          throw new Error('sentinel does not cover the measured interval')
        const gaps = []
        let cursor = 0
        for (let index = 1; index < beats.length; index++) {
          const previous = beats[index - 1]!
          const current = beats[index]!
          const start = previous.at
          const end = current.at
          while (sentinel[cursor + 1]! <= start) cursor++
          let sentinelMs = 0
          for (let at = cursor; sentinel[at]! < end; at++)
            sentinelMs = Math.max(sentinelMs, sentinel[at + 1]! - sentinel[at]!)
          const mainMs = end - start
          // The counters bracket each timestamp. Only waiting between the earlier AFTER
          // and later BEFORE reads is certainly inside this gap; unavailable or inconsistent
          // counters deduct nothing. Runnable wait is not synchronous I/O or busy execution.
          const waitMs =
            previous.after !== undefined && current.before !== undefined
              ? Number(current.before - previous.after) / 1e6
              : 0
          const runqueueMs = waitMs >= 0 && waitMs <= mainMs ? waitMs : 0
          // At least two sentinel strides through a main gap distinguish continuous progress
          // from a shared pause; a stalled sentinel is never evidence against the main loop.
          gaps.push({
            mainMs,
            sentinelMs,
            runqueueMs,
            blockingMs: mainMs - runqueueMs,
            sentinelKeptBeating: sentinelMs < mainMs / 2,
          })
        }
        return {
          worstGapMs: Math.max(
            0,
            ...gaps.filter((gap) => gap.sentinelKeptBeating).map((gap) => gap.blockingMs),
          ),
          maxObservedGapMs: Math.max(...gaps.map((gap) => gap.mainMs)),
          gaps,
        }
      }
      let stopped: ReturnType<typeof measure> | undefined
      return () => (stopped ??= measure())
    },
    async close() {
      closed = true
      clearInterval(timer)
      await worker.terminate()
    },
  }
}
