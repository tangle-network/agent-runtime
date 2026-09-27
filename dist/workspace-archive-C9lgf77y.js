import { agentCandidateArtifactRefSchema, canonicalCandidateBytes as canonicalCandidateBytes$1 } from "@tangle-network/agent-interface";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, readlink, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAnyArrayBuffer, isSharedArrayBuffer } from "node:util/types";
import { extract, pack } from "tar-stream";
//#region src/candidate-execution/digest.ts
/** Use native hashing for workspace archives. */
function sha256Bytes$1(bytes) {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
function canonicalCandidateDigest$1(value) {
	return sha256Bytes$1(canonicalCandidateBytes$1(value));
}
/** Returns a detached, deeply frozen JSON value with canonical number normalization. */
function immutableCandidateValue(value) {
	return deepFreezeCandidate(JSON.parse(Buffer.from(canonicalCandidateBytes$1(value)).toString("utf8")));
}
function canonicalCandidateDocument(valueWithoutDigest) {
	const bytes = canonicalCandidateBytes$1(valueWithoutDigest);
	const digest = sha256Bytes$1(bytes);
	const value = deepFreezeCandidate({
		...JSON.parse(Buffer.from(bytes).toString("utf8")),
		digest
	});
	return Object.freeze({
		value,
		get bytes() {
			return Uint8Array.from(bytes);
		},
		digest
	});
}
function verifyCanonicalCandidateDocument(value, label) {
	if (canonicalCandidateDigest$1(omitTopLevelDigest(value)) !== value.digest) throw new Error(`${label} digest does not match`);
	return immutableCandidateValue(value);
}
function embeddedCandidateArtifact(bytes) {
	return {
		encoding: "base64",
		content: Buffer.from(bytes).toString("base64"),
		sha256: sha256Bytes$1(bytes),
		byteLength: bytes.byteLength
	};
}
function omitTopLevelDigest(value) {
	const { digest: _digest, ...rest } = value;
	return rest;
}
function deepFreezeCandidate(value, seen = /* @__PURE__ */ new Set()) {
	if (value === null || typeof value !== "object" || ArrayBuffer.isView(value) || seen.has(value)) return value;
	seen.add(value);
	for (const child of Object.values(value)) deepFreezeCandidate(child, seen);
	return Object.freeze(value);
}
//#endregion
//#region src/candidate-execution/artifacts.ts
function artifactCacheKey(artifact) {
	return `${artifact.sha256}:${artifact.byteLength}`;
}
async function readVerifiedArtifact(artifact, port) {
	const bytes = "content" in artifact ? Buffer.from(artifact.content, "base64") : await port.read(artifact);
	verifyBytes(bytes, artifact.sha256, artifact.byteLength, "candidate artifact");
	return Uint8Array.from(bytes);
}
function verifyBytes(bytes, digest, byteLength, label) {
	if (bytes.byteLength !== byteLength) throw new Error(`${label} byte length ${bytes.byteLength} does not match ${byteLength}`);
	const actual = sha256Bytes$1(bytes);
	if (actual !== digest) throw new Error(`${label} digest ${actual} does not match ${digest}`);
}
async function verifyWorkspaceSnapshotArtifacts(snapshot, port) {
	const [manifest, archive] = await Promise.all([readVerifiedArtifact(snapshot.manifest, port), readVerifiedArtifact(snapshot.archive, port)]);
	const canonicalManifest = canonicalCandidateBytes$1(snapshot.material);
	if (!Buffer.from(manifest).equals(Buffer.from(canonicalManifest))) throw new Error("workspace manifest artifact is not the exact canonical manifest material");
	if (sha256Bytes$1(canonicalManifest) !== snapshot.digest) throw new Error("workspace snapshot digest does not match its canonical manifest material");
	return {
		manifest,
		archive
	};
}
/**
* Refuse a materialized workspace whose files, modes, or bytes are not the signed manifest.
*
* The scan streams, so the size of the largest file does not decide whether the check can run, and
* the refusal names the one mismatch a caller can produce on its own: a capture and a verify that
* disagree about `portableTree`.
*/
async function verifyMaterializedWorkspace(root, expected, options = {}) {
	assertWorkspaceManifest(await scanMaterializedWorkspaceManifest(root, options), expected);
}
/**
* The canonical manifest of one materialized workspace, read without holding any file.
*
* Every file is digested by streaming, so the size of the largest file does not decide whether the
* workspace can be described. `FileHandle.readFile` refuses anything above 2 GiB with
* `ERR_FS_FILE_TOO_LARGE`, which made a workspace holding one such artifact impossible to verify
* against a manifest it already matched. The digest is sha-256 over the same bytes either way, so
* a manifest a buffered read produced is reproduced exactly.
*/
async function scanMaterializedWorkspaceManifest(root, options = {}) {
	return workspaceManifestFromEntries(await walkWorkspace(root, options, false));
}
async function captureMaterializedWorkspace(root, options = {}) {
	const entries = await walkWorkspace(root, options, true);
	return {
		manifest: workspaceManifestFromEntries(entries),
		files: entries.map((entry) => ({
			path: entry.path,
			mode: entry.mode,
			bytes: Uint8Array.from(capturedBytes(entry))
		}))
	};
}
/** Capture exact verified regular-file bytes for fresh isolated materialization. */
async function readMaterializedWorkspaceFiles(root, expected, options = {}) {
	const observed = await captureMaterializedWorkspace(root, options);
	assertWorkspaceManifest(observed.manifest, expected);
	return observed.files.map((file) => Object.freeze({
		path: file.path,
		mode: file.mode,
		bytes: Uint8Array.from(file.bytes)
	}));
}
/**
* Build the canonical manifest for files a caller already holds — the shape a remote executor
* returns. Pass `portableTree` to record Git's two file modes instead of exact permission bits, and
* pass the same flag to every verify that reads the result.
*/
function candidateWorkspaceManifest(files, options = {}) {
	return workspaceManifestFromEntries(files.map((file) => ({
		path: file.path,
		mode: options.portableTree === true ? portableFileMode(file.mode) : file.mode,
		sha256: sha256Bytes$1(file.bytes),
		byteLength: file.bytes.byteLength
	})));
}
function workspaceManifestFromEntries(entries) {
	return {
		kind: "agent-candidate-workspace-manifest",
		files: entries.map((entry) => ({
			path: entry.path,
			mode: entry.mode,
			sha256: entry.sha256,
			byteLength: entry.byteLength
		})).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
	};
}
/** Git records exactly two file modes, and a portable-tree scan records the same two. */
function portableFileMode(mode) {
	return (mode & 73) !== 0 ? 493 : 420;
}
function capturedBytes(entry) {
	if (!entry.bytes) throw new Error(`workspace file was digested without its bytes: ${entry.path}`);
	return entry.bytes;
}
function assertWorkspaceManifest(observed, expected) {
	if (Buffer.from(canonicalCandidateBytes$1(observed)).equals(canonicalCandidateBytes$1(expected))) return;
	if (Buffer.from(canonicalCandidateBytes$1(withPortableModes(observed))).equals(canonicalCandidateBytes$1(withPortableModes(expected)))) throw new Error("materialized workspace files do not match the signed manifest: only the file modes differ, so the capture and this verify disagree about portableTree");
	throw new Error("materialized workspace files, modes, or bytes do not match the signed manifest");
}
function withPortableModes(material) {
	return {
		...material,
		files: material.files.map((file) => ({
			...file,
			mode: portableFileMode(file.mode)
		}))
	};
}
async function verifyMaterializedProfileWorkspace(root, expected, fileRoot = "workspace") {
	const observedProfile = (await scanMaterializedWorkspaceManifest(root)).files.map(({ path, mode, sha256 }) => ({
		relPath: path,
		mode,
		contentSha256: sha256
	}));
	const expectedFiles = expected.files.filter((file) => (file.root ?? "workspace") === fileRoot).map(({ root: _root, ...file }) => file);
	if (!Buffer.from(canonicalCandidateBytes$1(observedProfile)).equals(canonicalCandidateBytes$1(expectedFiles))) throw new Error(`profile ${fileRoot} staging files, modes, or bytes do not match the signed profile plan`);
}
async function walkWorkspace(root, options, keepBytes) {
	const ignoredProtectedRootEntries = new Set(options.ignoredProtectedRootEntries ?? []);
	const limits = options.limits;
	const requestedRoot = resolve(root);
	const rootStats = await lstat(requestedRoot);
	if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error("workspace root must be a real directory");
	const absoluteRoot = await realpath(requestedRoot);
	const resolvedStats = await lstat(absoluteRoot);
	if (!resolvedStats.isDirectory() || resolvedStats.isSymbolicLink()) throw new Error("workspace root must resolve to a real directory");
	const scanned = [];
	let totalBytes = 0;
	async function visit(directory) {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
		for (const entry of entries) {
			if (directory === absoluteRoot && ignoredProtectedRootEntries.has(entry.name)) continue;
			const absolute = resolve(directory, entry.name);
			const relPath = relative(absoluteRoot, absolute).split(sep).join("/");
			if (!relPath || relPath.startsWith("../") || relPath.includes("/../")) throw new Error(`workspace entry escapes root: ${relPath}`);
			const stats = await lstat(absolute);
			if (stats.isSymbolicLink()) throw new Error(await symlinkRefusal(absolute, relPath, absoluteRoot));
			if (stats.isDirectory()) {
				await visit(absolute);
				continue;
			}
			if (!stats.isFile()) throw new Error(`workspace contains a non-regular entry: ${relPath}`);
			if (limits && scanned.length >= limits.maxFiles) throw new Error("workspace exceeds maxFiles");
			const descriptor = await open(absolute, constants.O_RDONLY | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0));
			try {
				const openedStats = await descriptor.stat();
				if (!openedStats.isFile()) throw new Error(`workspace contains a non-regular entry: ${relPath}`);
				if (openedStats.nlink !== 1) throw new Error(`workspace contains a hard-linked file: ${relPath}`);
				const mode = options.portableTree === true ? portableFileMode(openedStats.mode) : openedStats.mode & 511;
				if (limits && openedStats.size > limits.maxFileBytes) throw new Error(`workspace file exceeds maxFileBytes: ${relPath}`);
				const remainingBytes = limits ? limits.maxTotalFileBytes - totalBytes : void 0;
				if (remainingBytes !== void 0 && openedStats.size > remainingBytes) throw new Error("workspace exceeds maxTotalFileBytes");
				const read = await readWorkspaceFile(descriptor, limits ? Math.min(limits.maxFileBytes, remainingBytes ?? limits.maxFileBytes) : void 0, keepBytes, relPath);
				totalBytes += read.byteLength;
				scanned.push({
					path: relPath,
					mode,
					sha256: read.sha256,
					byteLength: read.byteLength,
					...read.bytes === void 0 ? {} : { bytes: read.bytes }
				});
			} finally {
				await descriptor.close();
			}
		}
	}
	await visit(absoluteRoot);
	return scanned;
}
/**
* Why one symbolic link is refused, in the terms that separate a portable link from a link that
* reaches outside the tree.
*
* Every link is refused, in both mode policies. `AgentCandidateWorkspaceManifestMaterial` has no
* representation for one — `mode`, `sha256` and `byteLength` describe a regular file — so a link
* recorded as a file would let two different trees share one digest. The reason says which kind of
* link it was, so a caller can tell a link it can rewrite from one it cannot.
*/
async function symlinkRefusal(absolute, relPath, absoluteRoot) {
	const target = await readlink(absolute);
	if (isAbsolute(target)) return `workspace contains an absolute symlink: ${relPath} -> ${target}`;
	if (!isWithin(absoluteRoot, resolve(dirname(absolute), target))) return `workspace contains a symlink that escapes its tree: ${relPath} -> ${target}`;
	let physical;
	try {
		physical = await realpath(absolute);
	} catch {
		return `workspace contains an unresolved symlink: ${relPath} -> ${target}`;
	}
	if (!isWithin(absoluteRoot, physical)) return `workspace contains a symlink that resolves outside its tree: ${relPath} -> ${target}`;
	return `workspace contains a symlink: ${relPath} -> ${target}`;
}
function isWithin(root, path) {
	return path === root || path.startsWith(`${root}${sep}`);
}
/**
* Read one open regular file into its digest, keeping the bytes only when the caller needs them.
*
* The content reaches the hash in 1 MiB chunks and is never held whole for a digest-only walk, so
* the size of the largest file does not decide whether a workspace can be described.
* `FileHandle.readFile` refuses anything above 2 GiB with `ERR_FS_FILE_TOO_LARGE`. Hashing the
* chunks in order equals hashing the whole buffer, so a manifest a buffered read produced is
* reproduced byte for byte.
*/
async function readWorkspaceFile(descriptor, maxBytes, keepBytes, path) {
	const hash = createHash("sha256");
	const buffer = Buffer.allocUnsafe(1024 * 1024);
	const chunks = [];
	let total = 0;
	while (true) {
		const { bytesRead } = await descriptor.read(buffer, 0, buffer.byteLength, null);
		if (bytesRead === 0) break;
		total += bytesRead;
		if (maxBytes !== void 0 && total > maxBytes) throw new Error(`workspace file exceeds its capture limit: ${path}`);
		const chunk = buffer.subarray(0, bytesRead);
		hash.update(chunk);
		if (keepBytes) chunks.push(Buffer.from(chunk));
	}
	const sha256 = `sha256:${hash.digest("hex")}`;
	return keepBytes ? {
		sha256,
		byteLength: total,
		bytes: Buffer.concat(chunks, total)
	} : {
		sha256,
		byteLength: total
	};
}
//#endregion
//#region src/candidate-execution/exact-object.ts
/** Reject unknown fields while requiring every declared non-optional field. */
function assertExactObjectKeys(value, required, label, optional = []) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
	const allowed = /* @__PURE__ */ new Set([...required, ...optional]);
	if (allowed.size !== required.length + optional.length) throw new Error(`${label} exact-key contract contains duplicate fields`);
	for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}`);
	for (const key of required) if (!(key in value)) throw new Error(`${label} is missing field ${key}`);
}
/**
* Reject a string carrying a lone surrogate. A well-formed UTF-16 string round-trips through UTF-8
* unchanged; a lone surrogate does not, so a value that passes here is safe to persist and re-read
* as the same bytes.
*/
function isWellFormedUnicode(value) {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code >= 55296 && code <= 56319) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 56320 && next <= 57343)) return false;
			index++;
		} else if (code >= 56320 && code <= 57343) return false;
	}
	return true;
}
//#endregion
//#region src/candidate-execution/git-materialize.ts
async function verifyCandidateCode(code, repositories, patchBytes) {
	if (code.kind === "disabled") return void 0;
	const repositoryRoot = await verifiedRepositoryRoot(code.repository, repositories);
	await assertCommitAndBaseTree(repositoryRoot, code.baseCommit, code.baseTree);
	if (code.kind === "no-op") {
		await assertSafeTree(repositoryRoot, code.baseTree);
		return code.baseTree;
	}
	if (!patchBytes) throw new Error("git-patch candidate is missing verified patch bytes");
	const temporary = await mkdtemp(join(tmpdir(), "agent-candidate-git-"));
	try {
		const indexFile = join(temporary, "index");
		await runCandidateGit(repositoryRoot, ["read-tree", code.baseTree], void 0, { GIT_INDEX_FILE: indexFile });
		await runCandidateGit(repositoryRoot, [
			"apply",
			"--cached",
			"--binary",
			"--whitespace=nowarn",
			"-"
		], patchBytes, { GIT_INDEX_FILE: indexFile });
		const candidateTree = (await runCandidateGit(repositoryRoot, ["write-tree"], void 0, { GIT_INDEX_FILE: indexFile })).stdout.toString("utf8").trim();
		if (candidateTree !== code.candidateTree) throw new Error(`git patch materialized tree ${candidateTree} does not match ${code.candidateTree}`);
		await assertSafeTree(repositoryRoot, candidateTree);
		return candidateTree;
	} finally {
		await rm(temporary, {
			recursive: true,
			force: true
		});
	}
}
async function readCandidateGitHubResource(resource, repositories) {
	const repositoryRoot = await verifiedRepositoryRoot(resource.repository, repositories);
	if ((await runCandidateGit(repositoryRoot, [
		"cat-file",
		"-t",
		resource.commit
	])).stdout.toString("utf8").trim() !== "commit") throw new Error(`GitHub resource commit is not a commit object: ${resource.commit}`);
	const listing = (await runCandidateGit(repositoryRoot, [
		"ls-tree",
		"-z",
		resource.commit,
		"--",
		resource.path
	])).stdout;
	const entries = parseTreeEntries(listing);
	if (entries.length !== 1 || entries[0]?.path !== resource.path) throw new Error(`GitHub resource path is not one exact file: ${resource.path}`);
	const entry = entries[0];
	if (entry?.type !== "blob" || entry.mode !== "100644" && entry.mode !== "100755") throw new Error(`GitHub resource path is not a regular Git blob: ${resource.path}`);
	const bytes = (await runCandidateGit(repositoryRoot, [
		"cat-file",
		"blob",
		entry.object
	])).stdout;
	verifyBytes(bytes, resource.sha256, resource.byteLength, `GitHub resource ${resource.path}`);
	return Uint8Array.from(bytes);
}
async function verifyTaskCheckout(taskRoot, expected) {
	const root = resolve(taskRoot);
	const head = (await runCandidateGit(root, ["rev-parse", "HEAD"])).stdout.toString("utf8").trim();
	if (head !== expected.baseCommit) throw new Error(`task checkout HEAD ${head} does not match ${expected.baseCommit}`);
	const tree = (await runCandidateGit(root, ["rev-parse", "HEAD^{tree}"])).stdout.toString("utf8").trim();
	if (tree !== expected.baseTree) throw new Error(`task checkout base tree ${tree} does not match ${expected.baseTree}`);
}
/**
* Apply an evaluator-captured binary diff in a detached object database and
* prove its result tree exactly matches the captured after-state manifest.
*/
async function verifyTaskOutcomePatch(input) {
	const repositoryRoot = resolve(input.repositoryRoot);
	await verifyTaskCheckout(repositoryRoot, input);
	const gitDir = resolve((await runCandidateGit(repositoryRoot, ["rev-parse", "--absolute-git-dir"])).stdout.toString("utf8").trim());
	if (await realpath(gitDir) !== gitDir || gitDir.includes(":")) throw new Error("task Git object store has an unsupported path");
	await assertNoGitIndirection(repositoryRoot, gitDir, "task repository");
	const temporary = await mkdtemp(join(tmpdir(), "agent-candidate-task-outcome-"));
	try {
		const objectDirectory = join(temporary, "objects");
		const indexFile = join(temporary, "index");
		await mkdir(objectDirectory);
		const gitEnvironment = {
			GIT_INDEX_FILE: indexFile,
			GIT_OBJECT_DIRECTORY: objectDirectory,
			GIT_ALTERNATE_OBJECT_DIRECTORIES: join(gitDir, "objects")
		};
		await runCandidateGit(repositoryRoot, ["read-tree", input.baseTree], void 0, gitEnvironment);
		if (input.patch.byteLength > 0) await runCandidateGit(repositoryRoot, [
			"apply",
			"--cached",
			"--binary",
			"--whitespace=nowarn",
			"-"
		], input.patch, gitEnvironment);
		const resultTree = (await runCandidateGit(repositoryRoot, ["write-tree"], void 0, gitEnvironment)).stdout.toString("utf8").trim();
		if (resultTree !== input.resultTree) throw new Error(`task outcome patch materialized tree ${resultTree} does not match ${input.resultTree}`);
		await assertSafeTree(repositoryRoot, resultTree, gitEnvironment);
		const observed = await workspaceManifestFromGitTree(repositoryRoot, resultTree, gitEnvironment);
		if (!Buffer.from(canonicalCandidateBytes$1(observed)).equals(Buffer.from(canonicalCandidateBytes$1(input.afterState)))) throw new Error("task outcome after-state does not match the materialized result tree");
		const resultCommit = (await runCandidateGit(repositoryRoot, [
			"commit-tree",
			resultTree,
			"-p",
			input.baseCommit
		], Buffer.from("candidate task outcome\n", "utf8"), {
			...gitEnvironment,
			GIT_AUTHOR_NAME: "Tangle Evaluator",
			GIT_AUTHOR_EMAIL: "evaluator@tangle.tools",
			GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
			GIT_COMMITTER_NAME: "Tangle Evaluator",
			GIT_COMMITTER_EMAIL: "evaluator@tangle.tools",
			GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z"
		})).stdout.toString("utf8").trim();
		if ((await runCandidateGit(repositoryRoot, ["rev-parse", `${resultCommit}^{tree}`], void 0, gitEnvironment)).stdout.toString("utf8").trim() !== resultTree) throw new Error("task outcome evaluator commit does not bind the verified result tree");
		return {
			resultTree,
			resultCommit
		};
	} finally {
		await rm(temporary, {
			recursive: true,
			force: true
		});
	}
}
async function verifiedRepositoryRoot(repository, repositories) {
	const repositoryRoot = resolve(await repositories.resolve(repository));
	if (!(await stat(repositoryRoot)).isDirectory()) throw new Error("candidate repository path is not a directory");
	const origin = (await runCandidateGit(repositoryRoot, [
		"remote",
		"get-url",
		"origin"
	])).stdout.toString("utf8").trim();
	const actual = parseGitHubRemote(origin);
	if (!actual || actual.owner !== repository.owner || actual.repo !== repository.repo) throw new Error(`local repository origin ${origin || "<missing>"} does not match github.com/${repository.owner}/${repository.repo}`);
	await assertNoGitIndirection(repositoryRoot, resolve((await runCandidateGit(repositoryRoot, ["rev-parse", "--absolute-git-dir"])).stdout.toString("utf8").trim()), "candidate repository");
	return repositoryRoot;
}
async function assertNoGitIndirection(repositoryRoot, gitDir, label) {
	if ((await runCandidateGit(repositoryRoot, [
		"for-each-ref",
		"--format=%(refname)",
		"refs/replace"
	])).stdout.toString("utf8").trim()) throw new Error(`${label} contains Git replace refs`);
	const commonDir = await realpath(resolve(repositoryRoot, (await runCandidateGit(repositoryRoot, ["rev-parse", "--git-common-dir"])).stdout.toString("utf8").trim()));
	if (commonDir.includes(":")) throw new Error(`${label} Git common directory has an unsupported path`);
	for (const objectRoot of /* @__PURE__ */ new Set([gitDir, commonDir])) for (const name of ["alternates", "http-alternates"]) {
		const path = join(objectRoot, "objects", "info", name);
		try {
			if ((await readFile(path, "utf8")).trim()) throw new Error(`${label} uses forbidden Git ${name}`);
		} catch (error) {
			if (!isNoEntry(error)) throw error;
		}
	}
}
async function assertCommitAndBaseTree(repositoryRoot, commit, expectedTree) {
	if ((await runCandidateGit(repositoryRoot, [
		"cat-file",
		"-t",
		commit
	])).stdout.toString("utf8").trim() !== "commit") throw new Error(`candidate base object is not a commit: ${commit}`);
	const actualTree = (await runCandidateGit(repositoryRoot, ["rev-parse", `${commit}^{tree}`])).stdout.toString("utf8").trim();
	if (actualTree !== expectedTree) throw new Error(`candidate base commit tree ${actualTree} does not match ${expectedTree}`);
}
async function assertSafeTree(repositoryRoot, tree, environment = {}) {
	const listing = (await runCandidateGit(repositoryRoot, [
		"ls-tree",
		"-rz",
		"--full-tree",
		tree
	], void 0, environment)).stdout;
	const entries = parseTreeEntries(listing);
	if (entries.length === 0) throw new Error("candidate Git tree cannot be empty");
	for (const entry of entries) {
		if (entry.type !== "blob" || entry.mode !== "100644" && entry.mode !== "100755") throw new Error(`candidate Git tree contains a symlink, submodule, or non-blob: ${entry.path}`);
		assertSafeGitPath(entry.path);
	}
}
async function workspaceManifestFromGitTree(repositoryRoot, tree, environment) {
	return candidateWorkspaceManifest(await readCandidateGitTreeFiles(repositoryRoot, tree, environment));
}
async function readCandidateGitTreeFiles(repositoryRoot, tree, environment = {}, limits) {
	const listing = (await runCandidateGit(repositoryRoot, [
		"ls-tree",
		"-rzl",
		"--full-tree",
		tree
	], void 0, environment)).stdout;
	const files = [];
	const entries = parseTreeEntries(listing);
	if (limits && entries.length > limits.maxFiles) throw new Error("candidate Git tree exceeds maxFiles");
	let totalBytes = 0;
	for (const entry of entries) {
		if (entry.type !== "blob" || entry.mode !== "100644" && entry.mode !== "100755") throw new Error(`candidate Git tree contains a non-regular file: ${entry.path}`);
		assertSafeGitPath(entry.path);
		if (entry.size === void 0) throw new Error(`candidate Git tree is missing blob size: ${entry.path}`);
		if (limits && entry.size > limits.maxFileBytes) throw new Error(`candidate Git tree file exceeds maxFileBytes: ${entry.path}`);
		totalBytes += entry.size;
		if (limits && totalBytes > limits.maxTotalFileBytes) throw new Error("candidate Git tree exceeds maxTotalFileBytes");
		const bytes = (await runCandidateGit(repositoryRoot, [
			"cat-file",
			"blob",
			entry.object
		], void 0, environment)).stdout;
		if (bytes.byteLength !== entry.size) throw new Error(`candidate Git blob size changed: ${entry.path}`);
		files.push({
			path: entry.path,
			mode: entry.mode === "100755" ? 493 : 420,
			bytes: Uint8Array.from(bytes)
		});
	}
	return files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
function parseTreeEntries(bytes) {
	const raw = Buffer.from(bytes);
	const decoded = raw.toString("utf8");
	if (!Buffer.from(decoded, "utf8").equals(raw)) throw new Error("candidate Git tree contains a non-UTF-8 path");
	return decoded.split("\0").filter(Boolean).map((row) => {
		const tab = row.indexOf("	");
		const header = row.slice(0, tab).split(" ").filter(Boolean);
		const path = row.slice(tab + 1);
		const [mode, type, object, sizeText] = header;
		if (tab < 1 || !mode || !type || !object || !path) throw new Error("malformed Git tree entry");
		const size = sizeText && /^\d+$/.test(sizeText) ? Number(sizeText) : void 0;
		if (size !== void 0 && !Number.isSafeInteger(size)) throw new Error("candidate Git tree entry size exceeds the safe integer range");
		return {
			mode,
			type,
			object,
			...size === void 0 ? {} : { size },
			path
		};
	});
}
function assertSafeGitPath(path) {
	if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0") || hasControlCharacter$1(path) || path.split("/").some((part) => !part || part === "." || part === "..") || path.split("/")[0]?.toLowerCase() === ".git") throw new Error(`candidate Git tree contains an unsafe path: ${path}`);
}
function hasControlCharacter$1(value) {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code < 32 || code === 127) return true;
	}
	return false;
}
function parseGitHubRemote(value) {
	const match = value.match(/^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/);
	if (!match?.[1] || !match[2]) return void 0;
	return {
		owner: match[1],
		repo: match[2]
	};
}
async function runCandidateGit(repositoryRoot, args, input, extraEnv = {}) {
	const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
	Object.assign(env, {
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_SYSTEM: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		GIT_NO_REPLACE_OBJECTS: "1",
		LC_ALL: "C",
		...extraEnv
	});
	const fullArgs = [
		"-c",
		"core.hooksPath=/dev/null",
		"-c",
		"core.fsmonitor=false",
		"-c",
		"core.untrackedCache=false",
		"-c",
		"protocol.file.allow=never",
		"-C",
		repositoryRoot,
		...args
	];
	return await new Promise((resolveResult, reject) => {
		const child = spawn("git", fullArgs, {
			env,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			]
		});
		const stdout = [];
		const stderr = [];
		child.stdout.on("data", (chunk) => stdout.push(chunk));
		child.stderr.on("data", (chunk) => stderr.push(chunk));
		child.on("error", reject);
		child.on("close", (code, signal) => {
			const out = Buffer.concat(stdout);
			const err = Buffer.concat(stderr);
			if (code !== 0) {
				reject(/* @__PURE__ */ new Error(`git ${args[0] ?? "<command>"} failed (${signal ?? code}): ${err.toString("utf8").trim()}`));
				return;
			}
			resolveResult({
				stdout: out,
				stderr: err
			});
		});
		if (input) child.stdin.end(input);
		else child.stdin.end();
	});
}
function isNoEntry(error) {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
//#endregion
//#region src/candidate-execution/output-artifacts.ts
/** Persist evaluator evidence, read it back, and bind the returned locator to the exact bytes. */
async function persistCandidateOutputArtifact(port, input) {
	input.signal?.throwIfAborted();
	const bytes = Uint8Array.from(input.bytes);
	const expectedDigest = sha256Bytes$1(bytes);
	const ref = agentCandidateArtifactRefSchema.parse(await port.put({
		executionId: input.executionId,
		purpose: input.purpose,
		bytes: Uint8Array.from(bytes),
		...input.signal ? { signal: input.signal } : {}
	}));
	input.signal?.throwIfAborted();
	if (ref.sha256 !== expectedDigest || ref.byteLength !== bytes.byteLength) throw new Error("candidate output locator does not identify the submitted bytes");
	const stored = await port.read(ref);
	input.signal?.throwIfAborted();
	verifyBytes(stored, expectedDigest, bytes.byteLength, "persisted candidate output");
	return immutableCandidateValue(ref);
}
//#endregion
//#region src/candidate-execution/workspace-archive.ts
const archiveKind = "agent-candidate-workspace-archive";
const workspaceEntryPrefix = "workspace/";
const repositoryMetadataEntry = "metadata/repository.json";
const repositoryBundleEntry = "metadata/repository.bundle";
const fixedTarTime = /* @__PURE__ */ new Date(0);
const defaultLimits = Object.freeze({
	maxArchiveBytes: 512 * 1024 * 1024,
	maxEmbeddedArtifactBytes: 1024 * 1024,
	maxFiles: 5e4,
	maxFileBytes: 128 * 1024 * 1024,
	maxTotalFileBytes: 256 * 1024 * 1024,
	maxPathBytes: 4096,
	maxRepositoryBundleBytes: 128 * 1024 * 1024
});
/** Capture one exact regular-file workspace for immutable candidate execution. */
async function captureAgentCandidateWorkspace(rootInput, options = {}) {
	const root = resolve(rootInput);
	const limits = workspaceLimits(options.limits);
	const captured = options.includeRepository ? await captureRepository(root, limits) : await captureMaterializedWorkspace(root, { limits: {
		maxFiles: limits.maxFiles,
		maxFileBytes: limits.maxFileBytes,
		maxTotalFileBytes: limits.maxTotalFileBytes
	} });
	assertWorkspaceFilesWithinLimits(captured.files, limits);
	const repository = "repository" in captured ? captured.repository : void 0;
	return captureWorkspaceFiles(captured.files, repository, limits, options.artifactPersistence);
}
/** Capture detached files returned by a remote executor into the standard archive. */
async function captureAgentCandidateWorkspaceFiles(input, options = {}) {
	const limits = workspaceLimits(options.limits);
	return captureWorkspaceFiles(normalizeWorkspaceFiles(input, limits), void 0, limits, options.artifactPersistence);
}
async function captureWorkspaceFiles(files, repository, limits, artifactPersistence) {
	const material = candidateWorkspaceManifest(files);
	const manifest = canonicalCandidateBytes$1(material);
	const archive = await encodeWorkspaceArchive(files, repository, limits.maxArchiveBytes);
	if (!artifactPersistence && (manifest.byteLength > limits.maxEmbeddedArtifactBytes || archive.byteLength > limits.maxEmbeddedArtifactBytes)) throw new Error("candidate workspace artifacts exceed maxEmbeddedArtifactBytes; artifactPersistence is required");
	const manifestArtifact = await captureWorkspaceArtifact("manifest", manifest, artifactPersistence);
	const archiveArtifact = await captureWorkspaceArtifact("archive", archive, artifactPersistence);
	const snapshot = deepFreezeCandidate({
		kind: "agent-candidate-workspace-snapshot",
		digest: canonicalCandidateDigest$1(material),
		material,
		manifest: manifestArtifact,
		archive: archiveArtifact
	});
	return Object.freeze({
		snapshot,
		archive
	});
}
async function captureWorkspaceArtifact(kind, bytes, persistence) {
	if (!persistence) return embeddedCandidateArtifact(bytes);
	if (!persistence.executionId.trim()) throw new Error("candidate workspace artifact persistence requires an executionId");
	return persistCandidateOutputArtifact(persistence.outputArtifacts, {
		executionId: persistence.executionId,
		purpose: kind === "manifest" ? "candidate-workspace-manifest" : "candidate-workspace-archive",
		bytes,
		...persistence.signal ? { signal: persistence.signal } : {}
	});
}
/** Create the standard bounded materializer for candidate execution ports. */
function createAgentCandidateWorkspacePort(options = {}) {
	const limits = workspaceLimits(options.limits);
	return Object.freeze({ materialize: async ({ role, snapshot, archive, destination }) => {
		await materializeAgentCandidateWorkspace({
			role,
			snapshot,
			archive,
			destination,
			limits
		});
	} });
}
async function materializeAgentCandidateWorkspace(input) {
	const decoded = await decodeVerifiedWorkspaceArchive(input);
	const destination = resolve(input.destination);
	await prepareEmptyDestination(destination);
	const staging = await mkdtemp(`${destination}.materializing-`);
	try {
		await writeWorkspaceFiles(staging, decoded.files);
		if (decoded.repository) await materializeRepository(decoded.repository, staging);
		await verifyMaterializedWorkspace(staging, input.snapshot.material, { ignoredProtectedRootEntries: decoded.repository ? [".git"] : [] });
		await rename(staging, destination);
	} catch (error) {
		await rm(staging, {
			recursive: true,
			force: true
		});
		await rm(destination, {
			recursive: true,
			force: true
		});
		throw error;
	}
}
/** Verify a portable archive before its source environment may be discarded. */
async function verifyAgentCandidateWorkspaceArchive(input) {
	await decodeVerifiedWorkspaceArchive({
		...input,
		limits: workspaceLimits(input.limits)
	});
}
async function decodeVerifiedWorkspaceArchive(input) {
	verifyBytes(input.archive, input.snapshot.archive.sha256, input.snapshot.archive.byteLength, "candidate workspace archive");
	const decoded = await parseWorkspaceArchive(input.archive, input.limits);
	if (decoded.repository && input.role !== "task") throw new Error("only task workspaces may carry a Git repository");
	assertArchiveMatchesSnapshot(decoded.files, input.snapshot);
	return decoded;
}
async function captureRepository(requestedRoot, limits) {
	const requestedStats = await lstat(requestedRoot);
	if (!requestedStats.isDirectory() || requestedStats.isSymbolicLink()) throw new Error("candidate repository root must be a real directory");
	const root = await realpath(requestedRoot);
	const resolvedStats = await lstat(root);
	if (!resolvedStats.isDirectory() || resolvedStats.isSymbolicLink()) throw new Error("candidate repository root must resolve to a real directory");
	if (await realpath(resolve((await runCandidateGit(root, ["rev-parse", "--show-toplevel"])).stdout.toString("utf8").trim())) !== root) throw new Error("candidate repository capture must start at the Git worktree root");
	const gitDir = resolve((await runCandidateGit(root, ["rev-parse", "--absolute-git-dir"])).stdout.toString("utf8").trim());
	if (await realpath(gitDir) !== gitDir || gitDir.includes(":")) throw new Error("candidate repository Git object store has an unsupported path");
	await assertNoGitIndirection(root, gitDir, "candidate repository");
	const headCommit = (await runCandidateGit(root, ["rev-parse", "HEAD"])).stdout.toString("utf8").trim();
	const headTree = (await runCandidateGit(root, ["rev-parse", "HEAD^{tree}"])).stdout.toString("utf8").trim();
	assertGitObjectId(headCommit, "HEAD");
	assertGitObjectId(headTree, "HEAD tree");
	if (headCommit.length !== headTree.length) throw new Error("candidate repository HEAD and tree use different object formats");
	const files = await readCandidateGitTreeFiles(root, headTree, {}, limits);
	assertWorkspaceFilesWithinLimits(files, limits);
	const reachableBytesText = (await runCandidateGit(root, [
		"rev-list",
		"--disk-usage",
		"--objects",
		"HEAD"
	])).stdout.toString("utf8").trim();
	const reachableBytes = Number(reachableBytesText);
	if (!Number.isSafeInteger(reachableBytes) || reachableBytes < 0) throw new Error("candidate repository reachable size is invalid");
	if (reachableBytes > limits.maxRepositoryBundleBytes) throw new Error("candidate repository exceeds maxRepositoryBundleBytes");
	const temporary = await mkdtemp(join(tmpdir(), "agent-candidate-workspace-bundle-"));
	const bundlePath = join(temporary, `${randomUUID()}.bundle`);
	try {
		await runCandidateGit(root, [
			"bundle",
			"create",
			bundlePath,
			"HEAD"
		]);
		const bundle = Uint8Array.from(await readFile(bundlePath));
		if (bundle.byteLength > limits.maxRepositoryBundleBytes) throw new Error("candidate repository bundle exceeds maxRepositoryBundleBytes");
		return {
			files,
			repository: {
				headCommit,
				headTree,
				bundle: {
					sha256: sha256Bytes$1(bundle),
					byteLength: bundle.byteLength,
					bytes: bundle
				}
			}
		};
	} finally {
		await rm(temporary, {
			recursive: true,
			force: true
		});
	}
}
async function encodeWorkspaceArchive(files, repository, maxArchiveBytes) {
	const archive = pack();
	const output = collectStream(archive, maxArchiveBytes, "candidate workspace archive");
	try {
		await writeWorkspaceArchiveEntries(archive, files, repository);
		archive.finalize();
		return await output;
	} catch (error) {
		archive.destroy(error instanceof Error ? error : new Error(String(error)));
		await output.catch(() => void 0);
		throw error;
	}
}
async function verifyCanonicalWorkspaceArchive(files, repository, expected, maxArchiveBytes) {
	const archive = pack();
	const comparison = streamEqualsBytes(archive, expected, maxArchiveBytes, "candidate workspace archive");
	try {
		await writeWorkspaceArchiveEntries(archive, files, repository);
		archive.finalize();
		if (!await comparison) throw new Error("candidate workspace tar is not canonical");
	} catch (error) {
		archive.destroy(error instanceof Error ? error : new Error(String(error)));
		await comparison.catch(() => void 0);
		throw error;
	}
}
async function writeWorkspaceArchiveEntries(archive, files, repository) {
	for (const file of files) await writeTarEntry(archive, `${workspaceEntryPrefix}${file.path}`, file.mode, file.bytes);
	if (!repository) return;
	const metadata = canonicalCandidateBytes$1({
		kind: archiveKind,
		headCommit: repository.headCommit,
		headTree: repository.headTree,
		bundle: {
			sha256: repository.bundle.sha256,
			byteLength: repository.bundle.byteLength
		}
	});
	await writeTarEntry(archive, repositoryMetadataEntry, 384, metadata);
	await writeTarEntry(archive, repositoryBundleEntry, 384, repository.bundle.bytes);
}
async function parseWorkspaceArchive(bytes, limits) {
	if (bytes.byteLength > limits.maxArchiveBytes) throw new Error("candidate workspace archive exceeds maxArchiveBytes");
	const parser = extract();
	const files = [];
	const observedEntryNames = /* @__PURE__ */ new Set();
	const observedPaths = /* @__PURE__ */ new Set();
	let totalBytes = 0;
	let retainedEntryBytes = 0;
	let previousPath;
	let repositoryMetadata;
	let repositoryBundle;
	const decoded = (async () => {
		for await (const entry of parser) {
			const name = entry.header.name;
			if (entry.header.type !== "file" || typeof name !== "string" || observedEntryNames.has(name)) throw new Error("candidate workspace tar contains an invalid entry");
			observedEntryNames.add(name);
			if (name.startsWith(workspaceEntryPrefix)) {
				if (files.length >= limits.maxFiles) throw new Error("candidate workspace archive has an invalid file count");
				const path = safeArchivePath(name.slice(10), limits.maxPathBytes);
				if (!isWorkspaceFileMode(entry.header.mode)) throw new Error(`candidate workspace archive has an unsupported mode: ${path}`);
				assertRetainedArchiveSize(bytes.byteLength, retainedEntryBytes, entry.header.size, limits);
				const fileBytes = await readTarEntry(entry, limits.maxFileBytes, `workspace file ${path}`);
				retainedEntryBytes += fileBytes.byteLength;
				assertWorkspacePathOrder(path, previousPath, observedPaths, "candidate workspace archive paths must be unique and sorted");
				previousPath = path;
				if (fileBytes.byteLength > limits.maxTotalFileBytes - totalBytes) throw new Error("candidate workspace archive exceeds maxTotalFileBytes");
				totalBytes += fileBytes.byteLength;
				files.push({
					path,
					mode: entry.header.mode,
					bytes: fileBytes
				});
			} else if (name === repositoryMetadataEntry) {
				if (entry.header.mode !== 384 || repositoryMetadata) throw new Error("candidate workspace archive repository metadata is invalid");
				assertRetainedArchiveSize(bytes.byteLength, retainedEntryBytes, entry.header.size, limits);
				const metadataBytes = await readTarEntry(entry, limits.maxPathBytes, "candidate repository metadata");
				retainedEntryBytes += metadataBytes.byteLength;
				repositoryMetadata = parseRepositoryMetadata(metadataBytes, limits.maxRepositoryBundleBytes);
			} else if (name === repositoryBundleEntry) {
				if (entry.header.mode !== 384 || repositoryBundle) throw new Error("candidate workspace archive repository bundle is invalid");
				assertRetainedArchiveSize(bytes.byteLength, retainedEntryBytes, entry.header.size, limits);
				repositoryBundle = await readTarEntry(entry, limits.maxRepositoryBundleBytes, "candidate Git bundle");
				retainedEntryBytes += repositoryBundle.byteLength;
			} else throw new Error(`candidate workspace tar contains an unsupported entry: ${name}`);
		}
		if (Boolean(repositoryMetadata) !== Boolean(repositoryBundle)) throw new Error("candidate workspace archive repository evidence is incomplete");
		const repository = repositoryMetadata && repositoryBundle ? repositoryFromTar(repositoryMetadata, repositoryBundle) : void 0;
		return {
			files,
			...repository ? { repository } : {}
		};
	})();
	parser.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
	const result = await decoded;
	await verifyCanonicalWorkspaceArchive(result.files, result.repository, bytes, limits.maxArchiveBytes);
	return result;
}
function assertRetainedArchiveSize(archiveBytes, retainedEntryBytes, entryBytes, limits) {
	if (!Number.isSafeInteger(entryBytes) || entryBytes === void 0 || entryBytes < 0 || entryBytes > limits.maxArchiveBytes - archiveBytes - retainedEntryBytes) throw new Error("candidate workspace archive exceeds maxArchiveBytes while decoding");
}
function parseRepositoryMetadata(bytes, maxBundleBytes) {
	let value;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (error) {
		throw new Error("candidate workspace archive repository metadata is invalid", { cause: error });
	}
	if (!isRecord(value) || Object.keys(value).sort().join(",") !== "bundle,headCommit,headTree,kind" || value.kind !== archiveKind || typeof value.headCommit !== "string" || typeof value.headTree !== "string" || !isRecord(value.bundle) || Object.keys(value.bundle).sort().join(",") !== "byteLength,sha256" || typeof value.bundle.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.bundle.sha256) || !Number.isSafeInteger(value.bundle.byteLength) || value.bundle.byteLength <= 0 || value.bundle.byteLength > maxBundleBytes) throw new Error("candidate workspace archive repository is invalid");
	if (!Buffer.from(canonicalCandidateBytes$1(value)).equals(Buffer.from(bytes))) throw new Error("candidate workspace archive repository metadata is not canonical");
	assertGitObjectId(value.headCommit, "repository HEAD");
	assertGitObjectId(value.headTree, "repository HEAD tree");
	if (value.headCommit.length !== value.headTree.length) throw new Error("candidate repository HEAD and tree use different object formats");
	return {
		kind: archiveKind,
		headCommit: value.headCommit,
		headTree: value.headTree,
		bundle: {
			sha256: value.bundle.sha256,
			byteLength: value.bundle.byteLength
		}
	};
}
function repositoryFromTar(metadata, bundle) {
	verifyBytes(bundle, metadata.bundle.sha256, metadata.bundle.byteLength, "candidate Git bundle");
	return {
		headCommit: metadata.headCommit,
		headTree: metadata.headTree,
		bundle: {
			...metadata.bundle,
			bytes: bundle
		}
	};
}
async function writeTarEntry(archive, name, mode, bytes) {
	await new Promise((resolveEntry, rejectEntry) => {
		archive.entry({
			name,
			mode,
			uid: 0,
			gid: 0,
			size: bytes.byteLength,
			mtime: fixedTarTime,
			type: "file",
			uname: "",
			gname: ""
		}, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), (error) => error ? rejectEntry(error) : resolveEntry());
	});
}
async function readTarEntry(entry, maxBytes, label) {
	const size = entry.header.size;
	if (!Number.isSafeInteger(size) || size === void 0 || size < 0 || size > maxBytes) throw new Error(`${label} has an invalid tar size`);
	const bytes = await collectStream(entry, maxBytes, label);
	if (bytes.byteLength !== size) throw new Error(`${label} differs from its tar size`);
	return bytes;
}
async function collectStream(stream, maxBytes, label) {
	const chunks = [];
	let totalBytes = 0;
	for await (const chunk of stream) {
		if (!(chunk instanceof Uint8Array)) throw new Error(`${label} emitted a non-byte chunk`);
		if (chunk.byteLength > maxBytes - totalBytes) {
			const error = /* @__PURE__ */ new Error(`${label} exceeds its size limit`);
			if ("destroy" in stream && typeof stream.destroy === "function") stream.destroy(error);
			throw error;
		}
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		chunks.push(bytes);
		totalBytes += bytes.byteLength;
	}
	return Buffer.concat(chunks, totalBytes);
}
async function streamEqualsBytes(stream, expected, maxBytes, label) {
	const expectedBuffer = Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength);
	let equal = true;
	let offset = 0;
	for await (const chunk of stream) {
		if (!(chunk instanceof Uint8Array)) throw new Error(`${label} emitted a non-byte chunk`);
		if (chunk.byteLength > maxBytes - offset) {
			const error = /* @__PURE__ */ new Error(`${label} exceeds its size limit`);
			if ("destroy" in stream && typeof stream.destroy === "function") stream.destroy(error);
			throw error;
		}
		const observed = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
		if (offset + observed.byteLength > expectedBuffer.byteLength || !observed.equals(expectedBuffer.subarray(offset, offset + observed.byteLength))) equal = false;
		offset += observed.byteLength;
	}
	return equal && offset === expectedBuffer.byteLength;
}
async function prepareEmptyDestination(destination) {
	await mkdir(destination, {
		recursive: true,
		mode: 448
	});
	const stats = await lstat(destination);
	if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("candidate workspace destination must be a real directory");
	const resolvedStats = await lstat(await realpath(destination));
	if (!resolvedStats.isDirectory() || resolvedStats.isSymbolicLink()) throw new Error("candidate workspace destination must resolve to a real directory");
	if ((await readdir(destination)).length > 0) throw new Error("candidate workspace destination must be empty");
}
async function writeWorkspaceFiles(destination, files) {
	for (const file of files) {
		const path = workspacePath(destination, file.path);
		await mkdir(dirname(path), {
			recursive: true,
			mode: 448
		});
		const descriptor = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0), 384);
		try {
			await descriptor.writeFile(file.bytes);
			const stats = await descriptor.stat();
			if (!stats.isFile() || stats.nlink !== 1) throw new Error(`candidate workspace file identity changed while writing: ${file.path}`);
			await descriptor.chmod(file.mode);
		} finally {
			await descriptor.close();
		}
	}
}
async function materializeRepository(repository, destination) {
	const temporary = await mkdtemp(join(tmpdir(), "agent-candidate-workspace-bundle-"));
	const bundlePath = join(temporary, `${randomUUID()}.bundle`);
	try {
		await writeFile(bundlePath, repository.bundle.bytes, {
			flag: "wx",
			mode: 384
		});
		await runCandidateGit(destination, [
			"init",
			"--quiet",
			"--initial-branch=candidate",
			`--object-format=${repository.headCommit.length === 64 ? "sha256" : "sha1"}`
		]);
		await runCandidateGit(destination, [
			"bundle",
			"verify",
			bundlePath
		]);
		await runCandidateGit(destination, [
			"bundle",
			"unbundle",
			bundlePath
		]);
		if ((await runCandidateGit(destination, [
			"cat-file",
			"-t",
			repository.headCommit
		])).stdout.toString("utf8").trim() !== "commit") throw new Error("candidate repository HEAD is not a commit");
		if ((await runCandidateGit(destination, ["rev-parse", `${repository.headCommit}^{tree}`])).stdout.toString("utf8").trim() !== repository.headTree) throw new Error("candidate repository bundle HEAD tree changed");
		await runCandidateGit(destination, [
			"update-ref",
			"--no-deref",
			"HEAD",
			repository.headCommit
		]);
		await runCandidateGit(destination, ["read-tree", repository.headTree]);
		if ((await runCandidateGit(destination, [
			"status",
			"--porcelain=v1",
			"--untracked-files=all"
		])).stdout.toString("utf8").trim()) throw new Error("candidate repository files do not exactly match HEAD");
	} finally {
		await rm(temporary, {
			recursive: true,
			force: true
		});
	}
}
function assertArchiveMatchesSnapshot(files, snapshot) {
	const material = candidateWorkspaceManifest(files);
	const materialBytes = canonicalCandidateBytes$1(material);
	verifyBytes(materialBytes, snapshot.manifest.sha256, snapshot.manifest.byteLength, "candidate workspace manifest");
	if (canonicalCandidateDigest$1(material) !== snapshot.digest || !Buffer.from(materialBytes).equals(Buffer.from(canonicalCandidateBytes$1(snapshot.material)))) throw new Error("candidate workspace archive does not match its snapshot manifest");
}
function assertWorkspaceFilesWithinLimits(files, limits) {
	if (files.length > limits.maxFiles) throw new Error("candidate workspace exceeds maxFiles");
	let totalBytes = 0;
	let previousPath;
	const observedPaths = /* @__PURE__ */ new Set();
	for (const file of files) {
		const path = safeArchivePath(file.path, limits.maxPathBytes);
		assertWorkspacePathOrder(path, previousPath, observedPaths, "candidate workspace paths must be unique and sorted");
		previousPath = path;
		if (!isWorkspaceFileMode(file.mode)) throw new Error(`candidate workspace file has unsupported mode: ${path}`);
		if (file.bytes.byteLength > limits.maxFileBytes) throw new Error(`candidate workspace file exceeds maxFileBytes: ${path}`);
		totalBytes += file.bytes.byteLength;
		if (totalBytes > limits.maxTotalFileBytes) throw new Error("candidate workspace exceeds maxTotalFileBytes");
	}
}
function normalizeWorkspaceFiles(input, limits) {
	if (!Array.isArray(input)) throw new Error("candidate workspace files must be an array");
	const fileCount = input.length;
	if (fileCount > limits.maxFiles) throw new Error("candidate workspace exceeds maxFiles");
	let totalBytes = 0;
	const files = [];
	for (let index = 0; index < fileCount; index++) {
		const inputFile = input[index];
		if (!isRecord(inputFile) || Object.keys(inputFile).sort().join(",") !== "bytes,mode,path") throw new Error(`candidate workspace file ${index} is invalid`);
		const descriptors = Object.getOwnPropertyDescriptors(inputFile);
		if (!("value" in (descriptors.path ?? {})) || !("value" in (descriptors.mode ?? {})) || !("value" in (descriptors.bytes ?? {}))) throw new Error(`candidate workspace file ${index} must use fixed values`);
		const path = safeArchivePath(descriptors.path?.value, limits.maxPathBytes);
		const mode = descriptors.mode?.value;
		const inputBytes = descriptors.bytes?.value;
		if (!isWorkspaceFileMode(mode)) throw new Error(`candidate workspace file has unsupported mode: ${path}`);
		const view = inspectWorkspaceBytes(inputBytes, path);
		if (view.byteLength > limits.maxFileBytes) throw new Error(`candidate workspace file exceeds maxFileBytes: ${path}`);
		if (view.byteLength > limits.maxTotalFileBytes - totalBytes) throw new Error("candidate workspace exceeds maxTotalFileBytes");
		if (view.byteLength > Math.max(0, limits.maxArchiveBytes - 1024)) throw new Error("candidate workspace archive exceeds maxArchiveBytes");
		totalBytes += view.byteLength;
		files.push({
			path,
			mode,
			bytes: detachWorkspaceBytes(view)
		});
	}
	files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
	assertWorkspaceFilesWithinLimits(files, limits);
	return files;
}
function isWorkspaceFileMode(value) {
	return Number.isSafeInteger(value) && value >= 0 && value <= 511;
}
function workspaceLimits(overrides) {
	const limits = {
		...defaultLimits,
		...overrides
	};
	for (const [name, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`candidate workspace ${name} must be a positive safe integer`);
	return Object.freeze(limits);
}
function safeArchivePath(value, maxPathBytes) {
	if (typeof value !== "string" || !value || !isWellFormedUnicode(value) || Buffer.byteLength(value, "utf8") > maxPathBytes || isAbsolute(value) || win32.isAbsolute(value) || value.includes("\\") || value.includes("\0") || hasControlCharacter(value) || value.split("/").some((part) => !part || part === "." || part === "..") || [".git", ".sidecar"].includes(value.split("/")[0]?.toLowerCase() ?? "")) throw new Error(`candidate workspace archive contains an unsafe path: ${String(value)}`);
	return value;
}
function assertWorkspacePathOrder(path, previousPath, observedPaths, errorMessage) {
	if (previousPath !== void 0 && previousPath >= path) throw new Error(errorMessage);
	for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) if (observedPaths.has(path.slice(0, slash))) throw new Error(errorMessage);
	observedPaths.add(path);
}
function inspectWorkspaceBytes(input, path) {
	let buffer;
	let byteOffset;
	let byteLength;
	try {
		buffer = typedArrayBufferGetter.call(input);
		byteOffset = typedArrayByteOffsetGetter.call(input);
		byteLength = typedArrayByteLengthGetter.call(input);
	} catch {
		throw new Error(`candidate workspace file bytes are invalid: ${path}`);
	}
	if (isSharedArrayBuffer(buffer)) throw new Error(`candidate workspace file uses shared bytes: ${path}`);
	if (!isAnyArrayBuffer(buffer)) throw new Error(`candidate workspace file bytes are invalid: ${path}`);
	return {
		buffer,
		byteOffset,
		byteLength
	};
}
function detachWorkspaceBytes(input) {
	const { buffer, byteOffset, byteLength } = input;
	const copy = new Uint8Array(byteLength);
	Uint8Array.prototype.set.call(copy, new Uint8Array(buffer, byteOffset, byteLength));
	return copy;
}
function workspacePath(root, relativePath) {
	const path = resolve(root, relativePath);
	if (!path.startsWith(`${root}${sep}`)) throw new Error(`candidate workspace archive path escapes its destination: ${relativePath}`);
	return path;
}
function assertGitObjectId(value, label) {
	if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) throw new Error(`candidate repository ${label} is not a Git object id`);
}
function hasControlCharacter(value) {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code < 32 || code === 127) return true;
	}
	return false;
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireTypedArrayGetter(name) {
	const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
	const getter = Object.getOwnPropertyDescriptor(typedArrayPrototype, name)?.get;
	if (!getter) throw new Error(`typed array intrinsic ${name} accessor is unavailable`);
	return getter;
}
const typedArrayBufferGetter = requireTypedArrayGetter("buffer");
const typedArrayByteOffsetGetter = requireTypedArrayGetter("byteOffset");
const typedArrayByteLengthGetter = requireTypedArrayGetter("byteLength");
//#endregion
export { verifyCanonicalCandidateDocument as A, canonicalCandidateDigest$1 as C, immutableCandidateValue as D, embeddedCandidateArtifact as E, omitTopLevelDigest as O, canonicalCandidateBytes$1 as S, deepFreezeCandidate as T, scanMaterializedWorkspaceManifest as _, persistCandidateOutputArtifact as a, verifyMaterializedWorkspace as b, verifyTaskCheckout as c, isWellFormedUnicode as d, artifactCacheKey as f, readVerifiedArtifact as g, readMaterializedWorkspaceFiles as h, verifyAgentCandidateWorkspaceArchive as i, sha256Bytes$1 as k, verifyTaskOutcomePatch as l, captureMaterializedWorkspace as m, captureAgentCandidateWorkspaceFiles as n, readCandidateGitHubResource as o, candidateWorkspaceManifest as p, createAgentCandidateWorkspacePort as r, verifyCandidateCode as s, captureAgentCandidateWorkspace as t, assertExactObjectKeys as u, verifyBytes as v, canonicalCandidateDocument as w, verifyWorkspaceSnapshotArtifacts as x, verifyMaterializedProfileWorkspace as y };

//# sourceMappingURL=workspace-archive-C9lgf77y.js.map