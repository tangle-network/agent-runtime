/**
 *
 * MCP for the `pi` harness — the mount `piExecutor` performs before it spawns pi.
 *
 * pi ships NO MCP support of its own. MCP arrives through the `pi-mcp-adapter` extension, and the
 * adapter takes its config from a path the CALLER names: it registers a `--mcp-config <path>` flag
 * (`pi-mcp-adapter` `index.ts:252`, read back at `init.ts:101` and off raw argv at `utils.ts:55`).
 * So "give pi an MCP server" means: write the canonical `{ mcpServers: … }` object to a path this
 * run owns, pass that path with `--mcp-config`, make sure the adapter is loaded, and delete the
 * file afterwards. This module does exactly that and nothing else.
 *
 * Three rules carry the whole design:
 *
 * 1. **Fail loud, never fail safe.** If the profile declares MCP servers and `pi-mcp-adapter` is not
 *    installed, `preparePiMcp` throws BEFORE any file is written and before pi is spawned. A run
 *    whose tools never existed must fail, not score zero for the wrong reason.
 * 2. **`--no-extensions` is a trap.** When `extensions.pi.load` is an array, pi runs
 *    `--no-extensions`, which suppresses ALL auto-discovery — cwd `.pi/extensions`, global
 *    `~/.pi/agent/extensions`, AND the `settings.json` `packages` list that would otherwise have
 *    auto-loaded the adapter. So `load: ['pi-memory']` alongside `mcp` kills MCP dead even though
 *    the adapter IS installed. When MCP is declared, this module adds `pi-mcp-adapter` to the
 *    resolved load list and REPORTS that it did (`PiMcpReceipt.adapterInjected`). The caller's
 *    profile object is never mutated.
 * 3. **One config file per worker EXECUTION, never one per workspace.** `PiSeam.cwd` comes from the
 *    `ExecutorConfig` and is therefore shared by every worker the factory builds, so a config
 *    discovered by cwd is a file two concurrent siblings fight over. `mountPiMcpConfig` instead
 *    creates a fresh `mkdtemp` directory — OS-guaranteed unique, so no counter, lock, merge or
 *    restore is needed — and hands its path to `--mcp-config`. Concurrent workers built from ONE
 *    seam get ONE config each and never collide.
 *
 * Why the flag is safe to emit here even though pi only lists it under `Extension CLI Flags`: it is
 * emitted ONLY when the profile declares at least one usable MCP server, and that case has already
 * passed the `piMcpAdapterAvailable()` gate above, so the extension that registers the flag is
 * guaranteed loadable (auto-discovered, or force-loaded by the `--extension` this module appends).
 * A machine without the adapter never reaches the flag — it fails at the gate with an install
 * command instead.
 *
 * Where the run's servers sit in pi's config layering, stated plainly because it is a real
 * behavioral edge: `--mcp-config` REPLACES pi's user-global override file (`config.ts:310`,
 * `getPiGlobalConfigPath(overridePath)`), so the operator's own `~/.pi/agent/mcp.json` servers no
 * longer leak into a worker — good. It does NOT suppress project discovery: the adapter still
 * layers `<cwd>/.mcp.json` and `<cwd>/.pi/mcp.json` on top (`config.ts:352-373`), and those are
 * later sources, so a workspace that ships a server under the SAME NAME overrides this run's entry.
 * The consequence is worth naming: an A/B whose arms differ only in `profile.mcp` is confounded
 * when the shared workspace carries its own MCP config. Deleting a file the run did not create
 * would be worse — a run cannot quietly edit the repo it was pointed at.
 *
 * Upstream note: `@tangle-network/agent-profile-materialize` is the shared owner of profile → harness
 * mapping and already declares `pi` a first-class `HarnessId`, but as of 0.9.4 its pi arm answers
 * `unsupported('mcp', 'pi MCP requires a loaded MCP extension; the base Pi runtime has no MCP
 * control')` and its pi extensions arm answers `unsupported('extensions', …)`. That refusal is now
 * factually stale — the shape is exactly its `kimi-code` arm's (write a config file, push a config
 * flag, because the harness has no cwd discovery worth trusting). Teaching the materializer these
 * two rows is the durable home for this mapping; until it lands, this module is the only thing in
 * the `backend: 'pi'` path that can honor `profile.mcp` at all.
 *
 * Verified against pi 0.83.0 and pi-mcp-adapter 2.15.0.
 *
 * @experimental
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, sep } from 'node:path'
import type {
  AgentProfile,
  AgentProfileConfigValue,
  AgentProfileMcpServer,
} from '@tangle-network/agent-interface'
import { ConfigError, ValidationError } from '../../errors'

/** The pi extension that gives pi MCP at all. Everything here is gated on it being loadable. */
export const PI_MCP_ADAPTER = 'pi-mcp-adapter'

