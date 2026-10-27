import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, relative } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  createInPlaceCliExecutor,
  type ExecutorResult,
  type InPlaceHarnessResult,
} from '../../src/runtime'

export type ProcessMode = 'waiting' | 'cleanup-failure' | 'normal'
export type Observation<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; error: unknown }
export interface ProcessReady {
  leader: number
  child?: number
  inputPath: string
  inputBytes: string
}

export async function observe<T>(promise: Promise<T>): Promise<Observation<T>> {
  try {
    return { status: 'fulfilled', value: await promise }
  } catch (error) {
    return { status: 'rejected', error }
  }
}

export async function within<T>(promise: Promise<T>, milliseconds = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`process proof exceeded ${milliseconds}ms`)),
          milliseconds,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function exists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}

function processIdentity(pid: number) {
  if (process.platform !== 'linux') return { pid }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    return { pid, group: Number(fields[2]), startTicks: fields[19] }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { pid, absent: true }
    throw error
  }
}

export function physicalState(ready: ProcessReady) {
  return {
    leaderPresent: exists(ready.leader),
    childPresent: ready.child === undefined ? false : exists(ready.child),
    groupPresent: exists(-ready.leader),
    inputPresent: existsSync(ready.inputPath),
  }
}

function printable(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: value.cause,
      ...(value instanceof AggregateError ? { errors: value.errors } : {}),
      ...('code' in value ? { code: value.code } : {}),
    }
  }
  return value
}

// Only the executable process boundary is scripted. Runtime owns launch, process-group
// termination, materialization and cleanup; no runner, filesystem or timer is substituted.
const executable = `
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const mode = process.env.IN_PLACE_PROCESS_MODE;
const args = process.argv.slice(2);
const at = args.indexOf('--append-system-prompt-file');
if (at < 0) throw new Error('real CLI did not receive its materialized profile file');
const inputPath = path.resolve(args[at + 1]);
const inputBytes = fs.readFileSync(inputPath, 'utf8');
const log = phase => {
  const line = JSON.stringify({ phase, pid: process.pid, at: Date.now() }) + '\\n';
  fs.appendFileSync('process-events.jsonl', line);
  fs.appendFileSync('process-stdout.log', line);
  process.stdout.write(line);
};
fs.writeFileSync('authored.txt', 'caller-visible edit');
log('entered');
if (mode === 'cleanup-failure') {
  fs.unlinkSync(inputPath);
  fs.mkdirSync(inputPath);
  fs.writeFileSync(path.join(inputPath, 'keep'), 'real nonempty directory');
}
const ready = child => {
  fs.writeFileSync('ready.tmp', JSON.stringify({ leader: process.pid, child, inputPath, inputBytes }));
  fs.renameSync('ready.tmp', 'ready.json');
  log('ready');
};
if (mode === 'normal') {
  ready();
  log('normal-complete');
} else {
  let stopping = false;
  const childSource = \`
    const fs = require('node:fs');
    let stopping = false;
    const finish = () => {
      fs.writeFileSync('descendant-flushed', 'clean');
      process.exit(0);
    };
    process.on('SIGTERM', () => {
      if (stopping) return;
      stopping = true;
      setTimeout(finish, 40);
    });
    setTimeout(() => process.exit(91), 2000);
    process.send({ ready: true, pid: process.pid });
  \`;
  process.on('SIGTERM', () => { stopping = true; log('leader-term'); });
  const child = spawn(process.execPath, ['-e', childSource], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc']
  });
  child.on('error', error => { console.error(error); process.exit(92); });
  child.on('message', message => {
    if (message.ready !== true || message.pid !== child.pid) throw new Error('invalid child readiness');
    ready(child.pid);
  });
  child.on('exit', (code, signal) => {
    log('descendant-exit');
    process.exit(stopping && code === 0 && signal === null ? 0 : 93);
  });
}
`

