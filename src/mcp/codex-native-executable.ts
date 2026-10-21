import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { access, open, readFile, realpath } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path'

export async function resolveCodexNativeExecutable(
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const candidates =
    command.includes(sep) || isAbsolute(command)
      ? [resolve(command)]
      : (env.PATH ?? '')
          .split(delimiter)
          .filter(Boolean)
          .map((entry) => join(entry, command))
  const seen = new Set<string>()
  for (const candidate of candidates) {
    let resolved: string
    try {
      await access(candidate, constants.X_OK)
      resolved = await realpath(candidate)
    } catch {
      continue
    }
    if (seen.has(resolved)) continue
    seen.add(resolved)
    if (await isVendoredCodexExecutable(resolved)) return resolved
    const packageRoot = await findCodexPackageRoot(resolved)
    if (!packageRoot) continue
    const bundled = await findBundledCodexExecutable(packageRoot)
    if (bundled) return bundled
  }
  throw new Error(
    'runLocalHarness: could not resolve the native Codex executable from the requested command',
  )
}

async function findCodexPackageRoot(file: string): Promise<string | undefined> {
  let cursor = dirname(file)
  while (true) {
    try {
      const parsed = JSON.parse(await readFile(join(cursor, 'package.json'), 'utf8')) as {
        name?: unknown
      }
      if (parsed.name === '@openai/codex') return cursor
    } catch {
      // Keep walking; PATH wrappers commonly live outside the package directory.
    }
    const parent = dirname(cursor)
    if (parent === cursor) return undefined
    cursor = parent
  }
}

async function findBundledCodexExecutable(packageRoot: string): Promise<string | undefined> {
  const target = codexTarget()
  const candidates = [
    join(
      packageRoot,
      'node_modules',
      '@openai',
      target.packageName,
      'vendor',
      target.triple,
      'bin',
      'codex',
    ),
    join(packageRoot, 'vendor', target.triple, 'bin', 'codex'),
  ]
  for (const executable of candidates) {
    if (await isVendoredCodexExecutable(executable)) return executable
  }
  return undefined
}

/**
 * The vendored Codex build for this host.
 *
 * `@openai/codex` ships a per-platform binary for linux, darwin and win32 on x64 and arm64.
 * Reproducible mode needs the vendored native executable rather than a PATH wrapper, so the
 * table maps host to package name plus Rust target triple. Linux vendors static musl builds;
 * darwin vendors Mach-O against the system libc, which is why the executable check below is
 * per-format rather than ELF-only.
 */
function codexTarget(): { packageName: string; triple: string } {
  const targets: Record<string, { packageName: string; triple: string }> = {
    'linux-x64': { packageName: 'codex-linux-x64', triple: 'x86_64-unknown-linux-musl' },
    'linux-arm64': { packageName: 'codex-linux-arm64', triple: 'aarch64-unknown-linux-musl' },
    'darwin-x64': { packageName: 'codex-darwin-x64', triple: 'x86_64-apple-darwin' },
    'darwin-arm64': { packageName: 'codex-darwin-arm64', triple: 'aarch64-apple-darwin' },
  }
  const target = targets[`${process.platform}-${process.arch}`]
  if (!target) {
    throw new Error(
      `runLocalHarness: reproducible Codex mode does not support ${process.platform}/${process.arch}`,
    )
  }
  return target
}

/** Hosts with a vendored Codex build reproducible mode can verify and run. */
export function isSupportedCodexPlatform(): boolean {
  return (
    (process.platform === 'linux' || process.platform === 'darwin') &&
    (process.arch === 'x64' || process.arch === 'arm64')
  )
}

/**
 * Is this the vendored native Codex build for this host?
 *
 * Reproducible mode must run the vendored binary, never a shell wrapper that could re-enter
 * a different toolchain, so the check reads the file's own header rather than trusting its
 * path. The two vendor formats differ: linux ships a STATIC musl ELF (an interpreter segment
 * would mean a dynamic build, which is rejected), darwin ships Mach-O linked against the
 * system libc, where dynamic linkage is normal and not a signal of the wrong artifact.
 */
export async function isVendoredCodexExecutable(path: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    await access(path, constants.X_OK)
    handle = await open(path, 'r')
    const header = Buffer.alloc(64)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (bytesRead !== header.length) return false
    if (process.platform === 'darwin') return isMachOExecutable(header)
    return await isStaticElf(header, handle)
  } catch {
    return false
  } finally {
    await handle?.close()
  }
}

/**
 * A 64-bit Mach-O executable for this architecture, or a universal binary containing one.
 *
 * Magics: 0xfeedfacf is a little-endian 64-bit Mach-O; 0xcafebabe/0xbebafeca is a fat header,
 * whose slices are checked by the loader at exec time rather than here.
 */
function isMachOExecutable(header: Buffer): boolean {
  const magic = header.readUInt32LE(0)
  const MH_MAGIC_64 = 0xfeedfacf
  const MH_CIGAM_64 = 0xcffaedfe
  const FAT_MAGIC = 0xbebafeca
  const FAT_CIGAM = 0xcafebabe
  if (magic === FAT_MAGIC || magic === FAT_CIGAM) return true
  if (magic !== MH_MAGIC_64 && magic !== MH_CIGAM_64) return false
  const cpuType = magic === MH_MAGIC_64 ? header.readUInt32LE(4) : header.readUInt32BE(4)
  const CPU_TYPE_X86_64 = 0x01000007
  const CPU_TYPE_ARM64 = 0x0100000c
  const expected = process.arch === 'x64' ? CPU_TYPE_X86_64 : CPU_TYPE_ARM64
  return cpuType === expected
}

/** A statically linked ELF for this architecture: no PT_INTERP segment (type 3). */
async function isStaticElf(
  header: Buffer,
  handle: Awaited<ReturnType<typeof open>>,
): Promise<boolean> {
  if (
    !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
    header[4] !== 2 ||
    header[5] !== 1
  ) {
    return false
  }
  const programHeaderOffset = Number(header.readBigUInt64LE(32))
  const programHeaderSize = header.readUInt16LE(54)
  const programHeaderCount = header.readUInt16LE(56)
  const expectedMachine = process.arch === 'x64' ? 62 : process.arch === 'arm64' ? 183 : -1
  if (
    ![2, 3].includes(header.readUInt16LE(16)) ||
    header.readUInt16LE(18) !== expectedMachine ||
    !Number.isSafeInteger(programHeaderOffset) ||
    programHeaderOffset < 64 ||
    programHeaderSize < 56 ||
    programHeaderSize > 1024 ||
    programHeaderCount === 0 ||
    programHeaderCount > 1024
  ) {
    return false
  }
  const tableSize = programHeaderSize * programHeaderCount
  const table = Buffer.alloc(tableSize)
  const tableRead = await handle.read(table, 0, tableSize, programHeaderOffset)
  if (tableRead.bytesRead !== tableSize) return false
  for (let index = 0; index < programHeaderCount; index += 1) {
    if (table.readUInt32LE(index * programHeaderSize) === 3) return false
  }
  return true
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolveDigest(hash.digest('hex')))
  })
}
