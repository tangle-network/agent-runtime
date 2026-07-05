# A minimal Lean 4 toolchain image — the deterministic verifier for the Lean proof gate.
# Built ONCE by lean-verify.ts (docker build) and cached; each check runs `lean` in it
# (~seconds). This is the ground-truth judge: it compiles the proposed proof and cannot be
# fooled — a wrong proof fails with a real type error that feeds the next attempt.
FROM ubuntu:24.04
RUN apt-get update -qq \
 && apt-get install -y -qq curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# elan is Lean's toolchain installer; `stable` pins the current Lean 4 release.
RUN curl -sSf https://elan.lean-lang.org/elan-init.sh | sh -s -- -y --default-toolchain stable
ENV PATH="/root/.elan/bin:${PATH}"
RUN lean --version
