import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createEventLoopHeartbeat } from '../../helpers/event-loop-heartbeat'

const mode = process.argv[2]
const durationMs = 150
let controller: ChildProcess | undefined
if (mode === 'stopped') {
  controller = spawn(
    process.execPath,
    [
      '--eval',
      `process.on('message', ({ pid }) => {
         process.kill(pid, 'SIGSTOP');
         setTimeout(() => {
           process.kill(pid, 'SIGCONT');
           process.send('resumed', () => process.disconnect());
         }, ${durationMs});
       });
       process.on('disconnect', () => process.exit(0));
       process.send('ready');`,
    ],
    { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
  )
  const [ready] = await once(controller, 'message')
  if (ready !== 'ready') throw new Error('stop controller did not become ready')
}
const heartbeat = await createEventLoopHeartbeat()
try {
  const stop = heartbeat.start()
  if (mode === 'busy') {
    const began = performance.now()
    while (performance.now() - began < durationMs) {}
  } else if (mode === 'sync-wait') {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs)
  } else if (mode === 'stopped') {
    const resumed = once(controller!, 'message')
    const exited = once(controller!, 'exit')
    controller!.send({ pid: process.pid })
    const [acknowledgement] = await resumed
    if (acknowledgement !== 'resumed') throw new Error('stop controller did not resume fixture')
    await exited
  } else throw new Error(`unknown heartbeat control ${mode}`)
  const measured = await stop()
  console.log(
    JSON.stringify({
      mode,
      ...measured,
      gaps: measured.gaps.filter((gap) => gap.mainMs >= durationMs / 2),
    }),
  )
} finally {
  await heartbeat.close()
  if (controller?.exitCode === null) controller.kill('SIGKILL')
}
