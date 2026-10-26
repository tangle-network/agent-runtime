import { type ChildProcess, spawn } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
} from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { FileSpawnJournal, loadSpawnForest, type SpawnEvent } from '../../../src/runtime'
import { writeAtomicDurableFile } from '../../../src/runtime/supervise/durable-file'
import {
  type Configuration,
  durableBytes,
  object,
  readRecords,
  record,
  type Scenario,
  type ServiceState,
  sha256Bytes,
} from './uncertain-create-protocol'

export const rootId = 'uncertain-create-proof'
export interface Executables {
  service: string
  coordinator: string
  credential: string
}
export class ProcessFixture {
  readonly children: Array<{ process: ChildProcess; closed: Promise<void> }> = []
  coordinator: ChildProcess | undefined
  url = ''
  private constructor(
    readonly directory: string,
    readonly scenario: Scenario,
    readonly executables: Executables,
  ) {}
  static async start(scenario: Scenario, executables: Executables): Promise<ProcessFixture> {
    const directory = await mkdtemp(join(tmpdir(), 'uncertain-create-integration-'))
    const fixture = new ProcessFixture(directory, scenario, executables)
    try {
      mkdirSync(join(directory, 'home'))
      fixture.credentialMode(
        scenario === 'unsupported-intent',
        scenario === 'unsupported-environment' ? 1 : undefined,
      )
      fixture.launch(executables.service, [directory, scenario], 'service')
      await fixture.wait('service ready', async () =>
        existsSync(join(directory, 'service-ready.json')),
      )
      fixture.url = String(
        object(JSON.parse(readFileSync(join(directory, 'service-ready.json'), 'utf8'))).url,
      )
      await fixture.resume()
      return fixture
    } catch (error) {
      const failures: unknown[] = [error]
      try {
        await fixture.captureCheckedFrontier('setup-failed-before-cleanup')
      } catch (error) {
        failures.push(error)
      }
      try {
        await fixture.close()
      } catch (error) {
        failures.push(error)
      }
      try {
        await exportProof(fixture, 'setup-failed')
      } catch (error) {
        failures.push(error)
      }
      console.error(`Uncertain-create setup artifacts retained: ${directory}`)
      if (failures.length === 1) throw failures[0]
      throw new AggregateError(failures, `setup and cleanup failures; retained ${directory}`)
    }
  }
  private launch(script: string, args: string[], name: string): ChildProcess {
    // No account homes, auth, proxies or model keys cross the process boundary.
    const processHandle = spawn(process.execPath, [script, ...args], {
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: join(this.directory, 'home'),
        TMPDIR: tmpdir(),
        LANG: 'C.UTF-8',
        NODE_ENV: 'test',
        FORCE_COLOR: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    record(join(this.directory, 'process-lifecycle.jsonl'), {
      kind: 'process-start',
      at: new Date().toISOString(),
      name,
      pid: processHandle.pid,
      parentPid: process.pid,
      script,
    })
    processHandle.stdout!.on('data', (data) =>
      appendFileSync(join(this.directory, `${name}.stdout`), data),
    )
    processHandle.stderr!.on('data', (data) =>
      appendFileSync(join(this.directory, `${name}.stderr`), data),
    )
    const closed = new Promise<void>((resolve, reject) => {
      processHandle.once('error', reject)
      processHandle.once('close', (code, signal) => {
        try {
          record(join(this.directory, 'process-lifecycle.jsonl'), {
            kind: 'process-exit',
            at: new Date().toISOString(),
            name,
            pid: processHandle.pid,
            code,
            signal,
          })
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    })
    void closed.catch(() => undefined)
    this.children.push({ process: processHandle, closed })
    return processHandle
  }
  async resume(): Promise<void> {
    if (
      this.coordinator &&
      this.coordinator.exitCode === null &&
      this.coordinator.signalCode === null
    )
      throw new Error('a coordinator is already live')
    const config: Configuration = {
      directory: this.directory,
      scenario: this.scenario,
      url: this.url,
      resolver: this.executables.credential,
    }
    const configPath = join(this.directory, 'coordinator-config.json')
    writeAtomicDurableFile(configPath, JSON.stringify(config))
    this.coordinator = this.launch(
      this.executables.coordinator,
      [configPath],
      `coordinator-${this.children.length}`,
    )
    const pid = this.coordinator.pid
    await this.wait('coordinator route ready', async () =>
      readRecords(join(this.directory, 'coordinator.jsonl')).some(
        (row) => row.kind === 'coordinator-route-ready' && row.pid === pid,
      ),
    )
  }
  async killCoordinator(): Promise<void> {
    const child = this.children.find((row) => row.process === this.coordinator)
    if (!child) throw new Error('no coordinator')
    if (child.process.exitCode === null && child.process.signalCode === null)
      child.process.kill('SIGKILL')
    await child.closed
  }
  credentialMode(refuse: boolean, refuseAfter?: number): void {
    writeAtomicDurableFile(
      join(this.directory, 'credential-mode.json'),
      JSON.stringify({ refuse, refuseAfter }),
    )
  }
  async state(): Promise<ServiceState> {
    const response = await fetch(`${this.url}/fixture/state`, { signal: AbortSignal.timeout(2000) })
    if (!response.ok) throw new Error(`fixture state returned ${response.status}`)
    return (await response.json()) as ServiceState
  }
  async control(value: object): Promise<void> {
    const response = await fetch(`${this.url}/fixture/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
      signal: AbortSignal.timeout(2000),
    })
    if (!response.ok) throw new Error(`fixture control returned ${response.status}`)
  }
  async events(): Promise<SpawnEvent[]> {
    const journal = new FileSpawnJournal(join(this.directory, 'run', 'spawn-journal.jsonl'))
    if ((await journal.loadTree(rootId)) === undefined) return []
    const forest = await loadSpawnForest(journal, rootId)
    return forest.events
      .map((row) => row.event)
      .filter(
        (event) => event.kind !== 'spawned' || event.parent !== undefined || event.id === rootId,
      )
  }
  attempts() {
    return readRecords(join(this.directory, 'attempts.jsonl'))
  }
  outcomes() {
    return readRecords(join(this.directory, 'outcome.jsonl'))
  }
  async wait(label: string, predicate: () => Promise<boolean>, limitMs = 20000): Promise<void> {
    const deadline = Date.now() + limitMs
    while (Date.now() < deadline) {
      if (await predicate()) return
      if (
        this.coordinator &&
        (this.coordinator.exitCode !== null || this.coordinator.signalCode !== null)
      ) {
        throw new Error(
          `${label}: coordinator ended early; retained ${this.directory}; outcomes=${JSON.stringify(this.outcomes())}`,
        )
      }
      await delay(20)
    }
    throw new Error(`${label} did not happen within ${limitMs}ms; retained ${this.directory}`)
  }
  async captureCheckedFrontier(phase = 'assertions-checked-before-cleanup'): Promise<void> {
    const failures: unknown[] = []
    const hashes: Record<string, string> = {}
    const missing: string[] = []
    for (const [name, source] of [
      ['spawn-journal', join(this.directory, 'run', 'spawn-journal.jsonl')],
      ['service-ledger', join(this.directory, 'service-ledger.jsonl')],
    ] as const) {
      try {
        const bytes = await readFile(source)
        durableBytes(join(this.directory, `checked-${name}.jsonl`), bytes)
        hashes[name] = sha256Bytes(bytes)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') missing.push(name)
        else failures.push(error)
      }
    }
    record(join(this.directory, 'proof-phases.jsonl'), {
      kind: phase,
      at: new Date().toISOString(),
      coordinatorPid: this.coordinator?.pid,
      hashes,
      missing,
    })
    if (failures.length) throw new AggregateError(failures, 'pre-cleanup evidence capture failed')
  }
  async close(): Promise<void> {
    const failures: unknown[] = []
    // Stop the coordinator before its independent service; on failure SIGKILL still joins both.
    for (const child of [...this.children].reverse()) {
      try {
        if (child.process.exitCode === null && child.process.signalCode === null) {
          child.process.kill('SIGTERM')
          await Promise.race([child.closed, delay(2000)])
          if (child.process.exitCode === null && child.process.signalCode === null)
            child.process.kill('SIGKILL')
        }
        await child.closed
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) throw new AggregateError(failures, 'fixture process cleanup failed')
  }
}
export async function withFixture(
  scenario: Scenario,
  executables: Executables,
  body: (fixture: ProcessFixture) => Promise<void>,
): Promise<void> {
  const fixture = await ProcessFixture.start(scenario, executables)
  const failures: unknown[] = []
  try {
    await body(fixture)
    const state = await fixture.state()
    if (state.failures.length)
      throw new Error(`fixture protocol failed: ${JSON.stringify(state.failures)}`)
  } catch (error) {
    failures.push(error)
  } finally {
    try {
      await fixture.captureCheckedFrontier(
        failures.length ? 'body-failed-before-cleanup' : 'assertions-checked-before-cleanup',
      )
    } catch (error) {
      failures.push(error)
    }
    try {
      await fixture.close()
    } catch (error) {
      failures.push(error)
    }
    try {
      await exportProof(fixture, failures.length === 0 ? 'passed' : 'failed')
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) {
    console.error(`Uncertain-create proof artifacts retained: ${fixture.directory}`)
    if (failures.length === 1) throw failures[0]
    throw new AggregateError(failures, `proof and cleanup failures; retained ${fixture.directory}`)
  }
  await rm(fixture.directory, { recursive: true, force: true })
}

async function exportProof(fixture: ProcessFixture, outcome: string): Promise<void> {
  const configured = process.env.RUNTIME_CREATE_PROOF_DIR
  if (!configured) return
  if (!isAbsolute(configured)) throw new Error('RUNTIME_CREATE_PROOF_DIR must be absolute')
  const destination = join(
    resolve(configured),
    `${fixture.scenario}-${basename(fixture.directory)}`,
  )
  if (!relative(fixture.directory, destination).startsWith('..'))
    throw new Error('proof export must be outside the fixture directory')
  await mkdir(resolve(configured), { recursive: true })
  await cp(fixture.directory, destination, { recursive: true, errorOnExist: true, force: false })
  const files: Array<{ path: string; bytes: number; sha256: string }> = []
  async function inventory(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await inventory(path)
      else if (entry.isFile()) {
        const bytes = await readFile(path)
        const descriptor = openSync(path, 'r')
        try {
          fsyncSync(descriptor)
        } finally {
          closeSync(descriptor)
        }
        files.push({
          path: relative(destination, path),
          bytes: bytes.length,
          sha256: sha256Bytes(bytes),
        })
      } else throw new Error(`unexpected non-file in private proof: ${path}`)
    }
  }
  await inventory(destination)
  durableBytes(
    join(destination, 'proof-manifest.json'),
    `${JSON.stringify(
      {
        outcome,
        scenario: fixture.scenario,
        capturedAt: new Date().toISOString(),
        sourceDirectory: fixture.directory,
        files,
      },
      null,
      2,
    )}\n`,
  )
  console.info(`Uncertain-create ${outcome} proof exported: ${destination}`)
}