/** Overrides adapter detection for installs whose path does not carry the adapter's name. */
export const PI_MCP_ADAPTER_ENV = 'AGENT_RUNTIME_PI_MCP_ADAPTER'

/** The adapter-registered flag that names this run's config file (`pi-mcp-adapter` `index.ts:252`). */
export const PI_MCP_CONFIG_FLAG = '--mcp-config'

/** What the caller must call once pi has exited, and where the config landed. */
export interface PiMcpMount {
  /** Absolute path of the file passed to `--mcp-config`. Unique to this worker execution. */
  configPath: string
  /** Server names actually written, post-filter — never the raw `profile.mcp` keys. */
  serverNames: string[]
  /** Remove the private config directory. Idempotent; safe to call on any exit path. */
  cleanup(): void
}

/**
 * What pi was actually given, as opposed to what the profile declared. This is the observable that
 * makes rule 2 above honest: `adapterInjected` is `true` exactly when this module added an extension
 * the caller did not ask for, because without it the MCP servers the caller DID ask for could not
 * have mounted.
 */
export interface PiMcpReceipt {
  /** Server names written into `configPath`, in declaration order. */
  servers: string[]
  /** Absolute path of the mounted config. */
  configPath: string
  /** `extensions.pi.load` entries as pi received them, resolved to absolute entry files. */
  extensions: string[]
  /** True when `pi-mcp-adapter` was absent from an explicit `load` array and was added here. */
  adapterInjected: boolean
}

/** Everything `piExecutor` needs between "profile in hand" and "pi spawned". */
export interface PiMcpPreparation {
  /** Extra argv for `pi`, in flag order: extension flags first, then `--mcp-config <path>`. */
  args: string[]
  /** Present only when at least one usable MCP server was declared. */
  mount: PiMcpMount | null
  /** Present only when a mount happened — the derived-versus-declared record. */
  receipt: PiMcpReceipt | undefined
}

/** pi's agent home. Holds `settings.json` and `npm/node_modules/<extension>`. */
export function piAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
}

/** `<agentDir>/npm`, whose `node_modules/<pkg>` holds installed pi extensions. */
export function piNpmRoot(): string {
  return join(piAgentDir(), 'npm')
}

/**
 * True when pi can actually consume MCP config — i.e. `pi-mcp-adapter` is installed. Ported from
 * cli-bridge `pi.ts:189`: an env override first (for vendored installs whose path does not carry the
 * adapter's name), then the npm install directory, then a scan of `settings.json` `packages` in
 * which a local-path entry is resolved by reading the target's `package.json` `name`. An
 * unreadable or absent `settings.json` reports "not detected"; it never throws and never assumes.
 */
export function piMcpAdapterAvailable(): boolean {
  const override = process.env[PI_MCP_ADAPTER_ENV]
  if (override === '1' || override === 'true') return true
  if (override === '0' || override === 'false') return false
  const agentDir = piAgentDir()
  if (existsSync(join(agentDir, 'npm', 'node_modules', PI_MCP_ADAPTER))) return true
  try {
    const settings = JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf-8')) as {
      packages?: unknown
    }
    if (!Array.isArray(settings.packages)) return false
    return settings.packages.some((entry) => packageEntryIsAdapter(entry, agentDir))
  } catch {
    // unreadable/absent settings — fall through to "not detected"
    return false
  }
}