export async function withInPlaceProcess(
  mode: ProcessMode,
  body: (fixture: ReturnType<typeof makeFixture>) => Promise<void>,
): Promise<void> {
  const fixture = makeFixture(mode)
  const errors: unknown[] = []
  try {
    await body(fixture)
  } catch (error) {
    errors.push(error)
  } finally {
    fixture.controller.abort(new Error('owned process fixture cleanup'))
    const cleanup = await observe(
      within(
        Promise.all([
          observe(Promise.resolve(fixture.activeExecutor?.teardown('infinity'))),
          fixture.running ?? Promise.resolve(undefined),
        ]),
      ),
    )
    if (cleanup.status === 'rejected') errors.push(cleanup.error)
    let state: ReturnType<typeof physicalState> | undefined
    try {
      if (fixture.readyValue) {
        const until = Date.now() + 2000
        do {
          state = physicalState(fixture.readyValue)
          if (
            !state.leaderPresent &&
            !state.childPresent &&
            !state.groupPresent &&
            (mode === 'cleanup-failure' || !state.inputPresent)
          )
            break
          await sleep(10)
        } while (Date.now() < until)
        if (
          state.leaderPresent ||
          state.childPresent ||
          state.groupPresent ||
          (mode !== 'cleanup-failure' && state.inputPresent)
        ) {
          errors.push(new Error('owned process/group/profile cleanup remains incomplete'))
        }
      }
    } catch (error) {
      errors.push(error)
    }
    try {
      fixture.record('final', { cleanup, state, errors })
    } catch (error) {
      errors.push(error)
    }
    if (errors.length === 0) {
      try {
        rmSync(fixture.directory, { recursive: true, force: true })
      } catch (error) {
        errors.push(error)
      }
    }
  }
  if (errors.length) {
    const retained = new Error(`in-place process proof retained ${fixture.directory}`)
    if (errors.length === 1)
      throw new AggregateError([errors[0], retained], 'in-place process proof failed')
    throw new AggregateError([...errors, retained], 'in-place process proof and cleanup failed')
  }
}

function makeFixture(mode: ProcessMode) {
  const directory = mkdtempSync(join(tmpdir(), 'in-place-process-join-'))
  const bin = join(directory, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'claude'), `#!${process.execPath}\n${executable}`, { mode: 0o755 })
  writeFileSync(join(directory, 'caller-owned.txt'), 'preserve caller bytes')
  const profile: AgentProfile = {
    name: 'real-process-cleanup',
    harness: 'claude-code',
    model: { provider: 'anthropic', default: 'offline-fixture-no-model' },
    prompt: { appendSystemPrompt: 'MATERIALIZED_PROCESS_INPUT' },
  }
  let executor: ReturnType<typeof createInPlaceCliExecutor> | undefined
  function constructExecutor(executionAttemptId?: string) {
    if (executor) throw new Error('fixture executor was already constructed')
    executor = createInPlaceCliExecutor({
      workspacePath: directory,
      profile,
      harnessTimeoutMs: 2000,
      env: { PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, IN_PLACE_PROCESS_MODE: mode },
      executionAttemptId,
    })
    return executor
  }
  const controller = new AbortController()
  const fixture = {
    directory,
    profile,
    get executor() {
      return executor ?? constructExecutor()
    },
    get activeExecutor() {
      return executor
    },
    constructExecutor,
    controller,
    readyValue: undefined as ProcessReady | undefined,
    running: undefined as Promise<Observation<ExecutorResult<InPlaceHarnessResult>>> | undefined,
    start(signal = controller.signal) {
      if (fixture.running) throw new Error('fixture owns exactly one executor invocation')
      const invocation = fixture.executor.execute(
        'no model: exercise owned process cleanup',
        signal,
      )
      if (!('then' in invocation)) throw new Error('public in-place executor unexpectedly streamed')
      fixture.running = observe(invocation)
      return fixture.running
    },
    async ready() {
      const until = Date.now() + 2000
      while (Date.now() < until) {
        if (existsSync(join(directory, 'ready.json'))) {
          const ready: ProcessReady = JSON.parse(
            readFileSync(join(directory, 'ready.json'), 'utf8'),
          )
          const input = relative(directory, ready.inputPath)
          if (
            !Number.isSafeInteger(ready.leader) ||
            ready.leader <= 0 ||
            (ready.child !== undefined &&
              (!Number.isSafeInteger(ready.child) || ready.child <= 0)) ||
            input.startsWith('..') ||
            input.length === 0
          )
            throw new Error('invalid process frontier')
          fixture.readyValue = ready
          const identities = [
            ready.leader,
            ...(ready.child === undefined ? [] : [ready.child]),
          ].map(processIdentity)
          if (
            process.platform === 'linux' &&
            mode !== 'normal' &&
            identities.some(
              (identity) =>
                !('group' in identity) || identity.group !== ready.leader || !identity.startTicks,
            )
          ) {
            throw new Error('actual descendant did not join the Runtime-owned process group')
          }
          fixture.record('ready', { ready, identities, state: physicalState(ready) })
          return ready
        }
        await sleep(10)
      }
      throw new Error('actual subprocess/descendant readiness missing within 2000ms')
    },
    record(phase: string, value: unknown) {
      const record = { phase, directory, at: Date.now(), value }
      writeFileSync(join(directory, `${phase}-proof.json`), JSON.stringify(record, printable, 2))
      process.stdout.write(`IN_PLACE_PROCESS_PROOF ${JSON.stringify(record, printable)}\n`)
    },
  }
  return fixture
}
