/**
 * Live egress probe: the program that decides whether a network policy is ENFORCED.
 *
 * A read-back of the policy API proves only that the API remembered the request. This module
 * builds a shell program that is executed INSIDE the environment under test and reports what the
 * kernel and the proxy actually did to real packets.
 *
 * Two properties keep the probe honest:
 *
 * 1. A check whose tool is absent reports `tool-missing`, which is a FAILURE, never a pass. An
 *    image without `git` would otherwise make the clone check vacuous — the precise way a probe
 *    starts certifying environments it never tested.
 * 2. The blocked-host verdict is derived from the observed HTTP status, not from the exit code
 *    alone: a proxy that answers `403`/`407` denied the request, an unreachable network answers
 *    `000`, and anything 2xx/3xx means the packet left. All three are distinguished so a stale
 *    firewall chain (nothing reachable, for the wrong reason) cannot be mistaken for enforcement.
 *
 * The caller MUST also run the negative-control arm (`{ mode: 'open' }`), where the same program
 * has to report the graded clone as `reached`. Without it, a probe that fails for an unrelated
 * reason reads as a pass.
 */

/** One observation from inside the environment under test. */
export interface EgressProbeRecord {
  /** Stable check id (`clone`, `blocked:github.com`, `allowed:router.tangle.tools`, ...). */
  id: string
  /** What the check aimed at — a host or a repository URL. */
  target: string
  /** `reached` = packets left and something answered; `blocked` = they did not. */
  status: 'reached' | 'blocked' | 'tool-missing' | 'error'
  detail: string
}

/** What the probe must be able to reach, and what it must not. */
export interface EgressProbeTargets {
  /** Hosts the policy allows — the model endpoint. Each MUST report `reached`. */
  allowed: ReadonlyArray<string>
  /** Hosts the policy denies. Each MUST report `blocked`. */
  blocked: ReadonlyArray<string>
  /**
   * The repository whose contents would invalidate the run if the agent could read them (the
   * benchmark's own upstream). Cloning it is the actual leak, not a stand-in for it.
   */
  graded?: string
  /** Per-request ceiling. A short timeout keeps a black-holed route from stalling the probe. */
  timeoutSeconds?: number
  /**
   * Permit a probe with nothing that must stay reachable. Only a `blocked` policy qualifies: it
   * denies the model endpoint too, so it has no reachability signal of its own and must be
   * calibrated by the control arm alone. Every other policy keeps the guard, because a probe that
   * cannot reach anything is indistinguishable from a probe on a dead network.
   */
  allowNoReachableHost?: boolean
}

/** Marker every probe record line starts with, so probe output survives interleaved log noise. */
export const EGRESS_PROBE_MARKER = 'EGRESS-PROBE'

const DEFAULT_BLOCKED_HOSTS = [
  'github.com',
  'codeload.github.com',
  'raw.githubusercontent.com',
  'pypi.org',
  'registry.npmjs.org',
  'api.anthropic.com',
] as const

