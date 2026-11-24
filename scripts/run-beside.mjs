#!/usr/bin/env node
// Run a long, mostly waiting lane beside a main command: `node scripts/run-beside.mjs '<lane>' <main...>`.
// The lane's lines are prefixed with `[lane]`. When either side fails, the other is stopped and its
// status is the result; otherwise the result waits for both. release:check uses it so the
// full-window placement proofs (minutes of real outage time, little CPU) overlap the rest of the
// suite instead of setting its length.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const [lane, ...main] = process.argv.slice(2)
if (!lane || main.length === 0) {
  console.error("usage: node scripts/run-beside.mjs '<lane command>' <main command...>")
  process.exit(2)
}

const start = (command, args, prefix) => {
  const child = spawn(command, args, {
    detached: true,
    shell: args.length === 0,
    stdio: prefix ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (prefix)
    for (const stream of [child.stdout, child.stderr])
      createInterface({ input: stream }).on('line', (line) => console.log(`${prefix} ${line}`))
  const done = new Promise((settle) =>
    child.on('close', (code, signal) => settle(code ?? (signal ? 128 : 1))),
  )
  return { child, done }
}
const stop = ({ child }) => {
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {}
}

const sides = { lane: start(lane, [], '[lane]'), main: start(main[0], main.slice(1)) }
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stop(sides.lane)
    stop(sides.main)
    process.exit(130)
  })

const first = await Promise.race(
  Object.entries(sides).map(([name, side]) => side.done.then((code) => ({ name, code }))),
)
const other = first.name === 'lane' ? 'main' : 'lane'
if (first.code !== 0) {
  console.error(`run-beside: ${first.name} exited ${first.code}; stopping ${other}`)
  stop(sides[other])
  await sides[other].done
  process.exit(first.code)
}
const code = await sides[other].done
if (code !== 0) console.error(`run-beside: ${other} exited ${code}`)
process.exit(code)
