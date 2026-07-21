"""Execute one runtime-prepared candidate inside a Pier task container.

Pier owns the task container, patch transfer, and verifier.  Agent Runtime owns
candidate verification, exact execution bytes, model access, and trace usage.
This bridge only rechecks the prepared bytes, copies their signed workspaces,
delivers the exact task instruction, and reports truthful process termination.
"""

from __future__ import annotations

import asyncio
import base64
import json
import math
import os
import re
import secrets
import shlex
import tempfile
import time
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version as package_version
from pathlib import Path, PurePosixPath
from typing import Any

from pier.agents.base import BaseAgent
from pier.agents.installed.base import NonZeroAgentExitCodeError
from pier.environments.base import BaseEnvironment
from pier.models.agent.context import AgentContext
from pier.models.agent.network import NetworkAllowlist

from .candidate_contract import (
    CandidateContractError,
    PreparedCandidateContract,
    immutable_snapshot,
    load_prepared_candidate_contract,
    sha256_bytes,
)
from .process_boundary import CandidateProcessBoundary, ProcessBoundaryConfig
from .workspace_boundary import (
    CandidateWorkspaceBoundary,
    WorkspaceBoundaryConfig,
    candidate_git_env,
)


_ADAPTER_VERSION = "2.0.0"
_ENV_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_PROTECTED_TASK_PATH = "/tangle/input/stdin.txt"
_PIER_PROTECTED_ROOTS = ("/logs", "/tests", "/solution", "/tangle")
_CANDIDATE_UID = 65532
_CANDIDATE_GID = 65532
_EVALUATOR_ROOT = "/tangle"
_CANDIDATE_HOME = "/tangle/home"
_CANDIDATE_TMP = "/tangle/tmp"
_CONTROL_ROOT = "/tangle/control"
_FIXED_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
_RESERVED_PROCESS_ENV = {
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0",
    "GIT_CONFIG_VALUE_0",
    "GIT_CONFIG_NOSYSTEM",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_SYSTEM",
    "GIT_NO_REPLACE_OBJECTS",
    "GIT_TERMINAL_PROMPT",
    "HOME",
    "LC_ALL",
    "PATH",
    "TMPDIR",
}
_TRACE_ENV_NAMES = {
    "TANGLE_CANDIDATE_EXECUTION_ID",
    "TANGLE_CANDIDATE_BUNDLE_DIGEST",
    "TANGLE_CANDIDATE_EXECUTION_PLAN_DIGEST",
    "TANGLE_CANDIDATE_MATERIALIZATION_RECEIPT_DIGEST",
    "TANGLE_TRACE_RUN_ID",
}


@dataclass(frozen=True)
class OriginalProfileFile:
    path: str
    existed: bool
    tracked: bool
    mode: int | None
    content: bytes | None


class PierCandidateError(CandidateContractError):
    """The prepared candidate cannot be replayed safely by Pier."""


def _runtime_pier_version() -> str:
    try:
        return package_version("datacurve-pier")
    except PackageNotFoundError as exc:
        raise PierCandidateError(
            "datacurve-pier package metadata is unavailable"
        ) from exc


def _same_or_descendant(path: str, root: str) -> bool:
    return path == root or path.startswith(f"{root}/")


def _join_workspace(root: str, relative: str) -> str:
    root_path = PurePosixPath(root)
    joined = root_path if relative == "." else root_path / PurePosixPath(relative)
    if joined != root_path and root_path not in joined.parents:
        raise PierCandidateError(f"cwd escapes its workspace: {relative}")
    return str(joined)


def _trace_env(
    contract: PreparedCandidateContract, trace_run_id: str
) -> dict[str, str]:
    return {
        "TANGLE_CANDIDATE_EXECUTION_ID": contract.execution_id,
        "TANGLE_CANDIDATE_BUNDLE_DIGEST": contract.bundle_digest,
        "TANGLE_CANDIDATE_EXECUTION_PLAN_DIGEST": contract.execution_plan_digest,
        "TANGLE_CANDIDATE_MATERIALIZATION_RECEIPT_DIGEST": contract.materialization_receipt_digest,
        "TANGLE_TRACE_RUN_ID": trace_run_id,
    }