/** One `settings.json` `packages[]` entry: a name containing the adapter, or a local path to it. */
function packageEntryIsAdapter(entry: unknown, agentDir: string): boolean {
  if (typeof entry !== 'string') return false
  if (entry.includes(PI_MCP_ADAPTER)) return true
  // Local-path installs (`/some/dir`, `./rel`, `file:…`, `path:…`) may not carry the adapter's name
  // in the path. Relative specs resolve against the agent dir (where settings.json lives), never the
  // host process cwd.
  const spec = entry.replace(/^(file|path):(\/\/)?/, '')
  const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(spec)
  if (!isAbsolute(spec) && !windowsAbsolute && !spec.startsWith('.')) return false
  const localPath = isAbsolute(spec) || windowsAbsolute ? spec : join(agentDir, spec)
  return readPackageName(localPath) === PI_MCP_ADAPTER
}

function readPackageName(packageDir: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8')) as {
      name?: unknown
    }
    return typeof manifest.name === 'string' ? manifest.name : undefined
  } catch {
    return undefined
  }
}

/**
 * Read one `AgentProfileConfigValue` as public bytes. A `secret-ref` is REFUSED rather than
 * stringified: this executor has no secret provider, so the only alternatives are writing a
 * placeholder into the config (an auth failure disguised as a tool bug) or writing the literal
 * reference object (nonsense to the adapter). Plain strings, numbers and booleans are accepted
 * because profiles authored as JSON commonly carry them where the type says `{kind:'public'}`.
 */
function publicConfigString(
  value: AgentProfileConfigValue | string | number | boolean,
  where: string,
): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value && typeof value === 'object' && value.kind === 'public') return value.value
  if (value && typeof value === 'object' && value.kind === 'secret-ref') {
    throw new ConfigError(
      `piExecutor: ${where} is a secret-ref ("${value.key}") and piExecutor has no secret provider; ` +
        'resolve it before handing the profile to the executor, or declare a public value',
    )
  }
  throw new ValidationError(`piExecutor: ${where} is not a public configuration value`)
}

/**
 * Build the canonical `{ mcpServers }` body the adapter reads, from `AgentProfile.mcp`.
 *
 * Every server is written with `directTools: true` (`pi-mcp-adapter` types.ts:351), which
 * registers its tools as NATIVE pi tools instead of hiding them behind the generic `mcp` tool.
 * Without it an agent must discover its own verbs before it can use them — connect to the server,
 * then describe each tool — and a measured run spent 58 turns and 639,632 input tokens doing that
 * before it could delegate once. A profile that declares an MCP server is asking for its tools,
 * not for a directory it has to browse.
 *
 * This is cli-bridge's `buildCanonicalMcpServers`
 * (`/home/drew/code/cli-bridge/src/backends/profile-support.ts:253`) reproduced field for field and
 * in the same key order — same drop of `enabled:false`, same stdio-versus-remote decision
 * (`isStdioMcpSpec`, `profile-support.ts:177`), same `{command, args, env}` and `{type, url,
 * headers}` bodies, same silent drop of an entry with nothing to connect to. For any server both
 * input types can express, the emitted JSON is byte-identical.
 *
 * The two input types are not the same type, so three differences remain and each is a field one
 * side cannot express:
 *
 * 1. **`cwd` (emitted here, absent there).** `AgentProfileLocalMcpServer` has `cwd`; cli-bridge's
 *    `McpServerSpec` (`src/backends/types.ts:53`) has no such field, so it can never emit one. The
 *    adapter honors it (`pi-mcp-adapter` `types.ts:325`, `ServerEntry.cwd`), so dropping it would
 *    silently discard a declared setting. It is emitted where cli-bridge emits `timeout`.
 * 2. **`timeout` (emitted there, absent here).** `AgentProfileMcpServer` has no timeout field, so
 *    there is nothing to emit. (The adapter's own knob is `requestTimeoutMs`, not `timeout`.)
 * 3. **A `url` with no declared transport.** cli-bridge DROPS it — its remote branch requires an
 *    explicit `spec.type` — even though its own `McpServerSpec` docstring says "http is implied if
 *    `url` is set" (`types.ts:53-56`). `transport` is optional on `AgentProfileRemoteMcpServer`, so
 *    dropping such a server here would be exactly the silent-drop bug this module exists to fix.
 *    We honor the documented convention and emit `type: 'http'`.
 *
 * `sse` is ACCEPTED and forwarded verbatim, as cli-bridge forwards it. The adapter connects a URL
 * server by probing StreamableHTTP and falling back to `SSEClientTransport` when the probe fails
 * (`pi-mcp-adapter` `server-manager.ts:765`), so an SSE-only endpoint does connect. Its
 * `ServerEntry` (`types.ts:319`) carries no transport discriminator at all, which means the `type`
 * key is inert to the adapter either way — but it is what cli-bridge writes, and a config file that
 * round-trips the caller's declared transport is the one that stays readable by both.
 */
