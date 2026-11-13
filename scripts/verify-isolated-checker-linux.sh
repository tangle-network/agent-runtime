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
mkdir -p "$proof_context/tests/runtime"
# The checker imports sibling modules and packages, so the container receives one bundled file.
# Resolve the Rolldown bundled with the maintained tsdown build tool.
rolldown_cli=$(cd "$repo_root" && node -e 'const p=require("node:path");console.log(p.join(p.dirname(require.resolve("rolldown",{paths:[require.resolve("tsdown")]})),"..","bin/cli.mjs"))')
(cd "$repo_root" && node "$rolldown_cli" src/runtime/isolated-checker.ts --format esm --platform node \
  --file "$proof_context/tests/runtime/isolated-checker.mjs" >/dev/null)
(cd "$repo_root" && node "$rolldown_cli" src/runtime/private-cas.ts --format esm --platform node \
  --file "$proof_context/tests/runtime/private-cas.mjs" >/dev/null)
cp "$repo_root/tests/runtime/isolated-checker.linux.mjs" "$proof_context/tests/runtime/"
cat > "$proof_context/Dockerfile" <<'DOCKERFILE'
FROM node:24-bookworm
RUN apt-get update -qq && apt-get install -y -qq bubblewrap && rm -rf /var/lib/apt/lists/* && mkdir /work
COPY . /app
ENTRYPOINT ["node", "/app/tests/runtime/isolated-checker.linux.mjs"]
DOCKERFILE
docker build --quiet --tag "$proof_image" "$proof_context"
docker run --rm --memory=256m --pids-limit=64 --cpus=1 --privileged --env HOST_SECRET=hidden "$proof_image"
docker run --rm --memory=256m --pids-limit=64 --cpus=1 --privileged "$proof_image" --cleanup-failure
docker run --rm --memory=192m --pids-limit=64 --cpus=1 --privileged "$proof_image" --memory-exhaustion
# Deny mount namespace creation via unshare/clone/clone3 while allowing normal process creation.
printf '%s\n' '{"defaultAction":"SCMP_ACT_ALLOW","syscalls":[{"names":["unshare"],"action":"SCMP_ACT_ERRNO"},{"names":["clone3"],"action":"SCMP_ACT_ERRNO","errnoRet":38},{"names":["clone"],"action":"SCMP_ACT_ERRNO","args":[{"index":0,"value":131072,"valueTwo":131072,"op":"SCMP_CMP_MASKED_EQ"}]}]}' > "$proof_context/deny-namespaces.json"
docker run --rm --memory=256m --pids-limit=64 --cpus=1 --security-opt "seccomp=$proof_context/deny-namespaces.json" "$proof_image" --refusal