class TangleCandidateAgent(BaseAgent):
    """Pier adapter for a branded ``PreparedAgentCandidateExecution``."""

    SUPPORTS_ATIF = False
    SUPPORTS_WINDOWS = False
    ISOLATE_CANDIDATE_USER = True

    def __init__(
        self,
        logs_dir: Path,
        model_name: str | None = None,
        plan_path: str | None = None,
        receipt_path: str | None = None,
        expected_receipt_digest: str | None = None,
        trace_run_id: str | None = None,
        task_dir: str | None = None,
        profile_dir: str | None = None,
        candidate_dir: str | None = None,
        pier_version: str | None = None,
        extra_env: dict[str, str] | None = None,
        *args: Any,
        **kwargs: Any,
    ) -> None:
        super().__init__(logs_dir=logs_dir, model_name=model_name, *args, **kwargs)
        if (
            not plan_path
            or not receipt_path
            or not expected_receipt_digest
            or not trace_run_id
        ):
            raise PierCandidateError(
                "plan_path, receipt_path, expected_receipt_digest, and trace_run_id are required"
            )
        if not task_dir or not profile_dir or not pier_version:
            raise PierCandidateError("task_dir, profile_dir, and pier_version are required")

        self._expected_pier_version = pier_version
        self._contract = load_prepared_candidate_contract(
            Path(plan_path).expanduser().resolve(),
            Path(receipt_path).expanduser().resolve(),
            expected_receipt_digest,
        )
        if model_name != self._contract.requested_model:
            raise PierCandidateError(
                "Pier model does not match the runtime-resolved request: "
                f"expected={self._contract.requested_model} observed={model_name}"
            )
        self._extra_env = self._validate_protected_env(
            extra_env or {}, trace_run_id
        )
        self._validate_execution_roots()

        self._snapshots = tempfile.TemporaryDirectory(
            prefix="agent-bench-pier-candidate-"
        )
        snapshot_root = Path(self._snapshots.name)
        self._task_snapshot = snapshot_root / "task"
        self._profile_snapshot = snapshot_root / "profile"
        self._candidate_snapshot: Path | None = None
        try:
            immutable_snapshot(
                Path(os.path.abspath(Path(task_dir).expanduser())),
                self._task_snapshot,
                self._contract.task_files,
                "prepared task directory",
            )
            immutable_snapshot(
                Path(os.path.abspath(Path(profile_dir).expanduser())),
                self._profile_snapshot,
                self._contract.profile_files,
                "prepared profile directory",
            )
            if self._contract.candidate_root is not None:
                if not candidate_dir:
                    raise PierCandidateError("active code requires candidate_dir")
                self._candidate_snapshot = snapshot_root / "candidate"
                immutable_snapshot(
                    Path(os.path.abspath(Path(candidate_dir).expanduser())),
                    self._candidate_snapshot,
                    self._contract.candidate_files,
                    "prepared candidate directory",
                )
            elif candidate_dir:
                raise PierCandidateError("disabled code cannot receive candidate_dir")
        except Exception:
            self._snapshots.cleanup()
            raise

        self._original_profile_files: tuple[OriginalProfileFile, ...] = ()
        self._process_boundary = CandidateProcessBoundary(
            self,
            ProcessBoundaryConfig(
                uid=_CANDIDATE_UID,
                gid=_CANDIDATE_GID,
                evaluator_root=_EVALUATOR_ROOT,
                control_root=_CONTROL_ROOT,
                home=_CANDIDATE_HOME,
                temporary=_CANDIDATE_TMP,
                isolate_user=self.ISOLATE_CANDIDATE_USER,
            ),
        )
        self._workspace_boundary = CandidateWorkspaceBoundary(
            self,
            WorkspaceBoundaryConfig(
                contract=self._contract,
                task_snapshot=self._task_snapshot,
                control_root=_CONTROL_ROOT,
                protected_roots=_PIER_PROTECTED_ROOTS,
                error_type=PierCandidateError,
            ),
        )

    def _validate_protected_env(
        self, values: dict[str, str], trace_run_id: str
    ) -> dict[str, str]:
        protected: dict[str, str] = {}
        public_names = set(self._contract.env)
        reserved_public = sorted(public_names & _RESERVED_PROCESS_ENV)
        if reserved_public:
            raise PierCandidateError(
                "signed public env collides with evaluator Git safety fields: "
                + ", ".join(reserved_public)
            )
        expected_trace = _trace_env(self._contract, trace_run_id)
        for name, expected in expected_trace.items():
            if values.get(name) != expected:
                raise PierCandidateError(
                    f"evaluator trace environment is missing or mismatched: {name}"
                )
        for name, value in values.items():
            if not _ENV_RE.fullmatch(name) or name in _RESERVED_PROCESS_ENV:
                raise PierCandidateError(
                    f"invalid protected model environment name: {name}"
                )
            if name in public_names:
                raise PierCandidateError(
                    f"protected model environment overlaps signed public env: {name}"
                )
            if name.startswith("TANGLE_CANDIDATE_") and name not in _TRACE_ENV_NAMES:
                raise PierCandidateError(
                    f"unknown evaluator candidate environment: {name}"
                )
            if not isinstance(value, str) or not value or "\0" in value:
                raise PierCandidateError(
                    f"protected model environment value is empty or invalid: {name}"
                )
            protected[name] = value
        return protected

    def _validate_execution_roots(self) -> None:
        roots = [self._contract.task_root]
        if self._contract.candidate_root is not None:
            roots.append(self._contract.candidate_root)
        for root in roots:
            protected = next(
                (
                    path
                    for path in _PIER_PROTECTED_ROOTS
                    if _same_or_descendant(root, path)
                ),
                None,
            )
            if protected is not None:
                raise PierCandidateError(
                    f"execution workspace cannot be below Pier-owned path {protected}"
                )

    def name(self) -> str:
        short = self._contract.bundle_digest.removeprefix("sha256:")[:16]
        return f"tangle-candidate-{short}"

    def version(self) -> str:
        return _ADAPTER_VERSION

    def network_allowlist(self) -> NetworkAllowlist:
        return NetworkAllowlist(domains=list(self._contract.model_network_domains))

    async def _exec(
        self,
        environment: BaseEnvironment,
        command: str,
        *,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        user: str | int | None = None,
        timeout_sec: float | None = None,
        check: bool = True,
    ) -> Any:
        result = await environment.exec(
            command=command,
            cwd=cwd,
            env=environment.agent_process_env(env),
            user=user,
            timeout_sec=timeout_sec,
        )
        if check and result.return_code != 0:
            raise PierCandidateError(
                f"candidate bridge command failed ({result.return_code}): {command}; "
                f"stderr={(result.stderr or '')[:500]}"
            )
        return result

    async def _assert_real_directory(
        self,
        environment: BaseEnvironment,
        path: str,
        *,
        label: str,
        user: str | int | None = "root",
    ) -> None:
        quoted = shlex.quote(path)
        await self._exec(
            environment,
            "\n".join(
                [
                    "set -eu",
                    f"test -d {quoted}",
                    f"test ! -L {quoted}",
                    f'test "$(realpath -e -- {quoted})" = {quoted}',
                ]
            ),
            user=user,
        )

    async def _ensure_real_directory(
        self,
        environment: BaseEnvironment,
        path: str,
        *,
        anchor: str,
        mode: int = 0o755,
    ) -> None:
        parsed = PurePosixPath(path)
        parsed_anchor = PurePosixPath(anchor)
        if parsed != parsed_anchor and parsed_anchor not in parsed.parents:
            raise PierCandidateError(f"directory escapes its trusted anchor: {path}")
        await self._assert_real_directory(
            environment, anchor, label="trusted directory anchor"
        )
        current = parsed_anchor
        relative_parts = parsed.relative_to(parsed_anchor).parts
        for part in relative_parts:
            current /= part
            value = str(current)
            quoted = shlex.quote(value)
            await self._exec(
                environment,
                "\n".join(
                    [
                        "set -eu",
                        f"if test -e {quoted} || test -L {quoted}; then",
                        f"  test -d {quoted}",
                        f"  test ! -L {quoted}",
                        "else",
                        f"  mkdir -- {quoted}",
                        f"  chmod {mode:o} -- {quoted}",
                        "fi",
                        f'test "$(realpath -e -- {quoted})" = {quoted}',
                    ]
                ),
                user="root",
            )

    async def _write_verified_file(
        self,
        environment: BaseEnvironment,
        source: Path,
        target: str,
        *,
        anchor: str,
        mode: int,
        digest: str,
        byte_length: int,
    ) -> None:
        parent = str(PurePosixPath(target).parent)
        await self._ensure_real_directory(environment, parent, anchor=anchor)
        temporary = f"{parent}/.tangle-{secrets.token_hex(24)}"
        quoted_temporary = shlex.quote(temporary)
        quoted_target = shlex.quote(target)
        expected_hash = digest.removeprefix("sha256:")
        await self._exec(
            environment,
            f"test ! -e {quoted_temporary} && test ! -L {quoted_temporary}",
            user="root",
        )
        try:
            await environment.upload_file(source, temporary)
            await self._exec(
                environment,
                "\n".join(
                    [
                        "set -eu",
                        f"test -f {quoted_temporary}",
                        f"test ! -L {quoted_temporary}",
                        f'test "$(stat -c %h -- {quoted_temporary})" = 1',
                        f'test "$(wc -c < {quoted_temporary})" = {byte_length}',
                        f"test \"$(sha256sum {quoted_temporary} | cut -d' ' -f1)\" = {expected_hash}",
                        f"chmod {mode:o} -- {quoted_temporary}",
                        f'test "$(stat -c %a -- {quoted_temporary})" = {mode:o}',
                        f"rm -rf -- {quoted_target}",
                        f"mv -fT -- {quoted_temporary} {quoted_target}",
                        f"test -f {quoted_target}",
                        f"test ! -L {quoted_target}",
                        f'test "$(stat -c %h -- {quoted_target})" = 1',
                        f'test "$(stat -c %a -- {quoted_target})" = {mode:o}',
                        f'test "$(wc -c < {quoted_target})" = {byte_length}',
                        f"test \"$(sha256sum {quoted_target} | cut -d' ' -f1)\" = {expected_hash}",
                    ]
                ),
                user="root",
            )
        finally:
            await self._exec(
                environment,
                f"rm -f -- {quoted_temporary}",
                user="root",
                check=False,
            )

    async def _verify_pier_execution_identity(
        self, environment: BaseEnvironment
    ) -> None:
        await self._workspace_boundary.verify_pier_execution_identity(environment)

    async def _capture_original_profile_files(
        self, environment: BaseEnvironment
    ) -> tuple[OriginalProfileFile, ...]:
        if self._contract.profile_target != "task":
            return ()
        originals: list[OriginalProfileFile] = []
        root = self._contract.task_root
        git = f"git -c core.hooksPath=/dev/null -C {shlex.quote(root)}"
        for file in self._contract.profile_files:
            target = f"{root}/{file.path}"
            quoted = shlex.quote(target)
            parent = shlex.quote(str(PurePosixPath(target).parent))
            presence = await self._exec(
                environment,
                "\n".join(
                    [
                        "set -eu",
                        f'test "$(realpath -m -- {parent})" = {parent}',
                        f"if test -e {quoted} || test -L {quoted}; then",
                        f"  test -f {quoted}",
                        f"  test ! -L {quoted}",
                        f'  test "$(stat -c %h -- {quoted})" = 1',
                        "else",
                        "  exit 2",
                        "fi",
                    ]
                ),
                user="root",
                check=False,
            )
            tracked = (
                await self._exec(
                    environment,
                    f"{git} ls-files --error-unmatch -- {shlex.quote(file.path)}",
                    env=candidate_git_env(root),
                    user="root",
                    check=False,
                )
            ).return_code == 0
            if presence.return_code == 2:
                originals.append(
                    OriginalProfileFile(file.path, False, tracked, None, None)
                )
                continue
            if presence.return_code != 0:
                raise PierCandidateError(
                    f"profile mount target is not one regular file: {file.path}"
                )
            encoded = await self._exec(
                environment, f"base64 -w0 -- {quoted}", user="root"
            )
            mode = await self._exec(environment, f"stat -c %a -- {quoted}", user="root")
            try:
                content = base64.b64decode(
                    (encoded.stdout or "").strip(), validate=True
                )
                parsed_mode = int((mode.stdout or "").strip(), 8)
            except (ValueError, TypeError) as exc:
                raise PierCandidateError(
                    f"could not capture original profile target: {file.path}"
                ) from exc
            originals.append(
                OriginalProfileFile(file.path, True, tracked, parsed_mode, content)
            )
        return tuple(originals)

    async def _apply_profile(self, environment: BaseEnvironment) -> None:
        target_root = (
            self._contract.task_root
            if self._contract.profile_target == "task"
            else self._contract.candidate_root
        )
        if target_root is None:
            raise PierCandidateError("profile target workspace is unavailable")
        self._original_profile_files = await self._capture_original_profile_files(
            environment
        )
        for file in self._contract.profile_files:
            target = f"{target_root}/{file.path}"
            source = self._profile_snapshot / file.path
            await self._write_verified_file(
                environment,
                source,
                target,
                anchor=target_root,
                mode=file.mode,
                digest=file.sha256,
                byte_length=source.stat().st_size,
            )

    async def setup(self, environment: BaseEnvironment) -> None:
        try:
            observed_pier = _runtime_pier_version()
            if observed_pier != self._expected_pier_version:
                raise PierCandidateError(
                    f"Pier version mismatch: expected={self._expected_pier_version} "
                    f"installed={observed_pier}"
                )
            await self._verify_pier_execution_identity(environment)
            await self._workspace_boundary.materialize_task_workspace(environment)
            await self._workspace_boundary.verify_repository(environment)
            await self._workspace_boundary.verify_container_workspace(
                environment,
                self._contract.task_root,
                self._contract.task_files,
                allow_task_metadata=True,
            )
            if self._contract.candidate_root is not None:
                if self._candidate_snapshot is None:
                    raise PierCandidateError("candidate snapshot is unavailable")
                quoted = shlex.quote(self._contract.candidate_root)
                candidate_parent = str(
                    PurePosixPath(self._contract.candidate_root).parent
                )
                await self._ensure_real_directory(
                    environment, candidate_parent, anchor="/"
                )
                await self._exec(
                    environment,
                    "\n".join(
                        [
                            "set -eu",
                            f"test ! -e {quoted}",
                            f"test ! -L {quoted}",
                            f"mkdir -- {quoted}",
                            f'test "$(realpath -e -- {quoted})" = {quoted}',
                        ]
                    ),
                    user="root",
                )
                await self._workspace_boundary.verify_resolved_root_isolation(
                    environment
                )
                await environment.upload_dir(
                    self._candidate_snapshot, self._contract.candidate_root
                )
                await self._workspace_boundary.verify_container_workspace(
                    environment,
                    self._contract.candidate_root,
                    self._contract.candidate_files,
                    allow_task_metadata=False,
                )
            else:
                await self._workspace_boundary.verify_resolved_root_isolation(
                    environment
                )
            workspace_roots = (self._contract.task_root,) + (
                (self._contract.candidate_root,)
                if self._contract.candidate_root is not None
                else ()
            )
            await self._process_boundary.prepare_identity(environment, workspace_roots)
            await self._apply_profile(environment)

            self.logs_dir.mkdir(parents=True, exist_ok=True)
            (self.logs_dir / "execution-plan.json").write_bytes(self._contract.plan_raw)
            (self.logs_dir / "materialization-receipt.json").write_bytes(
                self._contract.receipt_raw
            )
        finally:
            self._snapshots.cleanup()

    def _identity_metadata(self) -> dict[str, Any]:
        return {
            "executionId": self._contract.execution_id,
            "bundleDigest": self._contract.bundle_digest,
            "executionPlanDigest": self._contract.execution_plan_digest,
            "materializationReceiptDigest": self._contract.materialization_receipt_digest,
            "usageSource": "protected-agent-eval-trace",
        }

    async def _upload_instruction(
        self, environment: BaseEnvironment, instruction: str
    ) -> tuple[list[str], str | None, str | None]:
        try:
            raw = instruction.encode("utf-8")
        except UnicodeEncodeError as exc:
            raise PierCandidateError("Pier instruction is not valid UTF-8") from exc
        evidence = self._contract.instruction
        if len(raw) != evidence.byte_length or sha256_bytes(raw) != evidence.sha256:
            raise PierCandidateError(
                "Pier instruction bytes do not match the signed task instruction"
            )

        argv = [self._contract.executable, *self._contract.args]
        if evidence.delivery_kind == "argv-append":
            argv.append(instruction)
            return argv, None, None

        target = evidence.delivery_path or _PROTECTED_TASK_PATH
        with tempfile.NamedTemporaryFile(delete=False) as handle:
            handle.write(raw)
            local_path = Path(handle.name)
        try:
            await self._write_verified_file(
                environment,
                local_path,
                target,
                anchor="/",
                mode=0o644,
                digest=evidence.sha256,
                byte_length=len(raw),
            )
        finally:
            local_path.unlink(missing_ok=True)
        return (
            argv,
            target if evidence.delivery_kind == "stdin-utf8" else None,
            target,
        )

    async def _remove_instruction_file(
        self, environment: BaseEnvironment, path: str | None
    ) -> None:
        if path is None:
            return
        parent = str(PurePosixPath(path).parent)
        await self._assert_real_directory(
            environment, parent, label="protected instruction directory"
        )
        await self._exec(
            environment,
            f"rm -f -- {shlex.quote(path)}",
            user="root",
        )

    async def _restore_profile_and_capture_solution(
        self, environment: BaseEnvironment
    ) -> None:
        root = self._contract.task_root
        quoted_root = shlex.quote(root)
        git = f"git -c core.hooksPath=/dev/null -C {quoted_root}"
        git_env = candidate_git_env(root)

        # Ignore candidate-authored commits and derive one evaluator-owned final
        # tree from the actual working files relative to the signed base commit.
        await self._exec(
            environment,
            f"{git} reset --mixed {shlex.quote(self._contract.repository_base_commit)}",
            env=git_env,
            user="root",
        )
        for original in self._original_profile_files:
            target = f"{root}/{original.path}"
            quoted = shlex.quote(target)
            if original.existed:
                if original.content is None or original.mode is None:
                    raise PierCandidateError(
                        f"profile backup is incomplete: {original.path}"
                    )
                with tempfile.NamedTemporaryFile(delete=False) as handle:
                    handle.write(original.content)
                    local_path = Path(handle.name)
                try:
                    await self._write_verified_file(
                        environment,
                        local_path,
                        target,
                        anchor=root,
                        mode=original.mode,
                        digest=sha256_bytes(original.content),
                        byte_length=len(original.content),
                    )
                finally:
                    local_path.unlink(missing_ok=True)
            else:
                parent = str(PurePosixPath(target).parent)
                await self._ensure_real_directory(environment, parent, anchor=root)
                await self._exec(environment, f"rm -rf -- {quoted}", user="root")

        await self._exec(environment, f"{git} add -A -- .", env=git_env, user="root")
        for original in self._original_profile_files:
            if original.tracked:
                continue
            await self._exec(
                environment,
                f"{git} rm -r -f --cached --ignore-unmatch -- {shlex.quote(original.path)}",
                env=git_env,
                user="root",
            )
        staged = await self._exec(
            environment,
            f"{git} diff --cached --quiet",
            env=git_env,
            user="root",
            check=False,
        )
        if staged.return_code not in {0, 1}:
            raise PierCandidateError("could not inspect the sanitized solution tree")
        if staged.return_code == 1:
            commit_env = {
                **git_env,
                "GIT_AUTHOR_NAME": "Tangle Evaluator",
                "GIT_AUTHOR_EMAIL": "evaluator@tangle.tools",
                "GIT_COMMITTER_NAME": "Tangle Evaluator",
                "GIT_COMMITTER_EMAIL": "evaluator@tangle.tools",
            }
            await self._exec(
                environment,
                f"{git} commit -m 'capture candidate solution'",
                env=commit_env,
                user="root",
            )

    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        argv, stdin_path, instruction_path = await self._upload_instruction(
            environment, instruction
        )
        cwd = _join_workspace(self._contract.cwd_root, self._contract.cwd_path)
        await self._exec(environment, f"test -d {shlex.quote(cwd)}")

        process_env = {
            **self._extra_env,
            **candidate_git_env(self._contract.task_root),
            "HOME": _CANDIDATE_HOME,
            "TMPDIR": _CANDIDATE_TMP,
            "PATH": _FIXED_PATH,
        }
        wrapper, timeout_marker = await self._process_boundary.stage_wrapper(
            environment
        )
        timeout_seconds = self._contract.timeout_ms / 1000
        command = shlex.join(
            [
                wrapper,
                timeout_marker,
                str(_CANDIDATE_UID),
                str(_CANDIDATE_GID),
                f"{timeout_seconds:.3f}",
                "2",
                stdin_path or "-",
                *(f"{name}={value}" for name, value in self._contract.env.items()),
                *argv,
            ]
        )
        context.metadata = {
            **self._identity_metadata(),
            "termination": {"kind": "running"},
        }

        started = time.monotonic()
        try:
            result = await environment.exec(
                command=command,
                cwd=cwd,
                env=environment.agent_process_env(process_env),
                user="root",
                timeout_sec=math.ceil(timeout_seconds) + 12,
            )
        except (asyncio.CancelledError, asyncio.TimeoutError):
            elapsed = int((time.monotonic() - started) * 1000)
            cleanup_errors: list[str] = []
            try:
                await asyncio.shield(
                    self._process_boundary.kill_and_wait(environment)
                )
            except Exception as cleanup_exc:
                cleanup_errors.append(str(cleanup_exc))
            try:
                await asyncio.shield(
                    self._remove_instruction_file(environment, instruction_path)
                )
            except Exception as cleanup_exc:
                cleanup_errors.append(str(cleanup_exc))
            try:
                await asyncio.shield(
                    self._restore_profile_and_capture_solution(environment)
                )
            except (
                Exception
            ) as cleanup_exc:  # cleanup failure is evidence, never hidden
                cleanup_errors.append(str(cleanup_exc))
            try:
                await asyncio.shield(
                    self._process_boundary.remove_control_files(
                        environment, wrapper, timeout_marker
                    )
                )
            except Exception as cleanup_exc:
                cleanup_errors.append(str(cleanup_exc))
            context.metadata = {
                **self._identity_metadata(),
                "termination": {"kind": "cancelled", "observedElapsedMs": elapsed},
                **(
                    {"cleanupError": "; ".join(cleanup_errors)}
                    if cleanup_errors
                    else {}
                ),
            }
            raise
        except Exception:
            await asyncio.shield(self._process_boundary.kill_and_wait(environment))
            await asyncio.shield(
                self._remove_instruction_file(environment, instruction_path)
            )
            await asyncio.shield(
                self._restore_profile_and_capture_solution(environment)
            )
            await asyncio.shield(
                self._process_boundary.remove_control_files(
                    environment, wrapper, timeout_marker
                )
            )
            raise

        elapsed = int((time.monotonic() - started) * 1000)
        timed_out = await self._process_boundary.timeout_marker_exists(
            environment, timeout_marker
        )
        await self._process_boundary.kill_and_wait(environment)
        await self._remove_instruction_file(environment, instruction_path)
        await self._restore_profile_and_capture_solution(environment)
        await self._process_boundary.remove_control_files(
            environment, wrapper, timeout_marker
        )
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        (self.logs_dir / "stdout.txt").write_text(result.stdout or "", encoding="utf-8")
        (self.logs_dir / "stderr.txt").write_text(result.stderr or "", encoding="utf-8")
        (self.logs_dir / "process.json").write_text(
            json.dumps(
                {
                    "executionId": self._contract.execution_id,
                    "exitCode": result.return_code,
                    "elapsedMs": elapsed,
                    "cwd": cwd,
                    "argv": argv,
                    "instructionDelivery": self._contract.instruction.delivery_kind,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        context.metadata = {
            **self._identity_metadata(),
            "termination": (
                {"kind": "timeout", "timeoutMs": self._contract.timeout_ms}
                if timed_out
                else {"kind": "exit", "exitCode": result.return_code}
            ),
            "observedElapsedMs": elapsed,
        }
        if timed_out:
            raise asyncio.TimeoutError(
                f"candidate exceeded signed timeout {self._contract.timeout_ms}ms"
            )
        if result.return_code != 0:
            raise NonZeroAgentExitCodeError(
                f"candidate exited {result.return_code}: "
                f"stdout={(result.stdout or '')[:500]} "
                f"stderr={(result.stderr or '')[:500]}"
            )
