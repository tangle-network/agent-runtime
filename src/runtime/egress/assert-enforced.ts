/**
 * Prove — by execution, inside the box — that a declared network policy is actually enforced.
 *
 * The existing check on this path re-reads `sandbox.egress.get()` and compares it to what was
 * sent. That catches a boundary that forgot the policy; it cannot catch a boundary that records
 * the policy and enforces nothing, which is exactly what the sandbox's second network API does.
 * A read-back proves the API remembered you. Only a packet proves the kernel dropped it.
 *
 * So both run here: the read-back stays as the cheap check, and the probe is the one that decides.
 */

import { ValidationError } from '../../errors'

import type { AgentEgressPolicy, SandboxEgressPolicy } from './policy'
import { describeEgressPolicy, toSandboxEgressPolicy } from './policy'
import type { EgressProbeRecord, EgressProbeVerdict } from './probe'
import {
  buildEgressProbeScript,
  defaultBlockedHosts,
  gradeEnforcedArm,
  parseEgressProbeOutput,
} from './probe'

/** Runs a shell program inside the environment under test and returns everything it printed. */
export type EgressProbeRunner = (script: string) => Promise<{ stdout: string; exitCode: number }>

/** Reads back whatever policy the boundary believes it is applying. */
export type EgressPolicyReader = () => Promise<{
  mode: string
  allowDomains?: ReadonlyArray<string>
  includeImplicitDomains?: boolean
}>

export interface AssertEgressEnforcedOptions {
  /** The declaration this environment was created under. */
  policy: AgentEgressPolicy
  /** Hosts the policy keeps reachable so the agent can call its model. */
  modelHosts: ReadonlyArray<string>
  /** Executes the probe inside the environment. */
  run: EgressProbeRunner
  /** Optional cheap pre-check against the boundary's own view of the policy. */
  readPolicy?: EgressPolicyReader
  /**
   * The repository whose contents would invalidate this run. Cloning it is the leak itself, so it
   * is checked directly rather than through a stand-in host.
   */
  graded?: string
  /** Extra hosts that must be unreachable, on top of the built-in list. */
  blocked?: ReadonlyArray<string>
  /** Per-request ceiling inside the probe. */
  timeoutSeconds?: number
}

/**
 * Throw unless the environment demonstrably enforces `policy`.
 *
 * Refuses `{ mode: 'open' }`: there is no boundary to prove, and returning "enforced" for it would
 * make the function's own name a lie at the one call site where that matters most.
 */
export async function assertEgressEnforced(
  options: AssertEgressEnforcedOptions,
): Promise<EgressProbeVerdict> {
  if (options.policy.mode === 'open') {
    throw new ValidationError(
      'assertEgressEnforced was called on an open network policy; there is nothing to enforce',
    )
  }

  const expected = toSandboxEgressPolicy(options.policy, options.modelHosts)
  if (!expected) {
    throw new ValidationError(
      `network policy ${describeEgressPolicy(options.policy)} has no sandbox boundary form`,
    )
  }

  if (options.readPolicy) assertPolicyReadBack(await options.readPolicy(), expected)

  const blocked = [...(options.blocked ?? []), ...defaultBlockedHosts()].filter(
    (host) => !options.modelHosts.includes(host),
  )
  // Under `blocked` the model host is denied like everything else, so it moves from the
  // reachability list into the denial list rather than being dropped and left untested.
  const allowed = options.policy.mode === 'blocked' ? [] : [...options.modelHosts]
  const probeBlocked =
    options.policy.mode === 'blocked' ? [...blocked, ...options.modelHosts] : blocked

  const script = buildEgressProbeScript({
    allowed,
    blocked: probeBlocked,
    ...(options.policy.mode === 'blocked' ? { allowNoReachableHost: true } : {}),
    ...(options.graded ? { graded: options.graded } : {}),
    ...(options.timeoutSeconds === undefined ? {} : { timeoutSeconds: options.timeoutSeconds }),
  })

  const result = await options.run(script)
  const records = parseEgressProbeOutput(result.stdout)

  const verdict = gradeEnforcedArm(records, { requireAllowed: options.policy.mode !== 'blocked' })
  if (!verdict.enforced) {
    throw new ValidationError(
      `network policy ${describeEgressPolicy(options.policy)} is NOT enforced in this environment:\n` +
        verdict.failures.map((failure) => `  - ${failure}`).join('\n') +
        `\n${formatRecords(verdict.records)}`,
    )
  }
  return verdict
}

function assertPolicyReadBack(
  actual: Awaited<ReturnType<EgressPolicyReader>>,
  expected: SandboxEgressPolicy,
): void {
  if (actual.mode !== expected.mode) {
    throw new ValidationError(
      `sandbox egress mismatch: expected ${expected.mode}, boundary reports ${actual.mode}`,
    )
  }
  if (expected.mode === 'blocked') {
    if (actual.allowDomains && actual.allowDomains.length > 0) {
      throw new ValidationError('sandbox blocked egress retained an allowlist')
    }
    return
  }
  if (actual.includeImplicitDomains !== false) {
    // The implicit list carries github.com. A strict policy that kept it is not strict.
    throw new ValidationError('sandbox strict egress retained implicit domains')
  }
  const want = [...(expected.allowDomains ?? [])].sort()
  const got = [...(actual.allowDomains ?? [])].sort()
  if (want.length !== got.length || want.some((domain, index) => domain !== got[index])) {
    throw new ValidationError(
      `sandbox strict egress differs from the requested allowlist: expected [${want.join(', ')}], boundary reports [${got.join(', ')}]`,
    )
  }
}

function formatRecords(records: ReadonlyArray<EgressProbeRecord>): string {
  if (records.length === 0) return '  (probe returned no records)'
  return records.map((r) => `  ${r.id}\t${r.status}\t${r.detail}`).join('\n')
}

/** Minimal view of the sandbox process API the probe needs. */
export interface ProbeCapableSandbox {
  process: {
    spawnExact: (
      executable: string,
      args: string[],
      options?: Record<string, unknown>,
    ) => Promise<{
      stdout: () => AsyncIterable<string | Uint8Array>
      wait: () => Promise<number>
    }>
  }
}

/**
 * Adapt a sandbox into an `EgressProbeRunner`.
 *
 * The program is passed on argv rather than written to disk: a probe that has to create a file
 * first fails differently on a read-only rootfs than it does on an enforced network, and those
 * two failures must not be confusable.
 */
export function sandboxProbeRunner(sandbox: ProbeCapableSandbox): EgressProbeRunner {
  return async (script) => {
    const proc = await sandbox.process.spawnExact('/bin/sh', ['-c', script])
    let stdout = ''
    for await (const chunk of proc.stdout()) {
      stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    }
    return { stdout, exitCode: await proc.wait() }
  }
}
