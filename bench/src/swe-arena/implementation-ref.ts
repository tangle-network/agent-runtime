import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, readlink, realpath } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'

const sha256Content = (value: Uint8Array): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`

export async function fileTreeImplementationRef(root: string): Promise<string> {
  const canonicalRoot = await realpath(root)
  const files: Array<{ path: string; sha256?: string; symlink?: string }> = []

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      const relativePath = relative(canonicalRoot, path)
      if (entry.isDirectory()) {
        await walk(path)
      } else if (entry.isSymbolicLink()) {
        files.push({ path: relativePath, symlink: await readlink(path) })
      } else if (entry.isFile() || (await lstat(path)).isFile()) {
        files.push({ path: relativePath, sha256: sha256Content(await readFile(path)) })
      }
    }
  }

  await walk(canonicalRoot)
  return canonicalCandidateDigest(files)
}

export async function pythonDistributionImplementationRef(
  distribution: string,
  runPython: (script: string, args: string[]) => Promise<string>,
): Promise<string> {
  const output = await runPython(
    [
      'import hashlib, importlib, importlib.metadata, json, pathlib, sys',
      'name = sys.argv[1]',
      'module = importlib.import_module(name)',
      'root = pathlib.Path(module.__file__).resolve().parent',
      'files = []',
      'for path in sorted(p for p in root.rglob("*") if p.is_file()):',
      '    if "__pycache__" in path.parts or path.suffix == ".pyc":',
      '        continue',
      '    files.append({"path": str(path.relative_to(root)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})',
      'try:',
      '    version = importlib.metadata.version(name)',
      'except importlib.metadata.PackageNotFoundError:',
      '    version = None',
      'print(json.dumps({"distribution": name, "version": version, "python": sys.version, "files": files}, sort_keys=True))',
    ].join('\n'),
    [distribution],
  )
  const line = output.trim().split('\n').at(-1)
  if (line === undefined) {
    throw new Error(`python distribution ${distribution} returned no implementation manifest`)
  }
  const manifest = JSON.parse(line) as unknown
  return canonicalCandidateDigest(manifest)
}
