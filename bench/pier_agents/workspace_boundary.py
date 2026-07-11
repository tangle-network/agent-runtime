"""Verify and materialize runtime-signed workspaces inside a Pier container."""

from __future__ import annotations

import shlex
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Protocol

from pier.environments.base import BaseEnvironment

from .candidate_contract import PreparedCandidateContract, WorkspaceFile


class WorkspaceBoundaryHost(Protocol):
    async def _exec(
        self, environment: BaseEnvironment, command: str, **kwargs: Any
    ) -> Any: ...

    async def _ensure_real_directory(
        self,
        environment: BaseEnvironment,
        path: str,
        *,
        anchor: str,
        mode: int = 0o755,
    ) -> None: ...

    async def _assert_real_directory(
        self,
        environment: BaseEnvironment,
        path: str,
        *,
        label: str,
        user: str | int | None = "root",
    ) -> None: ...


@dataclass(frozen=True)
class WorkspaceBoundaryConfig:
    contract: PreparedCandidateContract
    task_snapshot: Path
    protected_roots: tuple[str, ...]
    error_type: type[Exception]


def candidate_git_env(task_root: str) -> dict[str, str]:
    return {
        "GIT_CONFIG_COUNT": "1",
        "GIT_CONFIG_KEY_0": "safe.directory",
        "GIT_CONFIG_VALUE_0": task_root,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_SYSTEM": "/dev/null",
        "GIT_NO_REPLACE_OBJECTS": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "LC_ALL": "C",
    }