export function buildPiMcpServers(
  mcp: Record<string, AgentProfileMcpServer> | undefined,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  if (!mcp || typeof mcp !== 'object') return out
  for (const [name, raw] of Object.entries(mcp)) {
    if (!name || !raw || typeof raw !== 'object') continue
    if (raw.enabled === false) continue
    const transport = raw.transport
    const command = typeof raw.command === 'string' && raw.command.length > 0 ? raw.command : null
    const url = typeof raw.url === 'string' && raw.url.length > 0 ? raw.url : null
    // cli-bridge `isStdioMcpSpec`: an explicit stdio transport still needs a command; an explicit
    // remote transport is never stdio; with no transport declared, a command decides.
    const stdio = transport === 'http' || transport === 'sse' ? false : command !== null
    if (stdio && command !== null) {
      const args = Array.isArray(raw.args)
        ? raw.args.map((a, i) => publicConfigString(a, `mcp["${name}"].args[${i}]`))
        : []
      const env = readConfigRecord(raw.env, `mcp["${name}"].env`)
      out[name] = {
        command,
        ...(args.length > 0 ? { args } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
        ...(typeof raw.cwd === 'string' && raw.cwd.length > 0 ? { cwd: raw.cwd } : {}),
        directTools: true,
      }
      continue
    }
    if (url !== null && transport !== 'stdio') {
      const headers = readConfigRecord(raw.headers, `mcp["${name}"].headers`)
      out[name] = {
        type: transport === 'sse' ? 'sse' : 'http',
        url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        directTools: true,
      }
    }
    // No command and no url — nothing to connect to. Dropped, exactly as cli-bridge drops it.
  }
  return out
}

function readConfigRecord(
  record: Record<string, AgentProfileConfigValue> | undefined,
  where: string,
): Record<string, string> {
  if (!record || typeof record !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue
    out[key] = publicConfigString(value, `${where}["${key}"]`)
  }
  return out
}

/**
 * Resolve one `extensions.pi.load` entry to an absolute extension entry file. Ported from cli-bridge
 * `resolvePiExtensionEntry` (`pi.ts:123`): an absolute path is used verbatim; a bare package name
 * resolves to `<npmRoot>/node_modules/<pkg>/<package.json main>`, `main` defaulting to `index.ts`.
 * The resolution is required because pi's per-file loader does NOT resolve bare specifiers against
 * `~/.pi/agent/npm/node_modules`. Fail-closed: an unreadable manifest or a missing entry file
 * rejects the run rather than letting an ablation arm run without the extension it declared.
 */
export function resolvePiExtensionEntry(spec: string, npmRoot: string): string {
  let entry: string
  if (isAbsolute(spec)) {
    entry = spec
  } else {
    const packageDir = join(npmRoot, 'node_modules', spec)
    let main = 'index.ts'
    try {
      const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8')) as {
        main?: unknown
      }
      if (typeof manifest.main === 'string' && manifest.main) main = manifest.main
    } catch (err) {
      throw new ConfigError(
        `piExecutor: cannot load pi extension "${spec}": ${join(packageDir, 'package.json')} is ` +
          `not readable (install it with \`pi install npm:${spec}\`): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      )
    }
    entry = join(packageDir, main)
  }
  if (!existsSync(entry)) {
    throw new ConfigError(
      `piExecutor: cannot load pi extension "${spec}": resolved entry ${entry} does not exist`,
    )
  }
  return entry
}

/** Does this `load` entry name the MCP adapter, before resolution? */
function entryNamesAdapter(spec: string): boolean {
  if (!isAbsolute(spec)) return spec === PI_MCP_ADAPTER
  const normalized = spec.split(/[\\/]/)
  if (normalized.includes(PI_MCP_ADAPTER)) return true
  // An absolute path outside a `pi-mcp-adapter/` directory still counts when the package it belongs
  // to declares that name — a vendored checkout under any directory name.
  const parent = spec.slice(0, spec.lastIndexOf(sep) + 1)
  return parent.length > 0 && readPackageName(parent) === PI_MCP_ADAPTER
}

/** Outcome of lowering `extensions.pi.load` into argv. */
export interface PiExtensionArgs {
  args: string[]
  /** Resolved absolute entry files, in the order pi receives them. */
  entries: string[]
  adapterInjected: boolean
}

/**
 * Lower `AgentProfile.extensions.pi.load` into pi argv, honoring the `--no-extensions` trap.
 *
 * `load` absent (not an array) → no flags at all, so pi keeps its default discovery and the adapter
 * auto-loads from `settings.json` `packages`. `load` present → `--no-extensions` plus one
 * `--extension <absolute entry>` per listed extension, which is what makes an ablation arm
 * reproducible and leak-free.
 *
 * When `mcpRequested` is true and an explicit `load` array does not already name the adapter, the
 * adapter is APPENDED — otherwise `--no-extensions` would suppress the very extension that turns
 * the `--mcp-config` file into tools. The caller's profile is not touched; the addition is reported
 * through `adapterInjected` so it reaches the executor receipt and the live progress channel.
 *
 * A non-string or blank entry is a schema error here, not a silent skip: an ablation arm that
 * quietly drops a typo'd extension is the same class of structural false-null this module exists to
 * eliminate.
 */
export function derivePiExtensionArgs(
  profile: { extensions?: Record<string, Record<string, unknown> | undefined> } | undefined,
  mcpRequested: boolean,
): PiExtensionArgs {
  const load = profile?.extensions?.pi?.load
  if (!Array.isArray(load)) return { args: [], entries: [], adapterInjected: false }

  const declared: string[] = []
  for (const [index, entry] of load.entries()) {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new ValidationError(
        `piExecutor: extensions.pi.load[${index}] must be a non-empty string ` +
          `(got ${entry === null ? 'null' : typeof entry})`,
      )
    }
    declared.push(entry.trim())
  }

  const adapterInjected = mcpRequested && !declared.some(entryNamesAdapter)
  const resolvedSpecs = adapterInjected ? [...declared, PI_MCP_ADAPTER] : declared

  const npmRoot = piNpmRoot()
  const entries = resolvedSpecs.map((spec) => resolvePiExtensionEntry(spec, npmRoot))
  const args = ['--no-extensions']
  for (const entry of entries) args.push('--extension', entry)
  return { args, entries, adapterInjected }
}

/** Where one worker execution's private config directory is created, and what it is called. */
export interface PiMcpMountOptions {
  /**
   * The worker's own working directory (`PiSeam.cwd`). Omit when the seam names none: the config
   * then lands in the OS temp directory. It is NEVER written into `process.cwd()` — the operator's
   * own working directory is not a scratch space for a worker's config.
   */
  cwd?: string
  /**
   * The executor's per-execution run id, folded into the directory name so a directory that somehow
   * survives names the worker that left it. Uniqueness is NOT taken from this — `mkdtemp` provides
   * it — because two workers built from one factory in the same millisecond share a run id stem.
   */
  runId: string
}

/** Directory-name-safe form of a run id; the `mkdtemp` suffix supplies the uniqueness. */
function runIdSlug(runId: string): string {
  const slug = runId.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug.slice(0, 60) : 'worker'
}

/**
 * Write this worker execution's MCP config to a directory only it owns, and hand back the removal.
 *
 * Every property of the old cwd-discovered mount — a cross-process lock, a merge under whatever the
 * workspace already had, a verbatim byte restore, a symlink guard on `.pi` — existed because two
 * workers sharing a `PiSeam` shared one file path. `mkdtemp` deletes the shared path, and with it
 * the entire class of problem: the directory did not exist a moment ago, nothing else can name it,
 * `cleanup()` removes it whole, and two siblings started in the same millisecond get two configs.
 *
 * Returns `null` when there are no usable servers, so the no-MCP path writes nothing at all.
 */
export function mountPiMcpConfig(
  mcpServers: Record<string, Record<string, unknown>>,
  options: PiMcpMountOptions,
): PiMcpMount | null {
  const serverNames = Object.keys(mcpServers)
  if (serverNames.length === 0) return null

  const slug = runIdSlug(options.runId)
  // ALWAYS the OS temp directory, never the worker's workspace. The path is handed to pi by
  // `--mcp-config`, so it does not need to sit anywhere discoverable — and a scratch directory
  // inside the workspace is a file the worker did not create, in a tree it may commit, diff, or
  // clean. A dot prefix hides it from `ls`, not from `git status`.
  const base = tmpdir()
  const prefix = `agent-runtime-pi-mcp-${slug}-`

  let dir: string
  try {
    dir = mkdtempSync(join(base, prefix))
  } catch (err) {
    throw new ConfigError(
      `piExecutor: cannot create a private MCP config directory under ${base}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const configPath = join(dir, 'mcp.json')
  try {
    // `wx` because a fresh mkdtemp directory cannot already hold this file — if it does, something
    // is wrong enough that overwriting would hide it.
    writeFileSync(configPath, JSON.stringify({ mcpServers }, null, 2), { flag: 'wx', mode: 0o600 })
  } catch (err) {
    rmSync(dir, { recursive: true, force: true })
    throw new ConfigError(
      `piExecutor: failed to write the MCP config at ${configPath}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
  }

  let cleaned = false
  return {
    configPath,
    serverNames,
    cleanup: (): void => {
      if (cleaned) return
      cleaned = true
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * The one call `piExecutor` makes before spawning pi: decide what pi must be told, fail loud if it
 * cannot work, then mount.
 *
 * Order matters and is the point:
 *
 * 1. Canonicalize `profile.mcp` first, so the adapter gate keys off servers that would ACTUALLY be
 *    written — a block of `enabled:false` entries must not trip it.
 * 2. If any server survives and `pi-mcp-adapter` is not installed, throw. No file has been written
 *    and pi has not been spawned.
 * 3. Lower `extensions.pi.load` (which may itself throw on an unresolvable extension) — still before
 *    any file exists.
 * 4. Only then create this execution's private config directory and emit `--mcp-config`.
 *
 * A profile with no usable MCP server is a pure no-op: no adapter check, no directory, no flags, no
 * throw. `extensions.pi.load` on its own still produces flags, because reproducible ablation arms
 * need them whether or not MCP is involved.
 *
 * The caller MUST call `mount.cleanup()` on every exit path — settle, throw, abort, timeout, and
 * spawn failure — so the directory does not outlive the worker that owns it.
 */
export function preparePiMcp(
  profile: AgentProfile | undefined,
  options: PiMcpMountOptions,
): PiMcpPreparation {
  const mcpServers = buildPiMcpServers(profile?.mcp)
  const requested = Object.keys(mcpServers)

  if (requested.length > 0 && !piMcpAdapterAvailable()) {
    throw new ConfigError(
      `piExecutor: cannot mount MCP servers for pi (${requested.join(', ')}): the ` +
        `${PI_MCP_ADAPTER} extension is not installed. pi ships no MCP support of its own, so ` +
        'these servers would never connect and the worker would run tool-less. Looked in ' +
        `${join(piNpmRoot(), 'node_modules', PI_MCP_ADAPTER)} and in the \`packages\` list of ` +
        `${join(piAgentDir(), 'settings.json')}. Install it with ` +
        `\`pi install npm:${PI_MCP_ADAPTER}\`, or set ${PI_MCP_ADAPTER_ENV}=1 if it is vendored ` +
        'somewhere this check cannot see.',
    )
  }

  const extensions = derivePiExtensionArgs(profile, requested.length > 0)
  if (requested.length === 0) return { args: extensions.args, mount: null, receipt: undefined }

  const mount = mountPiMcpConfig(mcpServers, options)
  if (!mount) return { args: extensions.args, mount: null, receipt: undefined }
  return {
    args: [...extensions.args, PI_MCP_CONFIG_FLAG, mount.configPath],
    mount,
    receipt: {
      servers: mount.serverNames,
      configPath: mount.configPath,
      extensions: extensions.entries,
      adapterInjected: extensions.adapterInjected,
    },
  }
}
