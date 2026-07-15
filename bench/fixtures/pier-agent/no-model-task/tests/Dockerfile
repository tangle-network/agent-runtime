FROM ubuntu:24.04

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY seed/ /app/
RUN git init \
    && git config user.email fixture@tangle.tools \
    && git config user.name "Tangle Fixture" \
    && git add -A \
    && GIT_AUTHOR_DATE=2000-01-01T00:00:00Z \
       GIT_COMMITTER_DATE=2000-01-01T00:00:00Z \
       git commit -m baseline \
    && git tag benchmark-base
COPY test.sh /tests/test.sh