/** Blocked hosts every probe checks, on top of whatever the caller adds. */
export function defaultBlockedHosts(): string[] {
  return [...DEFAULT_BLOCKED_HOSTS]
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * Emit the probe program. POSIX sh, no dependencies beyond what the checks themselves test for.
 *
 * The generated program always exits 0: a non-zero exit would be indistinguishable from the
 * sandbox refusing to run it at all, and the verdict lives in the parsed records.
 */
export function buildEgressProbeScript(targets: EgressProbeTargets): string {
  const timeout = Math.max(1, Math.trunc(targets.timeoutSeconds ?? 10))
  const blocked = [...new Set([...targets.blocked, ...DEFAULT_BLOCKED_HOSTS])]
  if (targets.allowed.length === 0 && !targets.allowNoReachableHost) {
    // A probe with nothing to reach cannot tell enforcement apart from a dead network.
    throw new Error('egress probe requires at least one allowed host to prove reachability')
  }

  const lines: string[] = [
    'set -u',
    `M=${shellQuote(EGRESS_PROBE_MARKER)}`,
    `T=${timeout}`,
    `say() { printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$M" "$1" "$2" "$3" "$4"; }`,
    'have() { command -v "$1" >/dev/null 2>&1; }',
    // A single place that turns an HTTP status into a verdict, so allowed and blocked hosts are
    // judged by the same evidence.
    'probe_http() {',
    '  h="$1"',
    '  code=$(curl -sS -o /dev/null -m "$T" -w "%{http_code}" "https://$h/" 2>/dev/null)',
    '  rc=$?',
    '  [ -z "$code" ] && code=000',
    '  case "$code" in',
    '    000) echo "blocked\tunreachable (curl rc=$rc)" ;;',
    '    403|407) echo "blocked\tproxy denied (http=$code)" ;;',
    '    *) echo "reached\thttp=$code" ;;',
    '  esac',
    '}',
    '',
  ]

  if (targets.graded) {
    const graded = shellQuote(targets.graded)
    lines.push(
      'if have git; then',
      `  rm -rf /tmp/egress-probe-clone >/dev/null 2>&1`,
      `  git clone --depth 1 -q ${graded} /tmp/egress-probe-clone >/dev/null 2>&1`,
      '  rc=$?',
      '  if [ "$rc" -eq 0 ]; then',
      `    say clone ${graded} reached "clone succeeded — graded material is readable"`,
      '  else',
      `    say clone ${graded} blocked "git clone exit $rc"`,
      '  fi',
      'else',
      `  say clone ${graded} tool-missing "git absent — clone check could not run"`,
      'fi',
      '',
    )
  }

  lines.push(
    'if have curl; then',
    ...blocked.flatMap((host) => {
      const quoted = shellQuote(host)
      return [
        `  r=$(probe_http ${quoted})`,
        `  say blocked:${host} ${quoted} "\${r%%	*}" "\${r#*	}"`,
      ]
    }),
    ...targets.allowed.flatMap((host) => {
      const quoted = shellQuote(host)
      return [
        `  r=$(probe_http ${quoted})`,
        `  say allowed:${host} ${quoted} "\${r%%	*}" "\${r#*	}"`,
      ]
    }),
    'else',
    ...blocked.map(
      (host) => `  say blocked:${host} ${shellQuote(host)} tool-missing "curl absent"`,
    ),
    ...targets.allowed.map(
      (host) => `  say allowed:${host} ${shellQuote(host)} tool-missing "curl absent"`,
    ),
    'fi',
    '',
  )

  // Bypass battery. An env-var proxy is advisory; these are the ways an agent's own shell ignores
  // it. Each must still be blocked, which is only true when the kernel — not the client — decides.
  const bypassHost = blocked[0] ?? 'github.com'
  const bypassQuoted = shellQuote(bypassHost)
  lines.push(
    'if have curl; then',
    `  code=$(curl -sS -o /dev/null -m "$T" --noproxy '*' -w "%{http_code}" "https://${bypassHost}/" 2>/dev/null)`,
    '  [ -z "$code" ] && code=000',
    '  if [ "$code" = "000" ] || [ "$code" = "403" ] || [ "$code" = "407" ]; then',
    `    say bypass:noproxy ${bypassQuoted} blocked "curl --noproxy http=$code"`,
    '  else',
    `    say bypass:noproxy ${bypassQuoted} reached "curl --noproxy http=$code"`,
    '  fi',
    `  code=$(env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy curl -sS -o /dev/null -m "$T" -w "%{http_code}" "https://${bypassHost}/" 2>/dev/null)`,
    '  [ -z "$code" ] && code=000',
    '  if [ "$code" = "000" ] || [ "$code" = "403" ] || [ "$code" = "407" ]; then',
    `    say bypass:unset-proxy ${bypassQuoted} blocked "proxy env unset http=$code"`,
    '  else',
    `    say bypass:unset-proxy ${bypassQuoted} reached "proxy env unset http=$code"`,
    '  fi',
    'else',
    `  say bypass:noproxy ${bypassQuoted} tool-missing "curl absent"`,
    `  say bypass:unset-proxy ${bypassQuoted} tool-missing "curl absent"`,
    'fi',
    '',
    // A raw socket carries no proxy awareness at all. If this reaches anything, nothing above it
    // is enforcement.
    'if have bash; then',
    `  out=$(bash -c 'exec 3<>/dev/tcp/1.1.1.1/443' 2>&1)`,
    '  rc=$?',
    '  if [ "$rc" -eq 0 ]; then',
    '    say bypass:raw-tcp 1.1.1.1:443 reached "raw socket connected"',
    '  else',
    '    say bypass:raw-tcp 1.1.1.1:443 blocked "$(printf %s "$out" | tail -n 1)"',
    '  fi',
    'else',
    '  say bypass:raw-tcp 1.1.1.1:443 tool-missing "bash absent — raw socket check could not run"',
    'fi',
    '',
    // DNS is the first hop an exfiltration attempt takes; when the enforcer owns resolution a
    // blocked name does not resolve at all.
    'if have getent; then',
    `  if getent hosts ${bypassQuoted} >/dev/null 2>&1; then`,
    `    say dns:${bypassHost} ${bypassQuoted} reached "name resolved"`,
    '  else',
    `    say dns:${bypassHost} ${bypassQuoted} blocked "name did not resolve"`,
    '  fi',
    'else',
    `  say dns:${bypassHost} ${bypassQuoted} tool-missing "getent absent"`,
    'fi',
    'exit 0',
  )

  return lines.join('\n')
}

/** Parse probe records out of raw stdout, ignoring anything that is not a probe line. */
export function parseEgressProbeOutput(stdout: string): EgressProbeRecord[] {
  const records: EgressProbeRecord[] = []
  for (const line of stdout.split('\n')) {
    if (!line.startsWith(`${EGRESS_PROBE_MARKER}\t`)) continue
    const [, id, target, status, ...rest] = line.split('\t')
    if (!id || !target || !status) continue
    records.push({
      id,
      target,
      status: isProbeStatus(status) ? status : 'error',
      detail: rest.join('\t'),
    })
  }
  return records
}

function isProbeStatus(value: string): value is EgressProbeRecord['status'] {
  return value === 'reached' || value === 'blocked' || value === 'tool-missing' || value === 'error'
}

/** What the records mean, given which arm produced them. */
export interface EgressProbeVerdict {
  enforced: boolean
  /** Human-readable reasons the probe failed; empty when `enforced` is true. */
  failures: string[]
  records: EgressProbeRecord[]
}

/**
 * Grade probe records for an ENFORCED arm: every `allowed:` host reached, everything else blocked.
 *
 * An empty record set is a failure. Silence means the probe never ran, which is the state a
 * config read-back cannot tell apart from success.
 */
export function gradeEnforcedArm(
  records: ReadonlyArray<EgressProbeRecord>,
  options: { requireAllowed?: boolean } = {},
): EgressProbeVerdict {
  // `blocked` policies have nothing that must stay reachable, so they cannot use reachability as
  // the signal that the network is alive. Their calibration is the control arm alone.
  const requireAllowed = options.requireAllowed ?? true
  const failures: string[] = []
  if (records.length === 0) failures.push('probe produced no records — it never ran')
  let allowedSeen = 0
  for (const record of records) {
    // Name resolution is graded only when the enforcer owns it. A boundary that filters at
    // CONNECT time (the shipped proxy) legitimately lets a name resolve and then refuses the
    // tunnel, so a resolvable name is not by itself a leak. Reported, never gating.
    if (record.id.startsWith('dns:')) continue
    const isAllowed = record.id.startsWith('allowed:')
    if (isAllowed) allowedSeen += 1
    const want = isAllowed ? 'reached' : 'blocked'
    if (record.status !== want) {
      failures.push(`${record.id}: expected ${want}, observed ${record.status} (${record.detail})`)
    }
  }
  if (requireAllowed && allowedSeen === 0 && records.length > 0) {
    failures.push('no allowed-host check ran — cannot distinguish enforcement from a dead network')
  }
  return { enforced: failures.length === 0, failures, records: [...records] }
}

/**
 * Grade probe records for the NEGATIVE CONTROL arm (`{ mode: 'open' }`): the graded clone MUST
 * succeed. This is what proves the enforced arm's failure was caused by the policy rather than by
 * a missing tool, a dead image, or a stale firewall chain left behind by some other sandbox.
 */
export function gradeControlArm(records: ReadonlyArray<EgressProbeRecord>): EgressProbeVerdict {
  const failures: string[] = []
  const clone = records.find((record) => record.id === 'clone')
  if (!clone) {
    failures.push('negative control ran no clone check — the probe is not calibrated')
  } else if (clone.status !== 'reached') {
    failures.push(
      `negative control could not reach ${clone.target} (${clone.status}: ${clone.detail}) — ` +
        'the enforced arm proves nothing until this passes',
    )
  }
  return { enforced: failures.length === 0, failures, records: [...records] }
}
