#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
proof_context=$(mktemp -d)
proof_image="runtime-checker-proof:$(date +%s)-$$"
cleanup() {
  rm -rf "$proof_context"
  docker image rm "$proof_image" >/dev/null 2>&1 || true
}
trap cleanup EXIT
mkdir -p "$proof_context/src/runtime" "$proof_context/tests/runtime"
cp "$repo_root/src/runtime/isolated-checker.ts" "$proof_context/src/runtime/"
cp "$repo_root/tests/runtime/isolated-checker.linux.mjs" "$proof_context/tests/runtime/"
cat > "$proof_context/Dockerfile" <<'DOCKERFILE'
FROM node:24-bookworm
RUN apt-get update -qq && apt-get install -y -qq bubblewrap && rm -rf /var/lib/apt/lists/* && mkdir /work
COPY . /app
ENTRYPOINT ["node", "/app/tests/runtime/isolated-checker.linux.mjs"]
DOCKERFILE
docker build --quiet --tag "$proof_image" "$proof_context"
docker run --rm --privileged --env HOST_SECRET=hidden "$proof_image"
# Explicitly deny the namespace syscall even on engines allowing unprivileged namespaces.
printf '%s\n' '{"defaultAction":"SCMP_ACT_ALLOW","syscalls":[{"names":["unshare"],"action":"SCMP_ACT_ERRNO"}]}' > "$proof_context/deny-unshare.json"
docker run --rm --security-opt "seccomp=$proof_context/deny-unshare.json" "$proof_image" --refusal
