import { randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fchmodSync, fsyncSync, linkSync, lstatSync, openSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
//#region src/runtime/supervise/durable-file.ts
/**
* Small filesystem durability primitives for Runtime-owned state.
*
* Callers must validate their path and parent directory before invoking these functions.
* The exclusive writer protects a no-clobber publication race; the atomic writer replaces one
* state file after its temporary contents reach stable storage.
*
* @internal
*/
/** Publish a new file without replacing a concurrent winner. */
function publishExclusiveDurableFile(filePath, content, options = {}) {
	const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
	let operationFailed = false;
	let operationError;
	let published = false;
	try {
		writeExclusiveDurableFile(temporaryPath, content, options);
		try {
			linkSync(temporaryPath, filePath);
			syncDurableDirectory(dirname(filePath));
			published = true;
		} catch (error) {
			if (!isAlreadyExistsError(error)) throw error;
		}
	} catch (error) {
		operationFailed = true;
		operationError = error;
	}
	let cleanupError;
	try {
		unlinkSync(temporaryPath);
	} catch (error) {
		if (!isNoEntryError(error)) cleanupError = error;
	}
	if (operationFailed) throw operationError;
	if (cleanupError !== void 0) throw cleanupError;
	return published;
}
/** Fsync a directory after publishing a durable file entry. */
function syncDurableDirectory(directoryPath) {
	const fd = openSync(directoryPath, "r");
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}
/** Fsync one durable file after its contents reach stable storage. */
function syncDurableFile(filePath) {
	const fd = openSync(filePath, "r");
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}
/** Append one record with O_APPEND, then fsync the file and containing directory. */
function appendDurableFile(filePath, content, options = {}) {
	const fd = openSync(filePath, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0), options.mode ?? 384);
	try {
		if (process.platform !== "win32") fchmodSync(fd, options.mode ?? 384);
		const expectedBytes = Buffer.byteLength(content, "utf8");
		const writtenBytes = writeSync(fd, content, void 0, "utf8");
		if (writtenBytes !== expectedBytes) throw new Error(`durable append wrote ${writtenBytes} of ${expectedBytes} bytes to '${filePath}'`);
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	syncDurableDirectory(dirname(filePath));
}
/** Reject a path that escapes its run directory or traverses a symbolic link. */
function assertNoSymlinkDescendant(root, target, label = "path") {
	const base = resolve(root);
	const rel = relative(base, resolve(target));
	if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error(`${label} path escapes its run directory`);
	if (existsSync(base) && lstatSync(base).isSymbolicLink()) throw new Error(`${label} path contains a symbolic link: ${base}`);
	let current = base;
	for (const part of rel.split(/[\\/]/u).filter(Boolean)) {
		current = join(current, part);
		if (!existsSync(current)) continue;
		if (lstatSync(current).isSymbolicLink()) throw new Error(`${label} path contains a symbolic link: ${current}`);
	}
}
/** Write, fsync, atomically replace, and fsync one Runtime-owned state file. */
function writeAtomicDurableFile(filePath, content, options = {}) {
	const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
	let operationFailed = false;
	let operationError;
	try {
		writeExclusiveDurableFile(temporaryPath, content, options);
		renameSync(temporaryPath, filePath);
		syncDurableDirectory(dirname(filePath));
	} catch (error) {
		operationFailed = true;
		operationError = error;
	}
	let cleanupError;
	try {
		unlinkSync(temporaryPath);
	} catch (error) {
		if (!isNoEntryError(error)) cleanupError = error;
	}
	if (operationFailed) throw operationError;
	if (cleanupError !== void 0) throw cleanupError;
}
function writeExclusiveDurableFile(filePath, content, options) {
	if (options.mode === void 0) writeFileSync(filePath, content, {
		encoding: "utf8",
		flag: "wx"
	});
	else writeFileSync(filePath, content, {
		encoding: "utf8",
		flag: "wx",
		mode: options.mode
	});
	syncDurableFile(filePath);
}
function isAlreadyExistsError(error) {
	return error !== null && typeof error === "object" && "code" in error && error.code === "EEXIST";
}
function isNoEntryError(error) {
	return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
//#endregion
export { writeAtomicDurableFile as a, syncDurableDirectory as i, assertNoSymlinkDescendant as n, publishExclusiveDurableFile as r, appendDurableFile as t };

//# sourceMappingURL=durable-file-DWQA4ooo.js.map