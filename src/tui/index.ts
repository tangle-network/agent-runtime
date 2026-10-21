/**
 * `@tangle-network/agent-runtime/tui` — the terminal view over live supervisor runs.
 *
 * A read-only renderer plus two write-back controls, over the same `<root>/.agent/supervisor/<id>`
 * layout `../runtime/supervise/run-layout` defines. It ships here rather than as its own package
 * because the runtime is what WRITES the state it renders: a separately-versioned viewer would
 * drift from the layout it reads, which is the exact failure a client and server versioning
 * independently produces.
 *
 * Zero third-party dependencies — raw ANSI and `node:readline` keypresses, nothing else.
 *
 * ```ts
 * import { loadTopSnapshot, renderTopFrame } from '@tangle-network/agent-runtime/tui'
 *
 * process.stdout.write(renderTopFrame(loadTopSnapshot(process.cwd()), { width: 132 }))
 * ```
 *
 * The runnable form is the `agent-runtime-top` bin: `agent-runtime-top <root> [--once] [--no-color]`.
 *
 * @module
 * @experimental
 */

// Braid imports the TUI entrypoint beside the kernel entrypoint. Re-export the Runtime provisioner
// here so that either public face resolves the same owner and no client invents a second wrapper.
export { provisionSupervisor } from '../runtime/supervise/provision-supervisor'
export {
  loadTopSnapshot,
  type SupervisorView,
  type TopSnapshot,
  type WorkerView,
} from './top-snapshot'