class CandidateWorkspaceBoundary:
    def __init__(self, host: WorkspaceBoundaryHost, config: WorkspaceBoundaryConfig):
        self._host = host
        self._config = config

    @property
    def _contract(self) -> PreparedCandidateContract:
        return self._config.contract

    def _error(self, message: str) -> Exception:
        return self._config.error_type(message)

    async def verify_repository(self, environment: BaseEnvironment) -> None:
        root = shlex.quote(self._contract.task_root)
        git = f"git -c core.hooksPath=/dev/null -C {root}"
        env = candidate_git_env(self._contract.task_root)
        head = await self._host._exec(environment, f"{git} rev-parse HEAD", env=env)
        tree = await self._host._exec(
            environment, f"{git} rev-parse 'HEAD^{{tree}}'", env=env
        )
        replacements = await self._host._exec(
            environment,
            f"{git} for-each-ref --format='%(refname)' refs/replace",
            env=env,
        )
        if (head.stdout or "").strip() != self._contract.repository_base_commit:
            raise self._error("task checkout HEAD does not match the signed base commit")
        if (tree.stdout or "").strip() != self._contract.repository_base_tree:
            raise self._error("task checkout tree does not match the signed base tree")
        if (replacements.stdout or "").strip():
            raise self._error("task checkout contains forbidden Git replace refs")

    async def materialize_task_workspace(self, environment: BaseEnvironment) -> None:
        root = self._contract.task_root
        quoted = shlex.quote(root)
        exists = await self._host._exec(
            environment,
            f"test -e {quoted} || test -L {quoted}",
            user="root",
            check=False,
        )
        if exists.return_code == 0:
            return
        if exists.return_code != 1:
            raise self._error("could not inspect the signed task root")

        parent = str(PurePosixPath(root).parent)
        await self._host._ensure_real_directory(environment, parent, anchor="/")
        await self._host._exec(
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
        await environment.upload_dir(self._config.task_snapshot, root)
        git = f"git -c core.hooksPath=/dev/null -C {quoted}"
        await self._host._exec(
            environment,
            "\n".join(
                [
                    "set -eu",
                    f"{git} init -b main",
                    f"{git} config user.email fixture@tangle.tools",
                    f'{git} config user.name "Tangle Fixture"',
                    f"{git} add -A",
                    f"GIT_AUTHOR_DATE=2000-01-01T00:00:00Z "
                    f"GIT_COMMITTER_DATE=2000-01-01T00:00:00Z "
                    f"{git} commit -m baseline",
                    f"{git} tag benchmark-base",
                ]
            ),
            env=candidate_git_env(root),
            user="root",
        )

    async def verify_pier_execution_identity(
        self, environment: BaseEnvironment
    ) -> None:
        expected = self._contract.container
        configured_image = getattr(environment.task_env_config, "docker_image", None)
        pinned_image = f"{expected['image']}@{expected['indexDigest']}"
        if configured_image != pinned_image:
            raise self._error(
                "Pier task image does not match the signed immutable image: "
                f"expected={pinned_image} observed={configured_image}"
            )
        configured_os = getattr(environment.task_env_config, "os", None)
        configured_os = getattr(configured_os, "value", configured_os)
        if configured_os is not None and str(configured_os).lower() != "linux":
            raise self._error(
                f"Pier task OS does not match signed Linux platform: {configured_os}"
            )
        platform = expected["platform"]
        observed = await self._host._exec(
            environment,
            'printf \'%s %s\' "$(uname -s)" "$(uname -m)"',
            user="root",
        )
        kernel, _, machine = (observed.stdout or "").strip().partition(" ")
        architectures = {"x86_64": "amd64", "aarch64": "arm64"}
        if kernel != "Linux" or architectures.get(machine) != platform["architecture"]:
            raise self._error(
                "running Pier platform does not match the signed container platform: "
                f"observed={kernel}/{machine} expected=linux/{platform['architecture']}"
            )

    async def verify_resolved_root_isolation(
        self, environment: BaseEnvironment
    ) -> None:
        roots = [self._contract.task_root]
        if self._contract.candidate_root is not None:
            roots.append(self._contract.candidate_root)
        for root in roots:
            await self._host._assert_real_directory(
                environment, root, label="execution workspace"
            )
        if self._contract.candidate_root is not None:
            task = shlex.quote(self._contract.task_root)
            candidate = shlex.quote(self._contract.candidate_root)
            await self._host._exec(
                environment,
                "\n".join(
                    [
                        "set -eu",
                        f"task=$(realpath -e -- {task})",
                        f"candidate=$(realpath -e -- {candidate})",
                        'test "$task" != "$candidate"',
                        'case "$task" in "$candidate"/*) exit 1;; esac',
                        'case "$candidate" in "$task"/*) exit 1;; esac',
                    ]
                ),
                user="root",
            )
        for protected in self._config.protected_roots:
            quoted_protected = shlex.quote(protected)
            for root in roots:
                quoted_root = shlex.quote(root)
                await self._host._exec(
                    environment,
                    "\n".join(
                        [
                            "set -eu",
                            f"if test -e {quoted_protected}; then",
                            f"  protected=$(realpath -e -- {quoted_protected})",
                            f"  root=$(realpath -e -- {quoted_root})",
                            '  test "$root" != "$protected"',
                            '  case "$root" in "$protected"/*) exit 1;; esac',
                            '  case "$protected" in "$root"/*) exit 1;; esac',
                            "fi",
                        ]
                    ),
                    user="root",
                )

    async def verify_container_workspace(
        self,
        environment: BaseEnvironment,
        root: str,
        files: tuple[WorkspaceFile, ...],
        *,
        allow_task_metadata: bool,
    ) -> None:
        quoted_root = shlex.quote(root)
        prune = (
            f"\\( -path {shlex.quote(root + '/.git')} -o "
            f"-path {shlex.quote(root + '/.sidecar')} \\) -prune -o "
            if allow_task_metadata
            else ""
        )
        expected_args = " ".join(shlex.quote(file.path) for file in files)
        expected = (
            f"$(printf '%s\\n' {expected_args} | LC_ALL=C sort)" if files else "''"
        )
        checks = [
            "set -eu",
            f"test -d {quoted_root}",
            f"test ! -L {quoted_root}",
            f'test "$(realpath -e -- {quoted_root})" = {quoted_root}',
            f'test -z "$(find {quoted_root} {prune}-type l -print -quit)"',
            f'test -z "$(find {quoted_root} {prune}! -type d ! -type f -print -quit)"',
            f"observed=$(find {quoted_root} {prune}-type f -printf '%P\\n' | LC_ALL=C sort)",
            f"expected={expected}",
            'test "$observed" = "$expected"',
        ]
        for file in files:
            path = shlex.quote(f"{root}/{file.path}")
            checks.extend(
                [
                    f"test -f {path}",
                    f"test ! -L {path}",
                    f'test "$(stat -c %h {path})" = 1',
                    f'test "$(stat -c %a {path})" = {file.mode:o}',
                    f'test "$(wc -c < {path})" = {file.byte_length}',
                    f"test \"$(sha256sum {path} | cut -d' ' -f1)\" = {file.sha256.removeprefix('sha256:')}",
                ]
            )
        await self._host._exec(environment, "\n".join(checks))
